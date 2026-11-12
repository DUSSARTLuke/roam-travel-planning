# Roam V2.1.1 — Rapport de phase B1

Date : 12 novembre 2026. Branche : `develop-v2`. Référence de phase A : `d94d0ae7ca1e95d78b80cd9fbaa14a0af21c041a`.

Statut : implémentation locale de B1 pour validation. Aucun commit, push ou déploiement. Aucun accès aux données réelles ; aucune dépendance, infrastructure, clé ou API de routage ajoutée. B2, les alertes avancées B3 et la visualisation B4 restent hors périmètre.

## 1. Vérification préalable de cohérence

L'[étude technique](v211-phase-b-routing-study.md) a été relue avant modification, ainsi que les modèles, repositories, projections historiques, calculs de budget et vues du Programme. Aucune contradiction majeure n'a été trouvée. Deux précisions ont été communiquées avant développement :

- Réutiliser les Journey canoniques, sans nouvelle table de transports. Les liaisons du Programme doivent être exclues explicitement du budget pour ne pas produire des lignes de dépenses incomplètes.
- La synchronisation du projet est un journal local préparant une future réplication ; il n'existe pas encore de synchronisation distante opérationnelle. B1 utilise ce journal sans ajouter de service distant.

Pour les activités sans horaire, B1 propose l'ordre déjà affiché/manuellement réorganisé, avec la mention « Ordre à confirmer ». Il ne transforme pas cet ordre en chronologie certaine.

## 2. Architecture retenue

Les chemins suivants sont relatifs à `roam-v2/`.

| Élément | Rôle |
| --- | --- |
| `src/routing/activityConnections.ts` | Fonctions pures : successions par voyageur/date, regroupement des paires, rapprochement des trajets existants, liaisons à vérifier, URL externe |
| `src/evolution/v21/contracts.ts` | Champs facultatifs sur Journey/segments et validations |
| `src/evolution/v21/repository.ts` | Enregistrement canonique, revalidation du programme dans la transaction, appartenance des voyageurs, absence de doublon, CAS |
| `src/evolution/v21/graph.ts` | Validation des nouveaux champs et références voyageurs dans le graphe exporté/restauré |
| `src/components/program/ActivityConnections.tsx` | Présentation compacte après les activités, propositions volontaires, formulaire, confirmation de suppression et section à vérifier |
| `src/components/program/connectionContext.ts` | Partage de l'état d'affichage et suppression des doublons visuels avec les cartes historiques/autonomes |
| `src/components/program/activity-connections.css` | Styles Dark Premium utilisant les variables existantes, retour à la ligne et cibles tactiles de 44 px |
| `TripProgram`, `JourneyProgram`, `JourneyFormPanel`, `TransferCard` | Intégration aux vues et accès conservé aux fiches complètes des transports réutilisés |
| `src/db/expenseSharing.ts` | Suppression atomique d'un voyageur dans activités, trajets et voyage ; protection des partages existants |
| `src/db/transfers.ts` | Compatibilité de l'ancien formulaire, refus de nouvelles liaisons sans participants communs ou dupliquant une liaison B1 |
| `src/money/tripBudget.ts`, `src/evolution/v21/financial.ts`, `ExpenseSharing` | Exclusion explicite des nouvelles liaisons de l'univers des dépenses |

### Contrat de données

Journey conserve ses identifiants, timestamps, étapes, réservations, documents, provenance legacy et révisions de synchronisation. Ajouts facultatifs :

```ts
Journey.participantIds?: string[]
Journey.purpose?: 'activity-connection'
JourneySegment.distanceMeters?: number
JourneySegment.safetyMarginMinutes?: number
JourneySegment.durationSource?: 'manual' | 'automatic'
```

`JourneySegment.durationMinutes` reste la durée effective en minutes. B1 écrit toujours une origine `manual` lors de la saisie ; `automatic` est uniquement prévu dans le contrat pour une phase ultérieure. Aucun calcul automatique n'est implémenté. Une durée historique sans origine reste interprétée comme manuelle, sans réécriture.

