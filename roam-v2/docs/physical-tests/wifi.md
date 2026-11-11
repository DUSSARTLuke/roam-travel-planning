# Tests Wi-Fi HTTP — interface uniquement

Exemple de configuration : PC Windows sur Wi-Fi privé, adresse **192.168.50.10**. Cette adresse est fictive : utiliser l’adresse affichée par le serveur sur son propre réseau. Les commandes ci-dessous sont des exemples, pas un relevé du poste de développement.

## 1. Autorisation locale (PowerShell administrateur)

Uniquement si ce Wi-Fi est bien votre réseau domestique/de confiance :

```powershell
Set-NetConnectionProfile -InterfaceAlias 'Wi-Fi' -NetworkCategory Private
New-NetFirewallRule -Name 'RoamTest-Wifi-48622' -DisplayName 'Roam TEST Wi-Fi temporaire' -Direction Inbound -Action Allow -Profile Private -Protocol TCP -LocalPort 48622 -LocalAddress 192.168.50.10 -RemoteAddress LocalSubnet -InterfaceAlias 'Wi-Fi' -Program 'C:\Program Files\nodejs\node.exe'
```

Ne pas désactiver le pare-feu, autoriser tous les ports, modifier les règles de blocage publiques ou configurer une redirection de port sur le routeur. Pas de tunnel. Cette règle autorise les appareils du sous-réseau local, sans authentification : uniquement des fixtures. Ne pas utiliser sur un Wi-Fi public/partagé non fiable. Une règle administrateur plus restrictive peut toujours bloquer cet accès.

## 2. Démarrage (PowerShell normal)

```powershell
Set-Location 'C:\Projets\roam-travel-planning\roam-v2'
node.exe tests/verify-candidate.mjs
node.exe docs/physical-tests/check-wifi.mjs
node.exe docs/physical-tests/serve-wifi.mjs
```

Le serveur vérifie l’inventaire de la copie TEST existante, se lie uniquement à l’IPv4 privée du réseau déclaré Private, port **48622**, et affiche l’URL. Il ne se lie pas à toutes les interfaces. Le candidat et le ZIP fictif existants sont réutilisés sans modification ; aucune compilation ni migration de profil réel.

Sur Android : **http://192.168.50.10:48622/wifi-test/**.

La page vérifie que cette origine ne contient pas déjà une base inconnue, puis permet de la réserver pour TEST. Télécharger son ZIP fictif, ouvrir Roam avec le lien, puis Plus → Restaurer → sélectionner ce ZIP uniquement → aperçu → confirmation. Ne pas utiliser `/test-tools/`, réservé au localhost sécurisé USB. Ne pas importer de ZIP personnel.

Tester navigation, activités, déplacements, hébergements, formulaires/clavier, documents et carte en ligne. Utiliser les jours du 13 au 16 novembre pour les données fictives. Les informations restent dans l’origine IP:48622, distincte de la V2 publique et du test USB. HTTP n’est **pas** une validation d’installation PWA, de service worker ou de démarrage hors connexion ; ne pas installer ce raccourci comme preuve PWA.

Si inaccessible : vérifier l’URL affichée (DHCP peut changer l’IP), le même Wi-Fi, l’absence de réseau invité/isolation des clients et de VPN interférant. Si l’IP change, réexaminer aussi la règle pare-feu ; ne pas élargir son périmètre. L’accès réel du téléphone reste à vérifier ; le runner teste le routage HTTP et les refus sur loopback, sans prouver la traversée du pare-feu.

## 3. Arrêt

Ctrl+C sur le serveur. PowerShell administrateur :

```powershell
Remove-NetFirewallRule -Name 'RoamTest-Wifi-48622'
```

Si souhaité, remettre le profil Wi-Fi Public après les tests avec `Set-NetConnectionProfile -InterfaceAlias 'Wi-Fi' -NetworkCategory Public`. Ne pas effacer globalement Chrome : les données fictives sont sur l’origine IP:48622 seulement. Aucun outil de nettoyage automatique Wi-Fi n’est ajouté ; le nettoyage localhost USB ne s’applique pas ici.

## HTTPS ultérieur, non installé

Solution LAN possible : certificat de développement pour une IP réservée ou un nom local stable, signé par une autorité locale dédiée (par exemple mkcert), serveur HTTPS lié à cette seule interface et confiance explicitement installée sur Android. Les clés privées/clé racine restent hors dépôt et hors serveur ; seule la racine publique est distribuée. Vérifier réellement l’absence d’erreur TLS et `isSecureContext`, puis tester PWA/cache hors ligne sur cette nouvelle origine HTTPS distincte. Ne pas contourner un avertissement TLS comme validation. Installation d’autorité à approuver séparément ; la retirer après tests si dédiée. [Documentation officielle mkcert](https://github.com/FiloSottile/mkcert).

Alternative plus simple pour une installation autonome : hôte HTTPS de préversion distinct, après autorisation explicite de déploiement. Aucun hébergement, certificat ou tunnel mis en place ici. Un autre chemin GitHub Pages sous le même hôte ne suffit pas à isoler IndexedDB.

## Vérifications exécutées

- Syntaxe du script : réussie.
- Serveur temporaire loopback : page Wi-Fi, index et ZIP fictif accessibles ; Host inattendu, traversée de chemin et IP publique refusés ; réussi, serveur arrêté.
- Tentative réelle : refus attendu car Wi-Fi Public ; aucune modification de sécurité automatique.
- Empreinte du candidat et diff : vérifiés séparément.
- Non exécutés : connexion du téléphone au PC, passage réel du pare-feu, gestes/clavier Android ; nécessitent le changement de confiance du réseau et le téléphone physique.

> Exemples portables : `192.168.50.10` est une adresse LAN fictive à remplacer par celle affichée par le serveur ; `C:\Projets\roam-travel-planning` est un chemin d’exemple. `%USERPROFILE%` désigne le profil Windows courant.
