// Run: cd supabase/functions/generate-message && deno test ../_shared/humanize_test.ts
import { findTells, polish } from "./humanize.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

Deno.test("real follow-up from the dashboard: 'En tant que… vous savez que' is flagged", () => {
  const t = "Bonjour Madame El Ghayat,\n\nMerci pour votre mise en relation. En tant que CEO à Marseille, vous savez que le poids de l'énergie pèse.";
  assert(findTells(t).some((l) => l.includes("vous savez")), "vous savez not flagged");
  const opener = "Bonjour Monsieur Autret,\n\nEn tant que Directeur Général, vous suivez vos coûts.";
  assert(findTells(opener).some((l) => l.includes("En tant que")), "opener not flagged");
  assert(findTells("Bonjour Monsieur Benali, en tant que DAF vous suivez vos coûts.").length > 0, "one-line opener not flagged");
});

Deno.test("contrasts, inflated words and dashes are flagged", () => {
  assert(findTells("Ce n'est pas un simple courtier, c'est un partenaire.").length > 0, "ce n'est pas X, c'est Y");
  assert(findTells("Non seulement vous économisez, mais aussi vous sécurisez.").length > 0, "non seulement");
  assert(findTells("Un levier crucial pour votre budget.").length > 0, "inflated words");
  assert(findTells("Vos prix — fixés pour 3 ans — sont protégés.").length > 0, "dashes");
});

Deno.test("a plain, natural message has no tells", () => {
  const ok = "Bonjour Monsieur Autret,\n\nMerci d'avoir accepté. Krüger a plusieurs sites en Provence : nous mettons en concurrence nos fournisseurs d'électricité et de gaz pour vous, gratuitement et sans engagement. Ça vaut un appel de 10 minutes cette semaine ?";
  const tells = findTells(ok);
  assert(tells.length === 0, `unexpected tells: ${tells.join(", ")}`);
});

Deno.test("polish removes dashes without changing the words", () => {
  assert(polish("Vos prix — fixés pour 3 ans — sont protégés.") === "Vos prix, fixés pour 3 ans, sont protégés.", polish("Vos prix — fixés pour 3 ans — sont protégés."));
  assert(polish("Comparaison gratuite – sans engagement.") === "Comparaison gratuite, sans engagement.", polish("Comparaison gratuite – sans engagement."));
  assert(!/[—–]/.test(polish("2024–2026 — offre")), "dash left");
});
