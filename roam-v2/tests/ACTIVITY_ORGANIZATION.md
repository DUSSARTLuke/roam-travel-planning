# 2.6b — Organisation rapide

Lancer `npm.cmd run dev`, puis `/tests/activities.html` et la suite complète.
Les tests utilisent exclusivement des bases temporaires isolées : ordre historique
absent, périodes et sans horaire mélangés, limites, date/idées, horaire/retrait,
validation, isolation, conflit de planification, conservation des autres champs,
réouverture IndexedDB et aller-retour ZIP format 1. Les formulaires rapides et
leurs actions tactiles/clavier sont également exercés.

## Choix

- Aucun changement Dexie V4 ni format ZIP 1. `sortOrder` existant est facultatif
  pour lire les anciens enregistrements ; son absence vaut logiquement zéro.
- À organiser : ordre manuel commun aux périodes et activités sans horaire,
  puis ordre historique déterministe en cas d’égalité. Les heures précises restent
  triées chronologiquement par le planning.
- Monter/Descendre relit le groupe voyage/date courant et attribue des rangs
  denses dans une transaction. Seuls l’ordre et la date de modification changent.
- Les actions date/horaire relisent l’activité et préservent tous les autres champs.
  Si sa planification a changé depuis l’ouverture, l’écriture est refusée : fermer
  puis rouvrir l’action. Une réorganisation concurrente utilise le dernier ordre
  disponible, sans écraser une ancienne copie de l’activité.
- Les dates hors séjour restent explicitement autorisées, conformément au formulaire
  complet et à la section Autres dates. Une idée conserve son horaire éventuel.
- Retirer l’horaire retire aussi un moment de journée et produit Sans horaire.
  Le panneau reste ouvert en cas d’erreur. Échap/Fermer demande confirmation
  uniquement si la saisie a changé. Les opérations bloquent la mise à jour PWA.

## Contrôles manuels

1. Sur ordinateur et téléphone étroit, ouvrir Déplacer puis Horaire depuis une carte
   du jour, une idée et Autres dates. Vérifier focus, Tab/Maj+Tab, Échap, fond et retour.
2. Changer le jour (y compris décembre/janvier), annuler puis enregistrer : aucune
   ouverture de fiche involontaire, jour courant et défilement conservés ; retrouver
   l’activité dans le jour cible. Passer également en Idée à planifier et inversement.
3. Modifier début/fin, retirer l’horaire, vérifier les nouveaux créneaux et conflits.
   Vérifier lieu, réservation, montants et documents inchangés dans la fiche.
4. Réordonner trois activités À organiser (dont une période), tester les extrémités
   et doubles clics. Recharger puis exporter/restaurer dans une base de test séparée.
5. Dans deux onglets, modifier une note pendant qu’un panneau Horaire est ouvert :
   elle doit être conservée. Modifier l’horaire dans l’autre onglet : la saisie devenue
   obsolète doit être refusée. Vérifier un voyage archivé/à la corbeille inaccessible.
6. Hors connexion, refaire déplacement/horaire/ordre. Vérifier Calendrier,
   changement de journée, retour aux fiches et absence de débordement horizontal.
