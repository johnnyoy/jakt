'use strict';

// ── Config ──────────────────────────────────────────────────────────────────

const ARCGIS_URL =
  'https://inatur.geodataonline.no/arcgis/rest/services/inatur/Open-Inatur' +
  '/MapServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson&resultRecordCount=15000';

const ARCGIS_POLY_URL =
  'https://inatur.geodataonline.no/arcgis/rest/services/inatur/Open-Inatur' +
  '/MapServer/4/query?where=1%3D1&outFields=*&outSR=4326&f=geojson&resultRecordCount=15000';

const FALLBACK_URL      = 'data/areas.geojson';
const FALLBACK_POLY_URL = 'data/polygons.geojson';

const POLY_ZOOM_MIN = 9;

const TYPE_META = {
  innlandsfiske: { label: 'Innlandsfiske', color: '#5b9fd4', slug: 'innlandsfiske', link: 'fiske' },
  laksefiske:    { label: 'Laksefiske',    color: '#c0533a', slug: 'laksefiske',    link: 'fiske' },
  smavilt:       { label: 'Småvilt',       color: '#7ab87a', slug: 'smavilt',       link: 'jakt'  },
  storvilt:      { label: 'Storvilt',      color: '#a0652a', slug: 'storvilt',      link: 'jakt'  },
};

const TYPE_NORM = {
  innlandsfiske: 'innlandsfiske',
  laksefiske:    'laksefiske',
  'laksefiske ': 'laksefiske',
  småvilt:       'smavilt',
  smavilt:       'smavilt',
  storvilt:      'storvilt',
};

// ── State ────────────────────────────────────────────────────────────────────

let allFeatures     = [];
let allPolyFeatures = [];
let filteredFeatures = [];
let activeType      = 'alle';
let searchQuery     = '';
let activeMarkerId  = null;
let activeTilbudsid = null;
let markerMap       = {};  // objectid → Leaflet marker
let polyByTilbud    = {};  // tilbudsid → [polygon features]
let polyLayer       = null;
let highlightLayer  = null;

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

const cardList      = document.getElementById('card-list');
const skeleton      = document.getElementById('skeleton');
const errorState    = document.getElementById('error-state');
const retryBtn      = document.getElementById('retry-btn');
const detailPanel   = document.getElementById('detail-panel');
const detailClose   = document.getElementById('detail-close');
const detailContent = document.getElementById('detail-content');
const resultCount   = document.getElementById('result-count');
const searchInput   = document.getElementById('search');
const filterBtns    = document.querySelectorAll('.filter-btn');

// ── Marker icons ─────────────────────────────────────────────────────────────

