import { C } from "../tema.js";
import { tono } from "../tema.js";
// Planning de rutas por puntos: colores, fuentes y estilos de mapa.










// ── DESIGN TOKENS ─────────────────────────────────────────────────
export { C };

export const font = "var(--font)";
export const mono = "var(--mono)";
export const LAYER_COLORS = [
  C.blue,C.orange,C.green,C.red,
  C.violet,C.amber,"#f472b6","#22d3ee",
];

// ── MAP STYLES ────────────────────────────────────────────────────
export const MAP_STYLES = [
  {
    // CARTO (basemaps.cartocdn.com) empezó a exigir API key en sus tiles
    // dark_all/light_all — sin ella, cada tile llega con la marca de agua
    // "API KEY REQUIRED" en vez del mapa. Esri sirve estos "Canvas" (mismo
    // estilo: base minimalista en gris/oscuro pensada para pintar datos
    // encima) sin necesidad de key, con el mismo esquema {z}/{y}/{x} que ya
    // usa "Satélite" un poco más abajo.
    key: "dark", label: "Oscuro", preview: tono("#1a2035", "#e9ebf4"),
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    // El "Base" de Esri es solo el fondo, sin nombres de calles/barrios —
    // esos vienen en una capa "Reference" aparte pensada para apilar encima.
    labelsUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
  },
  {
    key: "light", label: "Claro", preview: "#f5f5f0",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    labelsUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
  },
  {
    key: "satellite", label: "Satélite", preview: "#2d4a2d",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  },
  {
    key: "osm", label: "Calles", preview: "#e8d5b0",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  },
];
