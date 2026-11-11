# V2.1 — Recherche géographique des hébergements

## Cause et comportement

Une adresse saisie manuellement ne déclenche pas de géocodage et n’apporte donc pas de GPS. La carte construisait déjà les marqueurs spécifiques d’hébergement avec `kind: accommodation`, mais sa liste ne contenait que les hébergements géolocalisés : un séjour sans GPS n’y était pas expliqué.

Le formulaire réutilise désormais `ActivityPlaceSearch` et le fournisseur Photon existants, comme les déplacements. Aucune nouvelle dépendance, requête automatique à l’ouverture ou nouvelle logique réseau. La sélection renseigne nom, adresse et brouillons GPS ; la validation existante transforme ces derniers en nombres à la sauvegarde. Le remplacement d’une localisation déjà renseignée demande confirmation ; annuler conserve toutes les valeurs. Les autres champs restent inchangés, notamment dates, horaires, réservation, notes, documents et montants. La sélection n’enregistre jamais l’hébergement.

Hors connexion : recherche désactivée avec explication, saisie manuelle disponible. Aucun GPS n’est inventé. La carte conserve désormais une liste filtrée des hébergements même sans coordonnées, avec accès à la fiche et message d’absence de position. Une recherche ultérieure ou l’ajout manuel de GPS permet le marqueur existant, sans nouveau type d’icône.

Le filtre quotidien inclut explicitement arrivée, nuits sur place et départ, bornes incluses, selon les dates locales déjà enregistrées. Les filtres de voyage et les limites de projection cartographique restent appliqués.

## Fichiers

- `src/components/accommodations/AccommodationSpace.tsx` : recherche partagée en création/édition et fournisseur injectable pour tests.
- `src/maps/journeyMap.ts` : sélection pure commune des hébergements par voyage et période ; marqueurs existants conservés.
- `src/components/map/TripMap.tsx` : liste incluant les séjours sans GPS, explications, accès à la fiche.
- `tests/accommodationInterface.browser.tsx` : recherche simulée clavier/clic, confirmation/annulation, noms/adresses/GPS, autres champs conservés, hors connexion, dates multi-nuits et ZIP2.
- `tests/journeyInterface.browser.tsx` : attente du chargement réel du bouton Modifier après ouverture asynchrone de la fiche. Une première exécution desktop a mis en évidence cette course ; aucune assertion supprimée.
- `docs/physical-tests/browser.mjs`, `serve.mjs` : correction des deux avertissements récents de lint.
- `docs/physical-tests/prepare-place-patch.mjs`, `serve-wifi.mjs` : copie corrigée et reconnaissance des seuls marqueurs TEST historiques connus, sans reset des données fictives.

## Audit des 9 avertissements de lint

Le rapport figé `v21f1-validation.md` recensait déjà 7 avertissements avant les outils physiques. Les deux supplémentaires étaient introduits dans `docs/physical-tests/` :

| Origine | Avertissement | Traitement |
| --- | --- | --- |
| `browser.mjs` | ternaire de résolution/rejet CDP considéré expression inutilisée | Remplacé par if/else équivalent |
| `serve.mjs` | import `join` inutilisé | Import retiré |

Les **7 préexistants** restent : regex de contrôle dans `places/photon.ts` et `backup/validateRestore.ts` (2), refs de focus dans `ActivityFormPanel`, `DocumentDeleteConfirmation` et `ActivityDetailPanel` (4), signalement Date dans `App.tsx` (1). Aucun nouveau avertissement lié au formulaire hébergement, aucune règle désactivée. Ces points hors périmètre ne sont pas masqués.

## Tests et limites

Tous les contrôles utilisent exclusivement des bases UUID et profils navigateur temporaires, jamais les données personnelles.

- Build TypeScript/Vite : réussi ; avertissement de gros chunks conservé.
- Lint : 7 avertissements et 0 erreur.
- Suites navigateur complètes : 320, 375 et 1100 px réussies ; desktop relancé avec succès après correction de la course du test de fiche.
- Recherches : réponses simulées, pas de dépendance à la disponibilité réelle de Photon ; création/édition/remplacement annulé ou confirmé, préservation des valeurs et coordonnées numériques zéro/négatives.
- Hébergements : trois nuits, arrivée/nuit/départ, séjours consécutifs/chevauchants, filtre hors période, hébergement sans GPS non marqué mais listé et ouvrable.
- ZIP2 et compatibilité/migrations : couverts dans les suites complètes ; longitude numérique conservée après restauration.
- Deux onglets réels : conflits, double clic, révisions, journal et suppression concurrente sans résurrection réussis.
- Production hors connexion : création/modification/réouverture des hébergements et documents réussies.
- MapLibre réel 375 px : marqueurs spécifiques, sélections/segments/mise à jour et nettoyage réussis avec tuiles simulées ; aucun appel OSM réel.
- PWA : précache/intégrité/exclusions et activation volontaire réussis.
- `git diff --check -- roam-v2/` : réussi.

Restent physiques : clavier/gestes Android, réponse réelle du fournisseur depuis ce réseau et lisibilité réelle des suggestions. L’accès Wi-Fi HTTP valide l’interface, pas l’installation PWA ni le démarrage hors connexion sur téléphone.

## Nouvelle validation Android

URL : **http://192.168.50.10:48622/wifi-test/**.

Build corrigé : **c5cade94b1b698cca92be2e6**. Le candidat figé original reste intact dans sa copie séparée ; le correctif est explicitement une version dérivée. Recharger TEST, ou fermer/réouvrir un ancien onglet ; ne pas effacer de données/cache. Aucun ZIP réimporté automatiquement.

1. Ouvrir un hébergement TEST sans GPS et constater l’explication dans la liste de Carte.
2. Modifier, rechercher son nom/adresse, sélectionner un résultat, confirmer le remplacement et enregistrer.
3. Vérifier le marqueur spécifique et la fiche, sur une journée comprise entre arrivée et départ.
4. Tester l’annulation du remplacement, puis la saisie manuelle hors connexion ; aucun marqueur n’est attendu sans GPS.

Serveur corrigé : `node.exe docs/physical-tests/serve-wifi.mjs --places` depuis roam-v2. Aucune donnée personnelle, V2 publique, branche master ou Pages modifiée. Aucun commit, push ou déploiement. Dexie V6/ZIP2 inchangés.

> Exemples portables : `192.168.50.10` est une adresse LAN fictive à remplacer par celle affichée par le serveur ; `C:\Projets\roam-travel-planning` est un chemin d’exemple. `%USERPROFILE%` désigne le profil Windows courant.
