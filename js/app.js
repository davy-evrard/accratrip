import { CATEGORIES, PLACES, DAYS } from "./data.js";
import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  deleteField,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const VISITED_COLLECTION = "visited";
const REACTIONS_COLLECTION = "reactions";
const PLANNING_COLLECTION = "planning";
const NOTES_COLLECTION = "notes";
const PHOTOS_COLLECTION = "photos";
const REACTIONS = ["🔥", "❤️", "👍"];
const NOTE_MAX = 280;
const PHOTO_MAX_CHARS = 380000; // ~275 Ko une fois décodé, sous la limite Firestore

// --- État local -------------------------------------------------------

const visitedState = {}; // { [placeId]: boolean }
const reactionState = {}; // { [placeId]: { [clientId]: emoji } }
const planState = {}; // { [placeId]: 1..5 | null }
const noteState = {}; // { [placeId]: { text, by, at: Date|null } }
const photoState = {}; // { [placeId]: { dataUrl, by } }
const markers = {}; // { [placeId]: L.Marker }
let db = null;
let editingNote = null; // placeId de la note en cours d'édition (sinon null)
let uploadingPhotoFor = null; // placeId dont on choisit la photo (sinon null)

// Identifiant d'appareil (pas de compte) : permet de retirer / changer sa
// propre réaction sans authentification. Stocké localement uniquement.
const clientId = getClientId();

function getClientId() {
  try {
    let id = localStorage.getItem("accratrip-client");
    if (!id) {
      id =
        (crypto.randomUUID && crypto.randomUUID()) ||
        `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("accratrip-client", id);
    }
    return id;
  } catch {
    return `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

// Prénom affiché à côté des notes. Demandé une seule fois, stocké en local.
function getName() {
  try {
    return localStorage.getItem("accratrip-name") || "";
  } catch {
    return "";
  }
}

function ensureName() {
  let name = getName();
  if (!name) {
    name = (
      window.prompt("Ton prénom (affiché à côté de tes notes) :") || ""
    )
      .trim()
      .slice(0, 40);
    try {
      if (name) localStorage.setItem("accratrip-name", name);
    } catch {
      /* localStorage indisponible : on garde juste la valeur pour cette session */
    }
  }
  return name;
}

function relativeTime(date) {
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 45) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return `il y a ${d} j`;
}

// --- Toast (retour visible sur erreur) -------------------------------

let toastTimer = null;

function showToast(message) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => el.classList.remove("is-visible"),
    5000
  );
}

function showWriteError(error) {
  const denied = error && error.code === "permission-denied";
  showToast(
    denied
      ? "Enregistrement refusé - les règles Firestore ne sont peut-être pas publiées (voir README)."
      : "Impossible d'enregistrer, vérifie ta connexion et réessaie."
  );
}

// --- Carte --------------------------------------------------------------

const map = L.map("map", {
  scrollWheelZoom: false,
  zoomControl: true,
}).setView([5.66, -0.19], 11);

