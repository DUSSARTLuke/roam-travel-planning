# 2.10b — Préparation locale de la synchronisation

Implémentation locale uniquement. Aucun réseau, compte, SDK, Auth ou appel Supabase.
Le protocole distant et la fusion entre appareils restent à réaliser et à valider.
Voir [l’architecture proposée](sync-architecture.md).

## Schéma Dexie V5 additif

Les cinq tables métier et les migrations V1–V4 sont conservées. V5 ajoute :

| Table | Rôle |
| --- | --- |
| syncMeta | Une identité UUID v4 d’installation, version locale de protocole, compteur transactionnel d’opérations |
| syncEntities | Identité UUID de filiation indépendante de l’ID métier, révision locale, serverRevision=null, état supprimé, références parentales |
| syncOutbox | Opérations immuables identifiées, groupe transactionnel, révision précédente/nouvelle, instantané et statut pending/superseded |
| syncCommands | Reçus locaux d’exécution idempotente avec empreinte de commande et attentes |
| syncConflicts | Réservée aux conflits non résolus (modèle fourni ; aucune réception distante à ce stade) |

Les anciennes lignes métier ne sont pas réécrites. L’upgrade crée une baseline
pour chaque voyage, activité, métadonnée et Blob existant et une opération de création
initiale. Une base vide reçoit seulement son identité ; Londres n’est pas réinséré.
Une nouvelle base conserve son initialisation habituelle, elle aussi journalisée.
Une réouverture n’amorce pas une deuxième fois le journal. Une erreur/quota pendant
l’upgrade annule la migration IndexedDB, sans valider un état partiel.

Identité de l’installation : stable pour cette base/origine/profil ; une autre origine,
un autre navigateur ou un effacement de stockage constitue une autre installation.
Aucun identifiant d’appareil matériel ou traçage n’est utilisé. Les IDs métier anciens
(non UUID compris) et toutes les relations existantes sont conservés. Une duplication
créant un nouvel ID reçoit une nouvelle filiation. Une réutilisation explicite d’un
ID physiquement supprimé crée une nouvelle identité, sans ressusciter la précédente.

## Frontière d’écriture et atomicité

`src/sync/journal.ts` utilise le middleware DBCore public de Dexie, sous ses caches.
Il intercepte add/put/delete/deleteRange, y compris clear/bulk et les écritures directes,
pour éviter une voie de sauvegarde oubliée dans un composant. Les tables techniques
sont exclues de l’interception. Les transactions métier readwrite incluent les tables
techniques et les quatre tables suivies pour garantir les relations parentales ;
c’est un verrouillage conservateur, sans lecture des Blob quand ils ne sont pas modifiés.
Les lectures habituelles conservent leur périmètre et leur fonctionnement réactif.

Mutation métier, compteur, état et opération utilisent la même transaction native.
Un échec du journal annule la mutation métier, même si l’appelant intercepte l’erreur.
Deux onglets partagent le compteur sérialisé IndexedDB. Un groupe identifie la transaction
native entière (cascade, partage ou import compris). Une mise à jour sans changement
JSON n’ajoute pas de révision ; un Blob est traité comme un contenu immuable.
Aucun réseau, lecture de fichier, timer ou empreinte asynchrone dans cette transaction.

Les créations obtiennent leur identité par createId (UUID natif ou getRandomValues,
compatible HTTP LAN). Les opérations ordinaires utilisent installationId:compteur ;
modifier une ligne déjà identifiée ne nécessite pas de nouvelle source aléatoire.
Le compteur est un ordre local, pas un curseur serveur ni une comparaison entre appareils.
Les anciens IDs de baseline sont opaques et ne sont jamais réutilisés.

Granularité actuelle **conservatrice** : un Trip est un agrégat, avec ses listes
embarquées (transferts, tâches, contacts, participants, partages et taux). Leurs IDs
ou clés naturelles (paire de devises, type+expenseId) restent stables dans les
instantanés. Pas de second modèle financier ni de normalisation destructive.
La future projection par élément et fusion à trois versions sera développée avant
un transport distant. Un changement de liste ne sera pas envoyé comme un remplacement
aveugle de tout le voyage. Les métadonnées d’initialisation ne sont pas synchronisables.

