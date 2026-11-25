# Rapport de sécurité — 25 novembre 2026

**Périmètre :** site `jc-multimedia-` (Vercel), base et fonctions Supabase du projet « JC Multimedia » (lecture seule, sauf deux migrations appliquées, décrites plus bas), app Android `jcmultimedia-admin-apk`.
**Méthode :** relecture du code, scan des secrets sur tout l'historique git des deux dépôts, lecture des règles d'accès (RLS), du stockage et des 8 fonctions Edge, test des correctifs dans une transaction annulée, test de la CSP dans un vrai navigateur.
**Non audité :** le site en ligne (`jcmultimedia.online` est bloqué depuis mon environnement), le vrai PLOP PLOP, l'app sur un téléphone.

## 1. Résumé exécutif
- **Score de risque : 5/10 avant → 3/10 après** (estimation de ma part, pas une mesure). Le 3 n'est atteint qu'une fois la branche `security-hardening` fusionnée et les actions manuelles du §4 faites.
- Les failles critiques du 1er novembre (XSS admin, prix choisi par le client, écritures publiques sur commandes/paiements) sont **bien corrigées** : je l'ai vérifié dans le code et la base.
- Aucun secret n'a fuité : seule la clé publique `anon` de Supabase est dans le code, ce qui est normal. Aucune rotation de clé n'est nécessaire.
- Restent surtout : **pas de sauvegarde de la base**, pas de limite de requêtes (spam de commandes, qui déclenche aussi des notifications), clé de signature de l'app trop faible, pas de double authentification pour l'admin.

## 2. Tableau des failles
| ID | Gravité | Catégorie | Où | Description | Statut |
|---|---|---|---|---|---|
| F1 | ÉLEVÉE | Upload | `storage.objects`, `order_uploads` | N'importe qui pouvait déposer des fichiers (5 Mo, sans limite de nombre) dans le stockage privé et ajouter des lignes sur n'importe quelle commande | **Corrigée** (base, testée) |
| F2 | ÉLEVÉE | Sauvegardes | Supabase | « No backups » : aucune sauvegarde de la base | **À faire par vous** |
| F3 | MOYENNE | Chaîne d'approvisionnement | 14 pages HTML | supabase-js chargé depuis un CDN en version flottante, sans contrôle d'intégrité, y compris sur l'admin | **Corrigée** (branche) |
| F4 | MOYENNE | En-têtes | `vercel.json` | Pas de CSP ni de HSTS | **Corrigée** (branche, testée) |
| F5 | MOYENNE | Paiement | `plopplop-webhook` | Un webhook « failed » rejoué peut rétrograder un paiement déjà confirmé ; montant reçu non comparé | **Préparée, non déployée** |
| F6 | MOYENNE | Anti-abus | `place_public_order`, `track_order` | Aucune limite de requêtes : spam de commandes (chacune envoie une notification push), et le suivi (code `JC-XXX0000` + téléphone) peut être deviné par essais | **À corriger** |
| F7 | MOYENNE | Authentification | Admin | Pas de double authentification ; session admin dans le `localStorage` ; protection « mots de passe compromis » désactivée | **À faire par vous** |
| F8 | MOYENNE | App Android | `signing/debug.keystore` | L'APK est signée avec la clé de debug, mot de passe par défaut `android`, commitée dans le dépôt | **À décider par vous** |
| F9 | FAIBLE | App Android | Manifeste, canaux JS | Sauvegarde Android active (copie les cookies de la session admin), HTTP clair autorisé, canal de téléchargement ouvert à toutes les pages/iframes, schémas `intent:`/`file:` non filtrés | **Corrigée** (branche, build non vérifié) |
| F10 | FAIBLE | XSS | Liens des bannières/portfolio | Un lien `javascript:` saisi dans l'admin était accepté | **Corrigée** (branche) |
| F11 | FAIBLE | Paiement | `verify-payment` | CORS `*`, référence non validée | **Préparée, non déployée** |
| F12 | FAIBLE | Base | `page_views` | Insertion publique sans limite de taille | **Corrigée** (base) |
| F13 | FAIBLE | Hygiène | Dépôt site | Pas de `.gitignore` | **Corrigée** (branche) |
| F14 | FAIBLE | Vie privée | `notify-new-order` | Adresse e-mail codée en dur dans le code de la fonction | **À faire par vous** |
| F15 | FAIBLE | Firebase | `google-services.json` | Clé API Firebase non restreinte (publique par nature) | **À faire par vous** |
| F16 | INFO | Clés | `app.js`, `api/*.js` | Clé `anon` Supabase dans le code : voulu, la sécurité repose sur la RLS | Non applicable |
| F17 | INFO | Base | 4 fonctions `SECURITY DEFINER` | Exécutables sans connexion : voulu (commande, suivi, lien de paiement). `order_accepts_uploads` doit le rester pour la RLS | Non applicable |

