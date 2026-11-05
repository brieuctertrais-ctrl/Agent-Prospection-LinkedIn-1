import type { ContentRequest, ContentResponse } from "../lib/protocol";
import { scrapeProfile, scrapeSearchResults } from "../linkedin/scraper";
import { detectAccountWarning, sendInvitation } from "../linkedin/invite";
import { sleep } from "../linkedin/dom";
import { diagnose } from "../linkedin/topcard";

async function handle(req: ContentRequest): Promise<ContentResponse> {
  switch (req.type) {
    case "PING":
      return { ok: true, type: "PONG", url: location.href };
    case "CHECK_HEALTH": {
      const w = detectAccountWarning();
      return w ? { ok: false, code: w } : { ok: true, type: "HEALTH" };
    }
    case "SCRAPE_PROFILE": {
      const w = detectAccountWarning();
      if (w) return { ok: false, code: w };
      // Scroll down a bit so lazy sections (about, experience, activity) render.
      for (let i = 0; i < 4; i++) {
        window.scrollBy({ top: 700, behavior: "smooth" });
        await sleep(350 + Math.random() * 300);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
      const profile = scrapeProfile();
      return profile ? { ok: true, type: "PROFILE", profile } : { ok: false, code: "ui_changed", detail: diagnose() };
    }
    case "SCRAPE_SEARCH_RESULTS": {
      const w = detectAccountWarning();
      if (w) return { ok: false, code: w };
      for (let i = 0; i < 5; i++) {
        window.scrollBy({ top: 800, behavior: "smooth" });
        await sleep(300 + Math.random() * 300);
      }
      const r = scrapeSearchResults();
      return { ok: true, type: "SEARCH_RESULTS", ...r };
    }
    case "SEND_INVITATION": {
      const r = await sendInvitation(req.note);
      if (r.ok) return { ok: true, type: "INVITATION_SENT" };
      const structural = ["ui_changed", "connect_not_found", "note_not_found", "textarea_not_found", "send_not_found", "not_pending"];
      return { ok: false, code: r.code, detail: structural.includes(r.code) ? `${r.detail ?? ""} ${diagnose()}`.trim() : r.detail };
    }
  }
}

chrome.runtime.onMessage.addListener((req: ContentRequest, _sender, sendResponse) => {
  handle(req)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, code: "unknown", detail: String(e) } satisfies ContentResponse));
  return true; // async response
});
