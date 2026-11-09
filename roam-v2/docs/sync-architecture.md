# Roam V2 — 2.10a : audit et architecture de synchronisation

Date : 6 novembre 2026. Branche examinée : `develop-v2`.
Statut : **proposition à valider**, aucune synchronisation implémentée.
Périmètre initial recommandé : un compte personnel, plusieurs appareils, aucune
collaboration ni synchronisation anonyme implicite. IndexedDB reste la base de
travail de l’interface ; le serveur assure la convergence et la copie distante.

## 1. Audit du code actuel

| Domaine | Constat vérifié | Conséquence pour la synchronisation |
| --- | --- | --- |
| Dexie | `src/db/database.ts` : V1 voyages, V2 marqueur d’initialisation, V3 activités, V4 documents séparés de leurs Blob | Ne modifier aucune de ces migrations. Une future évolution technique sera additive. |
| Voyages | `trips` : ID texte, destination, pays, dates civiles, voyageurs, image ; archivage et corbeille optionnels | Pas de propriétaire, révision serveur ni dates techniques globales fiables sur Trip. |
| Collections embarquées | Participants, partages, transferts, taux manuels/automatiques, budget prévisionnel, préparatifs et carnet pratique sont des champs de Trip | Un remplacement distant de Trip peut écraser plusieurs fonctionnalités indépendantes. Les listes exigent un rapprochement par ID, pas par position. |
| Activités | `activities` : ID, tripId, createdAt/updatedAt ; index tripId et [tripId+date] ; idées avec date=null | Montants, réservations, liens et localisation sont dans l’activité, sans réservation parallèle. `updatedAt` est une horloge d’appareil, pas une version distribuée. |
| Documents | `activityDocuments` : id/activityId/name/mime/size/importedAt ; `activityDocumentBlobs` : id/blob | Les lectures légères restent sans Blob. Pas de SHA persistant dans ces métadonnées : le calcul actuel sert notamment aux sauvegardes. |
| Limites locales | 5 documents/activité, 15 × 1024 × 1024 octets/fichier ; PDF/JPEG/PNG/WebP, signatures contrôlées | Refaire les contrôles sur le serveur ; contrôler les ajouts simultanés, pas seulement chaque client. |
| IDs | `src/utils/createId.ts` : UUID v4 natif ou getRandomValues ; anciens IDs textuels dont `london-2026` | Ne pas imposer une colonne UUID serveur et ne pas régénérer les IDs existants. Le voyage d’exemple a le même ID sur plusieurs bases indépendantes. |
| Initialisation | `populate` crée Londres une seule fois ; migration V2 marque toute base antérieure déjà initialisée, même vide | Ne pas synchroniser le marqueur d’initialisation comme une donnée utilisateur. Ne pas lancer un nouvel amorçage lors d’une réception distante. |
| Réactivité | useLiveQuery et transactions IndexedDB | Suffisant entre onglets de la même origine/profil, aucune réplication ordinateur/téléphone. HTTP LAN, localhost, HTTPS et profils distincts ont des bases distinctes. |
| Images de voyage | `Trip.image` contient une chaîne, notamment URL externe | Une URL n’est pas une photo locale sauvegardée ; ne pas promettre sa disponibilité hors ligne. Auditer les valeurs historiques avant d’imposer une limite réseau. |

### Écritures et concurrence

Sources examinées : `src/db/activities.ts`, `documents.ts`, `transfers.ts`,
`tripRates.ts`, `automaticRates.ts`, `preparation.ts`, `practical.ts`,
`expenseSharing.ts`, ainsi que les écritures directes de `src/App.tsx`.

- Les transactions relisent le parent et bornent les relations au voyage.
  L’enregistrement activité + nouveaux documents est atomique localement ; les
  lectures de fichiers sont préparées avant la transaction. Sans nouveau fichier,
  seules les tables voyages/activités sont nécessaires.
- Plusieurs actions utilisent une version attendue ciblée : planification,
  transfert, participant, partage, tâche, fiche pratique. Les taux manuels utilisent
  une fusion à trois versions par paire ordonnée ; les paramètres du voyage
  contrôlent les champs de leur formulaire. Ces protections sont réutilisables.
