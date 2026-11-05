import type { ExternalRequest } from "../lib/protocol";
import { supabase } from "../lib/supabase";
import { patchState } from "../lib/storage";
import { WEB_APP_URL } from "../lib/config";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
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
  if (m.type === "SET_ACTIVE_PERSONA" && typeof m.personaId === "string" && UUID.test(m.personaId)) {
    return { type: "SET_ACTIVE_PERSONA", personaId: m.personaId };
  }
  return null;
}

/** Messages from the web app (see externally_connectable in the manifest). */
chrome.runtime.onMessageExternal.addListener((raw: unknown, sender, sendResponse) => {
  (async () => {
    const msg = validate(raw, sender.url);
    if (!msg) return { ok: false, error: "invalid_request" };
    switch (msg.type) {
      case "PING":
        return { ok: true };
      case "AUTH_TOKEN": {
        // Exchange the one-time token for the extension's own session.
        const { error } = await supabase.auth.verifyOtp({ token_hash: msg.token_hash, type: "magiclink" });
        if (error) return { ok: false, error: "auth_failed" };
        await chrome.runtime.sendMessage({ type: "AUTH_CHANGED" }).catch(() => undefined);
        return { ok: true };
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
