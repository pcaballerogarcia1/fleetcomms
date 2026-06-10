# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server (Vite HMR)
npm run build     # Production build → dist/
npm run preview   # Preview production build locally
npm run lint      # ESLint check
```

No test suite is configured.

## Architecture

Single-page React app (Vite + React 19) targeting mobile fleet workers. All UI is in two files:

- **`src/App.jsx.jsx`** — entire frontend (~2000 lines). One large file; no separate component files.
- **`src/firebase.js.js`** — Firebase init + exported helpers (`listenCol`, `addItem`, `updateItem`, `deleteItem`) and `COL` constants for collection names.

### Firebase Firestore collections

| Collection | Purpose |
|---|---|
| `incidencias` | Fleet incident reports with comments |
| `planes` | Work plans (KML-based routes or manual tasks) |
| `inventario` | Spare parts/inventory products |
| `movimientos` | Stock movement log for inventory |
| `usuarios` | User accounts and roles |

### App modules (all inside `App.jsx.jsx`)

The root `App` component manages auth state and renders a bottom tab bar with four modules:

1. **`ModuloIncidencias`** — incident reporting feed with categories, priorities, comments, and admin stats (`PanelStats`). Reads from `incidencias` collection.
2. **`ModuloRutas` / `ListaPlanes`** — work route management. Supports four work types: Preventive Maintenance (`prev`), Corrective Maintenance (`corr`), Exterior Cleaning (`ext`), Interior Cleaning (`int`). KML-based types parse uploaded `.kml` files via `parseKML()` into stop lists with coordinates. Correctivo type uses manual task creation.
3. **`ModuloInventario`** — spare parts inventory with stock tracking, movements log, and low-stock alerts.
4. ~~`AsistenteIA`~~ — removed. The module was deleted; the bottom nav now has three tabs (Rutas, Incidencias, Inventario) plus Admin for admins.

### Key patterns

- **`useCollection(colName, orderField)`** — generic Firestore real-time hook used throughout. Returns `{data, loading}`.
- **`fbAdd/fbSet/fbUpdate/fbDelete`** — thin wrappers over Firestore operations, defined locally in `App.jsx.jsx` (separate from the helpers in `firebase.js.js`).
- **Design system** — all styles are inline JS objects (`S.*`) or the `C` color constants object. Global CSS is injected via a `<style>` tag (`FONTS` string). No CSS modules or styled-components.
- **`Btn` component** — base button with hover state management via `useState`.
- **`MapaLeaflet`** — loads Leaflet via CDN script tag at runtime (not an npm dependency). Renders stop markers on OpenStreetMap tiles.
- **Auth** — simple username/password check against the `USUARIOS_INIT` array or Firestore `usuarios` collection. No Firebase Auth.
- **Roles** — `"admin"` can upload KML, delete plans, manage users, change incident status. `"conductor"` has read/write for marking stops done.

### KML parsing

`parseKML()` reads Mercat / fleet KML exports. Expected fields per Placemark: `Ubicació Tècnica` (stop ID), `Orden`, `Codi QR`, `Calle`, `Num.`, `Barri`, `Districte`, `Model`, `Turno`, `Día`, `Comentari`. LineString placemarks become the route polyline.

### Inspection forms (`ParteInspeccion`)

Used for preventive maintenance stops. The `PUNTOS_INSPECCION` constant defines the checklist groups (12 groups, ~30 points). Can generate a printable HTML report via `window.open`.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
