// Planning de rutas por puntos: colores, fuentes y estilos de mapa.










// ── DESIGN TOKENS ─────────────────────────────────────────────────
export const C = {
  bg:      "#0b0d12",
  card:    "#12151c",
  surface2:"#181c25",
  border:  "rgba(255,255,255,0.08)",
  border2: "rgba(255,255,255,0.14)",
  blue:    "#5b7cfa",
  blueDim: "#1a2142",
  blueText:"#b4c3ff",
  cyan:    "#5b7cfa",
  cyanDim: "#1a2142",
  cyanText:"#b4c3ff",
  green:   "#3fcf8e",
  greenDim:"#0f2a1f",
  orange:  "#f59e5b",
  red:     "#f26d6d",
  amber:   "#f5b84a",
  text:    "#e6e8ee",
  muted:   "#9aa3b2",
  dim:     "#5d6574",
};

export const font = "var(--font)";
export const mono = "var(--mono)";
export const LAYER_COLORS = [
  "#5b7cfa","#f59e5b","#3fcf8e","#f26d6d",
  "#a78bfa","#f5b84a","#f472b6","#22d3ee",
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
    key: "dark", label: "Oscuro", preview: "#1a2035",
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
