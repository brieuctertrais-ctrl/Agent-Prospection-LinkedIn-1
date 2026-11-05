import { normalizeProfileUrl, type Experience, type ScrapedProfile } from "@kairo/shared";
import { query, queryAll, text } from "./dom";
import { SELECTORS } from "./selectors";
import { findNameElement, findTopCard, linesAfterName, nameFromTitle } from "./topcard";

function sectionByAnchor(key: "aboutSection" | "experienceSection" | "activitySection"): HTMLElement | null {
  const el = query<HTMLElement>(key);
  if (el) return el;
  // Fallback when :has() is unavailable: walk up from the anchor id.
  const id = { aboutSection: "about", experienceSection: "experience", activitySection: "content_collections" }[key];
  return document.getElementById(id)?.closest("section") ?? null;
}

function readAbout(): string {
  const section = sectionByAnchor("aboutSection");
  if (!section) return "";
  for (const css of SELECTORS.aboutText.css) {
    const spans = Array.from(section.querySelectorAll<HTMLElement>(css));
    const longest = spans.map(text).sort((a, b) => b.length - a.length)[0];
    if (longest && longest.length > 20) return longest;
  }
  return "";
}

function readExperiences(): Experience[] {
  const section = sectionByAnchor("experienceSection");
  if (!section) return [];
  const items = queryAll<HTMLElement>("experienceItems", section).slice(0, 6);
  return items
    .map((li): Experience | null => {
      // LinkedIn duplicates visible text in aria-hidden spans: they are the cleanest source.
      const parts = Array.from(li.querySelectorAll<HTMLElement>("span[aria-hidden='true']"))
        .map(text)
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i);
      if (!parts.length) return null;
      const [title = "", companyLine = "", dates = "", ...rest] = parts;
      const description = rest.filter((r) => r.length > 40).join(" ").slice(0, 600);
      return { title, company: companyLine.split("·")[0].trim(), dates, description };
    })
    .filter((e): e is Experience => Boolean(e && e.title));
}

function readActivity(): string[] {
  const section = sectionByAnchor("activitySection");
  if (!section) return [];
  return queryAll<HTMLElement>("activityItems", section)
    .map(text)
    .filter((t) => t.length > 30)
    .slice(0, 3)
    .map((t) => t.slice(0, 400));
}

function connectionState(card: HTMLElement | null): ScrapedProfile["connection_state"] {
  if (query("pendingButton") || (card && /(^|\n)\s*(en attente|pending)\s*(\n|$)/i.test(card.innerText))) return "pending";
  const dist = text(query("distanceBadge"));
  if (/^1/.test(dist)) return "connected";
  if (card && /(^|\n)\s*·?\s*1\s*(er|st)\b/i.test(card.innerText)) return "connected";
  if (dist || card) return "none";
  return "unknown";
}

export function scrapeProfile(): ScrapedProfile | null {
  const url = normalizeProfileUrl(location.href);
  if (!url) return null;
  const titleName = nameFromTitle();
  const nameEl = findNameElement(titleName);
  const full_name = (text(nameEl) || titleName).split("\n")[0].trim();
  if (!full_name) return null;
  const card = findTopCard(nameEl);
  const fallback = linesAfterName(card, full_name);

  const experiences = readExperiences();
  const companyFromButton = text(query("currentCompany")).replace(/^(entreprise actuelle|current company)\s*:?\s*/i, "");
  const photo = query<HTMLImageElement>("profilePhoto")?.src ?? card?.querySelector<HTMLImageElement>("img[src*='licdn.com']")?.src;

  return {
    linkedin_url: url,
    full_name: full_name.slice(0, 200),
    first_name: full_name.split(/\s+/)[0] ?? "",
    headline: text(query("profileHeadline")) || fallback.headline,
    company: companyFromButton || experiences[0]?.company || "",
    location: text(query("profileLocation")) || fallback.location,
    about: readAbout(),
    photo_url: photo && /^https:\/\/[a-z0-9.-]+\.licdn\.com\//.test(photo) ? photo : undefined,
    experiences,
    recent_activity: readActivity(),
    connection_state: connectionState(card),
  };
}

export function scrapeSearchResults(): { urls: string[]; hasNextPage: boolean } {
  const self = normalizeProfileUrl(document.querySelector<HTMLAnchorElement>("a[href*='/in/'].global-nav__primary-link")?.href ?? "");
  const urls = new Set<string>();
  for (const a of queryAll<HTMLAnchorElement>("searchResultLinks")) {
    const u = normalizeProfileUrl(a.href);
    // Skip anonymised "LinkedIn Member" results (ACoAA… ids) and self.
    if (u && u !== self && !/\/in\/acoa/i.test(u)) urls.add(u);
  }
  const next = document.querySelector<HTMLButtonElement>("button.artdeco-pagination__button--next, button[aria-label='Next'], button[aria-label='Suivant']");
  return { urls: [...urls], hasNextPage: Boolean(next && !next.disabled) };
}
