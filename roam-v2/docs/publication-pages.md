# Publication GitHub Pages — préparation du 9 novembre 2026

Aucune publication, modification de master, création de commit ou poussée n'a été effectuée pendant cette préparation.

## Audit et verdict

**NO-GO immédiat pour publier ; validation technique de la transition réussie.** Le candidat testé comporte encore des modifications non commitées. Il faut figer et approuver son contenu, sauvegarder les données depuis chaque origine, puis vérifier les paramètres Pages authentifiés avant toute bascule. Le test local ne remplace pas une vérification du déploiement réel.

Constats en lecture seule :

- Branche locale : `develop-v2`. URL actuelle : https://dussartluke.github.io/roam-travel-planning/ ; elle sert V1.
- Dernière publication publique observée depuis `master`, SHA `e7a98ce443bdacd398097631893a8707c142fddd`. Workflow dynamique `pages-build-deployment`, aucun workflow `.github` versionné. Exemple : https://github.com/DUSSARTLuke/roam-travel-planning/actions/runs/41596769915 .
- L'API publique `/repos/DUSSARTLuke/roam-travel-planning/pages` répond 404 sans authentification : la source exacte, les restrictions d'environnement et les paramètres privés ne sont pas certifiés. Les commandes ci-dessous doivent les vérifier avant écriture.
- Vite utilise `base: './'`. Le build explicite `/roam-travel-planning/` a été testé. La navigation par onglets ne nécessite pas de réécriture de routes.
- Le manifeste relatif conserve la même identité résolue que V1 : `id`, `start_url`, `scope` au chemin du projet ; icônes 192/512 et maskable présentes.
- Le worker V2 ne s'active pas automatiquement. Son précache vérifie les SHA-256 des ressources statiques ; ni ZIP, ni Blob IndexedDB, ni données personnelles ne sont mis en cache par ce mécanisme. Les tuiles et le module cartographique différé ne sont pas garantis hors connexion.
- Le worker V1 est cache-first et ne comprend pas le protocole de mise à jour V2. Après installation du worker V2 en ligne, fermer **tous** les onglets et fenêtres PWA de cette origine, puis rouvrir. Aucun effacement de cache, désenregistrement ou reset n'est nécessaire. Même précaution au retour vers V1.
- Les anciens caches V1 sont conservés. Les mises à jour suivantes V2→V2 utilisent la bannière et l'accord explicite existants.

## Données : précautions indispensables

V1 utilise `localStorage.roam` et une sauvegarde JSON. V2 utilise IndexedDB `roam-v2-db`, schéma Dexie **V5**, et ZIP format 1. V2 ne restaure pas le JSON V1. Le code V1 et ses données restent conservés mais ne sont pas affichés par V2.

L'origine inclut protocole, hôte et port : localhost, 127.0.0.1, l'adresse LAN HTTP et GitHub Pages HTTPS ont des stockages distincts. Exporter un ZIP V2 depuis **chaque appareil/origine utile**, conserver les fichiers hors du dépôt, puis restaurer explicitement sur Pages. Un changement de chemin sur le même domaine ne crée pas une nouvelle origine : d'autres applications sur `dussartluke.github.io` peuvent partager le même nom de base.

La restauration ignore intégralement un voyage dont l'identifiant existe déjà. Une base neuve V2 crée Londres (`london-2026`) : un Londres importé portant cet ID sera ignoré, y compris ses activités/documents. Vérifier l'aperçu et le résultat, ne jamais considérer des voyages ignorés comme restaurés. Ne supprimer ni remapper automatiquement les données pour contourner ce cas. Si des données nécessaires sont concernées, **arrêter la mise en service** et résoudre le conflit séparément.

Conserver aussi une sauvegarde JSON V1 si elle contient des données utiles. Les photos externes de voyages ne deviennent pas des fichiers hors connexion. Les ZIP contiennent des données personnelles non chiffrées et ne doivent jamais rejoindre la branche publique.

## Stratégie retenue

Conserver `master` et son historique V1 intacts. Publier seulement l'artefact construit sur une **nouvelle branche statique dédiée**, puis configurer Pages sur sa racine. `develop-v2` conserve le code source. `.nojekyll` préserve les octets et les hashes du précache. Trois anciens assets V1 sont conservés pendant la transition ; ils proviennent du commit public V1, jamais de fichiers locaux éventuellement modifiés.

