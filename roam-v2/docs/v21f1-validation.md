# Roam V2.1f.1 — Audit final et stabilisation

Date de référence : **10 novembre 2026**. Branche : `develop-v2`.

**Verdict : candidat prêt pour validation manuelle sur profils de test. Pas d'autorisation de publication.** Les sept défauts reproduits ci-dessous sont corrigés et les contrôles automatisés pertinents passent. Les validations physiques et les sauvegardes préalables à une future migration restent indispensables.

## Candidat identifiable, sans commit

- Identifiant : **V2.1f.1-RC-ff65f37f336f**.
- Ancre Git, qui ne représente pas seule le contenu non commité : `934331cdb06163585af1103099efa0e778336dd7`.
- Inventaire SHA-256 exact : [`v21f1-candidate.json`](v21f1-candidate.json), 194 fichiers source/configuration/ressources/documentation interne et 72 fichiers de tests.
- Build standard : `dist/`, build ID `78c8ba39e4dbcde05fe07d40`.
- Build au sous-chemin `/roam-travel-planning/` : `node_modules/.tmp/pages-v2-dist/`, build ID `9c2feaa8cbbf5f7873c0ed26`.
- `node.exe tests/verify-candidate.mjs` vérifie les inventaires, les SHA-256 des fichiers, le worker et les ressources précachées des deux builds. Il n'ouvre aucune base. Toute modification invalide ce candidat ; le rapport n'autorise pas à republier un artefact différent sans revalidation.

Les artefacts restent locaux et ignorés par Git ; ce ne sont pas des sauvegardes des données personnelles. Aucun commit, indexage, push, déploiement, branche de publication ou paramètre GitHub Pages n'a été modifié. `master` reste `e7a98ce443bdacd398097631893a8707c142fddd`. Les changements hors `roam-v2/` observés au début étaient préexistants et sont restés hors de cette intervention.

## Défauts reproduits avant correction

| Défaut | Conséquence avant correction | Correctif et preuve |
|---|---|---|
| Dates absentes d'un journey importé | Modifier son titre préremplissait puis enregistrait arbitrairement des dates | Le formulaire conserve les moments absents. Une nouvelle création exige toujours sa date de départ ; une heure exige sa date. Test pur, puis vrai formulaire et vérification IndexedDB. |
| Taux automatiques limités aux activités | Un séjour USD ou trajet JPY restait sans taux malgré « Actualiser » | Planification et affichage des paires incluent les dépenses canoniques, avec priorité manuelle, exclusion des séjours non comptés et absence de doublon des anciens transferts. Réponses simulées, cache quotidien, montants originaux inchangés. |
| Paiement de journey partagé modifiable hors Budget | Le montant payé pouvait diverger du partage conservé | Le repository V6 refuse atomiquement la modification du paiement/de sa devise, via ID natif ou alias V2. Aucun journal ni document partiel. Le Budget conserve son parcours normal de modification du partage. |
| Nom d'hébergement très long | Le titre poussait « Fermer » hors du panneau | Retour à la ligne et largeur minimale du titre, bouton non compressible. Géométrie après fin d'animation ; témoin CSS original reproduisant encore le défaut dans le test. |
| Réimport d'une archive avec tombstones d'un voyage disparu | Une seconde restauration identique échouait au lieu d'être sans effet | Reconnaissance strictement limitée au tombstone déjà restauré de cette révision, identité/parents/date identiques, révision locale exactement source + 1, sans entité vivante. Deuxième restauration sans écriture ; une suppression locale avancée reste refusée. |
| Saisie Hébergement et rechargement navigateur | La protection PWA ne protégeait pas un rechargement normal | Le panneau partagé avertit via `beforeunload` seulement lorsqu'il est modifié ou occupé, et nettoie le handler à la fermeture. Événement annulable testé, puis véritable dialogue Chrome annulé via CDP sans perdre la saisie. |
| Réservations natives absentes de l'Accueil | Le résumé ne recensait que les activités | Le résumé inclut les journeys/hébergements déjà chargés, leur statut réel et leur référence, sans compter à nouveau la projection V2. Ouverture des fiches/éditeurs existants et retour du focus vérifiés. |

La première suite ajoutée a échoué sur les cinq premiers cas ; les deux autres ont été ajoutés puis reproduits avant leur correction. Les relances réussissent sans suppression ni affaiblissement des assertions de migration, d'identité, de journal, de montants ou de conservation binaire.

