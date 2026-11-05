# Sauvegarde Roam V2 — format 1

Le format d'export reste celui de l'étape 2.5.1 ; la restauration non destructive
de l'étape 2.5.2 est décrite en fin de document. Le schéma IndexedDB reste V4.
Aucun enregistrement source n'est modifié par l'export.

## Archive

ZIP standard, méthode STORE (sans compression ni chiffrement), noms UTF-8 et
CRC-32 par entrée. Aucun service distant ou CDN n'est utilisé. Le petit encodeur
local suit le sous-ensemble STORE de la spécification PKWARE :
https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT

Le manifeste est la première entrée :

- `manifest.json`
- `data/trips.json` : tableau intégral des voyages inclus
- `data/activities.json` : tableau intégral des activités incluses (champs avancés compris)
- `data/documents.json` : métadonnées originales des documents
- `data/metadata.json` : métadonnées globales pour le mode complet ; `[]` en individuel
- `documents/000001.pdf`, etc. : octets originaux des Blob, sans réencodage

Les noms de fichiers internes sont opaques et générés, jamais dérivés du nom saisi.
Le nom original reste dans `data/documents.json`. Les identifiants ne sont ni
régénérés ni transformés. Les relations tripId/activityId sont conservées.
Les photos de voyages stockées sous forme d'URL restent des URL : aucune ressource
externe n'est téléchargée. Les pièces jointes PDF/images locales sont incluses.

## Manifeste

- `format`: `roam-v2-backup`
- `formatVersion`: entier `1` (distinct du numéro de schéma IndexedDB)
- `databaseVersion`: version Dexie à la capture, actuellement `4`
- `snapshotAt`: date ISO de capture dans la transaction de lecture
- `exportedAt`: date ISO de préparation du manifeste
- `scope`: `{ "mode": "full" }` ou `{ "mode": "trip", "tripId": "..." }`
- `encrypted`: `false`
- `counts`: nombres de voyages, activités, documents, métadonnées
- `inventory`: une entrée par JSON de données et par fichier binaire, avec
  `path`, `size` (octets), `sha256` (hexadécimal minuscule)
- Les entrées binaires possèdent aussi `documentId`, qui référence la métadonnée
  portant cet `id`. Son `activityId` permet de retrouver l'activité et le voyage.

Le manifeste ne contient pas sa propre empreinte, afin d'éviter une référence
circulaire. SHA-256 et CRC détectent des altérations ; ils ne constituent pas une
signature d'authenticité et n'empêchent pas une modification intentionnelle.
Les champs optionnels absents restent absents, sans valeur par défaut injectée.
Le champ optionnel `referenceCurrency` des voyages contient un code devise ISO
reconnu. Son absence signifie EUR dans l'application, sans réécriture à l'import.
Les devises et montants historiques des activités restent indépendants et inchangés.
Ce champ ne nécessite ni changement de format 1 ni migration du schéma V4.
Les valeurs JSON des enregistrements sont conservées, y compris leurs champs
additionnels. Des nombres non finis provoquent un refus plutôt qu'une conversion
silencieuse en null.

## Périmètre et cohérence

Complet : tous les voyages, actifs/archivés/corbeille, toutes les activités,
tous les documents/Blob et toutes les métadonnées. Un orphelin ou un Blob sans
métadonnée bloque la sauvegarde complète.

Individuel : uniquement le voyage demandé, ses activités et leurs documents/Blob.
Aucune métadonnée globale ni donnée d'un autre voyage n'est exportée. Une anomalie
hors du périmètre de ce voyage ne bloque pas cet export.

Toutes les tables sont lues dans une seule transaction readonly IndexedDB.
Les écritures concurrentes attendent sa fin ou sont visibles avant son démarrage.
Les objets et références immuables aux Blob capturés restent cohérents pendant la
préparation ultérieure, même si la base change après la transaction. Les lectures
de contenu Blob, les empreintes et le ZIP sont effectués après cette transaction.

Avant de créer l'archive : contrôle des identifiants, relations parents,
correspondance un-à-un des métadonnées/Blob, taille et signature de chaque fichier,
MIME déclaré lorsque présent. Toute anomalie ou erreur de lecture interrompt
l'export. Aucun lien de téléchargement d'une archive partielle n'est proposé.
Les limites d'import ne sont pas utilisées pour éliminer des données déjà stockées.

## Limites de l’export

