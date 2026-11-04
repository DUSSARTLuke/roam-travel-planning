# Recherche de lieux — 2.5.5b

## Photon, documentation consultée le 4 novembre 2026

- https://photon.komoot.io/ — usage raisonnable autorisé ; les usages intensifs
  peuvent être ralentis ou bloqués, sans garantie de disponibilité.
- https://github.com/komoot/photon — serveur public de démonstration ; envisager
  une instance propre pour un déploiement à forte fréquentation.
- https://github.com/komoot/photon/blob/master/docs/api-v1.md — `/api/`, `q`,
  `lang=fr`, `limit=5`, résultats GeoJSON Point en ordre longitude, latitude.

Le fournisseur isolé implémente PlaceProvider ; son remplacement ne nécessite
pas de changer le modèle des activités. Aucune carte, recherche inverse ou
position de l'appareil n'est utilisée. L'attribution Photon/OpenStreetMap est
visible sous la recherche, avec lien vers les mentions OSM.

## Requêtes et validation

Pas de requête à l'ouverture. Minimum 3 caractères, maximum 200, debounce 650 ms,
5 résultats maximum. Le fournisseur partagé espace les départs d'au moins 1,5 s
par onglet, sans accumuler des créneaux pour les requêtes annulées. Ce choix est
une précaution Roam, pas un quota garanti par Photon. Une réponse 429 impose une
pause d'au moins une minute, prolongée selon Retry-After (secondes ou date HTTP).
Pas de retry automatique. Cache mémoire de 20 recherches maximum pendant cinq
minutes, aucune persistance des requêtes ou résultats non sélectionnés.

La recherche saisie est envoyée au serveur public. Aucun identifiant de voyage,
montant, note, document, cookie ou coordonnée appareil n'est joint ; credentials
omit, referrer no-referrer, cache no-store. Le cache statique du service worker
ne prend pas en charge ces appels externes. Les garanties de confidentialité du
serveur public ne sont pas celles d'un serveur Roam contrôlé.

Chaque réponse est contrôlée : HTTP, Content-Type, JSON borné à 128 K caractères,
collection de 20 éléments maximum, Point à deux coordonnées finies dans les
limites GPS, libellés textuels bornés. Une collection GeoJSON peut omettre son
champ type comme dans l'exemple de la documentation ; s'il existe, il doit être
FeatureCollection. Un résultat invalide refuse la réponse entière. Aucun contenu
HTML n'est interprété. Timeout 10 secondes, annulation via AbortController.

Le contrôleur invalide chaque ancienne génération, même si le fournisseur ignore
l'annulation. Changer la saisie, fermer les résultats, perdre le réseau ou démonter
le composant annule timers/requête. Le signal online ne garantit pas le service :
les erreurs HTTP/réseau/JSON/timeout laissent toujours disponible la saisie manuelle.
Le retour en ligne peut relancer une recherche déjà demandée ; aucune recherche
n'est lancée sur une saisie initiale vide. La limitation est locale à l'onglet,
pas un quota global entre utilisateurs ou fenêtres ; ne pas automatiser des volumes.

## Sélection et stockage

Choisir un lieu renseigne seulement le brouillon : location, address, latitude et
longitude. Les coordonnées du formulaire restent du texte décimal ; le pipeline
existant les valide et stocke des nombres uniquement à l'enregistrement explicite.
Une localisation non vide (même une coordonnée partielle) exige confirmation avant
remplacement. La confirmation utilise les dernières valeurs du formulaire pour
préserver les notes et autres modifications. Annuler conserve la localisation.
Le fournisseur ne modifie ni IndexedDB, ni Dexie V4, ni le ZIP format 1. Hors ligne,
les lieux enregistrés et la saisie manuelle fonctionnent sans dépendance au service.

## Vérifications

Sous PowerShell depuis roam-v2 : npm.cmd run lint ; npm.cmd run build ; npm.cmd run dev.
Lancer `/tests/activities.html`. Les tests fournisseur, contrôleur et UI utilisent
uniquement des réponses simulées, jamais le serveur public. Les tests UI attendent
le debounce réel quelques secondes. Aucun test n'utilise la position de l'appareil.

Manuellement : rechercher un lieu et une adresse, vérifier pertinence, ville/pays,
remplissage puis modification manuelle sans soumission automatique. Tester clavier
(flèches/Entrée/Échap/Tab), lecteur d'écran, longue adresse à 320/375 px, remplacement
confirmé/annulé et texte saisi pendant l'attente. Passer offline : champs manuels
et consultation préservés. Bloquer Photon dans Network pour vérifier l'erreur ;
fermer le panneau pendant une requête. Vérifier Network : uniquement /api/?q=...,
lang=fr et limit=5, jamais lat/lon ; pas de requête à l'ouverture du formulaire.
Confirmer l'accès CORS depuis Chrome sur l'origine locale et un build production.
