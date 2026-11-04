import type { SendCode } from "../lib/protocol";
import { dialogMatches, humanPause, pageMatches, query, setNativeValue, waitFor } from "./dom";
import { WARNING_PATTERNS } from "./selectors";

export type InviteResult = { ok: true } | { ok: false; code: SendCode; detail?: string };

export function detectAccountWarning(): SendCode | null {
  if (/\/checkpoint\//.test(location.pathname) || pageMatches(WARNING_PATTERNS.securityCheck)) return "security_check";
  if (dialogMatches(WARNING_PATTERNS.weeklyLimit) || dialogMatches(WARNING_PATTERNS.restricted)) return "limit_reached";
  return null;
}

/**
 * Clicks Connect → Add a note → pastes the note → Send, then verifies that the
 * profile switched to "Pending". Never retries or works around LinkedIn limits.
 */
export async function sendInvitation(note: string): Promise<InviteResult> {
  if ([...note].length > 300) return { ok: false, code: "ui_changed", detail: "note_too_long" };

  const warning = detectAccountWarning();
  if (warning) return { ok: false, code: warning };
  if (!query("profileName")) return { ok: false, code: "ui_changed", detail: "profileName" };
  if (query("pendingButton")) return { ok: false, code: "already_connected" };

  // 1. Connect (directly, or through the "More" menu)
  let connect = query<HTMLElement>("connectButton", query("topCard") ?? document);
  if (!connect) {
    const more = query<HTMLElement>("moreButton", query("topCard") ?? document);
    if (more) {
      more.click();
      await humanPause();
      connect = await waitFor(() => query<HTMLElement>("dropdownConnect"), 3000);
    }
  }
  if (!connect) return { ok: false, code: "connect_not_found" };
  connect.click();
  await humanPause();

  const dialog = await waitFor(() => query<HTMLElement>("dialog"), 5000);
  if (!dialog) return { ok: false, code: "note_not_found", detail: "dialog" };
  if (dialogMatches(WARNING_PATTERNS.weeklyLimit)) return { ok: false, code: "limit_reached" };

  // 2. Add a note
  const addNote = await waitFor(() => query<HTMLElement>("addNoteButton", dialog), 4000);
  if (!addNote) return { ok: false, code: "note_not_found" };
  addNote.click();
  await humanPause();

  if (dialogMatches(WARNING_PATTERNS.noteLimit) && !query("noteTextarea")) {
    return { ok: false, code: "limit_reached", detail: "note_limit" };
  }

  // 3. Paste the note
  const textarea = await waitFor(() => query<HTMLTextAreaElement>("noteTextarea"), 4000);
  if (!textarea) return { ok: false, code: "textarea_not_found" };
  textarea.focus();
  setNativeValue(textarea, note);
  await humanPause(600, 1500);

  // 4. Send
  const send = await waitFor(() => {
    const b = query<HTMLButtonElement>("sendButton", query("dialog") ?? document);
    return b && !b.disabled ? b : null;
  }, 4000);
  if (!send) return { ok: false, code: "send_not_found" };
  send.click();

  // 5. Verify
  const done = await waitFor(() => {
    if (dialogMatches(WARNING_PATTERNS.weeklyLimit)) return "limit";
    if (query("pendingButton")) return "pending";
    return null;
  }, 8000, 300);
  if (done === "limit") return { ok: false, code: "limit_reached" };
  if (done !== "pending") return { ok: false, code: "not_pending" };
  return { ok: true };
}
