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

## Étape 2.4.4 : consultation et gestion individuelles

`getDocument(tripId, activityId, documentId)` vérifie les deux parents, l'appartenance,
la présence du Blob, sa taille et sa signature. Seul ce Blob est lu. La liste reste
une requête de métadonnées. `deleteDocument` relit les parents et supprime les deux
lignes transactionnellement. La suppression est interdite lorsque le voyage est
à la corbeille. Le schéma reste V4.

La suite isolée vérifie lecture unique, formats, noms/MIME, accès inter-voyages et
inter-activités refusés, fichiers absents/corrompus, rollback de suppression,
conservation des autres documents et persistance après réouverture.

La visionneuse crée une URL temporaire uniquement après lecture du document et la
révoque à sa fermeture, son démontage ou un changement de fichier. Aucun fichier
n'est transformé en HTML. Les images sont rendues par `<img>`, les PDF par un iframe sans attribut `sandbox` pour permettre le lecteur natif.
L'absence de lecteur PDF ou les paramètres du navigateur peuvent empêcher l'affichage. Le message de repli et le bouton de
téléchargement restent toujours disponibles. Il n'est pas possible de détecter
fiablement tous les échecs internes du lecteur PDF. Aucun moteur PDF externe ajouté.

Tests manuels (fichiers et activités de test uniquement) :

1. Depuis la fiche, consulter PDF/JPEG/PNG/WebP, dont une image de QR code. Vérifier
   ajustement, zoom et défilement, puis Télécharger : nom d'origine et contenu corrects.
2. Sur mobile : plein écran, zones de sécurité, rotation ; sur ordinateur : modal,
   fond, fermeture, Tab/Maj+Tab et Échap. Depuis l'iframe PDF, certains raccourcis
   peuvent être gérés par le lecteur natif ; le bouton Fermer reste disponible.
3. Ouvrir/fermer plusieurs fichiers et changer de voyage : pas de fichier ancien
   affiché, retour au focus dans la fiche, URL Blob révoquées (outils navigateur).
4. Annuler puis confirmer Supprimer. Vérifier un seul document retiré, compteur
   actualisé et emplacement libéré pour un nouvel import, puis recharger.
5. Supprimer le document dans un autre onglet pendant la consultation : fermeture
   propre et message. Tester aussi stockage inaccessible ou Blob manquant sur la
   base de tests, sans altérer de données réelles.
6. Sans lecteur PDF intégré, ou si ses paramètres empêchent son rendu, vérifier le message
   et le téléchargement. Le téléchargement démarre via le navigateur ; son achèvement
   dépend du navigateur et ne peut pas être confirmé par l'application.


## Correctif PDF natif de Chrome

Cause : `sandbox=""` sur l'iframe restreint les plugins et empêche le lecteur PDF
natif de Chrome de fonctionner. Ajouter seulement `allow-scripts` ou
`allow-downloads` ne résout pas cette restriction. Référence :
https://issues.chromium.org/issues/40754148

`NativePdfPreview` reçoit exclusivement l'URL Blob créée par la visionneuse après
`getDocument` (isolation, MIME `application/pdf`, taille et signature vérifiés).
Les sources HTTP, data et javascript ne sont pas chargées par ce composant.
`referrerPolicy="no-referrer"` est conservé. Le chargement à la demande et la
révocation des URL restent dans `DocumentViewer` et ne sont pas modifiés.

Risque résiduel : retirer `sandbox` supprime les restrictions HTML de cet iframe.
La vérification d'en-tête n'assainit pas un PDF non fiable et n'exclut pas les
PDF polyglottes. Le lecteur natif peut traiter scripts, formulaires et liens PDF
selon ses propres règles ; Roam ne peut pas imposer leur désactivation avec cette
solution sans dépendance. L'isolation et les protections du lecteur relèvent du
navigateur. Une URL Blob locale ne garantit pas qu'un document est inoffensif.
Aucun contenu n'est injecté avec srcdoc ou comme HTML dans l'application.

La suite isolée appelle `nativePdfPreview.browser.tsx` : rendu HTML inerte du vrai
composant, absence de sandbox, conservation de src/titre/referrer, refus des sources
non-Blob et messages de repli. Elle ne démontre pas le rendu du lecteur PDF natif.

Non-régression visuelle sous Windows :

1. Dans Chrome, consulter un PDF valide importé dans IndexedDB : pages visibles,
   sans icône cassée. Tester aussi un autre navigateur et le mobile.
2. Vérifier le message/Télécharger avec le lecteur PDF désactivé dans les paramètres.
   Un événement load d'iframe ne prouve pas la réussite du rendu : le message reste
   donc toujours visible, y compris si le lecteur échoue silencieusement.
3. Ouvrir/fermer plusieurs PDF, changer de fichier/voyage : vérifier la révocation
   des URL Blob dans les outils navigateur, le focus et Échap.
