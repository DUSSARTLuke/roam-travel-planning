# V2.1e — Hébergements autonomes

## Fonctionnalités livrées

L'Accueil du voyage possède une entrée **Hébergements**, avec liste, état vide, création, fiche, modification et suppression confirmée. Les formulaires réutilisent les panneaux natifs, le contrôle de focus/Échap, la confirmation d'abandon, le blocage des mises à jour PWA pendant une saisie et les protections contre les doubles clics.

Champs : nom, dates d'arrivée/départ, horaires facultatifs check-in/out, adresse, GPS facultatifs (point/virgule, zéro et nombres négatifs), référence/statut/prestataire/notes de réservation, estimation, paiement, devise et notes. Les autres champs de réservation déjà présents, notamment personnes et date limite, restent conservés à l'édition et affichés dans la fiche. Une ancienne devise absente n'est pas remplie automatiquement ; une nouvelle fiche propose celle du voyage.

Le nombre de nuits est la différence entre dates civiles validées, sans heure ni décalage de fuseau. Un séjour de zéro nuit est accepté ; les dates inversées sont refusées. Deux séjours se succédant le même jour ne créent pas d'alerte de chevauchement de nuit. Un chevauchement est signalé mais ne supprime ni ne déplace aucun séjour.

## Intégrations

- **Programme** : arrivée, nuits sur place et départ, horaires uniquement s'ils existent. Les colonnes Multi-jours réutilisent la même liste déjà chargée, sans lecture IndexedDB par nuit. Aucun objet activité fictif n'est créé.
- **Calendrier** : marqueurs d'hébergement et boutons accessibles ouvrant directement la fiche, y compris quand plusieurs séjours couvrent une date.
- **Carte** : marqueur Hébergement distinct ; ouverture/édition de sa fiche depuis la liste ou l'aperçu, sans démonter ni recentrer la carte. Une adresse sans GPS reste utilisable dans le module et les documents.
- **Déplacements** : le sélecteur V2.1d utilise les hébergements de la même table. Modifier un hébergement conserve les références et l'instantané du lieu du trajet ; la localisation du trajet n'est pas changée silencieusement. La suppression détache les références avec état `deleted`, conserve le dernier lieu connu et affiche l'avertissement existant.
- **Réservations/documents** : même bibliothèque et mêmes filtres nom/référence/fichier, type, statut et présence de documents ; lecteur de métadonnées seul, sans chargement de Blob. La fiche réutilise import atomique, consultation, téléchargement et suppression documentaire existants. Le propriétaire persistant est `accommodation`, aucun Blob ni fausse activité n'est recopié.
- **Budget/Accueil** : estimation et paiement globaux du séjour dans les synthèses et graphiques. Le coût n'est pas ventilé par nuit ni attribué arbitrairement à la date d'arrivée : il apparaît parmi les dépenses sans journée attribuable, avec explication. Les conversions, montants absents et zéro suivent les règles existantes.
- **Partages** : le Budget propose les hébergements natifs, conserve les répartitions existantes et réutilise le repository/les calculs validés. Le formulaire Hébergement refuse de changer montant payé ou devise d'un paiement partagé : le Budget reste le point de modification du partage.

## Anciennes activités et prévention des doubles comptes

Aucune conversion automatique ni suppression d'activité. Créer un hébergement n'est pas convertir une activité existante. L'utilisateur dispose de l'option explicite **« Montants déjà suivis ailleurs : exclure cet hébergement du budget »** ; les montants et documents restent stockés.

Le champ optionnel `Accommodation.budgetExcluded?: boolean` matérialise ce choix, avec `false` comme défaut logique pour les données anciennes. Il est validé par le modèle et les lectures/restaurations ZIP2, et suivi par le journal V6 comme tout champ de l'entité. Aucun index ou table supplémentaire n'est nécessaire.

Si la même référence de réservation (hors casse/espaces de bord) apparaît sur une activité du même voyage avec des montants, le repository refuse transactionnellement d'enregistrer une seconde fiche Hébergement avec des montants non exclus. Le formulaire conserve la saisie et explique le choix à faire. Si un doublon historique arrive par sauvegarde ou qu'une activité est ajoutée ensuite, la synthèse signale le conflit et n'intègre pas une seconde fois le montant de l'hébergement ; aucune donnée source n'est modifiée.

Une référence commune ne prouve pas toujours qu'il s'agit de la même dépense. Il n'y a pas de rapprochement flou sur les noms/adresses, ni de fusion automatique. Les cas sans référence nécessitent le choix explicite de l'utilisateur. Pour deux dépenses réellement distinctes sous une référence commune, clarifier leurs références avant de les compter séparément. Une exclusion ne peut être activée sur un hébergement possédant un partage : retirer d'abord ce partage depuis le Budget, sans effacer le paiement, puis choisir l'exclusion. Les partages sont également conservés dans les ZIP2.

## Persistance et sécurité