Références officielles : [source de publication Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site), [déploiements personnalisés](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). Une branche Pages publie `/` ou `/docs`, pas directement `roam-v2/dist`.

## Commandes PowerShell — à exécuter uniquement après autorisation de publier

Ces commandes ne sont **pas exécutées** dans cette préparation. Arrêter à toute erreur. Aucun `--force`, aucune modification de master. Git et Node/npm doivent déjà être disponibles.

### 1. Figer le candidat et vérifier les accès (sans basculer Pages)

Après revue des modifications V2, sauvegardes utilisateur et autorisation explicite de commit/push :

```powershell
$ErrorActionPreference = 'Stop'
Set-Location 'C:\Users\luked\Documents\Projets\roam-travel-planning'
if ((git branch --show-current) -ne 'develop-v2') { throw 'Branche inattendue' }
# Refuser tout fichier déjà indexé hors V2. Ne pas embarquer les modifications V1 existantes.
$Outside = @(git diff --cached --name-only | Where-Object { $_ -notlike 'roam-v2/*' })
if ($Outside.Count) { throw 'Index contient des fichiers hors Roam V2 : revoir manuellement' }
git add -- roam-v2/
if ($LASTEXITCODE) { throw 'git add a échoué' }
git diff --cached --stat
# POINT DE REVUE : inspecter le diff indexé avant la commande suivante.
git commit -m 'Stabilize Roam V2 release candidate'
if ($LASTEXITCODE) { throw 'Commit non créé' }
$Candidate = (git rev-parse HEAD).Trim()
if (@(git status --porcelain -- roam-v2/).Count) { throw 'V2 contient encore des changements' }
git push origin develop-v2
if ($LASTEXITCODE) { throw 'Push candidat échoué' }

$RepoApi = 'https://api.github.com/repos/DUSSARTLuke/roam-travel-planning'
# Jeton Pages lecture/écriture ; jamais dans un fichier, le dépôt ou la conversation.
$Secret = Read-Host 'Jeton GitHub pour les paramètres Pages' -AsSecureString
$Token = [System.Net.NetworkCredential]::new('', $Secret).Password
$Headers = @{ Authorization="Bearer $Token"; Accept='application/vnd.github+json'; 'X-GitHub-Api-Version'='2022-11-28' }
$Pages = Invoke-RestMethod "$RepoApi/pages" -Headers $Headers
if ($Pages.html_url -ne 'https://dussartluke.github.io/roam-travel-planning/' -or
    $Pages.source.branch -ne 'master' -or $Pages.source.path -ne '/' -or
    $Pages.build_type -ne 'legacy' -or $Pages.cname) { throw 'Configuration différente : réauditer avant publication' }
# Lire aussi les restrictions de l'environnement github-pages si cet environnement existe.
# Une erreur 403/404 doit être clarifiée avec les droits adéquats, pas contournée.
Invoke-RestMethod "$RepoApi/environments/github-pages" -Headers $Headers | ConvertTo-Json -Depth 20

$Backup = Join-Path $env:USERPROFILE ("Roam-publication-backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory $Backup | Out-Null
$Pages | ConvertTo-Json -Depth 20 | Set-Content (Join-Path $Backup 'pages-before.json') -Encoding utf8
$Candidate | Set-Content (Join-Path $Backup 'candidate.txt')
git fetch origin master
if ($LASTEXITCODE) { throw 'Fetch échoué' }
$V1 = (git rev-parse origin/master).Trim()
if ($V1 -ne 'e7a98ce443bdacd398097631893a8707c142fddd') { throw 'Master a changé : réauditer' }
git archive --format=zip "--output=$Backup\v1-source.zip" $V1
if ($LASTEXITCODE) { throw 'Sauvegarde code échouée' }
$RollbackBranch = 'pages-v1-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
git push origin "${V1}:refs/heads/$RollbackBranch"
if ($LASTEXITCODE) { throw 'Branche de secours non créée' }
$RollbackBranch | Set-Content (Join-Path $Backup 'rollback-branch.txt')
```

Si une restriction `github-pages` interdit la nouvelle branche, arrêter et faire approuver sa modification séparément. Ne pas changer silencieusement la politique de sécurité.

### 2. Construire et vérifier l'artefact exact

