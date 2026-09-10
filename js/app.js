import { CATEGORIES, PLACES } from "./data.js";
import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const VISITED_COLLECTION = "visited";

// --- État local -------------------------------------------------------

const visitedState = {}; // { [placeId]: boolean }
const markers = {}; // { [placeId]: L.CircleMarker }
let db = null;

// --- Carte --------------------------------------------------------------

const map = L.map("map", {
  scrollWheelZoom: false,
  zoomControl: true,
}).setView([5.66, -0.19], 11);

L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  {
    attribution:
      'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 16,
  }
).addTo(map);

L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 16,
    pane: "overlayPane",
  }
).addTo(map);

function flyToPlace(place) {
  if (place.lat == null || place.lng == null) return;
  map.flyTo([place.lat, place.lng], 15, { duration: 0.6 });
  const marker = markers[place.id];
  if (marker) marker.openPopup();
}

function highlightCard(placeId) {
  const card = document.getElementById(`place-${placeId}`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("is-highlighted");
  window.setTimeout(() => card.classList.remove("is-highlighted"), 1600);
}

for (const place of PLACES) {
  if (place.lat == null || place.lng == null) continue;
  const accent = CATEGORIES[place.category].color;
  const marker = L.circleMarker([place.lat, place.lng], {
    radius: 9,
    weight: 2,
    color: "#14181c",
    fillColor: accent,
    fillOpacity: 0.95,
  }).addTo(map);
  marker.bindPopup(
    `<strong>${escapeHtml(place.name)}</strong><br>${escapeHtml(
      CATEGORIES[place.category].label
    )}`
  );
  marker.on("click", () => highlightCard(place.id));
  markers[place.id] = marker;
}

// --- Filtres --------------------------------------------------------------

const filtersEl = document.getElementById("filters");
let activeFilter = "all";

for (const [key, cat] of Object.entries(CATEGORIES)) {
  const btn = document.createElement("button");
  btn.className = "filter-chip";
  btn.dataset.filter = key;
  btn.style.setProperty("--accent", cat.color);
  btn.textContent = cat.label;
  filtersEl.appendChild(btn);
}

filtersEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-chip");
  if (!btn) return;
  activeFilter = btn.dataset.filter;
  for (const chip of filtersEl.querySelectorAll(".filter-chip")) {
    chip.classList.toggle("is-active", chip === btn);
  }
  applyFilter();
});

function applyFilter() {
  for (const place of PLACES) {
    const visible = activeFilter === "all" || place.category === activeFilter;

    const card = document.getElementById(`place-${place.id}`);
    if (card) card.hidden = !visible;

    const marker = markers[place.id];
    if (marker) {
      if (visible && !map.hasLayer(marker)) marker.addTo(map);
      if (!visible && map.hasLayer(marker)) map.removeLayer(marker);
    }
  }

  for (const section of document.querySelectorAll(".category-section")) {
    const anyVisible = section.querySelector(".place-card:not([hidden])");
    section.hidden = !anyVisible;
  }
}

// --- Liste des lieux --------------------------------------------------------------

const listEl = document.getElementById("list");

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function buildCard(place) {
  const accent = CATEGORIES[place.category].color;
  const article = document.createElement("article");
  article.className = "place-card";
  article.id = `place-${place.id}`;
  article.dataset.id = place.id;
  article.style.setProperty("--accent", accent);

  const hasLocation = place.lat != null && place.lng != null;

  article.innerHTML = `
    <div class="card-top">
      <h3>${escapeHtml(place.name)}${
    place.approx ? '<span class="approx-badge">position approx.</span>' : ""
  }</h3>
      <button class="visited-toggle" data-id="${place.id}" aria-pressed="false">
        <span class="stamp-mark" aria-hidden="true">✓</span>
        <span class="visited-label">Visité</span>
      </button>
    </div>
    <p class="place-desc">${escapeHtml(place.description)}</p>
    <div class="card-actions">
      ${
        place.mapsUrl
          ? `<a class="maps-link" href="${place.mapsUrl}" target="_blank" rel="noopener">Voir sur Google Maps ↗</a>`
          : `<span class="maps-link maps-link--disabled">Adresse partagée dans le groupe</span>`
      }
      ${
        hasLocation
          ? `<button class="locate-btn" data-id="${place.id}">Localiser sur la carte</button>`
          : ""
      }
    </div>
  `;

  return article;
}

