# Garantie du pont V2 → Journeys — 10 novembre 2026

## Défaut reproduit et choix retenu

Le test ajouté avant correction supprimait un transfert via le repository V2 puis rejouait son ancien tableau Trip.manualTransfers. L'ancien middleware réinterprétait ce tableau et recréait une Journey. Échec reproduit : « Écriture de projection obsolète acceptée : résurrection possible ».

La conversion implicite inverse est supprimée. **Journeys est l'unique source de vérité ; manualTransfers est un cache jetable.** L'adaptateur est dans `db/transfers.ts`, avec la même signature qu'avant pour les écrans. Aucun écran n'est modifié.

## Écritures supportées

- Création V2 : validation des champs/parents dans le voyage, création explicite d'une Journey, puis génération du cache Trip, dans une transaction RW unique incluant le journal.
- Modification V2 : lecture du canonique et de sa révision, vérification du snapshot attendu, patch des seuls champs exposés par V2. Les réservations, titres natifs, snapshots de lieu, horaires propres, identifiants d'étapes et données supplémentaires sont conservés lorsque les références ne changent pas. Changer explicitement une activité liée met à jour la référence et son snapshot, sans perdre l'identité de l'étape.
- Suppression V2 : lookup canonique, vérification de la version attendue puis suppression via le repository V6 (documents/Blob, alias financiers et tombstone dans la même transaction).
- Paiement partagé : le repository de partage lit le transfert canonique et écrit le paiement de la Journey ; le partage et la projection sont enregistrés dans la même transaction. Aucun second paiement n'est créé.
- API native V6, détachement lors d'une suppression et restauration : les repositories rafraîchissent le cache au sein de leur transaction, via les APIs Dexie observables. Les écrans continuent donc de recevoir les mises à jour useLiveQuery.

Le middleware garde son rôle de journal et de garde-fou, pas de traducteur inverse : une tentative d'écriture d'un tableau incohérent avec le canonique est refusée et annulée. Une écriture compatible est normalisée vers le canonique, jamais interprétée comme une création/modification/suppression de Journey. Un changement de cache seul ne crée pas de révision ou d'opération Trip.

## Concurrence

Chaque ligne projetée possède `_journeyVersion: {identity, revision}`. Le formulaire V2 existant mémorise déjà `transferKey` à l'ouverture ; il transporte donc ce jeton sans changement d'écran. L'adaptateur compare le snapshot à la projection reconstruite depuis les Journeys et syncEntities, dans sa transaction RW. Il ne décide jamais d'une écriture à partir du tableau stocké dans Trip.

Une modification native sur un champ invisible dans le formulaire V2 rend ainsi ce formulaire obsolète, même si updatedAt n'a pas changé. Une suppression change aussi l'état canonique : un ancien formulaire ne devient jamais une création implicite. Le refus laisse données, documents et journal inchangés.

À l'ouverture, un cache V6 antérieur ou périmé est reconstruit depuis le canonique, avec les jetons actuels. Aucun objet Journey ni opération du journal n'est créé à cette occasion. La migration rafraîchit également les jetons après le rebaseline. Une réouverture n'effectue aucune conversion de transferts et ne génère aucun doublon.

## Journal et ZIP

Les opérations V5 restent conservées comme superseded et `isReplayableOperation` exige le protocole 2 et pending. Rejouer directement une ancienne projection via les APIs Dexie courantes est également refusé ; ce chemin ne peut plus créer une Journey.

ZIP2 et les payloads courants du journal Trip excluent manualTransfers. Les Journeys canoniques et leurs identités sont seuls exportés. Restaurer une archive ne convertit pas le cache : le canonique est importé, puis sa projection est construite. Une restauration répétée ignore le voyage déjà présent et ne crée pas d'enfant supplémentaire. ZIP1 ne passe par une conversion que dans son adaptateur d'import historique validé, avec la politique de conflits existante.

## Limites explicites

- Les appels métier doivent passer par les repositories. Un accès natif IndexedDB effectué par un ancien script ou les outils développeur peut contourner n'importe quel middleware du navigateur ; le cache est réparé à la réouverture, sans adopter ses données. Le test utilise ce contournement uniquement sur une base temporaire pour vérifier cette réparation.
- Un futur adaptateur distant doit appliquer les champs canoniques via les repositories/commandes, jamais réécrire un Trip complet obsolète avec son cache. Il n'existe pas de synchronisation distante à cette étape.
- V2 ne sait représenter que les Journeys de provenance historique avec deux activités liées. Les trajets autonomes, détachés ou multi-étapes sont conservés mais leur édition nécessite l'interface V2.1 à venir. Un vieux formulaire est refusé si son trajet n'est plus représentable.
- Un formulaire déjà ouvert avant l'introduction des jetons doit être fermé/réouvert ; aucun ancien snapshot sans révision n'est adopté automatiquement.
- Les textes historiques des écrans n'ont pas été modifiés. Les incompatibilités V5/V6 et ZIP1/ZIP2 décrites dans le rapport V2.1b restent applicables.

## Tests

`legacyBridge.browser.ts` vérifie création/modification/suppression via l'API V2, refus d'une ancienne projection, conservation des champs natifs/liens/montants, concurrence édition/suppression, réparation du cache sans écriture canonique/journal, réouverture et restaurations répétées sans doublon. La suite existante vérifie aussi les vrais formulaires V2, les paiements partagés, migrations et documents.

Le runner deux onglets réels vérifie un champ natif invisible modifié sans changement de date, le refus du formulaire V2 obsolète sans écriture et la course édition/suppression avec une seule réussite. Le réseau est réellement désactivé pour ces opérations.

Les résultats finaux sont consignés ci-dessous après les relances.

### Résultats exécutés

- Défaut reproduit avant correction : une ancienne projection était acceptée après suppression. Le test refuse maintenant ce rejeu et vérifie zéro nouvelle Journey/opération.
- Suite navigateur complète desktop : réussie, y compris le pont, les vrais formulaires V2, migrations, ZIP1/ZIP2, budget et documents.
- Suites complètes émulation 320 px et 375 px : réussies.
- Deux onglets Chrome réels, réseau coupé : réussis. Champ natif invisible modifié sans changement d'updatedAt → édition V2 obsolète refusée sans journal ; course édition/suppression → une seule écriture canonique et une seule opération.
- Réparation d'un cache volontairement ancien, injecté via un client Dexie sans middleware dans une base temporaire : inventaire Journey et journal inchangés, aucun transfert supprimé recréé.
- Réouverture et restauration ZIP répétée : aucun doublon.
- Build, tests PWA, production hors connexion avec document et réouverture, simulations V2.1 et diff check : réussis. Lint : aucune erreur, 7 warnings préexistants ; avertissement de taille de chunks existant.

Une relance intermédiaire a mis en évidence la perte de réactivité quand le cache était écrit directement en DBCore. La maintenance est désormais explicite dans les repositories via Dexie observable, au sein de leur transaction. La suite des graphiques et du Programme a été relancée et passe. Aucune dépendance ajoutée, aucun changement de schéma supplémentaire, aucun changement d'écran, commit, push ou déploiement.

Fichiers principaux : `db/transfers.ts` (adaptateur), `evolution/v21/projection.ts` (cache), `sync/journal.ts` (garde-fou sans traduction inverse), `db/expenseSharing.ts` (paiements canoniques), repositories V6/suppressions/import et refresh à l'ouverture. Les tests ajoutés sont `legacyBridge.browser.ts` et les scénarios du runner concurrent. Les comparaisons de migration ignorent uniquement le jeton technique `_journeyVersion`, jamais les montants, lieux, références ou autres données métier.