`runLocalCommand` prépare le contrat de rejeu : commande identifiée, empreinte et
attentes (identité + révision), repositories exécutés dans une transaction, reçu écrit
uniquement après succès. Même commande confirmée : action non exécutée une deuxième
fois. ID réutilisé pour une autre empreinte/attente : refus. Attente devenue obsolète :
LocalRevisionConflict avant l’action, sans écriture métier. Les attentes doivent
couvrir les unités modifiées ; les règles métier restent dans les repositories.
Les formulaires existants gardent leurs protections ; cette étape ne prétend pas
convertir tous les formulaires en protocole de conflit distribué.

## Suppressions et conservation

Archivage/corbeille : mises à jour ordinaires, aucun Blob perdu.
Suppression définitive : tombstone d’identité/révision sans contenu et cascade
journalisée dans le même groupe. Les payloads d’opérations antérieures de l’entité
supprimée sont retirés et marqués superseded dans la même transaction, notamment
les Blob : un fichier supprimé n’est pas conservé dans une ancienne création en file.
Le futur émetteur devra ignorer ces anciennes opérations et traiter la suppression
avec son identité. Aucun nettoyage automatique de tombstone n’est activé.

Les autres instantanés pending restent en attente : aucun acquittement distant,
ni purge après timeout. Cela augmente la place locale, surtout après migration et
pour des documents ; le quota peut refuser une écriture avec rollback. La compaction,
les accusés serveur, les transferts reprenables et le rapprochement inter-appareils
sont hors périmètre. La préparation locale n’est pas une sauvegarde externe.

## ZIP format 1 : ancien et nouveau

Nouveau manifeste : databaseVersion=5 et extension optionnelle `localSync` version 1,
contenant l’inventaire de filiation/révisions/tombstones et leurs références.
Les quatre JSON métier, les octets des documents et le format ZIP STORE 1 restent
inchangés. Le manifeste, comme avant, n’est pas signé : intégrité n’est pas authenticité.
Les identités et relations de l’extension sont contrôlées, y compris son inventaire
vivant complet, ses dates, son périmètre individuel et l’absence de champs techniques
inattendus. Les payloads de documents supprimés ne sont pas exportés.

Le nouveau lecteur accepte databaseVersion 4 ou 5 ; V5 exige l’extension complète.
Un ancien lecteur V4 refusera V5 : ne pas maquiller la version réelle de base.
Les anciennes sauvegardes V4 sans filiation restent acceptées, avec de nouvelles
identités locales lors de leur import. L’export individuel filtre aussi les tombstones
par voyage, sans inclure les suppressions d’autres voyages.

Ne sont jamais portés dans le ZIP : identité/compteur de l’installation, outbox,
reçus de commandes, baux, jetons ou secrets. La filiation est préservée mais une révision
importée reste une provenance (`sourceRevision`), pas une révision serveur de confiance.
L’import génère de nouvelles opérations locales ; il ne rejoue pas la file exportée.
Les suppressions importées créent des tombstones et opérations, **sans supprimer de
ligne métier locale**. Une identité/tombstone locale en conflit entraîne un refus
atomique ; un voyage déjà présent reste entièrement ignoré comme précédemment.
Aucun rapprochement ou fusion automatique par ID, destination ou contenu.

## Retour arrière

Avant de mettre à jour sur un appareil réel : conserver un ZIP V4 vérifié ; laisser
les anciennes fenêtres se fermer si elles bloquent la migration. Ne pas effacer les
données pour débloquer une ouverture. Une application strictement V4 ne peut pas
ouvrir une base déjà V5. Le retour sûr est une version corrective connaissant V5,
sans transport réseau (c’est déjà le cas de cette étape), conservant les nouvelles
tables. Jamais de downgrade/reset automatique. Une migration échouée ne valide pas V5.
La restauration d’une sauvegarde est non destructive et soumise à aperçu/conflits,
pas un moyen d’écraser la base pour revenir à une ancienne version.

## Vérifications

