import type { ContentRequest, ContentResponse } from "./protocol";
import { sleep } from "../linkedin/dom";

export async function getLinkedInTab(): Promise<chrome.tabs.Tab | null> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url?.startsWith("https://www.linkedin.com/")) return active;
  const [any] = await chrome.tabs.query({ url: "https://www.linkedin.com/*", currentWindow: true });
  return any ?? null;
}

/** Navigates the tab and resolves once the page has fully loaded. */
export function navigate(tabId: number, url: string, timeout = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("navigation_timeout"));
    }, timeout);
    const listener = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
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
