import type { SendCode } from "../lib/protocol";
import { deepButton, deepQueryAll, dialogMatches, humanPause, isReallyVisible, isVisible, pageMatches, query, setNativeValue, text, waitFor } from "./dom";
import { findNameElement, findTopCard, nameFromTitle } from "./topcard";
import { WARNING_PATTERNS } from "./selectors";

export type InviteResult = { ok: true; noteLimit?: number; withoutNote?: boolean } | { ok: false; code: SendCode; detail?: string };

export interface InviteOptions {
  /**
   * The note is only a greeting (Settings: "very short note"): if LinkedIn does not let us add it
   * (no note field, monthly limit of personalised invitations…), send the invitation without a note.
   */
  fallbackWithoutNote?: boolean;
}

export function detectAccountWarning(): SendCode | null {
  if (/\/checkpoint\//.test(location.pathname) || pageMatches(WARNING_PATTERNS.securityCheck)) return "security_check";
  if (dialogMatches(WARNING_PATTERNS.weeklyLimit) || dialogMatches(WARNING_PATTERNS.restricted)) return "limit_reached";
  return null;
}

/**
 * Clicks Connect → Add a note → pastes the note → Send, then verifies that the
 * profile switched to "Pending". Never retries or works around LinkedIn limits.
 * An EMPTY note (Settings: "invitations without a note") clicks "Send without a note" instead —
 * the only case where that button is ever used.
 */
export async function sendInvitation(note: string, opts: InviteOptions = {}): Promise<InviteResult> {
  if ([...note].length > 300) return { ok: false, code: "ui_changed", detail: "note_too_long" };

  const warning = detectAccountWarning();
  if (warning) return { ok: false, code: warning };
  const name = nameFromTitle() || text(query("profileName"));
  const nameEl = findNameElement(name);
  if (!name || !nameEl) return { ok: false, code: "ui_changed", detail: "profileName" };
  const card = findTopCard(nameEl);
  if (isPending(card)) return { ok: false, code: "already_connected" };

  // The invitation modal may still be open (note field shown) from a previous attempt: reuse it.
  const withoutNote = !note.trim();
  const reuse = withoutNote ? null : inviteDialog();
  const reuseNote = reuse ? deepQueryAll<HTMLTextAreaElement>("textarea", reuse).find(isReallyVisible) : undefined;
  if (!reuseNote) {
    // 1. Connect (directly, or through the "More" menu) — always the button of THIS profile.
    const connect = await openConnect(card, name);
    if (!connect) return { ok: false, code: "connect_not_found" };
    connect.click();
    await humanPause();

    const dialog = await waitFor(() => inviteDialog(), 6000);
    if (!dialog) {
      // Some layouts send a note-less invitation straight away, without any modal.
      if (withoutNote) return verifySent(name);
      return { ok: false, code: "note_not_found", detail: "dialog" };
    }
    if (dialogMatches(WARNING_PATTERNS.weeklyLimit) || warningIn(dialog, WARNING_PATTERNS.weeklyLimit)) return { ok: false, code: "limit_reached" };

    if (withoutNote) {
      const plain = await waitFor(() => deepButton(inviteDialog() ?? dialog, SEND_WITHOUT_NOTE), 4000);
      if (!plain) return { ok: false, code: "send_not_found", detail: "without_note" };
      plain.click();
      return verifySent(name);
    }

    // 2. Add a note (exact label match: never "Envoyer sans note")
    const addNote = await waitFor(() => deepButton(inviteDialog() ?? dialog, ADD_NOTE) ?? query<HTMLElement>("addNoteButton"), 4000);
    if (!addNote) return { ok: false, code: "note_not_found" };
    addNote.click();
    await humanPause();
  }

  // 3. Paste the note (a textarea, or an editable text box in newer layouts)
  const field = await waitFor(noteField, 5000);
  if (!field) {
    const detail = dialogDiagnostic();
    if (opts.fallbackWithoutNote) return sendWithoutNoteInstead(name, detail);
    const d = inviteDialog();
    if (d && warningIn(d, WARNING_PATTERNS.noteLimit)) return { ok: false, code: "limit_reached", detail: `note_limit ${detail}` };
    return { ok: false, code: "textarea_not_found", detail };
  }
  // LinkedIn's own note limit for this account (200 free / 300 Premium): never try to exceed it.
  const limit = noteLimit(field);
  if (limit && [...note].length > limit) return { ok: false, code: "note_too_long", detail: String(limit) };
  writeNote(field, note);
  await humanPause(600, 1500);

  // 4. Send (exact labels only)
  const send = await waitFor(() => {
    const d = inviteDialog();
    const b = (d && deepButton(d, SEND)) ?? query<HTMLButtonElement>("sendButton", query("dialog") ?? document);
    return b && !(b as HTMLButtonElement).disabled && b.getAttribute("aria-disabled") !== "true" ? b : null;
  }, 4000);
  if (!send) return { ok: false, code: "send_not_found" };
  send.click();
  return verifySent(name, limit ?? undefined);
}

/** Waits for the profile to show "Pending" (or a LinkedIn limit warning). */
async function verifySent(name: string, limit?: number): Promise<InviteResult> {
  const done = await waitFor(() => {
    if (dialogMatches(WARNING_PATTERNS.weeklyLimit) || deepQueryAll<HTMLElement>(DIALOG_SEL).some((d) => warningIn(d, WARNING_PATTERNS.weeklyLimit))) return "limit";
    if (query("pendingButton") || isPending(findTopCard(findNameElement(name)))) return "pending";
    return null;
  }, 8000, 300);
  if (done === "limit") return { ok: false, code: "limit_reached" };
  if (done !== "pending") return { ok: false, code: "not_pending" };
  return { ok: true, noteLimit: limit };
}

/** Connect control of this profile, opening the "More" menu if needed. */
async function openConnect(card: HTMLElement | null, name: string): Promise<HTMLElement | null> {
  let connect = findConnect(card, name);
  if (!connect) {
    const more = findInCard(card, /^(plus|more)$/i, /plus d.actions|more actions/i) ?? query<HTMLElement>("moreButton", card ?? document);
    if (more) {
      more.click();
      await humanPause();
      connect = await waitFor(() => findMenuConnect(name), 3000);
    }
  }
  return connect;
}

/** Visible note field of the invitation modal: textarea or contenteditable text box. */
function noteField(): HTMLElement | null {
  const d = inviteDialog();
  const root: ParentNode = d ?? document;
  const ta = deepQueryAll<HTMLTextAreaElement>("textarea", root).find(isReallyVisible);
  if (ta) return ta;
  if (d) {
    const box = deepQueryAll<HTMLElement>("[contenteditable='true'], [contenteditable=''], [role='textbox']", d).find(isReallyVisible);
    if (box) return box;
  }
  return query<HTMLTextAreaElement>("noteTextarea");
}

function writeNote(field: HTMLElement, note: string) {
  field.focus();
  if (field instanceof HTMLTextAreaElement) {
    setNativeValue(field, note);
    return;
  }
  // Editable box: select its content and type the note (fires the editor's own input events).
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(field);
  sel?.removeAllRanges();
  sel?.addRange(range);
  const typed = document.execCommand?.("insertText", false, note);
  if (!typed || (field.innerText || "").trim() !== note.trim()) {
    field.textContent = note;
    field.dispatchEvent(new InputEvent("input", { bubbles: true, data: note, inputType: "insertText" }));
  }
}

/** Structure of the invitation modal when the note field is missing: counts only, no personal data. */
function dialogDiagnostic(): string {
  const d = inviteDialog();
  const dialogs = deepQueryAll<HTMLElement>(DIALOG_SEL).filter(isReallyVisible);
  const t = d?.innerText ?? "";
  return JSON.stringify({
    invite_dialog: Boolean(d),
    dialogs: dialogs.length,
    textareas: d ? deepQueryAll("textarea", d).length : 0,
    editables: d ? deepQueryAll("[contenteditable], [role='textbox']", d).length : 0,
    buttons: d ? deepQueryAll("button", d).length : 0,
    premium: /premium/i.test(t),
    without_note_button: Boolean(d && deepButton(d, SEND_WITHOUT_NOTE)),
  });
}

/**
 * The greeting-only note could not be added: send the invitation without a note instead
 * ("Send without a note" in the modal, or after reopening it). Only with opts.fallbackWithoutNote.
 */
async function sendWithoutNoteInstead(name: string, detail: string): Promise<InviteResult> {
  let d = inviteDialog();
  let plain = d ? deepButton(d, SEND_WITHOUT_NOTE) : null;
  if (!plain) {
    // Close the modal, reopen it and choose "Send without a note".
    const close = d ? deepButton(d, CLOSE) : null;
    if (close) close.click();
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await humanPause(800, 1500);
    if (inviteDialog()) return { ok: false, code: "textarea_not_found", detail: `fallback_close ${detail}` };
    const connect = await openConnect(findTopCard(findNameElement(name)), name);
    if (!connect) return { ok: false, code: "textarea_not_found", detail: `fallback_connect ${detail}` };
    connect.click();
    await humanPause();
    d = await waitFor(() => inviteDialog(), 6000);
    if (!d) {
      const r = await verifySent(name);
      return r.ok ? { ...r, withoutNote: true } : r;
    }
    plain = await waitFor(() => deepButton(inviteDialog() ?? d!, SEND_WITHOUT_NOTE), 4000);
  }
  if (!plain) return { ok: false, code: "textarea_not_found", detail: `fallback_button ${detail}` };
  plain.click();
  const r = await verifySent(name);
  return r.ok ? { ...r, withoutNote: true } : r;
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
const SEND_WITHOUT_NOTE = ["Envoyer sans note", "Send without a note", "Send without note"];
const CLOSE = ["Ignorer", "Fermer", "Dismiss", "Close", "Annuler", "Cancel"];
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

/** Reads the note length limit from the textarea or the "x/200" counter of the invitation modal. */
function noteLimit(field: HTMLElement): number | null {
  if (field instanceof HTMLTextAreaElement && field.maxLength > 0 && field.maxLength <= 1000) return field.maxLength;
  const d = inviteDialog();
  const m = (d?.innerText ?? "").match(/\b\d{1,3}\s*\/\s*(\d{3})\b/);
  const n = m ? Number(m[1]) : NaN;
  return n >= 100 && n <= 1000 ? n : null;
}
