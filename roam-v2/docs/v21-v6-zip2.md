# V2.1b — persistance V6 et sauvegardes ZIP2

Travail local sur develop-v2, 10 novembre 2026. Aucun écran, déploiement, branche Pages ou master modifié. Les tests utilisent des noms de base temporaires et des profils Chrome temporaires.

## Schéma et migration

Dexie V6 ajoute `journeys` (id, tripId, [tripId+departure.date]) et `accommodations` (id, tripId, dates d’arrivée/départ). Les tables de documents/Blob conservent leurs noms et clés ; les métadonnées gagnent tripId, owner et l’index [owner.kind+owner.id]. Le champ activityId reste une projection de compatibilité pour les documents d’activité uniquement.

`migrateV6` s’exécute dans la transaction exclusive d’upgrade. Le plan V2.1a est validé avant toute conversion : parents, doublons et bijection des clés de documents/Blob. Un orphelin provoque le refus et le rollback, jamais son effacement automatique. Les activités, réservations d’activité, budgets, préparatifs, contacts et métadonnées existants ne sont pas réécrits.

Chaque ancien transfert devient une Journey avec deux snapshots de lieu et un segment. Coûts, paiement, devise, durée et notes sont conservés. Les IDs originaux restent exactement dans `legacy: {kind:'manualTransfer',tripId,id}` ; le nouvel ID canonique est un UUID borné, y compris quand l’ancien ID contient 512 caractères Unicode. Les références financières historiques `transfer:<ancien ID>` restent des alias vérifiés vers cette provenance. Elles ne sont pas transformées en nouvelles dépenses ni cumulées une seconde fois.

L’heure de départ est la fin explicitement enregistrée de l’activité source, jamais son début ou une durée supposée. L’arrivée utilise le début précis de la cible s’il existe. Dates absentes/différentes et horaires incomplets ne sont pas corrigés automatiquement. Les réservations appartiennent toujours à leur entité d’origine ; aucune copie de réservation d’activité dans le trajet.

Aucun Blob n’est lu via arrayBuffer, réencodé ou réinséré dans la table de fichiers pendant la migration. Les opérations de journal peuvent référencer le Blob existant comme dans V5 ; cela ne constitue pas une promesse de déduplication physique par le navigateur. Un manque de quota annule l’upgrade transactionnelle.

## Pont temporaire pour les écrans V2

Garantie renforcée : voir [adaptateur canonique et tests de non-résurrection](legacy-transfer-bridge.md).

Le plan V2.1a prévoyait de retirer `Trip.manualTransfers`. Cette suppression immédiate est différée pour respecter l’exigence de ne pas modifier les écrans : le tableau est conservé comme projection des anciens transferts. Les entités canoniques sont dans journeys ; les commandes historiques sont traduites explicitement par le repository dans la même transaction. Le middleware refuse les tableaux incohérents et ne traduit jamais une projection en commande Journey. Les modifications du repository V6 mettent à jour la projection lorsqu’elle reste représentable avec deux activités liées.

Cette projection est exclue des payloads Trip du journal courant et des ZIP2. Un export vérifie les références de sa projection mais n’ajoute pas une deuxième série de déplacements. La restauration reconstruit la projection à partir des Journeys importées. Les lieux et dates autonomes ne sont pas réinterprétés lorsque la projection est mise à jour.

Conséquence assumée de l’étape sans interface : les trajets natifs, hébergements et trajets détachés restent consultables par les repositories mais ne disposent pas encore d’écrans de gestion. Le Budget/Programme/Carte actuels continuent d’utiliser la projection historique. `v6FinancialTotals` prépare la synthèse canonique sans compter également les anciens transferts. Leur intégration visuelle viendra ensuite. Le texte historique de confirmation de suppression d’une activité sera à adapter dans cette étape d’interface : la règle V6 conserve désormais le trajet avec son dernier lieu connu.

La duplication des voyages reste inchangée et ne clone pas automatiquement ces nouveaux enfants.

## Journal, révisions et suppression

Les deux nouvelles tables sont suivies par le même middleware DBCore. Chaque transaction métier et ses révisions/opérations est atomique. Les mises à jour/suppressions des nouveaux repositories exigent l’identité et la révision capturées lors de `read`. Un conflit, une suppression concurrente ou un ID déjà utilisé refuse l’écriture sans journal supplémentaire.

L’upgrade conserve les opérations historiques V5 et leurs payloads, avec status superseded : elles ne sont plus rejouables. Les identités existantes sont préservées, leurs révisions ne sont jamais remises à zéro. Un baseline courant est réémis au protocole 2 pour chaque entité, y compris les tombstones. `isReplayableOperation` exige pending ET protocolVersion 2. Les anciens reçus de commandes et conflits restent conservés ; un ancien appel avec révision V5 est obsolète après rebaseline. Aucun serveur distant n’est connecté.

