# 2.6c — Déplacements manuels

## Données et règles

- Tableau optionnel `manualTransfers` du voyage ; absence = aucun déplacement.
  Pas de migration Dexie V4 ni changement du format ZIP 1. Pas d'index nécessaire :
  les déplacements se consultent avec le voyage, comme ses taux manuels.
- Liaison directionnelle par identifiants d'activités, jamais par position.
  À la création/modification : deux activités existantes, différentes, du même
  voyage et de la même journée non nulle. Les horaires sont facultatifs.
- Affichage après le départ, avec départ/arrivée toujours nommés. Le tri du planning
  est recalculé à l'affichage ; un ordre inversé ou des activités intercalées sont
  signalés. Les identifiants du trajet ne changent pas lors d'un réordonnancement.
- Si les jours divergent ou si une activité devient une idée, conserver le trajet
  dans « Déplacements à vérifier », avec action Modifier / supprimer. Aucun jour
  ni horaire d'activité n'est modifié par l'édition du trajet.
- Règle de suppression explicite : la suppression définitive d'une activité via
  le repository supprime ses trajets associés dans la même transaction, avec
  rollback intégral en cas d'erreur. Les autres activités/trajets sont conservés.
  La suppression définitive du voyage emporte son tableau de trajets ; archivage
  et corbeille le conservent. La duplication actuelle ne copie pas les activités,
  donc ne copie pas les trajets (aucun lien vers le voyage original).
- CRUD transactionnel : relire le tableau courant, remplacer uniquement le trajet
  visé ; comparer la version complète avant modification/suppression. Les actions
  concurrentes sur des trajets distincts se fusionnent ; un même trajet obsolète
  est refusé. Les autres champs du voyage restent intacts.
- Coût et durée facultatifs, zéro distinct d'une valeur absente. Devise proposée
  depuis le voyage, modifiable indépendamment. Virgule/point acceptés ; aucune
  conversion, durée, distance ou route calculée. Depuis 2.6e, les créneaux prennent en compte un trajet unique cohérent dont la
  durée est connue ; les autres cas restent explicites (TRANSFER_AVAILABILITY.md).
- Pas d'appel réseau. Les formulaires bloquent la mise à jour PWA pendant une
  saisie non enregistrée ou une écriture, et demandent confirmation à l'abandon.

## Tests automatisés

Dans PowerShell, depuis `roam-v2` :

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:pwa
npm.cmd run dev
```

Ouvrir `/tests/activities.html` sur le port affiché et lancer la suite complète.
Les fixtures sont dans des bases temporaires dédiées, jamais la base utilisateur.
Les tests couvrent les 11 modes, CRUD, nombres invalides, zéro/absence, devises,
isolation, deux connexions IndexedDB, changements de jour et d'ordre, lien
inchangé, réactivité, réouverture, ZIP, références invalides, saisie avec virgule,
annulation, confirmation de suppression, double action, focus, zone tactile et
cascade avec rollback. Les suites précédentes restent exécutées.

## Vérifications manuelles restantes

1. Téléphone et desktop : créer un déplacement entre deux activités horaires,
   puis entre deux activités À organiser. Vérifier mode, coût, durée, notes et
   lisibilité des noms longs, sans débordement horizontal.
2. Modifier/supprimer, annuler chaque action ; utiliser Tab/Maj+Tab, Entrée, Échap
   et le fond du panneau. Vérifier confinement et restauration du focus,
   confirmation de perte de saisie et maintien du jour/défilement.
3. Modifier l'heure d'une activité, inverser l'ordre des activités sans horaire :
   le trajet suit son départ, conserve ses références et signale l'ordre inhabituel.
4. Déplacer une activité vers un autre jour ou Idées : vérifier le bloc de correction.
   Replanifier les deux activités le même jour : le trajet retrouve le planning.
5. Hors connexion : créer/modifier/recharger ; les trajets restent disponibles.
6. Deux onglets : modifier deux trajets distincts, puis le même trajet. Le second
   cas doit refuser l'écriture obsolète sans perdre les saisies. Modifier les
   paramètres/taux du voyage en parallèle : aucun écrasement de champs.
7. Export complet et individuel puis restauration dans une base de test séparée :
   trajets, coûts/devise et liens à corriger conservés. Un voyage existant reste
   intégralement ignoré ; une ancienne sauvegarde sans trajets reste acceptée.
8. Vérifier archives/corbeille/restauration et duplication : aucune réactivation
   ni copie de lien vers les activités du voyage original.

## 2.6e.1 — Options du formulaire

Les journées sont triées par date locale ; les activités proposées réutilisent
DayPlanning : début croissant pour les activités horaires, puis À organiser avec
son ordre manuel stable et ses critères historiques. Les heures de début connues
figurent dans les libellés. Les idées et activités d'autres voyages ne sont pas
proposées. Le tri est mémorisé jusqu'à une modification de la liste d'activités.

Chaque liste exclut immédiatement l'identifiant choisi dans l'autre. Changer
un champ libère l'ancienne option sans réinitialiser l'autre sélection, les notes,
la durée, le coût ou la devise. Une option explicite indique l'absence d'autre
activité ; avec une seule activité, l'enregistrement reste désactivé. La validation
métier continue à refuser une liaison d'une activité à elle-même.

La suite activities.html inclut transferFormActivities.browser.tsx : tri par date
et heure, égalités, ordre sans horaire/historique, libellés, exclusions réciproques,
création/édition, valeurs et version conservées, actualisation de liste sans perte
de saisie et cas à une seule activité. Les anciennes vérifications CRUD réelles
restent exécutées. Manuellement, sur téléphone et au clavier, vérifier les listes
natives Départ/Arrivée, le préremplissage en édition et le message sans alternative.
