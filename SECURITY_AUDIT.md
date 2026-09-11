# Audit de sécurité - Carnet de route Accra 2026

Date : 2026-09-11
Périmètre : code du repo (`index.html`, `js/`, `css/`, `sw.js`, `firestore.rules`,
`manifest.webmanifest`), hébergement GitHub Pages, projet Firebase associé, et
usage sur les appareils du groupe (PWA installée sur mobile).

Verdict général : le site est un petit carnet de voyage statique, sans
compte ni donnée sensible (pas de mot de passe, pas de paiement, pas de
données médicales/financières). Le code applique déjà de bons réflexes
(échappement HTML systématique, règles Firestore qui valident la forme des
documents, redimensionnement des photos côté client). Aucune faille
critique (RCE, XSS exploitable, fuite de secret) n'a été trouvée. Les points
ci-dessous sont classés par sévérité, avec le risque réel dans ce contexte
(usage privé entre amis) plutôt qu'un barème générique.

## Résumé (priorités)

| # | Sujet | Sévérité | Effort correctif |
|---|-------|----------|-------------------|
| 1 | Le dépôt GitHub est **public** : l'URL du site n'est plus "confidentielle par le lien" | Moyenne | Faible |
| 2 | Firestore : écriture publique **sans limite de quantité ni de débit** (spam / coût) | Moyenne | Faible-Moyen |
| 3 | Pas de garantie que les règles publiées en prod correspondent à `firestore.rules` | Moyenne | Faible |
| 4 | Absence de Content-Security-Policy | Faible | Faible |
| 5 | SDK Firebase chargé depuis gstatic.com sans intégrité vérifiable (dépendance tierce à l'exécution) | Faible | Moyen |
| 6 | Rien ne borne `placeId` aux lieux réels côté règles (documents "orphelins") | Faible | Faible |
| 7 | Données de voyage (adresses de logement, dates précises) publiées en clair sur un repo public | Info / vie privée | Décision produit |
| 8 | Bons points à conserver | - | - |

## 1. Dépôt GitHub public → l'URL du site n'est plus secrète

Le modèle de sécurité du site (documenté dans le README) repose sur l'idée
que **seul le lien compte** : "pas un site public à grande audience... lien
non indexé". Or le dépôt `davy-evrard/accratrip` est **public** sur GitHub,
avec GitHub Pages activé. Conséquences concrètes :

- L'URL du site (`https://davy-evrard.github.io/accratrip/`) est déductible
  directement du nom du dépôt et de son propriétaire - ce n'est pas un
  secret, ni même une URL "non devinable".
- Le dépôt (issues, code, historique de commits) est indexable par les
  moteurs de recherche et par la recherche GitHub elle-même.
- Toute personne qui tombe sur le dépôt (recherche, lien partagé par
  erreur, scan automatisé de GitHub Pages) peut ouvrir le site et - comme
  les règles Firestore l'autorisent sciemment - cocher des lieux, poster
  des notes, changer le planning ou ajouter des photos à la place du
  groupe.

**Recommandation** : accepter ce risque en connaissance de cause (usage
entre amis, faible enjeu) **ou** réduire la surface :
- Passer le dépôt en privé si l'hébergement le permet (GitHub Pages sur
  dépôt privé nécessite un plan payant) ;
- Ou ajouter un léger obstacle anti-badaud côté Firestore (ex. exiger un
  champ `code` correspondant à un mot de passe simple partagé par lien,
  vérifié dans les règles) sans aller jusqu'à un vrai système de comptes.

## 2. Firestore ouvert en écriture publique sans limite de quantité/débit

Les règles (`firestore.rules`) valident bien la **forme** de chaque
document (champs autorisés, types, tailles max), ce qui empêche d'injecter
des données arbitraires. En revanche, rien ne limite :

- le **nombre** de documents qu'un visiteur peut créer (un `placeId`
  arbitraire, pas seulement ceux de `data.js`, est accepté par les règles) ;
- la **fréquence** des écritures (pas de throttling) ;
- dans `photos`, chaque document peut peser jusqu'à ~400 Ko : un script qui
  boucle sur `setDoc` avec des `placeId` aléatoires peut générer un volume
  de stockage et de bande passante Firestore arbitraire.

Comme le SDK Firebase est appelé côté client sans clé secrète (normal ici),
n'importe qui peut aussi taper directement l'API Firestore (REST ou SDK)
sans passer par le site, avec un script. Le risque principal n'est pas le
vol de données (déjà publiques en lecture) mais un **abus de quota /
facturation** sur le projet Firebase, ou un **vandalisme de masse** (toutes
les notes remplacées par du spam).