Dexie **V6** et ZIP **format 2** sont conservés ; lecture des ZIP1 inchangée. Pas de nouvelle migration, d'installation ou de service réseau. Les anciennes fiches sans `budgetExcluded` restent incluses selon les règles financières existantes. Ne pas revenir à un ancien binaire V2.1b/d pour calculer des totaux utilisant ce nouveau choix : il ne connaît pas encore cette exclusion, même si le schéma est V6.

Les writes réutilisent le repository V6 et les transactions sur l'entité, les documents et le journal. La révision est capturée à l'ouverture du formulaire puis contrôlée atomiquement. Un conflit ne modifie ni données ni journal et conserve les saisies ; annuler puis rouvrir permet de lire la dernière version, après avoir copié les notes à conserver. Aucune fusion automatique. Une suppression concurrente ne ressuscite pas l'hébergement.

La suppression confirmée retire seulement l'hébergement, ses documents/Blob et son partage, avec tombstones ; elle conserve activités, autres hébergements et déplacements. Les documents des autres propriétaires restent intacts. Les voyages archivés/dans la corbeille ne sont pas rendus modifiables par ces panneaux.

## Fichiers concernés

- Nouveaux : `src/components/accommodations/AccommodationSpace.tsx`, `accommodations.css`, `src/accommodations/model.ts`, `tests/accommodationInterface.browser.tsx` et ce document.
- Navigation : `App.tsx`, `TripProgram.tsx`, `MultiDayProgram.tsx`, `TripCalendar.tsx`, `TripMap.tsx`.
- Bibliothèque : `db/tripLibrary.ts`, `components/reservations/TripLibrary.tsx`.
- Budget : `money/tripBudget.ts`, `TripBudget.tsx`, `TripOverview.tsx`, `BudgetDayChart.tsx`, `ExpenseSharing.tsx`.
- Modèle/écritures : `evolution/v21/contracts.ts`, `repository.ts`, `graph.ts`, `financial.ts`, `db/expenseSharing.ts`.
- Tests : inclusion dans `activities.browser.ts`, extension des fixtures et du runner deux onglets, de `production-offline.mjs`, et injection de lecteurs Hébergements vides dans les anciens harnesses isolés. Les données et assertions existantes ne sont pas supprimées.

## Tests automatisés

Bases IndexedDB et profils Chrome temporaires uniquement :

- `npm run build` : TypeScript/Vite réussi ; avertissement de taille des chunks existant.
- `npm run lint` : aucune erreur, sept avertissements préexistants.
- `npm run test:v21` : contrats, finances et simulations de migration/ZIP réussis.
- `npm run test:browser` et `node tests/browser-suite.mjs 320` / `375` : suite complète, migrations, journal, ZIP1/ZIP2 et régressions antérieures.
- Nouveau scénario Hébergement : création sans activité, GPS partiels et période inversée refusés, décimales/coordonnées zéro, zéro/absent, nuits/décembre-janvier/DST, check-in/out, chevauchements et séjours consécutifs, import/ouverture de PNG et Blob manquant, édition obsolète refusée sans journal, Programme/calendrier/carte et caméra, bibliothèque/recherche documentaire, budget non ventilé, paiement partagé protégé, compatibilité ZIP2/binaire, anciennes activités/doublons/exclusion invalide, suppression confirmée/annulée et cascade non destructive, réouverture.
- `npm run test:concurrency` : deux vrais onglets hors réseau avec les nouveaux formulaires ; double clic, révision atomique, conflit et saisie conservée ; suppression concurrente sans résurrection ni journal supplémentaire. Scénarios V5/V6 et Journeys conservés.
- `npm run test:offline` : build de production contrôlé par le service worker, réseau coupé via CDP ; Accueil → Hébergements, création, édition, fermeture/réouverture, ouverture d’une image locale associée puis suppression. Les parcours activité/document/déplacement antérieurs restent exécutés.
- `npm run test:pwa` : intégrité des assets précachés, exclusions, mise à jour volontaire et protocole multi-onglets.
- `git diff --check -- roam-v2/` depuis la racine.

Les premières exécutions ont signalé des attentes de test insuffisantes pour le chargement asynchrone des métadonnées et l'ouverture de la confirmation de suppression ; les tests attendent maintenant ces états et la disponibilité des boutons avant d'agir, sans supprimer les assertions de persistance ou d'intégrité.

## Limites et contrôles physiques

Les tests Carte utilisent un rendu simulé pour les interactions déterministes et conservent les tests des géométries/adaptateurs existants. Le rendu WebGL du téléphone, le clavier virtuel, les zones de sécurité et le confort tactile physique restent à observer sur appareil réel. Pas de géocodage ou de garantie de tuiles hors ligne.

Pas de conversion guidée d'anciennes activités à cette étape. Pas de calcul de prix par nuit, de chambre/voyageur ou de disponibilité hôtelière. La duplication des voyages conserve le comportement déjà validé en V2.1b ; ce module n'ajoute pas une copie automatique des nouvelles entités. L'export/restauration ZIP2 constitue le parcours de conservation intégrale.

Aucune donnée personnelle ouverte ou modifiée, aucune action sur `master`/Pages, aucun commit, push ou déploiement.
