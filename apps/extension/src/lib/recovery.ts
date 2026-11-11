/**
 * Self-recovery after a "LinkedIn page not understood" pause.
 *
 *  - Real LinkedIn warnings (security check, invitation limit, restricted account) are NEVER resumed
 *    automatically: only the user can resume (LinkedIn safety, unchanged).
 *  - A page that could not be read (layout change, slow page, logged out of LinkedIn) is often
 *    temporary: the extension retries by itself after 45 min, at most 3 times a day.
 *  - Each pause keeps a small structural diagnostic (no personal data: only which page elements
 *    were found), that the user can copy from the panel so the selectors can be fixed quickly.
 */
import { logAction } from "./api";
import { getState, patchState, today, type LocalState } from "./storage";
import { SELECTORS_VERSION } from "../linkedin/selectors";

export const AUTO_RESUME_CODES = new Set(["ui_changed", "logged_out"]);
export const AUTO_RESUME_AFTER_MS = 45 * 60_000;
export const AUTO_RESUME_MAX_PER_DAY = 3;

export interface Diagnostic {
  at: number;
  /** search | profile | invitation | message | connections | inbox */
  step: string;
  code: string;
  detail?: string;
}

export async function recordPause(code: string, step: string, detail?: string): Promise<void> {
  const diag: Diagnostic = { at: Date.now(), step, code, detail: detail?.slice(0, 600) };
  await patchState({ pausedReason: code, pausedAt: diag.at, lastDiag: diag });
  await logAction("pause", "skipped", { code, step, detail: diag.detail, selectors: SELECTORS_VERSION, build: __BUILD_STAMP__ });
}

/** Keeps a diagnostic for a failure that did not pause anything (e.g. a check that will be retried). */
export async function recordDiagnostic(code: string, step: string, detail?: string): Promise<void> {
  await patchState({ lastDiag: { at: Date.now(), step, code, detail: detail?.slice(0, 600) } });
}

function usedToday(s: LocalState): number {
  return s.autoResume?.day === today() ? s.autoResume.count : 0;
}

/** Time (ms) of the next automatic retry, or null when none is planned (manual resume needed). */
export function nextAutoResume(s: LocalState): number | null {
  if (!s.pausedReason || !AUTO_RESUME_CODES.has(s.pausedReason)) return null;
  if (usedToday(s) >= AUTO_RESUME_MAX_PER_DAY) return null;
  return (s.pausedAt ?? Date.now()) + AUTO_RESUME_AFTER_MS;
}

/** Lifts a temporary pause when its retry time has come. Returns true when it did. */
export async function maybeAutoResume(): Promise<boolean> {
  const s = await getState();
  if (s.pausedReason && !s.pausedAt) {
    // Pause recorded by an older version: start the clock now.
    await patchState({ pausedAt: Date.now() });
    return false;
  }
  const at = nextAutoResume(s);
  if (at === null || Date.now() < at) return false;
  const attempt = usedToday(s) + 1;
  await patchState({ pausedReason: undefined, pausedAt: undefined, autoResume: { day: today(), count: attempt } });
  await logAction("auto_resume", "success", { code: s.pausedReason, attempt });
  return true;
}

/** Text the user copies and sends for support: structural only, no names, no URLs. */
export function diagnosticText(s: LocalState): string {
  return JSON.stringify({
    build: __BUILD_STAMP__,
    selectors: SELECTORS_VERSION,
    paused: s.pausedReason ?? null,
    step: s.lastDiag?.step ?? null,
    code: s.lastDiag?.code ?? null,
    at: s.lastDiag ? new Date(s.lastDiag.at).toISOString() : null,
    detail: s.lastDiag?.detail ?? null,
  });
}
