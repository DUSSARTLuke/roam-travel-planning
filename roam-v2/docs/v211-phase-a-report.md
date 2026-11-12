# Roam V2.1.1 — Rapport de phase A

Travail local du 12 novembre 2026 sur `develop-v2`. Seule la phase A est implémentée. Aucun commit, push ou déploiement ; aucun accès aux données réelles. Les tests utilisent des bases IndexedDB fictives nommées `roam-v2-test-…` et des profils Chrome temporaires.

## Audit préalable

- `Trip.participants` contient déjà les voyageurs nommés du partage des dépenses. `Trip.travelers` représente seulement leur nombre : aucune seconde liste de voyageurs n’a été créée.
- `TripActivityInput` et `validateActivity` définissent les champs persistés. Le repository protège les éditions concurrentes par révision ; les modifications partielles préservent les champs avancés omis.
- `TripProgram` alimente les vues Jour, Multi-jours, Calendrier, Idées et Autres dates. Jour et Multi-jours utilisent `buildDayPlanning`, et les cartes partagent `ActivityCard`.
- La suppression des voyageurs dans `createExpenseSharingRepository` protégeait déjà les dépenses partagées. Elle doit désormais maintenir les références des activités dans la même transaction.
- L’export et la restauration conservent les objets d’activité, avec validation des relations. ZIP1 couvre les schémas historiques V4/V5 et ZIP2 le schéma V6 ; le journal local doit aussi rester cohérent.
- Pour la phase B ultérieure : le modèle canonique `JourneyStop` accepte déjà les références activité/hébergement et conserve un instantané du lieu. Le parcours historique `ManualTransfer` et son formulaire restent fondés sur des paires d’activités. Les raccourcis depuis les hébergements devront s’appuyer sur les trajets canoniques, leurs étapes et les dates de séjour. Aucun changement de phase B réalisé.

## Comportements livrés

- Champ facultatif `participantIds` sur les activités, réutilisant les identifiants de `Trip.participants`.
- Par défaut, « Tous les voyageurs (activité collective) » est coché ainsi que chaque voyageur. Décocher un voyageur crée une sélection explicite. Il est possible de revenir au mode collectif.
- Champ absent : activité collective, y compris pour toutes les anciennes activités. Le mode collectif inclut aussi les voyageurs ajoutés ultérieurement. Aucune migration physique, nouvelle version Dexie ou réécriture des activités historiques n’est nécessaire.
- Liste vide explicite : aucun participant. Cette distinction évite de transformer une activité individuelle en activité collective après la suppression de son dernier voyageur.
- Participants affichés sur les cartes du Programme ; les noms sont résolus depuis le voyage, donc un changement de nom est reflété sans copier les noms dans les activités.
- Filtre Tous / chaque voyageur appliqué aux activités des vues Jour, Multi-jours, Idées, Autres dates et aux compteurs Calendrier. Une activité collective reste visible pour chaque voyageur. Si le voyageur filtré disparaît, le filtre effectif revient à Tous.
- Une alerte horaire suppose des horaires en conflit ET des participants communs. Les règles existantes concernant même début, fin inconnue, durée nulle et horaires adjacents sont conservées.
- Suppression d’un voyageur : retrait des listes explicites des activités du même voyage et du voyage dans une transaction commune ; les activités collectives restent collectives. Le refus existant pour un voyageur utilisé par une dépense partagée reste actif. Une ancienne saisie ne peut pas réintroduire un identifiant supprimé.
- Validation de la forme, des doublons, de la limite de 100 participants et de l’appartenance au voyage à l’enregistrement ; validation des références également à l’export et à la restauration ZIP1/ZIP2.

## Validation automatique

Commandes exécutées depuis la racine du dépôt :

```text
npm.cmd run build --prefix roam-v2
npm.cmd run lint --prefix roam-v2
npm.cmd run test:v21 --prefix roam-v2
npm.cmd run test:browser --prefix roam-v2 -- 320
npm.cmd run test:browser --prefix roam-v2 -- 375
npm.cmd run test:browser --prefix roam-v2 -- 1100
```

Build et tests réussis. Lint terminé avec sept avertissements préexistants ; aucun nouvel avertissement. Le build signale les tailles élevées des bundles existants.

La nouvelle suite `tests/activityParticipants.browser.tsx`, intégrée à la suite navigateur générale, couvre :

- défaut collectif, sélection dans le vrai formulaire, conversion formulaire/modèle, données invalides et identifiants étrangers refusés ;
- sauvegarde, préservation lors d’une modification partielle et réouverture sans réécriture des anciennes activités ;
- conflits entre participants communs/disjoints, même début, horaires adjacents, activité collective et liste vide ;
- export/restauration ZIP1 V5→V6 et ZIP2 avec conservation des sélections et du champ historique absent ; export avec référence orpheline refusé ;
- affichage des noms, filtres Alice/Bob et retour à Tous, filtre conservé en Multi-jours, collectives conservées, absence de débordement et cibles tactiles d’au moins 44 px ;
- suppression du dernier participant d’une activité, conservation des autres voyageurs et des collectives, refus d’une ancienne saisie.

Les suites complètes à 320, 375 et 1100 px ont aussi validé les régressions existantes : migrations V2/V3/V4/V5→V6, rollback, concurrence, partage des dépenses, ZIP1 V4/V5 et ZIP2, intégrité SHA-256 des documents, restauration répétée, déplacements autonomes et multi-étapes, hébergements et ergonomie mobile.

La vérification mobile est automatisée dans Chrome headless avec viewport simulé ; aucun contrôle physique sur téléphone n’est revendiqué.

## Arrêt après phase A

La phase A est livrée localement pour revue. La version publique et les données réelles restent intactes. La phase B n’est pas commencée.