Pas de ZIP64 : moins de 65 535 entrées et archive strictement inférieure à
4 Gio (avec en-têtes et répertoire). Ces limites provoquent une erreur explicite.
L'archive est assemblée en mémoire avec des Blob ; une base volumineuse peut
atteindre les limites mémoire du navigateur avant la limite du format. Chaque
fichier est lu pour SHA-256 puis CRC-32 ; aucun rendu ou traitement PDF n'est effectué.
Les empreintes SHA-256 utilisent Web Crypto en HTTPS/localhost, ou un calcul local par blocs en HTTP réseau local. Les mêmes contrôles restent appliqués à l’export et à la restauration, sans changement du format ZIP. Rester sur l'écran pendant l'export ;
quitter l'écran abandonne le résultat dans l'interface, sans modifier la base.
Le bouton Télécharger demande au navigateur de sauvegarder le fichier, sans
pouvoir confirmer son écriture finale sur disque.

La validation, les limites et la politique de conflits appliquées à la restauration
2.5.2 sont définies ci-dessous. Aucun changement du format d'export n'est nécessaire.

## Restauration 2.5.2 — politique du format 1

L'export n'est pas modifié. Le lecteur accepte exclusivement le sous-ensemble ZIP
STORE produit par Roam : UTF-8, un seul disque, répertoire central et en-têtes locaux
cohérents, sans commentaires, champs supplémentaires, chiffrement, descripteurs,
compression ou ZIP64. Une archive réencodée par un outil tiers peut être refusée.
Tous les chemins doivent correspondre aux quatre JSON, au manifeste et aux fichiers
`documents/NNNNNN.ext` documentés. Doublons, chemins dangereux, entrées inattendues,
données hors inventaire ou données cachées entre les entrées sont refusés.

Limites de restauration : 512 Mio au total, 10 000 entrées, 16 Mio par JSON,
15 Mio par document, cinq documents par activité, 5 000 voyages et 100 000 lignes
par tableau. JSON : profondeur maximale 48 et 250 000 valeurs par fichier.
La limite de taille est vérifiée avant la lecture du ZIP. STORE ne décompresse
rien, ce qui exclut les bombes de décompression dans ce format. Les archives
exportées au-delà de ces limites sont refusées explicitement, sans import.

Avant toute écriture : vérification du ZIP/CRC, format/version du manifeste,
inventaire exact, tailles, SHA-256, JSON UTF-8 strict (clés dupliquées et clés de
prototype refusées), types, identifiants uniques, dates, modes de planification,
relations parents, signatures et correspondances des documents. Les valeurs
validées sont conservées telles quelles, sans normalisation. Les anciens codes
monétaires à trois lettres sont acceptés pour préserver les données historiques.
Les contrôles de signature ne sont pas un antivirus et les empreintes ne prouvent
pas l'authenticité d'une sauvegarde. Le contenu importé n'est pas exécuté.

L'aperçu est en lecture seule. Un voyage local existant (même archivé ou dans la
corbeille) est ignoré intégralement : aucune activité ni aucun document de ce
voyage n'est ajouté. Un identifiant d'activité, de métadonnée documentaire ou de
Blob déjà utilisé pour un voyage à importer provoque un refus global, sans
remappage ni écrasement. Les métadonnées globales d'un export complet sont ajoutées
uniquement pour les clés absentes ; les valeurs locales prévalent toujours.
Un export individuel n'ajoute aucune métadonnée globale.

L'utilisateur doit confirmer l'aperçu par une case à cocher puis le bouton
« Confirmer et restaurer ». Les décisions de conflits sont réévaluées sous le
verrou de la transaction rw sur toutes les tables. Si elles diffèrent de l'aperçu,
aucun ajout n'est effectué : un nouvel aperçu et une nouvelle confirmation sont
nécessaires. Les autres modifications locales sans effet sur ces décisions
n'empêchent pas l'import et restent intactes.

Les voyages absents, leurs activités, documents, Blob et clés globales absentes
sont ajoutés dans une seule transaction, exclusivement avec add/bulkAdd. Erreur,
quota dépassé ou transaction interrompue : tous les ajouts sont annulés.
Une interruption du navigateur peut aussi survenir après un commit complet ;
réimporter la même archive détectera alors les voyages déjà présents.
Les identifiants, états, dates, champs avancés et octets sont conservés.
Aucune base ni table n'est réinitialisée ou supprimée par la restauration.