```powershell
npm.cmd --prefix .\roam-v2 run lint
if ($LASTEXITCODE) { throw 'Lint échoué' }
npm.cmd --prefix .\roam-v2 run build -- --base=/roam-travel-planning/ --outDir=node_modules/.tmp/pages-v2-dist --emptyOutDir
if ($LASTEXITCODE) { throw 'Build échoué' }
npm.cmd --prefix .\roam-v2 run test:publication
if ($LASTEXITCODE) { throw 'Transition/PWA échouée' }
# Le runner utilise Chrome et un profil temporaire ; aucune donnée personnelle.
```

`test:pwa` vérifie le `dist/` standard, tandis que `test:publication` vérifie directement l'artefact ci-dessus et son service worker réel au sous-chemin projet.

### 3. Préparer une branche statique isolée, puis basculer explicitement

```powershell
$SourceRoot = (Get-Location).Path
$Artifact = Join-Path $SourceRoot 'roam-v2\node_modules\.tmp\pages-v2-dist'
$ReleaseBranch = 'pages-v2-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $Candidate.Substring(0,8)
$Stage = Join-Path $env:TEMP $ReleaseBranch
New-Item -ItemType Directory $Stage | Out-Null
Copy-Item "$Artifact\*" $Stage -Recurse
# Extraction Git binaire sûre : ne pas utiliser une redirection PowerShell de git show.
git archive "--output=$Backup\v1-grace.zip" $V1 app.js style.css icon.svg
if ($LASTEXITCODE) { throw 'Assets historiques indisponibles' }
Expand-Archive "$Backup\v1-grace.zip" -DestinationPath $Stage
New-Item -ItemType File (Join-Path $Stage '.nojekyll') | Out-Null
@{source=$Candidate; branch=$ReleaseBranch; builtAt=(Get-Date).ToUniversalTime().ToString('o')} |
  ConvertTo-Json | Set-Content (Join-Path $Stage 'release-info.json') -Encoding utf8
Get-ChildItem $Stage -Recurse -File | Get-FileHash -Algorithm SHA256 |
  Export-Csv (Join-Path $Backup 'published-files.csv') -NoTypeInformation
# Aucun ZIP, node_modules, test ou fichier personnel dans $Stage.
git -C $Stage init -b $ReleaseBranch
if ($LASTEXITCODE) { throw 'Init échoué' }
git -C $Stage remote add origin https://github.com/DUSSARTLuke/roam-travel-planning.git
git -C $Stage add .
git -C $Stage commit -m "Publish Roam V2 artifact $Candidate"
if ($LASTEXITCODE) { throw 'Commit artefact échoué' }
git -C $Stage push -u origin $ReleaseBranch
if ($LASTEXITCODE) { throw 'Push artefact échoué' }
$ReleaseBranch | Set-Content (Join-Path $Backup 'release-branch.txt')
# POINT FINAL DE BASCULE : après validation de l'artefact et des sauvegardes.
$Now = Invoke-RestMethod "$RepoApi/pages" -Headers $Headers
if ($Now.source.branch -ne $Pages.source.branch -or $Now.source.path -ne $Pages.source.path) { throw 'Pages modifié entre-temps' }
$Body = @{ build_type='legacy'; source=@{branch=$ReleaseBranch;path='/'} } | ConvertTo-Json
Invoke-RestMethod "$RepoApi/pages" -Method Patch -Headers $Headers -ContentType 'application/json' -Body $Body
# Conserver les variables et le dossier $Backup pour le retour arrière.
```

La branche courante du dépôt source reste develop-v2. La branche de publication ne contient que des fichiers publics de production. Aucun CNAME ni paramètre HTTPS n'est changé.

### 4. Vérifier la publication réelle

```powershell
$Expected = (git -C $Stage rev-parse HEAD).Trim()
$Deadline = (Get-Date).AddMinutes(10)
do {
  $Runs = Invoke-RestMethod "$RepoApi/actions/runs?branch=$ReleaseBranch&per_page=5" -Headers $Headers
  $Run = $Runs.workflow_runs | Where-Object { $_.head_sha -eq $Expected } | Select-Object -First 1
  if ($Run.status -eq 'completed') { break }
  Start-Sleep -Seconds 10
} while ((Get-Date) -lt $Deadline)
if (-not $Run -or $Run.conclusion -ne 'success') { throw 'Déploiement non confirmé : inspecter Actions' }
$Site = 'https://dussartluke.github.io/roam-travel-planning/'
$Published = Invoke-RestMethod ($Site + 'release-info.json?check=' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
if ($Published.source -ne $Candidate) { throw 'Candidat public différent' }
$Inventory = Invoke-RestMethod ($Site + 'precache-manifest.json')
foreach ($Entry in $Inventory.entries) {
  $TempFile = Join-Path $Backup 'asset-check.tmp'
  Invoke-WebRequest ($Site + $Entry.path) -OutFile $TempFile -UseBasicParsing
  if ((Get-FileHash $TempFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Entry.sha256) { throw "Asset différent : $($Entry.path)" }
}
Invoke-WebRequest ($Site + 'sw.js') -UseBasicParsing | Select-Object StatusCode
# Ne pas coller ni enregistrer le jeton. Retirer les variables après la période de surveillance.
# Remove-Variable Token,Secret,Headers
```

