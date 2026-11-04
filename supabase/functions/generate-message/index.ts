// POST { persona_id, profile, previous_text? }
// Records the "approve" decision, generates the invitation note with Claude,
// stores the message version and upserts the Lead.
import { corsHeaders, json } from "../_shared/cors.ts";
import { HttpError, loadPersonaContext, userClient } from "../_shared/supabase.ts";
import { complete } from "../_shared/claude.ts";
import { INVITATION_SYSTEM, invitationPrompt } from "../_shared/prompts.ts";
import { parseProfile, upsertProspect } from "../_shared/profile.ts";

const MAX_CHARS = 300;
const MAX_ATTEMPTS = 3;

function cleanup(text: string): string {
  return text.trim().replace(/^["«“]\s*|\s*["»”]$/g, "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { supabase, userId } = await userClient(req);
    const body = await req.json();
    if (typeof body.persona_id !== "string") throw new HttpError(400, "persona_id_required");
    const profile = parseProfile(body.profile);
    const previous = typeof body.previous_text === "string" ? body.previous_text.slice(0, 600) : undefined;

    const ctx = await loadPersonaContext(supabase, userId, body.persona_id);
    const prospectId = await upsertProspect(supabase, userId, body.persona_id, profile);

    await supabase.from("decisions").upsert(
      { user_id: userId, prospect_id: prospectId, persona_id: body.persona_id, decision: "approve" },
      { onConflict: "user_id,prospect_id" },
    );

    // Generate; if over the LinkedIn limit, ask the model to shorten. Never return > 300 chars.
    let text = "";
    let feedback: string | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      text = cleanup(await complete(INVITATION_SYSTEM, invitationPrompt(ctx, profile, previous, feedback)));
      const chars = [...text].length;
      if (chars > 0 && chars <= MAX_CHARS) break;
      feedback = `Ton message fait ${chars} caractères : réécris-le en 260 caractères maximum, en gardant l'élément personnalisé et la question finale.`;
      text = "";
    }
    if (!text) throw new HttpError(422, "message_too_long");

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
    if (msgErr) throw new HttpError(500, msgErr.message);

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
    if (leadErr) throw new HttpError(500, leadErr.message);

    return json({
      prospect_id: prospectId,
      lead_id: lead.id,
      message_id: message.id,
      text,
      chars: [...text].length,
      version,
    });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "unknown_error" }, status);
  }
});
