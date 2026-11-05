# Sécurité — règles appliquées et où elles vivent

| Règle | Mise en œuvre | Fichiers |
|---|---|---|
| 1. Secrets côté serveur | Clé Claude dans les secrets Supabase ; `service_role` seulement dans le code serveur Next (`server-only`) ; extension et front n'ont que l'URL + clé `anon` ; `.env*` ignorés, `.env.example` vides | `supabase/functions/_shared/claude.ts`, `apps/web/lib/supabase/admin.ts`, `.gitignore` |
| 2. RLS partout | Politiques explicites par opération (`to authenticated`), contrôle d'appartenance des lignes référencées (`owns_persona`, `owns_prospect`…), tables serveur en refus explicite ; la migration échoue si une table n'a pas de RLS ou de politique | `supabase/migrations/20261105000000_security_hardening.sql` |
| 3. Appartenance | `user_id = auth.uid()` en base ; côté serveur, identité tirée du token/cookie et filtre `user_id` explicite ; `team_id` modifiable uniquement par le serveur ; test A/B automatisé | `supabase/tests/rls_isolation.sql` |
| 4. Admin | Aucune page/route admin, aucun compte par défaut | — |
| 5. Limites | Supabase Auth : rate limits + captcha Turnstile + confirmation e-mail ; IA : `consume_ai_quota` (20/min, quota/jour par offre, tokens/jour, plafond global `app_config`) ; routes : `check_rate_limit` par IP et par compte | `supabase/config.toml`, `apps/web/lib/rate-limit.ts`, `apps/web/app/login/login-form.tsx` |
| 6. Webhooks | Pas encore de webhook. `subscriptions` n'est modifiable que par le serveur (aucune politique d'écriture client) : le futur webhook Stripe devra vérifier la signature et stocker l'ID d'événement | — |
| 7. Validation | Zod sur toutes les entrées serveur (Edge Functions, server actions, routes) ; recherche des leads via fonction SQL paramétrée ; contraintes SQL (formats d'URL, longueurs) ; texte IA nettoyé ; erreurs génériques côté client | `supabase/functions/_shared/profile.ts`, `apps/web/lib/leads.ts` |

## Tester l'isolation entre utilisateurs
```bash
PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run_local.sh
```
(PostgreSQL local jetable : applique les migrations puis vérifie qu'un utilisateur B ne peut ni lire
ni modifier les données de A en changeant un ID, ni s'attribuer une équipe ou un abonnement.)

## À configurer sur le projet Supabase hébergé
- **Authentication → Attack Protection** : activer le captcha *Turnstile* et y coller la clé **secrète**.
  La clé **site** (publique) va dans `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- **Authentication → Rate Limits** : reprendre les valeurs de `supabase/config.toml`.
- **Authentication → Providers → Email** : « Confirm email » activé.
- Plafond global IA : `update app_config set value = ... where key = 'global_daily_ai_calls';` (SQL Editor).
