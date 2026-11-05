# Finitions du Budget — 2.8e

Le voyage possède un `plannedBudget?` contenant un montant fini non négatif et
sa devise ISO d'origine. Pas de migration ni de remplissage historique : zéro est
un budget défini, un champ vide le retire. La duplication conserve les deux champs,
les sauvegardes restent V4/format 1. La validation est partagée par repository,
export et restauration. Aucun autre champ du voyage n'est remplacé : transaction,
relecture et comparaison du prévisionnel attendu pour détecter un conflit d'onglets.
Les saisies sont conservées en cas d'erreur ; un abandon de saisie exige confirmation.
La protection des opérations et formulaires PWA existante est réutilisée.

Disponible = prévisionnel converti via le moteur/taux locaux existants moins le
**total estimé connu du voyage entier**. Aucune modification des calculs 2.8a–d.
Une estimation absente, non convertible ou invalide rend la comparaison provisoire,
même si un dépassement est déjà connu. Une conversion du prévisionnel impossible
ne produit pas de faux disponible. Une liste réellement vide a zéro dépense connue.
Un changement de devise du voyage ne réinterprète pas le montant original.
Ce disponible n'est ni un solde bancaire ni le reste à payer. Les taux peuvent être
anciens ; les informations de provenance/dates restent dans les sections existantes.

Les filtres catégorie/journée/paiement concernent uniquement « Consulter les dépenses »,
jamais les synthèses, graphiques ou partages globaux. Ils réutilisent `BudgetEntry`
et les `entryTotals` déjà calculés ; aucune conversion ou requête supplémentaire.
Sans date et hors séjour restent accessibles. Paiement inconnu, zéro confirmé,
partiel et estimation couverte sont distingués ; un montant positif sans estimation
ne prouve pas que la dépense est soldée. Les réservations n'interviennent pas.
Le périmètre historique des transferts reste inchangé : estimations dans les totaux,
paiements dans le partage uniquement, ce que précise l'interface.

L'application garde par voyage les filtres, mode estimé/payé, dépense sélectionnée pour le partage et journée du graphique
pendant la navigation entre onglets, en mémoire (pas après fermeture/rechargement).
Les contrôles sont natifs et tactiles ; les listes et graphiques restent accessibles
hors connexion, sans requête réseau ajoutée. Les tables et barres longues défilent
dans leur propre conteneur, les actions du partage s'empilent sur petit écran.

## Vérifications

Depuis PowerShell dans roam-v2 :

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:pwa
npm.cmd run dev
```

Lancer `/tests/activities.html` : bases synthétiques isolées seulement.
Les tests couvrent absence/zéro/dépassement/inconnus, conversion et manque de taux,
filtres combinés et statuts, anciennes données, duplication, persistance, conflits,
champs concurrents, ZIP/restauration, formulaires/erreur/abandon/double soumission,
conservation de navigation et géométrie 320/375/desktop. La suite antérieure complète
reste exécutée, notamment partage, Carte, documents, SHA-256 HTTP et PWA.

À vérifier sur téléphone réel : saisie virgule, sélecteur devise, clavier virtuel,
fermeture et abandon ; aller-retour Budget/Programme/Carte ; modification d'une dépense
ou d'un taux dans un autre onglet ; filtres sur sans date/hors séjour ; hors connexion.
Vérifier qu'un prévisionnel dans une autre devise garde sa valeur d'origine et que
l'absence de taux donne une comparaison indisponible. Aucun règlement de remboursement,
notification ou autre fonctionnalité du cycle suivant n'est ajouté.
