import { INDUSTRIES, LOCATIONS } from "./constants.ts";

export interface SearchablePersona {
  job_titles: string[];
  locations: string[];
  industries: string[];
}

const quote = (s: string) => (/\s/.test(s.trim()) ? `"${s.trim()}"` : s.trim());

/**
 * Builds a LinkedIn people-search URL from a Buyer Persona.
 * Company size and keywords are not available as free-search facets: they are
 * used afterwards by the AI match score.
 */
export function buildPeopleSearchUrl(persona: SearchablePersona, page = 1): string {
  const params = new URLSearchParams();
  const titles = persona.job_titles.filter(Boolean);
  const geo: string[] = [];
  const extraKeywords: string[] = [];

  for (const loc of persona.locations) {
    const known = LOCATIONS.find((l) => l.label.toLowerCase() === loc.toLowerCase());
    if (known?.geoUrn) geo.push(known.geoUrn);
    else if (loc.trim()) extraKeywords.push(quote(loc));
  }

  const industryIds = persona.industries
    .map((label) => INDUSTRIES.find((i) => i.label === label)?.id)
    .filter((id): id is string => Boolean(id));

  let keywords = titles.length ? titles.map(quote).join(" OR ") : "";
  if (titles.length > 1) keywords = `(${keywords})`;
  if (extraKeywords.length) keywords = [keywords, ...extraKeywords].filter(Boolean).join(" ");

  if (keywords) params.set("keywords", keywords);
  if (geo.length) params.set("geoUrn", JSON.stringify(geo));
  if (industryIds.length) params.set("industry", JSON.stringify(industryIds));
  params.set("origin", "FACETED_SEARCH");
  if (page > 1) params.set("page", String(page));

  return `https://www.linkedin.com/search/results/people/?${params.toString()}`;
}

/** Normalises a profile URL to https://www.linkedin.com/in/<slug>/ */
export function normalizeProfileUrl(url: string): string | null {
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!m) return null;
  return `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}/`;
}
