import { buildPeopleSearchUrl, DEFAULT_QUOTAS, type Persona, type ScrapedProfile } from "@kairo/shared";
import { countToday, logAction, recordLowScore, scoreProfile } from "./api";
import type { SendCode } from "./protocol";
import { getState, patchState, today, type LocalState } from "./storage";
import { supabase } from "./supabase";
import { navigate, sendToTab } from "./tabs";
import { sleep } from "../linkedin/dom";
import { SELECTORS_VERSION } from "../linkedin/selectors";

export interface Settings {
  daily_profile_views: number;
  daily_invitations: number;
  weekly_invitations: number;
  daily_messages?: number;
  followup_delays?: number[];
  min_match_score: number;
  min_delay_seconds?: number;
  max_delay_seconds?: number;
  work_start_hour?: number;
  work_end_hour?: number;
  work_days?: number[];
  timezone?: string;
  autopilot_warning_accepted_at?: string | null;
}

export type NextResult =
  | { kind: "profile"; profile: ScrapedProfile; prospectId?: string; score?: number; reason?: string }
  | { kind: "empty" }
  | { kind: "daily_cap" }
  /** Many profiles visited in a row were set aside (low score, already connected, unreadable). */
  | { kind: "low_match"; skipped: SkipCounts }
  | { kind: "paused"; code: SendCode | string };

const PAUSE_CODES = new Set(["security_check", "limit_reached", "ui_changed"]);
const MAX_AUTO_SKIPS = 15;

export interface SkipCounts {
  lowScore: number;
  connected: number;
  unreadable: number;
}

async function pause(code: string, detail?: string): Promise<NextResult> {
  await patchState({ pausedReason: code });
  await logAction("pause", "skipped", { code, detail, selectors: SELECTORS_VERSION });
  return { kind: "paused", code };
}

const PAGES_PER_TITLE = 10; // then move on to the next job title (fresher, more relevant results)
const PAGES_PER_REFILL = 5;
const QUEUE_VERSION = 3;

type Queue = LocalState["queues"][string];

/** Moves the search cursor: next page, or next job title (with industries, then without as a fallback). */
function advance(queue: Queue, titles: number, emptyPage: boolean) {
  const t = queue.titleIndex ?? 0;
  if (emptyPage && queue.page === 1 && !queue.relaxed && queue.withIndustries) {
    // Nothing at all for this title with the industry filter: retry the title without it.
    queue.relaxed = true;
    return;
  }
  if (emptyPage || queue.page >= PAGES_PER_TITLE) {
    if (t + 1 >= Math.max(1, titles)) {
      queue.exhausted = true;
      return;
    }
    queue.titleIndex = t + 1;
    queue.page = 1;
    queue.relaxed = false;
    return;
  }
  queue.page += 1;
}

/** Fills the candidate queue from the next LinkedIn search results pages. */
async function refillQueue(tabId: number, persona: Persona): Promise<NextResult | null> {
  const state = await getState();
  const q = state.queues[persona.id];
  // Persona criteria changed → the LinkedIn search changed: restart from the first title, page 1.
  const sig = JSON.stringify([persona.job_titles, persona.locations, persona.industries]);
  const criteriaChanged = Boolean(q && q.sig !== sig);
  const keep = q && !criteriaChanged && q.v === QUEUE_VERSION;
  const fresh = !q || q.day !== today() || q.v !== QUEUE_VERSION || criteriaChanged;
  const queue: Queue = fresh
    ? {
        page: keep ? q.page : 1,
        titleIndex: keep ? q.titleIndex : 0,
        relaxed: keep ? q.relaxed : false,
        urls: [],
        exhausted: false,
        day: today(),
        v: QUEUE_VERSION,
        sig,
      }
    : q;
  if (queue.urls.length || queue.exhausted) return null;

  const titles = persona.job_titles.filter(Boolean).length;
  const hasIndustries = persona.industries.length > 0;
  for (let n = 0; n < PAGES_PER_REFILL && !queue.urls.length && !queue.exhausted; n++) {
    queue.withIndustries = hasIndustries && !queue.relaxed;
    const url = buildPeopleSearchUrl(persona, queue.page, {
      titleIndex: titles ? (queue.titleIndex ?? 0) : undefined,
      withIndustries: queue.withIndustries,
    });
    await navigate(tabId, url);
    await sleep(1500 + Math.random() * 1500);
    const res = await sendToTab(tabId, { type: "SCRAPE_SEARCH_RESULTS" });
    if (!res.ok) return PAUSE_CODES.has(res.code) ? pause(res.code, res.detail) : pause("ui_changed", res.detail);
    if (res.type !== "SEARCH_RESULTS") break;
    await logAction("search_page", "success", {
      title_index: queue.titleIndex ?? 0,
      page: queue.page,
      industries: queue.withIndustries,
      found: res.urls.length,
    });

    if (res.urls.length) {
      const { data } = await supabase.rpc("filter_new_profiles", { urls: res.urls });
      queue.urls.push(...((data as string[] | null) ?? []));
    }
    advance(queue, titles, res.urls.length === 0);
  }
  await patchState({ queues: { ...state.queues, [persona.id]: queue } });
  return null;
}

