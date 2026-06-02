# Inatur Kart

Interactive map of all fishing and hunting areas from [inatur.no](https://www.inatur.no), filterable by activity type with direct buy-links.

## Tech

- **Leaflet.js** — map rendering
- **Leaflet.markercluster** — marker clustering at low zoom
- **Inatur ArcGIS REST API** — live public data, no auth required
- **GitHub Actions** — nightly GeoJSON cache (fallback if API is unavailable)
- **GitHub Pages** — hosting

## Deploy

```bash
# GitHub Pages: Settings → Pages → Source: Deploy from branch → main / root
git push
```

## Data

Live data from:
```
https://inatur.geodataonline.no/arcgis/rest/services/inatur/Open-Inatur/MapServer/0/query
```

Nightly snapshot cached to `data/areas.geojson` by the GitHub Actions workflow.

## Color coding

| Type | Color |
|---|---|
| Innlandsfiske | `#5b9fd4` blue |
| Laksefiske | `#c0533a` red |
| Småvilt | `#7ab87a` green |
| Storvilt | `#a0652a` orange |