L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  {
    attribution:
      'Tiles &copy; Esri - Esri, DeLorme, NAVTEQ &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
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

// Regroupe les marqueurs qui se chevauchent (paquet du bord de mer) et
// les éclate quand on zoome.
const markerLayer = L.markerClusterGroup({
  maxClusterRadius: 45,
  showCoverageOnHover: false,
  spiderfyOnMaxZoom: true,
});
map.addLayer(markerLayer);

function makeMarkerIcon(place, visited) {
  const cat = CATEGORIES[place.category];
  return L.divIcon({
    className: "map-marker-wrap",
    html: `<span class="map-marker${visited ? " is-visited" : ""}" style="--accent:${cat.color}">${cat.icon}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14],
  });
}

// --- Compte à rebours -------------------------------------------------

const TRIP_START = new Date("2026-10-07T00:00:00Z");
const TRIP_END = new Date("2026-10-11T23:59:59Z");
const TRIP_DAYS = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CD_UNITS = ["jours", "heures", "min", "sec"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function renderTicker(el, ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const values = [
    String(Math.floor(total / 86400)),
    pad2(Math.floor((total % 86400) / 3600)),
    pad2(Math.floor((total % 3600) / 60)),
    pad2(total % 60),
  ];

  if (!el.classList.contains("has-ticker")) {
    el.classList.add("has-ticker");
    el.innerHTML =
      '<span class="cd-grid">' +
      CD_UNITS.map(
        (unit, i) =>
          (i ? '<span class="cd-sep">:</span>' : "") +
          `<span class="cd-cell"><b></b><span>${unit}</span></span>`
      ).join("") +
      "</span>";
  }

  const nums = el.querySelectorAll(".cd-cell b");
  values.forEach((value, i) => {
    if (nums[i] && nums[i].textContent !== value) nums[i].textContent = value;
  });
  el.setAttribute(
    "aria-label",
    `Départ dans ${values[0]} jours, ${Number(values[1])} heures, ` +
      `${Number(values[2])} minutes et ${Number(values[3])} secondes`
  );
}

// Numéro de jour du séjour (1..5) si on est pendant le voyage, sinon null.
function currentTripDay() {
  const now = new Date();
  if (now < TRIP_START || now > TRIP_END) return null;
  const n = Math.floor((now - TRIP_START) / MS_PER_DAY) + 1;
  return Math.min(Math.max(n, 1), TRIP_DAYS);
}

function updateCountdown() {
  const el = document.getElementById("countdown");
  if (!el) return;

  const now = new Date();
  if (now < TRIP_START) {
    el.dataset.phase = "before";
    renderTicker(el, TRIP_START - now);
  } else if (now <= TRIP_END) {
    el.dataset.phase = "during";
    el.classList.remove("has-ticker");
    el.textContent = `Jour ${currentTripDay()} / ${TRIP_DAYS} à Accra`;
  } else {
    el.dataset.phase = "after";
    el.classList.remove("has-ticker");
    el.textContent = "Souvenirs d'Accra";
  }

  updateRecap(now > TRIP_END);
}

// Bilan affiché une fois le séjour terminé.
function updateRecap(isAfter) {
  const recap = document.getElementById("recap");
  const list = document.getElementById("recap-list");
  if (!recap || !list) return;

  recap.hidden = !isAfter;
  if (!isAfter) return;

  const visitedCount = PLACES.filter((p) => visitedState[p.id]).length;

  const doneCats = Object.entries(CATEGORIES)
    .filter(([key]) => {
      const inCat = PLACES.filter((p) => p.category === key);
      return inCat.length > 0 && inCat.every((p) => visitedState[p.id]);
    })
    .map(([, c]) => `${c.icon} ${c.label}`);

  let topPlace = null;
  let topCount = 0;
  for (const place of PLACES) {
    const n = Object.keys(reactionState[place.id] || {}).length;
    if (n > topCount) {
      topCount = n;
      topPlace = place;
    }
  }

  const photos = PLACES.filter((p) => (photoState[p.id] || {}).dataUrl).length;
  const notes = PLACES.filter((p) => (noteState[p.id] || {}).text).length;

  const lines = [
    `🏁 ${visitedCount} / ${PLACES.length} lieux visités par le groupe`,
    doneCats.length
      ? `✅ Catégories bouclées : ${doneCats.join(", ")}`
      : "✅ Aucune catégorie complète... il faudra revenir !",
  ];
  if (topPlace) {
    lines.push(
      `🔥 Lieu le plus plébiscité : ${topPlace.name} (${topCount} réaction${
        topCount > 1 ? "s" : ""
      })`
    );
  }
  lines.push(`📸 ${photos} photo${photos > 1 ? "s" : ""} · 📝 ${notes} note${
    notes > 1 ? "s" : ""
  }`);

  list.innerHTML = lines
    .map((l) => `<li class="recap-line">${escapeHtml(l)}</li>`)
    .join("");
}

function flyToPlace(place, { scrollToMap = true } = {}) {
  if (place.lat == null || place.lng == null) return;
  if (scrollToMap) {
    const mapEl = document.getElementById("map");
    if (mapEl) mapEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const marker = markers[place.id];
  if (marker && markerLayer.hasLayer(marker)) {
    // Dézoome le cluster si besoin pour révéler le marqueur, puis l'ouvre.
    markerLayer.zoomToShowLayer(marker, () => marker.openPopup());
  } else {
    map.flyTo([place.lat, place.lng], 15, { duration: 0.6 });
    if (marker) marker.openPopup();
  }
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
  const cat = CATEGORIES[place.category];
  const marker = L.marker([place.lat, place.lng], {
    icon: makeMarkerIcon(place, false),
    keyboard: false,
  });
  marker.bindPopup(
    `<strong>${escapeHtml(place.name)}</strong><br>${escapeHtml(cat.label)}`
  );
  marker.on("click", () => highlightCard(place.id));
  markers[place.id] = marker;
  markerLayer.addLayer(marker);
}

// --- Filtres --------------------------------------------------------------

const filtersEl = document.getElementById("filters");
const dayFiltersEl = document.getElementById("day-filters");
let activeCategory = "all";
let activeDay = "all";

for (const [key, cat] of Object.entries(CATEGORIES)) {
  const btn = document.createElement("button");
  btn.className = "filter-chip";
  btn.dataset.filter = key;
  btn.style.setProperty("--accent", cat.color);
  btn.textContent = `${cat.icon} ${cat.label}`;
  filtersEl.appendChild(btn);
}

for (const day of DAYS) {
  const btn = document.createElement("button");
  btn.className = "filter-chip";
  btn.dataset.day = String(day.n);
  btn.textContent = `${day.label} · ${day.date}`;
  dayFiltersEl.appendChild(btn);
}
const unplannedChip = document.createElement("button");
unplannedChip.className = "filter-chip";
unplannedChip.dataset.day = "none";
unplannedChip.textContent = "Non planifié";
dayFiltersEl.appendChild(unplannedChip);

filtersEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-chip");
  if (!btn) return;
  activeCategory = btn.dataset.filter;
  for (const chip of filtersEl.querySelectorAll(".filter-chip")) {
    chip.classList.toggle("is-active", chip === btn);
  }
  applyFilter({ fit: true });
});

dayFiltersEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-chip");
  if (!btn) return;
  activeDay = btn.dataset.day;
  for (const chip of dayFiltersEl.querySelectorAll(".filter-chip")) {
    chip.classList.toggle("is-active", chip === btn);
  }
  applyFilter({ fit: true });
});

function applyFilter({ fit = false } = {}) {
  const visiblePoints = [];
  let visibleCount = 0;

  for (const place of PLACES) {
    const catOk = activeCategory === "all" || place.category === activeCategory;
    const day = planState[place.id] ?? null;
    const dayOk =
      activeDay === "all" ||
      (activeDay === "none" ? day == null : String(day) === activeDay);
    const visible = catOk && dayOk;
    if (visible) visibleCount++;

    const card = document.getElementById(`place-${place.id}`);
    if (card) card.hidden = !visible;

    const marker = markers[place.id];
    if (marker) {
      if (visible && !markerLayer.hasLayer(marker)) markerLayer.addLayer(marker);
      if (!visible && markerLayer.hasLayer(marker)) {
        markerLayer.removeLayer(marker);
      }
      if (visible && place.lat != null && place.lng != null) {
        visiblePoints.push([place.lat, place.lng]);
      }
    }
  }

  for (const section of document.querySelectorAll(".list-section")) {
    const anyVisible = section.querySelector(".place-card:not([hidden])");
    section.hidden = !anyVisible;
  }

  const statusEl = document.getElementById("filter-status");
  if (statusEl) {
    const filtered = activeCategory !== "all" || activeDay !== "all";
    if (visibleCount === 0) {
      statusEl.textContent = "Aucun lieu ne correspond à ce filtre.";
    } else if (filtered) {
      statusEl.textContent = `${visibleCount} lieu${
        visibleCount > 1 ? "x" : ""
      } sur ${PLACES.length}`;
    } else {
      statusEl.textContent = "";
    }
  }

  if (fit && visiblePoints.length === 1) {
    map.flyTo(visiblePoints[0], 14, { duration: 0.5 });
  } else if (fit && visiblePoints.length > 1) {
    map.flyToBounds(visiblePoints, {
      padding: [40, 40],
      maxZoom: 15,
      duration: 0.5,
    });
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
  // On n'accepte que des liens https:// explicites (les données sont
  // maîtrisées, mais autant ne pas injecter n'importe quoi dans le href).
  const safeMapsUrl =
    typeof place.mapsUrl === "string" && place.mapsUrl.startsWith("https://")
      ? place.mapsUrl
      : null;

  article.innerHTML = `
    <div class="card-top">
      <h3>${escapeHtml(place.name)}${
    place.approx ? '<span class="approx-badge">position approx.</span>' : ""
  }<span class="day-badge" hidden></span></h3>
      <button class="visited-toggle" data-id="${place.id}" aria-pressed="false">
        <span class="stamp-mark" aria-hidden="true">✓</span>
        <span class="visited-label">Visité</span>
      </button>
    </div>
    <p class="place-desc">${escapeHtml(place.description)}</p>
    <div class="photo" data-id="${place.id}">
      <button class="photo-add" data-id="${place.id}">+ Ajouter une photo</button>
      <figure class="photo-fig" hidden>
        <button class="photo-thumb" data-id="${place.id}" aria-label="Agrandir la photo">
          <img alt="Photo de ${escapeHtml(place.name)}" />
        </button>
        <figcaption class="photo-cap" hidden></figcaption>
        <button class="photo-remove" data-id="${place.id}">Retirer la photo</button>
      </figure>
    </div>
    <div class="card-actions">
      ${
        safeMapsUrl
          ? `<a class="maps-link" href="${escapeHtml(safeMapsUrl)}" target="_blank" rel="noopener">Voir sur Google Maps ↗</a>`
          : `<span class="maps-link maps-link--disabled">Adresse partagée dans le groupe</span>`
      }
      ${
        hasLocation
          ? `<span class="card-tools">
        <a class="route-link" href="https://www.google.com/maps/dir/?api=1&amp;destination=${place.lat},${place.lng}" target="_blank" rel="noopener">Itinéraire ↗</a>
        <button class="locate-btn" data-id="${place.id}">Localiser sur la carte</button>
      </span>`
          : ""
      }
    </div>
    <div class="reactions" data-id="${place.id}" aria-label="Réactions du groupe">
      ${REACTIONS.map(
        (emoji) => `<button class="reaction" data-emoji="${emoji}" data-id="${place.id}" aria-pressed="false">
        <span class="r-emoji" aria-hidden="true">${emoji}</span><span class="r-count">0</span>
      </button>`
      ).join("")}
    </div>
    <div class="planner" data-id="${place.id}">
      <span class="planner-label">Jour</span>
      ${DAYS.map(
        (d) => `<button class="day-pick" data-id="${place.id}" data-day="${d.n}" title="${d.label} - ${d.date}" aria-pressed="false">${d.n}</button>`
      ).join("")}
    </div>
    <div class="note" data-id="${place.id}">
      <p class="note-text" hidden></p>
      <p class="note-meta" hidden></p>
      <button class="note-edit" data-id="${place.id}">+ Note partagée</button>
      <div class="note-form" hidden>
        <textarea class="note-input" maxlength="${NOTE_MAX}" rows="2" placeholder="Ex : réservé jeudi 20h, prévoir du cash..."></textarea>
        <div class="note-form-actions">
          <button class="note-cancel" data-id="${place.id}">Annuler</button>
          <button class="note-save" data-id="${place.id}">Enregistrer</button>
        </div>
      </div>
    </div>
  `;

  return article;
}

const cardEls = {}; // { [placeId]: <article> }

function makeSection(id, titleText, extraClass, accent) {
  const section = document.createElement("section");
  section.className = `list-section ${extraClass}`;
  section.id = id;

  const title = document.createElement("h2");
  title.className = "category-title";
  if (accent) title.style.setProperty("--accent", accent);
  title.textContent = titleText;
  section.appendChild(title);

  const cards = document.createElement("div");
  cards.className = "cards";
  section.appendChild(cards);

  listEl.appendChild(section);
  return section;
}

for (const place of PLACES) {
  cardEls[place.id] = buildCard(place);
}

for (const [key, cat] of Object.entries(CATEGORIES)) {
  if (!PLACES.some((p) => p.category === key)) continue;
  makeSection(`cat-${key}`, `${cat.icon} ${cat.label}`, "category-section", cat.color);
}

for (const d of DAYS) {
  makeSection(`day-${d.n}`, `${d.label} - ${d.date}`, "day-section");
}
makeSection("day-none", "Non planifié", "day-section");

// --- Vue liste : par catégorie ou par jour ---------------------------

const groupToggleEl = document.getElementById("group-toggle");
let groupBy = "category";

function renderGrouping() {
  listEl.dataset.group = groupBy;
  for (const place of PLACES) {
    const card = cardEls[place.id];
    if (!card) continue;
    let targetId;
    if (groupBy === "day") {
      const day = planState[place.id] ?? null;
      targetId = day == null ? "day-none" : `day-${day}`;
    } else {
      targetId = `cat-${place.category}`;
    }
    const target = document.querySelector(`#${targetId} .cards`);
    if (target) target.appendChild(card);
  }
  applyFilter();
}

if (groupToggleEl) {
  groupToggleEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-group]");
    if (!btn) return;
    groupBy = btn.dataset.group;
    for (const b of groupToggleEl.querySelectorAll("button")) {
      b.classList.toggle("is-active", b === btn);
    }
    renderGrouping();
  });
}

