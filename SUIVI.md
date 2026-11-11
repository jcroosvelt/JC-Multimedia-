# Suivi du projet JC Multimedia

> Fichier mis à jour **après chaque modification**. Le plus récent est en haut.
> Site : www.jcmultimedia.online · Base Supabase : `tkwrklboqspkzxtlvnzh` · Branche de travail : `claude/new-session-cro5rs` · En ligne = branche `main` (Vercel).

---

## État actuel (11 novembre 2026)

| Sujet | État |
|---|---|
| Paiement MonCash / Natcash | ✅ En ligne, confirmation automatique par webhook |
| Paiement par carte (Visa / Mastercard) | ⏸️ **Masqué**. Code prêt, mais PLOP PLOP répond : « Mode de paiement 'carte' non autorisé pour ce marchand ». → JC doit demander au support PLOP PLOP d'activer « carte (Square) ». Ensuite : retirer `hidden:true` dans `PAY_METHODS` (`app.js`). |
| Logos des moyens de paiement | ✅ En ligne (`/paiement/*.svg`) |
| Marquage « Dans le panier » | ✅ En ligne |
| Photos des services | ✅ En ligne, facultatives (0 à 20) |
| Reçus, liens de paiement, admin | ✅ En ligne |
| Vidéo tutoriel (FR / créole, 9:16 et 16:9) | ✅ Livrée |

## À faire / en attente

- [ ] **JC** : demander à PLOP PLOP d'activer le paiement par carte, puis dire « réactive la carte ».
- [ ] **JC** : un vrai petit paiement test (MonCash ou Natcash) pour vérifier la confirmation automatique de bout en bout.
- [ ] **JC** (Supabase) : supprimer les anciennes images de bannière et le bucket `chat-uploads` ; activer « Leaked password protection ».
- [ ] **JC** (admin) : écrire les descriptions Google des articles qui n'en ont pas ; modérer les avis en attente.
- [ ] Commandes de test à annuler dans l'admin si tu veux : JC-SRC1012 et JC-ORC1001 (essais carte du 10 novembre).

---

## Journal des modifications

### 11 novembre 2026
- Création de ce fichier de suivi (`SUIVI.md`), mis à jour après chaque modification.

### 10 novembre 2026
- **Paiement par carte masqué** sur le site : PLOP PLOP refuse `carte` pour ce compte marchand (réponse 403 lue dans les journaux de la fonction `pay-link`). Déployé.
- **« ✓ Dans le panier »** : un article déjà dans le panier est marqué (contour + badge) et ne peut plus être ajouté une 2ᵉ fois ; retour à la normale s'il est retiré. Exception : articles au pied carré. Déployé.
- Fonction `pay-link` : enregistre la réponse de PLOP PLOP en cas de refus, et le message de refus est affiché au client.
- Bouton carte renommé « Visa / Mastercard » (valeur en base inchangée : « Carte bancaire »). Déployé.
- **Logos SVG** MonCash, Natcash et carte, affichés sur les boutons de paiement (commande, `/payer/…`, réessai). Déployé.
- **Photos des services facultatives** (plus de minimum de 5 ; 2 cases au départ, jusqu'à 20). Déployé.

### 9 novembre 2026
- Paiement par carte ajouté (valeur PLOP PLOP `carte`, montant converti en USD) : site, fonction `pay-link`, fonction SQL `place_public_order`.

### Avant le 9 novembre 2026
- Vidéo tutoriel « Comment commander sur le site » (FR + créole, 9:16 + 16:9, musique).
- Nouveau numéro de contact +509 37 32 0330 partout (MonCash 34 43 2139 gardé sur le reçu).
- Frais de livraison exclus des articles ; liens de paiement ↔ reçus dans les deux sens.
- Admin : nouveau design tableau de bord aux couleurs du site, menu défilant sur téléphone.
- Reçus : design « facture », une seule image JPEG de bonne qualité, code du reçu = code de commande.
- Onglet « Liens de paiement » dans l'admin.
- Audit complet et corrections de sécurité (voir `AUDIT-2026-11-01.md`).
