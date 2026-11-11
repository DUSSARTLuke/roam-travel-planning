# Roam V2.1 — Validation finale sauvegarde/restauration

## Verdict

**GO technique pour la sauvegarde/restauration sur le périmètre testé. Aucun blocage fonctionnel découvert.** Ce verdict ne déclenche ni n’autorise une publication. Les validations physiques Android déclarées par l’utilisateur sont conservées : déplacements 5/5, hébergements 6/6, budget 4/4, réservations/PDF 5/5.

Le code applicatif est identique, empreintes SHA-256 vérifiées, à la copie TEST physique **c5cade94b1b698cca92be2e6**. Aucun correctif applicatif, schéma Dexie ou format de sauvegarde n’a été changé pendant cette validation. Seuls des tests et ce rapport ont été ajoutés/modifiés.

## Scénario transversal ajouté

`tests/finalBackup.browser.ts`, exécuté par `tests/activities.browser.ts` et donc `/tests/activities.html` / `test:browser`, génère le voyage fictif complet de préparation Android par les repositories réels. Toutes les bases portent un nom UUID de test et tous les profils navigateur sont temporaires. Aucune donnée réelle ni origine publique ouverte.

Le scénario couvre :

- Export individuel ZIP2 d’un voyage avec cinq activités, deux déplacements dont un multi-étapes et un trajet de nuit, trois hébergements multi-nuits, réservations, paiements, participants/partages et taux manuel fictif.
- Restauration sur base vierge puis fermeture/réouverture. Comparaison complète des activités/déplacements/hébergements et du voyage hors projection de compatibilité dérivée ; identifiants, références d’étapes, dates/heures, GPS numériques, devise, montant zéro/absent, payé/estimé et exclusions conservés. Résultat du calcul budgétaire strictement identique.
- Trois fichiers (deux PDF et une image) : noms/MIME/tailles/dates/propriétaires typés identiques ; SHA-256 des Blob identiques, sans duplication.
- Réimport du même ZIP : voyage ignoré intégralement, toutes les tables et le journal inchangés.
- Interruption volontaire dans la transaction au stockage d’un Blob : rejet, aucune écriture partielle dans les entités, métadonnées, fichiers ou journal ; voyage sentinelle préexistant intact. Nouvelle tentative ensuite réussie.
- Corruption volontaire de l’archive : rejet pendant vérification, cible inchangée.
- Suppression de l’hôtel : tombstone, seul son document retiré, lien du déplacement marqué supprimé avec dernier lieu connu conservé. Réimport de l’ancienne archive sur cette base : aucune résurrection, aucune écriture.
- Suppression du déplacement : seul son document retiré, document d’activité préservé. Nouvel export/restauration avec tombstones, puis import répété : suppressions conservées et aucune écriture supplémentaire.
- ZIP1 générés avec schémas historiques V4 et V5, le second avec inventaire de filiation complet : import en V6, coordonnées/montants/activité et binaire conservés, aucun hébergement ou déplacement autonome inventé. Les migrations d’anciens transferts et références sont aussi couvertes par les suites existantes.

Les tests existants réexécutés complètent ce contrôle avec sauvegarde complète et individuelle, archives/corbeille, limites de fichiers, CRC/SHA, JSON/version/relations invalides, photos, montants, suppressions d’activités/voyages, migrations, collisions d’enfants et conflits réévalués juste avant l’écriture.

## Exécutions et résultats

| Contrôle | Résultat |
| --- | --- |
| Suite navigateur complète 375 px, nouveaux scénarios inclus | Réussie, « Tous les tests ont réussi » |
| Suite navigateur complète desktop 1100 px | Réussie, « Tous les tests ont réussi » |
| Contrats/simulations V4/V5→V6 et ZIP1→2, 1000 trajets | Réussis |
| Deux onglets réels : conflits, double clic, suppression, journal, hors réseau | Réussis |
| Build TypeScript/Vite | Réussi ; avertissement de taille des chunks existant |
| Lint | 0 erreur, 7 avertissements préexistants |
| PWA : intégrité/précache/exclusions/activation volontaire/multi-onglets | Réussie |
| SHA-256 des sources vs copie TEST Android | Identiques au build c5cade94b1b698cca92be2e6 |
| git diff --check -- roam-v2/ | Réussi |

