# Tableau de bord du Budget — 2.8a

Le composant `components/budget/TripBudget.tsx` remplace l’attente de l’onglet Budget
uniquement dans le contexte d’un voyage actif. Il lit les activités via le repository
existant et `useLiveQuery`. Les transferts, la devise et les taux proviennent du voyage
réactif fourni par App. Le calcul est mémoïsé, fonctionne sans réseau et n’écrit rien.

## Sources et absence de double comptage

`buildTripBudget` est une fonction pure. Elle utilise `calculateFinancialTotals`,
`createTripRateResolver` et le formatage `formatMoney` existants. La résolution est
partagée par paire pendant le calcul : taux manuel prioritaire, puis dernier taux
automatique enregistré, jamais d’inverse implicite ou de taux inventé. Les devises
d’origine et les montants restent inchangés. Les totaux sont exprimés dans la devise
de référence du voyage (EUR logique pour un ancien voyage sans champ).

- Chaque activité du voyage est intégrée une fois : toutes catégories, idées et
  dates hors séjour incluses. Aucun prix de réservation distinct n’est ajouté :
  les champs financiers de l’activité sont la seule source.
- Chaque transfert est intégré une fois par identifiant, jamais par extrémité.
  Les identifiants sont préfixés par leur type pour éviter les collisions entre
  activité et transfert. Des doublons identiques d’une même source sont dédupliqués ;
  des valeurs contradictoires sont exclues avec un diagnostic.
- Un changement de journée/ordre/GPS ne supprime pas un coût de transfert du Budget,
  même si sa liaison est masquée sur la carte. En revanche, un transfert malformé,
  orphelin ou vers un autre voyage n’est pas intégré et est signalé.
- Deux enregistrements distincts ne sont pas fusionnés parce qu’ils ont un titre,
  une paire d’activités ou un prix identiques : rien ne permet d’inférer qu’il s’agit
  de la même dépense. L’écran n’ajoute aucune seconde copie d’un coût existant.

## Totaux et données incomplètes

Les estimations et paiements sont deux flux indépendants. Seuls les montants
présents entrent dans leur flux ; le moteur monétaire valide montant/devise/taux.
Cela évite de transformer une ancienne devise invalide en paiement exclu alors
qu’aucun paiement n’a été enregistré. Les absences restent comptées séparément.

Un total sans montant est `null`, jamais zéro. Zéro renseigné est affiché, mais
une conversion de zéro requiert elle aussi une devise et un taux utilisable.
Les sous-totaux convertibles, les montants manquants et les exclusions sont signalés.
Les montants originaux non intégrés restent visibles avec la cause (devise absente,
invalide, taux manquant ou montant invalide). Le détail des taux indique leur source,
leur date et leur valeur, sans déclencher de téléchargement.

Le **reste à payer connu** est calculé par élément possédant à la fois une estimation
et un montant payé : `max(estimation - payé, 0)` dans sa devise d’origine, puis
conversion par le moteur existant et somme sans arrondi intermédiaire. Ce n’est pas
la différence entre deux sous-totaux portant potentiellement sur des éléments différents.
Les éléments sans estimation ou paiement sont signalés comme incomplets, pas assimilés
à zéro. Un paiement dépassant l’estimation n’annule pas le reste des autres éléments.
Aucun remboursement ni crédit n’est inventé. Le reste n’est pas un solde comptable garanti.

Exemple EUR : activité estimée 100, payée 40 ; transfert estimé 20 sans paiement.
Le total estimé connu est 120, le total payé connu 40, le reste connu 60 avec un
élément incomplet. Afficher 80 de reste supposerait indûment que le transfert n’a pas été payé.

Le modèle actuel des transferts ne possède aucun `paidAmount` ni statut de paiement :
leurs coûts alimentent uniquement l’estimation. Le tableau de bord l’indique clairement.
Les statuts de réservation (`confirmed`, `cancelled`, etc.) ne prouvent ni paiement
ni remboursement et ne modifient aucun montant. Les paiements partiels des activités
sont pris en charge par leur `paidAmount` existant, sans créer d’historique de paiements.

