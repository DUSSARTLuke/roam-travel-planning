# Roam V2.1.1 — Rapport B2 : estimations facultatives

Date : 12 novembre 2026. Branche : `develop-v2`. Référence inchangée : `64c66bd212ef897a27bb5671f546c6395bac571d`.

## Résultat et périmètre

B2 ajoute le client de calcul facultatif, son cache local et les sources d’un relais OpenRouteService authentifié. Le fonctionnement est développé et testé avec un fournisseur simulé. Aucun appel réel à OpenRouteService, compte, secret réel, déploiement ou changement de données utilisateur n’a été nécessaire. Aucune dépendance installée. Aucun commit ni push.

Sans configuration, Roam conserve intégralement la saisie manuelle et le fonctionnement hors ligne de B1. Aucun calcul au chargement, changement de filtre ou changement de participants. Les alertes avancées B3 et la visualisation cartographique B4 ne sont pas implémentées.

Le relais est fourni comme **source de déploiement optionnelle**, pas comme service opérationnel déjà validé sur Supabase. Son comportement HTTP est testé par injection ; son SQL n’a pas été exécuté sur PostgreSQL dans cet environnement. La première connexion réelle reste à effectuer en recette après validation.

## Audit de l’infrastructure et cohérence avec l’étude

L’étude `docs/v211-phase-b-routing-study.md` et le rapport B1 ont été examinés avant modification. Le modèle canonique `Journey` et son contrôle de révision permettent d’ajouter une estimation sans créer une seconde collection de déplacements.

L’infrastructure de synchronisation existante est **locale** : Dexie, journal `syncOutbox`, identités/révisions, commandes idempotentes et conflits. `roam-v2/docs/local-sync.md` précise qu’aucun SDK, Auth ou échange Supabase n’est implémenté. `roam-v2/docs/sync-architecture.md` propose Supabase pour une phase future. Aucun déploiement, projet distant ou fonction existante n’a été trouvé dans le dépôt ; aucune configuration privée n’a été recherchée dans les profils utilisateur.

Il n’est donc pas possible d’affirmer qu’un hébergement multi-utilisateurs existant peut être réutilisé. Les sources proposées utilisent Supabase Edge Functions + Auth + PostgreSQL, compatibles avec cette architecture future. Aucun backend de synchronisation des voyages n’est créé par B2. Une future Auth partagée pourra remplacer la petite session réservée au calcul.

