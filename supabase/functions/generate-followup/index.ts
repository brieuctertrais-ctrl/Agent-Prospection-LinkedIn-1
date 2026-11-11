// POST { prospect_id, kind?, previous_text? } → { message_id, text, chars }
// kind "followup_1": first follow-up after an accepted invitation.
// kind "followup_2".."followup_4": reminders #1..#3 (no reply), aware of every message already sent.
// Nothing is sent here: the message is reviewed by the user in the dashboard.
import { z } from "zod";
import { corsHeaders, json } from "../_shared/cors.ts";
import { errorResponse, HttpError } from "../_shared/errors.ts";
import { consumeAiQuota, limitByIp, loadPersonaContext, recordAiUsage, userClient } from "../_shared/supabase.ts";
import { complete, sanitizeAiText } from "../_shared/claude.ts";
import { FOLLOWUP_SYSTEM, followupPrompt, REMINDER_SYSTEM, reminderPrompt } from "../_shared/prompts.ts";
import { parseBody, ProfileSchema } from "../_shared/profile.ts";
import { greetingOk, lastNameOf } from "../_shared/greeting.ts";
import { findTells, polish, tellsFeedback } from "../_shared/humanize.ts";

const MIN_CHARS = 200;
const MAX_CHARS = 1000;
const MAX_ATTEMPTS = 3;

const BodySchema = z.object({
  prospect_id: z.string().uuid(),
  kind: z.enum(["followup_1", "followup_2", "followup_3", "followup_4"]).default("followup_1"),
  previous_text: z.string().max(1500).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse(new HttpError(405, "method_not_allowed"), "generate-followup");
  try {
    await limitByIp(req, "ai", 60, 60);
    const { supabase, userId } = await userClient(req);
    const body = await parseBody(req, BodySchema);

    // Ownership: prospect and lead are read with the caller's rights + explicit user filter.
    const { data: p } = await supabase
      .from("prospects")
      .select("id, persona_id, linkedin_url, full_name, first_name, headline, company, location, about, photo_url, experiences, recent_activity")
      .eq("id", body.prospect_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!p) throw new HttpError(404, "prospect_not_found");
    const { data: lead } = await supabase.from("leads").select("persona_id, status").eq("prospect_id", p.id).eq("user_id", userId).maybeSingle();
    const personaId = lead?.persona_id ?? p.persona_id;
    if (!personaId) throw new HttpError(422, "persona_missing");

    const parsedProfile = ProfileSchema.safeParse({ ...p, photo_url: p.photo_url ?? undefined });
    if (!parsedProfile.success) throw new HttpError(422, "invalid_profile");
    const profile = parsedProfile.data;
    if (!profile.first_name) profile.first_name = profile.full_name.split(" ")[0] ?? "";

    const ctx = await loadPersonaContext(supabase, userId, personaId);
    // Latest version of every message kind already written for this prospect (owned rows only).
    const { data: allMsgs } = await supabase
      .from("messages")
      .select("kind, text, version")
      .eq("prospect_id", p.id)
      .eq("user_id", userId)
      .order("version", { ascending: false });
    const latest = new Map<string, string>();
    for (const m of allMsgs ?? []) if (!latest.has(m.kind)) latest.set(m.kind, m.text);
    const inv = { text: latest.get("invitation") ?? "" };
    const order = ["invitation", "followup_1", "followup_2", "followup_3", "followup_4"];
    const history = order
      .slice(0, order.indexOf(body.kind))
      .filter((k) => latest.has(k))
      .map((k) => ({ kind: k, text: latest.get(k)! }));
    const isReminder = body.kind !== "followup_1";
    const step = order.indexOf(body.kind) - 1; // followup_2 → reminder 1
    const minChars = isReminder ? 120 : MIN_CHARS;
    const maxChars = isReminder ? 600 : MAX_CHARS;

    let text = "";
    let feedback: string | undefined;
    const lastName = lastNameOf(profile.full_name);
    let styleRetried = false; // at most one rewrite for style (each call uses AI quota)
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const usageId = await consumeAiQuota(supabase, "generate");
      const out = isReminder
        ? await complete(REMINDER_SYSTEM, reminderPrompt(ctx, profile, history, step, body.kind === "followup_4", body.previous_text, feedback), 2000)
        : await complete(FOLLOWUP_SYSTEM, followupPrompt(ctx, profile, inv.text, body.previous_text, feedback), 3000);
      await recordAiUsage(supabase, usageId, out.usage);
      text = polish(sanitizeAiText(out.text));
      const chars = [...text].length;
      const ok = chars >= minChars && chars <= maxChars && greetingOk(text, profile.first_name, lastName);
      const tells = findTells(text);
      if (ok && (!tells.length || styleRetried || attempt === MAX_ATTEMPTS - 1)) break;
      if (ok) {
        styleRetried = true;
        feedback = tellsFeedback(tells);
        text = "";
        continue;
      }
      feedback = `Le message doit faire entre ${isReminder ? "200 et 450" : "350 et 800"} caractères (actuellement ${chars}) et commencer par « Bonjour Monsieur ${lastName}, » ou « Bonjour Madame ${lastName}, ». Réécris-le.`;
      if (attempt < MAX_ATTEMPTS - 1 || chars > maxChars || chars < 50) text = "";
    }
    if (!text) throw new HttpError(422, "generation_failed");

    const { data: last } = await supabase
      .from("messages")
      .select("version")
      .eq("prospect_id", p.id)
      .eq("kind", body.kind)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (last?.version ?? 0) + 1;
    const { data: message, error } = await supabase
      .from("messages")
      .insert({ user_id: userId, prospect_id: p.id, persona_id: personaId, kind: body.kind, text, version, regeneration_count: version - 1 })
      .select("id")
      .single();
    if (error) throw new Error(`message_insert_failed: ${error.code}`);

    return json({ message_id: message.id, text, chars: [...text].length });
  } catch (e) {
    return errorResponse(e, "generate-followup");
  }
});
