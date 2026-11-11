# V2.1b — validation finale de la persistance

Date : 10 novembre 2026. Branche : develop-v2. Verdict : **V2.1b prête pour validation avant V2.1c**. Ce verdict concerne la persistance locale et ses contrats, sans publication ni nouvelle interface.

## Vérification des six critères

| Élément | Implémenté | Testé | Limites / périmètre |
| --- | --- | --- | --- |
| Migration réelle Dexie V5→V6 | Oui, conservée | Bases vides/volumineuses, réouverture sans doublon, upgrade refusée avec conservation V5 | Upgrade additive mais non rétrogradable par un binaire V5 ; aucune migration sur une base personnelle pendant les tests |
| Journal V5/V6, révisions, tombstones | Oui, conservé | Historique gelé, suppressions réémises, CAS, rollback, deux onglets réels | Journal local uniquement ; aucun service distant connecté |
| Export/import ZIP2 et lecture ZIP1 | Oui, conservés et validation financière étendue | ZIP1 V4/V5, ZIP2, compteurs/relations, binaires, corruption, conflits, import interrompu, répétition sans doublon | V2/lecteur ZIP1 ne peut pas restaurer ZIP2 ; conflits de voyage ignorés intégralement, sans fusion |
| Propriétaires typés des documents | Oui, activity/journey/accommodation | Isolation, signatures, quota simulé, rollback, SHA-256 et mêmes clés/nombre de fichiers après migration/restauration | Façade ActivityDocument maintenue pour les écrans V2 ; aucun réencodage ni nouvelle copie dans la table Blob lors du changement de propriétaire. Le journal référence les Blob comme auparavant, sans promesse de déduplication physique du moteur navigateur |
| Hébergements autonomes | Oui, conservés | Création, période, réservation, document, paiement, fermeture/réouverture, ZIP, suppression/détachement, CAS | Interface de gestion volontairement reportée à V2.1c et étapes suivantes |
| Budget, réservations et partages financiers | Oui, complément natif finalisé | Totaux canoniques, paiement partiel, références de réservation, partages journey/accommodation, alias doubles refusés, conflit/rollback, ZIP et cascades | Adaptateurs financiers canoniques prêts ; aucun nouvel écran Budget/Réservations ajouté ni statut de paiement inventé |

## Manque constaté et complément réalisé

Les cinq premiers critères étaient déjà implémentés. Le total canonique incluait aussi les nouveaux types de dépenses, mais le contrat de partage ne reconnaissait que activity/transfer. Aucune nouvelle table ni nouvelle migration n'était nécessaire.

Le contrat ExpenseReference et ses validateurs acceptent maintenant journey/accommodation. Le repository existant écrit explicitement le paiement sur la bonne entité et le partage dans Trip, dans la même transaction incluant le journal. Le montant estimé et la réservation ne sont pas remplacés. Les mêmes règles d'arrondis, conversion, paiements connus et répartition sont réutilisées par `v6ExpenseSharing` ; aucun moteur financier parallèle.

Une Journey migrée peut encore posséder un partage historique sous son alias transfer. Il est interdit d'ajouter en plus un partage journey sur la même dépense. Le repository et le validateur du graphe ZIP2 refusent cette double référence. Une seule source canonique est présentée au calcul par dépense, y compris pour le compteur des dépenses non partagées. Pour changer de type de référence, retirer explicitement l'ancien partage avant d'en créer un autre ; aucun rapprochement automatique.

La suppression d'une Journey ou d'un hébergement retire ses propres partages, sans affecter ceux des autres types. Supprimer une activité ne supprime pas un partage d'hébergement ayant par hasard le même identifiant brut. Les références financières historiques restent conservées lors du détachement d'un trajet.

## Tests exécutés et résultat final