Tests isolés `tests/localSync.browser.ts` : migration V4 intacte, baseline unique,
identité stable, deux connexions concurrentes, rollback métier/journal, échec du journal,
rejeu et conflit de révision, duplication, suppression en cascade et retrait des anciens
payloads, sauvegardes V4/V5 et filiation/Blob, refus de rapprochement.
La suite existante couvre aussi les autres migrations, les documents, les sauvegardes,
les vues mobiles et l’utilisation sans réseau. Ne jamais faire ces essais destructifs
sur la base utilisateur.

```powershell
# Depuis roam-v2/
npm.cmd run lint
npm.cmd run build
npm.cmd run test:pwa
npm.cmd run dev
# Ouvrir /tests/activities.html puis lancer la suite isolée.
```

Contrôles manuels restants : migration d’une copie de base avec gros PDF sur téléphone,
320/375 px, mode avion, redémarrage PWA, deux onglets, export complet/individuel et
import sur un profil de test séparé. Vérifier dans IndexedDB une même identité d’installation
après réouverture, une révision après modification, un tombstone après suppression d’une
fixture uniquement. Aucun panneau de sync distant ni promesse d’envoi automatique.

Référence technique : [Dexie.use / DBCore](https://dexie.org/docs/Dexie/Dexie.use()).

## 2.10b.1 — Suppression accessible depuis le Programme

Audit : `deleteActivity` gérait déjà la cascade, mais ni la fiche ni le formulaire
ne proposaient d’action pour l’appeler. La fiche partagée propose maintenant, sous
« Modifier l’activité », « Supprimer l’activité ». Depuis le Programme (Jour,
Multi-jours, idées), ouvrir la carte d’activité pour atteindre cette action.
La même fiche reste utilisable depuis la Carte, le mode voyage et les réservations.
Le formulaire d’édition conserve son rôle et ne perd aucune saisie par une nouvelle
action de suppression dans un formulaire modifié.

La confirmation dans la fiche cite le nom et la portée : activité et ses informations
de réservation/documents, déplacements liés, partages associés. Elle conserve les
autres activités/fichiers et les participants. Annuler ou Échap revient à la fiche,
avec restauration du focus. Pendant la suppression, double clic, fermeture et mise
à jour PWA sont bloqués. Une erreur laisse la confirmation ouverte.

La confirmation capture la version affichée ; le repository relit et compare cette
version dans la transaction avant toute suppression. Activité modifiée, autre voyage,
parent archivé ou à la corbeille : refus sans suppression. La cascade reste celle du
repository existant, journalisée atomiquement en V5 ; aucun reset ni migration nouvelle.

Tests `tests/activityDeletion.browser.tsx` : base V4 avec réservations, documents,
transferts et partages, migration V5, confirmation/annulation/Échap, erreur, double clic,
refus de version obsolète/archivage/inter-voyages, isolation, tombstones, groupe de
suppression et rollback complet sur collision du journal.

À vérifier sur téléphone : ouvrir une fiche depuis Jour/Multi-jours/Idées, repérer le
bouton en bas, annuler puis supprimer une fixture uniquement, vérifier le retour au
Programme et les boutons tactiles. Ne jamais supprimer un vrai voyage pour tester.

## 2.10b.2 — Éditions concurrentes des activités

Le bug A/B a été reproduit avant correction dans **deux onglets Chrome réels**.
Une lecture juste avant sauvegarde ne suffit pas : elle ne constitue pas la version
sur laquelle l’utilisateur a rempli son formulaire et n’est pas un contrôle atomique.

`activityRevision.ts` associe aux instantanés du repository une attente transitoire
(clé d’entité, identité et révision V5). Ce jeton est un Symbol copié par spread,
absent du stockage métier et du JSON ; il ne change ni Dexie V5 ni ZIP format 1.
Les méthodes get/list/create/update/organisation renvoient un instantané versionné.
`updateActivity` exige le jeton de cet instantané, ou un argument expected explicite.
Un appel sans révision est refusé : il ne peut pas transformer implicitement la version
courante en version d’ouverture. Les anciens callers internes/tests doivent lire un
instantané récent pour effectuer une nouvelle édition, pas masquer une édition obsolète.

Dans la transaction readwrite existante, avant tout put et avant tout document ajouté,
le repository vérifie l’identité et la révision de syncEntities. Une activité supprimée,
remplacée, archivée ou modifiée entraîne un refus, sans écriture ni opération au journal.
La frontière native V5 conserve le contrôle et l’écriture dans la même transaction ;
les documents restent atomiques avec l’activité. Les champs avancés omis des appels
partiels restent préservés comme avant.

Le formulaire capture son instantané à l’ouverture, vérifie qu’il correspond aux champs
affichés puis conserve cette version jusqu’à un rechargement explicite. Il ne relit plus
une activité récente pour la fusionner automatiquement avec une vieille saisie. Un conflit
laisse champs et fichiers sélectionnés intacts. « Recharger les données récentes » charge
les champs récents ; les anciennes saisies restent dans des zones de texte consultables
et sélectionnables. L’utilisateur réapplique explicitement les informations souhaitées.
Un fichier sélectionné reste en attente et la limite de cinq est revérifiée à l’écriture.

Les parents des formulaires conservent un instantané d’édition lorsqu’une activité disparaît
d’une requête réactive : Programme, Carte, Mode voyage, Accueil, Réservations, Infos pratiques.
La suppression distante ne ferme plus silencieusement le formulaire en jetant sa saisie.
Aucune résurrection automatique n’est possible ; un rechargement après suppression indique
l’indisponibilité et laisse la saisie lisible. Les brouillons restent en mémoire : une
fermeture ou un rechargement complet peut les perdre après l’avertissement de fermeture.

### Audit ciblé des autres formulaires

| Formulaire | Protection atomique existante ou renforcée |
| --- | --- |
| Déplacement | transferKey attendu ; figé à l’ouverture, même si les props évoluent ; paidAmount non affiché préservé ; saisie conservée si lien supprimé |
| Horaire/date rapide | schedulingKey attendu, désormais figé à l’ouverture ; patch limité à la planification ; notes/finances non concernées préservées |
| Prévisionnel | Snapshot initial du montant/devise, comparé dans savePlannedBudget |
| Participant | Nom attendu d’un participant capturé par le dialogue ; contrôle des références avant suppression |
| Partage | sharingVersion du paiement et du partage capturée à l’ouverture, validée dans la transaction |
| Préparatif / fiche pratique | Snapshot de l’élément capturé par le dialogue, comparaison complète au repository ; autres éléments préservés |
| Paramètres voyage | Baseline de champs du formulaire et vérification champ par champ dans saveTripWithRates ; patch étroit ; fusion par paire des taux manuels déjà existante, non modifiée |
| Documents | Fichiers immuables par ID ; ajout/suppression transactionnels avec parent, limites et relations relus ; pas de formulaire remplaçant un ancien contenu |

Les protections ciblées existantes restent en place : une modification sans rapport ne
réécrit pas tout le voyage. Pas de nouvel algorithme de fusion, pas de synchronisation
avec une ancienne version de l’application : fermer/mettre à jour les anciennes fenêtres
avant d’utiliser plusieurs onglets. Aucun formulaire d’activité ne reste sans le contrôle
V5 ; les autres formulaires gardent leur CAS métier ciblé et leurs messages de refus.
Le bouton de rechargement avec copie de saisie est propre au formulaire d’activité ;
pour les autres, conserver la saisie puis fermer/rouvrir comme indiqué par leurs erreurs.

### Tests reproductibles

`npm.cmd run test:concurrency` démarre un Vite temporaire, Chrome headless et deux vrais
onglets sur une base `roam-v2-test-concurrent-*`, puis nettoie uniquement ce profil/base.
Il vérifie A/B, écritures simultanées, refus sans révision, formulaires avec fichier,
absence d’écriture/journal en conflit, copie du brouillon, rechargement, double clic,
réenregistrement et suppression concurrente avec parent réactif.
Chrome Windows est utilisé par défaut ; ROAM_CHROME_PATH permet de préciser son chemin.
Aucun SDK, backend, clé ou donnée utilisateur n’est utilisé.
