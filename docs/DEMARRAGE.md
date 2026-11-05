# Démarrage pas à pas — EFI Prospection (en local)

Durée : ~30 min. Tout est gratuit pour démarrer, sauf l'usage de l'API Claude (quelques centimes
pour des dizaines de messages).

## 0. Prérequis sur ton ordinateur
- [Node.js 20+](https://nodejs.org) et [Git](https://git-scm.com)
- Google Chrome
- Récupérer le code : `git clone <url du dépôt>` puis, dans le dossier, `npm install`

## 1. Créer le projet Supabase (base de données + connexion)
1. Crée un compte sur https://supabase.com → **New project** (région : Europe, ex. Paris/Frankfurt).
   Note le mot de passe de la base.
2. **Project Settings → API** : copie
   - `Project URL`
   - la clé `anon` / `publishable`
   - la clé `service_role` / `secret` (⚠️ secrète : ne jamais la partager ni la mettre dans l'extension)
   - le `Reference ID` du projet (Project Settings → General)
3. **SQL Editor → New query** : colle le contenu de
   `supabase/migrations/20261104000000_init.sql` puis **Run** ; recommence avec
   `supabase/migrations/20261105000000_security_hardening.sql`, puis
   `supabase/migrations/20261106000000_autopilot_batch.sql`, puis
   `supabase/migrations/20261107000000_persona_limits.sql`, puis
   `supabase/migrations/20261108000000_followups.sql`, puis
   `supabase/migrations/20261109000000_relances.sql`, puis
   `supabase/migrations/20261110000000_stats.sql` (dans cet ordre, sans erreur).
4. **Authentication → URL Configuration** :
   - Site URL : `http://localhost:3000`
   - Redirect URLs : ajoute `http://localhost:3000/auth/callback`

5. **Anti-robot (captcha)** : crée un widget gratuit sur https://dash.cloudflare.com → Turnstile
   (domaine `localhost`). Colle la clé **secrète** dans Supabase → Authentication → Attack Protection
   (captcha *Turnstile*), et garde la clé **site** pour l'étape 4.
6. **Authentication → Rate Limits** : reprends les valeurs de `supabase/config.toml`.

## 2. Créer la clé API Claude
1. Crée un compte sur https://console.anthropic.com, ajoute un moyen de paiement (ou des crédits).
2. **API Keys → Create Key** : copie la clé `sk-ant-...` (affichée une seule fois).

## 3. Déployer les fonctions IA sur Supabase
Depuis le dossier du projet :
```bash
npx supabase login
npx supabase link --project-ref <Reference ID>
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase functions deploy generate-message
npx supabase functions deploy score-profile
npx supabase functions deploy generate-followup
```
La clé Claude reste ainsi côté serveur (jamais dans l'extension ni dans le navigateur).

## 4. Lancer la web app
```bash
cp apps/web/.env.example apps/web/.env.local
```
Remplis `apps/web/.env.local` : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (laisse `NEXT_PUBLIC_EXTENSION_ID` vide
pour l'instant), puis :
```bash
npm run dev:web
```
Ouvre http://localhost:3000, connecte-toi avec ton e-mail (lien magique), et crée ton premier
**Buyer Persona** + **Pitch**.

## 5. Installer l'extension
```bash
cp apps/extension/.env.example apps/extension/.env   # mêmes URL + clé anon (PAS la service_role)
npm run build:ext
```
1. Chrome → `chrome://extensions` → active le **Mode développeur** → **Charger l'extension non empaquetée**
   → choisis le dossier `apps/extension/dist`.
2. Copie l'**ID** de l'extension affiché sur sa carte, colle-le dans `NEXT_PUBLIC_EXTENSION_ID`
   (`apps/web/.env.local`), puis redémarre `npm run dev:web`.
3. Après toute modification du code de l'extension : `npm run build:ext` puis ↻ sur la carte de l'extension.

## 6. Relier l'extension à ton compte
Ouvre LinkedIn → clique l'icône de l'extension (épingle-la) → **Se connecter** → la page
`localhost:3000/extension/connect` affiche « Extension connectée ✅ ».

---

# Au quotidien (Windows) — en un double-clic

Dans le dossier `Documents\Agent-Prospection-LinkedIn-1` :

| Fichier | Quand | Ce qu'il fait |
|---|---|---|
| `Demarrer-EFI.bat` | Le matin | Démarre le tableau de bord (s'il ne tourne pas déjà) et ouvre Chrome sur l'Autopilote et LinkedIn |
| `Mettre-a-jour-EFI.bat` | Quand Claude annonce une mise à jour | git pull, dépendances et fonctions IA si nécessaire, reconstruction de l'extension, liste des fichiers SQL à exécuter |
| `Arreter-EFI.bat` | Si besoin | Arrête le tableau de bord (l'envoi automatique continue tant que Chrome est ouvert) |

Astuce : clic droit sur `Demarrer-EFI.bat` → **Envoyer vers → Bureau (créer un raccourci)**.

# Test sur LinkedIn — checklist

L'interface LinkedIn change souvent ; ce test sert à valider les sélecteurs
(`apps/extension/src/linkedin/selectors.ts`) sur **ton** compte. Fais-le avec un volume faible
(5–10 profils), compte en français **et** si possible en anglais.

> Rappel : l'automatisation est contraire aux conditions d'utilisation de LinkedIn. Pour ce test,
> envoie 2–3 invitations maximum, à des personnes que tu souhaites réellement contacter.

| # | Étape | Résultat attendu | OK ? |
|---|---|---|---|
| 1 | Panneau ouvert, persona sélectionné | Bulles d'accueil « 👋 Prénom, comment ça va ? » | |
| 2 | **Explorer les profils** | L'onglet ouvre une recherche LinkedIn correspondant au persona (postes, pays, secteurs) | |
| 3 | — | Un profil s'ouvre ; le panneau affiche nom, titre, entreprise, localisation, photo, score « Match » | |
| 4 | **✗** | Le profil suivant s'ouvre ; le profil rejeté ne revient jamais | |
| 5 | **✓ Approuver** | Message ≤ 300 caractères commençant par « Bonjour Monsieur|Madame Nom, », citant un élément réel du profil | |
| 6 | Copier / Régénérer / Modifier | Copie OK, nouvelle version différente, édition + compteur | |
| 7 | **Envoyer l'invitation** | LinkedIn : Se connecter → Ajouter une note → note collée → Envoyer ; panneau « ✅ Invitation envoyée » ; profil « En attente » | |
| 8 | Profil où « Se connecter » est caché dans « Plus » | L'extension passe par le menu « Plus » | |
| 9 | Profil déjà en relation | Ignoré automatiquement (non proposé) | |
| 10 | Dashboard → Leads | Le lead apparaît avec le message et le statut « Invitation envoyée » | |

**Si une étape échoue**, note : le numéro d'étape, le message affiché dans le panneau, la langue
de ton LinkedIn, et fais une capture. Pour aller plus loin : clic droit sur la page LinkedIn →
**Inspecter**, puis clic droit sur le bouton concerné → **Copy → Copy outerHTML** ; avec ça je
corrige `selectors.ts`. Le journal détaillé est aussi dans Supabase → Table Editor → `action_logs`.

Points à vérifier en priorité :
- **Recherche** : si la recherche ouvre « 0 résultat », les identifiants pays/secteurs de
  `packages/shared/src/constants.ts` sont à corriger (compare l'URL avec une recherche faite à la main
  avec les mêmes filtres).
- **Lecture du profil** : « À propos », expériences et activité récente (visible dans le message généré).
- **Note d'invitation** : avec un compte LinkedIn gratuit, le nombre de notes personnalisées est limité
  par mois ; l'extension s'arrête alors avec « limite d'invitations LinkedIn atteinte ».
