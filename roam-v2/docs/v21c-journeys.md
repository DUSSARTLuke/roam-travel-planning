# V2.1c — Déplacements autonomes dans le Programme

## Périmètre livré

Le Programme propose « Nouveau déplacement », même sans activité. Une section distincte affiche les déplacements autonomes de la journée sélectionnée ; les dates hors séjour ou absentes restent accessibles dans une liste dédiée. Les vues Jour, Calendrier et Multi-jours conservent leurs actions existantes. Dans Multi-jours, cette nouvelle section concerne la journée sélectionnée : aucune seconde copie du déplacement n'est créée dans les colonnes.

Le même panneau assure création et édition : titre facultatif (départ → arrivée par défaut), lieux libres nommés et adresse facultative, liaison facultative à une activité existante, dates et heures facultatives, mode, estimation, paiement, devise, réservation, notes et documents. Remplacer un lieu déjà saisi demande confirmation. Aucun enregistrement automatique, géocodage, horaire ou durée inventé. Une arrivée après minuit exige de choisir explicitement le jour suivant. Les dates/heures restent locales, sans déduction de fuseau ; les fuseaux des données importées sont conservés.

Les documents réutilisent l'import atomique, la liste, la visionneuse, le téléchargement et la suppression avec confirmation existants. Le propriétaire stocké est `journey`, sans fausse activité ni duplication du Blob. La lecture vérifie aussi taille et signature avant ouverture ; fichiers manquants/corrompus produisent une erreur explicite.

## Architecture et intégrité

- `src/db/journeys.ts` fournit le repository V6 partagé et une lecture réactive par voyage.
- `JourneyProgram.tsx`, `JourneyFormPanel.tsx`, `journeyFormModel.ts` et `journeys.css` séparent liste/fiche, formulaire et adaptation des champs.
- Les sauvegardes utilisent `saveWithDocuments` du repository V6 ; suppression et documents utilisent ses transactions et contrôles de révision. Double soumission bloquée ; erreur/conflit conserve les saisies et fichiers. Revenir sans enregistrer demande confirmation.
- Les anciens transferts gardent leurs écrans et l'adaptateur V2 → Journey. Les canoniques déjà projetés ne sont pas affichés/comptés une seconde fois. Les tests du pont vérifient la préservation des champs natifs et l'absence de résurrection.
- Budget et aperçu d'Accueil lisent également les journeys natifs : estimation et paiement restent distincts, sans assimilation absent/zéro ni double comptage avec les transferts projetés. Réutilisation des conversions existantes. Le partage financier natif reste persistant et validé par V6 ; cette étape n'ajoute pas d'éditeur de partage parallèle.
- La suppression confirmée d'un journey supprime ses documents et références financières selon les règles V6 ; les activités liées sont conservées. La suppression d'une activité conserve le dernier lieu du journey et son avertissement.
- Aucun changement de schéma Dexie V6, de ZIP2, de dépendance ou de déploiement. ZIP1 reste lisible. V2/Dexie V5 ne peut pas ouvrir une base migrée V6 : conserver les sauvegardes et le binaire compatible.

## Tests exécutés sur des données temporaires

- `npm run lint` : réussi, zéro erreur ; sept avertissements préexistants (regex, refs de focus, Date dans App).
- `npm run build` : réussi ; avertissement existant de taille des chunks.
- `npm run test:v21` : réussi, contrats/migrations simulées, dates/nuit, finances et absence de mutation.
- `npm run test:browser` et runner aux largeurs 320/375 : suite complète, bases isolées ; migrations réelles, journal/rollback, ZIP1/ZIP2, documents binaires et régressions existantes.
- `journeyInterface.browser.tsx` : CRUD libre sans activité/GPS/horaire/coût ; nuit refusée sans changement de date puis acceptée ; changement de jour ; liaison facultative avec confirmation ; montant zéro/virgule ; réservation ; import/ouverture/suppression de PNG ; Blob manquant/corrompu ; double clic ; conflit ; suppression de l'activité liée ; ZIP2/réouverture ; Budget rendu et absence de double comptage ; géométrie mobile.
- `npm run test:concurrency` : réussi, deux vrais onglets hors réseau, formulaires autonomes simultanés ; écriture obsolète refusée sans journal supplémentaire, titre récent et saisie locale conservés. Les scénarios V5/V6 et adaptateur restent réussis.
- `npm run test:pwa` : réussi, intégrité du précache de production et activation volontaire/multi-onglets.
- `npm run test:offline` : réussi, réseau réellement coupé par CDP ; création/édition/réouverture/suppression du déplacement depuis le build de production, ainsi que les parcours activité/document existants.

Commandes depuis `roam-v2/` sous PowerShell :

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:v21
npm.cmd run test:browser
node.exe tests/browser-suite.mjs 320
node.exe tests/browser-suite.mjs 375
npm.cmd run test:concurrency
npm.cmd run test:pwa
npm.cmd run test:offline
git diff --check -- roam-v2/
```

La dernière commande s'exécute depuis la racine du dépôt.

Une relance complète a détecté une assertion devenue obsolète dans le test Budget : elle exigeait l’ancien message excluant les paiements des déplacements. Le message et l’assertion sont désormais cohérents avec les journeys natifs ; les assertions numériques des totaux et du reste à payer sont conservées.

## Limites et contrôles physiques

Les déplacements à plusieurs étapes sont conservés et consultables, mais leur édition est désactivée jusqu'à V2.1d. Aucune intégration cartographique native supplémentaire. Les réservations et documents sont consultables dans la fiche du déplacement ; le centre de réservations existant reste orienté activités. La duplication de voyage reste celle de V2.1b.

Les tests responsive utilisent Chrome temporaire avec de vraies dimensions de viewport. Le clavier virtuel, les zones de sécurité du téléphone et le confort tactile physique restent à vérifier sur appareil réel ; aucune donnée personnelle n'a été ouverte ou modifiée.
