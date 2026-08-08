# Data sources

Every dataset must be recorded here with its licence before use. If a source cannot
be used legally, the feature degrades — it does not get faked.

| Layer | Source | Licence | Notes |
|---|---|---|---|
| Basemap vectors | Protomaps / OpenStreetMap | ODbL | Attribution required and rendered on map |
| Elevation (DEM) | AWS Terrain Tiles (Terrarium) | Public domain / CC-BY per contributor | MapLibre reads natively for hillshade + 3D |
| Landcover | ESA WorldCover 10 m | CC-BY 4.0 | Aggregated to H3 res 4 |
| Boundaries | Natural Earth admin-0/1 | Public domain | Includes disputed-area variants — use them |
| Night lights | NASA Black Marble | Public domain | Night map base |
| Population | GHSL / WorldPop | CC-BY 4.0 | Population density and urban centres |
| Rail / road / ports | OSM via Geofabrik extracts | ODbL | Aggregate to density; no facility-level detail |
| Climate | ERA5 monthly normals (Copernicus) | Copernicus licence | Weather baseline |
| Satellite imagery | MapTiler Satellite | Commercial, API key | Optional; degrade to terrain if key absent |
| Country statistics | World Bank, UN, SIPRI, IISS | Various, cite per field | Tag `[O]` / `[E]` in the country table |

## Disputed territory

Natural Earth ships disputed-boundary variants. Render disputed borders in a
distinct style and do not silently pick a side. Where the simulation needs a single
answer for control, that is a *simulation* state, drawn differently from the
cartographic boundary.

## Attribution

`public/data/imagery-credits.json` holds attribution for every image and tile
source. It must be rendered somewhere reachable in the UI, not just committed.
