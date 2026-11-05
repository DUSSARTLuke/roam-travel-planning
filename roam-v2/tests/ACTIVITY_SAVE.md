# Correctif mobile — sauvegarde des activités sur HTTP local

## Diagnostic reproduit

Sur une origine HTTP non considérée sûre par Chrome (équivalente à une adresse
LAN 192.168.x.x), isSecureContext=false, crypto.randomUUID est absent et
crypto.getRandomValues reste disponible. Avant correction :

- createActivity : TypeError « crypto.randomUUID is not a function » ;
- saveActivityWithDocuments sans fichier : cette TypeError est remplacée par le
  message générique « Impossible d'enregistrer les documents… » ;
- modification simple d'une activité existante sans fichier : réussit dans cette
  reproduction. Le signalement de tous les cas ne prouve donc pas une même cause
  pour chaque modification ; les autres erreurs restent désormais diagnostiquées.

La création a besoin d'un nouvel id même sans fichier. Ajouter des documents à
une activité existante a également besoin d'ids. L'ajout d'un lien dans le
formulaire utilisait la même API indisponible.

## Correction et intégrité

createId préfère randomUUID s'il existe, sinon construit un UUID v4 avec 16 octets
cryptographiques issus de getRandomValues (bits version et variant explicites).
Aucun Math.random, timestamp ou compteur de secours. Sans source fiable, l'opération
échoue explicitement. Ce helper est utilisé par activités, documents et liens du
formulaire ; il ne modifie aucun identifiant déjà enregistré.

Les lectures de fichiers et signatures restent avant la transaction IndexedDB.
Avec pièces jointes : activité, métadonnées et Blob sont toujours écrits dans une
unique transaction rw incluant les quatre tables ; toute erreur annule l'ensemble.
Sans nouveau fichier : transaction trips/activities uniquement, aucune lecture ou
réécriture des pièces jointes existantes. La limite de 5 fichiers est toujours
vérifiée transactionnellement lors d'un import réel. Aucun reset/migration Dexie
V4 ou changement ZIP format 1.

Les erreurs ne sont plus toutes imputées aux documents : le contexte activité ou
activité+documents est explicite. Le quota conserve son message spécifique ; un
fichier illisible est signalé ; les autres erreurs gardent leur nom et la cause
originale (Error.cause). Le formulaire journalise seulement l'exception, pas les
saisies ni les fichiers, et conserve son état. Les validations métier restent
inchangées. Pour TransactionInactiveError/PrematureCommitError, le message ne
promet pas un rollback non vérifiable : il invite à vérifier la liste avant retry.
Il n'y a aucun retry automatique ni écriture après échec.

## Tests disponibles

Depuis roam-v2 sous Windows PowerShell :

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:pwa
npm.cmd run dev
```

- `/tests/activities.html` : suite complète avec les nouveaux contrôles.
- `/tests/activity-save.html` : test ciblé autonome utilisable en HTTP LAN sur
  téléphone, sans dépendre de randomUUID dans les fixtures. Il affiche le statut
  sécurisé et l'existence de randomUUID. Il utilise exclusivement une base
  temporaire roam-v2-test-activity-save-… et la supprime à la fin. Ne pas fermer la
  page avant la fin, sous peine de laisser cette base de test temporaire.

Contrôles : voie native et repli UUID v4, version/variant, unicité d'échantillon,
absence de RNG fiable, création/édition avec et sans fichiers, scope sans documents,
conservation identité/champs avancés/anciens Blob, quota après écriture métadonnées,
échec technique métadonnées, abort, transaction terminée, fichier illisible,
rollback complet et persistance après réouverture. Les propriétés Crypto simulées
sont restaurées dans un finally. Les données Roam utilisateur ne sont pas touchées.

Les tests ont aussi été exécutés dans un profil Chrome temporaire sur une origine
HTTP non sûre, avec randomUUID réellement absent (aucun flag activant les contextes
sécurisés). Après correction, création et édition avec/sans fichier passent.

## Vérification sur téléphone

Sur l'adresse HTTP locale habituelle, recharger normalement puis :

1. Créer une activité sans fichier ; vérifier la liste et la persistance.
2. Modifier une activité existante sans fichier, y compris si elle possède déjà
   une pièce jointe ; vérifier sa conservation.
3. Ajouter un petit PDF/JPEG/PNG/WebP, puis modifier l'activité en ajoutant un lien.
4. Vérifier qu'une erreur de validation conserve les saisies ; copier le message
   et la cause console si une autre erreur persiste. Ne pas vider IndexedDB.
5. Lancer éventuellement `/tests/activity-save.html` pour vérifier le parcours
   dans le navigateur du téléphone sans créer de données dans la base utilisateur.

Ce repli d'identifiants ne rend pas HTTP équivalent à HTTPS pour les fonctionnalités
qui nécessitent un contexte sécurisé (notamment le service worker). Les ZIP
disposent désormais de leur propre repli SHA-256 local, indépendant des identifiants.

Références plateforme :
https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues


## Audit étendu des actions HTTP (déplacements et autres identifiants)

Le correctif initial ne couvrait que les activités, documents et liens. Cinq appels
natifs restaient dans quatre fichiers : création/duplication des voyages dans App,
création des déplacements, tokens d’actualisation des taux et demandes PWA. Ils
utilisent maintenant tous `createId`, comme les activités. Les identifiants existants,
transactions, verrous de concurrence, montants et données enregistrées ne changent pas.
Aucune migration et aucune réécriture de données.

`node tests/crypto-context.mjs` contrôle tous les fichiers de production sous `src/`
et échoue si un accès à randomUUID réapparaît en dehors du helper. Cela complète
les tests du générateur natif et du repli fiable (aucun Math.random).

`activitySave.browser.ts`, également exécuté par `/tests/activity-save.html`, masque
l’API native puis teste les repositories réels : création/modification/suppression
et persistance de déplacements, rollback sans source aléatoire, actualisation des
taux avec son générateur de token par défaut et une réponse réseau simulée, cache
journalier, identifiants distincts pour les voyages et copies et protocole PWA
avec le même générateur (worker simulé, jamais d’activation/rechargement).
Le test des identifiants de voyages n’est pas un test complet des formulaires App.
La page isolée fonctionne aussi sur une vraie origine HTTP non sécurisée.

À vérifier dans l’application sur le téléphone après rechargement normal : créer
un voyage, le dupliquer, créer/modifier un déplacement, actualiser les taux et
relancer un export ZIP. Vérifier les identifiants indépendants et la persistance,
sans vider les données. L’installation/service worker PWA nécessite toujours un
contexte sécurisé ; ce correctif ne tente pas de contourner cette restriction.

Validation PowerShell :

```powershell
node tests/crypto-context.mjs
npm.cmd run lint
npm.cmd run build
npm.cmd run test:pwa
```
