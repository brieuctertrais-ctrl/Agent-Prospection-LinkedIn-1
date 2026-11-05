/**
 * Company pages (used by the automatic onboarding on the user's OWN company only):
 * find the current company link on a profile, and read the visible "About" page.
 */
import { text } from "./dom";
import { findNameElement, findTopCard, nameFromTitle } from "./topcard";

const COMPANY_RE = /^https:\/\/www\.linkedin\.com\/company\/([^/?#\s]+)/i;

export function normalizeCompanyUrl(href: string): string | null {
  const m = href.match(COMPANY_RE);
  return m ? `https://www.linkedin.com/company/${decodeURIComponent(m[1]).toLowerCase()}/` : null;
}

/** Current company of the displayed profile: top card first, then the first experience. */
export function findCompanyUrl(): string | null {
  const card = findTopCard(findNameElement(nameFromTitle()));
  const scopes: ParentNode[] = [card ?? document, document.getElementById("experience")?.closest("section") ?? document];
  for (const scope of scopes) {
    for (const a of Array.from(scope.querySelectorAll<HTMLAnchorElement>("a[href*='/company/']"))) {
      const u = normalizeCompanyUrl(a.href);
      if (u) return u;
    }
  }
  return null;
}

/** Name + visible text of the company "About" page (overview, industry, size, specialties). */
export function scrapeCompany(): { name: string; text: string } {
  const name = (text(document.querySelector("main h1, h1")) || nameFromTitle()).slice(0, 200);
  const main = (document.querySelector("main") as HTMLElement | null) ?? document.body;
  const sections = Array.from(main.querySelectorAll<HTMLElement>("section"));
  const about =
    sections.find((s) => /pr[ée]sentation|overview|à propos|about/i.test(text(s.querySelector("h2, h3")))) ??
    sections.sort((a, b) => text(b).length - text(a).length)[0] ??
    main;
  const body = (about.innerText || "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1 && !/^(suivre|follow|message|voir tout|see all|afficher plus|show more)$/i.test(l))
    .join("\n");
  return { name, text: body.slice(0, 4000) };
}