## Limites et périmètre

Aucune migration Dexie V4, modification ZIP format 1, dépendance, répartition par
voyageur, formulaire de dépense, historique ou module financier parallèle. Le rendu
ne conserve aucun montant converti dans les données. Le calcul conserve la précision
IEEE-754 de JavaScript ; seul `Intl.NumberFormat` arrondit l’affichage selon la devise.
Un débordement numérique affiche un total indisponible. Une devise de référence
invalide ou une erreur de lecture affiche une erreur, jamais des totaux fabriqués.

## Validation

`tests/tripBudget.browser.tsx` est exécuté par `/tests/activities.html`, avec données
synthétiques et base isolée supprimée à la fin. Il couvre :

- calcul activités/transferts, collisions d’identifiants et doublons ;
- priorité manuelle/cache automatique, inverse refusé, taux manquant, devise historique ;
- zéro/absence, paiements partiels, reste incomplet, dépassements et réservations ;
- transferts dont la date a changé, orphelins, isolation et immutabilité ;
- décimales sans arrondi intermédiaire, débordement, devise de référence invalide ;
- réactivité après modification d’activité, transfert, taux ou devise ;
- état vide, exclusions visibles, erreur/réessai, clavier, 320/375/desktop, offline ;
- absence d’écriture au rendu et non-régression des autres suites.

