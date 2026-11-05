/**
 * Background sender: woken up every minute by chrome.alarms, it sends at most one approved
 * invitation per wake-up, then waits a random human delay. Works with the side panel closed,
 * as long as Chrome is open. All safeguards are in sendOne() (hours, quotas, warm-up, LinkedIn warnings).
 */
import { translate, type Locale, type MessageKey } from "@kairo/shared";
import { checkAcceptances, inWorkingHours, nextDelaySeconds, sendOne } from "../lib/autopilot";
import type { Settings } from "../lib/engine";
import { getAuto, patchAuto } from "../lib/autostate";
import { getState, patchState, today } from "../lib/storage";
import { supabase } from "../lib/supabase";
import { sleep } from "../linkedin/dom";

export const ALARM = "efi-autopilot";
const STEP_LOCK_MS = 4 * 60_000;
// Connections page read every hour during working hours. In a background tab LinkedIn only renders
// the ~10 most recent connections (lazy loading is paused while the tab is hidden): checking hourly
// keeps that window large enough (more than 10 new connections in one hour is very unlikely).
const ACCEPT_CHECK_EVERY_MS = 60 * 60_000;

/** Creates the 1-minute alarm only if it does not exist yet (re-creating it would reset its timer). */
export async function scheduleAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(ALARM);
  if (!existing) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
}

async function notify(id: string, key: MessageKey, vars: Record<string, string | number> = {}) {
  const { data: auth } = await supabase.auth.getUser();
  let locale: Locale = "fr";
  if (auth.user) {
    const { data } = await supabase.from("profiles").select("locale").eq("id", auth.user.id).maybeSingle();
    if (data?.locale === "en") locale = "en";
  }
  await chrome.notifications.create(`efi-${id}-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon-128.png"),
    title: "EFI Prospection",
    message: translate(locale, key, vars),
    priority: id === "paused" ? 2 : 0,
  });
}

/** Dedicated pinned, inactive LinkedIn tab (recreated if the user closed it). */
async function workTab(): Promise<number> {
  const auto = await getAuto();
  if (auto.workTabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(auto.workTabId);
      if (tab?.id !== undefined && tab.url?.startsWith("https://www.linkedin.com/")) return tab.id;
    } catch {
      /* closed */
    }
  }
  const tab = await chrome.tabs.create({ url: "https://www.linkedin.com/feed/", active: false, pinned: true });
  await patchAuto({ workTabId: tab.id });
  await sleep(6000);
  return tab.id!;
}

async function loadSettings(): Promise<Settings | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase.from("user_settings").select("*").eq("user_id", auth.user.id).single();
  return (data as Settings | null) ?? null;
}

export async function tick(): Promise<void> {
  let auto = await getAuto();
  if (!auto.enabled) return;
  const now = Date.now();
  if (auto.lockUntil && auto.lockUntil > now) return;
  if (auto.nextAt && auto.nextAt > now) return;

  const state = await getState();
  if (state.pausedReason) return; // stopped after a LinkedIn warning: only the user can resume

  if (auto.day !== today()) auto = await patchAuto({ day: today(), sentToday: 0, failedToday: 0, messagesToday: 0, notified: undefined });
  await patchAuto({ lockUntil: now + STEP_LOCK_MS });

  try {
    const settings = await loadSettings();
    if (!settings) {
      await patchAuto({ enabled: false, last: "unauthorized", lockUntil: undefined });
      return;
    }
    const tabId = await workTab();

    // Every 3 h during working hours: detect accepted invitations and prepare follow-ups.
    if (inWorkingHours(settings) && (!auto.lastAcceptCheck || now - auto.lastAcceptCheck > ACCEPT_CHECK_EVERY_MS)) {
      const a = await checkAcceptances(tabId);
      await patchAuto({
        lastAcceptCheck: Date.now(),
        lastAccepted: a.accepted,
        lastFound: a.found ?? 0,
        lastProposed: a.proposed,
        nextAt: Date.now() + nextDelaySeconds(settings) * 1000,
      });
      if (a.code && ["security_check", "limit_reached", "ui_changed"].includes(a.code)) {
        await patchAuto({ enabled: false, last: "paused", lastCode: a.code, lastAt: Date.now() });
        await notify("paused", "bg.paused", { reason: translate("fr", `send.${a.code}` as MessageKey) });
      } else if (a.accepted > 0 || a.proposed > 0) {
        await notify("accepted", "bg.accepted", { accepted: a.accepted, proposed: a.proposed });
      }
      return;
    }

    const r = await sendOne(tabId, settings, state.noteMaxChars ?? 300);

    if (r.kind === "sent" || r.kind === "failed") {
      if (r.noteLimit) await patchState({ noteMaxChars: r.noteLimit });
      const sent = auto.sentToday + (r.kind === "sent" && r.action === "invitation" ? 1 : 0);
      const messages = (auto.messagesToday ?? 0) + (r.kind === "sent" && r.action === "message" ? 1 : 0);
      const failed = auto.failedToday + (r.kind === "failed" ? 1 : 0);
      await patchAuto({
        sentToday: sent,
        messagesToday: messages,
        failedToday: failed,
        lastAt: Date.now(),
        last: r.kind,
        lastCode: r.kind === "failed" ? r.code : undefined,
        nextAt: Date.now() + nextDelaySeconds(settings) * 1000,
        notified: undefined,
      });
      return;
    }

    if (r.kind === "paused") {
      await patchAuto({ enabled: false, last: "paused", lastCode: r.code, lastAt: Date.now() });
      await notify("paused", "bg.paused", { reason: translate("fr", `send.${r.code}` as MessageKey) });
      return;
    }

    // Idle: nothing to do right now.
    const waitMin = { none: 10, outside_hours: 15, quota: 30, paused_by_user: 0 }[r.reason];
    if (r.reason === "paused_by_user") {
      await patchAuto({ enabled: false, last: "paused_by_user", lastAt: Date.now() });
      await notify("paused_by_user", "bg.pausedByUser");
      return;
    }
    const notifyKey = `${today()}:${r.reason}`;
    await patchAuto({ last: r.reason, nextAt: Date.now() + waitMin * 60_000, notified: notifyKey });
    if (auto.notified !== notifyKey) {
      if (r.reason === "none" && auto.sentToday > 0) await notify("none", "bg.allSent", { n: auto.sentToday });
      if (r.reason === "quota") await notify("quota", "bg.quota", { n: auto.sentToday });
    }
  } catch (e) {
    await patchAuto({ last: "error", lastAt: Date.now(), nextAt: Date.now() + 5 * 60_000 });
    console.warn(JSON.stringify({ where: "background_tick", error: e instanceof Error ? e.name : "unknown" }));
  } finally {
    await patchAuto({ lockUntil: undefined });
  }
}
