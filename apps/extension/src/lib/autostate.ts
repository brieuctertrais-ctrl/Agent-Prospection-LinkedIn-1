/** Runtime state of the background sender, kept apart from the panel state (no write conflicts). */
export interface AutoState {
  /** Automatic sending switched on by the user. */
  enabled: boolean;
  /** Dedicated pinned LinkedIn tab used by the background sender. */
  workTabId?: number;
  /** Do nothing before this time (ms) — random human delay between actions. */
  nextAt?: number;
  /** A step is running until this time (ms): prevents overlapping steps. */
  lockUntil?: number;
  day?: string;
  sentToday: number;
  failedToday: number;
  lastAt?: number;
  /** Last outcome, as an i18n key suffix (sent, failed, outside_hours, quota, none, paused, paused_by_user). */
  last?: string;
  lastCode?: string;
  /** Avoid repeating the same notification. */
  notified?: string;
}

const KEY = "autopilot";
const DEFAULT: AutoState = { enabled: false, sentToday: 0, failedToday: 0 };

export async function getAuto(): Promise<AutoState> {
  const { [KEY]: v } = await chrome.storage.local.get(KEY);
  return { ...DEFAULT, ...(v as Partial<AutoState> | undefined) };
}

export async function patchAuto(patch: Partial<AutoState>): Promise<AutoState> {
  const next = { ...(await getAuto()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export function onAutoChange(cb: (s: AutoState) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes[KEY]) cb({ ...DEFAULT, ...(changes[KEY].newValue as Partial<AutoState>) });
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
