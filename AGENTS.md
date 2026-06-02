# AGENTS.md — Guide for AI agents working on this codebase

## What this project is

**Inatur Kart** is a pure-frontend web app that renders all fishing and hunting areas
from [inatur.no](https://www.inatur.no) on an interactive Leaflet map. Data comes from
Inatur's public ArcGIS REST service. No backend, no build step, no Node.js.

The live site is hosted on GitHub Pages and auto-deploys when `main` is pushed.

---

## Critical constraint: no build tooling

This project deliberately has **zero build tools**. Do not add:
- `package.json` / npm / yarn / pnpm
- Webpack, Vite, Parcel, Rollup, esbuild
- TypeScript compilation
- CSS preprocessors (Sass, Less, PostCSS)
- Any CI step that produces a dist folder

All JavaScript and CSS is plain, runs directly in the browser as-is.
Dependencies are loaded from CDN in `index.html`.

---

## File map

```
index.html           App shell — markup only, no logic
style.css            All styles, CSS variables for theming
app.js               All JavaScript — map, data, state, events
data/areas.geojson   Nightly-cached Layer 0 points (fallback)
data/polygons.geojson Nightly-cached Layer 4 polygons (fallback)
CNAME                Custom domain (edit to set your domain)
.github/workflows/
  cache-data.yml     Nightly job: fetches both GeoJSON layers, commits if changed
```

---

## Running locally

```bash
# From the repo root:
python3 -m http.server 8080
# then open http://localhost:8080
```

Opening `index.html` directly as a `file://` URL will fail — the ArcGIS fetch
is blocked by CORS in that context, and the fallback GeoJSON fetch also fails.
Always use a local HTTP server.

---

## Data flow

```
Browser boot
  │
  ├─ fetch Layer 0 (points) ──► allFeatures[]
  │    ArcGIS primary → data/areas.geojson fallback
  │
  └─ fetch Layer 4 (polygons) ──► allPolyFeatures[]  (best-effort)
       ArcGIS primary → data/polygons.geojson fallback

applyFilters()
  │
  ├─ filteredFeatures[] = allFeatures filtered by activeType + activeFylke + searchQuery
  ├─ renderMarkers()  → clusterGroup (Leaflet.markercluster)
  ├─ renderCards()    → #card-list  (sidebar)
  ├─ renderPolygons() → polyLayer   (L.geoJSON, shown at zoom ≥ 9)
  └─ syncURL()        → history.replaceState (shareable link)

selectFeature(feature, marker)
  ├─ pan map + open popup
  ├─ showHighlight(tilbudsid) → highlightLayer (bright polygon on top)
  ├─ render #detail-panel with inatur.no buy link
  └─ syncURL()
```

---

## State variables (app.js globals)

| Variable | Type | Meaning |
|---|---|---|
| `allFeatures` | Feature[] | All active point features from Layer 0 |
| `allPolyFeatures` | Feature[] | All active polygon features from Layer 4 |
| `filteredFeatures` | Feature[] | Current visible subset after filters |
| `activeType` | string | `'alle'` or one of the TYPE_META keys |
| `activeFylke` | string | County name or `''` for all |
| `searchQuery` | string | Current search box value |
| `activeMarkerId` | number\|null | `objectid` of selected area |
| `activeTilbudsid` | string\|null | `tilbudsid` of selected area |
| `pendingId` | string\|null | `tilbudsid` from URL `?id=` to select on first load |
| `markerMap` | object | `objectid → L.marker` for the current filtered set |
| `polyByTilbud` | object | `tilbudsid → [polygon features]` lookup |
| `polyLayer` | L.geoJSON\|null | Current polygon layer (zoom-gated) |
| `highlightLayer` | L.geoJSON\|null | Selected area highlight layer |

---

## Key functions

| Function | What it does |
|---|---|
| `applyFilters()` | Single entry point for all filter/search changes. Rebuilds markers, cards, polygons, and syncs URL. |
| `selectFeature(f, marker)` | Handles all selection side-effects: pan map, highlight polygon, show detail panel, sync URL. |
| `syncURL()` | Writes current filter/selection state to `?filter=&fylke=&q=&id=` without page reload. |
| `restoreFromURL()` | Reads URL params at boot, sets state variables, returns `tilbudsid` to select after data loads. |
| `buildCountyFilter()` | After data loads, extracts unique fylke values and populates the county `<select>`. Hidden if no fylke field in data. |
| `renderPolygons()` | Rebuilds the polygon GeoJSON layer to match current filters. Restores highlight if something is selected. |
| `showHighlight(tilbudsid)` | Adds a bright overlay polygon for the selected area on top of `polyLayer`. |
| `fetchGeoJSON(primary, fallback)` | Tries primary URL, falls back to local GeoJSON on any error. |

---

## Type normalisation

Raw API values for the `type` field are inconsistent (mixed case, trailing spaces,
Norwegian characters). The `TYPE_NORM` object maps them to four canonical slugs:
`innlandsfiske`, `laksefiske`, `smavilt`, `storvilt`.

Always use `normaliseType(raw)` when reading `feature.properties.type`.

---

## Polygon ↔ point join

Layer 0 (points) and Layer 4 (polygons) are joined by the `tilbudsid` field.
`polyByTilbud` is a lookup built after polygon data loads:
```
polyByTilbud[tilbudsid] = [polygonFeature, ...]
```
One area can have multiple polygon features (separate parcels).

---

## URL format

```
?filter=laksefiske   — active type filter (omitted when 'alle')
&fylke=Trøndelag     — active county (omitted when empty)
&q=gaula             — search query (omitted when empty)
&id=abc123           — tilbudsid of selected area (omitted when none)
```

All parameters are optional and independent. The URL is updated via
`history.replaceState` — no page reloads, no browser history entries.

---

## CDN versions in use

```html
leaflet              1.9.4
leaflet.markercluster 1.5.3
```

To upgrade, change both the CSS `<link>` and the `<script>` tags in `index.html`.

---

## Styling conventions

- All colours defined as CSS variables in `:root` in `style.css`
- Dark theme only — `--bg`, `--surface`, `--surface2`, `--border`, `--text`, `--text-muted`, `--accent`
- Type colours: `--fish-inland`, `--fish-salmon`, `--hunt-small`, `--hunt-large`
- Responsive breakpoint at `700px` — sidebar collapses, detail panel becomes bottom drawer
- Leaflet popup themed via `.leaflet-popup-*` selectors at bottom of `style.css`

---

## Testing

No automated test suite. To verify changes:

1. `python3 -m http.server 8080` → open `http://localhost:8080`
2. Check: map loads, markers appear, filter buttons work, search filters cards and markers
3. Click a marker → map pans, popup opens, detail panel shows, polygon highlights (at zoom ≥ 9)
4. Check URL updates on each interaction and the page restores correctly on reload
5. Resize browser to < 700px and verify mobile layout

---

## Deployment

Push to `main` → GitHub Pages auto-deploys in ~30 seconds.

The nightly GitHub Actions workflow (`.github/workflows/cache-data.yml`) fetches
fresh GeoJSON from ArcGIS and commits it to `data/`. Run it manually from the
Actions tab after first deploy to populate the fallback files.

---

## Things NOT to do

- Do not add a build step or `package.json`
- Do not introduce a JS framework (React, Vue, Svelte, etc.)
- Do not split `app.js` into modules unless the file grows past ~600 lines and
  the browser's native ES modules can be used with `type="module"` — no bundler
- Do not add a backend or proxy unless the ArcGIS CORS issue becomes persistent
  (see README for the Cloudflare Worker option)
- Do not commit large binary files or actual data snapshots to git history;
  the GitHub Actions workflow handles data freshness
- Do not use `innerHTML` with unsanitised user input — search queries go through
  filter logic only, never into innerHTML directly
