import type { ExternalRequest } from "../lib/protocol";
import { supabase } from "../lib/supabase";
import { patchState } from "../lib/storage";
import { WEB_APP_URL } from "../lib/config";
import { runOnboarding } from "../lib/onboarding";

import { ALARM, scheduleAlarm, tick } from "./sender";
import { patchAuto } from "../lib/autostate";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
// Every time the service worker starts (install, browser start, wake-up): make sure the alarm exists.
void scheduleAlarm();
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) void tick();
});
// Panel asks for an immediate step (e.g. right after switching automatic sending on).
chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg?.type === "AUTOPILOT_TICK") {
    void scheduleAlarm().then(tick);
  }
  if (msg?.type === "CHECK_ACCEPTANCES") {
    // Forces a connections check at the next step (still within working hours and the usual pacing).
    void patchAuto({ lastAcceptCheck: 0, nextAt: undefined }).then(() => scheduleAlarm()).then(tick);
  }
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_HASH = /^[A-Za-z0-9_-]{20,200}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

/** Accepts messages only from the configured web app origin, with a strict shape. */
function validate(msg: unknown, senderUrl?: string): ExternalRequest | null {
  try {
    if (!senderUrl || new URL(senderUrl).origin !== new URL(WEB_APP_URL).origin) return null;
  } catch {
    return null;
  }
  const m = msg as Record<string, unknown> | null;
  if (!m || typeof m.type !== "string") return null;
  if (m.type === "PING") return { type: "PING" };
  if (m.type === "AUTH_TOKEN" && typeof m.email === "string" && EMAIL.test(m.email) && typeof m.token_hash === "string" && TOKEN_HASH.test(m.token_hash)) {
    return { type: "AUTH_TOKEN", email: m.email, token_hash: m.token_hash };
  }
  if (m.type === "SUGGEST_PERSONA") return { type: "SUGGEST_PERSONA" };
  if (m.type === "SET_ACTIVE_PERSONA" && typeof m.personaId === "string" && UUID.test(m.personaId)) {
    return { type: "SET_ACTIVE_PERSONA", personaId: m.personaId };
  }
  return null;
}

/** Messages from the web app (see externally_connectable in the manifest). */
chrome.runtime.onMessageExternal.addListener((raw: unknown, sender, sendResponse) => {
  (async () => {
    const msg = validate(raw, sender.url);
    if (!msg) {
      console.warn(JSON.stringify({ where: "external", reason: "rejected_message" }));
      return { ok: false, error: "invalid_request" };
    }
    switch (msg.type) {
      case "PING":
        return { ok: true };
      case "AUTH_TOKEN": {
        // Exchange the one-time token for the extension's own session.
        let { error } = await supabase.auth.verifyOtp({ token_hash: msg.token_hash, type: "email" });
        if (error) ({ error } = await supabase.auth.verifyOtp({ token_hash: msg.token_hash, type: "magiclink" }));
        if (error) {
          // Local diagnostic only (service worker console): error code, never the token.
          console.warn(JSON.stringify({ where: "AUTH_TOKEN", status: error.status, code: error.code }));
          return { ok: false, error: "auth_failed" };
        }
        await chrome.runtime.sendMessage({ type: "AUTH_CHANGED" }).catch(() => undefined);
        return { ok: true };
      }
      case "SUGGEST_PERSONA": {
        // Visible LinkedIn tab (the user asked for it from the dashboard and can watch it).
        const [existing] = await chrome.tabs.query({ url: "https://www.linkedin.com/*", pinned: false });
        const tab = existing?.id
          ? await chrome.tabs.update(existing.id, { active: true })
          : await chrome.tabs.create({ url: "https://www.linkedin.com/feed/", active: true });
        if (!tab?.id) return { ok: false, error: "no_tab" };
        const r = await runOnboarding(tab.id);
        return r.ok ? { ok: true } : { ok: false, error: r.code };
      }
      case "SET_ACTIVE_PERSONA": {
        // The persona list shown in the panel comes from RLS-filtered queries: an unknown id is ignored there.
        await patchState({ activePersonaId: msg.personaId, pausedReason: undefined });
        await chrome.runtime.sendMessage({ type: "PERSONA_CHANGED" }).catch(() => undefined);
        return { ok: true };
      }
    }
  })().then(sendResponse);
  return true;
});