Les références de départ/arrivée utilisent les liens activité existants des étapes ; leurs instantanés conservent les lieux connus. Les nouvelles liaisons B1 ont deux étapes et un segment, sans réservation ni montant. `purpose` distingue leur usage sans dupliquer le modèle de transport ; il ne peut pas être modifié silencieusement après création.

Les distances et marges sont finies et positives ou nulles. L'interface saisit la distance en kilomètres et la stocke en mètres ; les décimales avec point ou virgule sont acceptées. La durée est obligatoire uniquement si l'utilisateur décide d'enregistrer une liaison B1. Aucune liaison n'est obligatoire dans un voyage.

## 3. Comportement fonctionnel

### Programmes individuels et mutualisation

- Le calcul pur lit les voyageurs existants et les activités ; il n'écrit aucun déplacement.
- Pour chaque voyageur et journée, il reprend les activités auxquelles il participe et détermine les paires successives. Les idées sans date sont exclues.
- Les activités exactes sont ordonnées par heure ; les activités à organiser suivent l'ordre existant et portent un avertissement d'incertitude. Un chevauchement ou un même début sur une même piste empêche une proposition ambiguë.
- Les activités simultanées de voyageurs différents ne se bloquent pas mutuellement.
- Une paire identique est regroupée pour ses voyageurs communs. L'utilisateur peut la conserver groupée ou choisir un sous-groupe ; les autres voyageurs peuvent enregistrer un autre déplacement, une autre durée ou un autre mode.
- Aucune proposition ne traverse deux dates. Aucune nouvelle liaison ne peut être enregistrée entre deux activités sans participants communs.
- Activité collective historique : règle de phase A conservée. Sans voyageurs nommés, une piste collective existe seulement en mémoire ; aucune personne n'est créée. Une liste vide explicite ne devient jamais collective.

Exemple : A collective, B Alice, C Bob simultanée à B, D collective. Les propositions suivent A→B→D pour Alice et A→C→D pour Bob, sans B→C.

### Interface

Dans les vues Jour et Multi-jours, une proposition discrète « Ajouter une liaison vers… » apparaît sous l'activité de départ. L'enregistrement ouvre un formulaire pour le mode, la durée, la marge, la distance et les voyageurs concernés. Aucun champ supplémentaire n'est ajouté aux cartes d'activité elles-mêmes.

Une liaison enregistrée affiche mode, durée manuelle, marge/distance renseignées et voyageurs. La vue Tous affiche une seule carte par trajet enregistré ; des trajets distincts pour des sous-groupes restent distincts. Le filtre voyageur masque les liaisons des autres voyageurs.

Modification et suppression utilisent les protections existantes : version attendue, verrou contre le double envoi, conservation de la saisie sur erreur, blocage de mise à jour/rechargement pendant une saisie, confirmation d'abandon et confirmation de suppression.

Un transport canonique existant correspondant est réutilisé plutôt que recréé. La présentation compacte remplace son affichage redondant. Le bouton « Fiche complète » conserve l'accès aux réservations, coûts, documents et au formulaire original ; les trajets multi-étapes passent par leur fiche/formulaire existants. Modifier la durée compacte d'un ancien transfert préserve sa provenance, ses montants et ses autres données.

### Changements et suppressions

Changer un horaire, l'ordre, la date ou les participants recalcule les propositions sans déplacer ni effacer les transports enregistrés. Un changement d'adresse/GPS d'une nouvelle liaison B1 est également détecté. Une liaison devenue incohérente rejoint « Liaisons à vérifier », avec durée conservée ; un enregistrement explicite permet de confirmer ses lieux actuels. Une modification commencée sur un ancien programme est refusée à l'enregistrement si les conditions ont changé ; la saisie reste visible.

Supprimer un voyageur retire ses références explicites des activités et des Journey dans la même transaction que la modification du voyage. Si le dernier participant disparaît, la liste reste vide. Le refus de suppression d'un voyageur utilisé par un partage de dépense reste actif.

