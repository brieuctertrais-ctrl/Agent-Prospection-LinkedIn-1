import type { ContentRequest, ContentResponse } from "./protocol";
import { sleep } from "../linkedin/dom";

export async function getLinkedInTab(): Promise<chrome.tabs.Tab | null> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url?.startsWith("https://www.linkedin.com/")) return active;
  const [any] = await chrome.tabs.query({ url: "https://www.linkedin.com/*", currentWindow: true });
  return any ?? null;
}

/** Path the tab must reach (LinkedIn may add a trailing slash or query parameters). */
export function samePage(current: string | undefined, target: string): boolean {
  try {
    const a = new URL(current ?? "");
    const b = new URL(target);
    const strip = (p: string) => p.replace(/\/+$/, "").toLowerCase();
    return a.host === b.host && strip(a.pathname) === strip(b.pathname);
  } catch {
    return false;
  }
}

/**
 * Navigates the tab and resolves once the NEW page has fully loaded.
 * A "complete" event of the previous page (e.g. a messaging page still finishing its load) is
 * ignored: we wait for a load that started after our request AND ended on the requested address.
 */
export function navigate(tabId: number, url: string, timeout = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    let started = false;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const done = (ok: boolean) => {
      clearTimeout(timer);
      clearTimeout(settle);
      chrome.tabs.onUpdated.removeListener(listener);
      if (ok) resolve();
      else reject(new Error("navigation_timeout"));
    };
    const timer = setTimeout(() => done(false), timeout);
    const listener = (id: number, info: { status?: string; url?: string }, tab?: { url?: string }) => {
      if (id !== tabId) return;
      if (info.status === "loading") {
        started = true;
        clearTimeout(settle);
      }
      if (info.status !== "complete" || !started) return;
      if (samePage(tab?.url ?? info.url, url)) return done(true);
      // Loaded somewhere else (LinkedIn redirect: renamed profile, login page…): give a possible
      // further redirect a moment, then let the page checks explain where we are.
      clearTimeout(settle);
      settle = setTimeout(() => done(true), 4000);
    };
    chrome.tabs.onUpdated.addListener(listener);
    void chrome.tabs.update(tabId, { url });
  });
}

/** Sends a message to the content script, waiting for it to be ready. */
export async function sendToTab(tabId: number, req: ContentRequest, retries = 15): Promise<ContentResponse> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = (await chrome.tabs.sendMessage(tabId, req)) as ContentResponse | undefined;
      if (res) return res;
    } catch {
      /* content script not injected yet */
    }
    await sleep(500);
  }
  return { ok: false, code: "unknown", detail: "content_script_unreachable" };
}
