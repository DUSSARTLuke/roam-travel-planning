# Rapport de stabilisation — Roam V2, 9 novembre 2026

Branche : develop-v2. Cible : utilisation locale pendant le séjour à Paris.
Aucune connexion Supabase, aucune modification de synchronisation distante,
aucune migration supplémentaire : Dexie V5 et ZIP format 1 conservés.

## Verdict

**NON PRÊT pour un départ sans vérification du téléphone réel.**

Le **candidat applicatif est stabilisé et tous les contrôles automatisés finaux sont
réussis** ; aucun blocage n’est encore reproduit sur le périmètre testé. Le verdict
terrain reste NON PRÊT uniquement tant que l’installation réellement emportée n’a pas
été confirmée à jour et autonome en mode avion, avec ses billets lisibles. Ce contrôle
physique ne peut pas être réalisé depuis cet environnement. Aucun déploiement n’a été
fait et ce rapport ne prétend pas que le téléphone utilise déjà le nouveau build.

Si le téléphone utilise encore le serveur de développement HTTP 192.168…:5173, ne pas
compter dessus à Paris : l’application doit disposer de son installation de production
et de ses ressources hors ligne. L’enregistrement SW du projet exige un contexte sûr.
La stabilité du code ne remplace pas la validation de cette installation réelle.

## Anomalies corrigées

1. Écrasement silencieux entre deux éditions d’activité : reproduit en échec avant
   correction dans deux onglets réels. Contrôle transactionnel de la révision et de
   l’identité d’ouverture ; refus sans écriture partielle ni ajout au journal.
2. Ancienne fusion implicite de champs lors de la construction de l’input : retirée.
   Le rechargement est explicite et conserve des copies lisibles de la saisie, ainsi
   que les nouveaux fichiers sélectionnés. Aucune réapplication automatique.
3. Risque de perte de brouillon si l’activité est supprimée pendant l’édition : les
   parents conservent l’instantané d’édition ; le repository refuse sa résurrection.
4. Attentes des formulaires Horaire/Déplacer et Déplacement : figées à l’ouverture,
   indépendamment de futures props réactives ; leurs CAS ciblés restent au repository.
5. Cohérence d’accès : les écritures d’activités/documents d’un voyage archivé sont
   refusées, comme celles d’un voyage à la corbeille ; lectures existantes préservées.
6. Tests historiques adaptés au contrat strict : les scénarios d’édition normale
   utilisent leur instantané récent ; les assertions de fusion automatique sont
   remplacées par des assertions de refus de version obsolète. Les assertions de
   validation métier, rollback, isolation et intégrité n’ont pas été supprimées.