renderGrouping();

listEl.addEventListener("click", (e) => {
  const locateBtn = e.target.closest(".locate-btn");
  if (locateBtn) {
    const place = PLACES.find((p) => p.id === locateBtn.dataset.id);
    if (place) {
      // URL partageable qui pointe sur ce lieu (#place-xxx), sans polluer
      // l'historique.
      history.replaceState(null, "", `#place-${place.id}`);
      flyToPlace(place);
    }
    return;
  }

  const reactionBtn = e.target.closest(".reaction");
  if (reactionBtn) {
    toggleReaction(reactionBtn.dataset.id, reactionBtn.dataset.emoji);
    return;
  }

  const dayBtn = e.target.closest(".day-pick");
  if (dayBtn) {
    setDay(dayBtn.dataset.id, Number(dayBtn.dataset.day));
    return;
  }

  const noteEditBtn = e.target.closest(".note-edit");
  if (noteEditBtn) {
    openNoteEditor(noteEditBtn.dataset.id);
    return;
  }

  const noteCancelBtn = e.target.closest(".note-cancel");
  if (noteCancelBtn) {
    closeNoteEditor(noteCancelBtn.dataset.id);
    return;
  }

  const noteSaveBtn = e.target.closest(".note-save");
  if (noteSaveBtn) {
    const wrap = noteSaveBtn.closest(".note");
    const input = wrap && wrap.querySelector(".note-input");
    if (input) saveNote(noteSaveBtn.dataset.id, input.value.trim());
    return;
  }

  const photoAddBtn = e.target.closest(".photo-add");
  if (photoAddBtn) {
    uploadingPhotoFor = photoAddBtn.dataset.id;
    photoInput.click();
    return;
  }

  const photoThumb = e.target.closest(".photo-thumb");
  if (photoThumb) {
    openPhotoLightbox(photoThumb.dataset.id);
    return;
  }

  const photoRemoveBtn = e.target.closest(".photo-remove");
  if (photoRemoveBtn) {
    if (window.confirm("Retirer cette photo ?")) {
      removePhoto(photoRemoveBtn.dataset.id);
    }
    return;
  }

  const visitedBtn = e.target.closest(".visited-toggle");
  if (visitedBtn) {
    toggleVisited(visitedBtn.dataset.id);
  }
});