/** Lets the user search again after "no more profiles" (keeps the page position). */
export async function resetQueue(personaId: string): Promise<void> {
  const state = await getState();
  const q = state.queues[personaId];
  if (!q) return;
  await patchState({ queues: { ...state.queues, [personaId]: { ...q, exhausted: false, urls: [], titleIndex: 0, page: 1, relaxed: false } } });
}

async function popUrl(personaId: string): Promise<string | undefined> {
  const state = await getState();
  const q = state.queues[personaId];
  const url = q?.urls.shift();
  if (q) await patchState({ queues: { ...state.queues, [personaId]: q } });
  return url;
}

/**
 * Finds and opens the next recommended profile for the persona, at a human pace.
 * Profiles below the match score are skipped (and never proposed again).
 */
/** Live feedback while searching: each profile set aside, with its score when known. */
export type SkipEvent = { reason: "low_score" | "connected" | "unreadable"; score?: number };

export async function nextProfile(
  tabId: number,
  persona: Persona,
  settings: Settings,
  onSkip?: (e: SkipEvent) => void,
): Promise<NextResult> {
  const skipped: SkipCounts = { lowScore: 0, connected: 0, unreadable: 0 };
  for (let skips = 0; skips < MAX_AUTO_SKIPS; skips++) {
    const views = await countToday("profile_view");
    if (views >= (settings.daily_profile_views ?? DEFAULT_QUOTAS.dailyProfileViews)) return { kind: "daily_cap" };

    const paused = await refillQueue(tabId, persona);
    if (paused) return paused;
    const url = await popUrl(persona.id);
    if (!url) return { kind: "empty" };

    if (skips > 0) await sleep(3000 + Math.random() * 5000); // human pace between visits
    await navigate(tabId, url);
    await sleep(1200 + Math.random() * 1200);
    const res = await sendToTab(tabId, { type: "SCRAPE_PROFILE" });
    if (!res.ok) {
      if (PAUSE_CODES.has(res.code)) return pause(res.code, res.detail);
      await logAction("profile_view", "failure", { code: res.code, detail: res.detail }, { linkedin_url: url });
      skipped.unreadable += 1;
      onSkip?.({ reason: "unreadable" });
      continue;
    }
    if (res.type !== "PROFILE") {
      skipped.unreadable += 1;
      onSkip?.({ reason: "unreadable" });
      continue;
    }
    const profile = res.profile;
    await logAction("profile_view", "success", {}, { linkedin_url: profile.linkedin_url });

    if (profile.connection_state === "connected" || profile.connection_state === "pending") {
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        await supabase.from("exclusion_list").upsert({ user_id: auth.user.id, linkedin_url: profile.linkedin_url, reason: profile.connection_state });
      }
      skipped.connected += 1;
      onSkip?.({ reason: "connected" });
      continue;
    }

    if (settings.min_match_score > 0) {
      try {
        const s = await scoreProfile(persona.id, profile);
        if (s.score < settings.min_match_score) {
          await recordLowScore(persona.id, s.prospect_id);
          await logAction("score", "skipped", { score: s.score, reason: s.reason }, { prospect_id: s.prospect_id, linkedin_url: profile.linkedin_url });
          skipped.lowScore += 1;
          onSkip?.({ reason: "low_score", score: s.score });
          continue;
        }
        return { kind: "profile", profile, prospectId: s.prospect_id, score: s.score, reason: s.reason };
      } catch {
        // Scoring is best-effort: show the profile anyway.
      }
    }
    return { kind: "profile", profile };
  }
  return { kind: "low_match", skipped };
}