4. Recontrôler images/QR, zoom, téléchargement au nom original et suppression
   confirmée : leurs implémentations ne sont pas modifiées par ce correctif.

## Étape 2.5.1 : export ZIP

Format documenté dans `src/backup/FORMAT.md`.
La suite `/tests/activities.html` lance aussi `backups.browser.ts` dans une base
`roam-v2-test-backups-<UUID>` supprimée à la fin : export complet, individuel,
archives/corbeille, CRC, répertoire ZIP, inventaire SHA-256, binaires identiques,
relations, champs avancés, base vide, données source inchangées, snapshot conservé
après modifications, Blob manquant/corrompu/orphelin et parent absent.
L'analyseur ZIP présent dans ces tests est une inspection en mémoire, pas une
fonction de restauration de l'application.

À vérifier manuellement :

1. Sans voyage sélectionné, ouvrir Plus et créer la sauvegarde complète ; vérifier
   le message de confidentialité, l'attente puis le lien Télécharger le ZIP.
2. Exporter un voyage actif, archivé et dans la corbeille via leurs cartes : aucun
   autre voyage ne doit figurer dans les données JSON.
3. Ouvrir le ZIP avec l'explorateur Windows ou 7-Zip ; consulter les JSON et comparer
   quelques fichiers extraits à leurs originaux (empreinte, contenu et taille).
4. Pendant l'export, modifier des données depuis un autre onglet : l'archive doit
   refléter la capture initiale, sans mélange entre métadonnées et fichiers.
5. Tester base vide, clics rapides, erreur puis nouvelle tentative et gros documents.
   Une erreur ne doit jamais proposer un ZIP partiel ; aucune donnée n'est supprimée.
6. Vérifier l'interface mobile et le téléchargement effectif sous Windows.

## Étape 2.5.2 : restauration non destructive

La suite `/tests/activities.html` appelle `restore.browser.ts` avec deux bases
`roam-v2-test-restore-*` isolées, supprimées en fin de test. Elle contrôle :
préparation/aperçu sans écriture, base vide, identifiants et relations, champs
avancés, archives/corbeille, octets et persistance, conflits complets et mixtes,
modification des conflits après aperçu, collisions d'identifiants enfants,
rollback sur quota/interruption, ZIP corrompu, SHA invalide malgré CRC recalculé,
version incompatible, JSON ambigu, champs/relations invalides malgré empreintes
recalculées, chemins dangereux, entrée inattendue, limite de taille simulée sans
allouer 512 Mio, export individuel et sauvegarde vide.

Tests manuels depuis Plus, exclusivement avec des sauvegardes/bases de test :

1. Choisir un ZIP Roam : attendre la vérification, examiner les listes importer/
   ignorer et les compteurs ; aucune donnée ne doit apparaître avant confirmation.
2. Cocher la confirmation et restaurer ; vérifier les trois états de voyages,
   activités, réservations, prix zéro, liens et documents, puis recharger.
3. Réimporter : les voyages existants sont ignorés intégralement, sans compléter ni
   écraser leurs activités/documents. Tester également un conflit partiel.
4. Entre aperçu et confirmation, ajouter un voyage concerné depuis un autre onglet :
   l'import doit être refusé, puis réussir après actualisation et reconfirmation.
5. Tester ZIP incomplet/corrompu, fichier non ZIP, erreur de quota et nouvelle
   tentative : aucune écriture partielle. Ne pas interrompre de données réelles.
6. Vérifier clavier, annonce des résultats, mobile, noms longs et sélection du
   même fichier après erreur. Les contrôles ZIP/empreintes/types sont réalisés
   aussi pour les voyages qui seront finalement ignorés.

## Étape 2.5.3a : ressources PWA

Procédure détaillée : `pwa/README.md`.
Après build sous Windows : `npm.cmd run test:pwa` vérifie les ressources de dist,
le manifeste et les icônes, puis simule le cache du worker à la racine et sous
préfixe. Aucun enregistrement réel de service worker ni aucune base utilisateur
n'est modifié par ce script. Les tests visuels se font avec `vite preview`, pas
avec le serveur de développement. `node tests/pwa-check.mjs --source-only` ne
vérifie pas les artefacts du build.

## Devise de référence — 2.5.4a

La suite `/tests/activities.html` inclut `currency.browser.ts` : bases isolées,
défaut EUR sans migration, codes invalides, persistance des devises, montants
historiques inchangés et restauration ZIP avec/sans referenceCurrency.

Vérifications UI : créer un voyage GBP, le modifier en USD puis le dupliquer ;
vérifier la devise dans chaque formulaire. Une nouvelle activité propose USD,
modifiable en GBP ; modifier une ancienne activité sans devise doit laisser ce
champ vide. Changer la devise du voyage ne modifie ni les montants ni les devises
des activités. Tester aussi un ancien voyage : EUR proposé à son ouverture.
Aucun taux, conversion ou accès réseau n'est ajouté.

