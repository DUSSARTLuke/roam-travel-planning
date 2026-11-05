# Accueil du voyage — 2.9a

L'accueil conserve destination/photo/dates/voyageurs et les raccourcis existants
Programme, Carte, Budget et Plus. La gestion (archivage/corbeille/export) reste
accessible dans « Gérer et sauvegarder ce voyage », sans encombrer les informations
quotidiennes. Aucun schéma, ZIP, montant ou statut existant n'est modifié.

`overviewModel.ts` contient des calculs purs : nombre de jours bornes incluses,
compte à rebours, jour du séjour et fin. Le modèle ne stocke pas le fuseau de la
destination : les repères temporels utilisent la date et l'heure **locales de
l'appareil**, ce que précise l'écran. Les horaires saisis restent des heures civiles,
sans conversion UTC. Le calcul des écarts entre dates utilise les jours calendaires,
sans dépendre d'un jour de 23 ou 25 heures lors d'un changement d'heure.

La prochaine activité est explicitement « à heure précise » : activité du voyage,
datée dans le séjour et dont le début n'est pas passé (précision à la minute).
Une activité déjà commencée n'est pas présentée comme prochaine ; aucune durée
n'est inventée. Les idées et activités à venir sans heure précise sont signalées
séparément ; un aperçu de la première journée concernée ouvre sa fiche sans
prétendre que cette activité est encore à venir aujourd’hui. Toutes restent
accessibles dans le Programme. Un créneau matin/après-midi/
soir n'est jamais transformé en heure fictive. Les égalités sont départagées
par ordre explicite puis identifiant, de façon stable.

L'horloge est vérifiée chaque seconde mais React ne se met à jour que si la minute
ou la date change ; reprise au focus/visibilité, nettoyage au démontage. Le Budget
n'est pas recalculé et IndexedDB n'est pas relu à chaque tick. Une seule requête
réactive fournit les activités du voyage. Le voyage reçu reste lui-même réactif
via l'App. Les erreurs de lecture ne deviennent pas de fausses listes vides.

Les réservations résument les seuls statuts ou renseignements réellement présents,
y compris le statut historique « pending ». Des métadonnées sans statut sont
comptées « Statut non renseigné ». Une réservation ne prouve aucun paiement.
Les fiches et l'édition réutilisent ActivityDetailPanel/ActivityFormPanel ; le retour
restaure le focus et la fiche suit les données réactives. Une activité inaccessible
ou supprimée ferme sa fiche. Aucune nouvelle interface de persistance.

Le résumé estimé/payé appelle `buildTripBudget` et le prévisionnel réutilise
`PlannedBudgetPanel`. Les montants inconnus ne valent pas zéro, les conversions
restent indicatives et locales. Les paiements de transferts restent suivis dans
le partage uniquement, conformément au périmètre 2.8. Pas de requête de taux ni
de nouvelle dépendance. Le contenu financier et les réservations restent lisibles
hors connexion ; les images distantes/cartes ont leurs limites existantes.

## Tests

Depuis PowerShell dans roam-v2 :

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:pwa
npm.cmd run dev
```

Ouvrir `/tests/activities.html`. `tripOverview.browser.tsx` utilise uniquement une
base synthétique temporaire : avant/pendant/après, décembre/janvier, minuit local,
changement d'heure, prochaine activité vs première/périodes/idées/hors séjour,
statuts non inventés, prévisionnel et synthèse incomplets, horloge sans relecture,
fiche/focus/suppression, réactivité, erreurs, isolation et 320/375/desktop offline.
La suite complète antérieure reste exécutée.

À vérifier sur téléphone réel : raccourcis et retour entre onglets, ouverture fiche
puis Modifier/Enregistrer/Annuler, clavier virtuel/focus/Échap, défilement 320/375 px,
reprise après veille et franchissement d'une minute/minuit, consultation hors réseau,
modifications du voyage/activité/taux depuis un autre onglet. Vérifier les montants
originaux et les détails des conversions dans Budget. Le fuseau de destination
et les fonctions 2.9b–e ne sont pas ajoutés à cette étape.