Les fonctions de restauration ne prennent pas d'objets JSON arbitraires : elles
exigent une préparation validée et un aperçu générés par le module, associés à la
même base. Les enregistrements vérifiés sont privés et les résumés exposés à
l'interface sont gelés. Cela évite leur modification entre vérification et import.

## Taux manuels par voyage — 2.5.4c

Le champ optionnel `manualExchangeRates` est un tableau de paires ordonnées
`{ sourceCurrency, targetCurrency, rate, updatedAt }`. Codes ISO reconnus, devises
différentes, paire unique, taux numérique fini strictement positif et date ISO UTC
avec millisecondes sont vérifiés avant restauration. Aucun taux inverse n'est
déduit ; changer la devise de référence ne change pas ces paires. Les anciens
voyages sans ce champ restent valides, sans remplissage. Export complet/individuel
incluent ce champ ; identifiants et données des activités restent inchangés.
Dexie V4 et format ZIP 1 sont conservés. Un voyage local déjà présent reste ignoré
intégralement, y compris ses taux : aucune fusion ZIP de voyages existants.

## Cache de taux automatiques — 2.5.4d

`automaticExchangeRates` est un objet optionnel du voyage : `rates`, `checks` et
une réservation `refresh` optionnelle. Un taux contient sourceCurrency,
targetCurrency, rate, rateDate (YYYY-MM-DD), fetchedAt (ISO UTC millisecondes) et
provider (`frankfurter-v2`). Les checks conservent la dernière tentative par paire
(checkedAt, état pending/ok/unavailable/error). La réservation contient id et
startedAt, expire après 10 minutes et ne déclenche pas de réseau à l'import.

La restauration contrôle types, paires uniques/non identiques, devises reconnues,
valeurs finies positives et dates ; rateDate peut dépasser le jour UTC de fetchedAt d’un seul jour calendaire
pour tolérer un décalage de date fournisseur/fuseau/horloge. Un diagnostic
optionnel (texte, 500 caractères maximum) est accepté pour les checks en erreur.
L'absence du champ reste valide sans réécriture. Tous ces objets sont conservés
par l'export complet/individuel, toujours en format 1 et Dexie V4. Les conflits de
voyages existants restent ignorés intégralement. Les réservations importées
peuvent différer une prochaine actualisation pendant au plus 10 minutes.

## Localisation d'activité — 2.5.5a

`location` reste le nom du lieu historique. Les champs optionnels `address` (texte),
`latitude` et `longitude` (nombres finis) structurent la localisation sans migration
Dexie V4 ni évolution du ZIP format 1. Les coordonnées sont présentes ensemble :
latitude dans [-90,90], longitude dans [-180,180]. Zéro est valide. Aucune donnée
ancienne n'est réécrite. La validation de restauration réutilise validateActivity :
une paire partielle, non numérique ou hors limites est refusée avant écriture.
L'export conserve les champs existants sans normalisation, comme auparavant.
Les mises à jour partielles qui omettent la localisation la préservent ; effacer
explicitement les champs retire la localisation sans supprimer l'activité.

## Déplacements manuels — 2.6c

`Trip.manualTransfers?: ManualTransfer[]` est un champ optionnel de
`data/trips.json`. Son absence représente un voyage sans trajet. Aucun nouveau
fichier, index ou store n'est requis : Dexie V4 et format ZIP 1 restent inchangés.
Le snapshot transactionnel des voyages/activités inclut ces liens atomiquement.

Chaque trajet contient `id`, `fromActivityId`, `toActivityId`, `mode`, `currency`,
`createdAt`, `updatedAt`, et éventuellement `durationMinutes`, `estimatedCost`,
`notes`. La devise est un code ISO reconnu ; durée et coût sont des nombres finis
positifs ou nuls, sans valeur par défaut injectée. Les modes sont `walk`,
`bicycle`, `bus`, `metro`, `tram`, `train`, `car`, `taxi`, `plane`, `boat`, `other`.
Les identifiants de trajet sont uniques dans leur voyage (maximum 10 000).

L'export et l'import vérifient les champs et les deux références : activités
existantes, distinctes et du voyage parent. Les jours peuvent avoir divergé après
création : la sauvegarde conserve alors le trajet et l'application le signale
comme à corriger. Aucun lien n'est réinterprété ou corrigé lors de l'import.
Les anciennes sauvegardes sans trajets restent acceptées sans réécriture.
Un voyage déjà présent est toujours ignoré intégralement, trajets compris.
Les anciennes versions de Roam ne connaissent pas cette fonctionnalité : utiliser
la version actuelle pour modifier les activités et maintenir leurs liens.

