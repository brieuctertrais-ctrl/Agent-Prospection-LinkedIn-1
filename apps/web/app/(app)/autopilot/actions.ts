"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";

const Ids = z.array(z.string().uuid()).max(100);

function fail(where: string, code?: string) {
  console.error(JSON.stringify({ where, code }));
  return { error: "action_failed" as const };
}

/** Approve / reject queue items. review_batch() runs with the caller's rights (RLS). */
export async function reviewBatch(approve: string[], reject: string[]) {
  const a = Ids.safeParse(approve);
  const r = Ids.safeParse(reject);
  if (!a.success || !r.success) return { error: "invalid_request" as const };
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("review_batch", { p_approve: a.data, p_reject: r.data });
  if (error) return fail("review_batch", error.code);
  revalidatePath("/autopilot");
  return {};
}

const EditSchema = z.object({ queueId: z.string().uuid(), text: z.string().trim().min(10).max(1000) });

/** Edit the message of an item that is still pending (owner only). */
export async function updateQueuedMessage(queueId: string, text: string) {
  const parsed = EditSchema.safeParse({ queueId, text });
  if (!parsed.success) return { error: "invalid_request" as const };
  const { supabase, user } = await requireUser();
  const { data: item } = await supabase
    .from("action_queue")
    .select("payload, status, action_type")
    .eq("id", parsed.data.queueId)
    .eq("user_id", user.id)
    .maybeSingle();
  const messageId = (item?.payload as { message_id?: string } | null)?.message_id;
  if (!item || item.status !== "pending" || !messageId) return { error: "not_found" as const };
  // Invitation notes are capped at 300 characters (LinkedIn), follow-up messages at 1000.
  if (item.action_type !== "message" && [...parsed.data.text].length > 300) return { error: "invalid_request" as const };
  const { error } = await supabase
    .from("messages")
    .update({ text: parsed.data.text, edited: true })
    .eq("id", messageId)
    .eq("user_id", user.id);
  if (error) return fail("update_message", error.code);
  revalidatePath("/autopilot");
  return {};
}

/** Cancel one pending item (it will not be sent). Cancelling a message ends the sequence for that person. */
export async function cancelQueueItem(queueId: string) {
  const id = z.string().uuid().safeParse(queueId);
  if (!id.success) return { error: "invalid_request" as const };
  const { supabase, user } = await requireUser();
  const { data: item } = await supabase
    .from("action_queue")
    .select("action_type, prospect_id")
    .eq("id", id.data)
    .eq("user_id", user.id)
    .maybeSingle();
  if (item?.action_type === "message" && item.prospect_id) {
    const { error: stopErr } = await supabase.rpc("stop_sequence", { p_prospects: [item.prospect_id] });
    if (stopErr) return fail("stop_sequence", stopErr.code);
  }
  const { error } = await supabase
    .from("action_queue")
    .update({ status: "cancelled", error: "cancelled_by_user" })
    .eq("id", id.data)
    .eq("user_id", user.id)
    .eq("status", "pending");
  if (error) return fail("cancel_item", error.code);
  revalidatePath("/autopilot");
  return {};
}

/** The person answered on LinkedIn: lead marked "replied", every pending message of the sequence cancelled. */
export async function markReplied(queueId: string) {
  const id = z.string().uuid().safeParse(queueId);
  if (!id.success) return { error: "invalid_request" as const };
  const { supabase, user } = await requireUser();
  const { data: item } = await supabase
    .from("action_queue")
    .select("prospect_id")
    .eq("id", id.data)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!item?.prospect_id) return { error: "not_found" as const };
  const { error } = await supabase.rpc("mark_replied", { p_prospects: [item.prospect_id] });
  if (error) return fail("mark_replied", error.code);
  // Also covers a lead whose status was already changed by hand: nothing is ever proposed again.
  const { error: stopErr } = await supabase.rpc("stop_sequence", { p_prospects: [item.prospect_id] });
  if (stopErr) return fail("stop_sequence", stopErr.code);
  revalidatePath("/autopilot");
  revalidatePath("/leads");
  return {};
}

