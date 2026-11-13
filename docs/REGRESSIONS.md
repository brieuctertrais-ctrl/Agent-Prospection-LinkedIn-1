# Problèmes rencontrés et tests qui empêchent leur retour

Chaque ligne : un problème vu en conditions réelles, sa cause, la correction, et le test automatique
qui échouerait s'il revenait. Ces tests tournent à chaque modification (GitHub Actions).

| Date | Symptôme | Cause | Correction | Test |
|---|---|---|---|---|
| 2026-11-05 | Profil non lu (« interface changée ») | Plus de `<main>`, classes renommées | Nom lu dans le titre de l'onglet, carte du profil trouvée par ses boutons | DOM « newer LinkedIn layout… » |
| 2026-11-05 | Clic sur le « Se connecter » d'un autre profil | Bouton d'un profil suggéré placé avant | Bouton rattaché au nom du profil affiché | DOM « …never clicks another profile's button » |
| 2026-11-05 | Fenêtre d'invitation introuvable | Fenêtre dans un shadow DOM | Recherche dans les shadow roots | DOM « newer LinkedIn layout… » |
| 2026-11-05 | Note refusée 297/200 | Limite 200 (gratuit) / 300 (Premium) | Limite lue dans la fenêtre, note réécrite | DOM « newer LinkedIn layout… » (note_too_long) |
| 2026-11-09 | 10 relations lues seulement | Liste chargée au fil du défilement | Défilement du conteneur interne + vérification horaire | DOM « connections page… » |
| 2026-11-09 | Relance envoyée alors que le prospect a répondu | Qui a écrit en dernier non vérifié | Vérification juste avant l'envoi | DOM « inbox: who wrote last… » |
| 2026-11-11 | Tout en pause pour un seul profil illisible | Pause dès le premier échec | 3 échecs d'affilée avant pause, reprise seule après 45 min | DOM « unreadable pages are explained… » |
| 2026-11-11 | Nom introuvable (nouvelle page profil) | Le nom n'est plus un titre `h1` | Plus grand texte visible égal au nom de l'onglet | DOM « layout of 2026-11-11… » |
| 2026-11-11 | Message de suivi rejeté qui revient | Rejet non mémorisé, régénéré chaque heure | `stop_sequence`, `leads.sequence_stopped_at` | SQL « SEQUENCE TESTS » |
| 2026-11-11 | Messages IA au ton artificiel | Tics d'écriture IA | Règles Humanizer + détection + réécriture | Deno `humanize_test.ts` |
| 2026-11-11 | Erreur « webpack moduleId » | Cache du tableau de bord périmé après mise à jour | Cache vidé à chaque démarrage | (`Demarrer-EFI.bat`) |
| 2026-11-12 | Invitation annulée qui revient au lot suivant | Seules les invitations en attente / envoyées étaient écartées | Tout profil déjà passé par l'autopilote est écarté | SQL « CANCEL TESTS » |
| 2026-11-12 | 19 invitations « textarea_not_found » | Zone de note absente (nouvelle zone de saisie ou offre Premium) | Zone éditable reconnue ; note « bonjour » → envoi sans note | DOM « invitation modal variants… » |
| 2026-11-12 | Messages de suivi en « ui_changed » (`page: messaging`) | L'extension lisait la page trop tôt : fin de chargement de la messagerie prise pour celle du profil | Attente du chargement de la NOUVELLE page à la bonne adresse ; aucun envoi hors d'une page de profil | Node `tabs.test.mjs` |
