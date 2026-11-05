# Roadmap — après le MVP

Le schéma de base est déjà prêt pour ces étapes (`campaigns`, `action_queue`, `messages.kind`,
`user_settings` : quotas, plages horaires, `withdraw_pending_after_days`, `autopilot_warning_accepted_at`).

## 1. Autopilote (étape A livrée : lots validés dans le dashboard + envoi rythmé)
- Lancement d'une campagne (persona + copywriting + quotas) ; index unique : une seule campagne `running` par compte.
- Boucle dans l'extension (`chrome.alarms`) : uniquement pendant les plages horaires / jours ouvrés du fuseau de l'utilisateur,
  délais aléatoires `min_delay_seconds`–`max_delay_seconds`, compteurs `count_actions_today` / `count_actions_week`.
- Recherche → visite → score IA → (réchauffage optionnel : visite, suivi, like) → note → envoi.
- Montée en charge progressive (warm-up 2 semaines) : plafond = quota × min(1, jours_depuis_activation / 14).
- Validation par lot : l'agent prépare N profils + messages en `action_queue` (status `pending`, `payload.needs_approval`),
  l'utilisateur valide dans le dashboard.
- File d'actions dans le dashboard (à venir / fait / échec), Pause / Reprendre, annulation unitaire.
- Acceptation de l'avertissement CGU obligatoire (`autopilot_warning_accepted_at`).

## 2. Suivi & relances
- Détection des acceptations (page « Invitations envoyées » / « Mon réseau ») plusieurs fois par jour → `leads.status = accepted`.
- Message de suivi n°1 puis relances J+3, J+7, J+14 (`campaigns.followup_delays_days`), générés par l'IA avec l'historique.
- Lecture de la messagerie : arrêt immédiat de la séquence dès qu'une réponse arrive → `replied` + notification.
- Retrait automatique des invitations en attente depuis plus de `withdraw_pending_after_days` jours.
- Sélecteurs de la messagerie et de « Mon réseau » à ajouter dans `selectors.ts`.

## 3. Onboarding automatique
- À l'inscription : l'extension lit le profil LinkedIn de l'utilisateur et la page de son entreprise
  (`linkedin_profiles_user`), une Edge Function propose un premier persona + pitch à valider.

## 4. Knowledge
- Upload de fichiers (PDF, DOCX) vers Supabase Storage + extraction de texte.

## 5. Équipe & paiement
- Stripe Checkout + webhook → `subscriptions` (plan `pro` / `team`, `status = active`).
- Équipes : `teams`, `profiles.team_id`, `personas.team_id`, `leads.team_id` + politiques RLS d'équipe.
- Export Excel natif (.xlsx) en plus du CSV.