## 3. Failles corrigées, avec preuve
**F1 — Envois de fichiers (appliqué en production)**
- Correction : les envois ne sont acceptés que dans le dossier `<id commande>/` d'une commande créée il y a moins de 2 h, avec chemin cohérent et fichier ≤ 5 Mo.
- Preuve : testé dans une transaction annulée, 7 cas sur 7 conformes. Envoi légitime accepté ; ancienne commande, chemin falsifié, fichier de 95 Mo, dépôt hors dossier refusés. Règles relues ensuite dans `pg_policies`.
- Fichiers : `supabase/migrations/20261125_securite_envois_fichiers.sql` et sa marche arrière `.ROLLBACK.sql`.
- Limite : le nombre de fichiers par commande n'est pas plafonné.

**F12 — `page_views`** : le nom de page doit faire 1 à 200 caractères (même migration).

**F3 — supabase-js** : version exacte 2.119.2 hébergée dans `vendor/` (même fichier que le paquet npm officiel), plus aucun CDN. Preuve : les 12 pages testées chargent la bibliothèque.

**F4 — CSP + HSTS** : `default-src 'self'`, scripts du site uniquement, connexions limitées à Supabase, ni iframe ni objet, `frame-ancestors 'none'`. Preuve : les 12 pages principales testées dans Chromium, 0 violation. `'unsafe-inline'` reste nécessaire (nombreux `onclick`) : la CSP limite les dégâts d'une faille, elle ne remplace pas l'échappement.

**F10 — `safeHref`** : seuls `http(s)`, `mailto:`, `tel:`, `/…` et `#` passent. Testé sur 9 valeurs, dont `javascript:`, `JaVaScRiPt:` et `//evil.com` : toutes bloquées.

**F9 — App Android** : `allowBackup=false`, `usesCleartextTraffic=false`, canal `JcDownload` limité aux pages du site, 25 Mo maximum, fichiers `.apk/.exe/.sh…` refusés, nom de fichier assaini, schémas `file/content/intent…` jamais ouverts. **Le build n'a pas pu tourner** (voir §4), donc la compilation n'est pas vérifiée.

**Vérifié déjà corrigé depuis le 1er novembre** : XSS (`escapeHtml` échappe les guillemets, `data-path` à la place de paramètres dans `onclick`), prix recalculés côté serveur dans `place_public_order`, `create-payment` désactivée, `pay-link` relit le montant en base, écritures publiques sur `orders`/`order_items`/`payments`/`order_status_history` supprimées, HMAC du webhook vérifié.

## 4. Actions manuelles et décisions
1. **GitHub Actions bloqué (facturation).** Message : « recent account payments have failed or your spending limit needs to be increased ». GitHub → Settings → Billing & plans. Tant que ce n'est pas réglé, plus aucun APK ne se compile.
2. **Sauvegardes (F2).** Supabase → Database → Backups. Sur l'offre gratuite il n'y en a pas : passez à Pro (sauvegardes quotidiennes), ou exportez la base à la main chaque semaine. **À faire avant de fusionner quoi que ce soit.**
3. **Tester puis fusionner** `security-hardening` du site : Vercel crée un aperçu pour la branche ; testez l'accueil, une commande avec photo jointe, un paiement, l'admin. Puis fusionnez dans `main`.
4. **Admin (F7)** : Supabase → Authentication → Providers → Email → activer « Leaked password protection » ; activer la double authentification (TOTP) pour le compte admin si votre offre le permet.
5. **Limites de requêtes (F6)** : le navigateur parle directement à Supabase, donc Vercel ne peut pas les limiter. À faire côté base : plafonner le nombre de commandes par téléphone et par heure dans `place_public_order`, et limiter les essais de `track_order`. Je peux le préparer, mais cela modifie le parcours de commande : je ne le fais pas sans votre accord.
6. **Fonctions de paiement (F5, F11)** : le code durci est dans `supabase/functions/`. Déployez-le (ou demandez-moi) puis faites un vrai petit paiement de test. Je n'ai pas pu le tester avec PLOP PLOP.
7. **Clé de signature de l'app (F8)** : la mettre dans les secrets GitHub avec un vrai mot de passe. **Attention : changer de clé oblige tout le monde à désinstaller puis réinstaller l'app.** Tant que le dépôt reste privé et que vous seul y avez accès, le risque est limité.
8. **Clé Firebase (F15)** : console Google Cloud → Identifiants → restreindre la clé à l'app Android `online.jcmultimedia.jc_admin` et à son empreinte SHA-1.
9. **E-mail codé en dur (F14)** : remplacer l'adresse dans `notify-new-order` par un secret de fonction.