## Sélecteur de devises — 2.5.4a.1

`currencySelector.browser.tsx`, intégré à `/tests/activities.html`, vérifie le
catalogue partagé avec la validation, l'ordre des devises courantes, la recherche
par code/nom et quelques pays (sans accents), les valeurs historiques, le budget
d'activité et les interactions React : flèches/Entrée, clic, Échap, focus et sortie.

Manuellement, tester création/modification/duplication d'un voyage puis création
et modification d'une activité ; vérifier après rechargement que seul le code ISO
est enregistré. Une activité ancienne sans devise reste « Devise non renseignée ».
Une devise historique inconnue reste affichée et conservée tant qu'aucun autre
choix n'est fait. Tester une recherche sans résultat (Entrée ne doit pas soumettre
le formulaire), Tab/Maj+Tab, Échap dans le panneau d'activité (ferme d'abord la
liste), lecture avec un lecteur d'écran, longue liste sur mobile et hors connexion
après un nouveau build précaché. Aucun appel réseau n'est nécessaire au catalogue.
Les alias de pays sont une aide limitée aux principales devises, pas un annuaire
exhaustif ; noms et symboles dépendent des données Intl du navigateur.

## Moteur monétaire — 2.5.4b

`money.browser.ts` est exécuté au début de `/tests/activities.html`. Il vérifie
identité EUR, JPY/EUR, zéro/absence, codes/taux invalides, formats EUR/JPY/KWD,
totaux estimés/payés distincts, exclusions, erreurs de résolveur, débordements,
immutabilité et absence d'arrondi avant somme. Ces tests purs n'écrivent aucune
donnée et ne font aucun appel réseau. Contrat et limites : `src/money/README.md`.

## Taux manuels — 2.5.4c

`manualRates.browser.ts` dans `/tests/activities.html` couvre validation, saisie
française, précision, dates, direction, priorité et intégration au moteur, CRUD
persisté, deux connexions Dexie, conflits, indépendance, rechargement et ZIP.
Les bases de ces tests portent le préfixe `roam-v2-test-manual-rates-`.

Manuellement : créer/modifier un voyage, ajouter deux paires avec virgule et point,
enregistrer et rouvrir ; vérifier les dates. Tester confirmation/annulation de
suppression puis annulation globale du formulaire. Vérifier les erreurs de paire
dupliquée/identique et de valeur invalide sans perte de saisie. Changer la devise
de référence, dupliquer et vérifier les taux. Dans deux onglets, modifier des
paires différentes (fusion) puis la même paire (conflit sans écriture partielle).
Tester mobile, clavier, sélecteurs, enregistrement hors ligne et protection PWA
pendant les saisies. Les écrans Programme/Budget ne montrent aucune conversion.

## Taux automatiques — 2.5.4d

`automaticRates.browser.ts` est intégré à `/tests/activities.html` : validation V2,
dates, cache, priorité manuelle, paires utiles, erreurs HTTP/réseau/JSON simulées,
quotidien/manuel, hors connexion, persistance, conflits et restauration ZIP. Aucun
appel réel à Frankfurter : fetch et horloge sont injectés. Bases temporaires
`roam-v2-test-auto-rates-*`. Procédure UI/CORS et limites :
`src/money/AUTOMATIC_RATES.md`.

## Conversions dans la fiche activité — 2.5.4e

`activityMoney.browser.tsx` dans `/tests/activities.html` couvre la présentation
pure et le rendu HTML : symboles/codes, montants originaux, manuel prioritaire,
automatique, dates, identité, taux manquant, devise historique absente/inconnue,
zéro, montant absent, estimation/paiement séparés, ancienneté et immutabilité.

Manuellement : ouvrir une fiche datée puis une idée à planifier, vérifier les
équivalents avec un taux manuel puis automatique. Modifier les taux ou la devise
de référence depuis un autre onglet : la fiche doit se mettre à jour sans fermer
le panneau. Tester hors connexion, modifier l’activité puis enregistrer et vérifier
le retour à la fiche. Sur mobile (320/375 px), vérifier absence de débordement,
lisibilité des dates et avertissements, défilement, bouton Retour et Échap au clavier.
Les cartes et le calendrier doivent rester inchangés. Aucun montant converti
n'est enregistré et aucun appel réseau supplémentaire n'est initié par la fiche.

## Accès direct aux paramètres du voyage — 2.5.4f

Vérifications manuelles sur une origine de test (desktop et mobile 320/375 px) :

1. Ouvrir un voyage puis Programme, Carte et Budget successivement. Le bouton
   partagé « Paramètres » doit ouvrir le formulaire existant, prérempli pour le
   voyage actif. Tester Tab/Entrée/Espace et son nom accessible « Paramètres du voyage ».
