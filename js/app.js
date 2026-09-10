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
const REACTIONS = ["🔥", "❤️", "👍"];
const NOTE_MAX = 280;

// --- État local -------------------------------------------------------

const visitedState = {}; // { [placeId]: boolean }
const reactionState = {}; // { [placeId]: { [clientId]: emoji } }
const planState = {}; // { [placeId]: 1..5 | null }
const noteState = {}; // { [placeId]: string }
const markers = {}; // { [placeId]: L.Marker }
let db = null;
let editingNote = null; // placeId de la note en cours d'édition (sinon null)

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
    const dayNum = Math.floor((now - TRIP_START) / MS_PER_DAY) + 1;
    el.textContent = `Jour ${dayNum} / ${TRIP_DAYS} à Accra`;
  } else {
    el.dataset.phase = "after";
    el.classList.remove("has-ticker");
    el.textContent = "Souvenirs d'Accra";
  }
}

function flyToPlace(place) {
  if (place.lat == null || place.lng == null) return;
  const mapEl = document.getElementById("map");
  if (mapEl) mapEl.scrollIntoView({ behavior: "smooth", block: "start" });

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

  for (const section of document.querySelectorAll(".category-section")) {
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
    <div class="card-actions">
      ${
        safeMapsUrl
          ? `<a class="maps-link" href="${escapeHtml(safeMapsUrl)}" target="_blank" rel="noopener">Voir sur Google Maps ↗</a>`
          : `<span class="maps-link maps-link--disabled">Adresse partagée dans le groupe</span>`
      }
      ${
        hasLocation
          ? `<button class="locate-btn" data-id="${place.id}">Localiser sur la carte</button>`
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

for (const [key, cat] of Object.entries(CATEGORIES)) {
  const placesInCat = PLACES.filter((p) => p.category === key);
  if (placesInCat.length === 0) continue;

  const section = document.createElement("section");
  section.className = "category-section";
  section.id = `cat-${key}`;

  const title = document.createElement("h2");
  title.className = "category-title";
  title.style.setProperty("--accent", cat.color);
  title.textContent = `${cat.icon} ${cat.label}`;
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

  const text = noteState[placeId] || "";
  const textEl = wrap.querySelector(".note-text");
  const editBtn = wrap.querySelector(".note-edit");

  wrap.querySelector(".note-form").hidden = true;
  editBtn.hidden = false;

  if (text) {
    textEl.textContent = text;
    textEl.hidden = false;
    editBtn.textContent = "Modifier la note";
  } else {
    textEl.textContent = "";
    textEl.hidden = true;
    editBtn.textContent = "+ Note partagée";
  }
}

function openNoteEditor(placeId) {
  const wrap = document.querySelector(`.note[data-id="${placeId}"]`);
  if (!wrap) return;

  editingNote = placeId;
  const input = wrap.querySelector(".note-input");
  input.value = noteState[placeId] || "";
  wrap.querySelector(".note-text").hidden = true;
  wrap.querySelector(".note-edit").hidden = true;
  wrap.querySelector(".note-form").hidden = false;
  input.focus();
}

function closeNoteEditor(placeId) {
  if (editingNote === placeId) editingNote = null;
  updateNote(placeId);
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
        // Le filtre "par jour" dépend du planning : on ne relance applyFilter
        // que s'il est effectivement actif (sinon un changement de planning
        // n'a aucun impact sur la visibilité).
        if (activeDay !== "all") applyFilter();
      },
      (error) => {
        console.error("Erreur Firestore (planning, lecture) :", error);
      }
    );

    onSnapshot(
      collection(db, NOTES_COLLECTION),
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          noteState[change.doc.id] =
            change.type === "removed" ? "" : change.doc.data().text || "";
          updateNote(change.doc.id);
        }
      },
      (error) => {
        console.error("Erreur Firestore (notes, lecture) :", error);
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
  const previous = noteState[placeId];
  editingNote = null;
  noteState[placeId] = clean; // affichage optimiste
  updateNote(placeId); // referme le formulaire tout de suite
  setDoc(
    doc(db, NOTES_COLLECTION, placeId),
    { text: clean, updatedAt: serverTimestamp() },
    { merge: true }
  ).catch((error) => {
    console.error("Erreur Firestore (note) :", error);
    noteState[placeId] = previous; // on annule l'affichage optimiste
    updateNote(placeId);
    showWriteError(error);
  });
}

initFirebase();
updateProgress();
updateCountdown();
window.setInterval(updateCountdown, 1000);
