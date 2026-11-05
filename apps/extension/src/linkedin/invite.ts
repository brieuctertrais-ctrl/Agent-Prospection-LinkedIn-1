import type { SendCode } from "../lib/protocol";
import { deepButton, deepQueryAll, dialogMatches, humanPause, isReallyVisible, isVisible, pageMatches, query, setNativeValue, text, waitFor } from "./dom";
import { findNameElement, findTopCard, nameFromTitle } from "./topcard";
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
  const name = nameFromTitle() || text(query("profileName"));
  const nameEl = findNameElement(name);
  if (!name || !nameEl) return { ok: false, code: "ui_changed", detail: "profileName" };
  const card = findTopCard(nameEl);
  if (isPending(card)) return { ok: false, code: "already_connected" };

  // 1. Connect (directly, or through the "More" menu) — always the button of THIS profile.
  let connect = findConnect(card, name);
  if (!connect) {
    const more = findInCard(card, /^(plus|more)$/i, /plus d.actions|more actions/i) ?? query<HTMLElement>("moreButton", card ?? document);
    if (more) {
      more.click();
      await humanPause();
      connect = await waitFor(() => findMenuConnect(name), 3000);
    }
  }
  if (!connect) return { ok: false, code: "connect_not_found" };
  connect.click();
  await humanPause();

  const dialog = await waitFor(() => inviteDialog(), 6000);
  if (!dialog) return { ok: false, code: "note_not_found", detail: "dialog" };
  if (dialogMatches(WARNING_PATTERNS.weeklyLimit) || warningIn(dialog, WARNING_PATTERNS.weeklyLimit)) return { ok: false, code: "limit_reached" };

  // 2. Add a note (exact label match: never "Envoyer sans note")
  const addNote = await waitFor(() => deepButton(inviteDialog() ?? dialog, ADD_NOTE) ?? query<HTMLElement>("addNoteButton"), 4000);
  if (!addNote) return { ok: false, code: "note_not_found" };
  addNote.click();
  await humanPause();

  // 3. Paste the note
  const textarea = await waitFor(() => {
    const d = inviteDialog();
    const t = (d ? deepQueryAll<HTMLTextAreaElement>("textarea", d) : deepQueryAll<HTMLTextAreaElement>("textarea")).find(isReallyVisible);
    return t ?? query<HTMLTextAreaElement>("noteTextarea");
  }, 4000);
  if (!textarea) {
    const d = inviteDialog();
    if (d && warningIn(d, WARNING_PATTERNS.noteLimit)) return { ok: false, code: "limit_reached", detail: "note_limit" };
    return { ok: false, code: "textarea_not_found" };
  }
  textarea.focus();
  setNativeValue(textarea, note);
  await humanPause(600, 1500);

  // 4. Send (exact labels only)
  const send = await waitFor(() => {
    const d = inviteDialog();
    const b = (d && deepButton(d, SEND)) ?? query<HTMLButtonElement>("sendButton", query("dialog") ?? document);
    return b && !(b as HTMLButtonElement).disabled && b.getAttribute("aria-disabled") !== "true" ? b : null;
  }, 4000);
  if (!send) return { ok: false, code: "send_not_found" };
  send.click();

  // 5. Verify
  const done = await waitFor(() => {
    if (dialogMatches(WARNING_PATTERNS.weeklyLimit) || deepQueryAll<HTMLElement>(DIALOG_SEL).some((d) => warningIn(d, WARNING_PATTERNS.weeklyLimit))) return "limit";
    if (query("pendingButton") || isPending(findTopCard(findNameElement(name)))) return "pending";
    return null;
  }, 8000, 300);
  if (done === "limit") return { ok: false, code: "limit_reached" };
  if (done !== "pending") return { ok: false, code: "not_pending" };
  return { ok: true };
}

const lastName = (name: string) => name.trim().split(/\s+/).slice(-1)[0]?.toLowerCase() ?? "";
const INVITE_LABEL = /rejoindre votre réseau|to connect|inviter|invite/i;

function clickables(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("button, a, div[role='button'], [role='menuitem']")).filter(isVisible);
}

/** Connect control of the displayed profile: aria-label naming the person, custom-invite link, or button in the top card. */
function findConnect(card: HTMLElement | null, name: string): HTMLElement | null {
  const ln = lastName(name);
  const scope = card ?? document;
  const byLabel = clickables(document).find((el) => {
    const label = (el.getAttribute("aria-label") ?? "").toLowerCase();
    return INVITE_LABEL.test(label) && ln && label.includes(ln);
  });
  if (byLabel) return byLabel;
  const vanity = location.pathname.split("/")[2] ?? "";
  const byLink = clickables(scope).find((el) => el instanceof HTMLAnchorElement && el.href.includes("custom-invite") && (!vanity || el.href.includes(vanity)));
  if (byLink) return byLink;
  if (card) {
    const byText = clickables(card).find((el) => /^(se connecter|connect)$/i.test(text(el)));
    if (byText) return byText;
  }
  return card ? query<HTMLElement>("connectButton", card) : null;
}

function findInCard(card: HTMLElement | null, textRe: RegExp, labelRe: RegExp): HTMLElement | null {
  if (!card) return null;
  return clickables(card).find((el) => textRe.test(text(el)) || labelRe.test(el.getAttribute("aria-label") ?? "")) ?? null;
}

/** "Se connecter" entry in the opened "More" menu. */
function findMenuConnect(name: string): HTMLElement | null {
  const ln = lastName(name);
  const menus = Array.from(document.querySelectorAll<HTMLElement>("[role='menu'], .artdeco-dropdown__content, [role='listbox']")).filter(isVisible);
  for (const m of menus) {
    const el = clickables(m).find((c) => {
      const label = (c.getAttribute("aria-label") ?? "").toLowerCase();
      return (INVITE_LABEL.test(label) && (!ln || label.includes(ln))) || /^(se connecter|connect)$/i.test(text(c));
    });
    if (el) return el;
  }
  return query<HTMLElement>("dropdownConnect");
}

function isPending(card: HTMLElement | null): boolean {
  if (query("pendingButton")) return true;
  return Boolean(card && clickables(card).some((el) => /^(en attente|pending)$/i.test(text(el)) || /en attente|pending|retirer l.invitation|withdraw/i.test(el.getAttribute("aria-label") ?? "")));
}

const DIALOG_SEL = "[role='dialog'], [role='alertdialog'], dialog[open], .artdeco-modal";
const ADD_NOTE = ["Ajouter une note", "Add a note"];
const SEND = ["Envoyer", "Send", "Envoyer l’invitation", "Envoyer l'invitation", "Send invitation", "Send now", "Envoyer maintenant"];

/** The invitation modal (light DOM or shadow DOM), not another overlay such as messaging. */
function inviteDialog(): HTMLElement | null {
  const dialogs = deepQueryAll<HTMLElement>(DIALOG_SEL).filter(isReallyVisible);
  const isInvite = (d: HTMLElement) =>
    /ajouter une note|add a note|invitation|inviter|invite|personnalis|note/i.test(d.innerText || "") ||
    Boolean(deepQueryAll("textarea", d).length);
  return dialogs.reverse().find(isInvite) ?? null;
}

function warningIn(root: HTMLElement, patterns: RegExp[]): boolean {
  const t = root.innerText || "";
  return patterns.some((p) => p.test(t));
}