2. Depuis chaque onglet, modifier un champ puis enregistrer : même voyage et
   même onglet, données mises à jour et focus rendu au bouton. Annuler une autre
   saisie : même écran et aucune écriture des champs/taux manuels en cours de saisie.
   Les actualisations de taux automatiques restent des opérations explicites ou
   automatiques indépendantes de l'enregistrement du formulaire, comme auparavant.
3. Dans Programme, sélectionner une journée, puis Calendrier ou Idées à planifier.
   Modifier le nom/la devise : mode/journée conservés. Modifier les dates : mode
   conservé ; seule une journée/un mois hors séjour revient au premier disponible.
4. Ouvrir un formulaire d'activité et saisir du texte sans enregistrer : son
   dialogue natif doit empêcher l'accès au bouton derrière, sans superposition.
   Modifier les dates du voyage depuis un autre onglet : la saisie d'activité
   reste montée et inchangée ; vérifier aussi la fiche activité ouverte.
5. Vérifier création et modification depuis les cartes de l'accueil ; les boutons
   existants restent fonctionnels. Le nouvel accès n'apparaît pas sans voyage actif.
6. Tester une longue destination sur mobile : nom tronqué, bouton visible, aucun
   débordement horizontal. Vérifier les erreurs de validation/conflit : formulaire
   et saisies conservés, pas de navigation ni double ouverture pendant l'écriture.

Aucun changement de schéma, ZIP, données ou montant n'est requis pour cet accès.

## Localisation structurée — 2.5.5a

`activityLocation.browser.tsx` est intégré à `/tests/activities.html` : décimales,
limites, paires, zéro, valeurs invalides, formulaire/rendu, CRUD, ancienne activité,
copie via l'API existante, préservation partielle, réouverture et export/import ZIP.
Bases isolées `roam-v2-test-location-*`, aucun réseau ni géolocalisation.

Manuellement : créer avec/sans lieu ; ajouter adresse et GPS dans Informations
complémentaires, avec virgule puis point. Tester une seule coordonnée, des limites
invalides et 0/0 ; vérifier l'erreur sans perte de saisie. Enregistrer, rouvrir et
consulter la fiche. Effacer la localisation puis annuler (données préservées), puis
effacer et enregistrer (activité conservée). Tester hors connexion et sur mobile,
notamment les coordonnées négatives, le clavier, les longs noms/adresses et les
notes existantes. Vérifier que les cartes d'activité continuent à afficher le nom
du lieu. L'application ne duplique pas encore les activités depuis l'interface ;
aucune nouvelle duplication n'est ajoutée. L'API peut recréer une activité à partir
d'une autre sans perdre sa localisation ; la duplication actuelle de voyage ne
copie toujours pas ses activités. Aucune carte, recherche, lien ou géocodage ajouté.

### Diagnostic « Formulaire non normalisé »

Le test indique désormais le champ fautif, la valeur attendue, la valeur réelle
et leur type. La fixture d'origine et toutes les validations restent présentes ;
des cas point/virgule, espaces, zéro et ancien lieu sans coordonnées traversent
aussi la chaîne complète formulaire → validateActivity.

Si cet échec apparaît, relancer la suite sur l'adresse du serveur `npm.cmd run dev`
(port indiqué par Vite), chemin `/tests/activities.html`, et relever le nouveau
message exact. Un serveur preview sert les fichiers générés lors du dernier build,
pas les sources en cours ; le service worker PWA ne s'enregistre pas en mode dev.
Vérifier le dossier PowerShell courant et l'URL utilisée, sans vider les caches,
supprimer les données du site ou désenregistrer le service worker. Le message
attendu contient désormais « attendu …, reçu … » ; l'ancien libellé seul indique
que cette version du test n'est pas celle exécutée.

La fixture de localisation utilise un parent `location-test-trip` ajouté seulement
à la base source isolée. Les deux bases contiennent déjà le voyage d'exemple
`london-2026` : l'utiliser comme parent ferait ignorer ses activités à l'import,
conformément à la politique anti-écrasement. Le test contrôle désormais l'aperçu
(voyage de fixture importé, Londres ignoré), l'existence de l'activité restaurée
puis l'égalité complète de ses données. Aucun contrôle de localisation ni règle
de conflit de restauration n'est relâché.

Le correctif inclut aussi une zone d'action dédiée pour « Effacer la localisation » :
espacement vertical et séparateur, alignement à droite sur desktop, pleine largeur
sur mobile et hauteur minimale de 44 px. Vérifier à 320/375 px avec les coordonnées
GPS ouvertes puis fermées : aucun chevauchement, libellé lisible et action bien
séparée des champs. Les styles sont limités à `.activity-location-actions`.
