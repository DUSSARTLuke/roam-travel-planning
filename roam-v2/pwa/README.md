# Roam V2 — PWA 2.5.3a et 2.5.3b

## Ce qui est ajouté

- Manifeste `public/manifest.webmanifest`, identité Roam, standalone et icônes PNG
  192/512, maskable 512 et Apple 180. Le favicon SVG reprend la boussole ambre/navy.
  `python pwa/generate-icons.py` régénère les PNG sans bibliothèque supplémentaire.
- `pwa/plugin.ts` produit `dist/sw.js` et `dist/precache-manifest.json` après les
  transformations finales Vite. Aucun service worker n'est enregistré avec `vite dev`.
- `base: './'` et liens `%BASE_URL%` : build portable à la racine ou dans un dossier.
  Un préfixe explicite peut aussi être donné avec `--base=/roam-v2/`.
- Le manifeste utilise des URLs relatives ; l'enregistrement déduit sw.js et son
  scope du BASE_URL Vite et de l'URL réelle de la page. Servir l'URL du dossier
  avec son slash final, ou son `index.html`. Il n'y a pas de routeur à chemins profonds.

Références : https://vite.dev/guide/build et https://vite.dev/guide/cli

## Cache et données

Le précache contient uniquement `index.html`, les chunks JS/CSS et ressources
statiques émises sous assets/, le manifeste, le favicon et les icônes PWA.
Chaque entrée a une empreinte SHA-256 calculée au build et vérifiée avant mise en
cache. Les fichiers doivent être publiés ensemble, sans modifier leurs octets
après build. Une absence, redirection, réponse invalide ou empreinte différente
fait échouer l'installation et supprime son cache incomplet.

Exception depuis 2.5.5c : l'aperçu cartographique est optionnel et en ligne. Les
assets `maplibrePreview-*` (JS/CSS) et `maplibre-gl-worker-*` sont exclus du précache
et chargés seulement à l'ouverture d'une activité avec GPS valide. Les tuiles OSM
ne sont jamais précachées ni ajoutées au cache applicatif ; leur cache HTTP normal
reste géré par le navigateur. Les textes/adresses/coordonnées restent hors ligne.

Après installation : cache-first pour cette liste exacte et pour la navigation
vers l'entrée du dossier/index.html. Aucune écriture de cache à l'exécution.
Toutes les autres requêtes suivent le comportement normal du navigateur.
Sont exclus : ZIP, Blob, documents IndexedDB, données de voyages, API, requêtes
avec paramètres, POST et ressources externes. Le worker n'accède jamais à IndexedDB.
L'intégrité vérifiée garantit la correspondance au build, pas son authenticité.

Les caches sont nommés `roam-v2-static:<scope-complet>:<empreinte-build>`. Le nettoyage
à l'activation ne concerne que les anciens caches de ce même scope Roam V2,
et uniquement si aucun client Roam n'est ouvert. Sinon ils sont conservés ; les
anciens fichiers statiques sous assets/ peuvent y être retrouvés pour les pages
restées sur une version précédente.
Aucun cache V1 ou d'un autre sous-chemin n'est supprimé. Dexie reste V4, avec le
même nom de base et les mêmes fonctionnalités export/restauration.

## Cycle de vie et erreurs

### Mises à jour volontaires et coordination

Un worker installé en attente déclenche « Nouvelle version disponible », y compris
s'il était déjà en attente à l'ouverture. « Plus tard » réduit le bandeau sans
activer la version. La détection utilise l'enregistrement et les événements du
navigateur ; il n'y a pas de recherche périodique.

« Mettre à jour » demande explicitement l'activation au worker en attente. Tous les
onglets Roam de la même origine et du même chemin d'entrée (scope ou index.html),
y compris les fenêtres installées, doivent confirmer qu'ils peuvent recharger.
Les pages V1 et autres chemins ne participent pas. Les interfaces participantes
sont temporairement rendues inertes pour empêcher de nouvelles interactions.
Un refus, une absence de réponse sous 5 secondes ou un changement détecté dans la
liste des onglets reporte l'activation. Une demande simultanée est refusée.

L'accord de tous autorise `skipWaiting()` ; `clients.claim()` n'est pas utilisé.
Après activation, les onglets ayant accepté et restant sûrs rechargent une seule
fois. Une notification d'activation seule n'autorise jamais un rechargement.
Une réservation expire après 15 secondes si le protocole n'aboutit pas, pour
rendre l'interface utilisable. Après erreur ou report, terminer les opérations
puis réessayer explicitement ; aucune nouvelle tentative n'est automatique.

### Protection des formulaires et opérations

