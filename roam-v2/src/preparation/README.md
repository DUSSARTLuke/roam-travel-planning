# Checklist de préparation — 2.9b

La section Préparatifs de l'accueil affiche la progression globale et les retards,
et donne accès à une checklist repliable, propre au voyage sélectionné. Cinq
catégories : Documents, Bagages, Transport, Réservations et Autres. Chaque tâche
contient un titre, une priorité (haute/normale/basse), une coche, une échéance et
des notes facultatives, ainsi que ses identifiants et dates techniques.

## Persistance et concurrence

`Trip.preparationTasks?` est une liste optionnelle embarquée dans le voyage, avec
500 tâches au maximum. Pas de nouvelle table ni d'index : Dexie V4 inchangé.
Aucune réécriture initiale, aucun remplissage automatique des anciens voyages.
Le modèle `tasks.ts` centralise validation, normalisation, progression, statut et tri.
Les repositories travaillent dans une transaction `rw` sur trips : relecture du
voyage, vérification accessible/actif et de la version exacte de la tâche modifiée,
fusion avec les autres tâches à jour, puis mise à jour du seul champ preparationTasks.
Ainsi, deux onglets peuvent modifier des tâches différentes sans se les écraser ;
un changement concurrent de la même tâche est refusé avec une erreur explicite.
Un ajout de modèles concurrent ne crée pas de doublons (templateId unique).
Une erreur d'écriture annule la transaction et conserve les saisies.

Les données reçues du voyage restent réactives via useLiveQuery dans l'App, sans
requête supplémentaire pour la checklist ; une autre connexion Dexie actualise
la liste et la progression. Les écritures sont protégées par les opérations
sensibles PWA existantes. Le formulaire réutilise la modale existante (focus, Échap,
fond, confirmation d'abandon). La suppression exige une confirmation et restaure
le focus vers l'ajout. Le changement de voyage démonte les états de l'ancien voyage.

## Règles

- Les tâches non terminées apparaissent avant les terminées dans chaque catégorie.
  Tri par échéance croissante, sans échéance après les dates, puis priorité,
  création et identifiant pour départager de façon stable. Le tri est calculé,
  jamais écrit dans IndexedDB.
- Une tâche est en retard uniquement si elle n'est pas terminée et que sa date
  limite précède la date civile locale de l'appareil. Aujourd'hui n'est pas en
  retard. Les échéances peuvent précéder le séjour et ne sont pas converties UTC.
  L'horloge réactive de l'accueil fournit la date ; pas de nouveau timer ni réseau.
- Progression = tâches cochées / tâches totales, tous filtres et catégories inclus.
  Une liste vide n'affiche pas une progression fictive à 100 %.
- Les modèles ne sont ajoutés qu'après sélection et action explicite. Ils ne créent
  ni document, réservation, transport ou paiement ; ce sont seulement des tâches.
  Un modèle déjà présent ne s'ajoute pas à nouveau. Une tâche issue d'un modèle
  reste modifiable ; supprimer celle-ci permet de réutiliser le modèle.
- Les tâches sont conservées lors de l'archivage ou du passage à la corbeille et
  deviennent modifiables après restauration. La suppression définitive du voyage
  supprime la liste contenue dans son objet, sans référence orpheline.
- La duplication copie titres/catégories/priorités/notes/échéances, attribue de
  nouveaux identifiants et remet toutes les tâches à faire. Les anciennes dates
  limites restent inchangées : aucun décalage n'est calculé silencieusement.
- Les sauvegardes ZIP format 1 préservent intégralement les tâches. Les validations
  d'export/restauration contrôlent les nouveaux champs optionnels ; les anciennes
  sauvegardes sans préparatifs restent acceptées. Pas de changement de format.
- Le fonctionnement est entièrement local/hors connexion. Aucun rappel système,
  automatisme de réservation ou fonction des étapes 2.9c–e n'est ajouté.

## Vérifications

Depuis PowerShell dans roam-v2 :

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:pwa
npm.cmd run dev
```

Ouvrir `/tests/activities.html` et lancer les tests. `preparation.browser.tsx`
utilise uniquement des bases synthétiques isolées : validation, CRUD, progression,
tri, dates/retards, modèles explicites, concurrence/deux connexions, échec/rollback,
archive/corbeille, duplication, persistance, ZIP/restauration/corruption, formulaires,
validation/saisies conservées, double soumission, focus après suppression, changement
de voyage, mobile 320/375/desktop et consultation/écriture offline. La suite complète
Accueil/Programme/Carte/Budget/documents/PWA/ZIP reste exécutée.

À vérifier sur téléphone réel : saisie de notes/date, clavier virtuel, zone tactile
des cases et boutons, filtres, ouverture/fermeture et abandon, puis rechargement
hors connexion. Dans deux onglets : cocher une tâche, modifier une autre, puis
provoquer volontairement un conflit sur la même tâche ; vérifier que l'erreur
conserve la saisie. Dupliquer un voyage préparé et vérifier nouvelles tâches non
cochées et dates conservées. Tester un export/restauration sur des données d'essai.
