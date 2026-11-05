# 2.6d — Programme multi-jours

## Choix

- Jour reste la présentation initiale, quelle que soit la largeur. Multi-jours,
  Calendrier et Idées restent accessibles dans le même sélecteur.
- Groupes successifs de trois journées du séjour, bornes incluses. Un séjour de
  un/deux jours ou un dernier groupe incomplet affiche seulement les jours réels.
  Précédents/Suivants sélectionne le premier jour du groupe cible. Sélectionner
  une colonne ne quitte pas Multi-jours ; revenir à Jour conserve cette date.
- Jusqu'à trois colonnes lisibles sur desktop ; sur tablette/mobile, défilement
  horizontal limité à la région des colonnes, avec accès clavier. Le défilement
  vertical reste celui de la page, sans liste verticalement imbriquée. Chaque groupe
  s’ouvre sur sa première colonne, même si une autre journée est sélectionnée.
  Une sélection au sein du groupe conserve le défilement horizontal existant.
- Une seule requête live du voyage. Les données sont regroupées en mémoire,
  sans persistance supplémentaire et sans requête par colonne. DayTimeline et
  ses actions sont réutilisés ; aucun changement du calcul des créneaux libres,
  des validations, de Dexie V4 ou du format ZIP 1.
- Activités hors séjour dans Autres dates, idées dans leur vue, déplacements dont
  les jours divergent dans Déplacements à vérifier : règles 2.6b/2.6c inchangées.
- Mode, date sélectionnée et mois sont mémorisés dans App, par identifiant du
  voyage, pendant la session. Un aller-retour Carte/Budget/Plus/Accueil conserve
  cet état. Recharger l'application le réinitialise ; aucun état de formulaire
  n'est persisté par ce mécanisme. Les dates devenues hors séjour sont réconciliées
  à l'affichage sans modifier les voyages/activités ni démonter leurs panneaux.

## Tests automatisés