## Cohérence fonctionnelle contrôlée

- **Activités historiques** : comparaison JSON du contenu avant/après ; elles restent dans le budget. Aucun renommage, conversion, changement de catégorie, remplissage de devise ou exclusion automatique d'activité d'hébergement.
- **Voyages** : création/édition, sélection, archivage/corbeille, restauration et suppression confirmée restent couverts. La duplication conserve le périmètre explicitement validé en V2.1b : elle ne devient pas une copie intégrale automatique des nouvelles entités.
- **Déplacements** : deux lieux ou plusieurs étapes, lieux libres, références facultatives du même voyage, IDs stables, modes/durées propres à chaque paire dirigée. Réordonnancement sans recycler une durée ; annuler le réordre dans le brouillon restaure ses valeurs. Un ancien formulaire obsolète ne peut ni réduire ni ressusciter un journey.
- **Hébergements** : dates civiles, zéro/multi-nuits, check-in/out facultatifs, séjours consécutifs et chevauchements non destructifs. Programme et calendrier ouvrent la fiche sans créer une activité par nuit.
- **Références et suppressions** : supprimer une activité/un hébergement conserve le trajet et son dernier lieu, marqué supprimé. Supprimer le journey ne supprime pas ses activités. Documents/partages concernés retirés transactionnellement, autres propriétaires intacts.
- **Réservations** : les statuts absents ne deviennent pas confirmés. L'Accueil prend en compte les nouvelles entités ; la bibliothèque commune continue de couvrir activités et hébergements. Les réservations/documents des journeys restent consultables dans leurs fiches Programme/Carte/Accueil : pas de nouveau module parallèle ajouté à cette stabilisation.
- **Budget** : une dépense canonique comptée une fois ; global par séjour/journey, sans ventilation fictive par nuit. Estimé/payé/absent/zéro et conversions locales restent distincts. La sélection des taux nécessaires suit les mêmes exclusions. Les anciens paiements d'activités gardent leur règle validée : si modifiés hors partage, celui-ci demande revalidation au lieu d'inventer une répartition.
- **Doublons possibles** : `budgetExcluded` reste un choix explicite pour un hébergement ; une référence déjà utilisée avec montants peut bloquer une seconde saisie ou signaler un doublon historique sans changer les données. Une référence ne prouve pas toujours l'identité de deux dépenses : aucun rapprochement flou automatique.
- **Carte** : filtres, caméra, groupement des coordonnées identiques, zéro/négatifs/±180°, marqueurs par type, liaisons schématiques seulement, mise à jour et nettoyage. Les listes restent utilisables sans tuiles.

## Persistance, migration, ZIP et concurrence

Dexie reste **V6**, ZIP reste **format 2**, avec lecture ZIP1. Aucune nouvelle migration ou table dans cette intervention.

Les tests réels créent une base V5 avant ouverture par le code V6 : 300 activités, anciens transferts, identités, filiation, opérations V5, reçus et document binaire 1 Mio. Ils vérifient la conservation des identifiants, des montants payés, des références et des octets ; les anciennes opérations sont gelées et ne peuvent recréer une seconde représentation. Réouverture V6 sans rejouer la migration ni ajouter d'opération. Base vide et migration invalide avec rollback vers V5 également exécutées.

La suite de volume couvre aussi 300 activités/réservations, préparatifs/contacts/budgets, **31 PDF synthétiques / 45 Mio**, dont un fichier de 15 Mio, et des sauvegardes historiques. Les validations ZIP contrôlent CRC/SHA-256, graphes, propriétaires typés, fichiers attendus, limites et corruptions. La restauration est atomique, réévalue les conflits, ignore un voyage déjà présent et refuse une collision enfant ou une identité locale distincte. Le nouveau cas de tombstones rend le réimport identique sans effet tout en refusant une révision locale plus récente.

Les scénarios de concurrence utilisent **deux vrais onglets Chrome** hors réseau : révision capturée, une seule écriture en cas de courses, double clic, formulaire obsolète, suppression concurrente, absence de résurrection, saisie/document en attente conservés, rollback et journal sans opération parasite. Les dialogues ne fusionnent pas automatiquement les saisies obsolètes.

## Matrice des vérifications exécutées

