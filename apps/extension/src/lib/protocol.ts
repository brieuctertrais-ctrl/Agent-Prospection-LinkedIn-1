import type { ScrapedProfile } from "@kairo/shared";

/** Messages between the side panel and the LinkedIn content script. */
export type ContentRequest =
  | { type: "PING" }
  | { type: "SCRAPE_PROFILE" }
  | { type: "SCRAPE_SEARCH_RESULTS" }
  | { type: "SEND_INVITATION"; note: string }
  | { type: "CHECK_HEALTH" };

export type SendCode =
  | "connect_not_found"
  | "note_not_found"
  | "textarea_not_found"
  | "send_not_found"
  | "not_pending"
  | "limit_reached"
  | "already_connected"
  | "security_check"
  | "ui_changed"
  | "quota_reached"
  | "note_too_long";

export type ContentResponse =
  | { ok: true; type: "PONG"; url: string }
  | { ok: true; type: "PROFILE"; profile: ScrapedProfile }
  | { ok: true; type: "SEARCH_RESULTS"; urls: string[]; hasNextPage: boolean }
  | { ok: true; type: "INVITATION_SENT" }
  | { ok: true; type: "HEALTH" }
  | { ok: false; code: SendCode | "not_a_profile" | "unknown"; detail?: string };

/** Messages from the web app (externally_connectable) to the background worker. */
export type ExternalRequest =
  | { type: "AUTH_TOKEN"; email: string; token_hash: string }
  | { type: "SET_ACTIVE_PERSONA"; personaId: string }
  | { type: "PING" };