Les formulaires de voyage ouverts, les activités modifiées ou en cours d'écriture,
les dialogues ouverts et les opérations signalées occupées bloquent la demande.
Les exports et vérifications/imports ZIP sont protégés. Un export prêt reste
bloquant jusqu'à « J’ai récupéré le ZIP — terminer l’export » ; un aperçu de
restauration jusqu'à sa validation ou son effacement. Enregistrer ou abandonner
les saisies et fermer les panneaux avant de réessayer.

Un dernier contrôle précède le rechargement. Si une page devient occupée malgré
la réservation ou constate une activation extérieure au protocole, elle propose
« Recharger quand prêt ». La coordination ne sauvegarde pas les formulaires et ne
protège pas contre une fermeture ou un rechargement manuel du navigateur.
Elle ne modifie ni IndexedDB ni le format ZIP.

Après fermeture de tous les anciens clients, le navigateur peut activer le worker
selon son cycle normal, sans clic : Roam ne force pas cette activation.

### Indicateurs réseau

`navigator.onLine` et les événements `offline`/`online` pilotent un indicateur
discret « Hors connexion signalé ». Après un passage hors ligne, le retour réseau
est indiqué pendant 6 secondes, sans notification système ni sonde réseau.
Ce signal ne prouve ni l'accès à Internet ni la disponibilité des serveurs.
La navigation et les données locales restent disponibles dans les limites du cache.

L'enregistrement s'effectue uniquement en production et en contexte sécurisé
(HTTPS ou loopback localhost/127.0.0.1). Échec d'enregistrement ou d'installation :
bandeau explicite, bouton Réessayer, application toujours utilisable en ligne.
L'absence de support est également indiquée. Sur la première ouverture, un message
signale la préparation ; attendre sa disparition avant le test hors connexion.

## Vérifications Windows (depuis roam-v2/)

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:pwa
npm.cmd run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

Ouvrir `http://127.0.0.1:4173/` en ligne. Attendre la préparation, puis recharger
normalement une fois : Application > Service Workers doit montrer le worker actif
et la page contrôlée. Vérifier Manifest (nom, scope, icônes), puis installer via le
menu du navigateur si la plateforme propose cette fonction.

`test:pwa` vérifie le manifeste/PNG, simule le worker à la racine et sous préfixe,
contrôle les exclusions, le mode offline, l'intégrité, le nettoyage scoped et
l'activation après demande et accord des onglets, les refus, délais, nouveaux
onglets et demandes concurrentes. Il vérifie aussi chaque fichier réel de dist et son
SHA-256. Sans build : `node tests/pwa-check.mjs --source-only` limite le test aux
sources/simulations ; cela ne vérifie pas les artefacts de production.

### Sous-chemin

Après arrêt du premier serveur :

```powershell
npm.cmd run preview -- --host 127.0.0.1 --port 4174 --strictPort --base=/roam-v2/
```

Ouvrir `http://127.0.0.1:4174/roam-v2/`. Le même build relatif doit démarrer, puis
fonctionner hors ligne à cette adresse. Pour tester aussi un build à base explicite :

```powershell
npm.cmd run build -- --base=/roam-v2/
npm.cmd run test:pwa
npm.cmd run preview -- --host 127.0.0.1 --port 4174 --strictPort --base=/roam-v2/
```

`vite preview` est un serveur de test local, pas une procédure de déploiement.
Le port/hôte définit l'origine : les bases IndexedDB de 5173, 4173 et 4174 sont
séparées. Les sous-chemins d'une même origine partagent IndexedDB ; seuls les
scopes/caches du worker sont distincts. Ne pas confondre ce changement d'origine
avec une perte de données. Utiliser un profil ou une origine de test, sans vider
les données du site réel (Clear site data effacerait aussi IndexedDB).

### Hors connexion et exclusions

1. Après la préparation, DevTools Network > Offline ; recharger normalement
   (pas de rechargement forcé qui contourne les caches). Tester la navigation,
   les activités, documents locaux, export et restauration avec des données de test.
2. Inspecter Cache Storage : le cache courant contient uniquement les URLs de son
   precache-manifest.json ; les anciens caches peuvent conserver leurs propres URLs. Exporter un ZIP, ouvrir un Blob/document et recontrôler :
   aucune de ces données ne doit avoir été ajoutée au cache statique.
3. Les photos externes et Google Fonts déjà utilisées par l'application ne sont
   pas précachées. Hors connexion : polices système de repli ; photos externes
   potentiellement absentes. Aucun cloud, cache métier ou nouvelle synchronisation.
