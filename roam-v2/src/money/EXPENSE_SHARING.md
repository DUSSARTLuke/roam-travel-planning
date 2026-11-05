# Partage des dépenses — 2.8d

## Extension des données

Trip possède deux champs optionnels : `participants` (identifiant stable et nom)
et `expenseShares` (référence type/identifiant de dépense, payeur, bénéficiaires
pondérés, instantané du montant/devise réellement payé et date de modification).
Aucune population automatique depuis `travelers` : le nombre de voyageurs reste
indépendant. Les anciennes dépenses ne sont pas partagées automatiquement.

Les activités utilisent leur `paidAmount`/`currency` existants. Les transferts
reçoivent un `paidAmount?` optionnel, en un seul endroit canonique ; le formulaire
rapide existant le préserve s’il ne l’édite pas. La saisie du paiement dans le partage
est explicite et peut confirmer un paiement partiel, sans toucher à l’estimation.
La devise se renseigne dans la dépense existante, jamais par remplissage historique.

Conformément au périmètre demandé, les synthèses, catégories et journées 2.8a–c
conservent leurs règles, notamment leur exclusion des paiements de transferts.
Ceux-ci sont pris en compte dans les soldes du partage. L’interface précise cette
limite pour ne pas confondre les périmètres. Le snapshot du partage ne crée pas un
second paiement : il sert à détecter une modification ultérieure du paiement source.
Aucune nouvelle table/index : Dexie V4 et ZIP format 1, champs optionnels validés.

## Règles de calcul

- Un payeur par dépense et un montant payé cumulé. Le partage n’est pas un historique
  de versements ; plusieurs payeurs sur la même dépense ne sont pas modélisés ici.
- Les bénéficiaires ont des poids entiers strictement positifs, 1 chacun par défaut.
  Le payeur peut ne pas être bénéficiaire. Ajouter un participant n’ajoute pas celui-ci
  aux partages déjà enregistrés ; les allocations sont explicites.
- Seuls les paiements sources connus et identiques à l’instantané confirmé entrent
  dans les soldes. Un montant/devise changé ou supprimé produit une exclusion visible
  jusqu’à revalidation. Une estimation/réservation ne prouve pas un paiement.
- `createTripRateResolver` et `convertMoney` conservent les règles existantes : paire
  ordonnée exacte, priorité manuelle puis cache automatique local, aucun taux inverse
  ou fictif, aucun réseau dans ce module. Un taux absent/invalide exclut la dépense.
- Après conversion, chaque paiement est arrondi dans la plus petite unité de la
  devise de référence (EUR 2 décimales, JPY 0, KWD 3) : demi-unité positive arrondie
  vers le haut. La mise à l’échelle utilise l’écriture décimale de Number pour éviter
  l’erreur classique de 1.005 × 100. La conversion conserve la précision IEEE-754 du
  moteur existant ; ce n’est pas de l’arithmétique décimale arbitraire des taux.
- La répartition utilise BigInt : quotients entiers, puis plus forts restes, avec
  départage stable par identifiant. La somme des parts égale exactement le paiement
  arrondi. Les soldes sont en unités entières ; aucun centime n’est créé ou perdu.
- Les montants ou agrégats au-delà des entiers sûrs sont refusés/exclus explicitement.
  Le formatage des unités utilise les parties Intl et BigInt, sans division flottante
  pouvant perdre un centime sur les grands nombres.
- Solde = payé − part. Les remboursements proposés relient débiteurs et créditeurs
  avec des montants entiers conservant l’équilibre. Ce n’est pas une optimisation
  garantie du nombre de virements. Aucune proposition n’est marquée payée automatiquement.
  Les calculs sont partiels si des partages sont exclus, et cela reste indiqué.

L’arrondi par dépense partagée peut créer une différence de présentation d’un centime
avec le budget global, qui conserve son calcul non arrondi avant affichage. Aucun
arrondi de partage n’est écrit dans les activités, transferts ou anciens totaux.

## Persistance, suppression et concurrence

Le repository relit le voyage et la dépense dans une transaction trips/activities.
Le paiement et sa répartition sont enregistrés atomiquement. Un échec annule les
deux écritures, les saisies restent visibles. La version attendue porte sur le
paiement, sa devise et ce partage ; une modification concurrente est refusée.
Les autres champs/partages/participants du voyage sont fusionnés depuis la dernière
lecture, sans remplacer un objet voyage obsolète. Les transactions sérialisent
l’ajout d’une référence et la suppression d’un participant entre onglets.

Renommer conserve l’identifiant ; supprimer exige confirmation et échoue si le
participant est payeur ou bénéficiaire d’un partage. Il faut d’abord modifier ou
retirer ces partages. Retirer un partage conserve le paiement et la dépense.
Supprimer définitivement une activité enlève ses partages et ceux des transferts
supprimés par la cascade ; supprimer un transfert enlève son partage. Ces nettoyages
sont dans les transactions existantes. Une suppression de voyage enlève l’ensemble
avec l’objet voyage. Archivage/corbeille conservent participants/allocations.
La duplication d’un voyage reprend les noms avec de nouveaux IDs de participants,
sans copier de partages ni de dépenses (comportement de duplication existant).

Les formulaires utilisent les modales existantes, la protection PWA, Échap/fond,
une confirmation d’abandon des saisies, des champs désactivés pendant l’écriture
et un verrou anti-double soumission. Les boutons de suppression sont confirmés.

## Validation et tests

`tests/expenseSharing.browser.tsx` utilise uniquement des bases synthétiques isolées :
solo/couple/groupe, égal/pondéré, unités/arrondis, partialité, paiements inconnus,
priorité des taux/cache, référence, données anciennes non activées, équilibre des
remboursements, CRUD, participants référencés, conflit d’écriture, course suppression/
attribution, rollback paiement/partage, réouverture, cascades, V4/ZIP1 aller-retour,
archive valide mais références de partage altérées rejetée, formulaires offline,
validation/saisies conservées, double soumission, Échap et 320/375/desktop.
La suite 2.8a–c et les tests Carte/documents/ZIP restent exécutés.

Depuis PowerShell dans roam-v2 :

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:pwa
npm.cmd run dev
```

Lancer `/tests/activities.html`. Vérifications manuelles :
1. Ajouter/renommer les personnes, sans modifier le nombre de voyageurs existant.
2. Une ancienne activité à 100 estimés sans paiement ne crée aucune dette. Activer
   son partage et confirmer 40 payés par Alice pour Alice/Bob : parts 20, Bob doit 20.
3. Modifier les poids, exclure une personne, tester 0,01 à trois et JPY/KWD.
4. Vérifier les paiements de transferts ici et les périmètres de synthèse distincts.
5. Modifier un paiement dans un autre onglet : exclusion, puis revalidation explicite.
6. Essayer de supprimer un participant utilisé ; retirer le partage conserve le
   paiement, puis permet la suppression du participant sans référence restante.
7. Test clavier/mobile, fermeture/abandon, absence réseau, erreur de stockage,
   export/restauration et indépendance entre voyages.
8. Aucun remboursement n’est enregistré dans cette étape ; pas d’implémentation 2.8e.