PowerShell depuis `roam-v2/` :

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:pwa
npm.cmd run dev
```

Ouvrir `/tests/activities.html`, puis lancer la suite. Contrôles manuels :
1. Budget sans montants : état vide ; activité estimée à zéro : vrai zéro affiché.
2. Renseigner estimation 100 et paiement 40 : reste connu 60 ; retirer le paiement :
   reste inconnu, sans paiement fictif. Passer la réservation à « Réservée » ne change rien.
3. Ajouter un transfert coût 20 : estimation augmentée une seule fois, payé inchangé,
   transfert explicitement incomplet pour le reste.
4. Activité JPY avec/sans taux : priorité manuelle, montants exclus lisibles, provenance.
5. Modifier devise/taux dans les paramètres accessibles depuis Budget : synthèse actualisée.
6. Modifier activité/transfert dans un autre onglet : mise à jour immédiate ; recharger
   hors connexion : calcul depuis les données et derniers taux enregistrés.
7. Vérifier 320/375 px, les sections dépliables au clavier et les allers-retours vers
   Carte/Programme (caméra, filtres et sélections de 2.7 inchangés).
8. Export/restauration ZIP : aucun nouveau champ ni format, les montants restent originaux.

## Répartition par catégorie — 2.8b

`budgetCategories.ts` définit uniquement des groupes de présentation : aucun champ
n’est ajouté aux activités ni aux sauvegardes. Le modèle actuel possède les catégories
`visit`, `meal`, `transport`, `outing`, `rest`, `other`. Leur regroupement est explicite :

| Groupe affiché | Sources existantes |
| --- | --- |
| Hébergement | Non distingué dans le modèle actuel ; aucun montant supposé |
| Transport | Activités `transport` et transferts manuels |
| Restauration | Activités `meal` |
| Activités | Activités `visit` et `outing` |
| Autres | Activités `rest` et `other` |

Un repos n’est pas assimilé à un hôtel. Aucun nom de lieu, titre ou note ne sert à
deviner l’hébergement. Ses montants éventuellement enregistrés restent dans leur
catégorie réelle ; ils ne disparaissent pas du budget. Ajouter une catégorie stockée
spécifique n’entre pas dans cette étape sans modification de modèle autorisée.

`BudgetEntry` porte désormais son groupe (vue transitoire). `buildTripBudget` produit
les sous-totaux par groupe avec le même `totalsFor`, le même ledger dédupliqué et le
même instantané `RateResolver` que 2.8a. Les transferts entrent une fois dans Transport ;
leurs estimations ne créent jamais de paiements. Un doublon contradictoire sur la
catégorie d’une même activité est signalé, sans classement arbitraire.

`budgetCategoryDistribution` ne reconvertit aucun montant. Son dénominateur est
exactement le total connu et convertible du tableau de bord pour le mode choisi.
Un pourcentage vaut `(montant de catégorie / total connu) × 100`, sans arrondi de
calcul. L’affichage arrondit au dixième de pourcentage ; les libellés arrondis peuvent
par exemple totaliser 99,9 %. La dernière tranche SVG ferme uniquement les écarts
infimes de représentation flottante, sans modifier les montants ou pourcentages.

Les montants absents, invalides ou non convertibles n’entrent pas dans le dénominateur.
Les compteurs globaux et par catégorie les distinguent. Une catégorie sans montant
connu n’affiche ni zéro ni 0 %. Un vrai zéro, avec un total positif, affiche 0 % sans
tranche artificielle. Si le total connu vaut zéro, aucun anneau ni pourcentage n’est
inventé : la légende conserve les vrais montants à zéro. En absence de montant
convertible ou en dépassement numérique, un état explicite remplace l’anneau.

`BudgetCategoryChart.tsx` utilise du SVG natif, sans dépendance ni appel réseau.
Le sélecteur Estimés/Payés est accessible au clavier et reste dans le mode choisi
lors des mises à jour. Le SVG possède un titre et une description ; une légende
textuelle indique les cinq groupes, montants, pourcentages et données manquantes,
sans dépendre de la couleur. La grille s’adapte à la largeur réelle de son conteneur,
y compris 320/375 px. Le graphique ne produit aucune écriture et n’ajoute aucune
requête Dexie lors de la bascule. Les cartes, le reste connu et les exclusions de
2.8a conservent leurs règles.

Tests `tests/budgetCategories.browser.tsx`, intégrés à `/tests/activities.html` :
regroupements réels, hébergement non inventé, transferts/doublons, estimé/payé,
priorité manuelle/cache, taux manquant, absence/zéro, dénominateur et arrondis,
anneau sans total positif, overflow, immutabilité, mises à jour de catégorie,
paiement/taux/transfert, mode conservé, clavier, hors connexion et géométrie
320/375/desktop. La suite de 2.8a et celle de la carte restent exécutées.

Contrôles manuels complémentaires : vérifier l’anneau et la légende sur téléphone,
basculer estimé/payé au clavier, modifier une catégorie et un montant dans un autre
onglet, retirer un taux puis le rétablir, consulter hors connexion. Pour une activité
repos nommée « Hôtel », vérifier le classement explicite dans Autres et l’indication
« Hébergement : non distingué ». Aucun classement automatique n’est attendu.

## Budget par journée — 2.8c

Le ledger transitoire `BudgetEntry` reçoit la date locale de l’activité et, pour un
transfert, la date valide commune à ses deux activités. Les dates sont vérifiées
avec `parseDate`, les jours du séjour sont générés par `getTripDays` (UTC, bornes
incluses) comme dans le Programme. Aucune date n’est déduite de l’heure, de l’ordre,
de la création, du voyage ou d’une réservation. Les montants payés sont rattachés
à la journée prévue de l’activité, **pas à une date de paiement non enregistrée**.

Un transfert entre jours différents ou avec une date absente/invalide reste sans
journée attribuable, sans suppression de son coût global. Son ordre chronologique
ou ses GPS ne changent pas sa date budgétaire. Les dépenses valablement datées hors
séjour sont conservées à part avec leur date réelle, sans élargir artificiellement
le voyage. Deux groupes consultables « Sans journée attribuable » et « Hors des dates
du séjour » expliquent la différence entre les barres du séjour et les totaux globaux.

`buildTripBudget` construit les groupes journaliers, sans date et hors séjour par
un passage sur les mêmes entrées dédupliquées. Tous leurs totaux et les détails
par entrée utilisent `totalsFor`, `calculateFinancialTotals` et le même résolveur
en cache que 2.8a/2.8b. Les règles d’absence/zéro, paiements des transferts,
conversions et arrondis sont inchangées. Aucun calcul monétaire ne se trouve dans
le rendu des barres. `budgetDayDistribution` ne fait que sélectionner le flux
estimé/payé et rapporter les montants connus au maximum journalier connu pour
l’échelle graphique. Les fonctions de présentation communes sont regroupées dans
`budgetPresentation.ts` sans changer les règles de 2.8a.

`BudgetDayChart.tsx` affiche une barre/bouton par journée, avec montant numérique
et date (formatage ISO de la devise, aucun arrondi de calcul). « Plus élevé connu »
identifie tous les ex æquo positifs, jamais une journée dont le montant est absent
ou invalide. Les comparaisons portent uniquement sur les sous-totaux convertibles :
une journée incomplète peut avoir un coût réel supérieur à celui représenté.

Une journée sans entrée affiche « Aucune dépense » et aucun montant inventé. Une
entrée sans prix/paiement affiche « Non renseigné ». Les vrais zéros restent à
zéro avec un simple repère de base ; ils n’ont pas de fausse barre positive. Les
inconnus/exclusions sont marqués, les détails conservent les valeurs d’origine et
les causes de non-conversion. Aucun remboursement ou paiement implicite n’est ajouté.

Le mode Estimés/Payés est désormais un état partagé de `TripBudget` : les deux
sélecteurs de l’anneau et des journées sont synchronisés sans requête ni écriture.
Le choix et la journée sélectionnée restent stables lors des mises à jour valides.
Le graphique est défilable horizontalement dans son seul conteneur ; aucune remise
à zéro du scroll ne se produit au rendu. Le sélecteur de date permet d’atteindre
rapidement une journée d’un long séjour, et un bouton donne le focus au détail.
Les jours et leurs détails sont accessibles au clavier sans dépendre des couleurs.

Tests : `tests/budgetDays.browser.tsx`, intégré à `/tests/activities.html`, couvre
les dates inclusives/décembre–janvier, transferts sans doublons et dérive de date,
flux estimé/payé, conversions/taux manquants, absences/vrais zéros/journées vides,
rapprochement avec les totaux globaux, groupes sans date/hors séjour, ex æquo,
précision, séjour de plus de 180 jours, mode partagé, détails/focus/sélecteur,
réactivité activité/transfert/taux, géométrie 320/375/desktop et fonctionnement
offline sans écriture au rendu. Les repositories et leurs règles de cohérence
restent inchangés (corriger la journée commune avant de modifier un transfert).

Contrôles manuels complémentaires :
1. Sur téléphone, faire défiler les barres sans déplacer la page horizontalement,
   sélectionner une journée puis consulter son détail (montants et dates complets).
2. Basculer Estimés/Payés depuis les deux graphiques : ils suivent le même mode.
3. Comparer un jour vide, un montant nul, un prix absent et une devise sans taux.
4. Déplacer une activité liée à un transfert vers un autre jour : son coût reste
   visible sans journée attribuable ; corriger les dates le replace une seule fois.
5. Créer une idée sans date et une activité hors séjour : vérifier les groupes
   séparés et les totaux globaux conservés.
6. Modifier montant, taux ou dates du voyage dans un autre onglet : actualisation,
   conservation de sélection si elle reste valide et absence de dates inventées.
7. Vérifier un séjour long, les années/mois traversés, 320/375 px, clavier et offline.

Aucune modification Dexie V4, ZIP format 1 ou dépendance ; aucun montant converti
ou regroupement journalier n’est persisté. Pas d’implémentation de 2.8d/2.8e.
