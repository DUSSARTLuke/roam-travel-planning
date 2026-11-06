# Mode voyage — 2.9e

Accessible depuis l’Accueil du voyage actif. Une seule lecture réactive et
transactionnelle réutilise `readTripLibrary` (activités et métadonnées documentaires,
jamais les Blob). Les fichiers sont lus à la demande par la visionneuse existante.
Aucune donnée persistée supplémentaire, aucune migration Dexie V4/ZIP format 1.
Les fiches et l’édition sont celles du Programme ; les contacts et notes sont ceux
d’Infos pratiques, accessibles par raccourci sans duplication.

La sélection initiale est aujourd’hui dans le séjour, sinon le premier jour d’un
voyage futur ou le dernier d’un voyage terminé. Le choix est conservé en mémoire
par voyage pendant les changements d’onglet et les retours des espaces associés.
Un rechargement complet repart sur le jour courant. Programme et Carte reçoivent
explicitement la journée consultée lors de leur raccourci. Le retour à l’Accueil
retrouve le mode voyage, sauf fermeture explicite vers le tableau de bord.

Le tri réutilise `buildDayPlanning` : heures précises chronologiques, puis activités
sans heure précise avec l’ordre existant. La prochaine activité réutilise
`buildTripOverview` et exige une heure de début future réellement renseignée.
Une activité sans horaire ne reçoit aucune heure arbitraire. Une référence ne
confirme jamais une réservation : sans statut, « Statut non renseigné » est affiché.

## Limite des fuseaux horaires

Dates et heures civiles sont comparées sans conversion UTC accidentelle.
Le voyage ne stocke pas de fuseau de destination : aujourd’hui et maintenant
suivent l’appareil. Il faut régler son fuseau à destination pour un repérage exact.
L’horloge réévalue la minute et le retour de focus, sans requête réseau.

## Vérifications

Dans PowerShell, depuis `roam-v2/` :

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:pwa
npm.cmd run dev
```

Ouvrir `/tests/activities.html` sur le port dev et lancer la suite isolée.
`tests/travelMode.browser.tsx` couvre futur/en cours/terminé, changement d’année,
ordre réel malgré un sortOrder différent, absence d’heure, sélection, isolation,
réactivité, fichier manquant, fiche/retour et largeur 320/375 px.

À vérifier sur téléphone et clavier :

- Voyage futur, actuel et terminé, journée vide et dates modifiées dans les paramètres.
- Choisir une journée ; ouvrir/fermer une fiche et un PDF/image local, y compris hors ligne.
- Modifier une activité depuis sa fiche, vérifier l’actualisation sans perdre la journée.
- Programme/Carte : même journée ; retour Accueil : mode voyage conservé.
- Réservations et Infos pratiques : retour au mode voyage et même journée.
- Autre voyage : aucune activité ni sélection étrangère.
- 320/375 px : pas de débordement, noms de fichiers longs, boutons tactiles de 44 px.
- Tabulation, Entrée, Échap, focus restauré ; lecture claire sans dépendre des couleurs.
- Mode avion : activités, contacts et documents locaux accessibles ; un lien d’adresse
  ouvre une application externe qui peut avoir besoin de réseau.

Aucune suppression de données utilisateur ni purge de cache n’est requise pour tester.