Supprimer une activité conserve le Journey et son dernier lieu connu, avec lien marqué supprimé, conformément au modèle V2.1. La durée reste disponible dans les liaisons à vérifier. Supprimer explicitement un déplacement utilise le repository existant, ses cascades documentaires/partages et son tombstone.

### Modes et lien externe

Marche, vélo, voiture, taxi/VTC, transports en commun, train, avion et autre acceptent une durée manuelle. Le mode `transit` est ajouté ; bus, métro, tramway et bateau historiques restent disponibles : 12 modes au total.

Si chaque extrémité possède un GPS ou une adresse exploitable, un simple lien « Itinéraire externe » est proposé pour les modes compatibles. C'est une ouverture volontaire vers Google Maps, sans requête, intégration ni préchargement par Roam. Pour avion/bateau/autre ou lieux insuffisants, le lien est omis. La consultation du service externe nécessite naturellement une connexion ; toutes les opérations B1 restent possibles sans ce lien.

## 4. Budget, cartes, réservations et synchronisation

- Les nouvelles liaisons `activity-connection` sont exclues du budget et des sources de partage ; le modèle refuse d'y inscrire automatiquement des montants ou réservations. Aucun faux zéro monétaire n'est créé.
- Les anciens transports gardent leur traitement financier et leurs réservations. La saisie B1 ne les recopie pas.
- Aucune visualisation B4 n'est ajoutée. Les nouvelles liaisons sont exclues de la projection cartographique ; l'ajout du mode transit dans les couleurs/icônes conserve seulement la compatibilité des listes de modes existantes.
- La marge est stockée et affichée, sans nouvelle alerte avancée de faisabilité. Les alertes déjà présentes avant B1 restent en place.
- Journey demeure une entité suivie par le journal local existant : identité, révision, opération, groupe transactionnel et suppression. Aucun protocole ou backend supplémentaire n'est introduit.

## 5. Migrations et compatibilité

**Aucune migration physique ni changement de version Dexie.** Les champs sont facultatifs, sans nouvel index ni table. Aucune transformation des voyages historiques n'est exécutée à l'ouverture.

ZIP1 V4/V5 reste importable avec migration V6 existante et conservation de la durée historique. ZIP2 conserve les nouveaux champs, les participants, les instantanés et la filiation des Journey. Une ancienne exportation ZIP1 n'est pas présentée comme capable de représenter les nouvelles données natives : les exports courants de V6 restent ZIP2.

La compatibilité ascendante des anciens voyages est vérifiée ; ouvrir les nouveaux modes avec une ancienne version de Roam n'est pas une garantie de compatibilité descendante. Les utilisateurs doivent garder une version capable de lire les données exportées.

## 6. Tests et résultats

Toutes les exécutions utilisent exclusivement des données fictives et des profils Chrome temporaires. Les tests de modules créent des bases `roam-v2-test-*`, supprimées dans leurs blocs de nettoyage. Les tests du build utilisent la base habituelle de l'application uniquement à l'intérieur de leur profil temporaire isolé.

Commandes exécutées depuis la racine :

```text
npm.cmd run build --prefix roam-v2
npm.cmd run lint --prefix roam-v2
npm.cmd run test:v21 --prefix roam-v2
npm.cmd run test:browser --prefix roam-v2 -- 320
npm.cmd run test:browser --prefix roam-v2 -- 375
npm.cmd run test:browser --prefix roam-v2 -- 1100
npm.cmd run test:concurrency --prefix roam-v2
npm.cmd run test:offline --prefix roam-v2
npm.cmd run test:pwa --prefix roam-v2
npm.cmd run test:publication --prefix roam-v2 -- --artifact=dist
```