const photoInput = document.getElementById("photo-input");
if (photoInput) {
  photoInput.addEventListener("change", () => {
    const file = photoInput.files && photoInput.files[0];
    const placeId = uploadingPhotoFor;
    photoInput.value = "";
    uploadingPhotoFor = null;
    if (file && placeId) savePhotoFile(placeId, file);
  });
}

// --- Progression --------------------------------------------------------------

const progressFill = document.getElementById("progress-fill");
const progressBar = document.getElementById("progress-bar");
const progressLabel = document.getElementById("progress-label");
const TOTAL_PLACES = PLACES.length;
let hasCelebrated = false;

function updateProgress({ allowCelebrate = false } = {}) {
  // On ne compte que les lieux réellement présents dans data.js, pour
  // ignorer d'éventuels documents Firestore orphelins (id renommé, etc.).
  const visitedCount = PLACES.filter((p) => visitedState[p.id]).length;
  const pct = TOTAL_PLACES ? Math.round((visitedCount / TOTAL_PLACES) * 100) : 0;
  const complete = TOTAL_PLACES > 0 && visitedCount === TOTAL_PLACES;

  progressFill.style.width = `${pct}%`;
  progressBar.setAttribute("aria-valuenow", String(pct));
  progressLabel.classList.toggle("is-complete", complete);
  progressLabel.textContent = complete
    ? `🇬🇭 ${TOTAL_PLACES} / ${TOTAL_PLACES} lieux visités - beau voyage !`
    : `${visitedCount} / ${TOTAL_PLACES} lieux visités par le groupe`;

  if (complete && allowCelebrate && !hasCelebrated) {
    hasCelebrated = true;
    celebrate();
    if ("vibrate" in navigator) navigator.vibrate([0, 40, 30, 40, 30, 80]);
  }
  if (!complete) hasCelebrated = false;
}