### Partage des dépenses (2.8d, extension optionnelle du format 1)

Les voyages peuvent contenir `participants: [{id, name}]` et
`expenseShares: [{kind, expenseId, payerId, shares: [{participantId, weight}], amount,
currency, updatedAt}]`. `kind` distingue `activity` et `transfer` même si leurs
identifiants se ressemblent. `amount`/`currency` sont l’instantané du paiement confirmé
lors de l’activation du partage, pas une estimation ni un paiement supplémentaire.
Les transferts peuvent désormais avoir un `paidAmount` optionnel, conservé lors de
leurs modifications, utilisé par le partage ; le périmètre de calcul 2.8a–c est inchangé.

La validation export/import contrôle la structure, les identifiants uniques, noms
non vides normalisés (80 caractères), les participants référencés du même voyage,
les parts entières positives (maximum 1 000 000), le montant fini non négatif, la
devise ISO normalisée et la date ISO. Les références activité/transfert doivent
exister dans le voyage. Un instantané devenu obsolète par modification du paiement
reste sauvegardable et restaurable : le moteur l’exclut des soldes jusqu’à confirmation,
sans réécrire ses données. Les archives et la corbeille conservent ces informations.

Les anciens voyages sans ces champs restent inchangés et sans partage activé.
Aucune table, index ou migration supplémentaire : Dexie V4 et ZIP format 1 restent
inchangés. Les fichiers JSON sauvegardent les champs optionnels et les identifiants
originaux ; les imports atomiques et les règles de non-écrasement restent en place.

### Prévisionnel facultatif (2.8e)

`Trip.plannedBudget?: { amount: number, currency: string }` conserve le budget
prévisionnel dans sa devise d'origine (ISO normalisée, montant fini non négatif).
Absence et zéro restent distincts. Les anciennes archives sans champ restent
acceptées ; export et restauration valident tout champ présent. Aucun index,
nouvelle table ou changement de version : Dexie V4, ZIP format 1 inchangés.
Le prévisionnel n'est pas une dépense et n'entre dans aucun total d'activité.
La duplication copie le montant/devise sans copier les dépenses.

### Préparatifs facultatifs (2.9b)

`Trip.preparationTasks?: PreparationTask[]` contient les tâches propres au voyage.
Chaque tâche possède `id`, `title`, `category` (documents/luggage/transport/
reservations/other), `priority` (high/normal/low), `completed` booléen, `createdAt`
et `updatedAt` ISO, et éventuellement `dueDate` (date civile YYYY-MM-DD), `notes`
et `templateId` identifiant d'un modèle prédéfini. Limites : 500 tâches par voyage,
200 caractères par titre, 5 000 par note. Identifiants et modèles uniques dans une
même liste ; dates, catégories, priorités, types et normalisation vérifiés à
l'export comme à la restauration. Une archive invalide est refusée avant écriture.
Les anciennes archives sans champ sont acceptées sans ajout automatique.
Aucune table/index/migration : Dexie V4 et ZIP format 1 conservés. Une sauvegarde
préserve les identifiants, coches, échéances, notes et dates de modification.
La duplication d'un voyage crée de nouveaux IDs de tâches, remet les coches à
false, conserve les échéances (aucun décalage inventé), titres, catégories,
priorités et notes, avec de nouvelles dates de création/modification.

### Classement des réservations (2.9c)

`TripActivity.reservationType?: 'transport' | 'accommodation' | 'activity' | 'other'`
est un classement facultatif de la réservation de l'activité existante. Il ne
représente ni une nouvelle réservation ni un statut de confirmation/paiement.
Le champ est vérifié à l'export et à la restauration et conservé lors des éditions
partielles. Les anciennes sauvegardes sans champ restent valides. Aucun changement
de table/index, de version Dexie V4 ou de format ZIP 1.
L'espace central ne persiste aucune liste ni copie de fichier : il consulte les
activités et les métadonnées existantes, puis les Blob d'origine à la demande.
Le comportement de duplication des voyages reste inchangé : sans copie d'activités,
aucune réservation ni pièce jointe de l'original n'apparaît dans le voyage copié.
