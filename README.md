# EFI Prospection — assistant IA de prospection LinkedIn

« Le Tinder de la prospection » : l'assistant fait défiler des profils LinkedIn qui
correspondent à ton Buyer Persona, tu valides (✓) ou passes (✗), et pour chaque profil
validé l'IA rédige une note d'invitation ultra-personnalisée (≤ 300 caractères) que
l'extension envoie depuis **ton** onglet LinkedIn.

> Pour démarrer pas à pas (création des comptes, lancement en local, test sur LinkedIn) :
> **[`docs/DEMARRAGE.md`](docs/DEMARRAGE.md)**.
>
> Le nom affiché se règle dans `packages/shared/src/brand.ts` (et le `name` du `manifest.json` de l'extension).

## Architecture

```
apps/extension     Extension Chrome MV3 (side panel React + TS + Tailwind, content script LinkedIn)
apps/web           Dashboard Next.js (App Router) + Tailwind + composants façon shadcn/ui
packages/shared    Types, constantes (quotas, secteurs, géos), i18n FR/EN, builder d'URL de recherche
supabase/          Migration SQL (tables + RLS + fonctions), Edge Functions IA (Deno)
```

```
 LinkedIn (onglet de l'utilisateur)
      ▲ clics / lecture DOM
 content script ──messages──► side panel ──supabase-js (JWT user, RLS)──► Postgres
                                   │
                                   └──► Edge Functions ──► API Claude (clé côté serveur uniquement)
 Web app (Next.js) ──cookies session──► Postgres
           └── /extension/connect ──externally_connectable──► extension (session dédiée)
```

- **Aucune action LinkedIn depuis un serveur** : tout passe par le navigateur et la session LinkedIn de l'utilisateur.
- **Clé API Claude** uniquement dans les secrets des Edge Functions (`ANTHROPIC_API_KEY`), jamais dans l'extension.
- **Auth partagée** : connecté sur la web app, l'utilisateur ouvre `/extension/connect` ; la web app génère un
  jeton magic-link à usage unique (route serveur, service role) que l'extension échange via `verifyOtp`.
  L'extension obtient ainsi **sa propre session** (pas de conflit de rotation des refresh tokens).
- **Sélecteurs LinkedIn centralisés** dans `apps/extension/src/linkedin/selectors.ts` (plusieurs candidats CSS +
  repli texte FR/EN). Si un élément requis manque → code `ui_changed`, mise en pause propre et journalisation.
- **Journal horodaté** de chaque action (`action_logs` : type, profil, résultat, détails, version des sélecteurs).

## Ce qui est livré (MVP)

| Fonctionnalité | État |
|---|---|
| Auth (magic link) + session partagée avec l'extension | ✅ |
| Buyer Personas (formulaire 2 colonnes : persona + pitch, + copywriting), limite 3 en essai | ✅ |
| Panneau latéral : accueil, sélecteur de persona, Copilote/Autopilote, ⚙️ copywriting | ✅ |
| Moteur de recommandation : recherche LinkedIn construite depuis le persona, file de profils, rythme humain, plafond quotidien, jamais reproposer un profil validé/rejeté/déjà connecté | ✅ |
| Score IA de correspondance (seuil réglable, profils sous le seuil ignorés) | ✅ |
| Approuver → lecture du profil → génération Claude (≤ 300 car., relance auto si trop long) | ✅ |
| Carte message : Copier / Régénérer / Modifier inline, compteur 300 | ✅ |
| Envoi automatique au clic : Se connecter → Ajouter une note → coller → Envoyer → vérification « En attente » ; gestion des échecs + copie manuelle | ✅ |
| Quotas invitations/jour et /semaine, pause auto sur avertissement LinkedIn / vérification de sécurité | ✅ |
| Leads : tableau, filtres persona/statut, recherche, statut éditable, badge « New » | ✅ |
| Export CSV (Excel, réservé aux offres payantes) | ✅ |
| Knowledge (documents utilisés en contexte par l'IA) | ✅ (texte) |
| Paramètres : langue FR/EN, quotas, plages horaires, suppression des données | ✅ |
| RGPD : purge des prospects rejetés après N mois (`purge_rejected_prospects`), liste d'exclusion | ✅ |
| Essai 7 jours sans CB (créé automatiquement à l'inscription) | ✅ (Stripe à brancher) |

| Autopilote — étape A : préparation d'un lot (10/15/20 profils, rien n'est envoyé), validation dans le dashboard (`/autopilot` : corriger, valider, rejeter, annuler, mettre en pause), puis envoi **automatique en arrière-plan** (onglet LinkedIn épinglé, réveil chaque minute, panneau fermable, notifications Windows), à rythme humain (plages horaires, délais aléatoires, quotas jour/semaine, montée en charge sur 2 semaines, arrêt sur tout avertissement LinkedIn, une campagne active à la fois) | ✅ |

Suite (suivi des acceptations, relances, détection des réponses) : voir [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Installation

Prérequis : Node 20+, [Supabase CLI](https://supabase.com/docs/guides/cli), Chrome.

```bash
npm install
```

### 1. Supabase

```bash
supabase start                      # ou lier un projet distant : supabase link --project-ref <ref>
supabase db reset                   # applique supabase/migrations
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # (optionnel) ANTHROPIC_MODEL=claude-sonnet-5-5
supabase functions deploy generate-message
supabase functions deploy score-profile
```

Planifier la purge RGPD (pg_cron) :
`select cron.schedule('purge-rejected', '0 3 * * *', 'select public.purge_rejected_prospects()');`

### 2. Web app

```bash
cp apps/web/.env.example apps/web/.env.local   # URL + anon key + service role key + ID de l'extension
npm run dev:web                                # http://localhost:3000
```

### 3. Extension Chrome

```bash
cp apps/extension/.env.example apps/extension/.env
npm run build:ext
```

1. `chrome://extensions` → mode développeur → **Charger l'extension non empaquetée** → `apps/extension/dist`
2. Copier l'ID de l'extension dans `NEXT_PUBLIC_EXTENSION_ID` (web app) et redémarrer la web app.
3. Ajouter le domaine de production de la web app dans `externally_connectable.matches` du `manifest.json`.
4. Ouvrir LinkedIn, cliquer sur l'icône de l'extension → **Se connecter** → la page `/extension/connect` relie la session.

## Sécurité

Règles appliquées (secrets, RLS, appartenance, limites, validation) : [`docs/SECURITE.md`](docs/SECURITE.md).
Avant de vendre l'outil : [`docs/COMMERCIALISATION.md`](docs/COMMERCIALISATION.md).

## Tests

```bash
npm test -w @kairo/shared          # builder d'URL, validation des notes
npm run test:dom -w @kairo/extension   # scraping + flux d'invitation sur une page fixture (Playwright)
npm run typecheck --workspaces
supabase/tests/run_local.sh            # isolation RLS entre utilisateurs (PostgreSQL local)
deno check supabase/functions/*/index.ts
```

Le test DOM valide la logique contre une **fixture** qui reproduit le balisage visé ; il ne garantit pas la
compatibilité avec la version courante de LinkedIn, dont l'interface change souvent — vérifier
`selectors.ts` sur un vrai compte avant toute mise en production.

## Avertissement

L'automatisation d'actions sur LinkedIn est contraire à ses conditions d'utilisation et peut entraîner une
restriction du compte. Le produit l'affiche à l'activation de l'autopilote, applique des quotas prudents, des
délais aléatoires, s'arrête dès que LinkedIn affiche un avertissement ou une vérification de sécurité, et ne
tente jamais de les contourner (reprise uniquement par l'utilisateur). Les données de prospects sont traitées
pour la prospection B2B uniquement, supprimables sur demande et purgées automatiquement pour les profils rejetés.