function celebrate() {
  if (document.querySelector(".confetti-layer")) return;

  const colors = Object.values(CATEGORIES).map((c) => c.color);
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  layer.setAttribute("aria-hidden", "true");

  for (let i = 0; i < 48; i++) {
    const bit = document.createElement("span");
    bit.className = "confetti-bit";
    bit.style.left = `${Math.random() * 100}vw`;
    bit.style.background = colors[i % colors.length];
    bit.style.animationDelay = `${Math.random() * 0.5}s`;
    bit.style.animationDuration = `${2 + Math.random() * 1.6}s`;
    layer.appendChild(bit);
  }

  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), 4600);
}

function updateMarkerVisual(placeId) {
  const marker = markers[placeId];
  const place = PLACES.find((p) => p.id === placeId);
  if (marker && place) {
    marker.setIcon(makeMarkerIcon(place, !!visitedState[placeId]));
  }
}

function updateReactions(placeId) {
  const wrap = document.querySelector(`.reactions[data-id="${placeId}"]`);
  if (!wrap) return;

  const votes = reactionState[placeId] || {};
  const mine = votes[clientId];

  for (const btn of wrap.querySelectorAll(".reaction")) {
    const emoji = btn.dataset.emoji;
    const count = Object.values(votes).filter((v) => v === emoji).length;
    btn.querySelector(".r-count").textContent = String(count);
    btn.classList.toggle("has-votes", count > 0);
    btn.classList.toggle("is-mine", mine === emoji);
    btn.setAttribute("aria-pressed", String(mine === emoji));
  }
}

