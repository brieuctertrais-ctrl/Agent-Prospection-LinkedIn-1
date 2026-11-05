// POST { persona_id, profile, previous_text? }
// Records the "approve" decision, generates the invitation note with Claude,
// stores the message version and upserts the Lead.
import { z } from "zod";
import { corsHeaders, json } from "../_shared/cors.ts";
import { errorResponse, HttpError } from "../_shared/errors.ts";
import { consumeAiQuota, limitByIp, loadPersonaContext, recordAiUsage, userClient } from "../_shared/supabase.ts";
import { complete, sanitizeAiText } from "../_shared/claude.ts";
import { invitationPrompt, invitationSystem } from "../_shared/prompts.ts";
import { parseBody, ProfileSchema, upsertProspect } from "../_shared/profile.ts";
import { greetingOk, lastNameOf } from "../_shared/greeting.ts";

const LINKEDIN_MAX = 300; // absolute cap (LinkedIn Premium); free accounts: 200
const MAX_ATTEMPTS = 3;

const BodySchema = z.object({
  persona_id: z.string().uuid(),
  profile: ProfileSchema,
  previous_text: z.string().max(600).optional(),
  // Note limit detected on the user's LinkedIn account (200 free / 300 Premium). Can only lower the cap.
  max_chars: z.number().int().min(150).max(LINKEDIN_MAX).default(LINKEDIN_MAX),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse(new HttpError(405, "method_not_allowed"), "generate-message");
  try {
    await limitByIp(req, "ai", 60, 60);
    const { supabase, userId } = await userClient(req);
    const body = await parseBody(req, BodySchema);
    const { profile } = body;

    // Ownership: the persona is read through RLS and filtered on the token's user id.
    const ctx = await loadPersonaContext(supabase, userId, body.persona_id);
    const prospectId = await upsertProspect(supabase, userId, body.persona_id, profile);

    const { error: decErr } = await supabase.from("decisions").upsert(
      { user_id: userId, prospect_id: prospectId, persona_id: body.persona_id, decision: "approve" },
      { onConflict: "user_id,prospect_id" },
    );
    if (decErr) throw new Error(`decision_failed: ${decErr.code}`);

    // Generate; if over the LinkedIn limit, ask the model to shorten. Never return more than MAX_CHARS.
    const MAX_CHARS = body.max_chars;
    // Each model call consumes one unit of the user's AI quota.
    let text = "";
    let feedback: string | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const usageId = await consumeAiQuota(supabase, "generate");
      const out = await complete(invitationSystem(MAX_CHARS), invitationPrompt(ct, profile, body.previous_tet, feedback));
      await recordAiUsage(supabase, usageId, out.usage);
      text = sanitizeAiText(out.text);
      const chars = [...text].length;
      const lastName = lastNameOf(profile.full_name);
      const greetingValid = greetingOk(text, profile.first_name, lastName);
      if (chars > 0 && chars <= MAX_CHARS && greetingValid) break;
      feedback = !greetingValid && chars > 0
        ? `Le message doit commencer par « Bonjour Monsieur ${lastName}, » ou « Bonjour Madame ${lastName}, » (capitalisation normale du nom). Réécris-le, ${MAX_CHARS - 20} caractères maximum.`
        : `Ton message fait ${chars} caractères : réécris-le en ${MAX_CHARS - 40} caractères maximum, en gardant la formule « Bonjour Monsieur/Madame <Nom>, », l'élément personnalisé et la question finale.`;
      // Retry; on the last attempt a note of valid length is still returned (the user can edit it). Never > MAX_CHARS.
      if (!(chars > 0 && chars <= MAX_CHARS)) text = "";
      else if (attempt < MAX_ATTEMPTS - 1) text = "";
    }
    if (!text) throw new HttpError(422, "generation_failed");

    const { data: last } = await supabase
      .from("messages")
      .select("version")
      .eq("prospect_id", prospectId)
      .eq("kind", "invitation")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (last?.version ?? 0) + 1;

    const { data: message, error: msgErr } = await supabase
      .from("messages")
      .insert({
        user_id: userId,
        prospect_id: prospectId,
        persona_id: body.persona_id,
        kind: "invitation",
        text,
        version,
        regeneration_count: version - 1,
      })
      .select("id")
      .single();
    if (msgErr) throw new Error(`message_insert_failed: ${msgErr.code}`);

    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .upsert(
        {
          user_id: userId,
          prospect_id: prospectId,
          persona_id: body.persona_id,
          message_id: message.id,
          last_action: version === 1 ? "message_generated" : "message_regenerated",
        },
        { onConflict: "user_id,prospect_id" },
      )
      .select("id")
      .single();
    if (leadErr) throw new Error(`lead_upsert_failed: ${leadErr.code}`);

    return json({ prospect_id: prospectId, lead_id: lead.id, message_id: message.id, text, chars: [...text].length, version });
  } catch (e) {
    return errorResponse(e, "generate-message");
  }
});