Supprimer une activité/hébergement détache les étapes entrantes (`link.state='deleted'`) sans supprimer la Journey, son dernier snapshot, ses coûts ou sa référence financière. Supprimer une Journey retire ses documents et ses alias financiers. Une suppression définitive du voyage recontrôle la corbeille et supprime ses entités, documents et Blob dans une transaction unique. Les tombstones et groupes sont conservés ; les payloads historiques des entités supprimées sont expurgés comme en V5.

## Repositories

`createV21Repository(database)` : listes, lecture avec révision, création/modification et suppression de journeys/accommodations. Toutes les références liées sont vérifiées dans le même voyage. Un lien déclaré supprimé ne peut pas être inventé à la création. Les champs de provenance d’un trajet migré sont immuables à la modification.

Documents : import multiple tout-ou-rien, 5 par propriétaire, 15 Mio par fichier, signatures et formats existants. Métadonnées seules pour les listes, Blob à la demande. `saveWithDocuments` prépare les fichiers avant la transaction puis enregistre entité, métadonnées, Blob et journal atomiquement. Lecture/suppression contrôlent tripId et owner ; la suppression documentaire exige une empreinte attendue des métadonnées.

## ZIP2

L’export des bases V6 produit `formatVersion:2`, `databaseVersion:6`. Les JSON `data/journeys.json` et `data/accommodations.json` s’ajoutent aux quatre collections existantes. Les documents portent tripId et owner ; activityId peut être conservé pour un propriétaire activité, jamais pour les autres types. Compteurs, inventaire SHA-256 et filiation couvrent toutes les collections. Les fichiers binaires gardent leur format et nom d’origine en métadonnées.

Le lecteur accepte ZIP1/Dexie4, ZIP1/Dexie5 et ZIP2/Dexie6 uniquement. ZIP1 est d’abord intégralement vérifié selon le contrat historique, puis converti en mémoire ; les anciens IDs sont conservés en provenance et les documents changent de propriétaire sans transformation binaire. Une ancienne filiation V5 est conservée ; les nouvelles identités sont créées localement pour les nouvelles entités. ZIP2 exige la filiation de toutes les entités canoniques.

Contrôles : ZIP STORE/CRC, chemins autorisés, tailles/limites, inventaire exhaustif, SHA-256, types, formats, signatures, paires GPS, parents, provenance unique, références inter-voyages et quotas documentaires. Aucun fichier n’est exécuté. Une archive contenant des collections V6 sous l’étiquette ZIP1 est refusée.

Import : collections validées privées, aperçu sans écriture, conflits recalculés dans la transaction finale, uniquement add/bulkAdd pour les entités importées. Voyage déjà présent : sous-graphe entier ignoré, aucune fusion. Collision de clé ou de sidecar/tombstone : refus global. Les créations de la projection de compatibilité concernent uniquement les voyages ajoutés par cette transaction.

## Incompatibilités explicites

- Un binaire V2/Dexie V5 ne peut pas ouvrir une base passée en V6 : VersionError attendu, aucun downgrade automatique.
- Un lecteur V2 ZIP1 ne sait pas restaurer ZIP2 ; il doit le refuser. Conserver un ZIP1 antérieur indépendant avant tout essai de V6 sur de vraies données.
- Le rollback d’upgrade est automatique si la transaction échoue. Après une upgrade réussie, revenir à V5 impose une procédure séparée et validée, sur une autre base/origine ; ne jamais supprimer la base V6 pour contourner le problème.
- Un onglet V5 encore ouvert peut bloquer l’upgrade ; fermer les anciens clients. Ne pas publier ce travail pendant cette étape et ne pas activer un ancien worker pour forcer un retour arrière.

## Tests

La suite navigateur inclut les nouvelles vérifications `v21-persistence.browser.ts`, plus les régressions historiques. `tests/browser-suite.mjs` lance un serveur local sans HMR et un Chrome temporaire ; aucune base utilisateur n’est ouverte. Les exécutions responsive du runner utilisent les mêmes bases isolées.

Les résultats finaux et les anomalies corrigées sont consignés à la fin de ce document après les relances.


### Précisions de validation

Les anciennes écritures directes de métadonnées d’activité sont enrichies par le middleware dans leur transaction, afin que les mêmes données V6 ne dépendent pas du chemin d’écriture. L’export reste sans écriture. Le type historique ActivityDocument est conservé comme façade pour les écrans V2 ; les documents des nouveaux propriétaires sont manipulés exclusivement via le repository V6 et le contrat OwnedDocument.

