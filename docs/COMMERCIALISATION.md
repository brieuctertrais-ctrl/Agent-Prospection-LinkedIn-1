# Avant de commercialiser EFI Prospection — checklist

Ce qui fonctionne aujourd'hui convient à un usage interne (un utilisateur, en local).
Avant de vendre l'outil à des clients, il reste à faire :

## 1. Emails
- [ ] Brevo : brancher le SMTP dans Supabase (Authentication → Emails → SMTP Settings)
- [ ] Authentifier le domaine d'envoi chez Infomaniak (lignes TXT/CNAME fournies par Brevo :
      code Brevo, DKIM, DMARC s'il n'existe pas déjà — ne jamais toucher aux lignes MX/SPF existantes)
- [ ] Idéalement, envoyer depuis une adresse dédiée (ex. `no-reply@` d'un domaine produit)
- [ ] Rate limit « emails envoyés » à remonter dans Supabase (Authentication → Rate Limits)

## 2. Hébergement
- [ ] Mettre le tableau de bord en ligne (Vercel), avec ses variables d'environnement
      (la clé `SUPABASE_SERVICE_ROLE_KEY` uniquement côté serveur, jamais `NEXT_PUBLIC_`)
- [ ] Mettre à jour Supabase : Site URL + Redirect URLs avec le domaine de production
- [ ] Ajouter le domaine de production au widget Cloudflare Turnstile
- [ ] Ajouter le domaine de production dans `externally_connectable` (manifest de l'extension)
      et dans `VITE_WEB_APP_URL`
- [ ] Planifier la purge RGPD : `select cron.schedule('purge-rejected', '0 3 * * *', 'select public.purge_rejected_prospects()');`
- [ ] Sauvegardes Supabase (offre payante : sauvegardes quotidiennes / PITR)

## 3. Extension Chrome
- [ ] Publication sur le Chrome Web Store (compte développeur, fiche, politique de confidentialité,
      justification des permissions `tabs`, `storage`, `sidePanel`, accès à linkedin.com)

## 4. Paiement (Stripe)
- [ ] Checkout + portail client
- [ ] Webhook Stripe : vérification de la signature, idempotence (stocker l'ID d'événement),
      droits accordés uniquement depuis le webhook (jamais depuis la page « succès »)
- [ ] Limites par offre (personas, quotas IA) déjà prêtes côté base (`is_paid`, `consume_ai_quota`)

## 5. Juridique / conformité
- [ ] Conditions générales de vente et d'utilisation
- [ ] Politique de confidentialité (données des utilisateurs ET des prospects LinkedIn traitées)
- [ ] Registre des traitements RGPD, base légale (intérêt légitime B2B), durée de conservation,
      droit d'opposition / suppression des prospects
- [ ] Contrat de sous-traitance (DPA) avec Supabase, Anthropic, Brevo, Vercel
- [ ] Avertissement clair aux clients : l'automatisation est contraire aux conditions d'utilisation
      de LinkedIn et peut entraîner la restriction de leur compte (déjà affiché à l'activation de l'autopilote)

## 6. Exploitation
- [ ] Surveillance des erreurs (logs Supabase / Vercel), alertes sur le plafond IA global (`app_config`)
- [ ] Mise à jour régulière des sélecteurs LinkedIn (`apps/extension/src/linkedin/selectors.ts`)
- [ ] Support client (adresse de contact, `NEXT_PUBLIC_CONTACT_URL`)