**Recommandations, du plus simple au plus robuste** :
- Activer des **quotas/alertes de facturation** sur le projet Firebase
  (budget d'alerte GCP) pour être notifié en cas de pic anormal ;
- Ajouter **Firebase App Check** (reCAPTCHA v3 ou App Check "debug" pour un
  usage restreint) pour filtrer le trafic qui ne vient pas du site lui-même ;
- Comme déjà noté dans le README du projet, envisager `signInAnonymously()`
  + un champ d'auteur dans les règles pour pouvoir limiter le débit par
  utilisateur si un abus est constaté.

Vu l'usage réel (5-10 amis, quelques jours), ce risque est **théorique**
tant que le lien reste discret, mais devient réel dès le point 1 ci-dessus
(dépôt public) - les deux sont liés.

## 3. Pas de garantie que les règles en prod = `firestore.rules`

`firestore.rules` est un fichier de référence à coller manuellement dans la
console Firebase (étape documentée dans le README). Rien dans le repo ne
garantit que les règles réellement publiées correspondent à ce fichier (pas
de déploiement automatisé, pas de CI). Un oubli lors d'une mise à jour
future des règles laisserait le fichier du repo "mentir" sur l'état réel de
la sécurité.

**Recommandation** : si le projet évolue, envisager un déploiement via
`firebase deploy --only firestore:rules` (Firebase CLI) plutôt qu'un
copier-coller console, éventuellement dans une petite action GitHub. Pour
l'usage actuel (ponctuel, un voyage), un simple rappel dans le README de
revérifier après toute modification suffit.

## 4. Absence de Content-Security-Policy

Aucune CSP (méta-balise ou en-tête) n'est définie. Le code actuel n'a pas
de faille XSS identifiée (tout le contenu utilisateur passe soit par
`textContent`, soit par un `escapeHtml()` correctement implémenté avant
insertion dans `innerHTML` - voir section "Bons points"), donc l'impact
immédiat est faible. Une CSP reste une **défense en profondeur** utile si
un bug d'échappement est introduit plus tard.

**Recommandation** (optionnelle, GitHub Pages ne permettant pas les
en-têtes HTTP personnalisés, seule une balise `<meta>` est possible) :

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; img-src 'self' data: https://server.arcgisonline.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' https://www.gstatic.com; connect-src 'self' https://firestore.googleapis.com https://firebasestorage.googleapis.com https://www.googleapis.com; frame-ancestors 'none'">
```
(à ajuster/tester : les imports ES modules vers gstatic.com doivent être
autorisés par `script-src`, et Firestore réalise des connexions vers
plusieurs sous-domaines Google selon la région).

## 5. Dépendance runtime au CDN gstatic.com pour le SDK Firebase

Contrairement à Leaflet, markercluster et qrcode (vendorés dans
`js/vendor/`), le SDK Firebase est importé directement depuis
`https://www.gstatic.com/firebasejs/10.13.2/...` dans `js/app.js`. C'est la
méthode officielle Google et la version est figée (`10.13.2`), donc le
risque est faible, mais :
- Il n'existe pas de mécanisme d'intégrité (SRI) pour les imports de module
  ES dynamiques comme celui-ci (limitation du web, pas du projet) ;
- Cela crée une dépendance réseau supplémentaire au chargement (déjà géré
  par le service worker en mode "cache d'abord" pour l'usage hors-ligne).

**Recommandation** (optionnelle) : si on veut un site 100 % autonome comme
les autres libs, vendorer le SDK Firebase JS comme le reste de
`js/vendor/`. Non prioritaire : Google/gstatic est un CDN de confiance et
la version est pinée.

## 6. Documents Firestore non bornés aux lieux réels (`placeId` libre)

Les règles acceptent n'importe quel `placeId` en clé de document, pas
seulement ceux définis dans `js/data.js`. Le code client ignore déjà les
documents "orphelins" à l'affichage (`PLACES.filter(...)`), donc pas
d'impact fonctionnel direct, mais cela alimente le risque de spam décrit au
point 2 (aucune contrainte "n'écris que sur un lieu qui existe" possible
sans dupliquer la liste des lieux dans les règles, ce qui est un compromis
raisonnable pour garder les règles simples).

## 7. Vie privée : dates et lieux de séjour publiés en clair

`js/data.js` contient les coordonnées GPS précises des logements, les
dates exactes du séjour (7-11 octobre 2026) et les noms des lieux, dans un
**dépôt GitHub public**. Ce n'est pas une vulnérabilité technique du site,
mais un choix qui expose publiquement :
- les dates auxquelles le groupe sera absent (et de son domicile, si les
  auteurs des commits sont identifiables) ;
- l'adresse précise des hébergements à Accra.

**Recommandation** : décision produit à prendre en connaissance de cause -
si ce niveau d'exposition n'est pas souhaité, passer le dépôt en privé (State
lié au point 1) est le seul vrai remède, un simple `.gitignore` sur
`data.js` casserait le fonctionnement du site.

## Bons points relevés (à ne pas casser en modifiant le code)

- **Échappement HTML cohérent** : `escapeHtml()` (`js/app.js:447`) est
  utilisé pour tout contenu injecté via `innerHTML` (noms de lieux,
  descriptions, catégories, ligne de bilan) ; le contenu réellement fourni
  par les utilisateurs (notes, prénom, légende photo) est affecté via
  `textContent`, jamais `innerHTML` - donc pas d'injection HTML possible
  même en écrivant du texte hostile dans Firestore.
- **Photos** : redimensionnées via `<canvas>` côté client avant envoi, ce
  qui a pour effet secondaire positif de **supprimer les métadonnées EXIF**
  (dont la géolocalisation GPS embarquée dans les photos de téléphone), et
  affichées via `<img src="data:...">` - un navigateur n'exécute pas de
  script contenu dans une image (même SVG) chargée comme `<img>`, donc pas
  de vecteur XSS par ce biais.
- **Liens externes** : les `href` construits dynamiquement (`maps-link`)
  sont restreints aux URL commençant par `https://` avant d'être échappés
  et insérés, ce qui évite les schémas `javascript:` ou `data:` dans un
  lien cliquable.
- **Règles Firestore par défaut fermées** (`match /{document=**} { allow
  read, write: if false; }`) : toute collection non explicitement ouverte
  est inaccessible - bonne pratique de "deny by default".
- **Firebase config publique par design**, correctement documenté comme
  non sensible - c'est le comportement normal et attendu d'un projet
  Firebase client-only (les clés API Firebase ne sont pas des secrets).
- **Aucun `eval`, `Function()`, `document.write` ou insertion `innerHTML`
  non échappée** trouvé dans `js/app.js`.
- **Service worker** : scope limité à l'origine du site, ne met jamais en
  cache le trafic Firestore, purge proprement les anciens caches à chaque
  bump de version - pas de risque de "cache poisoning" identifié.

## Volet "appareils du groupe" (PWA installée sur mobile)

Le site n'a **pas** de coquille native (pas d'Electron, Capacitor ou
Cordova) : c'est une PWA pure, donc la sécurité de l'appareil dépend
entièrement du bac à sable du navigateur - il n'y a pas de surface
d'attaque supplémentaire type "accès filesystem natif" ou "pont
JS-natif" à auditer.

- **Permissions demandées** : aucune permission sensible (pas de
  géolocalisation, pas de caméra directe - le choix de photo passe par le
  sélecteur de fichier standard du système, pas par `getUserMedia`). Seule
  l'API `navigator.vibrate` est utilisée, qui ne nécessite pas de
  permission.
- **Données stockées sur l'appareil** : `localStorage` (prénom, identifiant
  d'appareil aléatoire - rien de sensible), et un cache IndexedDB via
  `persistentLocalCache` de Firestore qui conserve **une copie locale de
  toutes les notes/photos/statuts du groupe** pour l'usage hors-ligne. Sur
  un appareil partagé ou perdu, ces données (photos du voyage, notes)
  restent lisibles localement sans re-connexion réseau - cohérent avec le
  fait qu'elles sont de toute façon publiques en lecture sur Firestore,
  donc pas un risque supplémentaire propre à l'appareil.
- **Mise à jour de l'app** : le service worker vérifie le réseau en
  priorité pour l'app shell (`networkFirst`), donc les correctifs de
  sécurité poussés sur `main` atteignent les appareils dès la prochaine
  ouverture avec réseau - pas de risque de rester bloqué longtemps sur une
  version vulnérable.

Aucune action corrective n'est nécessaire ici : le format PWA statique est
déjà la configuration la plus sûre disponible pour ce cas d'usage.

## Conclusion

Pour un carnet de voyage privé entre amis sans compte ni donnée sensible,
le niveau de sécurité du code est bon et les compromis (écriture publique,
pas d'auth) sont assumés et documentés. Le point qui mérite une vraie
décision consciente est le **n°1** : le dépôt étant public, l'hypothèse
"personne ne trouvera le lien" ne tient plus totalement. Les autres points
sont des durcissements optionnels, à faire seulement si le groupe est plus
grand que prévu ou si le lien venait à être partagé plus largement.
