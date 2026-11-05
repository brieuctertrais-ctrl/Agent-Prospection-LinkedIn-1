/**
 * Autopilot — step A: batch preparation, review in the dashboard, then paced sending.
 *
 * Safeguards (see project brief):
 *  - nothing is sent before the user approved it in the dashboard;
 *  - working hours / working days in the user's timezone;
 *  - random delay between invitations (min_delay_seconds … max_delay_seconds);
 *  - daily / weekly invitation quotas + 2-week warm-up ramp;
 *  - immediate stop on any LinkedIn warning, limit or security check (resume by the user only);
 *  - a single running campaign per account;
 *  - every action is logged (action_logs).
 */
import type { Persona } from "@kairo/shared";
import { ApiError, countToday, countWeek, generateFollowup, generateMessage, logAction, type FollowupKind } from "./api";
import { nextProfile, type Settings, type SkipEvent } from "./engine";
import { patchState } from "./storage";
import { supabase } from "./supabase";
import { navigate, sendToTab } from "./tabs";
import { CONNECTIONS_URL, INBOX_URL } from "../linkedin/messaging";
import { sleep } from "../linkedin/dom";

const PAUSE_CODES = new Set(["security_check", "limit_reached", "ui_changed"]);

async function userId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new ApiError("unauthorized");
  return data.user.id;
}

// ---------------------------------------------------------------- counts

export async function batchCounts(): Promise<{ toReview: number; followups: number; approved: number }> {
  const base = () => supabase.from("action_queue").select("id", { count: "exact", head: true }).eq("status", "pending");
  const [a, f, b] = await Promise.all([
    base().eq("action_type", "invitation").eq("payload->>needs_approval", "true"),
    base().eq("action_type", "message").eq("payload->>needs_approval", "true"),
    base().eq("payload->>needs_approval", "false"),
  ]);
  return { toReview: a.count ?? 0, followups: f.count ?? 0, approved: b.count ?? 0 };
}

// ---------------------------------------------------------------- preparation

export type PrepareEnd = "done" | "empty" | "daily_cap" | "paused" | "stopped" | "error" | "low_match";

export async function prepareBatch(opts: {
  tabId: number;
  persona: Persona;
  settings: Settings;
  size: number;
  noteMax: number;
  onProgress: (prepared: number) => void;
  onSkip?: (e: SkipEvent) => void;
  shouldStop: () => boolean;
}): Promise<{ prepared: number; end: PrepareEnd; code?: string; lowScore?: number }> {
  const uid = await userId();
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .insert({ user_id: uid, persona_id: opts.persona.id, status: "draft", batch_validation: true })
    .select("id")
    .single();
  if (error || !campaign) return { prepared: 0, end: "error", code: "generic" };

  let prepared = 0;
  let lowRounds = 0;
  let lowScore = 0;
  while (prepared < opts.size) {
    if (opts.shouldStop()) return { prepared, end: "stopped" };
    const r = await nextProfile(opts.tabId, opts.persona, opts.settings, opts.onSkip);
    if (r.kind === "low_match") {
      // Keep looking, but not forever: 3 rounds of 15 set-aside profiles → let the user adjust the persona.
      lowScore += r.skipped.lowScore;
      lowRounds += 1;
      if (lowRounds >= 3) return { prepared, end: "low_match", lowScore };
      continue;
    }
    if (r.kind === "empty") return { prepared, end: "empty" };
    if (r.kind === "daily_cap") return { prepared, end: "daily_cap" };
    if (r.kind === "paused") return { prepared, end: "paused", code: r.code };

    try {
      const msg = await generateMessage(opts.persona.id, r.profile, undefined, opts.noteMax, "proposal");
      const { error: qErr } = await supabase.from("action_queue").insert({
        user_id: uid,
        campaign_id: campaign.id,
        prospect_id: msg.prospect_id,
        action_type: "invitation",
        payload: { needs_approval: true, message_id: msg.message_id, score: r.score ?? null },
      });
      if (qErr) return { prepared, end: "error", code: "generic" };
      await logAction("batch_prepare", "success", { campaign_id: campaign.id }, { prospect_id: msg.prospect_id, linkedin_url: r.profile.linkedin_url });
      prepared += 1;
      opts.onProgress(prepared);
    } catch (e) {
      return { prepared, end: "error", code: e instanceof ApiError ? e.message : "generic" };
    }
  }
  return { prepared, end: "done" };
}

