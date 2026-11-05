# Aperçu d'activité — 2.5.5c

MapLibre GL JS 6.16.0 est installé localement (BSD-3-Clause), avec son worker et
son CSS empaquetés par Vite. Pas de CDN, de clé ni de serveur de styles distant.
La fiche charge dynamiquement l'adaptateur seulement avec une paire GPS valide et
un signal réseau disponible. Le précache PWA exclut les fichiers maplibrePreview-*
et maplibre-gl-worker-* afin de ne pas télécharger cette dépendance optionnelle
à l'installation. Le build vérifie leur présence et leur exclusion. Les ressources
applicatives nécessaires au démarrage hors ligne restent précachées.

## Fond et conditions vérifiées le 4 novembre 2026

- https://maplibre.org/maplibre-gl-js/docs/ : intégration npm/Vite et worker v6.
- https://operations.osmfoundation.org/policies/tiles/ : fond public OSM raster,
  URL exacte https://tile.openstreetmap.org/{z}/{x}/{y}.png, attribution visible,
  Referer valide, cache HTTP respecté, aucun bulk download/préchargement/offline.
- https://www.openstreetmap.org/copyright : données des contributeurs, ODbL.

La configuration du fond est isolée dans osmRaster.ts. Le navigateur envoie son
User-Agent normal et un Referer limité à l'origine (strict-origin-when-cross-origin),
jamais de no-cache/no-store. Le cache HTTP standard est laissé au navigateur ;
aucune tuile n'est ajoutée à IndexedDB ou au cache statique du service worker.
L'attribution est visible sous la carte, sans bascule cachée ; lien de signalement
OSM présent. Le service est best-effort sans SLA et peut bloquer les usages lourds.
Prévoir un autre fournisseur ou une instance propre si la fréquentation augmente.
Aucun nom de voyage/activité n'est envoyé ; les indices des tuiles révèlent la zone
consultée au fournisseur. Aucune position d'appareil n'est demandée.

## Comportement et limites

Centre et marqueur utilisent longitude,latitude, y compris zéro et valeurs négatives.
Le nom est rendu en texte, jamais via setHTML. Un worker, quatre images simultanées,
zoom initial 14/max 18, pas de rotation, molette désactivée et gestes coopératifs
(2 doigts sur mobile) limitent le coût et préservent le défilement de la fiche.
Les boutons de zoom font au moins 44 px et les libellés sont en français.

Les textes/adresses/GPS restent hors de la carte et lisibles sans réseau. Un signal
offline démonte l'aperçu ; online ne garantit pas les tuiles. Import, WebGL ou réseau
en erreur affichent un message et un retry explicite. Le délai initial est 20 s.
Une erreur de tuile ne disparaît pas sur un idle trompeur ; retry ou changement de
coordonnées permettent de recommencer. Le fond Web Mercator ne couvre pas les pôles
au-delà de ±85.051129° : message explicite, aucune modification des coordonnées.

Les coordonnées/nom se mettent à jour via props et useLiveQuery déjà existants.
Chaque fermeture déconnecte ResizeObserver, annule la frame/timer, retire marqueur
et carte (listeners/worker libérés par MapLibre). Un import terminé après fermeture
ne crée pas de carte. Pas de modification Dexie/ZIP, de géocodage, d'itinéraire ou
de carte globale. Le module MapLibre est volumineux mais indépendant du bundle initial.

## Tests Windows

Depuis roam-v2 : npm.cmd run lint ; npm.cmd run build ; npm.cmd run test:pwa ;
npm.cmd run dev puis /tests/activities.html. Tests de données/lifecycle et UI avec
un moteur simulé : aucune tuile ni WebGL réel utilisés par la suite.

Sur une origine de test, consulter une fiche avec et sans GPS, avec 0/0 et des
valeurs négatives. Vérifier centre/marqueur, nom, zoom clavier/mobile, défilement
avec un/deux doigts et attribution. Modifier le lieu dans un autre onglet : centre
et marqueur actualisés sans refermer la fiche. Fermer pendant le chargement.
Tester à 320/375 px et avec WebGL désactivé. Network > Offline conserve les textes ;
bloquer tile.openstreetmap.org simule l'échec des tuiles et doit conserver le message
d'erreur. Vérifier les headers Referer, l'usage du cache HTTP et les requêtes limitées
au viewport. Contrôler qu'aucune géolocalisation n'est demandée.

En preview de production, vérifier Network : aucun maplibrePreview/worker avant
ouverture d'une fiche avec GPS ; Cache Storage ne doit pas contenir ces fichiers
ni aucune tuile OSM. Retester sous un sous-chemin (--base=/roam-v2/) sur une origine
locale de test distincte, sans vider le stockage utilisateur. Les navigateurs peuvent
évincer leurs caches HTTP ; aucune disponibilité de fond hors ligne n'est garantie.

