# V2.1d — Déplacements multi-étapes et carte

## Fonctionnement

Le formulaire de déplacement conserve deux lieux par défaut. « Ajouter une étape » insère un lieu avant l'arrivée ; les étapes intermédiaires disposent de commandes Monter/Descendre et d'une suppression confirmée. La limite reste celle du contrat V6 : 100 lieux. Les noms sont obligatoires, les adresses et GPS facultatifs ; latitude et longitude doivent être renseignées ensemble et validées selon les règles existantes. Les champs GPS acceptent point/virgule et gardent des nombres en base.

Chaque lieu conserve son ID lors de l'édition et du réordonnancement. Les références facultatives vers une activité ou un hébergement du même voyage conservent un instantané du lieu. Leur sélection demande confirmation avant de remplacer un nom/adresse saisi. La suppression du propriétaire conserve le dernier lieu connu et l'avertissement V6. Les références des autres voyages restent refusées par le repository.

Chaque paire **dirigée et consécutive** possède son segment, son ID, son mode et une durée facultative en minutes. Une paire inchangée conserve ses données ; une nouvelle paire reçoit un nouveau segment avec mode « Autre » et sans durée. Aucun taux, horaire, durée ou itinéraire n'est déduit. Après réorganisation, une durée n'est jamais recyclée sur une autre liaison ; le formulaire l'explique. Le brouillon garde les anciens segments pour restaurer leurs valeurs si l'utilisateur annule le réordre avant d'enregistrer ; seuls les segments consécutifs actuels sont persistés. La date/heure de départ et d'arrivée concernent le déplacement entier, avec choix explicite du lendemain pour traverser minuit.

La fiche affiche tous les lieux dans l'ordre et tous les modes/durées par segment. Le coût reste **global au déplacement**, jamais multiplié par le nombre de segments. Les montants payés/estimés, réservation, documents, champs supplémentaires et provenance sont conservés par l'édition sur un instantané avec révision V6. Les anciens formulaires restent sur leur adaptateur ; ils ne peuvent pas éditer une ancienne version devenue multi-étapes.

## Carte

Une lecture réactive groupée charge activités, journeys et hébergements du voyage. Le modèle `journeyMap.ts` produit uniquement des objets de présentation : aucun faux transfert ou activité n'est persisté. `useJourneyMapData.ts` mémorise la présentation indépendamment des sélections et mouvements de caméra.

- Marqueurs par lieu GPS valide, symboles/couleurs distincts : activité, hébergement, domicile, gare, aéroport et lieu libre ; nom accessible au clavier.
- Liaisons schématiques entre seules étapes consécutives géolocalisées, modes colorés. Aucun raccourci dessiné à travers un lieu sans GPS. Les mêmes coordonnées donnent un point/halo ; les passages ±180° sont découpés par l'utilitaire existant.
- Sélection des étapes ou segments → aperçu → fiche existante du déplacement, avec édition et suppression confirmée. La carte reste montée derrière le panneau, sans recentrage au retour.
- Sélecteur « Afficher les déplacements », mémorisé dans l'état de vue existant, masquant liaisons et étapes. Les marqueurs d'activités et d'hébergements restent disponibles. Les anciennes projections ne sont pas dessinées en doublon des journeys canoniques.
- Filtre Journée : un journey appartient au jour de départ renseigné ; aucune date d'étape intermédiaire n'est inventée. Les hébergements correspondent à leur période inclusive. En vue complète, les journeys sans date restent visibles.
- Les listes donnent accès à tous les lieux du déplacement, y compris sans GPS, hors connexion. Les GPS polaires sont conservés mais ne sont pas affichables sur le fond Web Mercator. Les tuiles ne sont ni préchargées massivement ni promises hors connexion.

## Correction d'intégrité découverte pendant les tests

Le test créé pour faire coexister un déplacement natif et un ancien transfert a reproduit une erreur dans `db/transfers.ts` : `rows.find(row => row.legacy?.id === id)` avec `id === undefined` pouvait sélectionner le premier journey natif, dont la provenance est également absente. Créer un ancien transfert pouvait alors l'écraser.

La recherche d'un existant est maintenant effectuée **uniquement si un ID a été fourni**. Le test vérifie que le journey natif reste strictement identique après cette création. Il transforme ensuite le transfert migré en multi-étapes et vérifie qu'un ancien formulaire obsolète est refusé sans opération de journal ; après suppression, il ne peut pas ressusciter le journey.

