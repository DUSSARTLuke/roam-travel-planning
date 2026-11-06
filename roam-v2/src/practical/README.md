# Infos pratiques — 2.9d

Un raccourci « Infos pratiques » de l'accueil ouvre le carnet du voyage actif.
Il contient contacts (nom, téléphone/e-mail), adresses et notes, avec catégories
Hébergement, Transport, Santé et urgences, Rendez-vous et Autres, recherche par mots
insensible à la casse/aux accents et filtre de catégorie. Aucune donnée d'exemple,
contact ou numéro d'urgence n'est créé automatiquement.

## Persistance

Le champ optionnel `Trip.practicalRecords?` évite une nouvelle table ou migration :
Dexie V4 et ZIP format 1 conservés. Ancien voyage sans champ = aucune fiche manuelle,
sans réécriture. Au maximum 300 fiches, titres 200 caractères, adresses 1 000, notes
5 000. Chaque fiche a un identifiant stable et ses dates techniques ISO. Les trois
types ont une validation stricte et n'acceptent pas les champs d'un autre type.
Le type d'une fiche existante est conservé pour éviter de perdre ses coordonnées ;
pour changer de type, créer une nouvelle fiche puis supprimer l'ancienne après vérification.

Le repository relit le voyage dans une transaction trips, vérifie son accessibilité
et la version exacte de la fiche modifiée, fusionne avec les autres fiches récentes
puis met à jour uniquement practicalRecords. Les mises à jour d'autres champs ou
fiches entre onglets sont préservées ; un conflit sur la même fiche est refusé.
Une erreur annule l'écriture et conserve la saisie. Protection contre les doubles
soumissions et réutilisation des verrous/formulaires PWA existants. La suppression
est confirmée, Échap/fond et abandon des modifications sont gérés par la modale
existante. Le focus revient au bouton d'origine ou à l'ajout après suppression.

Le lecteur transactionnel trips/activities reçoit les fiches et lieux dans un
instantané réactif cohérent, sans ouvrir aucune table de Blob. Les données suivent
useLiveQuery, y compris les écritures d'un autre onglet. La recherche n'ajoute pas
de requête. Le changement de voyage démonte l'état du carnet précédent. Les erreurs
de lecture sont distinguées d'un carnet vide, avec possibilité de réessayer.

La duplication reprend le contenu avec de nouveaux IDs et dates techniques ;
l'archivage/corbeille conserve le carnet, qui redevient accessible après restauration.
La suppression définitive du voyage enlève les fiches embarquées avec lui. Les
archives ZIP préservent les fiches, leurs types, champs et identifiants, avec
validation à l'export/restauration. Aucune ancienne sauvegarde n'est réécrite.

## Réutilisation des activités

Les textes de lieux/adresses existants sont affichés automatiquement sans les copier
sur le voyage. Les textes d'adresse identiques après normalisation de casse et
espaces sont regroupés avec leurs activités sources. Les accents restent distincts
pour ce regroupement ; ils sont ignorés uniquement pour la recherche. Cela ne
prétend pas identifier automatiquement un lieu physique. Si une fiche manuelle
contient le même texte d'adresse, les sources sont affichées sur cette fiche plutôt
que dans une carte supplémentaire. Les fiches manuelles distinctes créées
explicitement ne sont pas effacées ni fusionnées en base.

Les lieux d'activités ne possèdent pas tous un téléphone ou un e-mail : aucun contact
n'est déduit de notes, prestataires ou participants. Les lieux sans adresse lisible
ne sont pas transformés en coordonnées postales fictives. L'accès à la source
réutilise les fiches et formulaires ActivityDetailPanel/ActivityFormPanel ; modifier
la source actualise le carnet. Supprimer une fiche manuelle ne modifie jamais les
activités : l'adresse source reste disponible. Une ancienne adresse très longue ou
non prise en charge reste affichable et copiable même si son lien ne peut être créé.

## Liens, copie et confidentialité

