import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./supabase.ts";
import type { ProfileInput } from "./prompts.ts";

export function parseProfile(raw: unknown): ProfileInput & { photo_url?: string } {
  const p = raw as Record<string, unknown> | null;
  if (!p || typeof p.linkedin_url !== "string" || !/linkedin\.com\/in\//.test(p.linkedin_url)) {
    throw new HttpError(400, "invalid_profile");
  }
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 5000) : "");
  return {
    linkedin_url: p.linkedin_url,
    full_name: str(p.full_name),
    first_name: str(p.first_name) || str(p.full_name).split(" ")[0] || "",
    headline: str(p.headline),
    company: str(p.company),
    location: str(p.location),
    about: str(p.about),
    photo_url: str(p.photo_url) || undefined,
    experiences: Array.isArray(p.experiences) ? (p.experiences as ProfileInput["experiences"]).slice(0, 10) : [],
    recent_activity: Array.isArray(p.recent_activity) ? (p.recent_activity as string[]).slice(0, 5).map(str) : [],
  };
}

/** Insert or refresh the prospect row; returns its id. */
export async function upsertProspect(
  supabase: SupabaseClient,
  userId: string,
  personaId: string,
  profile: ProfileInput & { photo_url?: string },
  extra: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await supabase
    .from("prospects")
    .upsert(
      {
        user_id: userId,
        persona_id: personaId,
        linkedin_url: profile.linkedin_url,
        full_name: profile.full_name,
        first_name: profile.first_name,
        headline: profile.headline,
        company: profile.company,
        location: profile.location,
        about: profile.about,
        photo_url: profile.photo_url ?? null,
        experiences: profile.experiences,
        recent_activity: profile.recent_activity,
        ...extra,
      },
      { onConflict: "user_id,linkedin_url" },
    )
    .select("id")
    .single();
  if (error) throw new HttpError(500, error.message);
  return data.id;
}
