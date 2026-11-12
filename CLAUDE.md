# EFI Prospection — consignes permanentes pour Claude

Projet : assistant de prospection LinkedIn (extension Chrome MV3 `apps/extension`, tableau de bord
Next.js `apps/web`, Supabase `supabase/`, code partagé `packages/shared`). L'utilisateur est non
technique et francophone, sous Windows : réponses en français, pas à pas, sans jargon.

## Règles de sécurité (à chaque modification, sans exception)
Les 7 règles détaillées dans `docs/SECURITE.md` ne doivent jamais être affaiblies. En cas de conflit
avec une demande, s'arrêter et expliquer le conflit au lieu de contourner la règle. Chaque réponse qui
modifie le projet se termine par une section « Contrôle sécurité » (les 7 règles, ✅ / ⚠️ / ➖,
fichiers et tables touchés, nouvelle table / route / clé / webhook signalée, compromis).

## Règle « un problème corrigé ne revient jamais »
1. Toute correction de bug ajoute un test qui reproduit le problème AVANT la correction et passe
   après : test DOM (`apps/extension/test/content.test.mjs` + page d'exemple dans `test/`), test SQL
   (`supabase/tests/rls_isolation.sql`) ou test Deno (`supabase/functions/_shared/*_test.ts`).
2. Le problème est inscrit dans `docs/REGRESSIONS.md` (symptôme, cause, correction, test).
3. Ne jamais supprimer ni affaiblir un test existant pour faire passer un changement.
4. Avant chaque commit : `npm run typecheck`, tests DOM, tests SQL, `deno check` + `deno test`
   (voir `.github/workflows/ci.yml`, qui les relance à chaque envoi).

## LinkedIn change d'aspect : principes de robustesse
- Ne jamais dépendre d'une seule classe CSS : sélecteurs multiples (`linkedin/selectors.ts`) PUIS
  repli par le sens (texte visible, aria-label, nom du profil dans le titre de l'onglet, plus grand
  texte correspondant, shadow DOM). Les nouvelles variantes de page deviennent des pages d'exemple
  de test.
- Ne jamais deviner un clic : libellés exacts (jamais « Envoyer sans note » sauf réglage « sans
  note »), bouton toujours rattaché au profil affiché. Mieux vaut un échec expliqué qu'un envoi au
  mauvais endroit.
- Une page illisible est d'abord réessayée (rechargement), puis passée ; la pause temporaire se lève
  seule (`lib/recovery.ts`). Les avertissements LinkedIn (vérification, limite, compte restreint)
  arrêtent tout jusqu'à l'utilisateur : ne jamais les contourner.
- Chaque échec enregistre un diagnostic STRUCTUREL (éléments trouvés, compteurs), jamais de nom,
  d'URL de profil ni de texte de message. Ce diagnostic est copiable depuis le panneau et depuis la
  carte « Santé » de la page Autopilote, pour une correction rapide.

## Mises à jour chez l'utilisateur
`Mettre-a-jour-EFI.bat` (git pull, npm install si besoin, déploiement des fonctions IA si besoin,
reconstruction de l'extension, liste des fichiers SQL à lancer). Toute nouvelle migration SQL doit
être rejouable sans erreur (`if not exists`, `create or replace`, `drop constraint if exists`).
Ne pas modifier `Mettre-a-jour-EFI.bat` sans nécessité : il est remplacé pendant sa propre exécution.