## Fichiers concernés

- Formulaire/modèle/fiche : `JourneyFormPanel.tsx`, `journeyFormModel.ts`, `JourneyProgram.tsx` ; lecture des hébergements dans `db/journeys.ts`.
- Carte : `TripMap.tsx`, `TripMapCanvas.tsx`, `trip-map.css`, nouveaux `maps/journeyMap.ts` et `maps/useJourneyMapData.ts` ; extension légère du point et du lien de présentation dans `tripMapModel.ts`, `tripMapTransfers.ts`, `tripMapSession.ts`, `tripTransferLayer.ts`, `maplibrePreview.ts`, `tripMapView.ts`.
- Correctif du repository de compatibilité : `db/transfers.ts`.
- Tests : nouveau `journeyStages.browser.tsx`, inclusion dans `activities.browser.ts`, scénarios multi-étapes dans `concurrentActivity.fixture.tsx`, `concurrent-tabs.mjs`, `production-offline.mjs`. Les quatre harnesses Carte injectent des lecteurs natifs vides stables pour rester isolés ; aucune ouverture des données personnelles.

Dexie V6, ZIP2, lecture ZIP1 et journal restent inchangés. Aucun SDK, dépendance, géocodage ou service de calcul d'itinéraire ajouté. Aucun commit, push ou déploiement.

## Validation automatisée

Sur bases et profils Chrome temporaires uniquement :

- Build TypeScript/Vite : réussi ; avertissement de taille de chunk existant.
- Lint : réussi, zéro erreur, sept avertissements préexistants ; aucun avertissement supplémentaire.
- Suite navigateur complète desktop, 320 et 375 px : réussie après corrections ; migration V5→V6, ZIP1/ZIP2, fichiers binaires, rollback, budget et tests précédents conservés.
- Nouveau scénario : CRUD multi-étapes, réordonnancement/suppression confirmée, IDs/durées/modes, hébergement lié, estimation/paiement, réservation, ZIP2 et réouverture, GPS manquants/identiques/zéro/négatifs/±180°, affichage cartographique, fiche/caméra, masquage, hors connexion et géométrie mobile.
- Concurrence : deux vrais onglets hors réseau, formulaires multi-étapes ouverts sur la même révision, double clic et conflit sans écriture/journal supplémentaire, étapes et durée conservées.
- Hors connexion production : création/édition/réouverture/suppression d'un journey à trois lieux et deux segments depuis les vrais formulaires, réseau réellement coupé par CDP ; anciens tests activité/document conservés.
- PWA : intégrité du précache, exclusions cartographiques, protocole d'activation volontaire et multi-onglets.
- Contrats V2.1 et `git diff --check -- roam-v2/` : réussis.

Les premières exécutions ont également révélé deux problèmes de harnesses : sélection d'un label JSX dynamique et nouvelle requête d'hébergements dans un Programme sans parent réel. Les lecteurs de test restent isolés ; le Programme ne charge maintenant les hébergements qu'à l'ouverture du formulaire. Les scénarios ont été relancés, sans suppression ni affaiblissement des assertions numériques ou de migration.

## Limites et contrôles physiques restants

Les tests de la carte injectent un rendu déterministe pour tester les marqueurs, segments, sélections et caméra sans dépendre du réseau de tuiles ; les adaptateurs et géométries MapLibre existants restent couverts. Le rendu WebGL réel, le clavier virtuel et le confort tactile/safe-area du téléphone restent à observer sur appareil physique. Les listes restent accessibles en cas d'échec du module ou des tuiles.

Pas d'horaire individuel par étape, de durée calculée, d'itinéraire routier, de déplacement automatique de rendez-vous ou de recopie des documents. Les lieux d'hébergements sont affichés, sans ajouter un nouvel écran de gestion des hébergements à cette étape.

Commandes depuis `roam-v2/` : `npm.cmd run lint`, `npm.cmd run build`, `npm.cmd run test:v21`, `npm.cmd run test:browser`, `node.exe tests/browser-suite.mjs 320`, `node.exe tests/browser-suite.mjs 375`, `npm.cmd run test:concurrency`, `npm.cmd run test:pwa`, `npm.cmd run test:offline`. Depuis la racine : `git diff --check -- roam-v2/`.
