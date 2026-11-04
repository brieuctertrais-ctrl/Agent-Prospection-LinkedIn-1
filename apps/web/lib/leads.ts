import type { SupabaseClient } from "@supabase/supabase-js";
import { LEAD_STATUSES } from "@kairo/shared";

export interface LeadFilters {
  persona?: string;
  status?: string;
  q?: string;
}

export interface LeadRow {
  id: string;
  status: (typeof LEAD_STATUSES)[number];
  created_at: string;
  persona: { name: string } | null;
  message: { text: string } | null;
  prospect: {
    full_name: string | null;
    headline: string | null;
    company: string | null;
    location: string | null;
    linkedin_url: string;
    photo_url: string | null;
  };
}

export async function fetchLeads(supabase: SupabaseClient, f: LeadFilters, limit = 500): Promise<LeadRow[]> {
  let query = supabase
    .from("leads")
    .select(
      "id, status, created_at, persona:personas(name), message:messages(text), prospect:prospects!inner(full_name, headline, company, location, linkedin_url, photo_url)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (f.persona) query = query.eq("persona_id", f.persona);
  if (f.status && (LEAD_STATUSES as readonly string[]).includes(f.status)) query = query.eq("status", f.status);
  if (f.q) {
    const q = f.q.replace(/[%,()]/g, " ").trim();
    if (q) query = query.or(`full_name.ilike.%${q}%,company.ilike.%${q}%,headline.ilike.%${q}%`, { referencedTable: "prospects" });
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as LeadRow[];
}