function updatePlanner(placeId) {
  const day = planState[placeId] ?? null;

  const card = document.getElementById(`place-${placeId}`);
  const badge = card && card.querySelector(".day-badge");
  if (badge) {
    if (day == null) {
      badge.hidden = true;
      badge.textContent = "";
    } else {
      const meta = DAYS.find((d) => d.n === day);
      badge.hidden = false;
      badge.textContent = `J${day}`;
      badge.title = meta ? `${meta.label} - ${meta.date}` : "";
    }
  }

  const planner = document.querySelector(`.planner[data-id="${placeId}"]`);
  if (planner) {
    for (const btn of planner.querySelectorAll(".day-pick")) {
      const isSelected = Number(btn.dataset.day) === day;
      btn.classList.toggle("is-selected", isSelected);
      btn.setAttribute("aria-pressed", String(isSelected));
    }
  }
}

function updateNote(placeId) {
  if (editingNote === placeId) return; // ne pas écraser une saisie en cours

  const wrap = document.querySelector(`.note[data-id="${placeId}"]`);
  if (!wrap) return;

  const note = noteState[placeId] || {};
  const text = note.text || "";
  const textEl = wrap.querySelector(".note-text");
  const metaEl = wrap.querySelector(".note-meta");
  const editBtn = wrap.querySelector(".note-edit");

  wrap.querySelector(".note-form").hidden = true;
  editBtn.hidden = false;

  if (text) {
    textEl.textContent = text;
    textEl.hidden = false;
    editBtn.textContent = "Modifier la note";

    const parts = [];
    if (note.by) parts.push(note.by);
    if (note.at instanceof Date) parts.push(relativeTime(note.at));
    metaEl.textContent = parts.join(" - ");
    metaEl.hidden = parts.length === 0;
  } else {
    textEl.textContent = "";
    textEl.hidden = true;
    metaEl.textContent = "";
    metaEl.hidden = true;
    editBtn.textContent = "+ Note partagée";
  }
}

function openNoteEditor(placeId) {
  const wrap = document.querySelector(`.note[data-id="${placeId}"]`);
  if (!wrap) return;

  editingNote = placeId;
  const input = wrap.querySelector(".note-input");
  input.value = (noteState[placeId] && noteState[placeId].text) || "";
  wrap.querySelector(".note-text").hidden = true;
  wrap.querySelector(".note-edit").hidden = true;
  wrap.querySelector(".note-form").hidden = false;
  input.focus();
}

function closeNoteEditor(placeId) {
  if (editingNote === placeId) editingNote = null;
  updateNote(placeId);
}

// --- Photos par lieu -----------------------------------------------

function updatePhoto(placeId) {
  const wrap = document.querySelector(`.photo[data-id="${placeId}"]`);
  if (!wrap) return;

  const p = photoState[placeId] || {};
  const has = !!p.dataUrl;
  wrap.querySelector(".photo-add").hidden = has;
  wrap.querySelector(".photo-fig").hidden = !has;

  if (has) {
    wrap.querySelector(".photo-thumb img").src = p.dataUrl;
    const cap = wrap.querySelector(".photo-cap");
    cap.textContent = p.by ? `Ajoutée par ${p.by}` : "";
    cap.hidden = !p.by;
  }
}

function openPhotoLightbox(placeId) {
  const p = photoState[placeId];
  const dlg = document.getElementById("photo-dialog");
  const img = document.getElementById("photo-full");
  if (!p || !p.dataUrl || !dlg || !img || typeof dlg.showModal !== "function") {
    return;
  }
  img.src = p.dataUrl;
  dlg.showModal();
}

// Redimensionne un fichier image en data URL JPEG (côté client, pour rester
// sous la limite de taille d'un document Firestore).
function resizeImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width >= height && width > maxDim) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else if (height > maxDim) {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image illisible"));
    };
    img.src = url;
  });
}