Des premiers essais du nouveau test ont échoué à cause d’une faute de syntaxe, puis de fixtures ZIP1 incorrectes (inventaire vide ou absent pour V5). Le test et ses fixtures ont été corrigés ; les deux suites complètes ont ensuite été relancées avec succès. Le validateur applicatif a correctement refusé ces archives mal construites ; aucune validation n’a été assouplie.

Les journaux de cette exécution sont sous `node_modules/.tmp/final-backup-*.log` (fichiers temporaires, pas une sauvegarde durable). Les résultats PWA/contrats et la comparaison des empreintes sont aussi dans la sortie des commandes.

## Vérification Android résiduelle

Aucune nouvelle manipulation physique n’est indispensable pour les calculs d’intégrité ou les transactions : ils ont été automatisés. Le comportement du gestionnaire Android de téléchargement/sélection de fichiers et l’éviction du stockage par l’OS ne sont pas certifiés par Chrome desktop.

Si l’utilisateur souhaite vérifier le parcours matériel complet, procédure optionnelle limitée à TEST :

1. Dans **http://192.168.50.10:48622/** seulement, exporter le voyage fictif validé (pas un voyage réel). Conserver son ZIP dans Téléchargements, avec un nom TEST identifiable.
2. Ouvrir **un nouvel onglet de navigation privée Chrome Android**, puis **http://192.168.50.10:48622/wifi-test/**. Vérifier que la page indique une origine de test vierge ; si elle ne le fait pas, arrêter. Ne pas effacer la base du navigateur habituel.
3. Réserver cette session TEST, ouvrir Roam et importer uniquement le ZIP TEST téléchargé. Vérifier l’aperçu, confirmer explicitement, puis ouvrir un PDF et contrôler un hébergement, un trajet multi-étapes et leurs montants/GPS/dates. Réimporter : le voyage existant doit être ignoré sans doublon.
4. Fermer **tous les onglets privés** pour terminer la session isolée. Les données du navigateur normal restent inchangées. Le ZIP téléchargé peut rester sur l’appareil : supprimer seulement ce fichier TEST si inutile.

Si le téléphone interdit la navigation privée, le sélecteur de fichiers ou IndexedDB dans ce contexte, arrêter cette option. Ne pas remplacer cette isolation par un reset du profil normal. Aucun besoin de réimporter dans la V2 publique.

L’accès HTTP Wi-Fi ne prouve toujours pas l’installation PWA ni le démarrage hors connexion Android. Les contrôles automatisés de PWA restent distincts. Les ZIP ne sont pas chiffrés : ne pas les publier ni les committer.

## Risques et publication

- Une sauvegarde portant un ID de voyage déjà présent est ignorée intégralement ; elle ne fusionne pas des changements. Examiner l’aperçu, y compris le cas de Londres d’exemple.
- Une suppression locale/tombstone divergent ou une collision d’enfant est refusée ; aucun remappage ou écrasement automatique.
- ZIP2/Dexie V6 ne sont pas rétrocompatibles avec une application V2/Dexie V5. Ne pas tenter leur restauration avec l’ancien binaire ; une sauvegarde ZIP1 reste lisible par V2.1.
- Les fichiers sont stockés localement, pas synchronisés avec un cloud. Garder une copie de ZIP hors navigateur/appareil ; l’OS peut évincer son stockage.
- Avant publication, figer et approuver le nouvel artefact corrigé (il diffère du candidat f.1 original), puis suivre séparément la procédure de publication autorisée. Aucun changement de master/Pages, aucun commit/push/déploiement n’a été effectué ici.

> Exemples portables : `192.168.50.10` est une adresse LAN fictive à remplacer par celle affichée par le serveur ; `C:\Projets\roam-travel-planning` est un chemin d’exemple. `%USERPROFILE%` désigne le profil Windows courant.
