# Taux automatiques — 2.5.4d

## Fournisseur vérifié le 4 novembre 2026

- https://frankfurter.dev/ : API V2 publique sans clé, taux blended quotidiens,
  stockage local encouragé, limitation anti-abus sans quota journalier annoncé.
- https://frankfurter.dev/license/ : données blended gratuites, y compris usage
  commercial ; fournies sans garantie. Pas d'endpoint spécifique de banque utilisé.
- https://frankfurter.dev/javascript/ : CORS ouvert documenté pour fetch navigateur.
- https://api.frankfurter.dev/v2/openapi.json : paire directe
  GET /v2/rate/{base}/{quote}, objet {date, base, quote, rate}. Aucune API V1.
- https://api.frankfurter.dev/v2/currencies : couverture dynamique, différente du
  catalogue ISO du navigateur. Le site annonce 239 devises, dont certaines ne
  figurent pas dans notre catalogue. Une devise reconnue localement peut ne pas
  avoir de paire disponible. Réponses 404/422 : indisponible, aucun taux inventé.

Le test direct des en-têtes réseau depuis WSL n'a pas été possible (DNS bloqué) :
le CORS est vérifié dans la documentation officielle, à confirmer dans Chrome.
Les taux sont indicatifs, pas une cotation en temps réel ni une garantie comptable.

## Requêtes et cache

Seules les activités avec montant estimé/payé fini non négatif et devise reconnue
participent. Les doublons, identités et paires déjà manuelles sont exclus. Une
requête par paire source -> référence utilise son sens exact, sans inversion ni
taux croisé. Au plus 4 requêtes simultanées, délai 10 secondes par requête ; aucun
montant, identifiant, nom de voyage ou document n'est transmis. Credentials omit,
no-referrer et no-store : cache métier dans IndexedDB, pas dans le service worker.

Le contrôleur est monté pour le voyage sélectionné et le panneau de paramètres.
Une tentative par paire et jour UTC (même après erreur/indisponibilité) est mémorisée.
Le bouton manuel peut forcer un nouvel essai. La signature des paires et la reprise
réseau peuvent déclencher une vérification locale ; navigation, StrictMode et
écritures du cache ne provoquent pas de téléchargement répété le même jour.
Pas de polling réseau ni de nouvelle tentative en boucle. Une horloge locale
vérifiée toutes les minutes pendant l'utilisation détecte le changement de jour
UTC et permet une actualisation quotidienne si le voyage reste ouvert.
Un nouvel ensemble de sources ne demande que les paires encore non vérifiées.

La réservation transactionnelle sur le voyage empêche deux onglets de télécharger
simultanément. Elle expire après 10 minutes ; une interruption ne provoque pas
une seconde tentative automatique le même jour, mais permet un essai manuel après
expiration. Les requêtes n'occupent jamais une transaction Dexie. Une erreur de
stockage laisse le cache valide intact ; une réservation peut rester jusqu'à son
expiration. Les opérations sont signalées à la protection de rechargement PWA.

À la fin, relecture du voyage et vérification du jeton. Les taux/champs manuels et
les autres champs ne sont jamais écrasés. Si le voyage est archivé, mis à la
corbeille ou change de référence pendant la requête, la réponse n'est pas appliquée.
Une réponse ancienne ne remplace pas une observation plus récente. Erreurs HTTP,
réponses malformées et panne réseau conservent tous les derniers taux valides.

`createTripRateResolver` copie le cache puis délègue d'abord aux taux manuels.
Les observations anciennes restent utilisables hors ligne, avec leur date. Les
montants d'activité ne changent pas ; aucun écran Programme/Budget n'est converti.

## Interface et limites

La modification d'un voyage affiche les taux automatiques du voyage enregistré,
indépendamment des saisies non enregistrées dans le formulaire. Dernière réception
valide, date des observations, états des tentatives et bouton d'actualisation sont
présentés séparément des taux manuels. Récent = observation de 0 à 3 jours UTC,
ancien au-delà ; seuil indicatif pour week-ends/jours fériés, pas une garantie.
L'âge des taux est réévalué au changement de jour UTC (à une minute près).
Le signal online ne garantit pas le fournisseur.
Les copies de voyages démarrent sans cache automatique ; leurs taux manuels sont
copiés. Les anciens caches de paires restent présents si la référence change.

## Validation Windows

Depuis roam-v2 : npm.cmd run lint ; npm.cmd run build ; npm.cmd run dev.
Ouvrir /tests/activities.html et lancer la suite : toutes les réponses fournisseur
sont simulées, aucun appel Frankfurter réel. Les bases sont temporaires isolées.

Manuellement sur une origine de test : ajouter des montants JPY et GBP, ouvrir le
voyage en ligne puis inspecter Network (uniquement api.frankfurter.dev/v2/rate/).
Revenir entre onglets/vues : pas de nouveaux téléchargements quotidiens. Ouvrir la
modification : vérifier observations/date/états, forcer l'actualisation, changer la
référence et enregistrer. Tester deux onglets et modifier un taux manuel pendant
la requête : aucune perte. Bloquer le fournisseur, puis passer Offline : cache et
interface conservés. Une paire indisponible ne doit pas afficher un taux inventé.
Tester clavier/mobile et mises à jour PWA pendant une actualisation. Exporter puis
restaurer dans une base de test distincte : cache, taux manuels et montants intacts.

## Diagnostic des dates et réponses

La réponse V2 `{date, base, quote, rate}` est mappée sans conversion du taux.
La date du taux est calendaire ; fetchedAt est un instant UTC issu de l'horloge
du navigateur. Un écart d'un jour vers le futur est accepté, notamment autour
de minuit à Paris. Au-delà, la validation refuse le taux et indique les deux
dates ainsi que la nécessité de vérifier l'horloge. Le libellé de date future
reste visible : fetchedAt n'est jamais falsifié pour faire accepter une réponse.

Les échecs enregistrent un diagnostic borné : réseau, HTTP, lecture JSON ou
validation du taux. Il est affiché dans les paramètres ; les anciennes erreurs
sans diagnostic restent compatibles. Une erreur IndexedDB est affichée lors
d'une demande manuelle et journalisée pour une demande automatique. Les taux
valides précédents restent intacts. Après correction, utiliser le bouton manuel
pour contourner le délai quotidien sans vider le cache ni IndexedDB.