| Contrôle | Résultat final | Précisions |
|---|---|---|
| TypeScript `tsc -b --pretty false` | Réussi | Aucun diagnostic. Également exécuté par chaque build. |
| Build standard TypeScript/Vite | Réussi | Avertissement de taille de chunks déjà présent. |
| Build sous `/roam-travel-planning/` | Réussi | Sortie isolée, aucun paramètre de publication changé. |
| Lint | Réussi, 0 erreur | 7 warnings préexistants : 2 regex de contrôle, 4 refs de focus, 1 Date dans App ; aucune règle désactivée. |
| `test:v21` | Réussi | Contrats, finances et simulations de migration/ZIP, aucun accès aux bases réelles. |
| Suite navigateur desktop 1100 px | Réussie | Anciennes suites + nouveaux tests transversaux. |
| Suite navigateur 320 px | Réussie | Formulaires, géométrie, navigation, calendrier, cartes et états vides. |
| Suite navigateur 375 px | Réussie | Idem, avec contrôles de focus et responsive. |
| MapLibre réel 320/375/1100 px | Réussi | WebGL logiciel SwiftShader ; marqueurs/types/sélection/groupement/segments/MAJ/nettoyage et aperçu individuel. |
| `test:concurrency` | Réussi | Deux onglets réels, activités, bridge, journeys et hébergements. |
| `test:offline` | Réussi | Production, SW réel, réseau coupé via CDP ; création/édition/réouverture/suppression et images locales des activités/hébergements après redémarrage. |
| `test:pwa` | Réussi | Ressources/hashes/scope, exclusions, activation volontaire ; votes multi-onglets du protocole simulés. |
| `test:publication` | Réussi, local uniquement | V1→V2, deuxième worker V2, beforeunload natif, Plus tard, saisie protégée, activation explicite avec un seul rechargement, cache distinct, hors connexion et retour V1 sans purge. |
| Empreinte du candidat | Réussie | Inventaires source/tests et SHA-256 des deux builds. |
| `git diff --check -- roam-v2/` | Réussi | Aucun défaut d'espacement. |

Le rendu cartographique réel est supplémentaire aux tests injectant un renderer simulé. Les tuiles OSM sont interceptées par CDP et remplacées par des PNG 256×256 valides : **aucun trafic au serveur public OSM** pour ces contrôles. La première fixture 1×1 échouait au décodage raster ; la fixture a été corrigée, puis les trois dimensions ont réussi.

Le test PWA sert une deuxième génération du worker **en mémoire**, en changeant son BUILD_ID et son cache, avec les mêmes ressources applicatives vérifiées. Il ne modifie aucun fichier applicatif pour simuler la version suivante. Le dialogue Chrome beforeunload est réellement observé et annulé par CDP. La conservation du draft est ensuite vérifiée pendant le report de mise à jour et après « Plus tard ».

Autres échecs intermédiaires des harnesses, corrigés puis relancés : vérification géométrique trop tôt pendant l'animation d'entrée, origine de focus cachée dans un `details` non ouvert par le test, guillemets JS et clé de cache de la nouvelle phase PWA. Ils ne sont pas présentés comme des succès initiaux.

## Fichiers de cette stabilisation

- `src/components/program/journeyFormModel.ts`, `JourneyFormPanel.tsx` : moments facultatifs conservés à l'édition.
- `src/db/automaticRates.ts`, `components/currency/AutomaticRatesStatus.tsx` : paires financières V6.
- `src/evolution/v21/repository.ts` : protection des paiements partagés natifs.
- `src/backup/restoreBackup.ts`, `src/backup/FORMAT.md` : idempotence exacte des suppressions restaurées.
- `src/components/accommodations/accommodations.css` : titre long et bouton Fermer.
- `src/components/budget/ExpenseSharing.tsx` : protection du rechargement pour panneau modifié/occupé.
- `src/components/dashboard/TripOverview.tsx` : résumé/ouverture des réservations natives.
- Nouveaux `tests/v21Stabilization.browser.tsx`, `tests/realMap.browser.ts`, `tests/verify-candidate.mjs` ; inclusion dans `activities.browser.ts`, extension de `browser-suite.mjs` et de `publication.mjs`.
- Documentation : ce rapport, empreinte JSON, `tests/README.md`, `pwa/README.md`.

Les autres changements V2.1a–e présents dans le dépôt au début ne sont pas réattribués à cette intervention.

## Risques résiduels et limites