// ---------------------------------------------------------------- sending (one step at a time)

/** Result of one sending step. The background worker calls sendOne() repeatedly, spaced by a random delay. */
export type StepResult =
  | { kind: "sent"; action: "invitation" | "message"; noteLimit?: number }
  | { kind: "failed"; code: string; noteLimit?: number }
  /** LinkedIn warning / limit / check, or interface change: everything stops until the user resumes. */
  | { kind: "paused"; code: string }
  | { kind: "idle"; reason: "none" | "outside_hours" | "quota" | "paused_by_user" };

/** Hour (0-23) and ISO weekday (1 = Monday … 7 = Sunday) in the user's timezone. */
function localTime(tz: string): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd) + 1;
  return { hour, weekday };
}

export function inWorkingHours(s: Settings): boolean {
  let tz = s.timezone || "Europe/Paris";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    tz = "Europe/Paris";
  }
  const { hour, weekday } = localTime(tz);
  const days = s.work_days?.length ? s.work_days : [1, 2, 3, 4, 5];
  return days.includes(weekday) && hour >= (s.work_start_hour ?? 9) && hour < (s.work_end_hour ?? 19);
}

/** Daily cap with a 2-week warm-up: starts at 5/day and grows linearly to the configured quota. */
export async function dailyCap(s: Settings): Promise<number> {
  const quota = s.daily_invitations ?? 20;
  const { data } = await supabase
    .from("action_logs")
    .select("created_at")
    .eq("action_type", "invitation")
    .eq("result", "success")
    .eq("details->>autopilot", "true")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return Math.min(quota, 5);
  const days = Math.floor((Date.now() - new Date(data.created_at).getTime()) / 86_400_000);
  return Math.min(quota, 5 + Math.floor((days * Math.max(0, quota - 5)) / 14));
}

/** Random human delay (seconds) before the next invitation. */
export function nextDelaySeconds(s: Settings): number {
  const min = Math.max(30, s.min_delay_seconds ?? 45);
  const max = Math.max(min, s.max_delay_seconds ?? 180);
  return Math.round(min + Math.random() * (max - min));
}

/** Called when the user (re)starts automatic sending: campaigns paused earlier become eligible again. */
export async function resumeCampaigns(): Promise<void> {
  const uid = await userId();
  await supabase.from("campaigns").update({ status: "draft", paused_reason: null }).eq("user_id", uid).eq("status", "paused");
}

