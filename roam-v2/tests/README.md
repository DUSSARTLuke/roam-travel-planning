# Activités : tests isolés dans le navigateur

Depuis `roam-v2/`, lancer le serveur Vite avec `npm.cmd run dev` dans PowerShell,
puis ouvrir `/tests/activities.html` sur l'adresse locale indiquée par Vite.
Cliquer sur « Lancer les tests isolés » et attendre le résultat.
Aucune dépendance supplémentaire n'est requise.

Chaque exécution crée une base `roam-v2-test-activities-<UUID>`, puis la supprime
dans un bloc `finally`. La base `roam-v2-db` n'est jamais ouverte par ces tests.
Ne pas fermer la page pendant l'exécution : cela pourrait laisser la base de test,
identifiable par son préfixe, sans affecter les voyages réels.

Couverture : migration V2 → V3 sans changement des voyages/métadonnées ;
création/lecture/modification/suppression ; trois modes ; idées sans date ;
validation des entrées ; tri stable ; isolation de deux voyages ; conservation
lors de l'archivage/corbeille ; refus de suppression après restauration ; cascade
transactionnelle avec rollback forcé ; absence d'orphelins lors d'écritures concurrentes.

## Contrat des données

- `activityModel.ts` définit `TripActivity`, `TripActivityInput` et les validations.
- Catégories : `visit` (visite), `meal` (restaurant/repas), `transport`,
  `outing` (activité/sortie), `rest` (repos), `other`.
- Réservation : `not_required`, `to_book`, `pending`, `confirmed`, `cancelled`.
  Ces valeurs stockent uniquement un statut, sans gestion avancée des réservations.
- Dates : chaîne locale `YYYY-MM-DD`, ou `null` pour les idées. Aucun changement
  de fuseau horaire. Une date hors des bornes actuelles du voyage reste autorisée :
  modifier les dates du voyage ne déplace ni ne supprime ses activités.
- Horaires : `HH:mm`. Fin facultative, supérieure ou égale au début, sur la même
  journée. Les activités traversant minuit ne sont pas gérées à cette étape.
- Devise : code ISO reconnu par `Intl.supportedValuesOf('currency')`, normalisé en
  majuscules. Un ancien code inchangé reste conservé ; aucun calcul de change.
- Les champs avancés omis dans une modification sont conservés. Pour les effacer,
  fournir explicitement `undefined` ; pour retirer tous les liens, fournir `[]`.
- Tri : date (idées en dernier), mode (`exact`, `period`, `unscheduled`),
  `sortOrder`, horaire/créneau, `createdAt`, puis `id`. L'ordre manuel est prioritaire
  à l'intérieur d'un mode ; les critères de départage rendent le résultat stable.

`activities.ts` expose `createActivity(tripId, input)`, `getActivity(tripId, id)`,
`listActivities(tripId, date?)`, `updateActivity(tripId, id, input)` et
`deleteActivity(tripId, id)`. Pour la liste : date omise = tout le voyage,
`null` = idées uniquement, chaîne = journée uniquement. Ces lectures sont
compatibles avec `useLiveQuery` ; elles ne sont pas encore intégrées à l'interface.

La modification reçoit un **contenu éditable complet**, pas un patch partiel.
Identifiants, voyage parent et date de création sont préservés ; `updatedAt` est
régénéré. Les champs non autorisés ne sont pas repris depuis l'entrée.

Toutes les opérations vérifient le voyage parent et l'appartenance de l'activité.
La lecture est possible dans la corbeille, les écritures nécessitent la restauration.
Archiver un voyage conserve ses activités. Les copies de voyages restent, à cette
étape, des copies des informations du voyage uniquement.

Utiliser ces fonctions pour manipuler les activités. IndexedDB ne fournit pas de
contrainte de clé étrangère pour des écritures directes hors de cette API.
La suppression définitive via `updateTripTrash` vérifie le jeton `deletedAt` puis
supprime les activités et le voyage dans **une seule transaction**. Un échec annule
toutes les suppressions. Aucune purge automatique n'est ajoutée.

## Étape 2.3 : Programme et formulaire

La suite isolée teste aussi l'adaptateur du formulaire après persistance :
changements des trois modes, suppression des horaires obsolètes, passage
activité/idée, date décembre–janvier et conservation des champs avancés cachés.

Dans l'application, avec des voyages de test, vérifier manuellement :

1. Ajouter une activité dans chaque mode, recharger puis modifier ses champs.
2. Changer de mode plusieurs fois : seuls les horaires pertinents sont enregistrés.
3. Créer une idée sans date, la dater, puis la remettre dans les idées. Une activité
   datée sans horaire doit rester dans la journée et ne pas devenir une idée.
4. Vérifier les pastilles du calendrier, changer de mois entre décembre et janvier,
   puis choisir une journée. Les idées ne comptent pas dans les pastilles.
5. Modifier la date vers une autre journée ; vérifier le déplacement de la carte.
   Une date hors du séjour reste accessible dans « Autres dates ».
6. Changer de voyage : aucune activité ni saisie ne doit apparaître dans l'autre.
7. Fermer un formulaire inchangé via le bouton, le fond ou Échap. Avec des saisies,
   vérifier « Continuer la saisie » et « Abandonner », ainsi que l'avertissement
   navigateur au rechargement.
