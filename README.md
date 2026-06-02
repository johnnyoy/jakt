# Inatur Kart

Interactive map of all fishing and hunting areas from [inatur.no](https://www.inatur.no),
filterable by activity type with direct buy-links. No login required — the underlying
ArcGIS data is public.

**[→ Open the map](https://johnnyoy.github.io/jakt)**

---

## Features

- All active areas plotted as colored markers on a dark map of Norway
- Filter by activity: Innlandsfiske · Laksefiske · Småvilt · Storvilt
- County (fylke) dropdown — appears automatically when data includes that field
- Live search by area name
- Click any marker or sidebar card to see the area's polygon boundary and a direct
  buy-link to inatur.no
- Shareable URLs — current filter, search, county and selected area are encoded in
  the query string (`?filter=laksefiske&id=abc123`)
- Polygon boundaries appear when zoomed in (zoom ≥ 9); marker clusters at lower zooms
- Nightly data refresh via GitHub Actions — works even if ArcGIS is down

---

## Color coding

| Activity | Color |
|---|---|
| Innlandsfiske (freshwater) | `#5b9fd4` blue |
| Laksefiske (salmon) | `#c0533a` red |
| Småvilt (small game) | `#7ab87a` green |
| Storvilt (large game) | `#a0652a` orange |

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Vanilla HTML + JS — no build step |
| Map | [Leaflet.js](https://leafletjs.com) 1.9.4 (CDN) |
| Clustering | [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) 1.5.3 (CDN) |
| Basemap | CartoDB Dark Matter |
| Data | [Inatur ArcGIS REST API](https://inatur.geodataonline.no/arcgis/rest/services/inatur/Open-Inatur/MapServer) |
| Hosting | GitHub Pages |
| Data cache | GitHub Actions (nightly) |

---

## Data source

All data comes from Inatur's public ArcGIS REST service — no auth required:

```
https://inatur.geodataonline.no/arcgis/rest/services/inatur/Open-Inatur/MapServer
```

| Layer | Contents |
|---|---|
| 0 — Representasjonspunkt | One point per area with type, name, tilbudsid |
| 4 — Flate | Polygon boundaries for area shapes |

### Buy-link pattern

```
Fiske:  https://www.inatur.no/fiske/{tilbudsid}
Jakt:   https://www.inatur.no/jakt/{tilbudsid}
```

---

## Running locally

```bash
git clone https://github.com/johnnyoy/jakt.git
cd jakt
python3 -m http.server 8080
# open http://localhost:8080
```

> **Note:** Do not open `index.html` as a `file://` URL — the ArcGIS fetch is
> blocked by CORS outside an HTTP context.

---

## Deploying to GitHub Pages

1. Push to `main`
2. Go to **Settings → Pages → Source → Deploy from branch → `main` / root**
3. Your site is live at `https://<username>.github.io/<repo>`

### Custom domain

Add your domain to the `CNAME` file and configure a CNAME DNS record pointing to
`<username>.github.io`. GitHub handles HTTPS automatically.

---

## Nightly data cache

`.github/workflows/cache-data.yml` runs at 03:00 UTC every night.
It fetches fresh GeoJSON from ArcGIS and commits it to `data/` only if the content
changed. The app falls back to these cached files when the live API is unavailable.

**First-time setup:** run the workflow manually from the Actions tab to populate
`data/areas.geojson` and `data/polygons.geojson` before the first nightly run.

---

## CORS

The ArcGIS server may reject requests from GitHub Pages. If markers don't load:

**Option A — Cloudflare Worker proxy (free tier, ~5 minutes):**

```js
// worker.js — deploy at https://workers.cloudflare.com
export default {
  fetch(req) {
    const url = new URL(req.url);
    const target = 'https://inatur.geodataonline.no' + url.pathname + url.search;
    return fetch(target).then(r =>
      new Response(r.body, {
        headers: { ...Object.fromEntries(r.headers), 'Access-Control-Allow-Origin': '*' }
      })
    );
  }
}
```

Then replace `ARCGIS_URL` and `ARCGIS_POLY_URL` in `app.js` with your worker URL.

**Option B — Use cached data only:**  
Run the GitHub Actions workflow to populate `data/`. The app will serve from there
with zero CORS issues, refreshed nightly.

---

## Project structure

```
index.html                  App shell, filter buttons, sidebar markup
style.css                   All styles (CSS variables, dark theme, responsive)
app.js                      Map logic, data fetching, filtering, URL state
data/
  areas.geojson             Nightly-cached Layer 0 points
  polygons.geojson          Nightly-cached Layer 4 polygons
.github/workflows/
  cache-data.yml            Nightly data refresh
CNAME                       Custom domain (edit to your domain)
AGENTS.md                   Guide for AI agents working on this codebase
```

---

## For AI agents

See [AGENTS.md](AGENTS.md) for architecture details, state model, coding conventions,
and instructions for making changes safely.
