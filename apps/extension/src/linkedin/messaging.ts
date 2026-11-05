/**
 * LinkedIn messaging: read the connections list (to detect accepted invitations) and send a
 * message to a 1st-degree connection. Never sends to a non-connection (that would be an InMail).
 */
import { normalizeProfileUrl } from "@kairo/shared";
import { deepButton, deepQueryAll, humanPause, isReallyVisible, sleep, text, waitFor } from "./dom";
import { findNameElement, findTopCard, nameFromTitle } from "./topcard";
import { detectAccountWarning } from "./invite";

export const CONNECTIONS_URL = "https://www.linkedin.com/mynetwork/invite-connect/connections/";

/** Profile URLs of the most recent connections (the page lists newest first). */
export async function scrapeConnections(max = 120): Promise<string[]> {
  for (let i = 0; i < 6; i++) {
    window.scrollBy({ top: 900, behavior: "smooth" });
    await sleep(500 + Math.random() * 400);
  }
  const urls = new Set<string>();
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href*='/in/']"))) {
    if (a.closest("nav, header, aside, footer, [role='navigation'], [role='banner']")) continue;
    const u = normalizeProfileUrl(a.href);
    if (u && !/\/in\/acoa/i.test(u)) urls.add(u);
    if (urls.size >= max) break;
  }
  return [...urls];
}

export type MessageResult = { ok: true } | { ok: false; code: string; detail?: string };

function isFirstDegree(card: HTMLElement | null): boolean {
  return Boolean(card && /(^|\n|·)\s*1\s*(er|st)\b/i.test(card.innerText || ""));
}

function composer(): HTMLElement | null {
  const boxes = deepQueryAll<HTMLElement>("[contenteditable='true'][role='textbox'], div.msg-form__contenteditable[contenteditable='true']").filter(isReallyVisible);
  return boxes[boxes.length - 1] ?? null;
}

function composerText(el: HTMLElement): string {
  return (el.innerText || "").replace(/\s+/g, " ").trim();
}

/** Opens the conversation from the profile page, types the text and sends it. */
export async function sendMessage(body: string): Promise<MessageResult> {
  if ([...body].length > 2000) return { ok: false, code: "ui_changed", detail: "message_too_long" };
  const warning = detectAccountWarning();
  if (warning) return { ok: false, code: warning };

  const name = nameFromTitle();
  const nameEl = findNameElement(name);
  if (!name || !nameEl) return { ok: false, code: "ui_changed", detail: "profileName" };
  const card = findTopCard(nameEl);
  // Safeguard: only message 1st-degree connections (otherwise LinkedIn would use a paid InMail).
  if (!isFirstDegree(card)) return { ok: false, code: "not_connected" };

  const btn =
    (card && deepButton(card, ["Message", "Envoyer un message"])) ??
    deepQueryAll<HTMLElement>("button, a").find(
      (b) => isReallyVisible(b) && /^(envoyer un message à|message)\b/i.test(b.getAttribute("aria-label") ?? "") && (b.getAttribute("aria-label") ?? "").toLowerCase().includes(name.split(" ").slice(-1)[0].toLowerCase()),
    ) ??
    null;
  if (!btn) return { ok: false, code: "message_button_not_found" };
  btn.click();
  await humanPause(1200, 2200);

  const box = await waitFor(() => composer(), 8000);
  if (!box) return { ok: false, code: "composer_not_found" };
  if (composerText(box).length > 0) return { ok: false, code: "composer_not_empty" }; // never overwrite a draft
  box.focus();
  await humanPause(400, 900);

  // Insert paragraph by paragraph (Shift+Enter would be needed for line breaks; insertText handles \n).
  const ok = document.execCommand("insertText", false, body);
  if (!ok || composerText(box).length < Math.min(20, body.length)) {
    box.textContent = body;
    box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: body }));
  }
  await humanPause(800, 1600);

  const form = (box.closest("form") as HTMLElement | null) ?? box.closest("[class*='msg-form']") ?? box.parentElement?.parentElement ?? null;
  const send = await waitFor(() => {
    const b =
      (form && deepButton(form, ["Envoyer", "Send"])) ??
      deepQueryAll<HTMLButtonElement>("button.msg-form__send-button, button[type='submit']", form ?? document).find(isReallyVisible) ??
      null;
    return b && !(b as HTMLButtonElement).disabled && b.getAttribute("aria-disabled") !== "true" ? b : null;
  }, 5000);
  if (!send) return { ok: false, code: "send_not_found" };
  send.click();

  // Sent when the composer is emptied.
  const sent = await waitFor(() => {
    const c = composer();
    return !c || composerText(c).length === 0 ? true : null;
  }, 8000, 300);
  if (!sent) return { ok: false, code: "message_not_sent" };
  const w = detectAccountWarning();
  if (w) return { ok: false, code: w };
  return { ok: true };
}

export { text };
