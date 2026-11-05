# Réservations et documents — 2.9c

Une action dédiée de l'accueil ouvre l'espace du voyage actif et remplace le résumé
Accueil pendant sa consultation. Le retour restaure le focus sur ce raccourci.
La navigation Programme/Carte/Budget/Plus et leurs données restent inchangées.
La tuile Plus de l'accueil précise désormais qu'elle mène aux sauvegardes.

## Sources et classement

Il n'y a ni table de réservations parallèle, ni document indépendant, ni copie de
métadonnées ou de Blob. Un élément est une activité avec des informations de
réservation réellement renseignées **ou** au moins un document existant. Une pièce
jointe seule n'invente pas un statut, une référence ne signifie pas « réservée ».
Les activités et documents apparaissent une seule fois par identifiant, dans
leur voyage parent. Les statuts existants, y compris pending historique, sont
conservés. Les idées sans date et les activités hors séjour restent consultables.

Le modèle des activités ne dispose pas d'une catégorie hébergement. Un seul champ
optionnel `reservationType` permet donc un classement explicite transport,
accommodation, activity ou other dans la section Réservation du formulaire existant.
Il est validé par le modèle et conservé par les modifications partielles, y compris
la fusion du formulaire depuis la dernière version enregistrée. Il ne change pas
la catégorie financière de l'activité ni son montant ou statut.

Sans ce champ, le classement utilise exclusivement la catégorie déjà enregistrée :
transport → Transport ; visit/outing → Activité ; meal/rest/other → Autre. Aucun nom
de lieu ou texte libre n'est interprété pour deviner un hôtel. Un ancien hébergement
classé Autre le reste jusqu'à une action explicite dans son formulaire.
Aucune ancienne donnée n'est réécrite. Dexie V4 et ZIP format 1 inchangés ; champ
facultatif contrôlé à l'export/restauration. Pas de nouvelle migration.

## Lectures, interaction et hors connexion

`createTripLibraryReader` réalise un instantané transactionnel trips/activities/
activityDocuments cohérent, indexé par voyage puis activité, **sans ouvrir la table
des Blob**. Il se réactualise via useLiveQuery ; la consultation de cet espace
remplace celle du résumé, évitant une seconde lecture des activités dans l'accueil.
Recherche et filtres se calculent dans les données déjà reçues, sans autre requête.

La recherche par mots ignore casse et accents (titre, date/heure, lieu/adresse,
référence, prestataire, notes et noms de fichiers). Les filtres combinent type,
statut et présence de documents. Une recherche de nom de fichier retourne l'activité
et toutes ses pièces jointes, pas une copie de chaque réservation. Les critères
et la liste restent en place lors d'un aller-retour depuis une fiche/visionneuse.

« Voir l'activité d'origine » et « Modifier à la source » réutilisent les panneaux
existants et leur validation/persistance. Les notes et champs avancés ne sont pas
recréés dans un second formulaire. Après enregistrement, la fiche suit les données
IndexedDB ; annuler une édition directe revient à la liste. Les erreurs de lecture
ont un bouton Réessayer et ne sont pas présentées comme une liste vide.

« Ouvrir / télécharger » utilise DocumentViewer. La lecture d'un seul Blob, le
contrôle du parent/format/taille, le nom original et le téléchargement réutilisent
les API existantes. Les URL temporaires sont révoquées à la fermeture/changement/
démontage. Le défilement de fond est bloqué même sans fiche en arrière-plan, le
focus revient au bouton ou au filtre de secours. Images et PDF restent locaux ;
aucun service externe/CDN n'est ajouté. La prise en charge visuelle des PDF dépend
du lecteur natif du navigateur, avec message et téléchargement de repli existants.

Un fichier dont les métadonnées existent mais dont le Blob manque reste listé ; son
ouverture affiche l'erreur réelle, sans téléchargement trompeur. Il n'est pas possible
de constater cette absence sans lecture du Blob, volontairement différée. La suppression
de métadonnées ou d'une activité ferme le panneau devenu inaccessible. Les suppressions
existantes dans la fiche et les cascades sont conservées ; pas de nouveau bouton de
suppression dans l'espace central. Les octets ne sont ni transformés ni réenregistrés.

La liste, la recherche, les fiches et les fichiers déjà en IndexedDB restent disponibles
hors connexion. La duplication d'un voyage conserve son comportement existant : elle
ne copie ni activités ni leurs documents, et l'espace de la copie est donc vide.
Aucune fonction des étapes 2.9d/e n'est ajoutée.

## Tests

Depuis PowerShell dans roam-v2 :

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:pwa
npm.cmd run dev
```

Ouvrir `/tests/activities.html`. `tripLibrary.browser.tsx` utilise des bases isolées :
classement explicite/historique, absence de statut, recherche/filtres, lecture sans
Blob, isolation/doublons, fiche/édition source/annulation/réactivité, PDF/PNG/téléchargement
intact/URL révoquée, fichier manquant ou supprimé, duplication, ZIP/restauration et
refus d'un type invalide, 320/375/desktop et consultation offline. Les téléchargements
sont interceptés dans le test pour éviter de créer des fichiers utilisateur. La suite
antérieure complète vérifie aussi les quatre formats, signatures, quotas, cascades,
archives/corbeille, SHA-256, préparatifs, cartes, Budget et PWA.

À vérifier sur téléphone réel : ouverture depuis l'accueil et retour, clavier/recherche,
contrôles tactiles et PDF natif/zoom images, téléchargement dans le dossier de fichiers
de l'appareil, ouverture sans réseau après rechargement de la PWA. Classer un hôtel
comme Hébergement depuis la source, enregistrer, puis vérifier le groupe et les
informations inchangées. Modifier/supprimer un document d'essai depuis un autre onglet
et vérifier la réactivité. Tester un aller-retour ZIP sur des données d'essai.