Les liens téléphone utilisent uniquement tel: et des chiffres normalisés (+ optionnel).
Les e-mails utilisent mailto: avec destinataire encodé, sans paramètres de message ni
injection d'en-têtes. La validation contrôle le format usuel, pas la réalité ou la
joignabilité du contact. Les adresses produisent une URL HTTPS Google Maps avec
query encodée, sans clé/API ou requête automatique. L'ouverture est une action
explicite dans l'application associée si disponible, sinon dans le navigateur :
[documentation officielle Maps URLs](https://developers.google.com/maps/documentation/urls/get-started).
La carte externe peut nécessiter Internet ; le texte reste lisible hors connexion.

La copie ne lit jamais le presse-papiers. Elle n'annonce un succès qu'après résolution
de writeText. En HTTP non sécurisé (cas d'une adresse LAN), navigateur incompatible
ou permission refusée, un panneau fournit le texte sélectionnable, sans faux succès
ni usage de document.execCommand :
[documentation MDN writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText).
La copie manuelle fonctionne par Ctrl+C ou menu Copier/appui long du système.

Le carnet et ses sauvegardes ne sont pas chiffrés. L'interface et les formulaires
avertissent explicitement d'éviter mots de passe, codes bancaires et autres secrets
sensibles. Ce carnet n'est pas un gestionnaire de mots de passe ; il n'offre aucune
promesse de confidentialité supplémentaire. Aucun contenu existant n'est déplacé,
exporté ou copié dans le presse-papiers sans action explicite. Pas d'appel réseau,
de nouvelle dépendance ou de fonction de l'étape 2.9e.

## Vérifications

Depuis PowerShell dans roam-v2 :

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:pwa
npm.cmd run dev
```

Lancer `/tests/activities.html`. Les tests practical.browser.tsx utilisent des bases
synthétiques isolées et un presse-papiers simulé : CRUD des trois types, catégories,
recherche, liens sûrs, absence/refus/succès de copie, sélection manuelle, sources
regroupées/réactives/non modifiées, concurrence et rollback, champs préservés,
anciennes données, duplication, ZIP/restauration et archive invalide, archivage/
corbeille, saisies conservées, doubles soumissions, focus, changement de voyage,
offline et largeurs 320/375/desktop. Aucun appel, e-mail, lien externe ou presse-papiers
système n'est déclenché dans les tests. La suite antérieure complète est conservée.

À vérifier sur téléphone réel : création de contact/adresse/note avec clavier virtuel,
appui long/copie en HTTP et copie autorisée en HTTPS, ouverture de liens vers les
applications configurées sans valider d'appel/e-mail de test, retour des fiches,
modification depuis deux onglets et rechargement offline. Vérifier une duplication
et un aller-retour ZIP sur un voyage d'essai. Ne pas utiliser de vrais secrets
pour tester les notes ou avertissements.

## Validation des contacts — 2.9d.1

Audit : les liens validaient déjà certains formats, mais le téléphone acceptait
1 à 20 chiffres, l'e-mail laissait passer des points locaux consécutifs et les
messages n'étaient pas reliés aux champs. La validation stricte de toute la liste
lors de sa lecture bloquait le carnet pour un ancien contact mal formé.

Les téléphones acceptent espaces ordinaires/insécables, tirets, points, parenthèses
équilibrées et + uniquement au début. Règle de plausibilité : 3 à 15 chiffres sans
+, pour permettre les numéros courts locaux, ou 7 à 15 chiffres avec + et premier
chiffre non nul. Exception française explicite : les numéros commençant par 0
(hors préfixe international 00) doivent avoir 10 chiffres, le second étant 1 à 9 ;
+33 et 0033 exigent 9 chiffres après l'indicatif, sans zéro initial.
Ainsi +336666699 est refusé, +33612345678 et 0612345678 sont acceptés.
Le préfixe international explicite 00 devient + dans le lien tel: uniquement ;
le texte enregistré reste inchangé. Aucun pays n'est deviné pour les autres
numéros, aucun zéro national n'est retiré implicitement. Les numéros étrangers
sans indicatif débutant par 0 doivent être saisis avec leur indicatif international.
Il ne s'agit pas d'une vérification de joignabilité.
Les e-mails sont limités à 254 caractères (64 avant @), sans espace interne,
avec un domaine usuel et sans point initial/final/consécutif avant @ ni injection
d'en-têtes. Les espaces extérieurs sont retirés à l'enregistrement. Les champs
facultatifs peuvent être tous deux vides : un contact peut être nommé puis
complété plus tard. Les blancs deviennent des champs absents.

Le formulaire affiche les erreurs après sortie de champ ou tentative d'enregistrement,
sous le champ concerné, reliées par aria-describedby/aria-invalid, et place le focus
sur la première coordonnée invalide. Il ne dépend pas des bulles natives du navigateur.
Les mêmes fonctions bloquent les écritures directes dans le repository.

Une lecture de données stockées peut conserver des anciennes coordonnées **textuelles**
invalides, sans les normaliser ni modifier IndexedDB. Les liens invalides ne sont
pas créés ; la valeur originale et un message de correction restent visibles et
copiables. Modifier ou supprimer d'autres fiches reste possible. Une modification
du contact lui-même exige de corriger ou vider les champs invalides. La duplication
conserve les valeurs originales ; aucune migration ou réécriture de masse.
La validation des archives et des nouvelles valeurs reste stricte : corriger les
coordonnées signalées avant d'exporter une sauvegarde qui les contient.

`tests/contactValidation.browser.tsx` complète la suite avec formats locaux et
internationaux, espaces/longueurs/parenthèses, e-mails mal formés, facultatifs vides,
rejet du repository sans écriture, anciens contacts lisibles/supprimables/corrigeables,
préservation des valeurs, liens désactivés, messages sous champs et attributs ARIA.
L'ancienne assertion qui refusait deux coordonnées vides est remplacée par une
assertion positive conformément à la nouvelle règle ; les autres refus restent testés.
