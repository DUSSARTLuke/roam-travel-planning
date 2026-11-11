# Roam V2.1 — Release candidate finale, 11 novembre 2026

## Verdict et identité

**GO technique pour présenter le candidat final à validation avant publication. Aucune publication autorisée ou effectuée.** La mise en ligne reste conditionnée à une autorisation explicite, aux sauvegardes réelles préalables et à la vérification des paramètres Pages au moment de publier.

- Candidat retenu : **Roam-V2.1-RC-8b9601f3770e**.
- Empreinte SHA-256 des 284 entrées source/tests/outils figées : `8b9601f3770e6dfc388c2c64c8acee5fda01eada06fdc6dcb07a103cf2059d50`.
- Build de précache production : `1f97b9f3a594048e523d9ef6`.
- Empreinte de l’inventaire des 20 fichiers du site : `2187c520883709abe62b24d40c38cd6aa8a867fd586df485b68c9cb0e7e3cc3f`.
- **SHA-256 du ZIP du site : `c20b3ab15a0c409d191e9a6b910c8d8f51f5979cdaba525a6d24b09ae234d273`.**
- Dossier durable hors dépôt : `%USERPROFILE%\Roam-release-candidates\Roam-V2.1-RC-8b9601f3770e\`.
- Site prêt à publier, uniquement après autorisation : sous-dossier `site/` ou archive `Roam-V2.1-RC-8b9601f3770e-site.zip`.

Inventaire public anonymisé : [`examples/v21-final-rc.portable.json`](examples/v21-final-rc.portable.json). Le manifeste exécutable original `docs/v21-final-rc.json` reste local, ignoré par Git et conservé comme `candidate.json` avec les artefacts durables ; l’exemple à variables symboliques ne le remplace pas pour le vérificateur. Archives distinctes : code source/tests du candidat, ressources publiques V2 de référence, code source V2 exact depuis son commit historique. Les archives ne contiennent aucune donnée utilisateur, ZIP personnel, base IndexedDB, profil Chrome ou dépendance node_modules. Le site ne contient aucun outil TEST, fixture, test navigateur ou document fictif.

Les candidats techniques intermédiaires `c57f1a190147` et `baa8c424c91c`, laissés dans leurs dossiers séparés, sont **supplantés**. Ne pas les publier. Le candidat f.1 original et la copie TEST Android restent eux aussi distincts : le présent candidat inclut tous les correctifs validés depuis f.1.

## Référence publique et état Git

L’URL publique a été lue uniquement pour ses ressources statiques, sans ouvrir de navigateur/profil utilisateur :

- `release-info.json` annonce le commit **65857661eba878a6636362cf061ceff1e2f1591e**.
- Précache public observé : **a2eab14b8e4e68e863d6322a** ; chaque fichier précaché capturé a été vérifié contre son SHA-256.
- La propriété historique `published: false` de ce fichier de métadonnées est obsolète : les réponses HTTP publiques réelles constituent l’observation, pas ce booléen.

Branche locale : **develop-v2**, HEAD **934331cdb06163585af1103099efa0e778336dd7** ; V2.1 est encore constituée de modifications non commitées. HEAD seul ne décrit donc pas ce candidat : son identité est l’inventaire SHA-256 figé et les archives de sources. Master reste **e7a98ce443bdacd398097631893a8707c142fddd**. Aucun fetch/push, merge, commit ou changement de branche de publication.

Audit détaillé : [`release/git-audit.json`](release/git-audit.json), incluant fichiers versionnés modifiés par rapport au commit public et fichiers V2 non suivis. Les sources non suivies indispensables (repositories V6, hébergements, formulaires, carte, tests) sont bien incluses dans le snapshot du candidat ; un simple git diff ne les aurait pas sauvegardées.

Changements hors V2 constatés avant cette mission et exclus du candidat : `.gitignore`, `README.md`, `manifest.webmanifest`, et les README/manifeste du dossier historique `roam_travel_planner/roam_travel_planner/`. Aucune normalisation de ces fichiers n’a été effectuée. Les avertissements de conversion LF/CRLF de Git n’ont pas entraîné de réécriture ; les archives et vérifications utilisent les octets réels.

## Correctifs inclus et compatibilité

| Domaine | Éléments présents et contrôlés |
| --- | --- |
| Déplacements | Journeys canoniques V6, étapes stables, modes/durées par segment, lieux libres, nuit, références facultatives, pont transactionnel des anciens transferts, protections anti-résurrection |
| Hébergements | Table autonome, périodes/nuits/check-in-out, chevauchements, réservations/documents, marqueur spécifique, budget une fois et ancienne activité conservée |
| Géolocalisation | Recherche Photon partagée activités/déplacements/hébergements, confirmation de remplacement, GPS numériques, repli manuel offline, explication des lieux sans GPS |
| Programme/Carte | Jour/calendrier/Multi-jours, étapes et hébergements, filtres/périodes, marqueurs et segments schématiques, caméra/sélection, listes hors réseau |
| Budget | Estimé/payé/absent/zéro, devises/taux et priorités, exclusions explicites, partages et références financières historiques sans double comptage |
| Réservations/documents | Bibliothèque commune, propriétaires typés, consultation/téléchargement, cascades ciblées, intégrité des Blob |
| Sauvegardes | ZIP2 complet/individuel, lecture ZIP1 V4/V5, validation stricte, refus des collisions, import atomique, répétition, tombstones |
| Concurrence | Révisions transactionnelles, refus des formulaires obsolètes, journal V6, opérations V5 gelées |

Décision V2.1 conservée : la duplication des voyages n’a pas été étendue à une duplication exhaustive des activités, documents, journeys et hébergements. Ce n’est pas un mécanisme de sauvegarde.

## Tests de l’état final

Les suites utilisent des bases UUID et profils Chrome temporaires. Les tests physiques Android 20/20 sont ceux validés par l’utilisateur ; ils ne sont pas présentés comme nouvellement exécutés par Codex.

| Contrôle | Résultat |
| --- | --- |
| Build TypeScript/Vite au base path /roam-travel-planning/ | Réussi ; avertissement de gros chunks existant |
| Lint | 0 erreur, 7 avertissements préexistants |
| Suites navigateur complètes 320, 375 et 1100 px | Réussies |
| Sauvegarde transversale ZIP2, ZIP1, SHA-256, interruption/répétition/suppressions | Réussie dans les suites complètes |
| Deux onglets réels et conflits hors connexion | Réussis |
| Contrats et simulations V4/V5→V6 / ZIP1→2 | Réussis |
| PWA, intégrité de tous les assets précachés du candidat exact | Réussie |
| Rendu MapLibre réel avec tuiles simulées | Réussi à 375 px |
| Mise à jour production V2 publique → candidat exact | Réussie, profil temporaire |
| Production hors connexion, CRUD activités/journeys/hébergements et documents | Réussie au vrai sous-chemin |
| Transition historique V1, nouvelle génération de worker, formulaire non enregistré, bannière/Plus tard/activation | Réussie sur candidat exact |
| Empreintes sources, deux copies du site et trois archives du candidat | Vérifiées par verify-final-rc.mjs |
| git diff --check -- roam-v2/ | Réussi |

Deux ajustements des outils, sans changement applicatif : attente de disponibilité du serveur preview avec le slash du sous-chemin ; retrait d’un import inutilisé du script de scellement. La première assertion du nouveau test de migration supposait un renommage automatique du partage `transfer` en `journey` ; l’architecture conserve volontairement cet alias historique et le résout vers le journey canonique. L’assertion vérifie désormais la conservation exacte du partage et son ID legacy, sans réduire la protection contre le double comptage. Tests relancés après correction.

Résultats détaillés : `release/transition-results.json`, `release/grace-results.json`, et journaux `node_modules/.tmp/rc-*.log`, copiés dans le sous-dossier durable `evidence/` après les exécutions. Ces résultats documentaires ne changent pas le build.

## Simulation V2 → V2.1

`tests/release-transition.mjs` sert d’abord les vrais octets V2 capturés depuis l’URL publique, puis ceux du candidat, à la même origine temporaire et au même scope **/roam-travel-planning/**. Aucun serveur public n’est modifié.

1. Installation du vrai worker V2, ouverture effective d’IndexedDB V5, ajout de voyages actif/archivé fictifs, activités avec GPS zéro/négatifs/±180 et idée sans date, PDF binaire de 1 Mio, ancien transfert payé, partage, préparatif, contact et journal V5.
2. Worker V2.1 installé en attente. « Plus tard » laisse V2 et V5 actifs, sans migration forcée.
3. « Mettre à jour » déclenche la migration réelle vers V6. Voyages, activités, dates, GPS, contacts/préparatifs/budget, identités de synchronisation et SHA-256 du PDF restent conservés. Un seul journey est créé depuis le transfert ; ses montants et le partage historique sont préservés. Les opérations V5 sont marquées superseded, seules les opérations V6 restent rejouables.
4. Réouverture : aucun doublon, aucune répétition de la migration ou du journal. Réseau coupé : démarrage du build exact et données/PDF conservés au sous-chemin.
5. Tentative isolée d’ouverture du schéma V5 après V6 : **VersionError attendue**. Aucune tentative de downgrade, suppression de base ou purge.

L’artefact garde aussi les anciens fichiers JS/CSS de V2 et ses ressources MapLibre différées à leurs noms hashés d’origine. Ils ne modifient pas le précache V2.1 ; leur conservation réduit les erreurs de chargement des vieux onglets reportant la mise à jour. Ne pas retirer ces fichiers pendant la fenêtre de transition.

## Sauvegardes préalables et retour arrière

Avant toute bascule, après autorisation :

- Exporter un **ZIP1 complet depuis la V2 actuelle**, sur chaque appareil/origine réellement utilisé. Les données ne sont pas partagées entre téléphone/PC ou entre localhost/LAN/Pages. Garder plusieurs copies hors navigateur et hors dépôt ; examiner les compteurs et calculer le SHA-256 des fichiers si utile.
- Conserver le candidat, ses sources, le commit/source V2, les artefacts publics et la configuration Pages d’avant bascule. Un backup de code n’est pas une sauvegarde des données.
- Prévenir que les ZIP sont non chiffrés. Les données TEST ne doivent pas remplacer un export réel et aucun fichier personnel ne rejoint la branche publique.

**Avant toute migration V6**, revenir au site V2 n’est envisageable qu’après vérification que les profils concernés sont encore en V5. Dès qu’un appareil a ouvert V2.1, ne plus supposer cela.

**Après migration V6**, stratégie principale : correctif en avant compatible V6/ZIP2, ou retour à un artefact V2.1 V6 connu comme bon. Ne pas servir aveuglément le code V2/V5 : il peut devenir inutilisable sur les bases migrées. Ne pas restaurer automatiquement un ZIP ancien dans la base existante, ne pas purger IndexedDB et ne pas réactiver le rejeu V5.

En cas de défaut grave : préserver la base V6 et, si possible, en exporter un ZIP2 ; analyser une copie isolée. Une récupération depuis le ZIP1 préalable doit être validée sur une nouvelle origine/base de secours avec consentement explicite, sans écraser les données V6 originales. Il n’existe pas de downgrade automatique V6→V5. La commande de rollback V1 d’une ancienne documentation n’est pas un plan de retour V2.1→V2.

## Checklist de publication — aucune action exécutée

- [ ] Autorisation explicite de publier ce candidat précis, pas un autre dossier dist/ ou une ancienne RC.
- [ ] Sauvegardes ZIP1 réelles préalables conservées sur chaque appareil/origine utile.
- [ ] Revue des fichiers V2 non suivis et de l’index éventuel ; aucune inclusion de V1 ou des modifications hors V2.
- [ ] Figer/revoir le code source selon la politique Git choisie, avec autorisation distincte de commit/push ; aucune commande n’a été exécutée ici.
- [ ] Exécuter `node.exe tests/verify-final-rc.mjs` depuis roam-v2 ; si échec, arrêter et créer/retester un nouveau candidat, ne pas éditer l’inventaire pour contourner l’erreur.
- [ ] Vérifier avec accès authentifié les paramètres Pages, l’environnement et les restrictions de branche, puis enregistrer la configuration avant publication. Les anciennes informations Pages ne remplacent pas cette lecture au moment de basculer.
- [ ] Préparer une nouvelle branche statique à partir de **site/**, en conservant .nojekyll, release-info.json et tous les assets de transition ; ne modifier ni master ni une branche Pages existante par écrasement.
- [ ] Contrôler l’absence de ZIP, sources/tests, documents, profils ou secrets dans la branche statique. Publier seulement après la validation finale autorisée.
- [ ] Après déploiement autorisé : vérifier le release-info du candidat, les SHA-256 des fichiers et l’URL/scope/manifeste HTTPS réels.
- [ ] Sur les vrais appareils : sauvegarder/fermer les formulaires, accepter explicitement la mise à jour, fermer les anciens onglets si nécessaire, vérifier données/PDF et réouverture mode avion. Ne pas effacer les caches ou données pour forcer la transition.
- [ ] Maintenir un artefact de secours compatible V6 et les ZIP indépendants pendant la surveillance.

Vérification locale sans publication :

```powershell
Set-Location 'C:\Projets\roam-travel-planning\roam-v2'
node.exe tests/verify-final-rc.mjs
```

## Risques résiduels

Les 7 avertissements de lint (2 regex, 4 refs de focus, 1 signalement Date) restent documentés et n’empêchent pas la compilation. Les chunks MapLibre sont volumineux et différés ; les tuiles/recherches exigent Internet, aucun fond totalement offline n’est promis. Photos externes et stockage Android ne sont pas garantis indéfiniment. Les dates utilisent les conventions locales existantes, pas un fuseau du voyage déduit automatiquement.

L’activation OS, la propagation GitHub/CDN, les droits Pages et le comportement de l’installation réelle après publication ne peuvent pas être certifiés par un serveur local. Le candidat a une identité PWA Roam inchangée et ne porte pas le nom TEST. Aucune synchronisation cloud n’est activée.

> Exemples portables : `192.168.50.10` est une adresse LAN fictive à remplacer par celle affichée par le serveur ; `C:\Projets\roam-travel-planning` est un chemin d’exemple. `%USERPROFILE%` désigne le profil Windows courant.

## Vérification locale après un nouveau clone

La vérification de cette RC figée nécessite ses artefacts externes et deux fichiers locaux volontairement non versionnés. Sur le poste disposant du dossier durable, depuis roam-v2 :

```powershell
$Release = Join-Path $env:USERPROFILE 'Roam-release-candidates\Roam-V2.1-RC-8b9601f3770e'
Copy-Item (Join-Path $Release 'candidate.json') '.\docs\v21-final-rc.json'
Copy-Item (Join-Path $Release 'source\docs\physical-tests\check-wifi.mjs') '.\docs\physical-tests\check-wifi.mjs'
node.exe tests/verify-final-rc.mjs
```

Ces copies locales ne sont nécessaires ni au build applicatif ni à la suite fonctionnelle. Elles préservent la traçabilité exacte des outils historiques. Sur un autre compte/poste, les emplacements locaux du manifeste doivent être adaptés à la localisation des mêmes artefacts, sans toucher aux inventaires/empreintes. L’exemple public comporte des variables symboliques et ne doit pas être utilisé directement comme manifeste exécutable. Les scripts Wi-Fi d’exemple utilisent une IP fictive et se testent avec `node.exe docs/examples/check-wifi.mjs` une fois l’artefact TEST préparé.