Détails et audit des autres formulaires : [local-sync.md](local-sync.md#210b2--éditions-concurrentes-des-activités).

## Périmètre des contrôles

- Voyages : création/modification, duplication, archives/corbeille, cascades et isolation.
- Programme : dates locales, Jour/Calendrier/Multi-jours, tri, horaires, périodes libres,
  alertes, organisation rapide, transferts et suppression d’activité.
- Mode voyage : journée, prochaine activité réelle, réservations/documents et navigation.
- Documents : formats, limites, lecture à la demande, erreurs/manquants, intégrité binaire,
  suppression/cascade et conservation des fichiers non concernés.
- Budget : synthèse/catégories/journées/partages/prévisionnel, conversions, zéro/absent,
  absence de double comptage, devises/taux manquants, réactivité.
- Préparatifs et Infos pratiques : CRUD, validation, progression, dates, isolation et ZIP.
- Cartes : interactions, filtres, transferts, alternatives offline, responsive, moteur et
  fournisseurs simulés ; pas d’API de trajet ni de cache massif de tuiles ajouté.

## Méthode de sécurité des tests

Bases IndexedDB préfixées roam-v2-test-* et profils Chrome temporaires. Le test de
production utilise la base normale de l’application **dans un profil temporaire et
sur une origine locale à port aléatoire**, jamais dans le navigateur de l’utilisateur.
Aucun voyage personnel lu, modifié ou supprimé. Les PDF volumineux sont des fixtures
binaires identifiables, pas des billets réels. Aucun commit, push ou déploiement.

## Résultats finaux exécutés

- Build : réussi ; avertissement connu de taille des bundles.
- Lint : zéro erreur, sept avertissements préexistants, aucune règle désactivée.
- Tests PWA : précache/intégrité, sous-chemin, exclusions et protocole d’activation volontaire réussis.
- Deux onglets réels : tous les scénarios A/B et formulaires réussis.
- Production avec réseau Chrome réellement désactivé : démarrage depuis le SW,
  création avec image, modification avec contrôle de révision, fermeture/réouverture
  de page, lecture de l’image et suppression persistée réussis.
- Migration volumineuse : 300 activités et 31 PDF fictifs totalisant 45 Mio, dont un
  fichier à la limite de 15 Mio ; budget, contacts, préparatifs, transferts et réservations
  conservés ; ZIP V4 produit avant migration puis restauré, nouveau ZIP V5 restauré,
  SHA-256 des binaires identiques et identité stable après réouverture.
- Suite navigateur complète desktop : **réussie** sur le candidat final.
- Suite navigateur complète 320 px : **réussie** sur un profil temporaire distinct.
- Suite navigateur complète 375 px : **réussie** sur un profil temporaire distinct.
- `git diff --check -- roam-v2/` : **réussi**.
- Tests finaux en échec : **aucun**. Les échecs initiaux de concurrence ont été
  reproduits avant correction ; tous les tests ont été relancés ensuite.
- Non exécutés : essais sur le téléphone physique de l’utilisateur, rendu de ses
  billets/QR réels et contraintes de son OS. Les fournisseurs réseau externes sont
  simulés dans les tests ; leur disponibilité pendant le séjour n’est pas garantie.

## Risques et limites maintenus

- **Pas de synchronisation PC ↔ téléphone**. Chaque installation conserve sa base ;
  ZIP reste le moyen de transfert, avec aperçu et sans écrasement des voyages existants.
- Les anciens clients applicatifs doivent être fermés/mis à jour. Leur ancien repository
  n’acquiert pas le nouveau CAS par magie. Appliquer la mise à jour PWA volontaire avant
  le départ ; un vieux SW peut continuer à servir l’ancienne application.
- Stockage du navigateur soumis à quota/éviction ; le journal V5 augmente son usage.
  Aucun test ne garantit les limites mémoire d’un téléphone physique particulier.
  Garder une sauvegarde hors du navigateur ; aucun reset n’est nécessaire pour tester.
- Les nouveaux ZIP V5 ne sont pas lisibles par un ancien lecteur limité à V4. Les
  anciens ZIP V4 restent lisibles par cette version. ZIP non chiffré.
- Horaires fondés sur le fuseau de l’appareil, sans fuseau propre au voyage. Paris et
  appareil en Europe/Paris donnent les repères attendus, pas une conversion UTC inventée.
- Cartographie et recherche/taux en ligne peuvent être indisponibles ; les listes et
  derniers taux locaux restent accessibles. Pas de promesse de tuiles offline.
- Les PDF natifs dépendent du navigateur ; les tests valident Blob/intégrité/intégration
  et repli, pas la lisibilité d’un vrai QR code dans le lecteur PDF de chaque téléphone.
- Brouillons en mémoire conservés pendant les conflits ; un arrêt forcé, une fermeture
  confirmée ou un crash du navigateur ne les sauvegarde pas automatiquement.

## Vérifications uniquement réalisables sur le téléphone concerné

1. Depuis la PWA réellement installée et à jour, couper le réseau, la fermer puis la
   relancer : retrouver le voyage, les activités et le Mode voyage.
2. Ouvrir un billet/PDF réel déjà stocké, vérifier la netteté du QR et le téléchargement
   local de repli si le lecteur natif ne l’affiche pas.
3. Vérifier le confort tactile, le clavier et les zones de sécurité avec le navigateur
   et les réglages d’accessibilité propres à l’appareil. Aucun reset ni suppression
   de données personnelles demandé.

Il n’est pas demandé à l’utilisateur de relancer les tests automatisables.

## Fichiers du correctif 2.10b.2 / stabilisation

- `src/db/activityRevision.ts`, `activities.ts`, `documents.ts` : instantanés versionnés,
  contrôle atomique, erreur de conflit identifiable et accès en écriture cohérent.
- `ActivityFormPanel.tsx`, `activityFormModel.ts`, `activityDraft.ts` : baseline d’ouverture,
  aucun mélange automatique, rechargement explicite et copie de saisie.
- `useActivityEditSnapshot.ts` et points d’accès Programme/Carte/Accueil/Mode voyage/
  Réservations/Infos pratiques : brouillon conservé malgré une disparition réactive.
- `ActivityOrganization.tsx`, `TransferFormPanel.tsx` : attentes figées à l’ouverture.
- `ActivityDocuments.tsx` : dépendance de lecture injectable pour les bases de test,
  comportement de production conservé.
- `tests/concurrent-activity.html`, `concurrentActivity.fixture.tsx`, `concurrent-tabs.mjs` :
  vraie concurrence de deux onglets et formulaires sur données fictives uniquement.
- `tests/volumeMigration.browser.ts`, `production-offline.mjs`, tests existants adaptés :
  volume, compatibilité, réseau réellement désactivé et nouvelle exigence de révision.
- `package.json` : scripts test:concurrency et test:offline, aucune dépendance ajoutée.
- Documentation : présent rapport et complément `docs/local-sync.md`.

Les modifications V5/ZIP/suppression déjà présentes avant cette stabilisation ont été
conservées et retestées. Aucun schéma Dexie ni format ZIP n’a été modifié dans ce correctif.

Commandes effectivement exécutées avec Node Windows depuis WSL : build, lint,
test:pwa, test:concurrency, test:offline et lanceurs navigateur desktop/320/375.
Les profils et bases de test sont supprimés en fin d’exécution ; aucun nettoyage ne
vise le profil personnel. Aucune installation de dépendance, aucun commit ni push.
