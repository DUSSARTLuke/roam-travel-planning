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
