# Correctif V2.1 — recherche des lieux des déplacements et carte

## Diagnostic

Le modèle des lieux libres accepte un nom/adresse sans GPS. Aucun géocodage implicite n’existe : la reproduction Gatwick → East Croydon avec les seuls noms produit zéro marqueur et zéro liaison, mais conserve le déplacement dans la liste et permet l’ouverture de sa fiche. Aucune donnée réelle du téléphone n’a été consultée pour établir cette reproduction.

Le filtre journée utilise la date de départ du déplacement ; les trajets d’une autre date ou sans date ne figurent que dans le filtre approprié/Tout le voyage. Le filtre Afficher les déplacements peut également les masquer. Une liaison exige deux extrémités GPS valides et un segment dans le bon ordre. Les limites de projection de la carte s’appliquent aussi ; aucune coordonnée ni liaison manquante n’est inventée.

## Modifications

- `ActivityPlaceSearch.tsx` : contrat générique limité aux champs de localisation, libellé/aide personnalisables, restauration du focus ; fournisseur Photon, annulation, debounce, validation et confirmation de remplacement existants conservés.
- `JourneyFormPanel.tsx` : composant partagé pour départ, arrivée et toutes les étapes, y compris les points liés. La sélection renseigne nom/adresse/GPS numériques et leur brouillon de saisie sans enregistrer. Un remplacement confirmé d’un point lié devient explicitement un lieu libre ; annuler préserve la référence. Les autres champs du trajet et l’identité de l’étape sont conservés.
- `journeyMap.ts` : diagnostic par déplacement des points affichables et liaisons disponibles, sans donnée persistée supplémentaire.
- `TripMap.tsx` : explication des trajets sans GPS, couverture partielle, filtre de date de départ, filtre masqué et état vide adapté aussi aux déplacements.
- `journeyStages.browser.tsx` : fournisseur simulé, recherche aux extrémités/étapes, clavier/clic, confirmation/annulation, lien hébergement, édition, coordonnées zéro/négatives, hors connexion manuel, conservation financière, carte sans GPS et ZIP2.
- `tripMapFiltering.browser.tsx` : assertion du libellé général « Aucun lieu géolocalisé », qui couvre activités et déplacements.
- Outils `docs/physical-tests/` : copie corrigée distincte, sélection CLI explicite, inventaire vérifié. Aucune modification du candidat figé ni de la publication.

La recherche nécessite Internet ; hors connexion, elle est désactivée avec message et les champs manuels restent disponibles. Le service ne donne pas de coordonnées à un lieu uniquement parce qu’un nom est saisi.

## Copie Android disponible

Build dérivé : **ea34583b202e06629343b11f**, dossier `node_modules/.tmp/v21f2-place-preview/`. Ce correctif modifie volontairement le code du candidat ; il ne doit pas être présenté comme le candidat figé original. Celui-ci reste dans `v21f2-preview/`. Les données fictives déjà saisies sur l’origine Wi-Fi ne sont ni effacées ni réimportées automatiquement.

URL : **http://192.168.50.10:48622/wifi-test/**. Recharger la page puis ouvrir Roam TEST. Fermer/réouvrir un ancien onglet TEST si son code est déjà chargé. Pas de purge de cache/données. Le serveur HTTP ne valide toujours pas l’installation PWA.

Pour relancer le serveur corrigé après arrêt :

```powershell
Set-Location 'C:\Projets\roam-travel-planning\roam-v2'
node.exe docs/physical-tests/serve-wifi.mjs --places
```

## Vérification physique restante

Dans un déplacement TEST, rechercher Gatwick au départ et East Croydon à l’arrivée, sélectionner les suggestions, confirmer tout remplacement, puis enregistrer. Vérifier les coordonnées et la liaison schématique dans Carte, avec Afficher les déplacements et le bon filtre de départ. Tester aussi une étape intermédiaire, l’annulation d’un remplacement de référence et le clavier/toucher Android. Les lieux simplement saisis manuellement sans GPS restent uniquement dans la liste, avec l’explication prévue.

Aucune branche Pages/master, donnée personnelle, base réelle ou version publique modifiée. Aucun commit, push ou déploiement. Dexie V6 et ZIP2 restent inchangés.

## Résultats

- Build TypeScript/Vite : réussi (avertissement de taille des chunks).
- Lint : aucune erreur, 9 avertissements ; pas de règle désactivée.
- Suites navigateur complètes : desktop 1100 px et mobile 320 px réussies ; après le dernier ajustement des points liés/focus, suite complète 375 px relancée avec succès.
- Photon : réponses simulées uniquement, succès/erreurs/JSON/timeout/annulation et protection des saisies couverts par la suite existante.
- Deux onglets réels : conflits, double clic, journal transactionnel et suppression concurrente réussis sur bases temporaires.
- MapLibre réel : rendu WebGL logiciel 375 px, marqueurs/segments/sélection/mise à jour/nettoyage réussis, tuiles simulées sans appel OSM.
- PWA : manifeste/précache/intégrité/exclusions/activation volontaire et vote entre onglets réussis.
- Production hors connexion : activités/documents/déplacements multi-étapes/hébergements réussis sur profil temporaire.
- Serveur Wi-Fi : HTTP 200 et identité du build corrigé contrôlés depuis le PC.
- `git diff --check -- roam-v2/` : réussi.

Des premiers passages ont échoué : libellé d’état vide devenu obsolète et séquence du test qui recherchait avant la restauration différée du focus. Assertions adaptées au libellé exact et attente des frames de restauration ajoutée, sans retirer les vérifications ni modifier les règles métier. La suite 375 px finale termine avec « Tous les tests ont réussi ».

Non exécutés par automatisation : gestes et clavier du téléphone Android physique, disponibilité réelle de Photon depuis ce téléphone. À contrôler sur la seule origine TEST.

> Exemples portables : `192.168.50.10` est une adresse LAN fictive à remplacer par celle affichée par le serveur ; `C:\Projets\roam-travel-planning` est un chemin d’exemple. `%USERPROFILE%` désigne le profil Windows courant.
