# 2.6e — Disponibilités après déplacements

## Calcul et limites explicites

`transferAvailability.ts` est un module pur au-dessus du moteur `dayPlanning.ts`.
Le moteur historique conserve son calcul de l'union des intervalles occupés et
sa détection des chevauchements. Aucune date, heure, durée ou donnée financière
n'est écrite. Aucun réseau ni migration Dexie/ZIP n'est nécessaire.

Un seul trajet direct, dans le bon sens, entre activités horaires consécutives du
même voyage et de la même journée peut être déduit. Il faut la fin explicite du
départ et le début explicite de l'arrivée. Les périodes et idées n'acquièrent
jamais d'heure implicite. Les activités À organiser gardent leur note précisant
qu'elles peuvent occuper les intervalles affichés.

- Sans trajet direct : comportement précédent du créneau conservé.
- Durée connue : restant = début arrivée − fin départ − durée du trajet.
  Résultat positif : temps libre ; zéro : aucun temps libre ; négatif : minutes
  manquantes. Une durée de zéro est valide, distincte d'une durée absente.
- Durée absente/invalide ou plusieurs trajets pour la même paire : créneau brut
  conservé, restant inconnu. Aucun choix, somme, minimum ou inverse implicite.
- Sens inversé, activités non consécutives ou jours divergents : aucune déduction.
  Les avertissements existants des cartes sont conservés.
- Horaires incomplets, activités sans heure, simultanéité ou conflit préexistant :
  pas de disponibilité calculée. Les chevauchements existants ne sont pas traduits
  en une deuxième alerte de retard de trajet. Un intervalle négatif avec activité
  instantanée est explicitement expliqué, sans inventer un retard de trajet.
- Une fin inconnue avant les activités concernées continue à empêcher de promettre
  un créneau libre, conformément au moteur historique.
- Après des activités imbriquées, conserver la borne du créneau obtenue par l'union
  des intervalles ; ne jamais la remplacer par la fin du dernier élément de liste.

## Affichage

Jour et Multi-jours partagent DayTimeline et PlanningGap. Le créneau brut reste
visible ; l'état restant est disponible, entièrement occupé, incompatible ou
inconnu. La durée saisie demeure dans la carte du trajet, sans répétition dans
le créneau. Si le moteur n'a pas de ligne de créneau (bornes jointives ou horaires
incomplets), la carte porte l'explication pertinente. Un résultat n'est pas répété
simultanément dans la carte et la ligne de créneau. Les coûts ne sont ni convertis
ni additionnés aux activités. Aucun horaire de départ/arrivée de trajet n'est créé.

## Vérifications automatisées

Depuis `roam-v2`, sous PowerShell :

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:pwa
npm.cmd run dev
```

Ouvrir `/tests/activities.html` sur le port affiché. La suite ajoute les contrôles
purs/rendus de transferAvailability.browser.tsx : sans trajet, durée inférieure,
égale/supérieure, absence/zéro/fraction, durée invalide, doublons, sens inversé,
jours différents, non-consecutivité, simultanéité, chevauchement, imbrication,
fin antérieure inconnue, bornes jointives, immutabilité et rendus partagés.
Une base synthétique dédiée vérifie la réactivité après modification d'horaire
puis de durée, les états Jour/Multi-jours, l'absence d'écriture au rendu et la
préservation des montants. Les autres suites sont conservées.

## Contrôles manuels

1. Préparer deux activités, la première finissant à 10:00 et la seconde commençant
   à 11:00. Ajouter un trajet de 20 min : brut 1 h, restant 40 min. Passer sa durée
   à 60 puis 80 min : aucun temps libre, puis 20 min manquantes.
2. Effacer sa durée puis saisir 0 : inconnu puis 1 h restante. Ajouter un second
   trajet pour la même paire : inconnu, sans addition des deux durées.
3. Retirer la fin de la première activité, retirer un horaire, inverser l'ordre,
   introduire une simultanéité/chevauchement puis déplacer une activité hors du
   jour. Vérifier l'explication et l'absence de disponibilité inventée.
4. Modifier le trajet depuis sa carte et l'horaire depuis l'action rapide :
   actualisation immédiate dans Jour et Multi-jours, mêmes chiffres et alertes.
5. Sur téléphone réel 375 px, vérifier les libellés sans débordement, le focus,
   les formulaires et le calendrier. Refaire hors connexion après chargement PWA.
6. Recharger puis exporter/restaurer dans une base de test distincte : seules les
   durées/horaires d'origine sont enregistrées ; les résultats sont recalculés.
