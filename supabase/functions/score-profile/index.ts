// POST { persona_id, profile } → { prospect_id, score, reason }
// AI match score between a visited profile and the active Buyer Persona.
import { corsHeaders, json } from "../_shared/cors.ts";
import { HttpError, loadPersonaContext, userClient } from "../_shared/supabase.ts";
import { complete } from "../_shared/claude.ts";
import { SCORE_SYSTEM, scorePrompt } from "../_shared/prompts.ts";
import { parseProfile, upsertProspect } from "../_shared/profile.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { supabase, userId } = await userClient(req);
    const body = await req.json();
    if (typeof body.persona_id !== "string") throw new HttpError(400, "persona_id_required");
    const profile = parseProfile(body.profile);
    const ctx = await loadPersonaContext(supabase, userId, body.persona_id);

    const raw = await complete(SCORE_SYSTEM, scorePrompt(ctx, profile), 1000);
    const match = raw.match(/\{[\s\S]*\}/);
    let score = 50;
    let reason = "";
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
        reason = String(parsed.reason ?? "").slice(0, 300);
      } catch { /* keep neutral score */ }
    }

    const prospectId = await upsertProspect(supabase, userId, body.persona_id, profile, { score, score_reason: reason });
    return json({ prospect_id: prospectId, score, reason });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "unknown_error" }, status);
  }
});