- La modification générale d’activité ne fournit pas un CAS universel sur tous ses
  champs : une transaction sérialise deux écritures locales, sans nécessairement
  détecter deux formulaires anciens. Il faut donc aussi protéger les formulaires
  ouverts contre une réception distante, et pas seulement l’envoi au serveur.
- Les taux automatiques utilisent un jeton d’actualisation local et fusionnent les
  résultats après le réseau. Ce jeton/verrou ne doit pas devenir un verrou partagé
  entre appareils. Les dernières valeurs valides sont des données différentes des
  tentatives et diagnostics techniques.
- Les verrous React, les protections de rechargement PWA et la coordination des
  onglets pour les mises à jour ne constituent pas un protocole de synchronisation.

### Suppressions, relations et duplication

`updateTripTrash` conserve `archived` pendant la corbeille (`deletedAt`). La suppression
physique relit la valeur confirmée de deletedAt et supprime transactionnellement
voyage, activités, métadonnées et Blob associés. Aucun tombstone distribué ne reste.
`deleteActivity` supprime ses documents, ses transferts liés et les partages concernés
avec elle ; `deleteTransfer` enlève ses partages. La suppression d’un document enlève
métadonnée et Blob ensemble. Les participants référencés sont protégés.

La duplication dans App crée un nouveau voyage, sans copier ses activités/documents
ni ses transferts ; elle copie notamment le budget prévisionnel, la devise et les
taux manuels, les tâches et le carnet avec les règles existantes (nouveaux IDs,
coches de tâches remises à false), et les participants avec nouveaux IDs.
Une réception distante ne doit jamais appeler cette duplication.

Les anciennes coordonnées de contacts invalides sont lisibles, mais les nouvelles
écritures et les archives sont strictes : signaler les incompatibilités, sans effacer
ni « corriger » silencieusement les données. Une valeur absente ne signifie pas zéro,
ni suppression, ni valeur par défaut à matérialiser.

### ZIP et PWA

`src/backup/FORMAT.md`, `exportBackup.ts`, `validateRestore.ts`, `restoreBackup.ts` :
ZIP STORE format 1, manifeste, quatre JSON et fichiers binaires, IDs conservés,
CRC/SHA-256 et relations contrôlés. Export cohérent dans une transaction de lecture.
Restauration : validation intégrale, aperçu confirmé puis conflits relus dans une
transaction atomique ; un voyage d’ID existant est ignoré intégralement.
**Ce mécanisme n’est pas une fusion et ne doit pas devenir le transport de sync.**

Limites d’import actuelles : 512 Mio, 10 000 entrées, JSON 16 Mio, fichiers 15 Mio,
5 fichiers/activité. Une grosse base peut exporter une archive refusée par ces limites.
L’archive est non chiffrée et ne sauvegarde pas les ressources des URL d’images.

Point bloquant pour une future migration : `validateRestore.ts` exige exactement
`databaseVersion === 4`, et l’export écrit `database.verno`. Passer Dexie à V5 sans
adapter ce contrat casserait la restauration des nouvelles sauvegardes. Certaines
transactions de restauration utilisent `database.tables` : auditer leur périmètre
avant d’ajouter des tables techniques. Le SW ne précache que les ressources statiques ;
ni documents, ZIP, réponses d’authentification ni données de sync ne doivent y entrer.

## 2. Comparatif des solutions

Les descriptions fournisseurs ci-dessous viennent des documentations officielles ;
le classement et la recommandation sont notre appréciation pour Roam.

