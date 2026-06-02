'use strict';

// ── Config ──────────────────────────────────────────────────────────────────

const ARCGIS_URL =
  'https://inatur.geodataonline.no/arcgis/rest/services/inatur/Open-Inatur' +
  '/MapServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson&resultRecordCount=15000';

const FALLBACK_URL = 'data/areas.geojson';

const TYPE_META = {
  innlandsfiske: { label: 'Innlandsfiske', color: '#5b9fd4', slug: 'innlandsfiske', link: 'fiske' },
  laksefiske:    { label: 'Laksefiske',    color: '#c0533a', slug: 'laksefiske',    link: 'fiske' },
  smavilt:       { label: 'Småvilt',       color: '#7ab87a', slug: 'smavilt',       link: 'jakt'  },
  storvilt:      { label: 'Storvilt',      color: '#a0652a', slug: 'storvilt',      link: 'jakt'  },
};

// Normalise raw "type" field values to our slug keys
const TYPE_NORM = {
  innlandsfiske: 'innlandsfiske',
  laksefiske:    'laksefiske',
  'laksefiske ': 'laksefiske',
  småvilt:       'smavilt',
  smavilt:       'smavilt',
  storvilt:      'storvilt',
};

// ── State ────────────────────────────────────────────────────────────────────

let allFeatures = [];
let filteredFeatures = [];
let activeType = 'alle';
let searchQuery = '';
let activeMarkerId = null;
let markerMap = {};   // objectid → Leaflet marker

// ── Map init ─────────────────────────────────────────────────────────────────

const map = L.map('map', {
  center: [65.0, 15.5],
  zoom: 5,
  zoomControl: true,
});

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://carto.com/">CARTO</a> | &copy; OSM contributors',
  subdomains: 'abcd',
  maxZoom: 19,
}).addTo(map);

const clusterGroup = L.markerClusterGroup({
  maxClusterRadius: 50,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: true,
});
map.addLayer(clusterGroup);

// ── DOM refs ─────────────────────────────────────────────────────────────────

const cardList     = document.getElementById('card-list');
const skeleton     = document.getElementById('skeleton');
const errorState   = document.getElementById('error-state');
const retryBtn     = document.getElementById('retry-btn');
const detailPanel  = document.getElementById('detail-panel');
const detailClose  = document.getElementById('detail-close');
const detailContent= document.getElementById('detail-content');
const resultCount  = document.getElementById('result-count');
const searchInput  = document.getElementById('search');
const filterBtns   = document.querySelectorAll('.filter-btn');

// ── Marker icons ─────────────────────────────────────────────────────────────