async function savePhotoFile(placeId, file) {
  if (!db || !file) return;
  try {
    let dataUrl = await resizeImage(file, 1000, 0.7);
    if (dataUrl.length > PHOTO_MAX_CHARS) {
      dataUrl = await resizeImage(file, 800, 0.6);
    }
    if (dataUrl.length > PHOTO_MAX_CHARS) {
      showToast("Photo trop lourde, essaie avec une image plus petite.");
      return;
    }
    const by = ensureName();
    await setDoc(
      doc(db, PHOTOS_COLLECTION, placeId),
      { dataUrl, by, updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (error) {
    console.error("Erreur photo :", error);
    showWriteError(error);
  }
}

function removePhoto(placeId) {
  if (!db) return;
  setDoc(
    doc(db, PHOTOS_COLLECTION, placeId),
    { dataUrl: "", by: "", updatedAt: serverTimestamp() },
    { merge: true }
  ).catch((error) => {
    console.error("Erreur photo (retrait) :", error);
    showWriteError(error);
  });
}

function updateCardVisual(placeId, animate = false) {
  const isVisited = !!visitedState[placeId];
  const card = document.getElementById(`place-${placeId}`);
  const btn = card ? card.querySelector(".visited-toggle") : null;
  if (card) card.classList.toggle("is-visited", isVisited);
  updateMarkerVisual(placeId);
  if (btn) {
    btn.setAttribute("aria-pressed", String(isVisited));
    btn.querySelector(".visited-label").textContent = isVisited
      ? "Visité"
      : "Marquer visité";

    if (animate && isVisited) {
      btn.classList.remove("just-stamped");
      void btn.offsetWidth; // force un reflow pour rejouer l'animation
      btn.classList.add("just-stamped");
      btn.addEventListener(
        "animationend",
        () => btn.classList.remove("just-stamped"),
        { once: true }
      );
    }
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

    let firstSnapshot = true;

    onSnapshot(
      collection(db, VISITED_COLLECTION),
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          const wasVisited = !!visitedState[change.doc.id];
          const nowVisited = !!change.doc.data().visited;
          visitedState[change.doc.id] = nowVisited;
          // On n'anime le tampon que pour un vrai passage à "visité" en
          // direct, pas pour l'état déjà présent au premier chargement.
          updateCardVisual(
            change.doc.id,
            !firstSnapshot && !wasVisited && nowVisited
          );
        }
        updateProgress({ allowCelebrate: !firstSnapshot });
        firstSnapshot = false;
      },
      (error) => {
        console.error("Erreur Firestore (lecture) :", error);
        progressLabel.textContent =
          "Suivi partagé indisponible pour le moment (voir la console).";
      }
    );

    onSnapshot(
      collection(db, REACTIONS_COLLECTION),
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          reactionState[change.doc.id] =
            change.type === "removed" ? {} : change.doc.data().votes || {};
          updateReactions(change.doc.id);
        }
      },
      (error) => {
        console.error("Erreur Firestore (réactions, lecture) :", error);
      }
    );

    onSnapshot(
      collection(db, PLANNING_COLLECTION),
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          const raw = change.type === "removed" ? null : change.doc.data().day;
          planState[change.doc.id] =
            typeof raw === "number" && raw >= 1 && raw <= 5 ? raw : null;
          updatePlanner(change.doc.id);
        }
        // Le planning influe sur la vue "par jour" et sur le filtre "par
        // jour" : on ne recalcule que si l'un des deux est actif.
        if (groupBy === "day") renderGrouping();
        else if (activeDay !== "all") applyFilter();
      },
      (error) => {
        console.error("Erreur Firestore (planning, lecture) :", error);
      }
    );

    onSnapshot(
      collection(db, NOTES_COLLECTION),
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          if (change.type === "removed") {
            noteState[change.doc.id] = {};
          } else {
            const d = change.doc.data();
            noteState[change.doc.id] = {
              text: d.text || "",
              by: d.by || "",
              at: d.updatedAt && d.updatedAt.toDate ? d.updatedAt.toDate() : null,
            };
          }
          updateNote(change.doc.id);
        }
      },
      (error) => {
        console.error("Erreur Firestore (notes, lecture) :", error);
      }
    );

    onSnapshot(
      collection(db, PHOTOS_COLLECTION),
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          if (change.type === "removed") {
            photoState[change.doc.id] = {};
          } else {
            const d = change.doc.data();
            photoState[change.doc.id] = {
              dataUrl: d.dataUrl || "",
              by: d.by || "",
            };
          }
          updatePhoto(change.doc.id);
        }
      },
      (error) => {
        console.error("Erreur Firestore (photos, lecture) :", error);
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
  if (nextValue && "vibrate" in navigator) navigator.vibrate(35);
  setDoc(
    doc(db, VISITED_COLLECTION, placeId),
    { visited: nextValue, updatedAt: serverTimestamp() },
    { merge: true }
  ).catch((error) => {
    console.error("Erreur Firestore (écriture) :", error);
    showWriteError(error);
  });
}

