/**
 * Natural, human-sounding messages (rules adapted to French prospecting messages from the
 * "humanizer" skill, MIT — see .claude/skills/humanizer). Three layers:
 *  1. HUMAN_STYLE: writing rules added to every message prompt;
 *  2. findTells(): cheap check of the strongest AI tells → one rewrite request with precise feedback;
 *  3. polish(): deterministic last pass (dashes) — never changes the meaning.
 */

export const HUMAN_STYLE = `Style d'écriture (le message doit sonner comme écrit par une personne, pas par une IA) :
- Va droit au fait. Pas de phrase de mise en scène avant le sujet (« Vous savez combien… », « Soyons honnêtes », « Et si… ? », « Saviez-vous que… »). Ne commence pas le message (après la salutation) par « En tant que <poste>, vous… ».
- Pas de construction « ce n'est pas X, c'est Y », « non seulement X mais aussi Y », « pas juste X, mais Y » : dis directement ce qui est vrai.
- Pas d'énumération en trois pour faire joli (« simple, rapide et efficace ») : garde seulement les éléments qui apportent une information distincte.
- Pas de tiret cadratin (—) ni demi-cadratin (–) : utilise une virgule, un point ou deux-points.
- Pas de phrase de chute qui répète ce qui vient d'être dit, pas de fragments dramatiques.
- Évite les mots gonflés ou de plaquette commerciale : crucial, essentiel, primordial, incontournable, véritable, levier, booster, optimiser, solution sur mesure, accompagnement personnalisé, au cœur de, dans un contexte de, n'hésitez pas, je me permets, enjeux majeurs, sans précédent, révolutionnaire.
- Phrases de longueurs variées, vocabulaire simple et concret, comme un commercial qui écrit lui-même à un dirigeant. Un détail précis et vrai vaut mieux qu'une généralité.`;

const TELLS: { re: RegExp; label: string }[] = [
  { re: /[—–]/, label: "tiret cadratin (—) ou demi-cadratin (–)" },
  { re: /\bnon seulement\b/i, label: "« non seulement… mais aussi »" },
  { re: /\bce n['’]est pas\b[^.!?\n]{0,80}[,;:]\s*c['’]est\b/i, label: "« ce n'est pas X, c'est Y »" },
  { re: /\bpas (?:seulement|juste|simplement|uniquement)\b[^.!?\n]{0,80}\bmais\b/i, label: "« pas seulement X, mais Y »" },
  { re: /^(?:[^\n]*\n+|bonjour[^,\n]{0,60},\s*)?en tant que\b/i, label: "ouverture « En tant que <poste>, vous… »" },
  { re: /\bvous savez (?:combien|à quel point|que)\b/i, label: "« vous savez combien / que… »" },
  { re: /\b(?:soyons honnêtes|saviez-vous que|et si vous pouviez)\b/i, label: "phrase de mise en scène" },
  { re: /\b(?:crucial(?:e|es|s)?|primordial(?:e|es)?|incontournables?|véritables?|levier|booster|sans précédent|révolutionnaire|au cœur de|dans un contexte de|n['’]hésitez pas|je me permets)\b/i, label: "mot ou formule typique d'IA ou de plaquette commerciale" },
];

/** Strongest AI tells found in a message (empty = fine). */
export function findTells(text: string): string[] {
  return TELLS.filter((t) => t.re.test(text)).map((t) => t.label);
}

/** Feedback for a rewrite when tells were found. */
export function tellsFeedback(tells: string[]): string {
  return `Le message contient des tournures typiques d'un texte écrit par une IA : ${tells.join(" ; ")}. Réécris-le de façon naturelle et directe en gardant les mêmes informations, la même salutation et la même longueur.`;
}

/** Deterministic last pass, meaning unchanged: dashes become commas / colons. */
export function polish(text: string): string {
  return text
    .replace(/\s*[—–]\s*(?=[^—–\n]*[—–])([^—–\n]*?)\s*[—–]\s*/g, ", $1, ") // paired dashes → commas
    .replace(/\s+[—–]\s+/g, ", ") // spaced single dash → comma
    .replace(/[—–]/g, "-") // remaining (e.g. ranges)
    .replace(/,\s*,/g, ",")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/[ \t]+/g, " ")
    .trim();
}
