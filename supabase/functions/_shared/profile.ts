import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { HttpError } from "./errors.ts";

const text = (max: number) => z.string().max(max * 2).transform((s) => s.replace(/\s+/g, " ").trim().slice(0, max));

/** Schema of the profile data scraped by the extension (untrusted input). */
export const ProfileSchema = z.object({
  linkedin_url: z.string().regex(/^https:\/\/www\.linkedin\.com\/in\/[^/?#\s]{1,200}\/$/),
  full_name: text(200),
  first_name: text(100).default(""),
  headline: text(500).default(""),
  company: text(200).default(""),
  location: text(200).default(""),
  about: text(5000).default(""),
  photo_url: z.string().regex(/^https:\/\/[a-z0-9.-]+\.licdn\.com\/\S{1,1000}$/).optional().nullable(),
  experiences: z
    .array(z.object({ title: text(200), company: text(200), dates: text(80).optional(), description: text(800).optional() }))
    .max(10)
    .default([]),
  recent_activity: z.array(text(500)).max(5).default([]),
  connection_state: z.enum(["none", "pending", "connected", "unknown"]).optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export async function parseBody<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T>> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) throw new HttpError(415, "invalid_content_type");
  const raw = await req.text();
  if (raw.length > 100_000) throw new HttpError(413, "payload_too_large");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HttpError(400, "invalid_request");
  const data = parsed.data;
  if (data?.profile && !data.profile.first_name) data.profile.first_name = data.profile.full_name.split(" ")[0] ?? "";
  return data;
}

/** Insert or refresh the prospect row (owned by the token's user); returns its id. */
export async function upsertProspect(
  supabase: SupabaseClient,
  userId: string,
  personaId: string,
  profile: Profile,
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
  if (error) throw new Error(`prospect_upsert_failed: ${error.code}`);
  return data.id;
}
