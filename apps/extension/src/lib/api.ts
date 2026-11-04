import type { GenerateMessageResponse, ScoreProfileResponse, ScrapedProfile } from "@kairo/shared";
import { supabase } from "./supabase";

async function invoke<T>(fn: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(fn, { body: body as Record<string, unknown> });
  if (error) {
    let message = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) message = (await ctx.json()).error ?? message;
    } catch {
      /* keep message */
    }
    throw new Error(message);
  }
  return data as T;
}

export const generateMessage = (persona_id: string, profile: ScrapedProfile, previous_text?: string) =>
  invoke<GenerateMessageResponse>("generate-message", { persona_id, profile, previous_text });

export const scoreProfile = (persona_id: string, profile: ScrapedProfile) =>
  invoke<ScoreProfileResponse>("score-profile", { persona_id, profile });

export async function logAction(
  action_type: string,
  result: "success" | "failure" | "skipped",
  details: Record<string, unknown> = {},
  extra: { prospect_id?: string; linkedin_url?: string } = {},
) {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  await supabase.from("action_logs").insert({ user_id: data.user.id, action_type, result, details, ...extra });
}

export async function countToday(action: string): Promise<number> {
  const { data } = await supabase.rpc("count_actions_today", { p_action: action });
  return (data as number | null) ?? 0;
}

export async function countWeek(action: string): Promise<number> {
  const { data } = await supabase.rpc("count_actions_week", { p_action: action });
  return (data as number | null) ?? 0;
}

/** Marks a profile as rejected: never proposed again. */
export async function rejectProfile(persona_id: string, profile: ScrapedProfile, prospectId?: string) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("unauthorized");
  let id = prospectId;
  if (!id) {
    const { data, error } = await supabase
      .from("prospects")
      .upsert(
        { user_id: auth.user.id, persona_id, linkedin_url: profile.linkedin_url, full_name: profile.full_name, first_name: profile.first_name, headline: profile.headline, company: profile.company, location: profile.location },
        { onConflict: "user_id,linkedin_url" },
      )
      .select("id")
      .single();
    if (error) throw error;
    id = data.id;
  }
  await supabase.from("decisions").upsert(
    { user_id: auth.user.id, prospect_id: id, persona_id, decision: "reject" },
    { onConflict: "user_id,prospect_id" },
  );
}

export async function recordLowScore(persona_id: string, prospect_id: string) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;
  await supabase.from("decisions").upsert(
    { user_id: auth.user.id, prospect_id, persona_id, decision: "skip_low_score" },
    { onConflict: "user_id,prospect_id" },
  );
}

export async function saveEditedMessage(messageId: string, text: string) {
  await supabase.from("messages").update({ text, edited: true }).eq("id", messageId);
}

export async function markInvitationSent(leadId: string, prospectId: string, linkedinUrl: string) {
  await supabase.from("leads").update({ status: "invitation_sent", last_action: "invitation_sent" }).eq("id", leadId);
  await logAction("invitation", "success", {}, { prospect_id: prospectId, linkedin_url: linkedinUrl });
}