for (const [key, cat] of Object.entries(CATEGORIES)) {
  const placesInCat = PLACES.filter((p) => p.category === key);
  if (placesInCat.length === 0) continue;

  const section = document.createElement("section");
  section.className = "category-section";
  section.id = `cat-${key}`;

  const title = document.createElement("h2");
  title.className = "category-title";
  title.style.setProperty("--accent", cat.color);
  title.textContent = cat.label;
  section.appendChild(title);

  const cards = document.createElement("div");
  cards.className = "cards";
  for (const place of placesInCat) cards.appendChild(buildCard(place));
  section.appendChild(cards);

  listEl.appendChild(section);
}

listEl.addEventListener("click", (e) => {
  const locateBtn = e.target.closest(".locate-btn");
  if (locateBtn) {
    const place = PLACES.find((p) => p.id === locateBtn.dataset.id);
    if (place) flyToPlace(place);
    return;
  }

  const visitedBtn = e.target.closest(".visited-toggle");
  if (visitedBtn) {
    toggleVisited(visitedBtn.dataset.id);
  }
});

// --- Progression --------------------------------------------------------------

const progressFill = document.getElementById("progress-fill");
const progressBar = document.getElementById("progress-bar");
const progressLabel = document.getElementById("progress-label");
const TOTAL_PLACES = PLACES.length;

function updateProgress() {
  const visitedCount = Object.values(visitedState).filter(Boolean).length;
  const pct = TOTAL_PLACES ? Math.round((visitedCount / TOTAL_PLACES) * 100) : 0;
  progressFill.style.width = `${pct}%`;
  progressBar.setAttribute("aria-valuenow", String(pct));
  progressLabel.textContent = `${visitedCount} / ${TOTAL_PLACES} lieux visités par le groupe`;
}

function updateCardVisual(placeId) {
  const isVisited = !!visitedState[placeId];
  const card = document.getElementById(`place-${placeId}`);
  const btn = card ? card.querySelector(".visited-toggle") : null;
  if (card) card.classList.toggle("is-visited", isVisited);
  if (btn) {
    btn.setAttribute("aria-pressed", String(isVisited));
    btn.querySelector(".visited-label").textContent = isVisited
      ? "Visité"
      : "Marquer visité";
  }
}

// --- Firebase / Firestore --------------------------------------------------------------

function initFirebase() {
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey === "REMPLACE_MOI") {
    progressLabel.textContent =
      "Configuration Firebase manquante - voir README.md pour activer le suivi partagé.";
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);

    onSnapshot(
      collection(db, VISITED_COLLECTION),
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          visitedState[change.doc.id] = !!change.doc.data().visited;
          updateCardVisual(change.doc.id);
        }
        updateProgress();
      },
      (error) => {
        console.error("Erreur Firestore (lecture) :", error);
        progressLabel.textContent =
          "Suivi partagé indisponible pour le moment (voir la console).";
      }
    );
  } catch (error) {
    console.error("Erreur d'initialisation Firebase :", error);
    progressLabel.textContent =
      "Suivi partagé indisponible - vérifie js/firebase-config.js.";
  }
}

function toggleVisited(placeId) {
  if (!db) return;
  const nextValue = !visitedState[placeId];
  setDoc(
    doc(db, VISITED_COLLECTION, placeId),
    { visited: nextValue, updatedAt: serverTimestamp() },
    { merge: true }
  ).catch((error) => {
    console.error("Erreur Firestore (écriture) :", error);
  });
}

initFirebase();
updateProgress();