function toggleReaction(placeId, emoji) {
  if (!db) return;
  const removing = (reactionState[placeId] || {})[clientId] === emoji;
  if (!removing && "vibrate" in navigator) navigator.vibrate(20);
  setDoc(
    doc(db, REACTIONS_COLLECTION, placeId),
    {
      votes: { [clientId]: removing ? deleteField() : emoji },
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  ).catch((error) => {
    console.error("Erreur Firestore (réaction) :", error);
    showWriteError(error);
  });
}

function setDay(placeId, day) {
  if (!db) return;
  const current = planState[placeId] ?? null;
  const next = current === day ? null : day;
  if (next != null && "vibrate" in navigator) navigator.vibrate(15);
  setDoc(
    doc(db, PLANNING_COLLECTION, placeId),
    { day: next, updatedAt: serverTimestamp() },
    { merge: true }
  ).catch((error) => {
    console.error("Erreur Firestore (planning) :", error);
    showWriteError(error);
  });
}

function saveNote(placeId, text) {
  if (!db) return;
  const clean = text.slice(0, NOTE_MAX);
  const by = ensureName();
  const previous = noteState[placeId];
  editingNote = null;
  noteState[placeId] = { text: clean, by, at: new Date() }; // affichage optimiste
  updateNote(placeId); // referme le formulaire tout de suite
  setDoc(
    doc(db, NOTES_COLLECTION, placeId),
    { text: clean, by, updatedAt: serverTimestamp() },
    { merge: true }
  ).catch((error) => {
    console.error("Erreur Firestore (note) :", error);
    noteState[placeId] = previous; // on annule l'affichage optimiste
    updateNote(placeId);
    showWriteError(error);
  });
}

function placeFromHash() {
  const raw = location.hash.replace(/^#(place-)?/, "");
  return raw ? PLACES.find((p) => p.id === raw) || null : null;
}

// Pendant le voyage, on ouvre par défaut le filtre du jour courant - sauf
// si l'URL pointe déjà sur un lieu précis (le deep-link a la priorité).
function selectInitialDay() {
  const todayN = currentTripDay();
  if (todayN == null || placeFromHash()) return;
  const chip = dayFiltersEl.querySelector(
    `.filter-chip[data-day="${todayN}"]`
  );
  if (!chip) return;
  activeDay = String(todayN);
  for (const c of dayFiltersEl.querySelectorAll(".filter-chip")) {
    c.classList.toggle("is-active", c === chip);
  }
  dayFiltersEl.scrollLeft =
    chip.offsetLeft - dayFiltersEl.clientWidth / 2 + chip.clientWidth / 2;
  applyFilter({ fit: true });
}

// Deep-link : #place-<id> (ou #<id>) ouvre le lieu au chargement / au
// changement de hash.
function openFromHash() {
  const place = placeFromHash();
  if (!place) return;
  highlightCard(place.id);
  flyToPlace(place, { scrollToMap: false });
}

// --- Partage : lien natif si dispo, sinon QR ------------------------

function shareUrl() {
  return location.origin + location.pathname;
}

function openShareDialog() {
  const url = shareUrl();
  const dlg = document.getElementById("share-dialog");
  const holder = document.getElementById("share-qr");
  if (!dlg || !holder || typeof dlg.showModal !== "function") return;

  holder.innerHTML = "";
  if (typeof window.qrcode === "function") {
    const qr = window.qrcode(0, "M");
    qr.addData(url);
    qr.make();
    holder.innerHTML = qr.createImgTag(5, 12);
  }
  const urlEl = document.getElementById("share-url");
  if (urlEl) urlEl.textContent = url;
  dlg.showModal();
}

const shareBtn = document.getElementById("share-btn");
if (shareBtn) {
  shareBtn.addEventListener("click", async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Carnet de route - Accra",
          url: shareUrl(),
        });
        return;
      } catch {
        /* annulé ou indisponible : on retombe sur le QR */
      }
    }
    openShareDialog();
  });
}

initFirebase();
updateProgress();
updateCountdown();
window.setInterval(updateCountdown, 1000);
selectInitialDay();
window.setTimeout(openFromHash, 200);
window.addEventListener("hashchange", openFromHash);