/** Sends at most ONE approved action (invitation or follow-up message), after every safeguard check. */
export async function sendOne(tabId: number, settings: Settings, noteMax: number): Promise<StepResult> {
  if (!inWorkingHours(settings)) return { kind: "idle", reason: "outside_hours" };
  const [invDay, invWeek, cap, msgDay] = await Promise.all([
    countToday("invitation"),
    countWeek("invitation"),
    dailyCap(settings),
    countToday("message"),
  ]);
  const invitationsAllowed = invDay < cap && invWeek < (settings.weekly_invitations ?? 100);
  const messagesAllowed = msgDay < (settings.daily_messages ?? 50);
  const types = [...(messagesAllowed ? ["message"] : []), ...(invitationsAllowed ? ["invitation"] : [])];
  if (!types.length) return { kind: "idle", reason: "quota" };

  const uid = await userId();
  // Follow-ups first (people who just accepted), then invitations; oldest first.
  const { data: rows } = await supabase
    .from("action_queue")
    .select("id, action_type, prospect_id, campaign_id, payload, attempts, campaign:campaigns(status)")
    .eq("status", "pending")
    .in("action_type", types)
    .eq("payload->>needs_approval", "false")
    .order("scheduled_at", { ascending: true })
    .limit(20);
  const item = (rows ?? []).sort((a, b) => (a.action_type === b.action_type ? 0 : a.action_type === "message" ? -1 : 1))[0];
  if (!item) {
    // Nothing allowed right now: quota reached for the remaining type, or nothing left at all.
    const { count } = await supabase
      .from("action_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .eq("payload->>needs_approval", "false");
    if ((count ?? 0) > 0) return { kind: "idle", reason: "quota" };
    await supabase.from("campaigns").update({ status: "finished" }).eq("user_id", uid).eq("status", "running");
    return { kind: "idle", reason: "none" };
  }

  // Paused from the dashboard: do not send until the user restarts automatic sending.
  const campaign = (Array.isArray(item.campaign) ? item.campaign[0] : item.campaign) as { status?: string } | null;
  if (campaign?.status === "paused") return { kind: "idle", reason: "paused_by_user" };

  // One running campaign at a time.
  if (item.campaign_id && campaign?.status !== "running") {
    await supabase.from("campaigns").update({ status: "draft" }).eq("user_id", uid).eq("status", "running");
    const { error } = await supabase.from("campaigns").update({ status: "running", paused_reason: null }).eq("id", item.campaign_id);
    if (error) return { kind: "failed", code: "campaign_conflict" };
  }

  const isMessage = item.action_type === "message";
  const action = isMessage ? "message" : "invitation";
  const messageId = (item.payload as { message_id?: string })?.message_id;
  const [{ data: prospect }, { data: message }] = await Promise.all([
    supabase.from("prospects").select("linkedin_url").eq("id", item.prospect_id).single(),
    supabase.from("messages").select("text").eq("id", messageId ?? "").single(),
  ]);
  const fail = async (code: string) => {
    await supabase.from("action_queue").update({ status: "failed", error: code.slice(0, 200), attempts: (item.attempts ?? 0) + 1 }).eq("id", item.id);
    await logAction(action, "failure", { code, autopilot: true }, { prospect_id: item.prospect_id, linkedin_url: prospect?.linkedin_url });
  };
  if (!prospect || !message) {
    await fail("missing_data");
    return { kind: "failed", code: "missing_data" };
  }
  if (!isMessage && [...message.text].length > noteMax) {
    await fail("note_too_long");
    return { kind: "failed", code: "note_too_long" };
  }

  await navigate(tabId, prospect.linkedin_url);
  await sleep(2500 + Math.random() * 2500);
  const res = await sendToTab(tabId, isMessage ? { type: "SEND_MESSAGE", text: message.text } : { type: "SEND_INVITATION", note: message.text });

  if (res.ok && (res.type === "INVITATION_SENT" || res.type === "MESSAGE_SENT")) {
    await supabase.from("action_queue").update({ status: "done", attempts: (item.attempts ?? 0) + 1 }).eq("id", item.id);
    if (isMessage) {
      await supabase.from("leads").update({ last_action: "followup_1_sent" }).eq("prospect_id", item.prospect_id);
    } else {
      await supabase.from("leads").update({ status: "invitation_sent", last_action: "invitation_sent" }).eq("prospect_id", item.prospect_id);
    }
    await logAction(action, "success", { autopilot: true, campaign_id: item.campaign_id }, { prospect_id: item.prospect_id, linkedin_url: prospect.linkedin_url });
    return { kind: "sent", action, noteLimit: res.type === "INVITATION_SENT" ? res.noteLimit : undefined };
  }
  if (res.ok) return { kind: "failed", code: "unknown" };

  if (res.code === "replied") {
    // The prospect answered in the meantime: stop the sequence, nothing was sent.
    await supabase.from("action_queue").update({ status: "cancelled", error: "replied" }).eq("id", item.id);
    await supabase.rpc("mark_replied", { p_prospects: [item.prospect_id] });
    await logAction("reply_detected", "success", { before_send: true }, { prospect_id: item.prospect_id, linkedin_url: prospect.linkedin_url });
    return { kind: "failed", code: "replied" };
  }
  await fail(res.code);
  if (PAUSE_CODES.has(res.code)) {
    // LinkedIn warning, limit or check: stop everything, the user resumes manually (never worked around).
    if (item.campaign_id) await supabase.from("campaigns").update({ status: "paused", paused_reason: res.code }).eq("id", item.campaign_id);
    await patchState({ pausedReason: res.code });
    await logAction("pause", "skipped", { code: res.code, autopilot: true });
    return { kind: "paused", code: res.code };
  }
  const noteLimit = res.code === "note_too_long" ? Math.max(150, Math.min(300, Number(res.detail) || noteMax)) : undefined;
  return { kind: "failed", code: res.code, noteLimit };
}

// ---------------------------------------------------------------- acceptances & follow-ups

export interface AcceptanceResult {
  accepted: number;
  proposed: number;
  /** Number of connections read on the page (0 = page not readable). */
  found?: number;
  code?: string;
}

/**
 * Reads the most recent connections, marks matching invited leads as accepted and prepares
 * a follow-up message for each (to be reviewed in the dashboard — nothing is sent here).
 */
export async function checkAcceptances(tabId: number, maxProposals = 10): Promise<AcceptanceResult> {
  await navigate(tabId, CONNECTIONS_URL);
  await sleep(2500 + Math.random() * 2000);
  const res = await sendToTab(tabId, { type: "SCRAPE_CONNECTIONS" });
  if (!res.ok) {
    if (PAUSE_CODES.has(res.code)) {
      await patchState({ pausedReason: res.code });
      await logAction("pause", "skipped", { code: res.code, autopilot: true, step: "acceptances" });
    }
    return { accepted: 0, proposed: 0, code: res.code };
  }
  if (res.type !== "CONNECTIONS") return { accepted: 0, proposed: 0, code: "unknown" };
  await logAction("connections_check", "success", { found: res.urls.length });

  const { data: accepted } = await supabase.rpc("mark_accepted", { urls: res.urls });
  const ids = (accepted as string[] | null) ?? [];
  const proposed = await proposeFollowups(maxProposals);
  return { accepted: ids.length, proposed, found: res.urls.length };
}

/** Prepares follow-up #1 for accepted leads that don't have one yet. */
export async function proposeFollowups(max = 10): Promise<number> {
  const uid = await userId();
  const { data: leads } = await supabase
    .from("leads")
    .select("prospect_id")
    .eq("status", "accepted")
    .order("accepted_at", { ascending: true })
    .limit(50);
  let proposed = 0;
  for (const l of leads ?? []) {
    if (proposed >= max) break;
    const { count } = await supabase
      .from("action_queue")
      .select("id", { count: "exact", head: true })
      .eq("prospect_id", l.prospect_id)
      .eq("action_type", "message")
      .eq("payload->>kind", "followup_1")
      .in("status", ["pending", "done"]);
    if ((count ?? 0) > 0) continue;
    try {
      const msg = await generateFollowup(l.prospect_id);
      const { error } = await supabase.from("action_queue").insert({
        user_id: uid,
        prospect_id: l.prospect_id,
        action_type: "message",
        payload: { needs_approval: true, kind: "followup_1", message_id: msg.message_id },
      });
      if (!error) proposed += 1;
    } catch (e) {
      if (e instanceof ApiError && e.message !== "generic") break; // quota / session: stop for now
    }
  }
  return proposed;
}

// ---------------------------------------------------------------- replies & reminders

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Reads the most recent conversations of the inbox. Accepted leads whose conversation's last
 * message is from them are marked "replied" and their pending messages are cancelled.
 */
export async function checkReplies(tabId: number): Promise<{ replied: string[]; code?: string }> {
  const { data: leads } = await supabase
    .from("leads")
    .select("prospect_id, prospect:prospects(full_name)")
    .eq("status", "accepted")
    .limit(500);
  if (!leads?.length) return { replied: [] };

  await navigate(tabId, INBOX_URL);
  await sleep(2500 + Math.random() * 2000);
  const res = await sendToTab(tabId, { type: "SCRAPE_INBOX" });
  if (!res.ok) {
    if (PAUSE_CODES.has(res.code)) {
      await patchState({ pausedReason: res.code });
      await logAction("pause", "skipped", { code: res.code, autopilot: true, step: "replies" });
    }
    return { replied: [], code: res.code };
  }
  if (res.type !== "INBOX") return { replied: [], code: "unknown" };
  await logAction("inbox_check", "success", { found: res.conversations.length });

  const answered = new Set(res.conversations.filter((c) => !c.fromMe).map((c) => norm(c.name)));
  const matches = leads.filter((l) => {
    const p = (Array.isArray(l.prospect) ? l.prospect[0] : l.prospect) as { full_name?: string } | null;
    return p?.full_name && answered.has(norm(p.full_name));
  });
  if (!matches.length) return { replied: [] };
  const { data } = await supabase.rpc("mark_replied", { p_prospects: matches.map((m) => m.prospect_id) });
  const ids = new Set((data as string[] | null) ?? []);
  return {
    replied: matches
      .filter((m) => ids.has(m.prospect_id))
      .map((m) => ((Array.isArray(m.prospect) ? m.prospect[0] : m.prospect) as { full_name?: string }).full_name ?? ""),
  };
}

/**
 * Prepares the next reminder (J+3, J+7, J+14 after the first follow-up, editable) for accepted
 * leads without reply. Reminders are reviewed in the dashboard before being sent.
 */
export async function proposeReminders(settings: Settings, max = 10): Promise<number> {
  const uid = await userId();
  const delays = settings.followup_delays?.length === 3 ? settings.followup_delays : [3, 7, 14];
  const { data: leads } = await supabase.from("leads").select("prospect_id").eq("status", "accepted").limit(200);
  const ids = (leads ?? []).map((l) => l.prospect_id);
  if (!ids.length) return 0;

  const { data: msgs } = await supabase
    .from("action_queue")
    .select("prospect_id, status, payload, updated_at")
    .eq("action_type", "message")
    .in("prospect_id", ids)
    .in("status", ["pending", "done"]);

  let proposed = 0;
  for (const prospectId of ids) {
    if (proposed >= max) break;
    const mine = (msgs ?? []).filter((m) => m.prospect_id === prospectId);
    const kindOf = (m: { payload: unknown }) => (m.payload as { kind?: string })?.kind ?? "";
    if (mine.some((m) => m.status === "pending")) continue; // something already waiting
    const first = mine.find((m) => kindOf(m) === "followup_1" && m.status === "done");
    if (!first) continue; // the sequence starts after the first follow-up is sent
    const sentKinds = new Set(mine.filter((m) => m.status === "done").map(kindOf));
    const next = (["followup_2", "followup_3", "followup_4"] as FollowupKind[]).find((k) => !sentKinds.has(k));
    if (!next) continue; // sequence finished
    const step = ["followup_2", "followup_3", "followup_4"].indexOf(next);
    const due = new Date(first.updated_at).getTime() + delays[step] * 86_400_000;
    if (Date.now() < due) continue;
    try {
      const msg = await generateFollowup(prospectId, next);
      const { error } = await supabase.from("action_queue").insert({
        user_id: uid,
        prospect_id: prospectId,
        action_type: "message",
        payload: { needs_approval: true, kind: next, message_id: msg.message_id },
      });
      if (!error) proposed += 1;
    } catch (e) {
      if (e instanceof ApiError && e.message !== "generic") break;
    }
  }
  return proposed;
}