Une réussite HTTP ne prouve pas que le téléphone a activé V2. Sur le véritable téléphone seulement : ouvrir en ligne, fermer tous les clients de l'origine, rouvrir ; vérifier V2, restaurer le ZIP si nécessaire en examinant les conflits ; vérifier documents et démarrage en mode avion après fermeture complète. Le navigateur ne garantit pas une conservation éternelle du stockage : conserver des ZIP indépendants.

## Retour arrière (uniquement après décision explicite)

Réutiliser la session et les sauvegardes précédentes ; sinon relire `rollback-branch.txt`, réauthentifier et vérifier la configuration actuelle. Ne jamais remettre un binaire V2 schéma V4 sur une base V5.

```powershell
$Body = @{ build_type='legacy'; source=@{branch=$RollbackBranch;path='/'} } | ConvertTo-Json
Invoke-RestMethod "$RepoApi/pages" -Method Patch -Headers $Headers -ContentType 'application/json' -Body $Body
```

Attendre le succès du workflow sur cette branche, vérifier que l'URL sert V1, puis fermer tous les onglets/PWA de l'origine pour laisser le worker historique prendre la main. Aucun nettoyage de cache ni de base. Les données V2 restent intactes mais invisibles dans V1 ; elles seront accessibles au retour V2. Les données V1 restent en localStorage. Une sauvegarde du code n'est pas une sauvegarde des données utilisateur.

## Tests effectués pendant cette préparation

`tests/publication.mjs` utilise un serveur local à phases et Chrome temporaire :

1. Build au vrai sous-chemin ; chemins HTML, identité manifeste V1/V2, scope, SHA-256 de tous les assets.
2. V1 installée puis V2 en attente : aucune activation forcée, ancienne interface conservée.
3. Fermeture des clients, activation V2 au même scope ; localStorage V1 conservé, cache V1 conservé.
4. Création d'une activité synthétique, réseau CDP désactivé, fermeture/réouverture : démarrage production hors ligne et activité persistée.
5. Retour V1 par remplacement serveur, sans purge/unregister : localStorage V1 et activité IndexedDB V5 encore présents.

Ce test ne contacte pas GitHub en écriture, ne simule pas les permissions privées ou la propagation CDN, et ne touche pas aux profils/données personnels. Les vérifications sur le serveur local ne certifient pas le résultat d'un déploiement futur. L'activation/installabilité sur le téléphone réel reste à confirmer après publication autorisée.

### Résultats du 9 novembre 2026

- Build TypeScript/Vite avec base explicite et sortie isolée : réussi (avertissement de taille de chunk existant).
- `npm run lint` : code retour 0, 7 warnings existants, aucune erreur.
- `npm run test:pwa` : réussi ; précache, exclusions, intégrité, nettoyage par scope, vote multi-onglets et activation volontaire.
- `npm run test:publication` : réussi, transition V1→V2→V1 complète au sous-chemin.
- `npm run test:offline` : premier passage échoué car le runner cliquait avant la fin de validation du fichier. Attente du bouton disponible ajoutée, sans changement applicatif ; relance réussie : création avec PNG, modification, réouverture, consultation du document et suppression persistées hors réseau.
- `git diff --check -- roam-v2/` : réussi.
- Publication réelle, paramètres privés GitHub, propagation CDN et installation sur téléphone : non exécutés (publication non autorisée dans cette mission, accès authentifié non disponible).

Fichiers concernés par cette préparation : ce document, `tests/publication.mjs`, `tests/production-offline.mjs` (attente seulement), `tests/README.md` et `package.json` (commande `test:publication`). Aucune correction de base path, manifeste ou service worker nécessaire dans l'application. Les modifications hors V2 visibles au statut Git étaient préexistantes et ne sont pas incluses.
