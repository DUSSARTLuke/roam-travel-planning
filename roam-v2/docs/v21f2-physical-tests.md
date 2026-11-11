# V2.1f.2 — Tests physiques isolés

Préparation uniquement : aucun déploiement, commit, push ou changement de branche Pages. Aucun profil réel ouvert. Les serveurs des contrôles automatisés sont arrêtés.

## Options et recommandation

| Option | Risques et limites | Décision |
| --- | --- | --- |
| Serveur Windows loopback et transfert USB Chrome vers `http://localhost:48621` sur Android | PC/câble pour le chargement initial ; aucune publication | Recommandé |
| Hébergement HTTPS sur un nom d’hôte distinct | Publication/compte à autoriser séparément, conditions et coûts à vérifier | Alternative ultérieure |
| Tunnel HTTPS temporaire | Exposition publique et origine parfois instable, nouvelle identité et stockage si elle change | Peu adapté |
| HTTPS LAN avec certificat approuvé | Configuration de confiance Android complexe | Non préparé |
| HTTP LAN `192.168…` | Ne valide pas toutes les fonctionnalités PWA exigeant un contexte sécurisé | À éviter |
| Autre chemin/dépôt sur `dussartluke.github.io` | Même origine, donc IndexedDB non isolé par chemin | Interdit pour V6 |

Protocole, hôte et port définissent l’origine. IndexedDB et CacheStorage sont cloisonnés par origine ; les workers ont également leur scope. Ainsi localhost:48621 est distinct de la production HTTPS, de localhost:5173 et de 127.0.0.1:48621. [Même origine](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy), [CacheStorage](https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage).

