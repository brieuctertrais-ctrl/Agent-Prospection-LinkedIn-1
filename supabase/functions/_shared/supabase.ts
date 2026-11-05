import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fromSqlError, HttpError } from "./errors.ts";

/** Supabase client acting as the calling user: every query goes through RLS. */
export async function userClient(req: Request): Promise<{ supabase: SupabaseClient; userId: string }> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "unauthorized");
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  // Identity always comes from the verified token, never from the request body.
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "unauthorized");
  return { supabase, userId: data.user.id };
}

/**
 * Per-IP rate limit. Uses the service role ONLY to call check_rate_limit()
 * (a server-only counter); never to read or write user data.
 */
export async function limitByIp(req: Request, bucket: string, max: number, windowSeconds: number) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_key: `ip:${ip}:${bucket}`.slice(0, 200),
    p_max: max,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error(`rate_limit_check_failed: ${error.code}`);
  if (data !== true) throw new HttpError(429, "rate_limited");
}

/** Reserves one AI call in the user's quota (per minute, per day, plan, global cap). */
export async function consumeAiQuota(supabase: SupabaseClient, kind: "generate" | "score"): Promise<string> {
  const { data, error } = await supabase.rpc("consume_ai_quota", { p_kind: kind });
  if (error) throw fromSqlError(error.message) ?? new Error(`quota_check_failed: ${error.code}`);
  return data as string;
}

export async function recordAiUsage(supabase: SupabaseClient, id: string, usage: { input_tokens: number; output_tokens: number }) {
  await supabase.rpc("record_ai_usage", { p_id: id, p_input: usage.input_tokens, p_output: usage.output_tokens });
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

/** Loads the persona context. RLS guarantees the persona belongs to the caller (else 404). */
export async function loadPersonaContext(supabase: SupabaseClient, userId: string, personaId: string): Promise<PersonaContext> {
  const [persona, pitch, copy, knowledge, profile] = await Promise.all([
    supabase.from("personas").select("*").eq("id", personaId).eq("user_id", userId).maybeSingle(),
    supabase.from("pitches").select("title, description, benefits").eq("persona_id", personaId).maybeSingle(),
    supabase.from("copywriting_settings").select("template, instructions").eq("persona_id", personaId).maybeSingle(),
    supabase.from("knowledge_docs").select("title, content").eq("user_id", userId).order("updated_at", { ascending: false }).limit(10),
    supabase.from("profiles").select("first_name, full_name, locale").eq("id", userId).single(),
  ]);
  if (persona.error || !persona.data) throw new HttpError(404, "persona_not_found");
  return {
    persona: persona.data,
    pitch: pitch.data ?? null,
    copywriting: copy.data ?? null,
    knowledge: knowledge.data ?? [],
    sender: profile.data ?? { first_name: null, full_name: null, locale: "fr" },
  };
}