| Critère | Supabase | Firebase (Firestore + Storage) | Backend Laravel personnalisé |
| --- | --- | --- | --- |
| Authentification | Auth gérée, identité utilisateur utilisable dans les politiques SQL | Firebase Auth et identité utilisable dans Security Rules | Sanctum/session SPA ou jetons ; récupération de compte, e-mails et exploitation à organiser |
| Données | PostgreSQL : transactions, contraintes et fonctions adaptées au CAS et aux cascades | Documents : relations et intégrité à concevoir ; limite 1 Mio/document, incompatible avec un gros Trip embarqué unique | SQL au choix, contrôle complet du protocole et des transactions |
| Fichiers | Storage privé, règles RLS et transferts reprenables | Cloud Storage et règles propres aux objets | Stockage privé local/S3 compatible via Filesystem, URLs temporaires à encadrer |
| Offline pour Roam | Construire l’outbox et le rapprochement Dexie | Firestore possède un cache offline et une résolution last-write-wins ; conserver Dexie exigerait malgré tout un adaptateur, sans seconde base métier concurrente | Tout le protocole offline et la reprise à construire |
| Sécurité | RLS sur tables et objets, fonctions serveur à verrouiller | Security Rules + contrôle serveur pour invariants multi-documents/fichiers | Policies, validation, CSRF/CORS, quotas, signatures et isolation à développer et maintenir |
| Gratuit/payant | Free utile pour prototype limité ; Pro avec abonnement et dépassements possibles | Spark pour certains services ; fichiers impliquant Blaze/facturation, quotas variables | Framework sans coût de licence ; hébergement, SQL, objets, sauvegardes, mail et maintenance à budgéter |
| Complexité Roam | Intermédiaire ; bonnes primitives SQL mais pas de sync Dexie prête à l’emploi | Prise en main rapide, adaptation plus délicate des listes embarquées, conflits et relations | La plus forte charge initiale et opérationnelle ; pertinent si infrastructure/équipe Laravel déjà disponible |
| Portabilité | Modèle SQL exportable, adaptateur Storage/Auth à conserver | Modèle et règles spécifiques Firestore, coût de sortie supérieur | Forte maîtrise, au prix de l’exploitation |