function makeIcon(typeSlug, active = false) {
  const meta = TYPE_META[typeSlug];
  const color = meta ? meta.color : '#888';
  const size = active ? 14 : 10;
  const border = active ? 3 : 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size + border * 2}" height="${size + border * 2}" viewBox="0 0 ${size + border * 2} ${size + border * 2}">
    <circle cx="${size / 2 + border}" cy="${size / 2 + border}" r="${size / 2}" fill="${color}" stroke="#1a1d23" stroke-width="${border}"/>
  </svg>`;
  const url = 'data:image/svg+xml;base64,' + btoa(svg);
  const total = size + border * 2;
  return L.icon({ iconUrl: url, iconSize: [total, total], iconAnchor: [total / 2, total / 2], popupAnchor: [0, -total / 2] });
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchData() {
  showSkeleton(true);
  showError(false);

  // Try live ArcGIS first, fall back to cached GeoJSON
  let geojson;
  try {
    const res = await fetch(ARCGIS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    geojson = await res.json();
  } catch (_) {
    try {
      const res = await fetch(FALLBACK_URL);
      if (!res.ok) throw new Error('fallback unavailable');
      geojson = await res.json();
    } catch (err) {
      showSkeleton(false);
      showError(true);
      return;
    }
  }

  allFeatures = (geojson.features || []).filter(f => {
    const p = f.properties || {};
    return p.aktivt === 1 || p.aktivt === '1' || p.aktivt == null;
  });

  showSkeleton(false);
  applyFilters();
}

// ── Filtering & rendering ─────────────────────────────────────────────────────

function normaliseType(raw) {
  if (!raw) return null;
  return TYPE_NORM[raw.toLowerCase().trim()] || null;
}

function applyFilters() {
  const q = searchQuery.toLowerCase();

  filteredFeatures = allFeatures.filter(f => {
    const p = f.properties || {};
    const typeSlug = normaliseType(p.type);

    if (activeType !== 'alle' && typeSlug !== activeType) return false;
    if (q && !(p.stedsnavn || '').toLowerCase().includes(q)) return false;
    return true;
  });

  renderMarkers();
  renderCards();
}

function renderMarkers() {
  clusterGroup.clearLayers();
  markerMap = {};

  filteredFeatures.forEach(f => {
    const coords = f.geometry && f.geometry.coordinates;
    if (!coords || coords.length < 2) return;

    const p = f.properties || {};
    const typeSlug = normaliseType(p.type);
    const id = p.objectid;

    const marker = L.marker([coords[1], coords[0]], {
      icon: makeIcon(typeSlug),
      title: p.stedsnavn || '',
    });

    marker.on('click', () => selectFeature(f, marker));

    marker.bindPopup(() => {
      const meta = TYPE_META[typeSlug] || {};
      return `<div class="popup-name">${p.stedsnavn || 'Ukjent område'}</div>
              <div class="popup-type">${meta.label || typeSlug || ''}</div>`;
    }, { autoPan: false });

    clusterGroup.addLayer(marker);
    markerMap[id] = marker;
  });

  resultCount.textContent = `${filteredFeatures.length} områder`;
}

function renderCards() {
  cardList.innerHTML = '';

  filteredFeatures.forEach(f => {
    const p = f.properties || {};
    const typeSlug = normaliseType(p.type);
    const meta = TYPE_META[typeSlug] || {};

    const li = document.createElement('li');
    li.className = 'area-card' + (p.objectid === activeMarkerId ? ' active' : '');
    li.dataset.id = p.objectid;
    li.innerHTML = `
      <span class="card-name">${p.stedsnavn || 'Ukjent område'}</span>
      <span class="card-type ${typeSlug || ''}">${meta.label || ''}</span>
    `;
    li.addEventListener('click', () => selectFeature(f, markerMap[p.objectid]));
    cardList.appendChild(li);
  });
}

// ── Selection ─────────────────────────────────────────────────────────────────

function selectFeature(feature, marker) {
  const p = feature.properties || {};
  const typeSlug = normaliseType(p.type);
  const meta = TYPE_META[typeSlug] || {};

  // Update active card
  activeMarkerId = p.objectid;
  document.querySelectorAll('.area-card').forEach(el => {
    el.classList.toggle('active', el.dataset.id == p.objectid);
  });

  // Scroll card into view
  const card = cardList.querySelector(`[data-id="${p.objectid}"]`);
  card && card.scrollIntoView({ block: 'nearest' });

  // Pan map to marker
  if (marker) {
    const coords = feature.geometry.coordinates;
    map.setView([coords[1], coords[0]], Math.max(map.getZoom(), 10), { animate: true });
    marker.openPopup();
  }

  // Show detail panel
  const buyPath = meta.link === 'fiske' ? 'fiske' : 'jakt';
  const buyUrl = `https://www.inatur.no/${buyPath}/${p.tilbudsid}`;

  detailContent.innerHTML = `
    <div class="detail-type ${typeSlug || ''}">${meta.label || ''}</div>
    <div class="detail-name">${p.stedsnavn || 'Ukjent område'}</div>
    ${p.tilbudsid
      ? `<a class="detail-buy-link" href="${buyUrl}" target="_blank" rel="noopener">
           Kjøp kort på inatur.no →
         </a>`
      : '<p style="color:var(--text-muted);font-size:.8rem">Ingen kjøpslenke tilgjengelig</p>'
    }
  `;
  detailPanel.hidden = false;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function showSkeleton(on) {
  skeleton.setAttribute('aria-hidden', on ? 'false' : 'true');
  skeleton.style.display = on ? 'block' : 'none';
}

function showError(on) {
  errorState.hidden = !on;
}

// ── Event listeners ───────────────────────────────────────────────────────────

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeType = btn.dataset.type;
    applyFilters();
  });
});

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  applyFilters();
});

detailClose.addEventListener('click', () => {
  detailPanel.hidden = true;
  activeMarkerId = null;
  document.querySelectorAll('.area-card').forEach(el => el.classList.remove('active'));
});

retryBtn.addEventListener('click', fetchData);

// ── Boot ──────────────────────────────────────────────────────────────────────

fetchData();
