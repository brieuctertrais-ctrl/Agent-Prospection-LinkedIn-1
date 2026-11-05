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
import { ApiError, countToday, countWeek, generateMessage, logAction } from "./api";
import { nextProfile, type Settings } from "./engine";
import { patchState } from "./storage";
import { supabase } from "./supabase";
import { navigate, sendToTab } from "./tabs";
import { sleep } from "../linkedin/dom";

const PAUSE_CODES = new Set(["security_check", "limit_reached", "ui_changed"]);

async function userId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new ApiError("unauthorized");
  return data.user.id;
}

// ---------------------------------------------------------------- counts

export async function batchCounts(): Promise<{ toReview: number; approved: number }> {
  const base = () =>
    supabase.from("action_queue").select("id", { count: "exact", head: true }).eq("status", "pending").eq("action_type", "invitation");
  const [a, b] = await Promise.all([
    base().eq("payload->>needs_approval", "true"),
    base().eq("payload->>needs_approval", "false"),
  ]);
  return { toReview: a.count ?? 0, approved: b.count ?? 0 };
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
    const r = await nextProfile(opts.tabId, opts.persona, opts.settings);
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

// ---------------------------------------------------------------- sending

export type SendEnd =
  | "done"
  | "outside_hours"
  | "quota"
  | "paused"
  | "paused_by_user"
  | "stopped"
  | "error";

export interface SendProgress {
  sent: number;
  failed: number;
  waitSeconds?: number;
  noteLimit?: number;
}

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
async function dailyCap(s: Settings): Promise<number> {
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

export async function sendApproved(opts: {
  tabId: number;
  settings: Settings;
  noteMax: number;
  onProgress: (p: SendProgress) => void;
  shouldStop: () => boolean;
}): Promise<{ end: SendEnd; code?: string } & SendProgress> {
  const progress: SendProgress = { sent: 0, failed: 0 };
  let noteMax = opts.noteMax;

  // A previous run that was interrupted may have left a campaign "running" (own rows only; RLS applies too).
  const uid = await userId();
  await supabase.from("campaigns").update({ status: "paused", paused_reason: "interrupted" }).eq("user_id", uid).eq("status", "running");

  let currentCampaign: string | null = null;
  const setCampaign = async (status: string, reason?: string) => {
    if (currentCampaign) await supabase.from("campaigns").update({ status, paused_reason: reason ?? null }).eq("id", currentCampaign);
  };

  for (;;) {
    if (opts.shouldStop()) {
      await setCampaign("paused", "stopped_by_user");
      return { end: "stopped", ...progress };
    }
    if (!inWorkingHours(opts.settings)) {
      await setCampaign("paused", "outside_hours");
      return { end: "outside_hours", ...progress };
    }
    const [day, week, cap] = await Promise.all([countToday("invitation"), countWeek("invitation"), dailyCap(opts.settings)]);
    if (day >= cap || week >= (opts.settings.weekly_invitations ?? 100)) {
      await setCampaign("paused", "quota");
      return { end: "quota", ...progress };
    }

    // Next approved invitation (oldest first).
    const { data: item } = await supabase
      .from("action_queue")
      .select("id, prospect_id, campaign_id, payload, attempts")
      .eq("status", "pending")
      .eq("action_type", "invitation")
      .eq("payload->>needs_approval", "false")
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!item) {
      await setCampaign("finished");
      return { end: "done", ...progress };
    }

    // One running campaign at a time; the user can pause it from the dashboard.
    if (item.campaign_id && item.campaign_id !== currentCampaign) {
      await setCampaign("finished");
      currentCampaign = item.campaign_id;
      const { error } = await supabase.from("campaigns").update({ status: "running", paused_reason: null }).eq("id", currentCampaign);
      if (error) return { end: "error", code: "generic", ...progress };
    } else if (currentCampaign) {
      const { data: c } = await supabase.from("campaigns").select("status").eq("id", currentCampaign).single();
      if (c?.status === "paused") return { end: "paused_by_user", ...progress };
    }

    const messageId = (item.payload as { message_id?: string })?.message_id;
    const [{ data: prospect }, { data: message }] = await Promise.all([
      supabase.from("prospects").select("linkedin_url").eq("id", item.prospect_id).single(),
      supabase.from("messages").select("text").eq("id", messageId ?? "").single(),
    ]);
    const fail = async (code: string) => {
      await supabase.from("action_queue").update({ status: "failed", error: code.slice(0, 200), attempts: (item.attempts ?? 0) + 1 }).eq("id", item.id);
      await logAction("invitation", "failure", { code, autopilot: true }, { prospect_id: item.prospect_id, linkedin_url: prospect?.linkedin_url });
      progress.failed += 1;
      opts.onProgress({ ...progress });
    };
    if (!prospect || !message) {
      await fail("missing_data");
      continue;
    }
    if ([...message.text].length > noteMax) {
      await fail("note_too_long");
      continue;
    }

    await navigate(opts.tabId, prospect.linkedin_url);
    await sleep(2500 + Math.random() * 2500);
    const res = await sendToTab(opts.tabId, { type: "SEND_INVITATION", note: message.text });

    if (res.ok && res.type === "INVITATION_SENT") {
      await supabase.from("action_queue").update({ status: "done", attempts: (item.attempts ?? 0) + 1 }).eq("id", item.id);
      await supabase.from("leads").update({ status: "invitation_sent", last_action: "invitation_sent" }).eq("prospect_id", item.prospect_id);
      await logAction("invitation", "success", { autopilot: true, campaign_id: currentCampaign }, { prospect_id: item.prospect_id, linkedin_url: prospect.linkedin_url });
      progress.sent += 1;
      if (res.noteLimit && res.noteLimit !== noteMax) {
        noteMax = Math.max(150, Math.min(300, res.noteLimit));
        progress.noteLimit = noteMax;
      }
      opts.onProgress({ ...progress });
    } else if (!res.ok) {
      if (res.code === "note_too_long") {
        noteMax = Math.max(150, Math.min(300, Number(res.detail) || noteMax));
        progress.noteLimit = noteMax;
      }
      await fail(res.code);
      if (PAUSE_CODES.has(res.code)) {
        // LinkedIn warning, limit or check: stop everything, the user resumes manually.
        await setCampaign("paused", res.code);
        await patchState({ pausedReason: res.code });
        await logAction("pause", "skipped", { code: res.code, autopilot: true });
        return { end: "paused", code: res.code, ...progress };
      }
    }

    // Human pace between two invitations.
    const min = Math.max(30, opts.settings.min_delay_seconds ?? 45);
    const max = Math.max(min, opts.settings.max_delay_seconds ?? 180);
    let wait = Math.round(min + Math.random() * (max - min));
    while (wait > 0) {
      if (opts.shouldStop()) {
        await setCampaign("paused", "stopped_by_user");
        return { end: "stopped", ...progress };
      }
      opts.onProgress({ ...progress, waitSeconds: wait });
      await sleep(1000);
      wait -= 1;
    }
  }
}