Sources techniques : [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security),
[buckets privés](https://supabase.com/docs/guides/storage/buckets/fundamentals),
[uploads reprenables](https://supabase.com/docs/guides/storage/uploads/resumable-uploads),
[offline Firestore](https://firebase.google.com/docs/firestore/manage-data/enable-offline),
[limites Firestore](https://firebase.google.com/docs/firestore/quotas),
[règles Storage Firebase](https://firebase.google.com/docs/storage/security),
[Sanctum](https://laravel.com/docs/12.x/sanctum) et
[Filesystem Laravel](https://laravel.com/docs/12.x/filesystem).

### Coûts et limites à revérifier avant engagement

Consultation officielle le 06/11/2026, montants indicatifs USD hors taxes, sans
conversion EUR ni garantie contractuelle :

- Supabase Free affiche 500 Mo de base, 1 Go de fichiers, 5 Go de trafic sortant et
  5 Go de trafic sortant mis en cache, 2 projets actifs, pause après une semaine
  d’inactivité et limite d’upload de 50 Mo. Pro démarre à 25 USD/mois ; calcul,
  stockage, trafic et options peuvent augmenter le coût. Vérifier les conditions
  exactes du projet, les sauvegardes, le mail d’authentification et les protections
  de dépassement. Les 15 Mio Roam tiennent par fichier mais les documents cumulés
  peuvent vite épuiser le gratuit. [Tarifs officiels Supabase](https://supabase.com/pricing).
- Firebase distingue Spark et Blaze à l’usage. La documentation Storage indique
  l’obligation Blaze à compter du 3 février 2026 pour maintenir l’accès concerné :
  ne pas promettre un projet avec fichiers sans compte de facturation. Les quotas
  sans frais dépendent du service, du bucket et de la région. Vérifier opérations,
  téléchargements, stockage, Auth, éventuelles fonctions et alertes de facturation ;
  une alerte n’est pas un plafond garanti. [Tarifs Firebase](https://firebase.google.com/pricing),
  [conditions Storage](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024).
- Laravel n’est pas une offre d’hébergement ; aucun « forfait gratuit Laravel » ne
  couvre notre backend. Aucun hébergeur retenu : coût total, disponibilité, région,
  sauvegardes SQL/objets et maintenance restent à chiffrer sur ses offres officielles.

Ces limites, la résidence des données, les conditions/DPA et les frais de sortie
**doivent être revérifiés sur les offres officielles actuelles avant 2.10b et avant
production**. Aucun compte, SDK, backend ou abonnement créé dans cet audit.

## 3. Architecture recommandée (à approuver)

**Supabase Auth + PostgreSQL + bucket privé, derrière un adaptateur de synchronisation
Roam. Dexie reste l’unique base consultée par les écrans.** Le compromis privilégie
l’intégrité relationnelle et réduit l’exploitation serveur. Le gratuit convient à
une expérimentation surveillée, pas à une promesse de disponibilité pendant un voyage.
Firebase demeure viable mais son cache offline ne remplace pas nos règles de fusion ;
Laravel se justifierait surtout avec une infrastructure déjà entretenue.

### Contrat et unités de conflit

- Compte propriétaire, espace de données (`workspaceId`) et appareil (`deviceId`)
  sont des enveloppes techniques, pas des champs financiers. Clés serveur textuelles
  composites `(ownerId, workspaceId, entityType, entityId)` ; relations assorties du
  même propriétaire/espace. L’ID `london-2026` est donc acceptable mais ne prouve pas
  que deux voyages locaux sont identiques.
- Entités distantes : champs du voyage, activité, document, tâche, fiche pratique,
  participant, transfert, partage, paire de taux. Les collections embarquées restent
  telles quelles dans Dexie et le ZIP ; l’adaptateur les projette par ID côté serveur.
  Les suppressions d’un élément de liste deviennent des opérations explicites.
  Les photos restent leur chaîne d’origine, pas un téléchargement serveur implicite.
- Chaque unité porte une révision serveur croissante, un schéma de protocole et un
  état vivant/tombstone ; les dates métier sont conservées. Les dates d’appareil ne
  décident jamais qui gagne. Absence et retrait explicite restent distincts.
- Un envoi contient `operationId`, versions de base, groupe atomique, mutations et
  références. Le serveur authentifie, valide, vérifie le CAS et les relations puis
  écrit données + journal + accusé d’idempotence **dans une transaction SQL**.
  Retenter après timeout retourne le même résultat, sans doublon.
- Journal paginé par compte/espace, curseur opaque et ordre de commit garanti :
  sérialiser l’attribution du curseur dans la transaction par espace. Une simple
  séquence attribuée avant commit pourrait faire manquer une transaction tardive.
  Lecture paginée stable et reprise de snapshot définies dans le contrat.

### Cycle local et conflits

1. Une action locale écrit les données et l’outbox dans **la même transaction Dexie**.
   Toutes les voies doivent passer par cette frontière : paramètres, actions directes
   App, repositories, suppression en cascade, import ZIP et futures écritures.
2. Un seul expéditeur par compte/origine utilise un bail persistant court renouvelable,
   token de clôture et CAS ; BroadcastChannel ne sert qu’à réveiller les autres onglets.
   Le serveur reste sûr si deux expéditeurs passent ou si un onglet suspendu reprend.
3. Le réseau est hors transaction IndexedDB. Envoi borné, annulation, backoff avec
   jitter pour panne/429, respect de Retry-After ; 401 suspend les envois jusqu’à
   reconnexion. L’application reste utilisable localement.
4. Réception validée puis application + bases de fusion + curseur dans une transaction.
   Elle ne crée pas d’outbox en boucle. L’accusé d’une ancienne opération ne doit pas
   effacer une édition locale plus récente : distinguer génération envoyée et courante.
5. Fusion à trois versions (base/local/distant) par champs indépendants et éléments
   identifiés. Groupes liés indivisibles : horaires/date, paire GPS, paiement/devise/
   partage, références d’un transfert. Deux modifications du même groupe ou suppression
   contre modification produisent un conflit conservant les deux versions.
   Aucun last-write-wins silencieux et aucune moyenne de montants/taux.
6. Une réception n’écrase pas un formulaire ouvert : à l’enregistrement, comparer sa
   base aux champs actuels via les repositories, proposer résolution et garder la saisie.
   Les conflits sont visibles et persistés, jamais « synchronisés » tant que non résolus.

Les caches automatiques de taux valides peuvent converger par paire selon les dates
fournisseur/réception et les validations existantes. Les taux manuels restent prioritaires.
Les jetons d’actualisation, erreurs réseau, verrous et tentatives restent locaux.
Pas de conversion destructive, pas de synchronisation des positions de carte ou filtres
nécessaire pour cette première version.

### Suppression et fichiers

Corbeille et archivage sont des changements métier ordinaires. La suppression définitive
produit un tombstone technique distinct de deletedAt avec cascade serveur atomique des
références. Garder la version distante face à une édition concurrente pour résolution,
avec copie récupérable du conflit ; ne pas ressusciter automatiquement un parent supprimé.
Les octets sont nettoyés ensuite selon une politique explicite. Retenir les tombstones
tant qu’un appareil enregistré peut rejouer un ancien état ; expiration d’appareil et
réinscription avec snapshot complet obligatoires avant toute collecte. Durée à valider.

SQL et Storage ne partagent pas une transaction : utiliser un protocole en deux phases.
Préparer un objet privé immutable par propriétaire/document/version ; transfert borné
(reprenable pour les connexions mobiles), taille et SHA-256 vérifiés **côté serveur**,
puis publication des métadonnées « prêt » avec les relations dans la transaction SQL.
Une référence en attente n’est pas un document disponible. Les objets temporaires
orphelins sont nettoyables après délai, jamais un fichier publié encore référencé.
Le serveur applique la limite de 5 sous verrou/concurrence, après prise en compte des
fichiers déjà publiés et réservations actives.

Sur le récepteur, téléchargement vérifié avant transaction métadonnée+Blob locale ;
ne pas créer de faux document complet sans Blob. Un état technique « fichier en attente »
est présenté séparément et rend l’export ZIP complet indisponible avec explication,
plutôt que produire une archive silencieusement incomplète. Si hors ligne avant premier
téléchargement, signaler « pas encore disponible sur cet appareil ». Une fois téléchargés,
les documents restent locaux ; aucune éviction automatique initialement.

## 4. Migration, amorçage et compatibilité

Aucune migration n’est exécutée en 2.10a. Proposition future : **Dexie V5 additive**,
à valider en 2.10b, pour `syncOutbox`, `syncState` (versions/bases), `syncConflicts`,
`syncCursors`, appareils/baux et état des transferts. Les tables métier et leurs IDs
restent conservés. Une variable mémoire ou localStorage ne peut garantir l’atomicité
activité+outbox ; éviter une base technique séparée, non transactionnelle avec la base métier.

- Migration structurelle seule, sans réseau et sans envoi implicite ; activation opt-in.
  État initial et empreintes construits par lots reprenables après ouverture.
- Premier appareil : aperçu des voyages sélectionnés puis publication confirmée.
  Second appareil déjà rempli : audit ID/contenu avant rattachement. ID égal + contenu
  divergent = conflit d’adoption explicite, notamment Londres et ZIP déjà importé.
  Ne fusionner ni par destination, ni par date, ni par seule égalité d’ID.
- Même propriétaire/espace avec filiation connue : rapprocher par identifiants et révisions.
  Origines indépendantes : choisir explicitement copie locale, distante ou import séparé.
  Tout remappage volontaire doit couvrir toutes les références et être sauvegardé/testé.
- Anciennes données invalides restent locales lisibles. Rapport des éléments non
  synchronisables et correction ciblée demandée ; aucun abandon silencieux des champs
  inconnus ou incompatibles. Version de protocole négociée avant toute application.
- ZIP format 1 peut rester un **format métier** : anciens ZIP V4 toujours acceptés,
  nouvelles archives V5 acceptées par une liste de schémas métier compatibles testée.
  Le manifeste doit annoncer honnêtement la version de base ; ne pas maquiller V5 en V4.
  Les anciens lecteurs exigeant V4 refuseront les nouveaux ZIP V5 : compatibilité
  ascendante du nouveau lecteur, pas rétrocompatibilité universelle.
- Exclure auth, jetons, propriétaire de session, outbox, baux, bases de fusion et curseurs
  de tout ZIP ; conserver seulement les métadonnées métier autorisées. Ne pas exporter
  les tables techniques via un parcours générique. L’import d’un ZIP crée des mutations
  nouvelles au sein de sa transaction, pas des accusés ou versions distants réutilisés.
  Respecter la politique actuelle : voyage existant ignoré ; suppression distante
  connue présentée comme conflit, jamais résurrection implicite via ancien ZIP.

## 5. Sécurité, risques et réponses

| Risque | Mesure proposée et test exigé |
| --- | --- |
| Doublons après retry, même Londres sur deux appareils | ID d’opération idempotent et adoption explicite ; simuler réponse perdue après commit. |
| Horloges fausses / éditions simultanées | Révisions serveur, fusion trois versions, groupes atomiques ; décaler l’horloge d’un jour dans les tests. |
| Suppression contre modification hors ligne | Tombstones et conflit conservé ; appareil ancien ne recrée pas la donnée. |
| Interruption SQL/Storage | Objets temporaires, publication après intégrité, reprise ; couper à chaque frontière. |
| Fichiers et mobile | 15 Mio, transferts progressifs, concurrence faible, quota avant/après écriture ; tester quota local et serveur, mémoire et 5e/6e fichier simultanés. |
| Fuite intercomptes | RLS owner et relations, bucket privé, chemins opaques, tests deux comptes et IDs devinés ; jamais de clé service_role dans Vite. |
| Session expirée/changement de compte | File suspendue et cloisonnée par compte ; confirmation avant rattachement, aucune soumission de la file A avec le compte B. Ne pas effacer les données sans export/choix. |
| Réception sur formulaire ancien | Baselines/CAS au repository, saisie conservée, test deux onglets et deux appareils. |
| Ancien SW / protocole incompatible | Refuser l’application réseau incompatible, mode local conservé ; activation PWA volontaire et migrations avec onglets anciens fermés. |
| Quota, pause ou panne fournisseur | Erreurs visibles, reprise avec temporisation, aucun blocage des écritures locales, ZIP indépendant. |
| Origin HTTP LAN / changement de domaine | Sync authentifiée en HTTPS, origine stable ; migration explicite des données de l’ancienne origine via ZIP, sans reset. |
| Données sensibles | Transport TLS, accès privé, logs expurgés ; pas de données personnelles dans SW/analytics, URLs signées courtes. Pas de chiffrement de bout en bout promis. |

Auth recommandée initialement : e-mail avec récupération et vérification, choix mot
de passe/lien à valider selon les usages et limites mail. Première connexion réseau
nécessaire, utilisation locale possible ensuite même session expirée. Une révocation
serveur ne peut pas retirer magiquement les copies déjà présentes sur un appareil offline.
Un futur changement de compte exige une séparation de ses données locales, pas un simple
changement de JWT. Définir suppression de compte, export, région UE et rétention avant
mise en production. Synchroniser n’est pas sauvegarder : une suppression se réplique,
il faut maintenir ZIP et une stratégie distincte de restauration SQL **et** objets.

## 6. Découpage proposé 2.10b–2.10f

| Étape | Livrable et migrations | Critères de sortie / retour arrière |
| --- | --- | --- |
| 2.10b — contrat et infrastructure locale | Valider les décisions ; interfaces SyncTransport, révisions/opérations/conflits, faux serveur en mémoire ; V5 additive opt-in et compatibilité ZIP V4/V5 format 1 ; transaction outbox pour toutes les écritures | Tests migration V1–V4 pleine/vide, quota/abort, import/cascades, baselines de formulaires. Sync désactivée par défaut ; aucune connexion réelle. Désactivation sans suppression des stores. |
| 2.10c — identité et backend pilote | Après accord explicite, environnement de test Supabase, Auth, RLS, schéma SQL et RPC CAS/journal/idempotence ; bucket encore inutilisé | Deux comptes isolés, sessions expirées, contrôle côté serveur, abus/quotas, reprise après perte d’accusé. Feature flag et arrêt des envois, mode local intact. |
| 2.10d — synchronisation structurée | Adoption confirmée, pull/push paginés, résolution de conflits, tombstones/cascades et toutes les données embarquées ; aucun Blob prétendument complet | Deux bases isolées, offline simultané, ordre inversé, pagination avec commit tardif, suppression contre édition, plusieurs onglets, gros Trip, rollback et protocole ancien. Pas d’activation générale avant gestion des fichiers en 2.10e. |
| 2.10e — pièces jointes | Upload/reprise, checksum serveur, publication contrôlée, download local atomique, documents en attente et export bloqué explicitement si incomplet | Quatre formats, octets identiques, 15 Mio, manque d’espace, coupures, suppression pendant upload, limites concurrentes, auth/URLs expirées et absence de fuite entre activités/comptes. |
| 2.10f — intégration et durcissement | État de sync discret, conflit résoluble au mobile, sauvegardes, compatibilité PWA, budgets/coûts, docs et procédure d’exploitation | Parcours ordinateur/téléphone HTTPS réels, 320/375 px, veille navigateur, multi-onglets, panne fournisseur, restauration ZIP, aucun changement de calcul financier ; pilote puis activation volontaire. |

Dans chaque étape : lint/build, tests PWA et suite navigateur existante, tests réseau
simulés déterministes et bases isolées ; tests RLS/RPC et Storage sur environnement de
test uniquement après autorisation. Ne jamais utiliser les vrais voyages pour tester
suppression, reset, conflit irréversible ou quota.

### Retour arrière

Avant activation : ZIP vérifié, inventaire des données et version applicative connue.
Feature flag arrête les nouveaux appels, annule les requêtes sans supprimer outbox ni
conflits ; au redémarrage relire les accusés (un appel annulé peut avoir été committé).
Les opérations locales continuent d’être journalisées pour une reprise future.
Pas de rétrogradation Dexie : un binaire strictement V4 peut refuser une base V5.
Le retour sûr est une version corrective connaissant V5 mais sans réseau, déployée
avec l’activation PWA volontaire. Le retour de données se fait après aperçu/conflits,
jamais par restauration destructive ni écrasement cloud. Suspendre aussi les traitements
serveur et la collecte des fichiers si nécessaire ; conserver les sauvegardes séparées.

## 7. Décisions à trancher avant 2.10b

1. Supabase retenu ? Quel budget maximal et compte de facturation acceptable, notamment
   si le gratuit est suspendu ou saturé pendant un séjour ? Région et exigences de confidentialité ?
2. Compte unique personnel, méthode de connexion, récupération et usage sur appareil partagé ?
   Le chiffrement de bout en bout est-il une exigence (changerait la validation serveur) ?
3. Tous les voyages ou sélection opt-in, archives/corbeille incluses ? Adoption du Londres
   identique en ID et des voyages déjà transférés par ZIP : quelle décision proposée à l’utilisateur ?
4. Fusion automatique des seuls champs indépendants et résolution explicite sinon acceptées ?
   Autoriser une copie de secours locale des versions en conflit, pour combien de temps ?
5. Conservation des tombstones, expiration des appareils et suppression distante définitive :
   délai et confirmation ; stratégie de sauvegarde/restauration séparée et suppression de compte ?
6. Pièces jointes téléchargées automatiquement pour les voyages sélectionnés ou à la demande ?
   Plafond de stockage/traffic, mobile en données limitées et état d’export incomplet ?
7. Accord sur Dexie V5 additive et sur le fait qu’un ancien lecteur V4 ne pourra pas lire
   les nouveaux ZIP V5, tout en maintenant format 1 et lecture des anciennes archives ?
8. Origine HTTPS stable, liste des navigateurs cibles, procédure pour transférer la base
   actuelle HTTP LAN/localhost sans perdre de données ?

## Contrôles réalisés pour cet audit

Lecture du code et du contrat ZIP, vérification de la branche, consultation des sources
fournisseurs officielles. Seul ce document est ajouté. Aucune installation, migration,
connexion à un compte, exécution de sync, modification fonctionnelle, commit ou push.
`git diff --check -- roam-v2/` doit rester propre ; lint/build ne sont pas nécessaires
pour un ajout Markdown seul. Les tests proposés ci-dessus ne sont pas présentés comme exécutés.