# Carte globale du voyage — 2.7a

L'onglet Carte monte TripMap uniquement pour le voyage actif. Une seule requête
`listActivities(trip.id)` avec useLiveQuery alimente marqueurs, liste et compteurs.
Les idées et activités hors séjour sont incluses ; aucun trajet/itinéraire/filtre
avancé n'est ajouté. Les voyages, activités et sauvegardes ne sont pas modifiés.

## Modules et cadrage

- tripMapModel.ts réutilise activityMapPoint/validateCoordinates : absence, null,
  chaînes, valeurs non finies ou hors bornes n'engendrent pas de marqueur. Zéro et
  valeurs négatives sont valides. Chaque activité GPS conserve son propre id.
- Le cadrage initial supprime le plus grand arc vide des longitudes : +179/-179
  donnent une largeur de 2°, pas 358°. Les positions rendues peuvent utiliser une
  longitude équivalente au-delà de 180°, sans changer les GPS d'origine. Les copies
  du fond sont activées pour assurer la continuité à l'antiméridien.
- Un point unique (ou plusieurs points identiques) utilise le zoom 14. Plusieurs
  points sont cadrés avec une marge et un zoom maximal 14 (minimum −2 pour les
  vues très étendues sur petit écran). La caméra n'est ensuite
  déplacée que par l'utilisateur ou par Recentrer. Un simple ajout, déplacement,
  changement de nom ou retrait d'un marqueur ne recentre pas la carte.
- Un marqueur DOM par activité représentable. Les points identiques restent
  superposés, sans coordonnées inventées ; leur bouton indique le nombre présent
  au même endroit et ouvre une liste textuelle de toutes les activités concernées.
  Tous les lieux restent aussi accessibles dans la liste permanente, y compris
  au clavier. Les noms sont insérés avec textContent/setDOMContent, jamais setHTML.
- Limite du fond Mercator réutilisé : au-delà de ±85,051129°, le GPS est valide et
  compté mais non représenté par un marqueur sur ce fond. L'activité reste dans la
  liste, avec ses coordonnées exactes et une explication de cette limite.

## Chargement, erreurs et réseau

tripMapSession.ts importe le même adaptateur maplibrePreview que l'aperçu individuel.
Le worker/CSS MapLibre restent dans le chunk différé déjà exclu du précache PWA.
Aucun import MapLibre n'est demandé si la carte est vide, hors connexion ou ne
contient que des points polaires. Un import terminé après démontage/timeout ne
monte aucune carte. Dispose nettoie carte, marqueurs, popup, observateur et frame.
Une nouvelle session (autre voyage, retry, retour en ligne) effectue un nouveau
cadrage initial ; la préservation de caméra concerne les mises à jour d'une
session ouverte, pas une restauration persistée de vue entre onglets.

Le délai initial/recentrage est 20 s. Les erreurs d'import, WebGL, timeout et tuiles
ont un message et une action de retry. Les erreurs de tuiles restent visibles
jusqu'au retry ; idle ne les efface pas. Un signal offline démonte le rendu et
conserve la liste locale, les lieux, adresses, dates et GPS. navigator.onLine
n'est pas une garantie d'accès au fournisseur. Aucune géolocalisation d'appareil.

Le fond, cache HTTP, Referer et limites de parallélisme de l'aperçu sont réutilisés.
Pas de préchargement massif, cache de tuiles applicatif ou téléchargement hors
connexion. L'attribution reste visible sous la carte. Conditions officielles
revérifiées le 5 novembre 2026 :
https://operations.osmfoundation.org/policies/tiles/
API MapLibre (fitBounds, marqueurs et cycle de vie) :
https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/

## Tests et vérifications manuelles 2.7a