La conservation des anciens IDs est assurée par legacy et par les alias financiers, pas par la réutilisation globale de la clé brute d’un transfert imbriqué : deux voyages pouvaient avoir le même ancien ID. Le mapping vers les UUID canoniques est enregistré dans les lignes migrées et ne se répète pas à la réouverture.

## Rapport final des vérifications — 10 novembre 2026

| Vérification exécutée | Résultat final |
| --- | --- |
| Build TypeScript/Vite V6 | Réussi ; avertissement existant de taille des chunks |
| Lint | Réussi, 0 erreur et 7 warnings préexistants |
| Contrats/simulations `test:v21` | Réussi ; Node signale le caractère expérimental du chargement TypeScript |
| Suite navigateur complète desktop | Réussie |
| Suite navigateur complète émulation 320 px | Réussie après le correctif final |
| Suite navigateur complète émulation 375 px | Réussie après le correctif final |
| Deux onglets Chrome réels | Réussi : conflits activités et hébergement V6, une seule écriture, aucun journal parasite |
| Hébergement V6 dans deux onglets, réseau CDP coupé | Réussi |
| Tests PWA du build final | Réussis : intégrité, exclusions, activation volontaire et vote multi-onglets |
| Production hors réseau, fermeture/réouverture, activité et PNG | Réussi : création, modification, document consultable, suppression persistée |
| `git diff --check -- roam-v2/` | Réussi |

Les tests V6 réels comprennent : base V5 vide sans exemple ajouté, upgrade refusée conservant V5 sur orphelin, migration de 300 activités, PDF de 1 Mio intact, 300 activités/31 PDF/45 Mio avec un document de 15 Mio dans la régression de volume, opérations historiques conservées non rejouables, tombstone V5 réémis, identité existante conservée et réouverture sans nouvelle migration. ZIP1 et ZIP2 : conservation des données et SHA-256, aperçu/conflits, corruption, import interrompu et rollback intégral. Les écritures entité+document sont annulées entièrement sur erreur simulée de Blob, sans opération ajoutée au journal. Les budgets vérifient estimation/paiement distincts et absence de double comptage canonique.

### Échecs rencontrés et corrections vérifiées

- Les assertions de version et de baseline V5 ont été adaptées à V6 et à la conservation des reçus historiques ; contrôles du contenu et des révisions maintenus.
- Une référence financière à un trajet conservé après suppression d’activité faisait échouer le pont historique ; elle est maintenant préservée et validée par son alias canonique.
- Le pont reconstruisait un segment avec un autre nom d’étape que celui migré ; il utilise désormais les identifiants d’étapes réellement conservés.
- Le passage d’un trajet migré de deux à trois étapes pouvait être pris pour une suppression par la projection ; le trajet canonique reste conservé, avec test dédié.
- La restauration ajoutait un tableau vide inutile aux voyages sans transfert ; elle ne le fait plus.
- Les écritures directes compatibles de documents n’étaient pas toutes enrichies en owner/tripId ; l’enrichissement est transactionnel et l’aller-retour des métadonnées passe.
- Le runner pouvait cliquer avant la fin des imports, ou subir un rechargement Vite durant les tests. Il attend désormais un signal de disponibilité explicite et utilise un serveur de test sans HMR. Les relances complètes réussissent.
- Les attentes historiques ZIP1 ont été adaptées aux deux nouvelles collections ZIP2, sans supprimer les tests de lecture ZIP1 ou de corruption.

Toutes ces vérifications ont utilisé des bases et profils temporaires. Aucun test sur les données personnelles, aucune publication réelle, aucun essai de downgrade destructif. Le rendu natif PDF sur un téléphone physique n’a pas été revalidé : aucun composant de visionneuse n’a changé. La nouvelle interface des trajets/hébergements n’est volontairement pas créée.

### Fichiers et périmètre

Nouveaux modules : `evolution/v21/persistence.ts`, `repository.ts`, `graph.ts`, `financial.ts`. Modèles/validations V2.1a étendus, `db/database.ts` en V6, documents/cascades adaptés, journal/filiation/restauration et modules backup étendus. Tests : nouveau scénario V6, runner navigateur reproductible, configuration de test sans HMR, scénario concurrent complété et assertions historiques mises en accord avec V6/ZIP2. Documentation : ce rapport, le contrat ZIP et README des tests.

Les écrans `src/components/` et `src/App.tsx` ne sont pas modifiés. Les changements V1 présents hors roam-v2 étaient préexistants. Branche conservée : develop-v2 ; master inchangé. Aucun commit ni push.

## Finalisation des six critères

Le [bilan final V2.1b](v21b-validation.md) complète les références financières journey/accommodation, les contrôles anti-double-alias et les cascades. Il contient le tableau implémenté/testé/limites et les résultats des relances finales. Les cinq autres mécanismes et le pont de repository validé ont été conservés.
