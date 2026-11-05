import type { PersonaContext } from "./supabase.ts";
import type { Profile as ProfileInput } from "./profile.ts";
import { lastNameOf } from "./greeting.ts";

const clip = (s: string | undefined | null, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function formatProfile(p: ProfileInput): string {
  const exps = p.experiences
    .slice(0, 5)
    .map((e) => `- ${clip(e.title, 120)} @ ${clip(e.company, 80)}${e.dates ? ` (${clip(e.dates, 40)})` : ""}${e.description ? `\n  ${clip(e.description, 400)}` : ""}`)
    .join("\n");
  const activity = p.recent_activity.slice(0, 3).map((a) => `- ${clip(a, 300)}`).join("\n");
  return [
    `Nom : ${clip(p.full_name, 100)}`,
    `Prénom : ${clip(p.first_name, 50)}`,
    `Nom de famille : ${clip(lastNameOf(p.full_name), 80) || "(inconnu)"}`,
    `Titre : ${clip(p.headline, 220)}`,
    `Entreprise actuelle : ${clip(p.company, 100)}`,
    `Localisation : ${clip(p.location, 100)}`,
    `Résumé : ${clip(p.about, 1200) || "(vide)"}`,
    `Expériences :\n${exps || "(aucune)"}`,
    `Activité récente :\n${activity || "(aucune)"}`,
  ].join("\n");
}

function formatOffer(ctx: PersonaContext): string {
  const knowledge = ctx.knowledge
    .map((k) => `### ${k.title}\n${clip(k.content, 2000)}`)
    .join("\n\n")
    .slice(0, 6000);
  return [
    `Offre : ${ctx.pitch?.title || "(non renseignée)"}`,
    `Description : ${ctx.pitch?.description || "(non renseignée)"}`,
    `Bénéfices : ${ctx.pitch?.benefits || "(non renseignés)"}`,
    knowledge ? `Base de connaissances :\n${knowledge}` : "",
  ].filter(Boolean).join("\n");
}

export const invitationSystem = (max: number) => `Tu es un expert en prospection B2B sur LinkedIn. Tu rédiges des notes d'invitation LinkedIn ultra-personnalisées pour le compte d'un commercial.

Règles impératives :
1. ${max} caractères maximum, espaces compris (limite LinkedIn du compte de l'utilisateur). Utilise bien la place : vise ${Math.round(max * 0.8)} à ${max - 10} caractères, sans remplissage.
2. Commence exactement par « Bonjour Monsieur <Nom>, » ou « Bonjour Madame <Nom>, » (Nom = nom de famille, avec une capitalisation normale : « Besson » et non « BESSON », « de La Tour »). Déduis la civilité du prénom. Si le prénom est mixte ou si tu as un doute (ex. Camille, Dominique, Claude), écris « Bonjour <Prénom> <Nom>, ». En anglais : « Hello Mr <Name>, » / « Hello Ms <Name>, ». N'utilise jamais le prénom seul.
3. Vouvoiement par défaut, sauf si l'on t'indique le tutoiement.
4. Cite au moins UN élément spécifique et vérifiable tiré du profil : poste actuel, entreprise, activité de l'entreprise, une expérience, ou une publication récente. N'invente jamais rien qui ne figure pas dans le profil.
5. Fais le lien logique entre ce contexte et l'offre, et mets en avant l'argument différenciant de l'offre (ce qui la distingue, tel que décrit dans l'offre et les instructions). Sois percutant : un enjeu concret pour le prospect (coût, budget, risque, échéance), un bénéfice clair, des verbes d'action.
6. Termine par UNE seule question / appel à l'action.
7. Respecte le modèle et les instructions de rédaction de l'utilisateur s'ils existent (ils priment sur le style, jamais sur la limite de ${max} caractères).
8. Pas de formules creuses (« j'espère que vous allez bien », « je me permets »…), pas d'emoji sauf instruction contraire, pas de signature, pas de guillemets autour du message.

Exemples du ton attendu :
- Bonjour Monsieur Benali, en tant que Business Developer chez CashNow, je pense que vous seriez intéressé par notre assistant IA de prospection. Seriez-vous partant pour un test gratuit en échange de vos retours ?
- Bonjour Madame Martin, je vois que vous êtes chez Arto, une entreprise qui offre une seconde vie au matériel informatique, ce qui est passionnant. Seriez-vous intéressé pour essayer gratuitement notre assistant IA de prospection ?

Réponds UNIQUEMENT avec le texte du message, sans aucun commentaire.`;

export function invitationPrompt(ctx: PersonaContext, profile: ProfileInput, previous?: string, feedback?: string): string {
  return [
    `## Expéditeur\n${ctx.sender.full_name || ctx.sender.first_name || "(inconnu)"}`,
    `## Persona ciblé : ${ctx.persona.name}\nAdresse : ${ctx.persona.formal_address ? "vouvoiement" : "tutoiement"}`,
    `## Offre\n${formatOffer(ctx)}`,
    ctx.copywriting?.template ? `## Modèle de message à suivre\n${clip(ctx.copywriting.template, 1500)}` : "",
    ctx.copywriting?.instructions ? `## Instructions de rédaction\n${clip(ctx.copywriting.instructions, 1500)}` : "",
    `## Profil du prospect\n${formatProfile(profile)}`,
    previous ? `## Message précédent (propose une version nettement différente)\n${previous}` : "",
    feedback ? `## Correction demandée\n${feedback}` : "",
    "Rédige maintenant la note d'invitation.",
  ].filter(Boolean).join("\n\n");
}

export const SCORE_SYSTEM = `Tu évalues si un profil LinkedIn est un bon prospect pour un Buyer Persona B2B. Le score sert à présélectionner des profils qu'un commercial relira ensuite : sois juste, pas sévère.

Barème (le poste compte le plus) :
- Poste / fonction (50 pts) — c'est le pouvoir de décision sur le sujet de l'offre qui compte : correspond à l'un des intitulés du persona ou à un équivalent (synonyme, autre langue, niveau proche : « DAF » = « Directeur administratif et financier » = « CFO » ; « Responsable » ≈ « Directeur » dans une PME) → 40 à 50. Fonction voisine avec un pouvoir de décision sur le sujet de l'offre → 25 à 39. Sans rapport → 0 à 15.
- Pertinence de l'offre pour son entreprise (20 pts) : l'entreprise a-t-elle plausiblement le besoin décrit par l'offre (activité, nombre de sites, taille, secteur cités dans l'offre) ?
- Localisation (10 pts) : dans la zone du persona → 10.
- Secteur et taille d'entreprise (10 pts) : correspondants → 10.
- Mots-clés du persona présents sur le profil (10 pts).

Règle importante : une information ABSENTE du profil (taille, secteur, mots-clés…) est NEUTRE : accorde la moitié des points du critère, ne les retire pas. Ne pénalise que ce qui est clairement contraire au persona.

Repères : bon poste + bonne zone ≈ 70 à 85 ; profil idéal ≥ 85 ; poste sans rapport ≤ 35.
Réponds UNIQUEMENT en JSON : {"score": <entier 0-100>, "reason": "<une phrase courte en français>"}`;

export function scorePrompt(ctx: PersonaContext, profile: ProfileInput): string {
  const p = ctx.persona;
  return [
    `## Buyer Persona\nPostes : ${p.job_titles.join(", ")}\nLocalisations : ${p.locations.join(", ")}\nSecteurs : ${p.industries.join(", ")}\nTailles : ${p.company_sizes.join(", ")}\nMots-clés : ${p.keywords.join(", ")}`,
    `## Offre (la cible idéale y est souvent décrite)\n${ctx.pitch?.title ?? ""} — ${clip(ctx.pitch?.description, 1500)}\nBénéfices : ${clip(ctx.pitch?.benefits, 600)}`,
    `## Profil\n${formatProfile(profile)}`,
  ].join("\n\n");
}

export const FOLLOWUP_SYSTEM = `Tu es un expert en prospection B2B sur LinkedIn. Le prospect vient d'ACCEPTER l'invitation du commercial (avec la note d'invitation fournie). Tu rédiges le PREMIER message de suivi, envoyé par la messagerie LinkedIn.

Règles impératives :
1. Entre 350 et 800 caractères, en 2 ou 3 courts paragraphes séparés par une ligne vide.
2. Commence exactement par « Bonjour Monsieur <Nom>, » ou « Bonjour Madame <Nom>, » (mêmes règles que pour l'invitation : capitalisation normale du nom, civilité déduite du prénom, « Bonjour <Prénom> <Nom>, » en cas de doute). Vouvoiement.
3. Remercie brièvement pour la mise en relation (une demi-phrase, sans flagornerie), puis enchaîne sans répéter la note d'invitation mot pour mot.
4. Développe l'intérêt concret pour SON entreprise (activité, sites, enjeu tiré du profil) et les bénéfices de l'offre, avec l'argument différenciant décrit dans l'offre et les instructions.
5. Termine par UNE proposition d'action simple et facile à accepter (ex. échange de 10 minutes, avec deux créneaux possibles formulés de façon générique : « en début ou en fin de semaine »).
6. Respecte les instructions de suivi de l'utilisateur si elles existent (elles priment sur le style).
7. N'invente rien qui ne figure pas dans le profil ou l'offre. Pas d'emoji sauf instruction contraire, pas de signature, pas de guillemets autour du message.

Réponds UNIQUEMENT avec le texte du message.`;

export function followupPrompt(ctx: PersonaContext, profile: ProfileInput, invitation: string, previous?: string, feedback?: string): string {
  return [
    `## Expéditeur\n${ctx.sender.full_name || ctx.sender.first_name || "(inconnu)"}`,
    `## Offre\n${formatOffer(ctx)}`,
    ctx.copywriting?.instructions ? `## Instructions générales de rédaction\n${clip(ctx.copywriting.instructions, 1500)}` : "",
    ctx.copywriting?.followup_instructions ? `## Instructions pour le message de suivi\n${clip(ctx.copywriting.followup_instructions, 1500)}` : "",
    `## Note d'invitation déjà envoyée (et acceptée)\n${clip(invitation, 400) || "(inconnue)"}`,
    `## Profil du prospect\n${formatProfile(profile)}`,
    previous ? `## Version précédente (propose une version nettement différente)\n${clip(previous, 1200)}` : "",
    feedback ? `## Correction demandée\n${feedback}` : "",
    "Rédige maintenant le message de suivi.",
  ].filter(Boolean).join("\n\n");
}

export const REMINDER_SYSTEM = `Tu es un expert en prospection B2B sur LinkedIn. Le prospect a accepté l'invitation et a reçu un ou plusieurs messages (fournis), sans répondre. Tu rédiges une RELANCE courte, envoyée par la messagerie LinkedIn.

Règles impératives :
1. Entre 200 et 450 caractères. Un seul paragraphe, ou deux très courts.
2. Commence exactement par « Bonjour Monsieur <Nom>, » ou « Bonjour Madame <Nom>, » (mêmes règles que précédemment : capitalisation normale du nom, civilité déduite du prénom, « Bonjour <Prénom> <Nom>, » en cas de doute). Vouvoiement.
3. Ne répète pas les messages précédents : apporte UN angle nouveau et concret (un bénéfice, un enjeu du moment pour son type d'entreprise, une question simple sur sa situation), en restant dans le cadre de l'offre. N'invente aucun chiffre ni fait.
4. Ton cordial, jamais insistant ni culpabilisant (pas de « je n'ai pas eu de retour », pas de « je me permets de relancer »).
5. Termine par UNE question fermée, facile à répondre.
6. Si c'est la dernière relance, dis-le avec élégance (ex. : « je ne vous relancerai plus ») et laisse la porte ouverte.
7. Respecte les instructions de suivi de l'utilisateur si elles existent. Pas d'emoji sauf instruction contraire, pas de signature, pas de guillemets autour du message.

Réponds UNIQUEMENT avec le texte du message.`;

export function reminderPrompt(
  ctx: PersonaContext,
  profile: ProfileInput,
  history: { kind: string; text: string }[],
  step: number,
  isLast: boolean,
  previous?: string,
  feedback?: string,
): string {
  const past = history.map((h) => `- ${h.kind === "invitation" ? "Note d'invitation" : h.kind === "followup_1" ? "Message de suivi" : "Relance"} : ${clip(h.text, 900)}`).join("\n");
  return [
    `## Offre\n${formatOffer(ctx)}`,
    ctx.copywriting?.followup_instructions ? `## Instructions pour les messages de suivi\n${clip(ctx.copywriting.followup_instructions, 1500)}` : "",
    `## Messages déjà envoyés (sans réponse)\n${past || "(aucun)"}`,
    `## Profil du prospect\n${formatProfile(profile)}`,
    `## Relance n°${step}${isLast ? " — DERNIÈRE relance" : ""}`,
    previous ? `## Version précédente (propose une version nettement différente)\n${clip(previous, 900)}` : "",
    feedback ? `## Correction demandée\n${feedback}` : "",
    "Rédige maintenant la relance.",
  ].filter(Boolean).join("\n\n");
}
