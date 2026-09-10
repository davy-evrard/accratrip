# Accra 2026 - Carnet de voyage

Petit site à page unique pour le groupe qui part à Accra (Ghana) en octobre
2026 : carte interactive des lieux du séjour, liste filtrable par catégorie,
et suivi partagé en temps réel de ce qui a déjà été visité - sans compte,
juste avec le lien.

100 % HTML/CSS/JS natif, aucun build. Hébergeable tel quel sur GitHub Pages.

## Stack

- **Carte** : [Leaflet.js](https://leafletjs.com/) + fond de carte sombre [Esri](https://www.arcgis.com/) (Dark Gray Canvas, sans clé API)
- **Données** : `js/data.js` (catégories, jours du séjour, lieux, à éditer directement)
- **Temps réel partagé** : [Firebase Firestore](https://firebase.google.com/docs/firestore) (SDK JS, appelé directement depuis le navigateur - pas de serveur à maintenir) : statut "visité" du groupe, réactions emoji (🔥 ❤️ 👍), planning par jour et notes partagées par lieu
- **Hébergement** : GitHub Pages, branche `main`

## Structure du repo

```
index.html          page unique
css/style.css        tout le style
js/data.js            catégories (label, couleur, icône), jours du séjour, lieux (id, nom, coordonnées, lien Maps, description)
js/firebase-config.js configuration du projet Firebase (à remplir, voir plus bas)
js/app.js              carte, liste, filtres, réactions, planning, notes, synchronisation Firestore
firestore.rules        règles de sécurité Firestore, collections "visited", "reactions", "planning" et "notes" (à coller dans la console Firebase)
```

## 1. Créer le projet Firebase

1. Va sur [console.firebase.google.com](https://console.firebase.google.com/) et clique sur **Ajouter un projet**. Donne-lui un nom (ex. `accratrip`), tu peux désactiver Google Analytics (pas nécessaire ici).
2. Une fois le projet créé, dans le menu de gauche va sur **Compilation > Firestore Database**, puis **Créer une base de données**.
   - Choisis une région proche de vous (ex. `europe-west` ou `eur3`).
   - Démarre en **mode production** (on va poser nos propres règles juste après - pas besoin du mode test).
3. Toujours dans Firestore, onglet **Règles**, remplace le contenu par celui du fichier [`firestore.rules`](./firestore.rules) de ce repo, puis **Publier**.

   Ces règles ouvrent la lecture/écriture publique **uniquement** sur quatre
   collections, et seulement pour des documents de la forme attendue :
   `visited` (`{ visited: bool, updatedAt }`), `reactions`
   (`{ votes: { <idAppareil>: <emoji> }, updatedAt }`), `planning`
   (`{ day: 1..5 ou null, updatedAt }`) et `notes`
   (`{ text: <string, 280 max>, updatedAt }`). C'est un compromis volontaire
   adapté à un usage privé entre amis avec un lien non indexé - pas un site
   public à grande audience. Aucune authentification, donc n'importe qui avec
   le lien peut cocher un lieu, réagir, planifier ou écrire une note ; c'est
   le but. L'`idAppareil` est un identifiant aléatoire stocké dans le
   navigateur (`localStorage`), juste pour qu'on puisse retirer sa propre
   réaction (voir la recommandation plus bas si tu veux durcir un peu).

4. Récupère la configuration du projet : **Paramètres du projet** (icône
   engrenage en haut à gauche) **> Général**, descends jusqu'à **Vos
   applications**, clique sur l'icône **Web** (`</>`) pour enregistrer une
   nouvelle application (nom libre, pas besoin de Firebase Hosting).
   Firebase affiche alors un objet `firebaseConfig` du type :

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "accratrip.firebaseapp.com",
     projectId: "accratrip",
     storageBucket: "accratrip.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef",
   };
   ```

5. Copie ces valeurs dans [`js/firebase-config.js`](./js/firebase-config.js) à la place des `"REMPLACE_MOI"`.

   Ces informations ne sont **pas secrètes** : elles identifient
   publiquement le projet Firebase et sont visibles par n'importe qui
   ouvrant le site (c'est normal pour un site statique sans backend). Ce
   qui protège réellement les données, ce sont les règles Firestore de
   l'étape 3.

6. Commit et push ce fichier - sans lui, le site tourne quand même (carte,
   liste, filtres fonctionnent) mais le suivi « visité » reste désactivé et
   un message l'indique en haut de page.

## 2. Activer GitHub Pages

1. Sur GitHub, va dans **Settings > Pages** du repo.
2. Sous **Build and deployment**, choisis **Source : Deploy from a branch**.
3. Sélectionne la branche `main`, dossier `/ (root)`, puis **Save**.
4. Le site sera disponible après quelques minutes à l'URL indiquée en haut
   de cette page (typiquement `https://<utilisateur>.github.io/<repo>/`).

Partage simplement cette URL avec le groupe.

## Développement local

Comme `js/app.js` est un module ES (`import`/`export`), il ne peut pas être
ouvert directement via `file://` dans certains navigateurs. Sers le dossier
avec un petit serveur statique, par exemple :

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Modifier les lieux

Tout se passe dans [`js/data.js`](./js/data.js) : `CATEGORIES` (label,
couleur, icône), `DAYS` (les 5 jours du séjour, pour le planner) et `PLACES`
(un objet par lieu). Ajouter, retirer ou modifier un lieu là-bas suffit - la
carte, la liste, les filtres et le compteur de progression s'adaptent
automatiquement (le total du compteur est calculé dynamiquement à partir du
nombre de lieux, pas codé en dur).

Un lieu sans `lat`/`lng` (ex. `chrismaison`, adresse privée) n'a simplement
pas de marqueur sur la carte ni de bouton « Localiser » ; un lieu sans
`mapsUrl` n'a pas de lien Google Maps.

## Recommandations d'amélioration

Quelques pistes pour aller plus loin, non implémentées ici pour garder le
site simple comme demandé :

- **Mode hors-ligne / mauvais réseau** : sur place, la connexion peut être
  instable. Firestore fait déjà du cache local par défaut (les lectures/
  écritures fonctionnent offline et se resynchronisent), mais tu peux
  ajouter un [service worker](https://developer.mozilla.org/fr/docs/Web/API/Service_Worker_API)
  ou `IndexedDB persistence` explicite pour fiabiliser encore l'usage sans
  réseau (fréquent en déplacement).
- **Anti-abus léger** : les règles actuelles sont volontairement ouvertes.
  Si tu veux limiter les écritures à des personnes du groupe sans mettre en
  place de vrais comptes, une option simple est l'**auth anonyme
  Firebase** (`signInAnonymously`) combinée à un champ `updatedBy` dans les
  règles - invisible pour les utilisateurs, mais ça donne une trace et
  permet de limiter le débit d'écriture par utilisateur si besoin.
- **Petites touches pratiques pour le séjour** : un lien « Itinéraire » vers
  chaque lieu depuis la position actuelle (Google Maps `?daddr=`), ou un tri
  « les plus proches de moi » via `navigator.geolocation` - utile en marchant
  dans Accra.
- **Petit historique** : le champ `updatedAt` est stocké sur toutes les
  collections mais pas affiché ; un petit « visité le 12/10 » sous le lieu
  serait un ajout mineur et sympa comme souvenir de voyage.

Aucune de ces pistes n'est nécessaire pour que le site fonctionne bien tel
quel - à prendre si tu as envie de bricoler encore un peu avant octobre.