Depuis roam-v2 sous PowerShell :

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:pwa
npm.cmd run dev
```

Ouvrir /tests/activities.html. tripMap.browser.tsx teste les GPS et arc minimal,
points identiques/±180, cadrage initial puis explicite seulement, chargement tardif,
erreurs/timeout/dispose, requête unique, mises à jour après CRUD réel dans une base
isolée, compteurs, retry, offline, changement de voyage et largeur mobile. Le moteur
est simulé : aucune tuile ou disponibilité réelle du fournisseur n'est requise.
La suite individuelle mapPreview reste exécutée sans suppression de contrôles.

Restent à tester avec WebGL et tuiles réels, sur desktop et téléphone 375 px :

1. Voyage vide puis un point 0/0, plusieurs points, points négatifs et +179/-179.
   Contrôler le cadrage initial, les marqueurs, zoom et Recentrer. Vérifier les
   lieux identiques via popup et liste ; aucun marqueur de fausses coordonnées.
2. Déplacer/zoomer manuellement puis modifier/ajouter/supprimer une activité dans
   un autre onglet. Marqueurs et liste s'actualisent sans mouvement de caméra.
   Recentrer utilise les nouveaux points. Changer de voyage : aucun ancien lieu.
3. Tab/Entrée sur marqueurs, zoom et Recentrer ; popup fermé par bouton et Échap,
   retour au marqueur, gestes coopératifs à deux doigts et défilement vertical.
4. Network Offline et blocage tile.openstreetmap.org : liste toujours lisible,
   erreur compréhensible et retry. Désactiver WebGL et vérifier le repli textuel.
5. Build/preview : aucun MapLibre/worker avant ouverture d'une carte avec GPS ;
   aucun cache applicatif de tuiles, aucune écriture IndexedDB, exclusion des
   ressources MapLibre du précache. Tester aussi le sous-chemin de déploiement.

### 2.7b — Sélection sur la carte du voyage

Les boutons marqueurs transmettent les identifiants du point sélectionné à React.
L’aperçu et la liste partagent une sélection, sans requête IndexedDB supplémentaire.
Les points identiques (y compris ±180°) proposent un choix explicite d’activité.
La carte reste montée derrière la fiche et le formulaire existants : ouvrir,
fermer ou modifier une activité ne déclenche aucun cadrage. Seul Recentrer le fait.
La sélection est réinitialisée au changement de voyage et les détails sont dérivés
à chaque actualisation de la requête réactive ; une activité disparue n’a plus de fiche.

Tests : `/tests/activities.html` couvre sélection, doublons, liste, ouverture/retour,
caméra sans nouveau montage, focus/Échap, modifications et suppression pendant la fiche.
Le moteur cartographique est simulé dans ces tests d’interface.
Vérifier aussi avec MapLibre réel sur desktop et téléphone (375 px) : toucher et
Entrée/Espace sur les marqueurs, choix des activités superposées, style sélectionné,
zoom/déplacement puis fiche → Retour, fiche → Modifier → Enregistrer, hors connexion
via la liste, changement de voyage et modification/suppression depuis un autre onglet.

### 2.7c — Filtrer par journée

« Tout le voyage » inclut les idées sans date et les activités hors séjour.
« Journée » propose les dates du séjour, bornes incluses, avec les utilitaires UTC
existants (aucune conversion de fuseau). Une seule requête `useLiveQuery` par voyage
alimente le filtrage en mémoire, les marqueurs, les compteurs et la liste.
Les journées vides et celles sans GPS ont des messages distincts ; les activités
sans GPS restent dans la liste. Les aperçus/fiches sortant du filtre sont fermés.

Les changements volontaires du mode ou de la date déclenchent un cadrage sur les
points filtrés. Les actualisations IndexedDB, sélections et retours depuis une fiche
ne déclenchent pas de cadrage. Lorsqu’il n’existe aucun point affichable, la carte
est démontée ; le retour à un filtre contenant des points produit un cadrage initial.

`App` mémorise le mode de filtre par voyage pendant la session et réutilise la date
du Programme au retour dans Carte. Les actions du filtre transmettent la date au
Programme sans changer sa présentation Jour/Multi-jours/Calendrier/Idées. Les mises
à jour ne transitent pas par des effets réciproques : aucune boucle de synchronisation.
Les fiches restent superposées à la carte montée et conservent filtre et caméra.
L’état de navigation n’est pas écrit dans IndexedDB et revient au défaut au rechargement.

`tests/tripMapFiltering.browser.tsx`, intégré à `/tests/activities.html`, vérifie :
filtre global/journée, dates décembre–janvier, compteurs/listes/marqueurs cohérents,
jour vide ou sans GPS, exclusion des idées/hors séjour en vue journée, isolation,
invalidation de sélection après déplacement d’activité, absence de requête redondante,
recentrage volontaire, caméra inchangée après modification et aller-retour fiche,
synchronisation entre onglets sans boucle, contrôles labellisés/tactiles et 375 px.
Les composants Programme et Carte sont utilisés dans un parent reproduisant le contrat
navigation d’App, avec une base synthétique isolée et un moteur de carte simulé.

Validation Windows PowerShell depuis `roam-v2/` :

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:pwa
npm.cmd run dev
```

