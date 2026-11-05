// POST { profile, company, industries } → { suggestion }
// Automatic onboarding: from the user's OWN LinkedIn profile and company page, suggests a first
// Buyer Persona + pitch + writing instructions. Nothing is created in `personas`: the suggestion
// is stored in linkedin_profiles_user and pre-fills the persona form, which the user reviews and saves.
import { z } from "zod";
import { corsHeaders, json } from "../_shared/cors.ts";
import { errorResponse, HttpError } from "../_shared/errors.ts";
import { consumeAiQuota, limitByIp, recordAiUsage, userClient } from "../_shared/supabase.ts";
import { complete, sanitizeAiText } from "../_shared/claude.ts";
import { parseBody, ProfileSchema } from "../_shared/profile.ts";
import { formatProfile } from "../_shared/prompts.ts";

const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5000+"];
const str = (max: number) => z.string().max(20_000).transform((s) => s.replace(/\s+/g, " ").trim().slice(0, max));

const BodySchema = z.object({
  profile: ProfileSchema,
  company: z.object({
    url: z.string().regex(/^https:\/\/www\.linkedin\.com\/company\/[^/?#\s]{1,200}\/$/).optional(),
    name: str(200).default(""),
    text: str(4000).default(""),
  }),
  industries: z.array(z.string().max(120)).max(80).default([]),
});

// What the model must return (validated, then clamped to the app's limits).
const SuggestionSchema = z.object({
  persona: z.object({
    name: z.string(),
    job_titles: z.array(z.string()).default([]),
    locations: z.array(z.string()).default([]),
    industries: z.array(z.string()).default([]),
    company_sizes: z.array(z.string()).default([]),
    keywords: z.array(z.string()).default([]),
  }),
  pitch: z.object({ title: z.string(), description: z.string(), benefits: z.string() }),
  copywriting: z.object({ instructions: z.string().default(""), followup_instructions: z.string().default("") }).default({ instructions: "", followup_instructions: "" }),
});

const SYSTEM = `Tu aides un commercial B2B à configurer son outil de prospection LinkedIn.
On te donne SON profil LinkedIn et la page de SON entreprise. Déduis-en ce qu'il vend, puis décris ses CLIENTS CIBLES (pas lui-même) : les personnes qui ont le pouvoir de décision pour acheter son offre.

Réponds UNIQUEMENT avec un objet JSON, sans texte autour, de la forme :
{
  "persona": {
    "name": "surnom court du persona, ex. Décideurs énergie – PME (FR)",
    "job_titles": ["jusqu'à 10 intitulés de poste des décideurs, variantes réellement utilisées sur LinkedIn"],
    "locations": ["pays ou villes, ex. France"],
    "industries": ["secteurs, UNIQUEMENT parmi la liste fournie"],
    "company_sizes": ["parmi : 1-10, 11-50, 51-200, 201-500, 501-1000, 1001-5000, 5000+"],
    "keywords": ["jusqu'à 10 mots-clés à trouver sur le profil d'un bon prospect"]
  },
  "pitch": {
    "title": "nom de l'offre",
    "description": "3 à 5 phrases : ce que fait l'entreprise, pour qui, la cible idéale (taille, secteurs, critères)",
    "benefits": "3 à 5 bénéfices concrets pour le client"
  },
  "copywriting": {
    "instructions": "consignes pour les notes d'invitation : ton, argument principal, appel à l'action",
    "followup_instructions": "consignes pour le message de suivi après acceptation"
  }
}

Règles : en français ; n'invente ni chiffre, ni client, ni certification absents des informations fournies ; si une information manque, reste générique et prudent.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse(new HttpError(405, "method_not_allowed"), "suggest-persona");
  try {
    await limitByIp(req, "ai", 60, 60);
    const { supabase, userId } = await userClient(req);
    const body = await parseBody(req, BodySchema);
    const allowedIndustries = new Set(body.industries);

    const prompt = [
      `## Profil LinkedIn du commercial\n${formatProfile(body.profile)}`,
      `## Page LinkedIn de son entreprise\nNom : ${body.company.name || "(inconnu)"}\n${body.company.text || "(page non lue)"}`,
      `## Liste des secteurs autorisés\n${body.industries.join(" | ") || "(aucune)"}`,
    ].join("\n\n");

    const usageId = await consumeAiQuota(supabase, "generate");
    const out = await complete(SYSTEM, prompt, 4000);
    await recordAiUsage(supabase, usageId, out.usage);

    const match = out.text.match(/\{[\s\S]*\}/);
    if (!match) throw new HttpError(422, "generation_failed");
    let raw: unknown;
    try {
      raw = JSON.parse(match[0]);
    } catch {
      throw new HttpError(422, "generation_failed");
    }
    const parsed = SuggestionSchema.safeParse(raw);
    if (!parsed.success) throw new HttpError(422, "generation_failed");
    const s = parsed.data;
    const clean = (v: string, max: number) => sanitizeAiText(v).slice(0, max);
    const uniq = (a: string[], max: number, len: number) =>
      [...new Set(a.map((x) => clean(x, len).replace(/^#/, "")).filter(Boolean))].slice(0, max);

    const suggestion = {
      persona: {
        name: clean(s.persona.name, 80) || "Mon premier persona",
        job_titles: uniq(s.persona.job_titles, 10, 80),
        locations: uniq(s.persona.locations, 10, 80),
        industries: uniq(s.persona.industries, 15, 120).filter((i) => allowedIndustries.has(i)),
        company_sizes: uniq(s.persona.company_sizes, 7, 20).filter((c) => COMPANY_SIZES.includes(c)),
        keywords: uniq(s.persona.keywords, 10, 60),
      },
      pitch: {
        title: clean(s.pitch.title, 120),
        description: clean(s.pitch.description, 3000),
        benefits: clean(s.pitch.benefits, 3000),
      },
      copywriting: {
        instructions: clean(s.copywriting.instructions, 2000),
        followup_instructions: clean(s.copywriting.followup_instructions, 2000),
      },
    };

    const { error } = await supabase.from("linkedin_profiles_user").insert({
      user_id: userId,
      profile_url: body.profile.linkedin_url,
      company_url: body.company.url ?? null,
      profile_data: { full_name: body.profile.full_name, headline: body.profile.headline, company: body.profile.company, location: body.profile.location },
      company_data: { name: body.company.name, text: body.company.text.slice(0, 4000) },
      suggestion,
      analyzed_at: new Date().toISOString(),
    });
    if (error) throw new Error(`onboarding_insert_failed: ${error.code}`);

    return json({ suggestion });
  } catch (e) {
    return errorResponse(e, "suggest-persona");
  }
});