- `npm run build` : réussi ; avertissement préexistant de taille des chunks.
- `npm run lint` : réussi, 0 erreur et 7 avertissements préexistants.
- `npm run test:v21` : réussi ; simulations pures et assertions budgétaires maintenues.
- Suite navigateur complète : réussie sur desktop, 320 px et 375 px, avec profils et bases temporaires. Elle couvre aussi les vrais formulaires V2, Programme, Carte, Budget, réservations, documents et le pont anti-résurrection.
- Migration volumineuse : 300 activités, 31 PDF fictifs / 45 Mio, dont un document de 15 Mio. SHA-256 et relations conservés, ZIP1 avant upgrade, V6, restauration et réouverture.
- Concurrence : deux onglets Chrome réels, y compris hors réseau, édition/suppression V2 et modification native invisible ; une seule validation, aucun journal parasite sur conflit.
- Tests PWA : réussis sur le build final, précache/intégrité/exclusions et activation volontaire.
- Production hors réseau : démarrage, création avec PNG, modification, fermeture/réouverture, consultation du fichier local puis suppression persistée : réussi.
- Partages natifs : hôtel payé 50 EUR, trajet autonome payé 12 EUR et trajet migré payé 7 EUR ; total payé canonique 69 EUR, trois partages inclus. Référence de réservation REF conservée. ZIP2, réouverture et suppression d'hébergement vérifiés.
- Refus d'un paiement natif obsolète : aucun montant ni journal modifié. Erreur de stockage simulée après écriture du paiement : rollback du paiement et du partage, sans opération supplémentaire.
- `git diff --check -- roam-v2/` : réussi.

### Échecs des premières relances

Les premiers runs mobiles concurrents ont rencontré une collision de cache Vite (EPERM au renommage du dossier deps) et une attente de test insuffisante : le formulaire était rouvert avant que le nouveau paiement soit reçu par useLiveQuery, ce qui provoquait un conflit correctement refusé par le repository. Le serveur de chaque runner utilise désormais un cache distinct. Le test attend la valeur réellement rendue avant de rouvrir la modification. Aucun écran ni contrôle de conflit n'a été modifié. Les suites complètes ont ensuite été relancées avec succès.

## Limites avant les étapes d'interface

Le pont V2 reste l'adaptateur validé : journeys est la source unique, manualTransfers est un cache dérivé gardé par le middleware et muni de jetons de révision. Les trajets autonomes/multi-étapes et hébergements sont persistants via les repositories ; leur affichage et édition dans les nouveaux écrans restent hors périmètre. Les écrans existants n'obtiennent pas implicitement une nouvelle source financière.

V2/Dexie V5 ne peut ni ouvrir une base V6 ni lire ZIP2. Conserver un ZIP1 préalable avant une future mise en service sur une origine contenant des données importantes. Un ancien onglet V5 peut bloquer une upgrade ; ne pas effacer IndexedDB pour le contourner. Aucun downgrade destructif ou test sur de vrais documents utilisateur n'a été exécuté.

Les contrôles automatisés mobiles sont des émulations Chrome, pas un test physique de chaque téléphone. Le lecteur PDF natif dépend toujours du navigateur ; aucun composant de visionneuse n'a changé à cette étape.

## Fichiers complétés pendant cette finalisation

- `money/expenseSharing.ts`, `db/expenseSharing.ts` : types/validation et écritures de partage natif.
- `evolution/v21/financial.ts`, `graph.ts`, `repository.ts` : calcul réutilisé, unicité des alias, validation et cascades.
- `db/activities.ts` : nettoyage limité au bon type de référence.
- `tests/v21-persistence.browser.ts` : paiements/partages natifs, conflits, rollback, restauration et réouverture.
- `tests/expenseSharing.browser.tsx`, `tests/vite.isolated.config.ts` : synchronisation/isolement du runner.
- Documentation : ce bilan et les compléments du contrat V6/ZIP2.

Aucun fichier d'écran modifié, aucun accès aux données personnelles, aucun changement de master/Pages/version publiée, aucun commit, push ou déploiement.