/** Pause the running campaign: the extension stops before its next invitation. */
export async function pauseCampaign(campaignId: string) {
  const id = z.string().uuid().safeParse(campaignId);
  if (!id.success) return { error: "invalid_request" as const };
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("campaigns")
    .update({ status: "paused", paused_reason: "paused_from_dashboard" })
    .eq("id", id.data)
    .eq("user_id", user.id)
    .eq("status", "running");
  if (error) return fail("pause_campaign", error.code);
  revalidatePath("/autopilot");
  return {};
}

const RegenIds = z.array(z.string().uuid()).min(1).max(20);

/**
 * Rewrites the messages of pending items with the current copywriting instructions.
 * Calls the generate-message Edge Function with the user's own session (quota + RLS apply),
 * then points the queue item to the new message version. Nothing is sent.
 */
export async function regenerateMessages(queueIds: string[]) {
  const ids = RegenIds.safeParse(queueIds);
  if (!ids.success) return { error: "invalid_request" as const, done: 0 };
  const { supabase, user } = await requireUser();

  let done = 0;
  for (const id of ids.data) {
    const { data: item } = await supabase
      .from("action_queue")
      .select("id, status, action_type, payload, prospect_id, campaign:campaigns(persona_id)")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    const campaign = (Array.isArray(item?.campaign) ? item?.campaign[0] : item?.campaign) as { persona_id?: string } | null;
    if (!item || item.status !== "pending" || !item.prospect_id) continue;

    if (item.action_type === "message") {
      // Follow-up message: rewritten from the stored profile by the generate-followup function.
      const kind = (item.payload as { kind?: string } | null)?.kind;
      const { data: gen, error } = await supabase.functions.invoke<{ message_id: string }>("generate-followup", {
        body: { prospect_id: item.prospect_id, kind: ["followup_1", "followup_2", "followup_3", "followup_4"].includes(kind ?? "") ? kind : "followup_1" },
      });
      if (error || !gen?.message_id) {
        const code = (error as { context?: { status?: number } } | null)?.context?.status;
        if (code === 429 || code === 402) return { error: "quota" as const, done };
        console.error(JSON.stringify({ where: "regenerate_followup", status: code ?? null }));
        continue;
      }
      const payload = { ...((item.payload as Record<string, unknown>) ?? {}), message_id: gen.message_id };
      const { error: upErr } = await supabase.from("action_queue").update({ payload }).eq("id", id).eq("user_id", user.id).eq("status", "pending");
      if (!upErr) done += 1;
      continue;
    }
    if (!campaign?.persona_id) continue;
    if ((item.payload as { no_note?: boolean } | null)?.no_note) continue; // invitation without a note: nothing to rewrite

    const { data: p } = await supabase
      .from("prospects")
      .select("linkedin_url, full_name, first_name, headline, company, location, about, photo_url, experiences, recent_activity")
      .eq("id", item.prospect_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!p) continue;

    const { data: s } = await supabase.from("user_settings").select("invitation_note").eq("user_id", user.id).maybeSingle();
    const { data: gen, error } = await supabase.functions.invoke<{ message_id: string }>("generate-message", {
      body: {
        persona_id: campaign.persona_id,
        mode: "proposal",
        style: s?.invitation_note === "short" ? "short" : "full",
        profile: {
          linkedin_url: p.linkedin_url,
          full_name: p.full_name ?? "",
          first_name: p.first_name ?? "",
          headline: p.headline ?? "",
          company: p.company ?? "",
          location: p.location ?? "",
          about: p.about ?? "",
          photo_url: p.photo_url ?? undefined,
          experiences: p.experiences ?? [],
          recent_activity: p.recent_activity ?? [],
        },
      },
    });
    if (error || !gen?.message_id) {
      const code = (error as { context?: { status?: number } } | null)?.context?.status;
      if (code === 429 || code === 402) return { error: "quota" as const, done };
      console.error(JSON.stringify({ where: "regenerate", status: code ?? null }));
      continue;
    }
    const payload = { ...((item.payload as Record<string, unknown>) ?? {}), message_id: gen.message_id };
    const { error: upErr } = await supabase.from("action_queue").update({ payload }).eq("id", id).eq("user_id", user.id).eq("status", "pending");
    if (!upErr) {
      // Already approved items have a lead: keep it pointing to the message that will be sent.
      await supabase.from("leads").update({ message_id: gen.message_id }).eq("prospect_id", item.prospect_id).eq("user_id", user.id);
      done += 1;
    }
  }
  revalidatePath("/autopilot");
  return { done };
}
