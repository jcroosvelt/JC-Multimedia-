# Fonctions Edge durcies (NON DÉPLOYÉES — à valider avant déploiement)

Audit sécurité du 25/11/2026. Ces versions corrigent des points sans changer le
comportement normal. **Elles n'ont pas été testées avec le vrai PLOP PLOP** :
tester en paiement réel de petit montant après déploiement.

## plopplop-webhook
- Ne rétrograde jamais un paiement déjà « Confirmé » (un webhook « failed » rejoué
  ou arrivé en retard ne peut plus annuler un paiement confirmé).
- Si PLOP PLOP envoie un montant (`amount` ou `montant`) qui ne correspond pas au
  montant attendu en base, le paiement n'est PAS confirmé (journalisé).

## verify-payment
- CORS limité au site (plus de `*`).
- Format de la référence validé (évite d'utiliser la fonction comme relais ouvert
  vers l'API du fournisseur avec n'importe quelle valeur).

Déploiement : Supabase > Edge Functions > (fonction) > coller le code, ou
`supabase functions deploy <nom> --no-verify-jwt`.