Depuis `roam-v2`, dans PowerShell :

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:pwa
npm.cmd run dev
```

Ouvrir `/tests/activities.html` sur le port indiqué et lancer la suite complète.
Les nouveaux tests utilisent exclusivement une base temporaire dédiée :

- groupes 1/2/7 jours, extrémités, jours vides, décembre/janvier ;
- ordre chronologique, chevauchements, À organiser, actions détail/modification/ajout ;
- trajets et avertissements, activités hors séjour ;
- sélection Jour/Multi-jours, Calendrier → Jour et retour d'un autre onglet ;
- une lecture pour l'ensemble des colonnes, actualisation après déplacement et
  changement d'heure via le repository, correction du trajet inter-journées ;
- largeurs de conteneurs 1180/740/327 px, défilement local, focus et cibles 44 px.

Les suites précédentes restent exécutées, notamment horaires/ordre, trajets,
formulaires, isolation, ZIP et PWA.

## Contrôles manuels

1. Desktop large : trois colonnes sans compression excessive. Tablette puis mobile
   375 px : aucune barre horizontale de page ; seuls les jours défilent. Tester
   balayage tactile, défilement vertical, Tab/Maj+Tab et flèches sur la région.
2. Tester séjours 1, 2 et 7 jours, journées vides, dernier groupe incomplet,
   Précédents/Suivants et limites désactivées. Vérifier les dates décembre/janvier.
3. Sélectionner une colonne, basculer Jour/Multi-jours/Calendrier. Ouvrir Carte,
   Budget, Plus puis revenir au Programme : date/vue/mois conservés. Changer de
   voyage puis revenir : états indépendants. Recharger : Jour par défaut.
4. Depuis chaque colonne, ouvrir une fiche, modifier l'activité, changer Horaire,
   déplacer vers une autre colonne et utiliser Monter/Descendre. Vérifier focus,
   mises à jour immédiates, alertes et maintien en Multi-jours. Ajouter une activité
   depuis une colonne vide : date préremplie de cette colonne.
5. Modifier/supprimer un déplacement et déplacer une activité liée vers un autre
   jour : correction signalée, références et durée/coût inchangés. Les créneaux
   libres continuent à exclure les déplacements du calcul.
6. Vérifier Idées et Autres dates, les trajets à corriger et le calendrier.
   Modifier les dates du séjour : sélection valide, activités hors séjour conservées.
7. Hors connexion après chargement de la PWA : navigation et organisation locales
   disponibles. Tester une erreur d'écriture et un conflit entre onglets : saisie
   conservée et message explicite, comme dans les vues existantes.

## Finitions 2.6d.1

Une journée vide affiche uniquement le bouton d'ajout de son état vide ; une
journée remplie garde celui de l'en-tête. La sélection est indiquée par la bordure
et un petit libellé relié à la section avec `aria-describedby`. Le jour sélectionné
n'a plus de bouton de sélection ; les autres conservent « Sélectionner ce jour ».
Après activation de ce bouton, le focus rejoint le titre de la journée pour éviter
sa perte lors du remplacement du bouton par le libellé.

Les tests vérifient l'unicité/placement des boutons, la bonne date d'ajout depuis
un jour vide, la description accessible et le focus après sélection, ainsi que
l'alignement des colonnes, leur défilement horizontal local et l'absence de zone
de défilement vertical imbriquée. Vérifier encore le balayage sur téléphone réel
et l'annonce du jour sélectionné avec le lecteur d'écran habituel.

## Correction 2.6d.2 — origine du décalage et actions

L’ancien effet assignait `scrollLeft = colonneSelectionnee.offsetLeft` à chaque
montage et sélection. Reproduction avant correction : à 327 px, avec le deuxième
jour mémorisé, `scrollLeft = 343` et bord gauche de la première colonne à −343 px.
À une largeur intermédiaire, le navigateur limitait cette valeur au débordement
maximal, rognant partiellement la première colonne. Aucun centrage ni transform
CSS n’était nécessaire pour provoquer le défaut.

En 2.6d.2, la remise à zéro utilisait un `useLayoutEffect` dépendant de la
première date du groupe. La 2.6d.3 remplace cette approche par un viewport DOM
propre à chaque groupe, décrit ci-dessous. Sélectionner un autre jour du même
groupe ne repositionne pas le conteneur. Le focus continue à rejoindre le titre avec
`preventScroll`. Le balayage et la navigation clavier native restent possibles.
Les pistes minimales 340 px sont conservées (réduites à la largeur du conteneur
s’il est plus étroit), avec défilement local et trois colonnes lorsque la place
suffit. Aucune restriction `touch-action` ne bloque le défilement vertical.

Disposition des actions :

- En-tête Programme : titre et résumé uniquement, sans boutons globaux.
- Multi-jours : un ajout d’activité par colonne (état vide ou en-tête), plus
  « Ajouter un déplacement » si la colonne possède au moins deux activités.
  Le formulaire de déplacement démarre sur le jour de cette colonne.
- Jour : sous les onglets, ajout d’activité si la journée est remplie, sinon
  bouton de l’état vide uniquement ; déplacement disponible dans cette barre.
- Calendrier : les deux ajouts sous les onglets, sur la date sélectionnée.
- Idées : ajout d’idée contextuel, sans déplacement entre idées non datées.

Les tests comparent scrollLeft et getBoundingClientRect, titre et bordures inclus,
à l’ouverture avec un jour mémorisé, après sélection, après pagination et après
retour depuis Jour. Ils emploient aussi les styles réels App.css et les conteneurs
app-shell/main-content (sans chargement des polices externes), en plus des
contrôles de largeur existants. Vérifier encore sur téléphone/tablette réels
l’ouverture avec un jour 2/3 mémorisé, le balayage puis la sélection, les groupes
Précédents/Suivants et le défilement vertical de la page.

## 2.6d.3 — Groupes vides et défilement tardif

Diagnostic : le téléphone signalait un `scrollLeft` de 653,6 px avec le focus sur
Précédents. Les tests stabilisés des groupes entièrement vides, partiels et remplis
mesurent les mêmes clientWidth, scrollWidth et largeurs de colonnes. Aucun
autoFocus n'est présent dans l'état vide, et ses marges ne produisent pas, dans
ces tests, de largeur différente. La navigation normale dans l'application
complète sous Chrome isolé ne reproduisait pas spontanément le décalage. Le
déclencheur navigateur exact du cas utilisateur n'est donc pas établi.

Une faiblesse du cycle de vie a été reproduite de façon déterministe : le viewport
était réutilisé entre groupes. Une dernière écriture de scroll sur l'ancien
viewport après la phase de layout (simulée avec requestAnimationFrame) déplaçait
le nouveau groupe malgré sa remise à zéro. Le test échouait à 327 px avec
scrollLeft=606, première colonne décalée de −606 px. Cette simulation couvre un
report tardif de défilement ; elle ne prétend pas identifier l'événement interne
exact du Chrome du téléphone.

Correctif : clé React composée des dates du groupe sur le seul conteneur
horizontal. Chaque groupe possède maintenant un élément DOM neuf avec son état
de scroll natif initial. Un défilement tardif visant l'ancien élément détaché ne
peut plus déplacer le nouveau. Suppression de la remise à zéro impérative ; pas
de boucle, timer ou overflow hidden destiné à cacher le problème. La sélection
au sein du groupe conserve le même élément et son défilement manuel. Navigation
et panneaux d'édition restent hors de ce viewport et conservent leurs états.

Tests : polices prêtes, deux frames puis 100 ms de stabilisation ; groupes vides,
partiels et remplis aux largeurs 327/740/1000/1180 px ; comparaison de géométrie,
sélection sans saut, Précédents/Suivants avec défilement tardif simulé, changement
Jour/Multi-jours et retour d'un onglet avec groupe entièrement vide sous StrictMode.
Exécution aussi en viewport mobile 375 px et desktop. Les données de test restent
isolées. Sur appareil réel, recharger normalement puis vérifier le cas initial et
le retour d'un groupe court vers trois jours vides, sans effacer de données.

### Clarification du cas réel : état vide collé à l'en-tête

Le retour utilisateur a précisé que « Sélectionner ce jour » était collé
verticalement à « Une journée à imaginer », sans superposition. Cause reproduite :
DayTimeline retourne directement ActivityList lorsqu'il est vide, donc son élément
`.program-empty` ne bénéficie pas du `margin-top: 20px` de `.day-planning`, présent
uniquement avec des activités. Les tests mesuraient bien les largeurs et le scroll,
mais pas cette distance verticale. Le nouveau test échouait avec un écart de 0 px.

Correction limitée aux colonnes Multi-jours : marge supérieure de 20 px sur
`.program-multi-day > .program-empty`. Les journées remplies ont déjà cet espace ;
les autres vues et les formulaires ne changent pas. Le test utilise maintenant les
dates exactes 28 décembre–3 janvier et vérifie le retour du seul 3 janvier vers
les trois jours 31 décembre–2 janvier. Après stabilisation, il vérifie pour chaque
colonne la distance en-tête/contenu, les bordures visibles et scrollLeft, pour les
groupes vides, partiels et remplis. La protection de cycle de vie du viewport et
le défilement manuel sont conservés ; aucune nouvelle manipulation de scroll
n'est ajoutée pour corriger ce défaut d'espacement.