**Toutes ces commandes ont réussi.** Les suites complètes de la dernière passe navigateur ont terminé avec succès à 320, 375 et 1100 px. Le cycle B1 du build a également réussi avec le réseau réellement coupé. Lint : sept avertissements préexistants, aucun nouvel avertissement ; le build conserve son avertissement sur la taille des bundles.

### Tests B1 ajoutés

- `tests/activityConnections.core.ts`, exécuté par la suite de modèles et la suite navigateur : collectifs/individuels, simultanéité, divergence/convergence, absence de voyageurs nommés, liste vide, absence de lieu, GPS zéro, ordre manuel incertain et réorganisation, mutualisation, changement/suppression d'activité, absence de liaison inter-journées et construction du lien externe.
- `tests/activityConnections.browser.tsx` : vraie UI de création/édition/suppression, réutilisation d'un transfert existant, accès à sa fiche complète, choix de sous-groupes, durées différentes, filtre, virgule/marge/distance, refus de doublon et d'entrées invalides, CAS, rollback sans journal résiduel, rechargement, ZIP1/ZIP2, réorganisation persistée, suppression de voyageur atomique avec rollback forcé, activité déplacée/supprimée et tombstone. Une interception de fetch vérifie zéro appel réseau pendant le cycle B1.
- `tests/production-offline.mjs` : cycle B1 via le véritable build et son service worker, **réseau Chrome réellement coupé** : deux activités collectives sans lieu/horaire, durée et marge, modification, redémarrage hors ligne et suppression via les formulaires.

### Régressions existantes

Les suites générales incluent la phase A, les conflits et filtres, les migrations historiques jusqu'à V6, le volume de données, les ZIP1/ZIP2, l'intégrité documentaire SHA-256, le journal local et ses rollbacks, les révisions entre connexions, les déplacements autonomes/multi-étapes, les hébergements, les budgets et les autres espaces validés.

Les tests multi-onglets vérifient des conflits réels et la conservation des saisies/fichiers. Les tests PWA vérifient le précache et les exclusions, puis le démarrage et la persistance hors ligne. La suite de publication **simule localement** les changements V1/V2 et les scopes sous chemin ; elle ne publie rien et n'écrit pas sur GitHub.

Les largeurs sont simulées dans Chrome headless ; aucun essai physique sur téléphone n'est revendiqué.

## 7. Limitations restantes

- Aucun calcul de route/durée/distance par API ; tout est manuel. Le contrat automatic prépare seulement la suite.
- Aucune alerte B3 prenant en compte marge/temps de trajet ; aucune route dessinée B4.
- Les successions sans horaire restent incertaines et demandent confirmation humaine. Les activités en conflit sur une piste ne produisent pas de proposition arbitraire.
- La mutualisation s'applique aux références exactes de départ/arrivée et aux voyageurs, pas à des lieux supposés identiques à partir de leur nom.
- Les nouvelles liaisons B1 relient deux activités de la même journée. Les transports autonomes, nuits, lieux libres et multi-étapes restent gérés par les fonctions existantes ; B1 ne les simplifie pas.
- Une liaison dont les activités ne se suivent plus doit être vérifiée, corrigée quand une paire valide subsiste, ou supprimée/recréée volontairement. Les durées ne sont pas transférées vers une nouvelle paire par déduction.
- Aucune synchronisation distante n'est activée ; le journal et les sauvegardes restent le mécanisme local disponible.

## 8. Recommandations pour B2

Après validation de B1, introduire un adaptateur séparé et injectable pour ORS, avec cache reconstructible, déduplication, annulation et contrôle d'obsolescence des coordonnées/options. Garder la durée manuelle prioritaire et demander une action explicite avant d'appliquer une estimation.

Valider séparément le relais gratuit et sa protection avant tout appel authentifié : aucune clé privée dans le frontend, quotas bloquants, droits de conservation et attribution. Ne pas mélanger le cache API avec le journal/ZIP. Commencer par marche/vélo/voiture et différer les horaires TC à un lot spécifique.

**Attendre la validation de B1 avant B2. Aucun commit sans validation utilisateur.**