## 5. Secrets compromis
**Aucun.** Historique du site (3 commits) et de l'app (39 commits) scannés : clés API, JWT, clés privées, chaînes de connexion, mots de passe. Seule trouvaille : la clé `anon` Supabase (rôle `anon`, valeur masquée `eyJhbG****uTw`), publique par conception. Pas de nettoyage d'historique ni de rotation à faire. La clé de service Firebase et `NOTIFY_SECRET` ne sont que dans les secrets Supabase.

## 6. Recommandations durables
- Dependabot pour les actions GitHub (ajouté dans l'app). Ajouter la détection de secrets avant commit (gitleaks).
- Sauvegardes automatiques et un test de restauration par trimestre.
- Refaire un audit après chaque grosse fonctionnalité (paiement, nouvelle table).
- Surveiller les journaux Supabase : échecs du webhook, pics de commandes.

## 7. Checklist des 24 points
| # | Point | État |
|---|---|---|
| 1 | Clés API cachées | ✅ aucune clé secrète dans le code |
| 2 | Base de données sécurisée | ⚠️ RLS correcte, pas de sauvegarde (F2), pas de limite de requêtes (F6) |
| 3 | HTTPS imposé | ✅ Vercel + HSTS ajouté (branche) |
| 4 | Hachage des mots de passe | ✅ géré par Supabase Auth |
| 5 | Validation côté serveur | ✅ `place_public_order` valide tout |
| 6 | Protection XSS | ✅ échappement + CSP (branche) + `safeHref` |
| 7 | Journalisation | ⚠️ journaux Supabase seulement, pas d'alerte |
| 8 | Routes admin verrouillées | ✅ RLS sur l'identifiant admin, vérifié côté serveur |
| 9 | Requêtes paramétrées | ✅ API Supabase, aucune concaténation SQL côté site |
| 10 | Variables d'environnement | ✅ secrets dans Supabase ; `.gitignore` ajouté |
| 11 | Limite de requêtes | ❌ F6 |
| 12 | CORS | ⚠️ `*` sur 4 fonctions (voulu pour `pay-link`) ; durci pour `verify-payment` (non déployé) |
| 13 | En-têtes de sécurité | ✅ CSP + HSTS ajoutés (branche) |
| 14 | Cookies | ✅ non applicable : session Supabase en `localStorage` (voir F7) |
| 15 | CSRF | ✅ non applicable : pas de cookie de session ; jeton Bearer |
| 16 | Liens de réinitialisation | ✅ gérés par Supabase Auth (non audité en détail) |
| 17 | Envois de fichiers | ✅ corrigé (F1) ; plafond du nombre de fichiers à prévoir |
| 18 | Prix et paiements | ✅ prix serveur ; ⚠️ webhook à durcir (F5), à tester en réel |
| 19 | Mode debug | ✅ pas de mode debug ; erreurs génériques |
| 20 | Dépendances vulnérables | ✅ aucune dépendance npm ; supabase-js figé ; `pub outdated` non lancé (pas de Flutter ici) |
| 21 | Paquets inutilisés | ✅ aucun paquet npm ; dépendances Flutter utilisées |
| 22 | Fichiers exposés | ✅ aucun `.env`, sauvegarde ou log suivi |
| 23 | Historique git | ✅ aucun secret trouvé |
| 24 | Révocation des clés | ✅ non nécessaire (aucun secret exposé) |

## Ce qui n'a PAS été testé
Le site en production, l'app sur un téléphone, un vrai paiement PLOP PLOP, la compilation de l'app après durcissement (Actions bloqué), la CSP avec les polices Google (réseau bloqué ici), l'ouverture réelle d'une commande avec photo après la migration F1.
