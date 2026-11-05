import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { LEAD_STATUSES, type LeadStatus } from "@kairo/shared";

/** Untrusted query-string filters, validated before use. Invalid values are ignored. */
export const LeadFiltersSchema = z.object({
  persona: z.string().uuid().optional().catch(undefined),
  status: z.enum(LEAD_STATUSES).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
});
export type LeadFilters = z.infer<typeof LeadFiltersSchema>;

export interface LeadRow {
  id: string;
  status: LeadStatus;
  created_at: string;
  persona_name: string | null;
  message_text: string | null;
  full_name: string | null;
  headline: string | null;
  company: string | null;
  location: string | null;
  linkedin_url: string;
  photo_url: string | null;
}

/** Parameterised search (SQL function search_leads, RLS applies: only the caller's leads). */
export async function fetchLeads(supabase: SupabaseClient, f: LeadFilters, limit = 500): Promise<LeadRow[]> {
  const { data, error } = await supabase.rpc("search_leads", {
    p_q: f.q || null,
    p_persona: f.persona ?? null,
    p_status: f.status ?? null,
    p_limit: limit,
  });
  if (error) throw new Error(`search_leads_failed: ${error.code}`);
  return (data ?? []) as LeadRow[];
}

/** Only LinkedIn profile URLs / LinkedIn CDN images are ever rendered as links or images. */
export const safeProfileUrl = (u: string | null) =>
  u && /^https:\/\/www\.linkedin\.com\/in\/[^/?#\s]+\/$/.test(u) ? u : null;
export const safePhotoUrl = (u: string | null) => (u && /^https:\/\/[a-z0-9.-]+\.licdn\.com\//.test(u) ? u : null);