Chrome permet le transfert USB d’un port Android vers le serveur PC ; localhost convient aux fonctionnalités PWA exigeant un contexte sécurisé. Le packaging Android exact (WebAPK ou raccourci) reste dépendant du navigateur/appareil. [Transfert Chrome](https://developer.chrome.com/docs/devtools/remote-debugging/local-server), [installabilité](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

Nom : **Roam TEST V2.1**, nom court **Roam TEST**. Son identité PWA est distincte par son origine, même avec le même id relatif. [Identité PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id). Cette isolation ne garantit pas une conservation illimitée du stockage Android.

## Correspondance et différences explicites

- Candidat : `V2.1f.1-RC-ff65f37f336f`.
- Empreinte : `ff65f37f336fdf4d401cbccec38f87f7010421dbdc3dd75d54c9d92ba0e58b31`.
- Build original : `78c8ba39e4dbcde05fe07d40` ; dérivé TEST : `3fa3f3a44f298794b7820c04`.
- Copie et inventaire SHA-256 : `node_modules/.tmp/v21f2-preview/preview-info.json`.

La copie n’est pas identique octet pour octet : seuls trois fichiers existants changent. `manifest.webmanifest` reçoit le nom/description TEST ; `precache-manifest.json` et `sw.js` sont régénérés avec le même algorithme/template pour les nouvelles empreintes. JS/CSS applicatifs, HTML de démarrage et icônes restent inchangés. Outils, inventaire et ZIP fictif sont ajoutés hors précache. Aucun changement fonctionnel, de schéma ou de format ZIP.

Les nouveaux scripts sont dans `docs/physical-tests/`, hors des entrées figées du candidat. Le vérificateur original reste intact. Le préparateur refuse une copie existante qui ne correspond plus à son inventaire.

## Configuration fictive

Le ZIP généré contient **TEST — Paris fictif V2.1**, du 13 au 16 novembre 2026 : 5 activités (horaire, chevauchement, sans horaire/GPS, idée, ancienne activité d’hébergement conservée), 2 déplacements (multi-étapes vers hôtel, traversée de minuit), 3 hébergements (multi-nuits, consécutif, chevauchement). Participants TEST Alice/Bob, estimé/payé, partage et taux GBP/EUR explicitement fictif. Trois documents : PDF TEST hôtel/train et PNG « FAUX QR », sans réservation utilisable.

La génération exporte, valide et restaure sur deux bases UUID temporaires, puis supprime uniquement ces bases. Ne jamais importer de ZIP personnel. Londres peut également apparaître : c’est l’exemple normal de première ouverture.

## Procédure PowerShell puis Android

```powershell
Set-Location 'C:\Projets\roam-travel-planning\roam-v2'
node.exe tests/verify-candidate.mjs
node.exe docs/physical-tests/prepare.mjs
node.exe docs/physical-tests/generate-fixture.mjs
node.exe docs/physical-tests/check-isolation.mjs
```

Arrêter à toute erreur. Ces commandes ont déjà réussi et sont rejouables. Aucun paquet ni certificat à installer. Les artefacts sous node_modules/.tmp sont temporaires ; les scripts permettent leur régénération.

Pour commencer explicitement le test physique :

```powershell
node.exe docs/physical-tests/serve.mjs
```

Le serveur écoute seulement **127.0.0.1:48621**, refuse les autres Host et ne publie rien sur Internet. Si le port est occupé, arrêter sans tuer un processus inconnu ni changer un port isolément.

1. Activer le débogage USB Android, connecter le téléphone et autoriser son PC.
2. Chrome PC : `chrome://inspect/#devices`, détection USB, **Port forwarding** : port appareil **48621** vers **localhost:48621**, puis activer le transfert.
3. Chrome Android : ouvrir exactement **http://localhost:48621/test-tools/**. Jamais l’URL publique ou LAN. Vérifier le candidat et la mention TEST.
4. Initialiser seulement si cette page confirme une origine vierge. Tout stockage inconnu provoque un refus : arrêter sans le supprimer.
5. Télécharger le ZIP fictif proposé, ouvrir l’application via son lien, puis **Plus → Restaurer**, sélectionner uniquement ce ZIP, examiner l’aperçu TEST et confirmer.
6. Installer **Roam TEST V2.1** depuis Chrome si proposé, sinon ajouter son raccourci. Vérifier nom et URL ; ne pas remplacer/désinstaller Roam publique. Ouvrir en ligne puis fermer/rouvrir TEST.
7. Sélectionner explicitement les journées du 13 au 16 novembre, qui peuvent différer du jour courant.

Les requêtes externes habituelles de carte/recherche restent possibles en ligne : utiliser uniquement des lieux fictifs. Aucun cache massif de tuiles n’est ajouté. Leur absence hors réseau est attendue ; les listes locales restent utilisables.

## Checklist physique courte

- [ ] Déplacements libres/multi-étapes : ajouter, réordonner, retirer une étape, modifier mode/durée, vérifier traversée de minuit et réouverture.
- [ ] Hébergements : nuits/check-in/out, dates consécutives/chevauchantes ; modifier/supprimer un hôtel TEST lié et vérifier avertissement/dernier lieu connu du trajet.
- [ ] Clavier : champs visibles, virgule/point GPS, zéro/négatifs, erreurs et saisies conservées.
- [ ] Tactile 320/375 px : actions atteignables, défilements Jour/Multi-jours et absence de débordement de page.
- [ ] Carte : marqueurs/étapes, filtres, zoom, retour de fiche conservant la caméra ; listes accessibles si tuiles indisponibles.
- [ ] Documents : PDF hôtel/train et PNG, fermeture/zoom/téléchargement ; suppression uniquement TEST, état manquant si pertinent.
- [ ] Réservations/budget : statuts réellement renseignés, payé distinct d’estimé, coût hôtel compté une fois, ancienne activité conservée sans exclusion automatique.
- [ ] Hors connexion : fermer TEST, arrêter le serveur et débrancher USB, activer mode avion, rouvrir, consulter documents, créer/modifier du fictif, fermer/rouvrir et vérifier persistance.

Le mode avion seul ne prouve pas le cache si le serveur reste accessible via USB. Ne pas exiger tuiles/recherche hors connexion. Le premier chargement et le nettoyage nécessitent le serveur/transfert.

## Nettoyage sans toucher à V2

1. Fermer tous les clients TEST ; rétablir le serveur et le transfert USB.
2. Ouvrir exactement `http://localhost:48621/test-tools/`, saisir **SUPPRIMER TEST**, lancer le nettoyage. Le script exige son marqueur, vérifie les noms de bases/caches/scopes et refuse toute origine inconnue. Si bloqué, fermer les autres clients TEST.
3. Il supprime seulement la base roam-v2-db, les caches/worker et son marqueur sur cette origine dédiée. Désinstaller ensuite uniquement **Roam TEST**, en vérifiant son URL localhost. Ne pas effacer globalement les données Chrome ni désinstaller Roam publique.
4. Ctrl+C sur le serveur, retirer seulement le transfert 48621 ; désactiver le débogage USB si inutile. Supprimer éventuellement les téléchargements explicitement TEST.

Les outils ne sont pas précachés : nettoyage en ligne. En cas de stockage inconnu, arrêter plutôt qu’élargir la suppression.

## Résultats automatisés

Détail : `physical-tests/isolation-results.json`. Profil Chrome temporaire, deux origines loopback, HTTPS bloqué ; origine publique jamais ouverte.

| Contrôle | Résultat |
| --- | --- |
| Candidat, builds et précache originaux intacts | Réussi |
| ZIP2 fictif généré, validé, restauré sur bases temporaires | Réussi |
| Origine vierge, contexte sécurisé, isolation base/cache/worker | Réussi |
| Manifeste TEST et vrai worker/précache SHA-256 | Réussi |
| Import via vrai formulaire : V6, 5 activités, 2 journeys, 3 hébergements, 3 Blob | Réussi |
| Réouverture sans réseau par le vrai worker | Réussi |
| Nettoyage TEST et refus hors origine autorisée | Réussi |
| Autre origine : base V5, localStorage, cache et worker | Tous conservés |

Les premiers essais du nouveau runner ont révélé une attente DOM insuffisante et un libellé d’attente erroné : runner corrigé, chaîne complète relancée avec succès. Aucun changement applicatif nécessaire. La suite exhaustive f.1 n’a pas été relancée : ses entrées figées sont inchangées ; ces tests couvrent le conditionnement et l’isolation supplémentaires.

Non exécutés : installation Android réelle, clavier/gestes système, lecteur PDF mobile et redémarrage en mode avion physique. Ils constituent la checklist ci-dessus.

**Prêt pour tests physiques isolés par USB. Aucune préversion publique déployée.** Un hébergement HTTPS autonome nécessite une validation distincte et la vérification de ses conditions/coûts actuels.

> Exemples portables : `192.168.50.10` est une adresse LAN fictive à remplacer par celle affichée par le serveur ; `C:\Projets\roam-travel-planning` est un chemin d’exemple. `%USERPROFILE%` désigne le profil Windows courant.
