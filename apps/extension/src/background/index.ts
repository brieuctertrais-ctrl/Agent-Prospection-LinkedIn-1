import type { ExternalRequest } from "../lib/protocol";
import { supabase } from "../lib/supabase";
import { patchState } from "../lib/storage";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

/** Messages from the web app (see externally_connectable in the manifest). */
chrome.runtime.onMessageExternal.addListener((msg: ExternalRequest, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "PING":
        return { ok: true };
      case "AUTH_TOKEN": {
        // Exchange the one-time token for the extension's own session.
        const { error } = await supabase.auth.verifyOtp({ token_hash: msg.token_hash, type: "magiclink" });
        if (error) return { ok: false, error: error.message };
        await chrome.runtime.sendMessage({ type: "AUTH_CHANGED" }).catch(() => undefined);
        return { ok: true };
      }
      case "SET_ACTIVE_PERSONA": {
        await patchState({ activePersonaId: msg.personaId, pausedReason: undefined });
        await chrome.runtime.sendMessage({ type: "PERSONA_CHANGED" }).catch(() => undefined);
        return { ok: true };
      }
      default:
        return { ok: false, error: "unknown_message" };
    }
  })().then(sendResponse);
  return true;
});
