# Planning chronologique — 2.6a

Le modèle possède startTime/endTime mais aucun champ de durée explicite. Cette
étape n'ajoute pas de champ : durée = fin − début, uniquement si la fin existe.
Aucune heure de fin n'est déduite du début de l'activité suivante. Les heures sont
locales au jour, sans conversion de fuseau ni calcul de trajet/intervalle nocturne.

buildDayPlanning est pur : références aux activités, aucun tri du tableau source,
aucune écriture IndexedDB. Le tri du planning est début chronologique, puis tri
stable existant (sortOrder, création, id) à heure égale. Le tri général des idées,
du calendrier et des autres dates n'est pas modifié. Les activités period ou
unscheduled restent dans « À organiser » avec leur libellé Matin/Après-midi/Soir.

Les créneaux libres ont deux bornes connues : fin de l'ensemble des activités
précédentes et prochain début exact. Les intervalles imbriqués sont fusionnés
pour ne pas afficher de faux trous. Aucune disponibilité avant le premier début
ou après la dernière fin n'est inventée. Une fin inconnue empêche de garantir
les créneaux suivants ; un trou avant son début peut être affiché. Les activités
à organiser ne sont pas supposées occuper un horaire : une note précise que les
créneaux restent à confirmer selon ces activités.

Des intervalles se touchant ne se chevauchent pas. Un début à l'intérieur d'un
intervalle connu est signalé, même si la nouvelle fin est inconnue. Deux débuts
égaux sont signalés distinctement comme simultanés. Une activité sans fin peut
se prolonger, mais aucun conflit ultérieur n'est affirmé sans preuve. Une durée
explicite de zéro reste zéro et ne constitue pas un intervalle occupé.

La vue Jour par jour utilise les mêmes ActivityCard que les listes existantes.
Les boutons fiche/modifier, lieux et catégories sont conservés ; le rail horaire
évite de répéter les heures dans la carte. useLiveQuery recalcule le planning à
chaque modification ; les données calculées ne sont jamais sauvegardées. Aucun
changement de schéma Dexie V4, de ZIP 1 ou de navigation. Pas de budget, trajet,
drag-and-drop, réorganisation automatique ou autre étape 2.6b/c/d.

Tests : dayPlanning.core.ts et dayPlanning.browser.tsx dans /tests/activities.html.
Manuellement : journée vide, horaires avec/sans fin, matin sans horaire, mêmes
débuts, conflits imbriqués et modification depuis fiche/éditeur. Vérifier Jour /
Calendrier / Idées, autres dates, un voyage à cheval décembre/janvier, navigation
clavier Tab/Entrée et lecteur d'écran. Sur 320/375 px, vérifier les longues cartes,
les avertissements, les lieux et le bouton Modifier sans débordement. Tester hors
connexion avec des données existantes : aucun appel réseau n'est ajouté au planning.