4. Sur une origine de test neuve, bloquer sw.js via Request Blocking : bandeau
   d'échec d'enregistrement, mais interface en ligne fonctionnelle. Débloquer et
   Réessayer. Tester ensuite le blocage d'une icône du précache sur une origine
   neuve : refus d'installation et absence de cache partiel.

### Tests de mise à jour réelle

Sur une origine de test, servir un build A contenant déjà 2.5.3b et vérifier qu'il
contrôle la page. Produire ensuite un build B différent et le servir sur la même
origine et au même chemin en gardant A ouvert. Si nécessaire, lancer la recherche
avec Application > Service Workers > Update. Ne pas utiliser Skip waiting ou
Update on reload, qui contournent le protocole. Utiliser uniquement des données
de test et ne pas conserver de modification de code faite pour distinguer A et B.

1. Attendre le bandeau sans rechargement ; tester « Plus tard », sa réouverture et
   un worker déjà waiting au chargement d'un onglet.
2. Depuis un second onglet, demander la mise à jour pendant un formulaire de voyage
   ouvert ou une activité modifiée. Vérifier le report et la conservation des
   saisies. Enregistrer ou abandonner, fermer les panneaux, puis réessayer.
3. Répéter pendant un export, avec un ZIP prêt non acquitté, pendant la vérification
   ou l'import et avec un aperçu de restauration en attente. Vérifier que les
   opérations et résultats restent disponibles après report.
4. Avec deux onglets disponibles, accepter la mise à jour : interface brièvement
   inerte, un seul rechargement par onglet, nouvelle version active et données
   IndexedDB intactes. Tester les doubles clics et les demandes simultanées.
5. Suspendre un onglet si les outils du navigateur le permettent : report puis
   libération de l'interface après expiration. Reprendre ou fermer cet onglet et
   réessayer. Tester aussi l'ouverture/fermeture d'un onglet pendant le vote ; un
   changement détecté reporte la demande. Un nouvel onglet tardif ne doit pas
   subir de rechargement non autorisé.
6. Sur cette origine de test seulement, provoquer une activation extérieure via
   les outils du navigateur : proposition de rechargement manuel, saisies conservées.
7. Répéter sur mobile, en fenêtre installée, au clavier et sous `/roam-v2/`.
   Vérifier les libellés, le focus après report, la navigation et l'exclusion des
   pages hors du chemin Roam V2.
8. Vérifier que les anciens caches restent présents lors d'une activation avec
   clients ouverts et ne contiennent aucune donnée personnelle. Leur nettoyage
   n'est attendu que lors d'une activation ultérieure sans client.

### Tests réseau et simulations

- Démarrer hors ligne après préparation, puis basculer hors ligne/en ligne avec
  et sans panneau ouvert. Vérifier la navigation locale, le message de retour
  pendant environ 6 secondes et les bascules rapides, sur mobile et ordinateur.
- Bloquer l'accès Internet tout en gardant une connexion réseau : le signal peut
  rester en ligne, mais ne doit jamais annoncer que les serveurs sont accessibles.
- Avec `npm.cmd run dev`, ouvrir `/tests/activities.html` sur l'adresse Vite puis
  lancer les tests isolés. Ils couvrent le coordinateur, les blocages, le focus,
  l'inertie, le reload unique et les transitions réseau simulées. Ils ne remplacent
  pas les tests de cycle de vie du worker en production ci-dessus.

## Limites

Une première ouverture en ligne réussie est nécessaire. L'installation dépend du
navigateur et de sa politique. Le cache peut être évincé par le navigateur ou
l'utilisateur ; il ne remplace pas les sauvegardes ZIP des données personnelles.
Un cache incomplet/évincé et un réseau absent peuvent empêcher le démarrage.
Les anciens caches peuvent s'accumuler : leur nettoyage dépend d'une activation
ultérieure sans client ouvert, pas de la seule fermeture d'un onglet. Ne pas
utiliser Clear site data pour cela : cette action efface également IndexedDB.

Un onglet chargé avant 2.5.3b ne sait pas voter et peut bloquer la demande. Il ne
reçoit pas rétroactivement le bandeau ou les protections. Terminer ses opérations,
enregistrer ses saisies puis fermer tous les anciens onglets et fenêtres installées
peut être nécessaire pour laisser le cycle normal activer la nouvelle version.
Rouvrir ensuite Roam. Un onglet suspendu peut nécessiter la même intervention.

Les délais sont soumis aux politiques de suspension du navigateur ; les simulations
ne garantissent pas tous les comportements des onglets en arrière-plan. La détection
n'est pas immédiate. L'étape 2.5.3c et le déploiement ne sont pas inclus.
