/**
 * Robust detection of the profile "top card" (name, headline, location, action buttons)
 * that does not depend on LinkedIn's CSS class names or on a <main> element.
 * Used as a fallback when the CSS selectors of selectors.ts no longer match.
 */
import { isVisible, text } from "./dom";
import { query } from "./dom";

/** "(3) François MATHON | LinkedIn" → "François MATHON" */
export function nameFromTitle(): string {
  const t = document.title.replace(/^\(\d+\+?\)\s*/, "").split("|")[0].trim();
  return t && !/^linkedin$/i.test(t) ? t : "";
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function findNameElement(name: string): HTMLElement | null {
  const byCss = query<HTMLElement>("profileName");
  if (byCss) return byCss;
  if (!name) return null;
  const target = norm(name);
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("h1, h2, a h1, div[role='heading']"))) {
    if (isVisible(el) && norm(text(el)).startsWith(target)) return el;
  }
  return null;
}

const ACTION_LABEL = /^(se connecter|connect|message|plus|more|suivre|follow|en attente|pending)$/i;

/** Smallest ancestor of the name that also contains the profile action buttons. */
export function findTopCard(nameEl: HTMLElement | null): HTMLElement | null {
  const byCss = query<HTMLElement>("topCard");
  if (byCss && (!nameEl || byCss.contains(nameEl))) return byCss;
  let el: HTMLElement | null = nameEl;
  for (let i = 0; el && i < 12; i++) {
    const hasActions = Array.from(el.querySelectorAll<HTMLElement>("button, a")).some((b) =>
      ACTION_LABEL.test(text(b)),
    );
    if (hasActions) return el;
    el = el.parentElement;
  }
  return nameEl?.closest("section") ?? null;
}

const NOISE = [
  /^[·•]/, // "· 2e", "· Coordonnées"
  /^\d+\s*(er|e|ème|nd|rd|th|st)\b/i, // degree badges
  /lemlist|lusha|kaspr|waalaxy|dropcontact/i, // other extensions' badges
  /relations|connections|abonnés|followers|coordonnées|contact info|suivi par|followed by|^\(?(il|elle|he|she|they)/i,
  /^(se connecter|connect|message|plus|more|suivre|follow|en attente|pending|voir|view)\b/i,
];

/** Headline and location read from the visible text lines that follow the name. */
export function linesAfterName(card: HTMLElement | null, name: string): { headline: string; location: string } {
  if (!card) return { headline: "", location: "" };
  const lines = (card.innerText || "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .map((l) => (l.startsWith("·") ? l : l.split(/\s+·\s+/)[0].trim())) // "Lille, France · Coordonnées" → "Lille, France"
    .filter(Boolean);
  const start = lines.findIndex((l) => norm(l).startsWith(norm(name)));
  const rest = lines.slice(start >= 0 ? start + 1 : 0).filter((l) => l.length >= 3 && !NOISE.some((r) => r.test(l)));
  const headline = rest[0] ?? "";
  const location =
    rest.slice(1).find((l) => /,/.test(l) || /france|belgique|suisse|canada|region|région|périphérie|area|metropolitan/i.test(l)) ??
    (rest[1] && rest[1].length <= 80 ? rest[1] : "");
  return { headline: headline.slice(0, 500), location: location.slice(0, 200) };
}

const UNAVAILABLE = [
  /ce profil n.est pas disponible/i,
  /this profile is not available/i,
  /profile (is )?unavailable/i,
  /cette page n.existe pas/i,
  /this page doesn.t exist/i,
  /page (introuvable|not found)/i,
];

/** Kind of page, from the path only (never the full URL: it would identify the person). */
export function pageKind(): string {
  const p = location.pathname;
  if (/^\/in\//.test(p)) return "profile";
  if (/^\/search\//.test(p)) return "search";
  if (/^\/mynetwork\//.test(p)) return "network";
  if (/^\/messaging\//.test(p)) return "messaging";
  if (/^\/company\//.test(p)) return "company";
  if (/^\/(authwall|login|uas\/login|signup|checkpoint\/lg)/.test(p)) return "login";
  if (/^\/checkpoint\//.test(p)) return "checkpoint";
  if (/^\/feed/.test(p)) return "feed";
  return "other";
}

/**
 * Explains why a page could not be read when it is not a layout change:
 * logged out of LinkedIn, or a deleted / private / unavailable profile.
 */
export function pageProblem(): "logged_out" | "profile_unavailable" | null {
  if (pageKind() === "login" || document.querySelector("input[name='session_key'], form.login__form")) return "logged_out";
  const body = document.body?.innerText ?? "";
  if (UNAVAILABLE.some((r) => r.test(body)) && !findNameElement(nameFromTitle())) return "profile_unavailable";
  return null;
}

/** Which key elements are present — structural info only, no personal data. Logged on failures. */
export function diagnose(): string {
  const name = nameFromTitle();
  const nameEl = findNameElement(name);
  const card = findTopCard(nameEl);
  return JSON.stringify({
    page: pageKind(),
    ready: document.readyState,
    title_name: Boolean(name),
    name_css: Boolean(query("profileName")),
    name_el: nameEl ? nameEl.tagName : null,
    has_main: Boolean(document.querySelector("main")),
    top_card: card ? card.tagName : null,
    h1_count: document.querySelectorAll("h1").length,
    connect_links: document.querySelectorAll("a[href*='custom-invite']").length,
    buttons: document.querySelectorAll("button").length,
    dialogs: document.querySelectorAll("[role='dialog']").length,
  });
}

/** "Directeur administratif et financier chez Lessonia" → "Lessonia" */
export function companyFromHeadline(headline: string): string {
  const m = headline.match(/\s(?:chez|at|@)\s+([^|·,]{2,120})/i);
  return m ? m[1].split(/\s[-–]\s/)[0].trim().slice(0, 80) : "";
}
