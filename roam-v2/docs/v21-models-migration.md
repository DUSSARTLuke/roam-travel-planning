# Roam V2.1a — contrats et préparation de migration

> État historique V2.1a. La réalisation V2.1b et les adaptations de compatibilité sont décrites dans [v21-v6-zip2.md](v21-v6-zip2.md).

Décisions du 10 novembre 2026. **Aucune V6 enregistrée, aucun nouveau format ZIP lu/écrit par l’application.** La base reste V5 et l’export reste au format 1. Les modules `src/evolution/v21/` ne sont importés par aucun écran/repository de production. Leur simulateur ne contient aucun accès Dexie, réseau, horloge ou génération d’ID.

## Contrats

- `Journey` : identité, voyage, titre, au moins deux étapes (maximum préparatoire 100), un segment par paire d’étapes consécutives. Mode par segment, durée facultative ; aucun coût par segment. Estimation et paiement globaux distincts, devise facultative pour préserver les données historiques.
- Chaque étape conserve un `Place` lisible (nom, adresse et paire GPS facultative). Sa référence éventuelle vers une activité/hébergement n’est pas son seul lieu : le snapshot est indispensable si la cible disparaît.
- `Accommodation` : identité, voyage, lieu, période arrivée/départ inclusive pour les événements, horaires facultatifs, réservation, coûts et notes. Nuitées : intervalle [arrivée, départ[ ; arrivée égale au départ autorisée pour un usage de journée, sans nuit inventée.
- `Reservation` reprend les statuts existants : `not_required`, `to_book`, `pending`, `confirmed`, `cancelled`. Aucun statut par défaut, aucun paiement déduit d’une réservation.
- `OwnedDocument` : ID, tripId, propriétaire typé activity/journey/accommodation, métadonnées existantes. Même ID de Blob et mêmes octets ; aucune copie de fichier pour afficher une autre vue.
- Une devise absente reste absente, zéro reste zéro. Montants finis et non négatifs, devises normalisées ; durée finie et non négative. GPS validés avec le validateur actuel (ensemble, bornes, zéro accepté).
- Dates locales YYYY-MM-DD, heures HH:mm. Fuseau IANA facultatif prévu par `LocalMoment`. Aucune soustraction de deux heures appartenant à des fuseaux différents sans contrat explicite ; durée de segment toujours saisie, jamais inférée.
- Une date propre au trajet le rend indépendant du réordonnancement des activités. Si les données liées évoluent : avertissement et actualisation explicite, jamais réécriture silencieuse du snapshot.

Les assertions du module contrôlent les invariants typés essentiels. Elles ne remplacent pas un validateur complet d’objets `unknown`, les limites ZIP ni les vérifications transactionnelles de références qui seront implémentés en V2.1b. À l’écriture, exiger le voyage parent actif, des cibles du même voyage, une révision attendue et des identifiants stables uniques. Les références répétées consécutives vers une même cible doivent être refusées par ce futur repository ; revenir à un lieu plus tard dans le trajet reste autorisé.

## Suppressions et concurrence

| Action | Règle future |
| --- | --- |
| Supprimer une activité/hébergement lié | Garder tous les trajets, coûts, étapes et snapshots ; marquer le lien `deleted`, afficher « lieu lié supprimé ». Ne pas supprimer le trajet ou son partage financier. |
| Modifier un lieu lié | Comparer à son snapshot ; proposer une actualisation explicite. |
| Supprimer un trajet | Confirmation ; supprimer uniquement ses documents/Blob et partages, journaliser les tombstones. |
| Supprimer un hébergement | Confirmation ; détacher les liens entrants puis supprimer ses documents/Blob et partages ; opérations atomiques. |
| Archiver/mettre un voyage à la corbeille | Conserver tous ses enfants ; mêmes restrictions de modification qu’actuellement. |
| Supprimer définitivement un voyage | Recontrôler sa corbeille, supprimer tous ses enfants/documents/Blob dans la même transaction et journaliser toutes les suppressions. |

`detachJourneyPlace` est une transformation pure de proposition. Elle préserve le dernier lieu enregistré ; le repository futur pourra capturer une version plus récente de la cible, uniquement dans la transaction de suppression. La fonction ne vérifie pas à elle seule le voyage parent ni les révisions. La suppression actuelle V5 n’est pas changée à cette étape : elle continue sa cascade historique sur les anciens transferts.

Tous les formulaires futurs devront capturer les révisions à l’ouverture et les vérifier atomiquement, avec refus sans écriture partielle/journal en cas de conflit. Plusieurs suppressions/détachements forment un seul groupe d’opérations. Ne jamais rendre muet un conflit en fusionnant automatiquement.

## Proposition Dexie V6 (non appliquée)

Ajouter `journeys: id, tripId, [tripId+departure.date]` et `accommodations: id, tripId, [tripId+arrivalDate], [tripId+departureDate]`. Dates manquantes : lectures par tripId. Ces index devront être vérifiés sur IndexedDB réel avant validation définitive.

Conserver `activityDocuments` et `activityDocumentBlobs` comme noms physiques pour éviter un déplacement des Blob. Généraliser la table de métadonnées (nom logique `OwnedDocument`) avec `tripId`, `[tripId+owner.kind+owner.id]` et `[owner.kind+owner.id]`. Garder l’ancien index `activityId` pendant la transition si des chemins de migration en ont besoin ; ne pas l’utiliser après conversion.

Migration dans la transaction exclusive d’upgrade :

1. Vérifier les parents, identifiants, limites et bijection documents/Blob à partir des clés, sans charger les Blob. Si une anomalie bloque : annuler toute la migration, conserver V5, fournir un diagnostic. Ne supprimer aucun orphelin automatiquement.
2. Transformer chaque `manualTransfer` en un Journey : ID déterministe `legacy-transfer:<tripId encodé>:<transferId encodé>`, provenance originale conservée dans `legacy`. Même ID de transfert dans deux voyages : aucune collision. Rejeter les doublons au sein d’un voyage.
3. Construire deux snapshots à partir des activités existantes. Date de départ = date de l’activité source ; heure de départ uniquement si sa fin explicite existe. Date/heure d’arrivée = date/début explicite de la cible. Dates différentes, non datées ou ordre devenu incohérent : conserver les informations sans les corriger ; avertissements à calculer par la future présentation.
4. Reprendre mode, durée, estimation, paiement, devise, notes et timestamps sans conversion. Convertir les références de partage `transfer` vers `journey` au moyen de la table de correspondance, sans toucher aux participants, parts ou montants.
5. Convertir les métadonnées documentaires de `activityId` vers `owner`, conserver ID/nom/MIME/taille/date, vérifier tripId par la cible. **Ne pas lire, dupliquer ni réencoder les Blob.**
6. Supprimer `Trip.manualTransfers` seulement après création et validation de toutes les lignes correspondantes. Une seule source de vérité après commit. Ne pas créer automatiquement d’hébergement à partir d’une activité marquée réservation d’hébergement.

`planV6` simule ces transformations sur un clone en mémoire. Il retourne un payload, les clés de Blob inchangées et la correspondance des IDs. Même entrée → même résultat. Il ne s’applique pas à une base déjà V6 et ne doit jamais être utilisé comme restauration d’objets déjà migrés.

### Journal V5 : point de vigilance bloquant avant V6

Étendre `trackedTables`, `SyncTable`, la résolution des parents, les contraintes de transactions, le seed des sidecars, les cascades et la filiation ZIP. Les documents existants gardent leurs identités de synchronisation ; les nouvelles entités Journey obtiennent une identité propre, distincte de celle du Trip. Les révisions des entités inchangées ne doivent pas être réinitialisées.

Les opérations pending V5 de Trip peuvent contenir un ancien tableau `manualTransfers`. **Ne jamais les rejouer telles quelles après V6.** Comme aucun serveur distant n’a encore été connecté, préparer une conversion transactionnelle vers un nouveau baseline de synchronisation : conserver les reçus/révisions historiques, rendre les anciens payloads structurellement obsolètes non rejouables, puis émettre les opérations correspondant aux entités V6. Même traitement pour les payloads documentaires anciens. L’algorithme détaillé, sa version de protocole et ses tests de double rejeu sont une condition préalable à V2.1b ; le simulateur de cette étape ne prétend pas le réaliser.

## ZIP 1 → ZIP 2

La fonction `planZip1To2` est un adaptateur **sémantique après validation**. Ce n’est ni un parseur ZIP, ni un contrôle des octets, ni un importeur. L’ancien lecteur doit d’abord vérifier CRC, SHA-256, tailles, MIME, chemins, relations et limites comme actuellement.

| Source | Comportement prévu du futur lecteur |
| --- | --- |
| ZIP1 / Dexie4 | Accepter ; convertir transferts/documents, créer la filiation locale selon les règles d’import, sans inventer une filiation absente. |
| ZIP1 / Dexie5 | Accepter ; même conversion, préserver/adopter la filiation valide et convertir les références techniques. |
| ZIP2 / Dexie6 | Valider directement les nouvelles collections et propriétaires. |
| Version inconnue/incohérente | Refuser avant toute écriture. |
| Voyage déjà présent | Garder la politique non destructive : ignorer son sous-graphe entier, aucune fusion automatique. |

ZIP2 ajoutera `data/journeys.json` et `data/accommodations.json`, adaptera documents, compteurs, inventaire, schemaVersion et filiation. Même stockage des fichiers binaires, sans chiffrement implicite. Export : snapshot atomique ; import : validation complète puis réévaluation des conflits et transaction unique. Un ancien lecteur ZIP1 doit refuser ZIP2 explicitement, jamais ignorer les nouvelles collections.

Tests à réaliser en V2.1b : ZIP1 réel V4/V5→lecture→migration→ZIP2→restauration en base vide ; égalité des données, relations et SHA des fichiers ; erreurs/corruption/conflits/rollback. L’adaptateur V2.1a ne suffit pas à certifier cet aller-retour.

## Budget et duplication

Coût global de Journey, coût total du séjour de Accommodation. Identifiants budgétaires typés `activity:`, `journey:`, `accommodation:`. Une ligne par entité, sans ajouter les anciens transferts en plus des Journeys migrés. Réservation, calendrier et carte ne créent aucune autre dépense.

Pas de ventilation journalière automatique du prix d’un hébergement ; conserver une section « séjour, non ventilé ». Paiements et estimations indépendants, conversions réutilisées sans mutation. Les partages devront accepter les nouveaux types d’entités dans leurs futurs validateurs.

Régression reproduite avant correction : transfert payé 7 EUR → total payé `null`. Correction locale de l’adaptateur `tripBudget.ts` : transmettre `paidAmount` à la même entrée financière que `estimatedCost`, sans toucher aux données ni aux écrans. Tests zéro/absent/taux manquant/conversion/doublons ajoutés.

Duplication des voyages **inchangée** : l’implémentation actuelle ne clone pas les activités, transferts ou documents ; elle ne devra pas cloner automatiquement les nouveaux enfants en V2.1.

## Retour arrière et risques

Avant la vraie migration : ZIP1 indépendant et version V5 conservée. Un ancien binaire V5 ne peut pas ouvrir une base V6 : ne pas tenter de rétrograder le numéro, ne jamais supprimer la base. Un échec d’upgrade doit laisser la base V5 intacte. Après upgrade réussi, un retour logiciel nécessitera une stratégie explicitement validée (base séparée/restauration), sans écraser la base V6.

Autres risques : onglet V5 encore ouvert bloquant l’upgrade, caches servant un ancien binaire, limite de quota, voyage volumineux, liens historiques invalides, disparition d’un parent pendant une édition et anciens payloads de journal. Tests réels multi-onglets et hors connexion obligatoires avant activation de V6. Aucune modification de la V2 publiée à cette étape.

## Vérifications V2.1a

`npm run test:v21` (Node 24 avec hooks de chargement TypeScript, aucune dépendance ajoutée) : budget payé, contrats, snapshots GPS, suppression liée sans perte du trajet, dates de nuit, valeurs absentes/zéro, devise et taux, mapping des partages, isolation, doublons/orphelins, métadonnées/IDs binaires, déterminisme/immutabilité, ZIP1 V4/V5 sémantique, simulation 1000 trajets.

Il s’agit de simulations pures : **aucune migration réelle V6 ni restauration ZIP2 exécutée**. Ces tests ne touchent aucune base personnelle. Les tests navigateur V5 existants, le build, le lint et les tests PWA/hors connexion sont exécutés séparément pour vérifier la non-régression.

### Résultats exécutés le 10 novembre 2026

- Régression `paidAmount` reproduite avant correction : attendu 7, reçu null ; corrigée et relancée avec succès.
- Suite navigateur initiale : échec sur une assertion historique qui attendait volontairement l’exclusion du paiement des transferts. Assertion remplacée par le total exact 40+10=50, avec contrôle du partage séparé maintenu ; suite complète relancée et réussie.
- `test:v21`, contrôle TypeScript des tests et build TypeScript/Vite : réussis.
- Lint : 0 erreur, 7 avertissements préexistants. Build : avertissement de taille des chunks existant.
- Tests PWA, production hors réseau (avec documents et réouverture) et concurrence dans deux onglets réels : réussis.
- Suite navigateur complète : réussie, incluant migrations V4→V5, ZIP, documents, budget, carte et assertions responsive existantes. Profils/bases temporaires uniquement.
- `git diff --check -- roam-v2/` : réussi.

Aucune migration V6 réelle, import/export ZIP2 ou nouvelle interface n’a été testé : ils ne sont volontairement pas activés. Avant V2.1b, fixer également la longueur maximale des IDs migrés (l’encodage des anciens IDs très longs peut dépasser la limite ZIP actuelle de 512 caractères) et les budgets de taille du journal. Ne pas tronquer les IDs ; prévoir une correspondance bornée et vérifier les collisions.