Le [plan Supabase Free](https://supabase.com/pricing) annonce 500 Mo de base, 5 Go d’egress, 50 000 utilisateurs actifs mensuels, deux projets actifs maximum et une mise en pause après une semaine d’inactivité. Les [Edge Functions Free](https://supabase.com/docs/guides/functions/pricing) incluent 500 000 invocations. Cela rend un petit relais envisageable sans abonnement obligatoire ; cela ne garantit ni disponibilité permanente ni capacité gratuite illimitée. Les consommations d’une future synchronisation partageraient les ressources du projet.

## Architecture et fichiers

| Élément | Rôle |
| --- | --- |
| `roam-v2/src/routing/estimateModel.ts` | Requête minimale, profils, empreinte exacte, unités, dates, validation et limites de réponse ; partagé avec le relais sans dépendance navigateur |
| `routingProvider.ts` | Adaptateur HTTP injectable, HTTPS, authentification, erreurs normalisées, timeout et annulation |
| `routingService.ts` | Cache Dexie indépendant, mutualisation, Web Locks, limitation des appels et traitement de `Retry-After` |
| `routingAuth.ts`, `routingRuntime.ts` | Configuration facultative et session Supabase Auth conservée uniquement en mémoire |
| `components/program/RoutingEstimator.tsx`, `routingContext.ts` | Demande explicite, résultat séparé, acceptation volontaire et fournisseur injectable pour les tests |
| `ActivityConnections.tsx`, `activity-connections.css` | Intégration au formulaire B1, priorité manuelle, source/date/attribution sur les liaisons |
| `evolution/v21/contracts.ts` | Métadonnées additives validées dans les déplacements canoniques |
| `supabase/functions/_shared/routing.ts` | Gestionnaire HTTP indépendant du runtime, intégralement simulable |
| `supabase/functions/routing/index.ts`, `supabase/config.toml` | Adaptateur Edge : Auth, liste privée d’utilisateurs, réservation de quota, appel ORS fixe |
| `supabase/migrations/202611120001_routing_quota.sql` | Proposition SQL de quotas atomiques, non appliquée |
| `roam-v2/.env.routing.example` | Exemple de configuration publique ; aucune valeur secrète utilisable |
| `roam-v2/tests/routing.*`, suites existantes étendues | Tests purs, intégration, interface et concurrence multi-onglets |

Flux : action utilisateur → requête profil/deux points GPS → cache → relais authentifié si nécessaire → estimation distincte → acceptation explicite → enregistrement `Journey` avec la révision ouverte dans le formulaire. Le réseau reste hors des transactions métier.

### Profils et interface

Calcul initial limité à marche (`foot-walking`), vélo (`cycling-regular`) et voiture (`driving-car`). Taxi/VTC, transports en commun, train, avion, bateau et autre restent manuels. Aucun géocodage supplémentaire, horaires TC, trafic temps réel, péage, tracé ou instructions détaillées.

Les deux activités doivent disposer de coordonnées GPS valides. Le graphe de succession et les filtres participants restent ceux de B1 : aucune nouvelle liaison entre journées ou voyageurs disjoints. Un horaire absent ne devient pas une heure de départ inventée. Les voyages historiques, déplacements autonomes et multi-étapes sont conservés ; l’estimateur est proposé dans l’éditeur compact des liaisons de deux activités, sans calcul automatique des segments autonomes.

Le bouton « Estimer le trajet » ne modifie aucun champ métier. Si une durée manuelle est présente, l’action suivante est « Conserver l’estimation à côté de ma durée ». Pour utiliser la durée calculée, il faut laisser/mettre la durée vide puis accepter explicitement l’estimation. Une durée automatique peut être corrigée librement ; toute saisie de durée redevient manuelle. Une distance déjà saisie et la marge restent préservées.

Le résultat affiche durée, distance, date, fournisseur, attribution et lien de licence. La conversion secondes → minutes arrondit au supérieur. Un changement de profil ou de coordonnées invalide le résultat proposé ; une réponse obsolète est ignorée. La carte compacte conserve les métadonnées du résultat accepté et signale un changement de lieux ou mode. L’expiration du cache ne supprime jamais une durée enregistrée.

### Modèle, migrations et sauvegardes

Ajout facultatif `JourneySegment.routingEstimate` :

```ts
{
  version: 1,
  provider: 'openrouteservice',
  profile: 'foot-walking' | 'cycling-regular' | 'driving-car',
  inputKey: string, // JSON canonique : version, profil, GPS ordonnés longitude/latitude
  durationSeconds: number,
  distanceMeters: number,
  calculatedAt: string, // ISO UTC
  expiresAt: string,
  licence: 'CC-BY-SA-4.0'
}
```

`durationMinutes` reste la durée effective ; `durationSource` reste `manual` ou `automatic`. Le validateur refuse nombres négatifs/non finis, profil/empreinte incohérents, dates invalides, TTL excessif et champs supplémentaires de l’estimation. Avec une estimation attachée et une source automatique, coordonnées, mode et minutes effectives doivent correspondre au résultat. Une durée manuelle peut conserver une ancienne estimation comme information distincte. Les anciens segments, y compris le marqueur `automatic` réservé par B1 sans métadonnées, restent lisibles.

Pas de migration destructive, de nouvelle version métier Dexie, de duplication des transports, de dépense ou réservation automatique. Les métadonnées acceptées suivent les instantanés du journal existant et ZIP2. ZIP1 V4/V5 continue à être importé par la migration existante ; pas de promesse de rétro-export de B2 vers ZIP1. Le cache, les sessions, URLs authentifiées et secrets sont absents des sauvegardes et de l’outbox.

### Priorité manuelle et concurrence

Le service de calcul n’a aucune dépendance au repository métier et n’écrit jamais un `Journey`. Seul « Enregistrer la liaison » persiste, avec la révision initiale. Une modification ou suppression concurrente entraîne le refus atomique habituel ; aucun retour réseau n’effectue de fusion silencieuse ou de réessai d’écriture. Les contrôles transactionnels B1 revérifient aussi activités, dates, lieux et participants.

La suite vérifie une modification manuelle pendant un calcul, la conservation du brouillon, le refus de l’ancienne sauvegarde, puis un enregistrement explicite depuis une version rechargée. Deux onglets réels vérifient également qu’une estimation obsolète ne remplace pas une durée manuelle concurrente et ne crée aucune opération de journal supplémentaire.

La synchronisation distante entre appareils n’existant pas encore, aucune fusion serveur réelle n’est revendiquée. Le futur adaptateur devra conserver ces contrôles de révision et résoudre les conflits explicitement plutôt que choisir le dernier résultat réseau reçu.

### Cache, hors ligne et économie d’appels

- Base indépendante `roam-routing-cache-v1`, jamais ajoutée aux tables génériques de `RoamDatabase`.
- Clé : relais/fournisseur + identité de session + voyage + profil et coordonnées exactes ordonnées. Aucun nom, participant ou horaire n’est transmis au relais. Deux voyageurs suivant le même trajet mutualisent le résultat ; deux sens ou profils restent distincts.
- Résultat positif réutilisable sept jours ; absence de route conservée cinq minutes ; pas de cache négatif des erreurs Auth/réseau.
- Maximum 1 000 entrées, éviction des moins récemment utilisées, y compris les réponses négatives. Réponses bornées à 32 Kio, empreinte limitée à 500 caractères ; pas de géométrie ou réponse fournisseur brute persistée.
- Promesse partagée au sein du service et Web Locks + seconde lecture du cache entre onglets. Sans Web Locks, déduplication locale et cadence partagée subsistent ; des calculs identiques simultanés entre instances peuvent alors être dupliqués.
- Espacement local d’au moins 2,1 secondes, réservation atomique du créneau en IndexedDB ; attente excessive refusée. `429` propage un délai partagé, sans boucle de réessai automatique.
- Annulation d’un appelant sans interrompre les autres appelants du même service ; abandon du fournisseur quand tous annulent. Changement de mode/GPS et démontage annulent l’attente de l’éditeur. Timeout HTTP de dix secondes côté client, huit secondes côté ORS dans le relais.
- Cache récent utilisable sans réseau ; cache expiré jamais appliqué comme nouveau calcul. Une panne/quota IndexedDB empêche le calcul, mais pas la saisie ni les sauvegardes manuelles.

La session Auth n’est volontairement pas persistée. Après fermeture/rechargement complet, l’accès au service configuré requiert une nouvelle connexion ; un utilisateur sans session ne peut pas ouvrir un cache d’un autre compte. Hors ligne, les durées et estimations déjà enregistrées dans le voyage restent visibles et modifiables. Le cache seul n’est pas une sauvegarde du voyage ; il peut contenir des coordonnées jusqu’à éviction/effacement des données du site.

## Relais : sécurité et quotas

Le client appelle uniquement un relais HTTPS configuré ; il refuse un accès direct aux hôtes ORS. Les trois valeurs `VITE_ROUTING_*` sont publiques. Aucune clé ORS ou `service_role` n’est embarquée. La connexion optionnelle utilise le REST Supabase Auth, sans SDK, inscription, stockage de mot de passe, jeton persistant ou rafraîchissement en arrière-plan.

Le relais refuse par défaut toute origine hors liste exacte. CORS n’est pas utilisé comme authentification : chaque POST exige un Bearer validé par Supabase Auth **et** une identité présente dans une liste privée. Corps limité à 2 Kio, deux points et trois profils autorisés ; aucune URL cible fournie par le navigateur. Hôte ORS fixe, pas de redirection, corps d’erreur fournisseur non renvoyé, pas de journal applicatif de coordonnées ou jetons. Les logs et durées de rétention de la plateforme devront aussi être vérifiés en recette.

`verify_jwt = false` laisse atteindre le gestionnaire, notamment pour le preflight et les nouvelles clés publiques Supabase ; il **ne désactive pas** sa vérification Auth. Ne pas publier une variante qui supprimerait cette vérification. Références : [sécurisation des fonctions](https://supabase.com/docs/guides/functions/auth), [secrets serveur](https://supabase.com/docs/guides/functions/secrets).

La fonction SQL réserve chaque appel avant ORS, sous verrou transactionnel global : 30/minute, 1 800/24 heures glissantes et 300/utilisateur/24 heures. Les erreurs consomment leur réservation. RLS activée, accès direct public/anon/authenticated révoqué, exécution RPC réservée au rôle serveur. Cela limite les appels ORS entre instances ; les invocations refusées du relais et les tentatives Auth consomment néanmoins les quotas Supabase. Utiliser une clé ORS dédiée ; les usages externes de la même clé ne sont pas comptabilisés par ce SQL.

Le point d’accès utilise `https://api.heigit.org/openrouteservice/v2/directions/{profile}/json`, avec `geometry:false` et `instructions:false`, puis ne renvoie que le résumé normalisé. Voir la [documentation Directions](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/requests-and-return-types) et l’[annonce officielle du changement d’URL](https://heigit.org/changes-in-the-openrouteservice-universe/). Aucun appel à cet endpoint n’a été effectué.

Les résultats portent attribution et licence CC-BY-SA 4.0, avec liens visibles et indication de l’arrondi. Voir la [confirmation officielle ORS sur la licence des résultats](https://ask.openrouteservice.org/t/free-plan-in-an-app-with-a-paid-tier-license-cc-by-sa-4-0-personal-data-and-attribution-questions/8079), la [licence](https://creativecommons.org/licenses/by-sa/4.0/) et les [conditions HeiGIT](https://account.heigit.org/info/tos). Vérifier les conditions du compte avant diffusion réelle, notamment pour les coordonnées identifiantes ; B2 n’envoie ni noms ni programme complet.

## Tests et résultats

Tous les tests utilisent les fournisseurs/réponses factices, bases `roam-v2-test-*` et profils Chrome temporaires. Aucun test de charge ou appel à une API de calcul réelle.

| Commande / niveau | Résultat |
| --- | --- |
| `npm.cmd run build --prefix roam-v2` | Réussi, TypeScript et build production ; avertissement préexistant sur la taille des chunks |
| `npm.cmd run lint --prefix roam-v2` | Aucune erreur ; sept avertissements préexistants, aucun nouvel avertissement B2 |
| `npm.cmd run test:v21 --prefix roam-v2` | Réussi : modèles, migrations pures, participants B1, nouveaux contrats/profils/unités, Auth, relais et erreurs HTTP simulés |
| `npm.cmd run test:browser --prefix roam-v2 -- 320` | Suite complète réussie à 320 px |
| Même commande à `375` et `1100` | Suites complètes réussies aux deux largeurs |
| `npm.cmd run test:concurrency --prefix roam-v2` | Réussi : vrais onglets, formulaires existants, plus cache et priorité manuelle B2 |
| `npm.cmd run test:offline --prefix roam-v2` | Réussi : build production, SW, navigation/redémarrage et formulaires réels, réseau effectivement coupé, sans configuration de calcul |
| `npm.cmd run test:pwa --prefix roam-v2` | Réussi : intégrité/précache, exclusions, protocole de mise à jour et protection multi-onglets |
| `npm.cmd run test:publication --prefix roam-v2 -- --artifact=dist` | Réussi : simulation locale V1/V2, sous-chemin GitHub Pages, mise à jour/rollback et conservation des données fictives |
| Type-check de l’entrée Edge avec TypeScript existant | Réussi, sans installation Deno |
| `git diff --check` | Réussi |
| PostgreSQL / déploiement Edge / ORS réel | Non exécutés : PostgreSQL et Deno absents, Docker non démarré, aucun compte ni secret configuré |

Couverture B2 ajoutée : requêtes minimales et sens des coordonnées, GPS absents/invalides, profils non supportés, données négatives/NaN, réponse trop grande/invalide, timestamps/TTL/horloge reculant, unités, empreinte, priorité manuelle, annulation/timeout, 401/403/404/422/429/503, authentification/CORS/quotas simulés, absence d’exposition des erreurs internes, session expirée/déconnexion, cache persistant/isolation/offline/négatif/LRU, annulation partagée, coordonnées modifiées pendant un calcul, acceptation explicite, correction, révision concurrente, outbox et ZIP2/rechargement.

Les suites A/B1 relancées couvrent collectifs/individuels, simultanéité, divergence/convergence, filtres, modifications/suppressions et réorganisation, migrations V4/V5→V6, ZIP1/ZIP2, documents, budgets et déplacements autonomes/multi-étapes. Le test hors ligne de B2 sur le cache simule l’état réseau du service ; le test PWA de production coupe réellement le réseau et vérifie le fonctionnement manuel sans configuration. Ces deux niveaux ne sont pas assimilés à un test ORS réel.

Le SQL reçoit des contrôles de présence des protections dans les tests purs ; cela ne valide pas son exécution, ses privilèges réels ou sa concurrence sous PostgreSQL. Ces tests restent une condition de recette avant ouverture du relais.

Type-check Edge reproductible depuis la racine :

```powershell
node roam-v2/node_modules/typescript/bin/tsc --noEmit --target es2023 --module esnext --moduleResolution bundler --allowImportingTsExtensions --lib es2023,dom --skipLibCheck supabase/functions/routing/index.ts roam-v2/tests/relay.globals.d.ts
```

## Configuration externe ultérieure, après validation

Ces étapes sont **optionnelles et non exécutées**. Roam reste utilisable sans les réaliser.

1. Choisir un projet Supabase Free de recette. S’il existe réellement un projet destiné à la synchronisation, vérifier son propriétaire, ses ressources et son schéma avant réutilisation ; le dépôt ne permet pas de le confirmer. Ne pas toucher à des voyages réels pour cette recette.
2. Dans un environnement PostgreSQL/Edge de recette, vérifier puis appliquer uniquement la migration de quota fournie. Tester le refus anon/authenticated, l’accès service_role, les trois plafonds, l’expiration glissante et des réservations concurrentes. Faire un smoke test Deno/Edge du paquet et de ses imports partagés. Aucun de ces contrôles n’est remplacé par le type-check local.
3. Obtenir une clé ORS gratuite dédiée, vérifier ses quotas/conditions actuels, puis la renseigner uniquement comme secret serveur `ORS_API_KEY`. Ne jamais employer un nom `VITE_*` pour cette clé ou pour `service_role`.
4. Prévoir des utilisateurs Auth autorisés pour la recette, puis définir côté fonction `ROUTING_ALLOWED_USER_IDS` (UUID séparés par virgules) et `ROUTING_ALLOWED_ORIGINS` (origines HTTPS exactes, sans chemin). L’inscription publique peut rester désactivée ; aucune inscription n’est proposée dans Roam.
5. Vérifier la présence des variables serveur Supabase `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Déployer ultérieurement la seule fonction `routing`, avec sa configuration et sa validation Auth. Aucune commande de déploiement n’a été lancée ici.
6. Pour une future construction de recette, renseigner les seules valeurs publiques de `.env.routing.example` : URL de fonction, URL de projet Auth et clé **publishable publique**. Ne pas mettre ce fichier de configuration réel dans Git. Les variables Vite sont incorporées au build, pas découvertes dynamiquement après publication.
7. Avec des points fictifs France/Royaume-Uni, vérifier login, preflight/CORS, durée/distance réelle, origine/utilisateur refusés, `429`, panne du relais, cache hors ligne et conservation d’une durée manuelle concurrente. Vérifier les logs, attributions et plafonds du compte. Maintenir le plan gratuit et surveiller ses quotas ; aucune évolution payante automatique n’est requise.
8. Une désactivation consiste à retirer les variables publiques au prochain build. Les durées manuelles et calculées déjà acceptées restent des données locales du voyage ; aucune dépendance au relais pour les éditer ou les sauvegarder.

## Limites et suite

La validation de recette PostgreSQL/Deno/ORS et le paramétrage externe restent nécessaires avant diffusion du calcul réel. Les restrictions gratuites, mises en pause et changements de conditions des fournisseurs peuvent rendre le service temporairement indisponible ; la durée manuelle reste le repli permanent.

Pas de fusion distante inter-appareils, de renouvellement persistant de session, de calcul TC, de matrice, de calcul en masse, de route autonome/multi-étapes automatique, d’alertes de temps insuffisant ou de tracé cartographique. La mutualisation inter-onglets dépend de Web Locks, avec repli explicite décrit plus haut. Le cache local n’est ni chiffré séparément ni synchronisé.

Avant B3 : valider B2, terminer la recette optionnelle, puis définir séparément les règles d’alerte par participant, marges, horaires incertains et fuseaux. **B3 n’a pas commencé.**
