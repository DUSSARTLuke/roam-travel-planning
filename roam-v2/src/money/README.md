# Moteur monétaire local — 2.5.4b

`convertMoney` applique 1 unité source = taux × unités cibles. Une identité utilise
1 sans résolveur. Un taux explicitement fourni mais invalide est toujours refusé,
même en identité. Les codes sont normalisés via la validation partagée.

Résultats discriminés : converted, absent (amount undefined), unavailable (devise
ou taux manquant), invalid (donnée invalide ou dépassement numérique). Une devise vide est
manquante ; un code inconnu est invalide. Les montants négatifs sont refusés comme
dans les activités actuelles. Aucun taux n'est inféré, y compris pour convertir zéro.
Les valeurs fournies invalides sont vérifiées avant de traiter l'absence de montant.

`calculateFinancialTotals` accepte des objets structurellement compatibles avec
TripActivity, sans importer le modèle ni IndexedDB. Estimations et paiements sont
calculés séparément. Les absences sont comptées sans être des exclusions ; chaque
exclusion indique id, index et résultat motivé. Un total sans montant vaut null
(status absent), un total non convertible vaut null (unavailable), un vrai zéro
converti vaut 0. Un sous-total partiel est explicitement partial ; consulter ses
exclusions pour distinguer données invalides et taux manquants. Une multiplication positive réduite à zéro par sous-dépassement est refusée
(underflow). Un débordement de somme produit invalid/null, jamais Infinity.

RateResolver est une lecture synchrone pure d'un instantané déjà disponible :
paire source/cible ordonnée, résultat disponible (taux, origine manual/automatic,
date optionnelle), indisponible ou invalide. Le même résultat de paire est utilisé
pour les deux totaux pendant un appel. Une exception devient resolver-error.
Le choix manuel/automatique et la récupération/persistance sont hors du moteur.

Aucun arrondi n'est appliqué aux conversions ou sommes. `formatMoney` arrondit
uniquement la présentation via Intl.NumberFormat et les décimales de la devise
(EUR 2, JPY 0, KWD 3). Les calculs utilisent les number existants : précision IEEE-754,
pas d'arithmétique décimale exacte ; aucune garantie comptable au-delà de cette
précision. Les objets d'entrée ne sont jamais modifiés. Pas de taux réseau, cache,
interface, modification de modèle, schéma ou format ZIP.

Tests : `/tests/activities.html` via Vite dev inclut `tests/money.browser.ts`.
Les fonctions sont indépendantes du navigateur hormis Intl, également disponible
sous Node. Après installation existante : npm.cmd run lint et npm.cmd run build.

## Taux manuels — 2.5.4c

`manualRates.ts` valide les taux et produit un `RateResolver` à partir d'une copie
de l'instantané du voyage. Une paire manuelle exacte prévaut sur un résolveur
de repli optionnel, même si celui-ci proposerait un autre taux. Aucun inverse
ou taux croisé n'est calculé. Aucun résolveur automatique n'est implémenté.

Les paramètres sont modifiés dans le formulaire du voyage puis enregistrés
ensemble. Virgule et point sont acceptés ; séparateurs de milliers, valeurs
nulles/négatives/non finies et paires identiques/dupliquées sont refusés. La
notation scientifique est acceptée pour pouvoir rééditer les petits nombres
stockés sans arrondi de présentation. Précision : celle de JavaScript number.

La transaction relit le voyage, fusionne les paires modifiées depuis l'ouverture
du formulaire et préserve les autres. Une modification concurrente de la même
paire bloque la sauvegarde, en gardant les saisies affichées. Les champs usuels
non modifiés par l'utilisateur sont aussi préservés ; un conflit sur un champ
modifié est refusé. Il faut conserver ses saisies puis fermer/rouvrir le formulaire
pour réconcilier un conflit. Les dates ne changent que pour les taux nouveaux ou
modifiés. Archivage/corbeille conservent les taux ; duplication les copie.