8. Parcourir au clavier : focus initial, Tab/Maj+Tab contenus dans le panneau,
   focus sur la confirmation d'abandon et retour au bouton d'origine après fermeture.
9. En mobile, vérifier le panneau du bas, le clavier virtuel et le défilement ;
   en ordinateur, le panneau droit et le fond du Programme encore visible.
10. Simuler une erreur de stockage et cliquer rapidement sur Enregistrer : aucun
    doublon, erreur visible et saisies conservées. Depuis un autre onglet, mettre
    le voyage à la corbeille : aucune écriture ne doit contourner la règle du parent.


## Étape 2.4.2 : réservations, prix et liens

La suite `/tests/activities.html` appelle aussi `activityAdvanced.browser.ts` :
création rapide sans champs avancés, anciens statut `pending` et `url`, prix zéro
et absents, devises EUR/GBP/USD, références conservées après changement de statut,
liens ajoutés/modifiés/retirés avec ordre stable, invalidations des montants,
personnes, dates et URL dangereuses, conservation après modification simple.
Ces tests utilisent toujours exclusivement la base temporaire isolée.

À vérifier manuellement dans le Programme :

1. Refermer/réouvrir les trois sections sans perte de saisie, et changer le statut
   sans perdre référence, prestataire, personnes ni notes de réservation.
2. Enregistrer prix estimé/payé à zéro puis les vider : la fiche doit distinguer
   les deux cas. Tester EUR, GBP et USD, puis rejeter ZZZ et les montants négatifs.
3. Ajouter deux liens, modifier l'un et retirer l'autre : aucun changement des
   autres identifiants/titres/URL. Tester également un ancien champ `url`.
4. Vérifier l'ouverture des liens en nouvel onglet et le refus des URL javascript,
   data, file, relatives ou mal formées. Une ancienne URL dangereuse n'est jamais
   transformée en lien cliquable dans la fiche.
5. Modifier seulement le nom ou le lieu, puis recharger : toutes les informations
   avancées doivent être conservées, y compris les valeurs historiques.
6. Vérifier la mise à jour de la fiche, les erreurs de saisie dans une section
   refermée, le clavier mobile et l'isolation entre deux voyages.

## Étape 2.4.3 : import local de documents

Le schéma V4 ajoute deux tables : `activityDocuments` (métadonnées, index activityId)
et `activityDocumentBlobs` (Blob avec le même identifiant). Les requêtes de liste
n'ouvrent pas la table des Blob. Les voyages, activités et métadonnées sont conservés.

Politique des lots : chaque nouvelle sélection est entièrement validée, ou refusée
sans ajouter aucun de ses fichiers. Les sélections précédentes en attente restent
conservées. Les documents ne sont persistés qu'avec le bouton Enregistrer : activité,
métadonnées et Blob forment une seule transaction. Annuler/abandonner n'importe rien.
La limite de cinq est revérifiée dans la transaction, y compris entre onglets.

Les en-têtes PDF/JPEG/PNG/WebP sont vérifiés et doivent correspondre au MIME déclaré
lorsqu'il n'est pas vide. Un MIME vide est déduit de la signature. Cela n'est ni un
parseur complet de fichiers ni un antivirus ; aucun fichier n'est exécuté ou affiché.
Les fixtures de tests ne vérifient que cette validation d'en-têtes et le stockage.

La suite `/tests/activities.html` lance aussi `documents.browser.ts`, dans une base
`roam-v2-test-documents-<UUID>` supprimée en fin de test. Elle vérifie V3→V4 sans
altération des données, quatre formats, fichiers vides, 15 Mo inclus et dépassement,
MIME incohérent, lot partiellement invalide refusé en entier, limite de cinq,
concurrence, persistance après réouverture, lectures sans Blob, quota/rollback,
isolation et nettoyage transactionnel à la suppression de l'activité ou du voyage.
Archivage et corbeille conservent les documents. Une confirmation périmée ne les
supprime pas. La duplication existante copie uniquement les informations du voyage :
aucune activité ni aucun document n'est dupliqué.

Tests manuels avec de vrais fichiers et des voyages de test :

1. Importer chacun des quatre formats depuis la section Documents, enregistrer,
   rouvrir la fiche et recharger : nom/MIME/taille et compteur doivent persister.
2. Sélectionner des fichiers plusieurs fois : cinq au maximum au total. Tester
   un fichier vide, 15 Mo, plus de 15 Mo, un faux PDF et un lot valide + invalide.
3. Vérifier qu'un lot refusé laisse les sélections précédentes intactes et que
   fermer/abandonner le formulaire ne crée ni activité ni document.
4. Tester une erreur de stockage et les clics rapides : pas de double sauvegarde,
   aucune écriture partielle et saisies/fichiers toujours disponibles pour réessayer.
5. Vérifier deux activités et deux voyages distincts, puis archive/corbeille et
   restauration. Pour les suppressions définitives, utiliser exclusivement les bases
   de test isolées. Ne pas supprimer de véritables données pour tester.
6. Vérifier le panneau mobile et le clavier. Aucun bouton de consultation,
   téléchargement ou suppression manuelle de document n'est présent à cette étape.
