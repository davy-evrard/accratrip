/* Service worker : rend le carnet utilisable hors-ligne.
 *
 * - App shell (HTML/CSS/JS/polices/libs) : servi depuis le cache, mis à jour
 *   en arrière-plan quand le réseau répond.
 * - Tuiles de carte Esri : cache, avec un plafond pour ne pas gonfler.
 * - Firestore : jamais intercepté (le SDK gère sa propre persistance).
 *
 * Bumper CACHE_VERSION à chaque déploiement pour purger l'ancien cache.
 */

const CACHE_VERSION = "v2";
const SHELL_CACHE = `accratrip-shell-${CACHE_VERSION}`;
const TILE_CACHE = `accratrip-tiles-${CACHE_VERSION}`;
const TILE_MAX = 300;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/data.js",
  "./js/firebase-config.js",
  "./js/vendor/qrcode.min.js",
  "./js/vendor/leaflet/leaflet.css",
  "./js/vendor/leaflet/leaflet.js",
  "./js/vendor/markercluster/MarkerCluster.css",
  "./js/vendor/markercluster/MarkerCluster.Default.css",
  "./js/vendor/markercluster/leaflet.markercluster.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== TILE_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Réseau d'abord, cache en secours (pour que l'app en ligne soit toujours à jour).
async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await caches.match("./index.html");
      if (shell) return shell;
    }
    throw err;
  }
}

// Cache d'abord (polices, SDK Firebase, libs immuables).
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && (fresh.ok || fresh.type === "opaque")) {
    const cache = await caches.open(cacheName || SHELL_CACHE);
    cache.put(request, fresh.clone());
  }
  return fresh;
}

async function cacheTile(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && (fresh.ok || fresh.type === "opaque")) {
    const cache = await caches.open(TILE_CACHE);
    cache.put(request, fresh.clone());
    trimCache(TILE_CACHE, TILE_MAX);
  }
  return fresh;
}

async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  for (const key of keys.slice(0, keys.length - max)) {
    await cache.delete(key);
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Firestore et compagnie : on laisse passer, le SDK gère son cache.
  if (
    /(^|\.)googleapis\.com$/.test(url.hostname) &&
    url.hostname !== "fonts.googleapis.com"
  ) {
    return;
  }

  // App shell (même origine) : réseau d'abord.
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Polices Google : cache d'abord.
  if (
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // SDK Firebase (versionné, immuable) : cache d'abord.
  if (
    url.hostname === "www.gstatic.com" &&
    url.pathname.startsWith("/firebasejs/")
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Tuiles de carte Esri : cache plafonné.
  if (url.hostname.endsWith("arcgisonline.com")) {
    event.respondWith(cacheTile(request));
    return;
  }

  // Le reste : réseau normal.
});