Ouvrir `/tests/activities.html`, lancer la suite. Avec MapLibre réel, vérifier aussi :
- Choisir une journée dans Programme puis ouvrir Carte, passer en Journée.
- Choisir une autre date dans Carte puis revenir au Programme (y compris calendrier).
- Déplacer/zoomer la carte, ouvrir une fiche, la fermer : même filtre et caméra.
- Modifier la date d’une activité depuis un autre onglet : disparition du filtre
  et fermeture de sa sélection, sans recentrer les marqueurs restants.
- Journées vides/sans GPS, voyage court, petits écrans, clavier et hors connexion.

### 2.7d — Déplacements manuels sur la carte

`tripMapTransfers.ts` produit des vues et des géométries sans écriture : seuls les
transferts déjà enregistrés sont considérés. Les deux activités doivent figurer dans
le filtre actif, appartenir au voyage, avoir des GPS valides et affichables en Web
Mercator, et être consécutives dans le bon sens dans une même journée datée.
Les avertissements de `transferPlacement` (autre journée, inversion, activité
intercalée) excluent la liaison de la carte. Les liens absents, auto-référencés,
malformés ou aux identifiants dupliqués sont également masqués. Ces exclusions ne
suppriment aucune donnée : les déplacements restent gérables dans le Programme.

Les segments en pointillés représentent **des liaisons indicatives à vol d’oiseau,
pas des itinéraires routiers ou piétons**. Il n’y a ni appel de routage, ni estimation
de distance, de durée ou de coût. Les valeurs absentes restent absentes et zéro est
affiché. Aucune conversion ni addition aux montants des activités n’est réalisée.
Les onze modes utilisent des couleurs distinctes, complétées par leurs libellés.
Les passages de l’antiméridien suivent le petit arc et sont découpés à ±180°.
Deux activités aux mêmes coordonnées produisent un halo, sans faux parcours.
Les coordonnées stockées ne sont jamais modifiées.

`tripTransferLayer.ts` ajoute une source GeoJSON et des couches MapLibre au chargement
du style, sans attendre les tuiles. La zone de clic est élargie, les liaisons
superposées proposent un choix et les segments/copies du monde sont dédupliqués.
La source est actualisée après modification ou suppression sans recréer/recentrer
la carte. Les événements tardifs sont ignorés et les écouteurs retirés au démontage.
La documentation de référence est l’[API MapLibre Map](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/).

La liste « Déplacements manuels » fournit les mêmes aperçus au clavier et hors
connexion, avec Échap et retour du focus. Une sélection de liaison et une sélection
d’activité sont exclusives ; aucune ne déplace la caméra. Les filtres, la fiche
activité et la navigation de 2.7a–c restent inchangés. Le rendu réutilise la requête
réactive des activités et les transferts de l’objet voyage. La vérification du parent
par `listActivities` peut normalement invalider sa requête lorsqu’un voyage change ;
aucune requête dédiée aux liaisons n’est ajoutée.

Tests automatisés dans `tests/tripMapTransfers.browser.tsx` via `/tests/activities.html` :
- validation, onze modes, données facultatives/zéro, isolation et filtres ;
- ordre/journée incohérents, GPS incomplets/invalides/polaires, doublons d’identifiant ;
- mêmes coordonnées, passages ±180°, immutabilité ;
- adaptateur MapLibre simulé : style différé sans tuiles, source/couches, sélection,
  suppression, rechargement du style, erreurs et nettoyage des écouteurs ;
- session différée et événements après démontage ;
- base isolée : modifications/suppression réactives, sélection et chevauchement des
  liaisons, filtres, retour de fiche, caméra stable, clavier/Échap, offline et 375 px.

Contrôles manuels avec MapLibre réel :
1. Deux activités GPS consécutives et un transfert : ligne en pointillés, aperçu au
   clic/toucher, mode/durée/coût identiques au Programme.
2. Plusieurs transferts superposés : choisir chacun ; vérifier aussi la liste au clavier.
3. Deux activités au même lieu : halo visible autour du marqueur, accès via la liste.
4. Activités à 179° et −179° : liaison courte au passage de date, pas de traversée du monde.
5. Changer le filtre, zoomer/déplacer puis ouvrir/fermer une fiche : mêmes règles de caméra.
6. Modifier un GPS, une heure ou un transfert dans un second onglet : mise à jour ou
   masquage sans suppression des données ; supprimer un transfert sélectionné ferme son aperçu.
7. Téléphone/375 px, tuiles indisponibles et hors connexion : liste et détails restent lisibles.

Validation PowerShell : `npm.cmd run lint`, `npm.cmd run build`, `npm.cmd run test:pwa`,
puis `npm.cmd run dev` et lancer `/tests/activities.html`.
