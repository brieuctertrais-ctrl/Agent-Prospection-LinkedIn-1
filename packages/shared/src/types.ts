import type { LeadStatus } from "./constants.ts";

export type Mode = "copilot" | "autopilot";

export interface Persona {
  id: string;
  user_id: string;
  name: string;
  job_titles: string[];
  locations: string[];
  industries: string[];
  company_sizes: string[];
  keywords: string[];
  formal_address: boolean;
  created_at: string;
  updated_at: string;
}

export interface Pitch {
  persona_id: string;
  title: string;
  description: string;
  benefits: string;
}

export interface CopywritingSettings {
  persona_id: string;
  template: string;
  instructions: string;
}

export interface Experience {
  title: string;
  company: string;
  dates?: string;
  description?: string;
}

/** Data read from a LinkedIn profile page by the extension. */
export interface ScrapedProfile {
  linkedin_url: string;
  full_name: string;
  first_name: string;
  headline: string;
  company: string;
  location: string;
  about: string;
  photo_url?: string;
  experiences: Experience[];
  recent_activity: string[];
  connection_state: "none" | "pending" | "connected" | "unknown";
}

export interface Lead {
  id: string;
  user_id: string;
  prospect_id: string;
  persona_id: string | null;
  message_id: string | null;
  status: LeadStatus;
  last_action: string | null;
  created_at: string;
  updated_at: string;
}

export interface GenerateMessageRequest {
  persona_id: string;
  profile: ScrapedProfile;
  /** When regenerating, the previous text so the model proposes something different. */
  previous_text?: string;
}

export interface GenerateMessageResponse {
  prospect_id: string;
  /** null in "proposal" mode (autopilot batch awaiting review). */
  lead_id: string | null;
  /** null when the invitation is sent without a note (autopilot setting). */
  message_id: string | null;
  text: string;
  chars: number;
  version: number;
}

export interface ScoreProfileResponse {
  prospect_id: string;
  score: number;
  reason: string;
}
