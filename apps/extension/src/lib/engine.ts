import { buildPeopleSearchUrl, DEFAULT_QUOTAS, type Persona, type ScrapedProfile } from "@kairo/shared";
import { countToday, logAction, recordLowScore, scoreProfile } from "./api";
import type { SendCode } from "./protocol";
import { getState, patchState, today } from "./storage";
import { supabase } from "./supabase";
import { navigate, sendToTab } from "./tabs";
import { sleep } from "../linkedin/dom";
import { SELECTORS_VERSION } from "../linkedin/selectors";

export interface Settings {
  daily_profile_views: number;
  daily_invitations: number;
  weekly_invitations: number;
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
  | { kind: "paused"; code: SendCode | string };

const PAUSE_CODES = new Set(["security_check", "limit_reached", "ui_changed"]);
const MAX_AUTO_SKIPS = 8;

async function pause(code: string, detail?: string): Promise<NextResult> {
  await patchState({ pausedReason: code });
  await logAction("pause", "skipped", { code, detail, selectors: SELECTORS_VERSION });
  return { kind: "paused", code };
}

const MAX_SEARCH_PAGE = 100; // LinkedIn stops returning people-search results after ~100 pages
const PAGES_PER_REFILL = 5;
const QUEUE_VERSION = 2;

/** Fills the candidate queue from the next LinkedIn search results pages. */
async function refillQueue(tabId: number, persona: Persona): Promise<NextResult | null> {
  const state = await getState();
  const q = state.queues[persona.id];
  const fresh = !q || q.day !== today() || q.v !== QUEUE_VERSION;
  const queue = fresh ? { page: q?.page ?? 1, urls: [] as string[], exhausted: false, day: today(), v: QUEUE_VERSION } : q;
  if (queue.urls.length || queue.exhausted) return null;

  for (let n = 0; n < PAGES_PER_REFILL && !queue.urls.length; n++) {
    if (queue.page > MAX_SEARCH_PAGE) {
      queue.exhausted = true;
      break;
    }
    await navigate(tabId, buildPeopleSearchUrl(persona, queue.page));
    await sleep(1500 + Math.random() * 1500);
    const res = await sendToTab(tabId, { type: "SCRAPE_SEARCH_RESULTS" });
    if (!res.ok) return PAUSE_CODES.has(res.code) ? pause(res.code, res.detail) : pause("ui_changed", res.detail);
    if (res.type !== "SEARCH_RESULTS") break;
    await logAction("search_page", "success", { page: queue.page, found: res.urls.length });

    // Only a page with no profile at all means the end of the results
    // (the "Next" button is not reliable on the current LinkedIn layout).
    if (res.urls.length === 0) {
      queue.exhausted = true;
      break;
    }
    const { data } = await supabase.rpc("filter_new_profiles", { urls: res.urls });
    queue.urls.push(...((data as string[] | null) ?? []));
    queue.page += 1;
  }
  await patchState({ queues: { ...state.queues, [persona.id]: queue } });
  return null;
}

/** Lets the user search again after "no more profiles" (keeps the page position). */
export async function resetQueue(personaId: string): Promise<void> {
  const state = await getState();
  const q = state.queues[personaId];
  if (!q) return;
  await patchState({ queues: { ...state.queues, [personaId]: { ...q, exhausted: false, urls: [], v: QUEUE_VERSION } } });
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
export async function nextProfile(tabId: number, persona: Persona, settings: Settings): Promise<NextResult> {
  for (let skips = 0; skips <= MAX_AUTO_SKIPS; skips++) {
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
      continue;
    }
    if (res.type !== "PROFILE") continue;
    const profile = res.profile;
    await logAction("profile_view", "success", {}, { linkedin_url: profile.linkedin_url });

    if (profile.connection_state === "connected" || profile.connection_state === "pending") {
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        await supabase.from("exclusion_list").upsert({ user_id: auth.user.id, linkedin_url: profile.linkedin_url, reason: profile.connection_state });
      }
      continue;
    }

    if (settings.min_match_score > 0) {
      try {
        const s = await scoreProfile(persona.id, profile);
        if (s.score < settings.min_match_score) {
          await recordLowScore(persona.id, s.prospect_id);
          await logAction("score", "skipped", { score: s.score, reason: s.reason }, { prospect_id: s.prospect_id, linkedin_url: profile.linkedin_url });
          continue;
        }
        return { kind: "profile", profile, prospectId: s.prospect_id, score: s.score, reason: s.reason };
      } catch {
        // Scoring is best-effort: show the profile anyway.
      }
    }
    return { kind: "profile", profile };
  }
  return { kind: "empty" };
}
