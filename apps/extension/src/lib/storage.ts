import type { Mode } from "@kairo/shared";

export interface LocalState {
  activePersonaId?: string;
  mode: Mode;
  /** Per persona: next LinkedIn search page to read and queued candidate URLs. */
  queues: Record<
    string,
    {
      page: number;
      urls: string[];
      exhausted: boolean;
      day: string;
      v?: number;
      sig?: string;
      /** Index of the job title being searched (one title per search). */
      titleIndex?: number;
      /** Industry filter dropped for the current title (it returned nothing). */
      relaxed?: boolean;
      withIndustries?: boolean;
    }
  >;
  pausedReason?: string;
  /** When the current pause started (ms). */
  pausedAt?: number;
  /** Automatic retries after a temporary pause, per day. */
  autoResume?: { day: string; count: number };
  /** Last structural diagnostic (no personal data). */
  lastDiag?: { at: number; step: string; code: string; detail?: string };
  /** Note length limit detected on the user's LinkedIn account (200 free, 300 Premium). */
  noteMaxChars?: number;
}

const DEFAULT: LocalState = { mode: "copilot", queues: {} };

export async function getState(): Promise<LocalState> {
  const { state } = await chrome.storage.local.get("state");
  return { ...DEFAULT, ...(state as Partial<LocalState> | undefined) };
}

export async function patchState(patch: Partial<LocalState>): Promise<LocalState> {
  const next = { ...(await getState()), ...patch };
  await chrome.storage.local.set({ state: next });
  return next;
}

export const today = () => new Date().toISOString().slice(0, 10);
