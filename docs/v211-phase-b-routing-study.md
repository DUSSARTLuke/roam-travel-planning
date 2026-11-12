# Roam V2.1.1 — Phase B : étude technique des itinéraires

Vérification : **12 novembre 2026**. Base auditée : `develop-v2`, commit `d94d0ae7ca1e95d78b80cd9fbaa14a0af21c041a`.

**Étude uniquement, proposition à valider.** Ce rapport est le seul fichier créé. Aucun fichier applicatif, dépendance ou donnée réelle modifié ; aucun commit, push ou déploiement. Les capacités d'un moteur libre sont distinguées de celles de ses services hébergés. Les tarifs et limites sont susceptibles de changer après cette vérification.

## 1. Conclusion et recommandation

L'intégration est possible sans changer de bibliothèque cartographique. Proposer d'abord **marche, vélo et voiture**, avec calcul volontaire, cache local, origine/date affichées et durée manuelle prioritaire.

**OpenRouteService est le candidat principal, derrière un relais serveur facultatif protégeant la clé privée.** Le quota gratuit convient à un usage modéré, sans garantie de disponibilité illimitée. Le relais peut relever d'une offre gratuite, avec plafonds bloquants et arrêt des estimations à saturation. Aucun abonnement payant obligatoire n'est nécessaire, mais l'exploitation d'un service externe reste une décision à valider. [Plans HeiGIT](https://account.heigit.org/info/plans), [tarification Workers](https://developers.cloudflare.com/workers/platform/pricing/).

Si la contrainte devient **GitHub Pages seul, sans serveur externe géré par Roam**, conserver les durées manuelles et les liens vers des calculateurs externes. OSRM/FOSSGIS permet un prototype sans clé ; son serveur communautaire ne doit pas devenir une dépendance automatique intensive. Le logiciel auto-hébergé est libre, son infrastructure n'est pas gratuite par nature. [GitHub Pages statique](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [politique FOSSGIS](https://routing.openstreetmap.de/about.html).

**Transports en commun : lot séparé.** Aucun service étudié n'offre une solution universelle et garantie gratuite, sans secret, avec horaires fiables sur toute la France et tout le Royaume-Uni. Commencer par des liens opérateurs et la saisie manuelle ; étudier ensuite TfL pour Londres et un fournisseur autorisé pour des réseaux français précis. Un profil routier « bus » n'est pas une recherche de lignes, d'horaires et de correspondances.

## 2. Audit de l'existant

Chemins ci-dessous : relatifs à `roam-v2/`, sauf indication contraire.

| Domaine | Constat vérifié | Conséquence |
| --- | --- | --- |
| Stack | React, TypeScript, Vite, Dexie/IndexedDB ; **MapLibre GL 6.16.0**, confirmé dans `package.json` et `package-lock.json` | Aucun remplacement de carte ni SDK de routage nécessaire a priori : `fetch` et GeoJSON suffisent. MapLibre affiche, sans calculer les routes. |
| Cartes | `src/maps/osmRaster.ts` : `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, attribution OSM, cache HTTP et Referer conservés | Fournisseur de tuiles indépendant du calcul d'itinéraire. |
| Géocodage | `src/places/photon.ts` : `https://photon.komoot.io/api/`, sans clé ; minimum 3 caractères, espacement 1,5 s, cache mémoire 5 min, annulation, timeout et traitement 429 | Réutiliser les GPS déjà confirmés, sans géocoder implicitement tout le voyage. |
| Activités | `src/db/activityModel.ts` : ID/tripId, date civile ou `null`, horaire exact avec fin facultative, période ou sans horaire, lieu/adresse/GPS facultatifs | Une distance peut être demandée sans horaire ; une marge temporelle nécessite la fin du départ et le début de l'arrivée. |
| Voyageurs | `Trip.participants` contient les voyageurs nommés ; `Trip.travelers` est seulement un nombre. `src/db/activityParticipants.ts` : absent = collectif, `[]` = personne, sinon liste d'IDs | Reprendre exactement les règles de phase A, sans inventer de personnes sur les anciens voyages. |
| Lieux | `src/evolution/v21/contracts.ts` : `Place`, `JourneyStop`, référence activité/hébergement, état linked/deleted et instantané du lieu | Réutilisable pour activité, hébergement ou lieu libre ; une suppression conserve le dernier lieu connu. |
| Hébergements | `Accommodation` contient dates du séjour, check-in/out facultatifs et GPS du lieu | Les futurs raccourcis devront sélectionner le séjour valide et faire choisir si plusieurs conviennent. |
| Modes | `src/db/transferModel.ts` : walk, bicycle, bus, metro, tram, train, car, taxi, plane, boat, other ; durée manuelle facultative | Un mode Roam n'a pas nécessairement d'équivalent API. Conserver les 11 modes. |
| Trajets canoniques | `Journey` avec étapes/segments, `JourneySegment.durationMinutes?`, départ/arrivée datés, fuseau facultatif ; aucune distance/provenance d'estimation, aucun participant explicite | Étendre les segments, sans créer un second système de transports. |
| Historique | `src/evolution/v21/graph.ts`, `projection.ts` : `Trip.manualTransfers` est une projection des Journey historiques compatibles à deux étapes | Écrire dans le trajet canonique via repository/révision, pas séparément dans la projection. |
| Disponibilités | `dayPlanning.ts`, `transferAvailability.ts` : créneaux, conflits et marge avec durées manuelles ; succession encore fondée sur la liste fournie | La succession globale est insuffisante pour les programmes individuels. Les conflits de phase A sont déjà sensibles aux participants. |
| Géométrie | `src/maps/tripMapTransfers.ts`, `journeyMap.ts` : lignes droites indicatives, gestion antiméridien/GPS absents | Aucun tracé routier ni distance réelle calculés actuellement. |
| PWA | `pwa/service-worker.js`, `plugin.ts` : précache statique ; modules MapLibre différés exclus ; pas de cache applicatif des tuiles/API | Le texte des estimations doit fonctionner sans la carte ; cache routage distinct. |
| Synchronisation | `src/sync/model.ts`, `journal.ts`, `docs/local-sync.md` : journal local, CAS, idempotence, filiation, ZIP1/ZIP2 | **Aucune réplication distante opérationnelle** dans le code audité. Préserver sa préparation, sans prétendre qu'une synchronisation multi-appareils existe déjà. |

Aucun service de routage n'a été trouvé dans les appels réseau. Photon est un géocodeur ; le lien Google Maps du carnet ouvre un service externe ; Frankfurter calcule des taux de change.

Photon autorise un usage raisonnable de sa démo, sans disponibilité garantie. Les tuiles OSM demandent attribution, Referer et cache HTTP conforme ; leur téléchargement massif/préchargement est interdit. Un cache de durées ne donne aucun droit à précharger les cartes. [Photon officiel](https://github.com/komoot/photon#demo-server), [politique des tuiles OSM](https://operations.osmfoundation.org/policies/tiles/).

### Composants d'accueil envisageables

- `TripProgram`, `DayTimeline`, `MultiDayProgram` : estimations entre activités et voyageurs concernés.
- `PlanningGap`, `TransferTimingText`, `TransferCard` : durée, marge et alerte de temps insuffisant.
- `JourneyFormPanel`, `JourneyProgram`/`JourneyDetail` : estimer/appliquer/corriger par segment.
- `ActivityDetailPanel`, `ActivityCard` : accès au déplacement suivant, sans calcul au rendu.
- `TripMap`, `TripMapTransfers`, `tripTransferLayer` : tracé réel facultatif distinct du lien indicatif.
- `TravelMode` : réutilisation ultérieure du résultat, sans second client API.

Les raccourcis d'hébergement de la première définition de phase B restent une évolution distincte ; rien n'est développé dans cette étude.

## 3. Comparatif : capacités, gratuité et couverture

Les quotas désignent le service hébergé, jamais le logiciel libre. Aucun quota ne constitue une garantie de service.

| Solution | Marche / vélo / voiture | Transports en commun | Gratuité et restrictions | Clé ; France/Royaume-Uni |
| --- | --- | --- | --- | --- |
| **ORS hébergé** | Oui, profils dédiés | Couverture TC France/R.-U. non vérifiée dans l'offre publique ; profil moteur public-transport/GTFS distinct | Standard : Directions **2 000/24 h, 40/min** ; Matrix **500/24 h, 40/min**. Directions : 50 points max et limites de distance/options | Clé requise ; routage OSM mondial, France/R.-U. sous réserve du réseau et des accès |
| **OSRM/FOSSGIS** | Oui, instances car/bike/foot séparées ; profil préparé à l'import | Non pour les horaires/correspondances | Moteur BSD-2-Clause ; démo sans abonnement : **1 requête/s max**, pas de scraping/usage lourd ; aucune enveloppe journalière garantie | Démo sans clé ; profils annoncés mondiaux, France/R.-U. inclus |
| **GraphHopper hébergé** | Oui ; Free limité à car/bike/foot | Profil bus routier ≠ horaires ; moteur GTFS séparé | Free **500 crédits/jour**, 5 lieux/requête, non commercial ; cadence minute et profils restreints. Ne pas assimiler crédits et requêtes de tout type | Clé requise ; OSM mondial France/R.-U. ; offre API distincte du moteur Apache-2.0 |
| **Valhalla/FOSSGIS** | Oui : pedestrian, bicycle, auto et autres | Moteur multimodal prévu ; dépend des données horaires intégrées. TC France/R.-U. non vérifiés sur la démo | Moteur MIT ; démo fair-use avec limitations selon les règles des démos OSRM/Nominatim ; aucun quota gratuit garanti | Démo sans clé ; annoncer l'app via GitHub Discussions et envoyer `X-Client-Id` ; graphe routier planète |
| **OpenTripPlanner 2** | Marche/vélo et modes combinés ; voiture selon configuration | Oui, GTFS/NeTEx selon configuration, temps réel | LGPL ; pas de quota logiciel mais infrastructure, RAM, imports et maintenance à fournir | Auth au choix de l'exploitant ; France/R.-U. si flux importés et autorisés ; aucun service mondial gratuit inclus |
| **Navitia / autorité** | Accès/fin à pied, vélo et autres selon déploiement | Oui, horaires/correspondances | Aucun quota gratuit universel actuel vérifié ; accès à obtenir auprès de l'autorité. Ne pas reprendre les anciens « 90 000/mois » | Token privé ; datasets autorisés, France réseau par réseau, R.-U. non garanti |
| **TfL Unified API** | Modes et accès selon Journey Planner, pas un routeur mondial | Oui, périmètre du planificateur TfL | Gratuit ; anonyme **50 requêtes/min**, produit enregistré **500/min** | Sans clé en mode anonyme ; clé de souscription au-delà ; **Londres**, pas France ni tout le R.-U. |
| **TransportAPI** | Accès selon produit | Oui, services britanniques | Free permanent **30 hits/jour**, données réduites ; essais commerciaux distincts. Droit au Journey Planner et coût en hits à confirmer par plan | app_id/app_key ; R.-U., pas France ; Free ne prouve pas l'accès au planificateur complet |

Sources officielles : [plans HeiGIT](https://account.heigit.org/info/plans), [restrictions ORS](https://giscience.github.io/openrouteservice/hosted-api-restrictions), [configuration GTFS ORS](https://github.com/GIScience/openrouteservice/blob/main/ors-config.env), [OSRM moteur](https://github.com/Project-OSRM/osrm-backend), [OSRM API/profils](https://project-osrm.org/docs/v5.24.0/api/), [FOSSGIS](https://routing.openstreetmap.de/about.html), [GraphHopper prix](https://www.graphhopper.com/pricing/), [profils confirmés par le mainteneur](https://discuss.graphhopper.com/t/message-for-your-account-the-profile-parameter-can-only-be-one-of-car-bike-foot-but-was-small-truck/9468), [GraphHopper GTFS](https://github.com/graphhopper/graphhopper/tree/master/reader-gtfs), [Valhalla](https://valhalla.github.io/valhalla/), [API Valhalla](https://valhalla.github.io/valhalla/api/route/api-reference/), [OTP](https://docs.opentripplanner.org/en/latest/), [Navitia](https://doc.navitia.io/), [TfL](https://api-portal.tfl.gov.uk/products), [TransportAPI portail](https://developer.transportapi.com/), [TransportAPI conditions](https://www.transportapi.com/terms/).

**Vérification ORS actuelle :** les pages HeiGIT sont rendues en JavaScript et illisibles via l'extracteur web. Les ressources publiques liées par ces pages ont donc été lues en mémoire, sans compte ni fichier téléchargé dans le dépôt. Le plan Standard y porte `quota_max: 2e3`, `rate: 40`, `per: 60`, `quota_renewal_rate: 86400` pour Directions ; Matrix indique 500 et 40/min. Ces chiffres ne proviennent pas uniquement d'un ancien comparatif.

Ne pas intégrer l'ancien domaine ORS : l'équipe a annoncé son arrêt pour le 2–6 novembre 2026. La cible documentée est **`https://api.heigit.org/openrouteservice/v2/directions/...`**. L'annonce confirme également la correction CORS du nouveau domaine en mai 2026. [Annonce ORS](https://ask.openrouteservice.org/t/deprecating-api-openrouteservice-org-in-favour-of-api-heigit-org/7912/).

## 4. PWA, CORS, cache et conditions

| Solution | Pages et protection des clés | Cache / hors ligne | Conditions / attribution |
| --- | --- | --- | --- |
| ORS | JSON/GeoJSON compatible ; relais pour garder la clé privée | Réutilisation sous licence des résultats, cache local daté possible ; pas de nouveau calcul offline sans moteur/graphe | Résultats **CC-BY-SA 4.0**, attribution ORS/HeiGIT + OSM ; source/licence à conserver avec les résultats exportés |
| OSRM/FOSSGIS | HTTPS sans secret, choisir l'instance réelle du profil | Cache sélectif techniquement possible ; pas de collecte massive ; conditions complètes à confirmer avant conservation/distribution large | OSM/OSRM, lien « corriger la carte », Referer correct ; page complète FOSSGIS protégée par contrôle anti-robot pendant l'étude |
| GraphHopper | JSON ; doc avec clé en query, donc relais proposé | Conditions : **cache client temporaire** ; pas d'archive permanente/ZIP du cache par défaut ; redistribution API soumise à accord | GraphHopper sauf white-label, attribution données ; Free non commercial ; licence moteur distincte des CGU API |
| Valhalla/FOSSGIS | JSON ; X-Client-Id exige un préflight, ce n'est pas un secret | Cache sélectif à cadrer avec l'opérateur ; pas de moteur offline fourni à la PWA | Fair-use exploitant ; attribution Valhalla/OSM à prévoir ; données distinctes du code MIT |
| OTP | Serveur externe et CORS à configurer ; Pages ne l'exécute pas | Selon droits des flux ; calcul offline exige moteur/graphe distinct | LGPL logiciel, licences GTFS/NeTEx/temps réel à vérifier par flux |
| Navitia | Token privé, relais ; CORS selon déploiement | TTL et droits contractuels ; pas d'autorisation universelle présumée | Feed publishers et conditions de l'autorité |
| TfL | Anonyme sans secret envisageable pour Londres ; clé enregistrée côté relais si utilisée | Fraîcheur courte et droits de conservation à confirmer avant activation ; pas de temps réel offline | Conditions TfL et attribution correspondante, sans présenter Roam comme officiel |
| TransportAPI | Relais pour identifiants ; CORS direct non validé | Conditions/fraîcheur par produit, pas de cache permanent mutualisé présumé | Contrat et attributions des sources par produit |

Sources : [conditions HeiGIT](https://account.heigit.org/info/tos), [conditions GraphHopper, sections 3 et 5](https://www.graphhopper.com/terms/), [licence OSM](https://www.openstreetmap.org/copyright), [politique OSRM](https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy), [import OTP](https://docs.opentripplanner.org/en/latest/Basic-Tutorial/), [Navitia](https://doc.navitia.io/), [conditions TfL](https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service), [FAQ TfL](https://api-portal.tfl.gov.uk/faq), [TransportAPI conditions](https://www.transportapi.com/terms/).

Les conditions HeiGIT ont été lues dans le composant public Terms lié à leur page : licence CC-BY-SA 4.0 explicite pour les résultats ORS. La page TfL consultée n'a livré que son introduction ; ses obligations détaillées restent à confirmer. Le cache technique et l'export de résultats demandent des règles par fournisseur, indépendantes de la licence du logiciel.

### Observation CORS ponctuelle

Cinq **OPTIONS**, sans clé, coordonnées ni calcul routier, avec l'origine fictive `https://roam-study.invalid` :

| Endpoint | Résultat observé |
| --- | --- |
| ORS `/openrouteservice/v2/directions/driving-car/json` | 204 ; origine `*`, POST et authorization/content-type acceptés |
| FOSSGIS OSRM `/routed-car/route/v1/driving/` sans points | 400 avec origine `*` ; ne valide pas une vraie requête de routage |
| Valhalla `/route` | 204 ; origine `*`, GET/POST/OPTIONS, Content-Type et X-Client-Id |
| GraphHopper `/api/1/route` | 200 ; origine `*`, GET/POST/DELETE/OPTIONS |
| TfL `/Journey/JourneyResults/` sans lieux | 200 ; origine `*`, GET |

Ce contrôle établit une faisabilité ponctuelle, pas un contrat ni un test authentifié. Aucun calcul réel, aucune requête Navitia/TransportAPI exécutés. Avant activation : tester les succès et 401/403/429/5xx depuis la véritable origine Pages et le domaine personnalisé. `no-cors` ne permet pas de lire les réponses ; aucun proxy CORS public non maîtrisé proposé.

## 5. Intégration fonctionnelle proposée

### Successions par voyageur

1. Charger une fois les activités, voyageurs et trajets canoniques du voyage ; dériver les pistes en mémoire.
2. Résoudre les participants selon phase A. Sans voyageurs nommés, une piste collective historique existe seulement en mémoire ; ne pas créer d'IDs métier.
3. Construire une chronologie par personne et date. Une activité sans horaire/période représente une incertitude, pas un élément à ignorer silencieusement. Une idée sans date ne génère aucun trajet automatique.
4. Émettre les paires successives non ambiguës de chaque piste. Une paire explicitement choisie peut être estimée géographiquement sans horaire, sans diagnostic de ponctualité.
5. Regrouper les paires/paramètres équivalents en gardant les personnes concernées. Pas de déplacement imposé entre deux activités sans participant commun.

Exemple : A collective 09:00–10:00, B Alice 10:15–11:00, C Bob 10:30–11:00, D collective 11:30. Pistes : **A→B→D** pour Alice et **A→C→D** pour Bob. Ne pas créer B→C à partir de l'ordre global. Un parcours A→D identique pour deux personnes demande un seul calcul.

Même début/chevauchement sur la même piste : ordre ambigu et conflit conservé, pas de choix arbitraire. Les activités simultanées de personnes disjointes ne doivent pas bloquer leurs pistes respectives. La vue Tous peut montrer plusieurs déplacements avec leurs participants ; une marge globale unique serait trompeuse.

### Réutilisation des transports et correction

Préférence de transport choisie/confirmée, sans appeler plusieurs profils au rendu. Première correspondance : walk→marche, bicycle→vélo, car→voiture. Pour taxi, proposer une estimation routière qualifiée sans attente/prise en charge, après confirmation. Les autres modes restent manuels tant qu'un fournisseur approprié manque.

Chercher d'abord un Journey par références d'étapes ordonnées, dates et portée voyageurs, jamais par seul nom. Plusieurs candidats : choix explicite. Préserver IDs, lieux libres, étapes, nuits, réservations, coûts et documents. Calculer chaque segment admissible ; une somme ne représente le total que si segments, attentes et correspondances nécessaires sont connus. Inconnu ne signifie pas zéro.

Une estimation reste une suggestion. Son acceptation modifie un segment canonique via repository et contrôle de révision, sans créer un ManualTransfer parallèle ni une dépense au rendu. Une durée manuelle historique est prioritaire et n'est jamais remplacée silencieusement par un rafraîchissement.

### Détection de temps insuffisant

```text
fenêtre = début de B − fin de A
marge = fenêtre − durée effective − marge de sécurité choisie
```

Sur une paire ordonnée et une piste déterminée : marge négative = insuffisant, nulle = sans marge, positive = temps restant. Exemple : 20 min disponibles, 25 min de déplacement → manque 5 min, avant marge de sécurité. Montrer personnes, source et âge. Ne pas arrondir 20 min 30 s vers 20 min pour juger la faisabilité.

Durée effective : correction manuelle si présente, sinon estimation admissible pour les points/options actuels ; zéro explicite conservé. Pour TC, comparer l'arrivée proposée à B et inclure l'attente de départ, pas seulement le temps à bord.

Dates civiles, nuit, changement d'heure et France/R.-U. demandent les fuseaux validés des lieux. Ne pas convertir avec le fuseau du navigateur. Sans information suffisante : diagnostic inconnu, saisie manuelle disponible. Paris et Londres ont des heures locales différentes.

| Cas incomplet | Comportement proposé |
| --- | --- |
| GPS absent/invalide | Aucun appel ; proposer confirmation manuelle via géocodeur existant ; pas de géocodage automatique des adresses |
| Sans horaire / fin absente | Estimation géographique volontaire possible ; marge horaire inconnue |
| Participants disjoints / liste vide | Pas de liaison automatique ; conserver un transport explicitement enregistré sans lui attribuer une obligation commune |
| Points identiques | Ne pas fabriquer une distance routière ; vérifier si un déplacement entre entrées est réellement nul |
| GPS changé / référence supprimée | Résultat ancien invalidé ; instantané et correction conservés, à vérifier |
| Aucun chemin | État distinct de panne ; pas de distance à vol d'oiseau présentée comme route |
| Offline / quota / CORS / timeout | Fonctions manuelles disponibles ; cache autorisé daté/périmé ou inconnu, jamais zéro inventé |
| Mode non couvert | Durée manuelle/lien opérateur, sans vitesse moyenne présentée comme fiable |

## 6. Architecture technique et cache

```mermaid
flowchart LR
  D[Activités et trajets IndexedDB] --> P[Pistes par voyageur]
  P --> Q[Paires et paramètres dédupliqués]
  Q --> C[Cache local]
  C --> U[Programme et formulaire]
  Q -->|Action volontaire, cache manquant| A[Adaptateur de routage]
  A --> R[Relais facultatif, secret et quotas]
  R --> O[ORS ou autre fournisseur]
  O --> C
  U -->|Accepter ou corriger| J[Repository Journey et révision]
```

L'adaptateur normalise les valeurs en **secondes et mètres**, avec fournisseur/profil, date, validité et attribution/licence ; GeoJSON facultatif. Garder une conversion documentée vers le contrat existant en minutes. `fetch` et `AbortController` suffisent a priori, sans SDK supplémentaire. La carte reste une présentation facultative.

Clé de cache : version du format + fournisseur/endpoint/révision de profil + coordonnées **ordonnées** de toutes les étapes + mode + options d'accessibilité/évitement + contexte temporel si pertinent. A→B diffère de B→A. Des activités distinctes peuvent partager une estimation si tous ces paramètres correspondent. Les noms, notes et IDs voyageurs ne sont pas des entrées API.

Normaliser les nombres sans arrondi grossier fusionnant deux entrées séparées par une rivière. Dédupliquer entre voyageurs du même voyage, sans cache public transversal d'adresses personnelles par défaut. Pour TC, inclure date, heure exacte, fuseau, sens départ/arrivée et contraintes ; un arrondi arbitraire de cinq minutes peut manquer une correspondance. Une recherche par plage doit réellement demander une plage au fournisseur et sélectionner une solution valide.

Mesures initiales proposées — choix produit à valider, pas quotas ni droits imposés par les fournisseurs :

- Calcul à la demande pour une journée/segment, jamais au montage React ni sur tous les couples N².
- Une promesse par clé en vol, file d'attente et cadence conservatrice ; une annulation de vue ne supprime pas une requête encore attendue par une autre personne.
- Cache partagé via IndexedDB et verrou/bail entre onglets ; expiration si l'onglet ferme.
- TTL routier **7 jours**, puis périmé ; cache négatif court, par exemple 5 min. Pour GraphHopper/TfL/TransportAPI, aucune de ces durées ne vaut autorisation de conservation : adapter au contrat ou désactiver ce stockage.
- TC : réponse temps réel conservée brièvement, par exemple 1–5 min, avec limite de validité du calendrier. Offline : montrer une information enregistrée datée, jamais « temps réel ».
- LRU et plafond local, par exemple 1 000 résultats ou 10 Mio ; cache purgable sans effacer un trajet accepté ; géométrie bornée, aucune réponse brute inutile.
- Respect de Retry-After, backoff/retries bornés, coupe-circuit 401/403/429 ; aucune relance sur chaque rendu.

### Relais et sécurité des clés

GitHub Pages ne conserve aucun secret serveur. Une clé dans `VITE_*`, minifiée, dans IndexedDB/localStorage ou injectée par un secret GitHub dans le bundle reste lisible par le navigateur. Le relais garde la clé dans un gestionnaire de secrets, hors frontend, ZIP et cache.

Exemple : Workers Free annonce **100 000 requêtes/jour** ; une offre gratuite peut suffire au relais. Vérifier simultanément limites CPU, stockage, sous-requêtes et services annexes avant choix final. Rester sur les seuls plans gratuits retenus, avec refus au plafond et aucune bascule facturée automatique. [Prix Workers](https://developers.cloudflare.com/workers/platform/pricing/), [secrets Workers](https://developers.cloudflare.com/workers/configuration/secrets/).

Une liste CORS ne bloque pas les scripts externes appelant le relais. Prévoir hôte fournisseur fixe (aucun proxy libre/SSRF), validation stricte des profils/points et tailles, limite par utilisateur/session ou IP, **quota global atomique**, coupe-circuit et anti-abus adapté. Un compteur en mémoire d'une seule instance ou éventuellement cohérent ne garantit pas un plafond global. Choisir un mécanisme dans une enveloppe gratuite, en tester la saturation ; à défaut, conserver une bêta privée ou ne pas activer le service public.

Transmettre uniquement points/options et, si nécessaire, heure : ni voyageurs, titres, notes, réservations ni documents. Les GPS/heures révèlent néanmoins des déplacements ; informer avant activation, désactiver les logs de corps, minimiser la rétention. Une panne du relais ne bloque jamais lecture, édition ou sauvegarde du voyage. Aucun compte ni service n'a été créé pour cette étude.

## 7. Évolutions possibles du modèle

Proposition seulement ; aucun schéma appliqué.

| Donnée | Proposition | Persistance/partage |
| --- | --- | --- |
| Activités | Conserver `participantIds?` et règles de phase A | Inchangé |
| Participants Journey | Éventuel `participantIds?`. Absence = portée historique non précisée, sans attribution automatique de chaque ancien trajet à tous | Facultatif ; valider suppression voyageur/filtres/backups |
| Durée segment | `durationMinutes?` reste la durée effective utilisée par l'existant ; historique présumé manuel ; provenance explicite pour nouvelles estimations acceptées | Décision utilisateur, journalisée avec CAS |
| Distance | `distanceMeters?`, finie et positive ou nulle | Sur segment accepté, pas sur activité |
| Estimation acceptée | Métadonnées bornées : fournisseur, profil, dates, empreinte points/options, licence/attribution, durée brute en secondes, distance brute | Seulement si conservation/export autorisés ; pas de réponse fournisseur entière |
| Correction | Marqueur manuel explicite et données d'origine conservées selon droits ; absence/effacement/zéro distincts | Fonction unique de résolution de durée pour Programme, carte et projection |
| Cache technique | Table ou base IndexedDB séparée, versionnée et reconstructible | Exclue journal/outbox, ZIP et future réplication |
| Géométrie | Locale et facultative au premier lot | Exclue des sauvegardes initialement ; droits/volume/versionnement à valider ensuite |
| Paramètres privés | Secret exclusivement serveur ; paramètres client sans secret | Jamais exportés/synchronisés |

Pour éviter deux vérités, la correction écrit la durée effective et sa provenance manuelle. « Revenir à l'estimation » est une action explicite, pas un effet de rafraîchissement. Changer de mode/points marque l'ancien résultat à vérifier sans effacer silencieusement une correction.

Migration additive, sans backfill de durées/distances ni nouvelles personnes. Si une table est ajoutée à `RoamDatabase`, prévoir une version Dexie suivante et son exclusion des parcours génériques utilisant `database.tables`. Une petite base de cache distincte réduit ce couplage mais exige son cycle de nettoyage. Aucun de ces choix n'est appliqué ici.

Auditer ensemble validateurs, repositories, projection `manualTransfers`, journal, duplication, export et restauration : ajouter un champ TypeScript ne garantit pas sa préservation par les parseurs. Les décisions acceptées doivent résister à duplication/ZIP2 ; ZIP1 historique reste lisible. Si le format existant ne garantit pas provenance/versions/licences, faire évoluer explicitement son contrat plutôt que perdre silencieusement ces champs.

**Préservation de la synchronisation gratuite :** cache et requêtes ne créent aucune opération de synchronisation ; seules les décisions utilisateur sur Journey passent dans le journal existant. La future réplication transmettrait ces petites décisions, pas des réponses brutes/géométries. Aucun backend de synchronisation payant n'est requis. Le relais de routage reste indépendant du futur transport de synchronisation et n'est pas une sauvegarde distante du voyage.

## 8. Risques techniques et financiers

| Risque | Conséquence | Réponse |
| --- | --- | --- |
| Quota commun d'une clé ORS | Saturation par plusieurs voyages/personnes | Cache/déduplication, quota global et arrêt ; aucune bascule payante |
| Démo retirée/ralentie | Estimations indisponibles | Démo pour prototype, adaptateur remplaçable, manuel toujours disponible |
| Relais abusé | Quota épuisé, surcoût si plan mal choisi | Anti-abus, plafonds gratuits atomiques et validation avant publication |
| CGU/licences | Conservation/redistribution non autorisée | Politique par fournisseur, provenance/attribution ; pas d'export/cache permanent présumé |
| Durée trompeuse | Activité/correspondance manquée | Source/date, marge optionnelle, trafic/attente non supposés, TC distinct |
| Ordre global | Faux trajets entre voyageurs disjoints | Pistes individuelles, ambiguïtés explicites |
| Concurrence/résultat obsolète | Durée manuelle écrasée ou mauvais trajet | Empreinte des entrées et CAS après réseau |
| France↔R.-U., îles, ferries/Eurostar | Profil routier inadapté | Ne pas garantir traversées, accessibilité ni horaires |
| Offline trop largement promis | Cache évincé, nouvelle route impossible | Lecture locale des valeurs enregistrées seulement, carte facultative |
| Réponses/géométries volumineuses | ZIP/outbox/bande passante gonflés | Cache exclu, géométrie différée, plafonds et aucun N² |
| Données TC incomplètes | Mauvaises correspondances ou dates non couvertes | Validation par réseau/date/contrat, aucun service national présumé |

Dimensionnement illustratif : 20 activités sur une piste linéaire donnent 19 liaisons. Quatre voyageurs suivant le même parcours nécessitent **19 calculs uniques**, pas 76, avant hits de cache. Cent voyages recalculant ces 19 liaisons représentent 1 900 appels, proches du quota ORS 2 000/24 h : il est commun à la clé, pas accordé à chaque utilisateur. Les programmes divergents, modes alternatifs et actualisations accroissent ce volume.

## 9. Plan progressif après validation

| Lot | Périmètre | Critère de sortie |
| --- | --- | --- |
| 0 — Décision | ORS/relais facultatif ou Pages strict ; modes, conservation et portée voyageurs des transports | Aucun secret client/contrat payant obligatoire ; choix validés |
| 1 — Calcul pur | Pistes, paires, durées manuelles et incertitudes | Tests sans réseau et phase A intacte |
| 2 — Prototype isolé | Adaptateur simulé puis quelques essais fictifs France/R.-U. ; relais si accepté | Unités/CORS/erreurs vérifiés, clé protégée, quotas maîtrisés |
| 3 — Cache | Déduplication voyageurs/onglets, TTL, invalidation, offline, plafonds | Cache exclu sync/ZIP, éviction sans impact métier |
| 4 — Programme | Action Estimer, provenance, participants/marge et correction | Mobile/clavier, aucune écriture automatique ni remplacement silencieux |
| 5 — Acceptation | Segment canonique, provenance/distance, projection et sauvegardes | CAS/rollback, ZIP1/ZIP2, duplication/réouverture |
| 6 — Carte/hébergements | Tracés facultatifs puis raccourcis avec sélection de séjour | Même source que Programme, autonome/multi-étapes conservés |
| 7 — TC régional | Licence/couverture TfL ou autorité française puis adaptateur horaire | Coût/couverture validés, attente/correspondances/fuseaux testés |

Il s'agit d'un ordre proposé, pas d'une autorisation de développer. Un moteur WASM et des graphes France/R.-U. téléchargés dans le navigateur constitueraient un chantier distinct de volume, mises à jour et licences.

## 10. Stratégie de tests automatisés

Réutiliser TypeScript et Chrome headless existants, `fetch` injectable, horloge simulée et bases/profils fictifs `roam-v2-test-*`. Aucun test CI ne doit consommer un quota public ni utiliser une clé privée frontend ou les données réelles.

| Niveau | Cas nécessaires |
| --- | --- |
| Participants | Tous, groupes disjoints, sous-groupes, séparation/regroupement, collectif absent, liste vide, voyage sans noms, suppression/renommage, simultanéité sur pistes distinctes/communes |
| Ordre et horaires | A→B→D/A→C→D, idées/période/sans fin, conflit, zéro, nuit/minuit, DST et fuseaux France/R.-U. ; activité incertaine jamais ignorée |
| Profils/réponses | Marche/vélo/voiture, taxi qualifié, TC/avion/bateau refusés par adaptateur routier ; mètres/secondes/minutes, GPS zéro/négatifs/±180, valeurs négatives/NaN, réponse malformée/volumineuse, aucun chemin |
| Marge | 20 min disponibles/25 nécessaires, égalité, marge de sécurité, arrondi conservateur, attente TC ; alertes uniquement pour personnes concernées |
| Cache | Sens A→B/B→A, fournisseur/mode/options/GPS/date/fuseau ; TTL, horloge reculant, corruption/LRU/quota local, négatif, aucun partage TC avec départ différent |
| Réseau/concurrence | Une promesse pour plusieurs voyageurs/vues, deux onglets et bail expiré, annulation partielle, réponse périmée après édition, 401/403/429/Retry-After, timeout/backoff borné |
| Métier | Application volontaire, priorité manuelle, retour explicite à estimation, CAS après réseau, rollback journal ; estimation seule sans nouveau Journey/dépense |
| Historiques/ZIP | Migration sans mutation, ZIP1 V4/V5→V6, ZIP2, réouverture/duplication, documents SHA-256 inchangés, tombstones, autonome/multi-étapes ; aucun cache/secret/URL authentifiée dans ZIP/outbox |
| Relais | Refus SSRF/profil/tailles, anti-abus, quotas globaux atomiques entre instances, logs minimaux ; saturation gratuite = refus, pas facturation |
| Interface | 320/375 px et bureau, clavier/lecteur d'écran, sans carte, noms longs, filtre, focus/saisie conservés, source/âge/périmé, Jour/Multi-jours sans doublon |
| Phase A | Relancer l'intégralité des suites participants, conflits, filtres, suppression, migrations et sauvegardes de référence |

Des tests live facultatifs, désactivés par défaut et utilisant un secret uniquement côté serveur, pourront contrôler quelques trajets fictifs Paris/Lyon/Londres et les réponses CORS réelles. Pas de tests de charge sur les démos. Attribution et droits de conservation sont des critères de validation avant diffusion.

## 11. Points à valider avant implémentation

1. Relais gratuit externe accepté ou Pages strict sans clé privée.
2. Modes initiaux marche/vélo/voiture, déclenchement volontaire, priorité manuelle.
3. Participants sur nouveaux transports et interprétation conservatrice des historiques.
4. TTL/plafonds, conservation/export des résultats acceptés et droits détaillés des futurs fournisseurs TC.
5. Autorisation ultérieure d'un prototype isolé, distincte de toute publication.

**Aucune implémentation commencée. Attendre la validation de cette étude avant le lot suivant.**