1. **Migration V5→V6 non réversible par ancien binaire.** Les anciens builds V2 ne peuvent pas ouvrir la base V6 ni lire ZIP2. Les sauvegardes personnelles et leur validité n'ont pas été inspectées. Une future publication exige sauvegardes par appareil/origine et décision explicite de migration ; ne pas charger ce candidat sur le profil réel pour « essayer ».
2. **Source non commitée.** L'empreinte identifie le candidat, pas un commit de release. Une revue et une décision séparée seront nécessaires avant tout commit/push/publication ; les modifications hors V2 préexistantes ne doivent pas être embarquées automatiquement.
3. **Stockage navigateur.** Les écritures atomiques ne garantissent ni l'espace disque du téléphone ni la conservation éternelle par son OS. Garder des ZIP indépendants ; aucun reset/purge n'a été utilisé pour résoudre un défaut.
4. **Saisies non enregistrées.** Les dialogues et le navigateur sont protégés, mais un arrêt forcé de l'OS peut perdre un brouillon non enregistré. Les saisies refusées pour conflit restent locales ; recharger les données récentes demande une action explicite, après avoir conservé les notes utiles.
5. **Dates/fuseaux.** Les dates civiles et horaires enregistrés sont conservés ; l'horloge de l'appareil sert au jour courant. Aucun fuseau de destination ou temps de parcours n'est inventé.
6. **Carte.** Pas de garantie de tuiles hors connexion, ni de trajet routier. SwiftShader valide le logiciel, pas tous les GPU ni gestes physiques des téléphones. Les listes locales restent l'alternative.
7. **Portée conservée.** Pas de synchronisation distante, de conversion automatique des anciennes activités, de copie intégrale automatique de voyage, ni d'élargissement de la bibliothèque commune aux documents des journeys. Ceux-ci restent accessibles dans leurs fiches existantes et sont inclus dans ZIP2.
8. **Warnings et taille.** Les sept avertissements de lint et les gros chunks restent documentés, sans nouvelle erreur ni désactivation de règles. Ils ne constituent pas un échec des scénarios fonctionnels testés.

## Validation manuelle indispensable — environnement isolé seulement

Ne pas utiliser le profil/origine de la V2 publiée. Les vérifications physiques doivent rester sur un navigateur/profil de test et une origine locale HTTPS/localhost distincte, avec des données fictives.

- Installation via le menu du véritable téléphone, ouverture autonome, fermeture complète puis mode avion/réouverture ; vérifier que la navigation du système et les zones de sécurité ne masquent rien.
- Clavier virtuel, saisie virgule/point, défilement vertical et cartes/touchers à une/deux mains, boutons de fermeture et focus avec clavier/lecteur d'écran physique si utilisé.
- Rendu GPU réel de la carte, sélection au même point, retour d'une fiche et absence de déplacement intempestif de caméra.
- Ouverture d'un PDF dans le lecteur natif du téléphone, téléchargement et gestion du fichier par le système : la disponibilité du lecteur varie selon navigateur/appareil.

L'installation OS, les gestes physiques, le GPU du téléphone et son lecteur PDF ne sont pas certifiés par Chrome headless. Aucune vérification personnelle de sauvegarde ou migration n'a été demandée/faite dans cet audit.

## Commandes de reproduction

Depuis `roam-v2/`, Node/Chrome déjà installés :

```powershell
npm.cmd run build
npm.cmd run lint
node.exe node_modules/typescript/bin/tsc -b --pretty false
npm.cmd run test:v21
npm.cmd run test:browser
node.exe tests/browser-suite.mjs 320
node.exe tests/browser-suite.mjs 375
node.exe tests/browser-suite.mjs 320 --real-map
node.exe tests/browser-suite.mjs 375 --real-map
node.exe tests/browser-suite.mjs 1100 --real-map
npm.cmd run test:concurrency
npm.cmd run test:pwa
npm.cmd run test:offline
npm.cmd run build -- --base=/roam-travel-planning/ --outDir=node_modules/.tmp/pages-v2-dist --emptyOutDir
npm.cmd run test:publication
node.exe tests/verify-candidate.mjs
```

Depuis la racine : `git diff --check -- roam-v2/`. Ces tests créent exclusivement des profils et bases temporaires. Leur nettoyage concerne ces fixtures, jamais `roam-v2-db` d'un profil personnel.

**Conclusion de candidature : GO validation manuelle isolée. Publication : non autorisée et non préparée en écriture ; sauvegardes, validation physique, revue du candidat et autorisation explicite restent des préalables.**
