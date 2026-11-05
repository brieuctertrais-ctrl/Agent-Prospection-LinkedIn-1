// POST { persona_id, profile } → { prospect_id, score, reason }
// AI match score between a visited profile and the active Buyer Persona.
import { z } from "zod";
import { corsHeaders, json } from "../_shared/cors.ts";
import { errorResponse, HttpError } from "../_shared/errors.ts";
import { consumeAiQuota, limitByIp, loadPersonaContext, recordAiUsage, userClient } from "../_shared/supabase.ts";
import { complete, sanitizeAiText } from "../_shared/claude.ts";
import { SCORE_SYSTEM, scorePrompt } from "../_shared/prompts.ts";
import { parseBody, ProfileSchema, upsertProspect } from "../_shared/profile.ts";

const BodySchema = z.object({ persona_id: z.string().uuid(), profile: ProfileSchema });
const ScoreSchema = z.object({ score: z.coerce.number(), reason: z.string().optional() });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse(new HttpError(405, "method_not_allowed"), "score-profile");
  try {
    await limitByIp(req, "ai", 60, 60);
    const { supabase, userId } = await userClient(req);
    const body = await parseBody(req, BodySchema);
    const ctx = await loadPersonaContext(supabase, userId, body.persona_id);

    const usageId = await consumeAiQuota(supabase, "score");
    const out = await complete(SCORE_SYSTEM, scorePrompt(ctx, body.profile), 1000);
    await recordAiUsage(supabase, usageId, out.usage);

    let score = 50;
    let reason = "";
    const match = out.text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = ScoreSchema.safeParse(JSON.parse(match[0]));
        if (parsed.success) {
          score = Math.max(0, Math.min(100, Math.round(parsed.data.score)));
          reason = sanitizeAiText(parsed.data.reason ?? "").slice(0, 300);
        }
      } catch { /* keep neutral score */ }
    }

    const prospectId = await upsertProspect(supabase, userId, body.persona_id, body.profile, { score, score_reason: reason });
    return json({ prospect_id: prospectId, score, reason });
  } catch (e) {
    return errorResponse(e, "score-profile");
  }
});
