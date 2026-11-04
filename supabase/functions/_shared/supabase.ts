import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Supabase client acting as the calling user (RLS applies). */
export async function userClient(req: Request): Promise<{ supabase: SupabaseClient; userId: string }> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  if (error || !data.user) throw new HttpError(401, "unauthorized");
  return { supabase, userId: data.user.id };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface PersonaContext {
  persona: {
    id: string;
    name: string;
    job_titles: string[];
    locations: string[];
    industries: string[];
    company_sizes: string[];
    keywords: string[];
    formal_address: boolean;
  };
  pitch: { title: string; description: string; benefits: string } | null;
  copywriting: { template: string; instructions: string } | null;
  knowledge: { title: string; content: string }[];
  sender: { first_name: string | null; full_name: string | null; locale: string };
}

export async function loadPersonaContext(
  supabase: SupabaseClient,
  userId: string,
  personaId: string,
): Promise<PersonaContext> {
  const [persona, pitch, copy, knowledge, profile, access] = await Promise.all([
    supabase.from("personas").select("*").eq("id", personaId).single(),
    supabase.from("pitches").select("title, description, benefits").eq("persona_id", personaId).maybeSingle(),
    supabase.from("copywriting_settings").select("template, instructions").eq("persona_id", personaId).maybeSingle(),
    supabase.from("knowledge_docs").select("title, content").order("updated_at", { ascending: false }).limit(10),
    supabase.from("profiles").select("first_name, full_name, locale").eq("id", userId).single(),
    supabase.rpc("has_access"),
  ]);
  if (persona.error || !persona.data) throw new HttpError(404, "persona_not_found");
  if (access.data === false) throw new HttpError(402, "subscription_required");
  return {
    persona: persona.data,
    pitch: pitch.data ?? null,
    copywriting: copy.data ?? null,
    knowledge: knowledge.data ?? [],
    sender: profile.data ?? { first_name: null, full_name: null, locale: "fr" },
  };
}