function makeIcon(typeSlug) {
  const meta = TYPE_META[typeSlug];
  const color = meta ? meta.color : '#888';
  const size = 10, border = 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size + border * 2}" height="${size + border * 2}" viewBox="0 0 ${size + border * 2} ${size + border * 2}">
    <circle cx="${size / 2 + border}" cy="${size / 2 + border}" r="${size / 2}" fill="${color}" stroke="#1a1d23" stroke-width="${border}"/>
  </svg>`;
  const total = size + border * 2;
  return L.icon({
    iconUrl: 'data:image/svg+xml;base64,' + btoa(svg),
    iconSize: [total, total],
    iconAnchor: [total / 2, total / 2],
    popupAnchor: [0, -total / 2],
  });
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchGeoJSON(primaryUrl, fallbackUrl) {
  try {
    const res = await fetch(primaryUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (_) {
    const res = await fetch(fallbackUrl);
    if (!res.ok) throw new Error('fallback also unavailable');
    return res.json();
  }
}

function isActive(p) {
  return p.aktivt === 1 || p.aktivt === '1' || p.aktivt == null;
}

async function fetchData() {
  showSkeleton(true);
  showError(false);

  try {
    const [pointResult, polyResult] = await Promise.allSettled([
      fetchGeoJSON(ARCGIS_URL, FALLBACK_URL),
      fetchGeoJSON(ARCGIS_POLY_URL, FALLBACK_POLY_URL),
    ]);

    if (pointResult.status === 'rejected') {
      showSkeleton(false);
      showError(true);
      return;
    }

    allFeatures = (pointResult.value.features || []).filter(f => isActive(f.properties || {}));

    // Polygons are best-effort — degrade gracefully if unavailable
    if (polyResult.status === 'fulfilled') {
      allPolyFeatures = (polyResult.value.features || []).filter(f => isActive(f.properties || {}));
      polyByTilbud = {};
      allPolyFeatures.forEach(f => {
        const tid = f.properties?.tilbudsid;
        if (!tid) return;
        (polyByTilbud[tid] = polyByTilbud[tid] || []).push(f);
      });
    }

    showSkeleton(false);
    applyFilters();
  } catch (_) {
    showSkeleton(false);
    showError(true);
  }
}

// ── Filtering ─────────────────────────────────────────────────────────────────

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
  renderPolygons();
}

// ── Markers ───────────────────────────────────────────────────────────────────

function renderMarkers() {
  clusterGroup.clearLayers();
  markerMap = {};

  filteredFeatures.forEach(f => {
    const coords = f.geometry && f.geometry.coordinates;
    if (!coords || coords.length < 2) return;

    const p = f.properties || {};
    const typeSlug = normaliseType(p.type);

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
    markerMap[p.objectid] = marker;
  });

  resultCount.textContent = `${filteredFeatures.length} områder`;
}

// ── Cards ─────────────────────────────────────────────────────────────────────

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

// ── Polygon layer ─────────────────────────────────────────────────────────────

function polyBaseStyle(typeSlug) {
  const color = (TYPE_META[typeSlug] || {}).color || '#888';
  return { color, weight: 1.5, opacity: 0.65, fillColor: color, fillOpacity: 0.12 };
}

function renderPolygons() {
  if (polyLayer) map.removeLayer(polyLayer);
  polyLayer = null;
  clearHighlight();

  if (!allPolyFeatures.length) return;

  const q = searchQuery.toLowerCase();
  const visible = allPolyFeatures.filter(f => {
    const p = f.properties || {};
    const typeSlug = normaliseType(p.type);
    if (activeType !== 'alle' && typeSlug !== activeType) return false;
    if (q && !(p.stedsnavn || '').toLowerCase().includes(q)) return false;
    return true;
  });

  polyLayer = L.geoJSON(visible, {
    style: f => polyBaseStyle(normaliseType(f.properties?.type)),
    onEachFeature(f, layer) {
      layer.on('click', () => {
        const tid = f.properties?.tilbudsid;
        const point = allFeatures.find(pf => pf.properties?.tilbudsid == tid);
        if (point) selectFeature(point, markerMap[point.properties.objectid]);
      });
      layer.on('mouseover', e => {
        if (f.properties?.tilbudsid !== activeTilbudsid)
          e.target.setStyle({ fillOpacity: 0.28 });
      });
      layer.on('mouseout', e => {
        if (f.properties?.tilbudsid !== activeTilbudsid)
          polyLayer.resetStyle(e.target);
      });
    },
  });

  if (map.getZoom() >= POLY_ZOOM_MIN) map.addLayer(polyLayer);

  // Re-apply highlight if something is still selected after a filter change
  if (activeTilbudsid) showHighlight(activeTilbudsid);
}

function showHighlight(tilbudsid) {
  clearHighlight();
  const polys = polyByTilbud[tilbudsid];
  if (!polys || !polys.length) return;

  const color = (TYPE_META[normaliseType(polys[0].properties?.type)] || {}).color || '#fff';
  highlightLayer = L.geoJSON(polys, {
    style: { color, weight: 3, opacity: 1, fillColor: color, fillOpacity: 0.3 },
  });
  map.addLayer(highlightLayer);
}

function clearHighlight() {
  if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
}

// Show/hide polygon layer based on zoom level
map.on('zoomend', () => {
  if (!polyLayer) return;
  if (map.getZoom() >= POLY_ZOOM_MIN) {
    if (!map.hasLayer(polyLayer)) map.addLayer(polyLayer);
  } else {
    if (map.hasLayer(polyLayer)) map.removeLayer(polyLayer);
  }
});

// ── Selection ─────────────────────────────────────────────────────────────────

function selectFeature(feature, marker) {
  const p = feature.properties || {};
  const typeSlug = normaliseType(p.type);
  const meta = TYPE_META[typeSlug] || {};

  activeMarkerId  = p.objectid;
  activeTilbudsid = p.tilbudsid;

  document.querySelectorAll('.area-card').forEach(el => {
    el.classList.toggle('active', el.dataset.id == p.objectid);
  });

  const card = cardList.querySelector(`[data-id="${p.objectid}"]`);
  card && card.scrollIntoView({ block: 'nearest' });

  if (marker) {
    const coords = feature.geometry.coordinates;
    map.setView([coords[1], coords[0]], Math.max(map.getZoom(), 10), { animate: true });
    marker.openPopup();
  }

  showHighlight(p.tilbudsid);

  const buyPath = meta.link === 'fiske' ? 'fiske' : 'jakt';
  const buyUrl  = `https://www.inatur.no/${buyPath}/${p.tilbudsid}`;

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
  activeMarkerId  = null;
  activeTilbudsid = null;
  clearHighlight();
  document.querySelectorAll('.area-card').forEach(el => el.classList.remove('active'));
});

retryBtn.addEventListener('click', fetchData);

// ── Boot ──────────────────────────────────────────────────────────────────────

fetchData();
