import { useState, useRef, useEffect, useCallback, Fragment } from "react";
import * as XLSX from "xlsx";
import { db, auth } from "./firebase.js";
import { collection, onSnapshot, query, doc, setDoc, deleteDoc, updateDoc, serverTimestamp, where, getDoc } from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";

// ── DESIGN TOKENS ─────────────────────────────────────────────────
const C = {
  bg:      "#0f1623",
  card:    "#172035",
  surface2:"#1e2d48",
  border:  "rgba(88,130,225,0.22)",
  border2: "rgba(88,130,225,0.40)",
  blue:    "#5c9bff",
  blueDim: "#0d2550",
  blueText:"#b0ccff",
  cyan:    "#5c9bff",
  cyanDim: "#0d2550",
  cyanText:"#b0ccff",
  green:   "#34d399",
  greenDim:"#072015",
  orange:  "#fb923c",
  red:     "#f87171",
  amber:   "#fbbf24",
  text:    "#f0f4f8",
  muted:   "#8b95a5",
  dim:     "#3d4d63",
};
const font = "'Inter',system-ui,sans-serif";
const mono = "'JetBrains Mono','Courier New',monospace";

const LAYER_COLORS = [
  "#4f8ef7","#fb923c","#34d399","#f87171",
  "#a78bfa","#fbbf24","#f472b6","#22d3ee",
];

// Misma paleta y función que scheduling — colores deterministas por barrio
const BARRIO_PALETTE = [
  "#4f8ef7","#34d399","#fb923c","#f87171",
  "#a78bfa","#fbbf24","#f472b6","#22d3ee","#818cf8","#4ade80",
];
const _barrioCache = {};
function barrioColorDefault(b) {
  if (!b) return "#8b95a5";
  if (_barrioCache[b]) return _barrioCache[b];
  let h = 0;
  for (let i = 0; i < b.length; i++) h = (h * 31 + b.charCodeAt(i)) >>> 0;
  return (_barrioCache[b] = BARRIO_PALETTE[h % BARRIO_PALETTE.length]);
}
function barrioColor(b, overrides = {}) {
  return overrides[b] || barrioColorDefault(b);
}
// Detecta el campo de barrio comparando en lowercase (independiente de capitalización)
const BARRIO_KEYS = ["barri","barrio","barri_nom","sector","zona","zone","district",
                     "districte","municipio","area","neighbourhood","neighborhood"];
function getBarrio(m) {
  for (const [k, v] of Object.entries(m)) {
    if (BARRIO_KEYS.includes(k.toLowerCase().trim()) && v) return String(v);
  }
  return "";
}

const USUARIOS_INIT = [
  { id:"1", nombre:"Admin",  apellidos:"Sistema",  usuario:"admin",    password:"admin123", rol:"admin",     activo:true },
  { id:"2", nombre:"Carlos", apellidos:"Martín",   usuario:"cmartin",  password:"1234",     rol:"conductor", activo:true },
  { id:"3", nombre:"Laura",  apellidos:"Sánchez",  usuario:"lsanchez", password:"1234",     rol:"conductor", activo:true },
  { id:"4", nombre:"Pedro",  apellidos:"Ruiz",     usuario:"pruiz",    password:"1234",     rol:"conductor", activo:true },
];

// ── GLOBAL STYLES ─────────────────────────────────────────────────
if (typeof document !== "undefined" && !document.getElementById("planning-styles")) {
  const s = document.createElement("style");
  s.id = "planning-styles";
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
    *,*::before,*::after{box-sizing:border-box;-webkit-font-smoothing:antialiased;}
    body{margin:0;background:#0f1117;color:#f0f4f8;font-family:'Inter',system-ui,sans-serif;}
    ::-webkit-scrollbar{width:4px;height:4px;}
    ::-webkit-scrollbar-track{background:#161b27;}
    ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:2px;}

    .planning-map .leaflet-popup-content-wrapper{
      background:#161b27;color:#f0f4f8;
      border:1px solid rgba(255,255,255,0.1);
      border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.6);padding:0;
    }
    .planning-map .leaflet-popup-content{margin:0;}
    .planning-map .leaflet-popup-tip{background:#161b27;}
    .planning-map .leaflet-popup-close-button{color:#8b95a5!important;font-size:18px!important;top:6px!important;right:10px!important;}
    .planning-map .leaflet-popup-close-button:hover{color:#f0f4f8!important;}
    .planning-map .leaflet-control-zoom a{
      background:#161b27!important;color:#f0f4f8!important;border-color:rgba(255,255,255,0.1)!important;
    }
    .planning-map .leaflet-control-zoom a:hover{background:#1c2333!important;}
    .planning-map .leaflet-bar{border-color:rgba(255,255,255,0.1)!important;box-shadow:0 2px 12px rgba(0,0,0,.4)!important;}
    @keyframes planning-spin{to{transform:rotate(360deg)}}
    @keyframes planning-fadein{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  `;
  document.head.appendChild(s);
}

// ── CSV PARSER ────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.replace(/\r/g, "").trim().split("\n").filter(Boolean);
  if (lines.length < 2) return { markers: [], error: "El CSV necesita al menos cabecera + 1 fila de datos." };

  // Detect delimiter: count commas vs semicolons in header
  const rawHeader = lines[0];
  const delim = (rawHeader.split(";").length > rawHeader.split(",").length) ? ";" : ",";

  const headers = rawHeader.split(delim).map(h => h.trim().replace(/^["']|["']$/g, "").toLowerCase());

  // Find lat/lng column indices
  const LAT_NAMES = ["lat","latitude","latitud","y","coord_y","geo_lat"];
  const LNG_NAMES = ["lon","lng","long","longitude","longitud","x","coord_x","geo_lon","geo_long"];
  const latIdx = headers.findIndex(h => LAT_NAMES.includes(h));
  const lngIdx = headers.findIndex(h => LNG_NAMES.includes(h));

  if (latIdx === -1 || lngIdx === -1) {
    return {
      markers: [],
      error: `No se encontraron columnas de coordenadas. Cabeceras detectadas: ${headers.join(", ")}. Asegúrate de tener columnas 'lat'/'latitude' y 'lon'/'longitude'.`,
    };
  }

  const markers = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delim).map(c => c.trim().replace(/^["']|["']$/g, ""));
    const lat = parseFloat(cols[latIdx]);
    const lng = parseFloat(cols[lngIdx]);
    if (isNaN(lat) || isNaN(lng)) continue;
    const fields = {};
    headers.forEach((h, idx) => {
      if (idx !== latIdx && idx !== lngIdx && cols[idx] !== undefined && cols[idx] !== "") {
        fields[h] = cols[idx];
      }
    });
    markers.push({ lat, lng, ...fields });
  }

  if (markers.length === 0) return { markers: [], error: "No se encontraron filas con coordenadas válidas." };
  return { markers, error: null };
}

// ── XLSX PARSER ───────────────────────────────────────────────────
async function parseXLSX(file) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  if (rows.length === 0) return { markers: [], error: "El archivo Excel está vacío." };

  const firstRow = rows[0];
  const coordKey = Object.keys(firstRow).find(k => k.toLowerCase().trim() === "coordenadas");

  if (!coordKey) {
    const cols = Object.keys(firstRow).join(", ");
    return { markers: [], error: `No se encontró la columna "coordenadas". Columnas detectadas: ${cols}` };
  }

  const markers = [];
  for (const row of rows) {
    const raw = String(row[coordKey] ?? "").trim();
    if (!raw) continue;
    const parts = raw.split(",");
    if (parts.length < 2) continue;
    const lat = parseFloat(parts[0].trim());
    const lng = parseFloat(parts[1].trim());
    if (isNaN(lat) || isNaN(lng)) continue;

    const fields = {};
    for (const [k, v] of Object.entries(row)) {
      if (k !== coordKey) fields[k] = String(v);
    }
    markers.push({ lat, lng, ...fields });
  }

  if (markers.length === 0) {
    return { markers: [], error: "No se encontraron filas con coordenadas válidas en la columna \"coordenadas\"." };
  }
  return { markers, error: null };
}

// ── KML PARSER (generic) ─────────────────────────────────────────
function parseKMLPlanning(rawText) {
  const markers = [];
  try {
    const text = rawText.charCodeAt(0) === 0xFEFF ? rawText.slice(1) : rawText;

    function getTag(block, tag) {
      const s = block.indexOf(`<${tag}>`), e = block.indexOf(`</${tag}>`);
      return (s !== -1 && e > s) ? block.slice(s + tag.length + 2, e).trim() : "";
    }
    function getAllData(block) {
      const fields = {};
      const sdRe = /<SimpleData\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/SimpleData>/g;
      let m;
      while ((m = sdRe.exec(block)) !== null) fields[m[1]] = m[2].trim();
      const dRe = /<Data\s+name="([^"]+)"[^>]*>[\s\S]*?<value>([\s\S]*?)<\/value>/g;
      while ((m = dRe.exec(block)) !== null) fields[m[1]] = m[2].trim();
      return fields;
    }

    let pos = 0;
    while (true) {
      const ps = text.indexOf("<Placemark>", pos);
      if (ps === -1) break;
      const pe = text.indexOf("</Placemark>", ps);
      if (pe === -1) break;
      const block = text.slice(ps, pe + 12);
      pos = pe + 12;

      if (block.includes("<LineString>")) continue;

      const cs = block.indexOf("<coordinates>"), ce = block.indexOf("</coordinates>");
      if (cs === -1 || ce === -1) continue;
      const parts = block.slice(cs + 13, ce).trim().split(",");
      if (parts.length < 2) continue;
      const lng = parseFloat(parts[0]), lat = parseFloat(parts[1]);
      if (isNaN(lat) || isNaN(lng)) continue;

      const name = getTag(block, "name") || getTag(block, "description") || "";
      const fields = getAllData(block);
      markers.push({ lat, lng, nombre: name, ...fields });
    }
  } catch (e) {
    return { markers: [], error: "Error al parsear el KML: " + e.message };
  }

  if (markers.length === 0) return { markers: [], error: "No se encontraron puntos (Placemarks) en el KML." };
  return { markers, error: null };
}

// ── POPUP HTML ────────────────────────────────────────────────────
function makePopupHtml(marker, color) {
  const skip = new Set(["lat","lng","latitude","longitude","latitud","longitud"]);
  const entries = Object.entries(marker).filter(([k]) => !skip.has(k.toLowerCase()));

  const title = marker.nombre || marker.name || marker.id || marker.pa || "";
  const rows = entries
    .filter(([k]) => !["nombre","name"].includes(k.toLowerCase()))
    .map(([k,v]) => `
      <tr>
        <td style="color:#8b95a5;padding:3px 12px 3px 0;font-size:11px;white-space:nowrap;vertical-align:top;">${k}</td>
        <td style="color:#f0f4f8;font-size:11px;word-break:break-word;">${v ?? "—"}</td>
      </tr>`)
    .join("");

  return `
    <div style="font-family:'Inter',sans-serif;min-width:180px;max-width:300px;padding:12px 14px;">
      ${title ? `<div style="font-size:13px;font-weight:600;color:${color};margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.08);">${title}</div>` : ""}
      ${rows ? `<table style="width:100%;border-collapse:collapse;">${rows}</table>` : '<div style="color:#8b95a5;font-size:12px;">Sin campos adicionales</div>'}
      <div style="font-size:10px;color:#3d4d63;margin-top:8px;font-family:monospace;">${marker.lat?.toFixed(5)}, ${marker.lng?.toFixed(5)}</div>
    </div>`;
}

// ── MAP STYLES ────────────────────────────────────────────────────
const MAP_STYLES = [
  {
    key: "dark", label: "Oscuro", preview: "#1a2035",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  },
  {
    key: "light", label: "Claro", preview: "#f5f5f0",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
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

// ── MAPA PLANNING ─────────────────────────────────────────────────
// Haversine distance in km between two lat/lng points
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function routeStats(pts) {
  let km = 0;
  for (let i = 1; i < pts.length; i++)
    km += haversineKm(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
  return { km, minAt30: Math.round(km / 30 * 60) };
}

function MapaPlanning({ layers, depots = [], barrioColors = {}, mapStyle, setMapStyle }) {
  const divRef    = useRef(null);
  const mapRef    = useRef(null);
  const tileRef          = useRef(null);
  const leafletLayersRef = useRef([]);
  const depotLayersRef   = useRef([]);
  const selPolyRef    = useRef(null);
  const selPinsRef    = useRef([]);
  const [showStylePicker, setShowStylePicker] = useState(false);
  const currentStyle = MAP_STYLES.find(s => s.key === mapStyle) ?? MAP_STYLES[0];

  const [selMode,      setSelMode]      = useState(false);
  const [selected,     setSelected]     = useState([]);  // [{lat,lng,nombre}]
  const [routeData,    setRouteData]    = useState(null); // {km, minutes, geometry}
  const [routeLoading, setRouteLoading] = useState(false);

  // Refs so Leaflet click handlers always see current values
  const selModeRef  = useRef(false);
  const selectedRef = useRef([]);
  useEffect(() => { selModeRef.current  = selMode;   }, [selMode]);
  useEffect(() => { selectedRef.current = selected;  }, [selected]);

  // Fetch road route via OSRM when selection has ≥2 points
  useEffect(() => {
    if (selected.length < 2) { setRouteData(null); return; }
    const ctrl = new AbortController();
    const coords = selected.map(p => `${p.lng},${p.lat}`).join(";");
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    setRouteLoading(true);
    fetch(url, { signal: ctrl.signal })
      .then(r => r.json())
      .then(data => {
        if (data.code === "Ok" && data.routes?.[0]) {
          const r = data.routes[0];
          setRouteData({ km: r.distance / 1000, minutes: Math.round(r.duration / 60), geometry: r.geometry });
        } else {
          setRouteData(null);
        }
        setRouteLoading(false);
      })
      .catch(e => { if (e.name !== "AbortError") { setRouteData(null); setRouteLoading(false); } });
    return () => ctrl.abort();
  }, [selected]);

  const drawLayers = useCallback(() => {
    const L = window.L;
    if (!L || !mapRef.current) return;
    const map = mapRef.current;

    leafletLayersRef.current.forEach(l => { try { map.removeLayer(l); } catch {} });
    leafletLayersRef.current = [];

    const allPoints = [];
    layers.filter(l => l.visible).forEach(layer => {
      layer.markers.forEach(m => {
        const size = 14;
        const barrio = getBarrio(m);
        const color  = barrio ? barrioColor(barrio, barrioColors) : layer.color;
        const icon   = L.divIcon({
          className: "",
          html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.8);box-shadow:0 2px 8px rgba(0,0,0,0.5);cursor:pointer;transition:transform .15s;"></div>`,
          iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
        });

        const marker = L.marker([m.lat, m.lng], { icon })
          .bindPopup(makePopupHtml(m, color), { maxWidth: 320, className: "" });

        marker.on("click", e => {
          if (!selModeRef.current) return;
          L.DomEvent.stopPropagation(e);
          marker.closePopup();
          const prev = selectedRef.current;
          const idx  = prev.findIndex(s => s.lat === m.lat && s.lng === m.lng);
          setSelected(idx >= 0
            ? prev.filter((_, i) => i !== idx)
            : [...prev, { lat: m.lat, lng: m.lng, nombre: m.nombre || m.name || getBarrio(m) || `${m.lat.toFixed(4)},${m.lng.toFixed(4)}` }]
          );
        });

        marker.addTo(map);
        leafletLayersRef.current.push(marker);
        allPoints.push([m.lat, m.lng]);
      });
    });

    // Render depots (orange house markers, above stops)
    depotLayersRef.current.forEach(l => { try { map.removeLayer(l); } catch {} });
    depotLayersRef.current = [];
    depots.forEach((d, i) => {
      const dIcon = L.divIcon({
        className: "",
        html: `<div title="${d.nombre}" style="
          width:36px;height:36px;border-radius:8px;
          background:#fb923c;border:2.5px solid rgba(255,255,255,0.95);
          box-shadow:0 3px 14px rgba(251,146,60,0.7);
          display:flex;align-items:center;justify-content:center;
          cursor:pointer;
        "><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>`,
        iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20],
      });
      const fields = Object.entries(d.fields || {}).map(([k, v]) =>
        `<tr><td style="color:#8b95a5;padding:2px 10px 2px 0;font-size:11px;">${k}</td><td style="color:#f0f4f8;font-size:11px;">${v}</td></tr>`
      ).join("");
      const popupHtml = `<div style="font-family:'Inter',sans-serif;min-width:160px;padding:10px 12px;">
        <div style="font-size:11px;font-weight:700;color:#fb923c;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Depot ${i + 1}</div>
        <div style="font-size:13px;font-weight:600;color:#f0f4f8;margin-bottom:6px;">${d.nombre}</div>
        ${fields ? `<table style="width:100%;border-collapse:collapse;">${fields}</table>` : ""}
        <div style="font-size:10px;color:#3d4d63;margin-top:6px;font-family:monospace;">${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}</div>
      </div>`;
      const dm = L.marker([d.lat, d.lng], { icon: dIcon, zIndexOffset: 500 })
        .bindPopup(popupHtml, { maxWidth: 280 });
      dm.on("click", e => {
        if (!selModeRef.current) return;
        L.DomEvent.stopPropagation(e);
        dm.closePopup();
        const prev = selectedRef.current;
        const idx  = prev.findIndex(s => s.lat === d.lat && s.lng === d.lng);
        setSelected(idx >= 0
          ? prev.filter((_, i) => i !== idx)
          : [...prev, { lat: d.lat, lng: d.lng, nombre: `🏠 ${d.nombre}` }]
        );
      });
      dm.addTo(map);
      depotLayersRef.current.push(dm);
      allPoints.push([d.lat, d.lng]);
    });

    if (allPoints.length > 0) {
      map.invalidateSize();
      map.fitBounds(allPoints, { padding: [40, 40], maxZoom: 16 });
    }
  }, [layers, depots, barrioColors]);

  // Draw / update selection polyline and numbered pins
  useEffect(() => {
    const L = window.L;
    if (!L || !mapRef.current) return;
    const map = mapRef.current;

    // Remove old
    if (selPolyRef.current) { map.removeLayer(selPolyRef.current); selPolyRef.current = null; }
    selPinsRef.current.forEach(p => { try { map.removeLayer(p); } catch {} });
    selPinsRef.current = [];

    if (selected.length < 1) return;

    // Numbered pins
    selected.forEach((pt, i) => {
      const pin = L.marker([pt.lat, pt.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="width:22px;height:22px;border-radius:50%;background:#4f8ef7;border:2px solid #fff;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.5);">${i + 1}</div>`,
          iconSize: [22, 22], iconAnchor: [11, 11],
        }),
        zIndexOffset: 1000,
      }).addTo(map);
      selPinsRef.current.push(pin);
    });

    // Polyline: real road geometry from OSRM, or straight dashed fallback
    if (selected.length > 1) {
      if (routeData?.geometry) {
        selPolyRef.current = L.geoJSON(routeData.geometry, {
          style: { color: "#4f8ef7", weight: 3.5, opacity: 0.9 },
        }).addTo(map);
      } else {
        selPolyRef.current = L.polyline(
          selected.map(p => [p.lat, p.lng]),
          { color: "#4f8ef7", weight: 2, dashArray: "6 4", opacity: 0.5 }
        ).addTo(map);
      }
    }
  }, [selected, routeData]);

  const initMap = useCallback(() => {
    if (!divRef.current || mapRef.current) return;
    const L = window.L;
    if (!L) return;
    const map = L.map(divRef.current, { zoomControl: true, attributionControl: false })
      .setView([40.416, -3.703], 6);
    const style = MAP_STYLES.find(s => s.key === mapStyle) ?? MAP_STYLES[0];
    tileRef.current = L.tileLayer(style.url).addTo(map);
    mapRef.current = map;
    drawLayers();
  }, [drawLayers, mapStyle]);

  // Swap tile layer when style changes (map already initialized)
  useEffect(() => {
    const L = window.L;
    if (!L || !mapRef.current) return;
    const style = MAP_STYLES.find(s => s.key === mapStyle) ?? MAP_STYLES[0];
    if (tileRef.current) mapRef.current.removeLayer(tileRef.current);
    tileRef.current = L.tileLayer(style.url).addTo(mapRef.current);
    tileRef.current.bringToBack();
  }, [mapStyle]);

  useEffect(() => {
    if (!document.getElementById("leaflet-css")) {
      const css = document.createElement("link");
      css.id = "leaflet-css"; css.rel = "stylesheet";
      css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(css);
    }
    if (!window.L) {
      const js = document.createElement("script");
      js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      js.onload = () => initMap();
      document.head.appendChild(js);
    } else {
      initMap();
    }
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, []);

  useEffect(() => {
    if (window.L && mapRef.current) drawLayers();
    else {
      const t = setTimeout(() => {
        if (window.L && !mapRef.current) initMap();
        else if (window.L) drawLayers();
      }, 800);
      return () => clearTimeout(t);
    }
  }, [layers, drawLayers]);

  useEffect(() => {
    if (!divRef.current) return;
    const ro = new ResizeObserver(() => {
      if (mapRef.current && divRef.current?.offsetWidth > 0) mapRef.current.invalidateSize();
    });
    ro.observe(divRef.current);
    return () => ro.disconnect();
  }, []);

  // routeData from OSRM; haversine only as fallback label
  const haversineStats = selected.length > 1 ? routeStats(selected) : null;

  return (
    <div style={{ flex: 1, position: "relative", height: "100%" }}>
      {/* Map container */}
      <div ref={divRef} className="planning-map" style={{ width: "100%", height: "100%", background: "#1c2333" }} />

      {/* Selection mode toggle */}
      <button
        onClick={() => { setSelMode(m => !m); if (selMode) setSelected([]); }}
        title={selMode ? "Salir de selección" : "Medir distancia entre puntos"}
        style={{
          position: "absolute", top: 10, right: 10, zIndex: 900,
          padding: "7px 13px", borderRadius: 8, fontFamily: font, fontSize: 12, fontWeight: 600,
          background: selMode ? C.blue : C.card,
          color: selMode ? "#fff" : C.muted,
          border: `1px solid ${selMode ? C.blue : C.border}`,
          cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
          boxShadow: "0 2px 8px rgba(0,0,0,.4)", transition: "all .15s",
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 3l7.5 7.5M21 3l-7.5 7.5M3 21l7.5-7.5M21 21l-7.5-7.5"/>
          <circle cx="12" cy="12" r="2"/>
        </svg>
        {selMode ? "Salir de medición" : "Medir distancia"}
      </button>

      {/* Map style picker */}
      <div style={{ position: "absolute", top: 50, right: 10, zIndex: 900 }}>
        <button
          onClick={() => setShowStylePicker(s => !s)}
          title="Cambiar estilo del mapa"
          style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "6px 12px", borderRadius: 8, fontFamily: font, fontSize: 12, fontWeight: 600,
            background: showStylePicker ? C.surface2 : C.card,
            color: C.muted, border: `1px solid ${C.border}`,
            cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.4)", transition: "all .15s",
          }}
        >
          <div style={{ width: 10, height: 10, borderRadius: 2, background: currentStyle.preview, border: "1px solid rgba(255,255,255,0.2)", flexShrink: 0 }} />
          {currentStyle.label}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ opacity: 0.5 }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        {showStylePicker && (
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0,
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 9, overflow: "hidden",
            boxShadow: "0 6px 24px rgba(0,0,0,.5)", minWidth: 150,
          }}>
            {MAP_STYLES.map(s => (
              <button
                key={s.key}
                onClick={() => {
                  setMapStyle(s.key); setShowStylePicker(false);
                  if (projectId) setDoc(doc(db, "planning_settings", projectId), { mapStyle: s.key, updatedAt: serverTimestamp() }, { merge: true });
                }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 14px", background: s.key === mapStyle ? C.surface2 : "none",
                  border: "none", borderBottom: `1px solid ${C.border}`,
                  color: s.key === mapStyle ? C.text : C.muted,
                  cursor: "pointer", fontFamily: font, fontSize: 12, fontWeight: s.key === mapStyle ? 600 : 400,
                  textAlign: "left", transition: "background .1s",
                }}
                onMouseEnter={e => { if (s.key !== mapStyle) e.currentTarget.style.background = C.surface2; }}
                onMouseLeave={e => { if (s.key !== mapStyle) e.currentTarget.style.background = "none"; }}
              >
                <div style={{ width: 14, height: 14, borderRadius: 3, background: s.preview, border: `1px solid rgba(255,255,255,0.15)`, flexShrink: 0 }} />
                {s.label}
                {s.key === mapStyle && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2.5" style={{ marginLeft: "auto" }}>
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selection instructions */}
      {selMode && selected.length === 0 && (
        <div style={{
          position: "absolute", bottom: 30, left: "50%", transform: "translateX(-50%)",
          zIndex: 900, background: "rgba(15,17,23,0.88)", border: `1px solid ${C.border}`,
          borderRadius: 8, padding: "8px 16px", fontSize: 12, color: C.muted,
          backdropFilter: "blur(4px)", whiteSpace: "nowrap",
        }}>
          Haz clic en los puntos del mapa para seleccionarlos en orden
        </div>
      )}

      {/* Results panel */}
      {selMode && selected.length > 0 && (
        <div style={{
          position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 900, background: "rgba(22,27,39,0.95)", border: `1px solid ${C.border}`,
          borderRadius: 10, padding: "12px 16px", minWidth: 280,
          boxShadow: "0 4px 24px rgba(0,0,0,.5)", backdropFilter: "blur(6px)",
        }}>
          {/* Selected points list */}
          <div style={{ marginBottom: 10, maxHeight: 120, overflowY: "auto" }}>
            {selected.map((pt, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
                <div style={{
                  width: 18, height: 18, borderRadius: "50%", background: C.blue,
                  color: "#fff", fontSize: 10, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>{i + 1}</div>
                <span style={{ fontSize: 11, color: C.muted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {pt.nombre}
                </span>
              </div>
            ))}
          </div>

          {/* Stats — road route from OSRM */}
          {selected.length > 1 && (
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
              {routeLoading ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.muted, fontSize: 12 }}>
                  <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(79,142,247,0.2)", borderTopColor: C.blue, borderRadius: "50%", animation: "planning-spin .6s linear infinite", flexShrink: 0 }} />
                  Calculando ruta por carretera…
                </div>
              ) : routeData ? (
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 1 }}>Por carretera</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{routeData.km.toFixed(2)} <span style={{ fontSize: 12, fontWeight: 400, color: C.muted }}>km</span></div>
                  </div>
                  <div style={{ width: 1, height: 36, background: C.border }} />
                  <div>
                    <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 1 }}>Tiempo estimado</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>
                      {routeData.minutes >= 60
                        ? `${Math.floor(routeData.minutes / 60)}h ${routeData.minutes % 60}min`
                        : `${routeData.minutes} min`}
                    </div>
                  </div>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => setSelected([])} style={{
                    background: "none", border: `1px solid ${C.border}`, borderRadius: 6,
                    color: C.dim, cursor: "pointer", fontSize: 11, padding: "4px 10px",
                    fontFamily: font, transition: "all .12s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
                  >Limpiar</button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 1 }}>Línea recta (aprox.)</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{haversineStats.km.toFixed(2)} <span style={{ fontSize: 12, fontWeight: 400, color: C.muted }}>km</span></div>
                  </div>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => setSelected([])} style={{
                    background: "none", border: `1px solid ${C.border}`, borderRadius: 6,
                    color: C.dim, cursor: "pointer", fontSize: 11, padding: "4px 10px",
                    fontFamily: font, transition: "all .12s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
                  >Limpiar</button>
                </div>
              )}
            </div>
          )}

          {selected.length === 1 && (
            <div style={{ fontSize: 11, color: C.dim, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
              Selecciona otro punto para calcular la distancia
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── SIDEBAR ───────────────────────────────────────────────────────
function DepotIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}

function Sidebar({ layers, setLayers, onUpload, uploading, depots, setDepots, onDepotImport, depotUploading, barrioColors, setBarrioColors, searchQuery, setSearchQuery, totalFiltered, totalAll }) {
  const fileRef      = useRef(null);
  const depotFileRef = useRef(null);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [manualName, setManualName] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [openUpload,  setOpenUpload]  = useState(true);
  const [openLayers,  setOpenLayers]  = useState(true);
  const [openBarrios, setOpenBarrios] = useState(true);
  const [openDepots,  setOpenDepots]  = useState(true);

  const Chevron = ({ open }) => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{ transition: "transform .2s", transform: open ? "rotate(0deg)" : "rotate(-90deg)", flexShrink: 0 }}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
  const SecBtn = ({ label, badge, open, onToggle, extra }) => (
    <button onClick={onToggle} style={{
      width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
      background: "none", border: "none", cursor: "pointer", padding: "8px 12px 6px",
      color: C.dim, fontFamily: font,
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Chevron open={open} />
        <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>
          {label}{badge != null ? ` (${badge})` : ""}
        </span>
      </span>
      {extra}
    </button>
  );

  function removeLayer(id) {
    if (projectId) deleteDoc(doc(db, "planning_layers", `${projectId}_${id}`));
    else setLayers(prev => prev.filter(l => l.id !== id));
  }
  function toggleLayer(id) {
    const layer = layers.find(l => l.id === id);
    if (!layer) return;
    if (projectId) {
      updateDoc(doc(db, "planning_layers", `${projectId}_${id}`), { visible: !layer.visible });
    } else {
      setLayers(prev => prev.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
    }
  }

  const totalMarkers = layers.reduce((s, l) => s + l.markers.length, 0);

  return (
    <div style={{
      width: 280, flexShrink: 0, background: C.card,
      borderRight: `1px solid ${C.border}`,
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Search bar */}
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ position: "relative" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={searchQuery ? C.blue : C.dim} strokeWidth="2"
            style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", transition: "stroke .15s" }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            placeholder="Buscar por palabra clave…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: "100%", boxSizing: "border-box",
              background: searchQuery ? `${C.blue}14` : C.surface2,
              border: `1px solid ${searchQuery ? C.blue + "55" : C.border}`,
              color: C.text, borderRadius: 7, padding: "7px 28px 7px 28px",
              fontSize: 12, fontFamily: font, outline: "none", transition: "all .15s",
            }}
            onFocus={e => { e.currentTarget.style.borderColor = C.blue + "88"; }}
            onBlur={e => { e.currentTarget.style.borderColor = searchQuery ? C.blue + "55" : C.border; }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              style={{
                position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", color: C.dim, cursor: "pointer",
                fontSize: 15, lineHeight: 1, padding: 2, transition: "color .12s",
              }}
              onMouseEnter={e => e.currentTarget.style.color = C.text}
              onMouseLeave={e => e.currentTarget.style.color = C.dim}
            >×</button>
          )}
        </div>
        {searchQuery && (
          <div style={{ fontSize: 10, color: totalFiltered > 0 ? C.blue : C.red, marginTop: 5, fontWeight: 500 }}>
            {totalFiltered > 0
              ? `${totalFiltered} de ${totalAll} punto${totalAll !== 1 ? "s" : ""}`
              : "Sin resultados"}
          </div>
        )}
      </div>

      {/* Upload area */}
      <div style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <SecBtn label="Cargar capa" open={openUpload} onToggle={() => setOpenUpload(o => !o)} />
        {openUpload && (
          <div style={{ padding: "4px 16px 14px" }}>
            <input ref={fileRef} type="file" accept=".csv,.kml,.xlsx" multiple style={{ display: "none" }}
              onChange={e => onUpload(Array.from(e.target.files))} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{
              width: "100%", padding: "9px 14px",
              background: uploading ? C.surface2 : C.blueDim, border: `1px solid ${C.blue}44`,
              color: C.blueText, borderRadius: 8, fontSize: 12, fontWeight: 600,
              cursor: uploading ? "wait" : "pointer", fontFamily: font, transition: "all .15s",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
              onMouseEnter={e => { if (!uploading) e.currentTarget.style.background = "#1a3570"; }}
              onMouseLeave={e => { if (!uploading) e.currentTarget.style.background = C.blueDim; }}
            >
              {uploading
                ? <><span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(163,196,252,0.2)", borderTopColor: C.blueText, borderRadius: "50%", animation: "planning-spin .6s linear infinite" }} /> Procesando…</>
                : "Subir CSV / KML / Excel"}
            </button>
            <div style={{ fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.7 }}>
              <div>CSV: columnas <code style={{ color: C.muted, fontFamily: mono, fontSize: 10 }}>lat</code> y <code style={{ color: C.muted, fontFamily: mono, fontSize: 10 }}>lon</code></div>
              <div>Excel: columna <code style={{ color: C.muted, fontFamily: mono, fontSize: 10 }}>coordenadas</code> (lat,lng)</div>
            </div>
          </div>
        )}
      </div>

      {/* Layers section */}
      <div style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <SecBtn label="Capas" badge={layers.length || null}
          open={openLayers} onToggle={() => setOpenLayers(o => !o)}
          extra={layers.length > 0 && (
            <span style={{ fontSize: 10, color: C.dim }}>
              {totalMarkers} pts
            </span>
          )} />
        {openLayers && (
          <div style={{ overflowY: "auto", padding: "0 8px 8px" }}>
        {layers.length === 0 ? (
          <div style={{ padding: "40px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.7 }}>
              Sube un archivo para visualizar puntos en el mapa
            </div>
          </div>
        ) : (
          layers.map(layer => (
            <div key={layer.id} style={{
              background: C.surface2, border: `1px solid ${C.border}`,
              borderLeft: `3px solid ${layer.visible ? layer.color : C.dim}`,
              borderRadius: 8, padding: "9px 12px", marginBottom: 5,
              opacity: layer.visible ? 1 : 0.5,
              animation: "planning-fadein .2s ease both",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <button
                  onClick={() => toggleLayer(layer.id)}
                  title={layer.visible ? "Ocultar" : "Mostrar"}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    padding: 0, lineHeight: 1, flexShrink: 0,
                    width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={layer.visible ? C.muted : C.dim} strokeWidth="2">
                    {layer.visible
                      ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                      : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
                    }
                  </svg>
                </button>

                <div style={{ width: 8, height: 8, borderRadius: "50%", background: layer.color, flexShrink: 0 }} />

                <div style={{
                  flex: 1, fontSize: 12, fontWeight: 500, color: C.text,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {layer.name}
                </div>

                <button
                  onClick={() => removeLayer(layer.id)}
                  title="Eliminar capa"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: C.dim, fontSize: 14, padding: 0, lineHeight: 1,
                    transition: "color .15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = C.red}
                  onMouseLeave={e => e.currentTarget.style.color = C.dim}
                >
                  ×
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 24 }}>
                <span style={{
                  fontSize: 9, fontFamily: mono, color: C.dim,
                  textTransform: "uppercase", letterSpacing: .5,
                }}>
                  {layer.type}
                </span>
                <span style={{ fontSize: 11, color: C.dim }}>
                  {layer.markers.length} punto{layer.markers.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          ))
        )}
          </div>
        )}
      </div>

      {/* Barrios section */}
      {(() => {
        const barrios = [...new Set(
          layers.filter(l => l.visible)
            .flatMap(l => l.markers.map(m => getBarrio(m)))
            .filter(Boolean)
        )].sort();
        if (barrios.length === 0) return null;
        const hasOverrides = barrios.some(b => barrioColors[b]);
        return (
          <div style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
            <SecBtn label="Barrios" badge={barrios.length} open={openBarrios}
              onToggle={() => setOpenBarrios(o => !o)}
              extra={hasOverrides && (
                <button
                  onClick={() => { setBarrioColors({}); saveBarrioColors({}); }}
                  title="Resetear colores"
                  style={{
                    background: "none", border: "none", fontSize: 10, color: C.dim,
                    cursor: "pointer", padding: 0, fontFamily: font,
                    transition: "color .12s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = C.red}
                  onMouseLeave={e => e.currentTarget.style.color = C.dim}
                >resetear</button>
              )} />
            {openBarrios && (
            <div style={{ maxHeight: 220, overflowY: "auto", padding: "2px 12px 8px" }}>
              {barrios.map(b => {
                const color = barrioColor(b, barrioColors);
                const isCustom = !!barrioColors[b];
                return (
                  <div key={b} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                    <label
                      title={isCustom ? `Color personalizado: ${color}\nHaz clic para cambiar` : "Haz clic para personalizar el color"}
                      style={{ position: "relative", flexShrink: 0, cursor: "pointer" }}
                    >
                      <div style={{
                        width: 16, height: 16, borderRadius: 3,
                        background: color,
                        border: isCustom ? `2px solid rgba(255,255,255,0.6)` : `1px solid rgba(255,255,255,0.2)`,
                        boxShadow: isCustom ? `0 0 0 1px ${color}` : "none",
                        transition: "transform .12s",
                      }}
                        onMouseEnter={e => e.currentTarget.style.transform = "scale(1.2)"}
                        onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                      />
                      <input
                        type="color"
                        value={color}
                        onChange={e => {
                          const nc = { ...barrioColors, [b]: e.target.value };
                          setBarrioColors(nc); saveBarrioColors(nc);
                        }}
                        style={{ position: "absolute", opacity: 0, width: 0, height: 0, pointerEvents: "none" }}
                        tabIndex={-1}
                      />
                    </label>
                    <span style={{
                      fontSize: 11, color: isCustom ? C.text : C.muted,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      flex: 1,
                    }}>{b}</span>
                    {isCustom && (
                      <button
                        onClick={() => { const nc = { ...barrioColors }; delete nc[b]; setBarrioColors(nc); saveBarrioColors(nc); }}
                        title="Restaurar color original"
                        style={{
                          background: "none", border: "none", color: C.dim, cursor: "pointer",
                          fontSize: 13, padding: 0, lineHeight: 1, flexShrink: 0, transition: "color .12s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = C.red}
                        onMouseLeave={e => e.currentTarget.style.color = C.dim}
                      >×</button>
                    )}
                  </div>
                );
              })}
            </div>
            )}
          </div>
        );
      })()}

      {/* Limpiar todas las capas */}
      {layers.length > 0 && (
        <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
          <button
            onClick={() => {
              if (projectId) {
                for (const l of layers) deleteDoc(doc(db, "planning_layers", `${projectId}_${l.id}`));
              } else {
                setLayers([]);
              }
            }}
            style={{
              width: "100%", padding: "8px", background: "none",
              border: `1px solid ${C.border}`, color: C.dim,
              borderRadius: 7, fontSize: 11, cursor: "pointer",
              fontFamily: font, transition: "all .15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
          >
            Limpiar todas las capas
          </button>
        </div>
      )}

      {/* ── DEPOTS SECTION ────────────────────────────────────────── */}
      <div style={{ flexShrink: 0 }}>
        <SecBtn label="Depots" badge={depots.length || null} open={openDepots}
          onToggle={() => setOpenDepots(o => !o)}
          extra={
            <button
              onClick={() => setShowManual(s => !s)}
              title="Añadir depot manualmente"
              style={{
                background: "none", border: `1px solid ${C.border}`, borderRadius: 5,
                color: C.dim, cursor: "pointer", fontSize: 15, lineHeight: 1,
                width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all .12s",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = "#fb923c"; e.currentTarget.style.borderColor = "#fb923c55"; }}
              onMouseLeave={e => { e.currentTarget.style.color = C.dim; e.currentTarget.style.borderColor = C.border; }}
            >+</button>
          } />
        {openDepots && (
        <>
        {/* Import button */}
        <div style={{ padding: "0 12px 8px" }}>
          <input
            ref={depotFileRef}
            type="file"
            accept=".csv,.kml,.xlsx"
            multiple
            style={{ display: "none" }}
            onChange={e => { onDepotImport(Array.from(e.target.files)); e.target.value = ""; }}
          />
          <button
            onClick={() => depotFileRef.current?.click()}
            disabled={depotUploading}
            style={{
              width: "100%", padding: "7px 10px",
              background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.3)",
              color: "#fb923c", borderRadius: 7, fontSize: 11, fontWeight: 600,
              cursor: depotUploading ? "wait" : "pointer", fontFamily: font,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              transition: "all .15s",
            }}
            onMouseEnter={e => { if (!depotUploading) e.currentTarget.style.background = "rgba(251,146,60,0.18)"; }}
            onMouseLeave={e => { if (!depotUploading) e.currentTarget.style.background = "rgba(251,146,60,0.1)"; }}
          >
            {depotUploading
              ? <><span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(251,146,60,0.2)", borderTopColor: "#fb923c", borderRadius: "50%", animation: "planning-spin .6s linear infinite" }} /> Procesando…</>
              : <><DepotIcon size={11} /> Importar CSV / KML / Excel</>
            }
          </button>
        </div>

        {/* Manual add form */}
        {showManual && (
          <div style={{ padding: "0 12px 10px", borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <input
                placeholder="Lat"
                value={manualLat}
                onChange={e => setManualLat(e.target.value)}
                style={{
                  flex: 1, background: C.surface2, border: `1px solid ${C.border}`,
                  color: C.text, borderRadius: 5, padding: "5px 8px", fontSize: 11,
                  fontFamily: mono, outline: "none",
                }}
              />
              <input
                placeholder="Lng"
                value={manualLng}
                onChange={e => setManualLng(e.target.value)}
                style={{
                  flex: 1, background: C.surface2, border: `1px solid ${C.border}`,
                  color: C.text, borderRadius: 5, padding: "5px 8px", fontSize: 11,
                  fontFamily: mono, outline: "none",
                }}
              />
            </div>
            <input
              placeholder="Nombre (opcional)"
              value={manualName}
              onChange={e => setManualName(e.target.value)}
              style={{
                width: "100%", background: C.surface2, border: `1px solid ${C.border}`,
                color: C.text, borderRadius: 5, padding: "5px 8px", fontSize: 11,
                fontFamily: font, outline: "none", marginBottom: 6, boxSizing: "border-box",
              }}
            />
            <button
              onClick={() => {
                const lat = parseFloat(manualLat), lng = parseFloat(manualLng);
                if (isNaN(lat) || isNaN(lng)) return;
                const newDepot = { id: Date.now() + Math.random(), lat, lng, nombre: manualName.trim() || `Depot ${depots.length + 1}`, fields: {} };
                if (projectId) {
                  const merged = [...depots, newDepot];
                  setDoc(doc(db, "planning_depots", projectId), { depots: merged, projectId, orgId, updatedAt: serverTimestamp() });
                } else {
                  setDepots(prev => [...prev, newDepot]);
                }
                setManualLat(""); setManualLng(""); setManualName(""); setShowManual(false);
              }}
              style={{
                width: "100%", padding: "6px", background: "rgba(251,146,60,0.12)",
                border: "1px solid rgba(251,146,60,0.35)", color: "#fb923c",
                borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: "pointer",
                fontFamily: font,
              }}
            >Añadir depot</button>
          </div>
        )}

        {/* Depot list */}
        {depots.length > 0 && (
          <div style={{ maxHeight: 160, overflowY: "auto", padding: "0 8px 8px" }}>
            {depots.map((d, i) => (
              <div key={d.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                background: C.surface2, border: "1px solid rgba(251,146,60,0.2)",
                borderLeft: "3px solid #fb923c",
                borderRadius: 7, padding: "7px 10px", marginBottom: 4,
              }}>
                <span style={{ fontSize: 9, color: "#fb923c", fontWeight: 700, fontFamily: mono, width: 14, flexShrink: 0 }}>{i + 1}</span>
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.nombre}</div>
                  <div style={{ fontSize: 10, color: C.dim, fontFamily: mono }}>{d.lat.toFixed(5)}, {d.lng.toFixed(5)}</div>
                </div>
                <button
                  onClick={() => {
                    if (projectId) {
                      const filtered = depots.filter(x => x.id !== d.id);
                      setDoc(doc(db, "planning_depots", projectId), { depots: filtered, projectId, orgId, updatedAt: serverTimestamp() });
                    } else {
                      setDepots(prev => prev.filter(x => x.id !== d.id));
                    }
                  }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: C.dim, fontSize: 14, padding: 0, lineHeight: 1, transition: "color .12s", flexShrink: 0 }}
                  onMouseEnter={e => e.currentTarget.style.color = C.red}
                  onMouseLeave={e => e.currentTarget.style.color = C.dim}
                >×</button>
              </div>
            ))}
          </div>
        )}

        {depots.length === 0 && !showManual && (
          <div style={{ padding: "4px 16px 12px", fontSize: 10, color: C.dim, lineHeight: 1.6 }}>
            Importa o añade las coordenadas de los depots (base de salida de vehículos)
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}

// ── TIME HELPERS ─────────────────────────────────────────────────
function timeToMin(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return isNaN(h) ? null : h * 60 + (m || 0);
}

// ── TIMETABLE ROW ─────────────────────────────────────────────────
function TimetableRow({ entry, onUpdate, onDelete }) {
  const [localStart, setLocalStart] = useState(entry.horaInicio || "");
  const [localDur,   setLocalDur]   = useState(entry.duracion != null ? String(entry.duracion) : "");

  useEffect(() => { setLocalStart(entry.horaInicio || ""); },                          [entry.horaInicio]);
  useEffect(() => { setLocalDur(entry.duracion != null ? String(entry.duracion) : ""); }, [entry.duracion]);

  const camposRows = Object.entries(entry.campos || {})
    .filter(([k, v]) => k.toLowerCase() !== "barrio" && v !== "" && v != null);

  return (
    <tr style={{ borderBottom: `1px solid ${C.border}`, animation: "planning-fadein .15s ease both" }}>
      {/* Punto */}
      <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
        <div style={{ fontWeight: 500, fontSize: 12, color: C.text, marginBottom: 2 }}>
          {entry.nombre
            || Object.entries(entry.campos || {}).find(([k]) => ["pa","idsap","id_sap","codigopoint","codigo"].includes(k.toLowerCase()))?.[1]
            || Object.entries(entry.campos || {}).find(([k]) => k.toLowerCase() === "calle")?.[1]
            || `${entry.lat?.toFixed(4)}, ${entry.lng?.toFixed(4)}`}
        </div>
        <div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>
          {(() => {
            const calle = Object.entries(entry.campos || {}).find(([k]) => k.toLowerCase() === "calle")?.[1];
            const num   = Object.entries(entry.campos || {}).find(([k]) => ["num","num.","número","numero"].includes(k.toLowerCase()))?.[1];
            if (calle) return num ? `${calle} ${num}` : calle;
            return <span style={{ fontFamily: mono }}>{entry.lat?.toFixed(5)}, {entry.lng?.toFixed(5)}</span>;
          })()}
        </div>
        {camposRows.slice(0, 3).map(([k, v]) => (
          <div key={k} style={{ fontSize: 10, color: C.dim, lineHeight: 1.5 }}>
            <span style={{ color: C.muted }}>{k}:</span> {v}
          </div>
        ))}
        {camposRows.length > 3 && (
          <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>+{camposRows.length - 3} más</div>
        )}
      </td>

      {/* Hora inicio */}
      <td style={{ padding: "10px 8px", verticalAlign: "middle", width: 116 }}>
        <input
          type="time"
          value={localStart}
          onChange={e => setLocalStart(e.target.value)}
          onBlur={e => onUpdate({ horaInicio: e.target.value || null })}
          style={{
            width: "100%", background: "rgba(255,255,255,0.04)",
            border: `1px solid ${localStart ? C.blue + "55" : C.border}`,
            color: localStart ? C.blueText : C.muted,
            padding: "6px 8px", borderRadius: 6, fontSize: 12,
            fontFamily: mono, outline: "none", cursor: "pointer",
          }}
        />
      </td>

      {/* Duración */}
      <td style={{ padding: "10px 8px", verticalAlign: "middle", width: 106 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <input
            type="number" min="1" max="1440"
            value={localDur}
            onChange={e => setLocalDur(e.target.value)}
            onBlur={e => {
              const n = parseInt(e.target.value);
              onUpdate({ duracion: isNaN(n) ? null : Math.max(1, n) });
            }}
            placeholder="—"
            style={{
              width: 56, background: "rgba(255,255,255,0.04)",
              border: `1px solid ${localDur ? C.amber + "55" : C.border}`,
              color: localDur ? C.amber : C.muted,
              padding: "6px 8px", borderRadius: 6, fontSize: 12,
              fontFamily: mono, outline: "none", textAlign: "right",
            }}
          />
          <span style={{ fontSize: 10, color: C.dim, flexShrink: 0 }}>min</span>
        </div>
      </td>

      {/* Acciones */}
      <td style={{ padding: "10px 12px 10px 4px", verticalAlign: "middle", width: 36 }}>
        <button onClick={onDelete} title="Eliminar" style={{
          width: 26, height: 26, borderRadius: 6,
          background: "none", border: `1px solid ${C.border}`,
          color: C.dim, cursor: "pointer", fontSize: 14,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all .15s", fontFamily: font,
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
        >×</button>
      </td>
    </tr>
  );
}

// ── TIMETABLE TAB ─────────────────────────────────────────────────
function TabTimetable({ layers, projectId: ttProjectId }) {
  const [entries,      setEntries]     = useState([]);
  const [loading,      setLoading]     = useState(true);
  const [barrioFiltro, setBarrioFiltro] = useState(null);

  const timetableCol = ttProjectId
    ? collection(db, "scheduling_projects", ttProjectId, "timetable")
    : collection(db, "planning_timetable");

  // Real-time listener
  useEffect(() => {
    const unsub = onSnapshot(
      timetableCol,
      snap => { setEntries(snap.docs.map(d => ({ _id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false)
    );
    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttProjectId]);

  // Sync newly uploaded layers → Firebase (merge preserves horaInicio/duracion)
  useEffect(() => {
    const allMarkers = layers.flatMap(l => l.markers.map(m => ({ ...m, layerColor: l.color })));
    if (allMarkers.length === 0) return;
    allMarkers.forEach(m => {
      const { lat, lng, layerColor, nombre: _n, name: _nm, ...campos } = m;
      const nombre  = m.nombre || m.name || m.id || m.pa
        || Object.entries(campos).find(([k]) => ["pa","idsap","id_sap","codigopoint","codigo"].includes(k.toLowerCase()))?.[1]
        || Object.entries(campos).find(([k]) => k.toLowerCase() === "calle")?.[1]
        || "";
      const barrio  = Object.entries(campos).find(([k]) => k.toLowerCase() === "barrio")?.[1] || "";
      const puntoKey = `${lat.toFixed(5)}_${lng.toFixed(5)}`;
      setDoc(
        doc(timetableCol, puntoKey),
        { puntoKey, lat, lng, campos, nombre, barrio, layerColor, updatedAt: serverTimestamp() },
        { merge: true }
      );
    });
  }, [layers]);

  async function updateEntry(id, changes) {
    await updateDoc(doc(timetableCol, id), { ...changes, updatedAt: serverTimestamp() });
  }
  async function deleteEntry(id) {
    await deleteDoc(doc(timetableCol, id));
  }

  // Unique sorted barrios
  const barrios = [...new Set(entries.map(e => e.barrio || "Sin barrio"))].sort();

  // Sort within a group: scheduled by time first, then unscheduled
  const sortFn = (a, b) => {
    if (!a.horaInicio && !b.horaInicio) return 0;
    if (!a.horaInicio) return 1;
    if (!b.horaInicio) return -1;
    return a.horaInicio.localeCompare(b.horaInicio);
  };

  // Group all entries by barrio
  const grouped = Object.fromEntries(
    barrios.map(b => [b, entries.filter(e => (e.barrio || "Sin barrio") === b).sort(sortFn)])
  );

  // Which barrios to render (after filter)
  const renderBarrios = barrioFiltro ? [barrioFiltro] : barrios;

  const withTime = entries.filter(e => e.horaInicio);

  function exportToExcel() {
    const source = barrioFiltro
      ? entries.filter(e => (e.barrio || "Sin barrio") === barrioFiltro)
      : [...entries];

    const sorted = source.sort((a, b) => {
      const ba = a.barrio || "Sin barrio", bb = b.barrio || "Sin barrio";
      if (ba !== bb) return ba.localeCompare(bb);
      return sortFn(a, b);
    });

    const campoKeys = [...new Set(
      sorted.flatMap(e => Object.keys(e.campos || {}).filter(k => k.toLowerCase() !== "barrio"))
    )];

    const rows = sorted.map(e => {
      const row = {
        "Nombre":         e.nombre || "",
        "Barrio":         e.barrio || "",
        "Coordenadas":    `${e.lat?.toFixed(5)},${e.lng?.toFixed(5)}`,
        "Hora inicio":    e.horaInicio || "",
        "Duración (min)": e.duracion ?? "",
      };
      campoKeys.forEach(k => { row[k] = e.campos?.[k] ?? ""; });
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(rows);

    const colWidths = Object.keys(rows[0] || {}).map(k => ({
      wch: Math.max(k.length, ...rows.map(r => String(r[k] ?? "").length), 8),
    }));
    ws["!cols"] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Timetable");
    XLSX.writeFile(wb, barrioFiltro ? `timetable_${barrioFiltro.replace(/\s+/g, "_")}.xlsx` : "timetable.xlsx");
  }

  const thS = {
    padding: "8px 14px", fontSize: 10, color: C.dim, fontWeight: 600,
    letterSpacing: 1, textTransform: "uppercase",
    borderBottom: `1px solid ${C.border}`, textAlign: "left",
    background: C.card, position: "sticky", top: 0, zIndex: 5,
  };

  if (loading) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ color: C.dim, fontSize: 13 }}>Cargando…</span>
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: font }}>

      {/* Stats bar */}
      <div style={{
        padding: "10px 20px", borderBottom: `1px solid ${C.border}`,
        background: C.card, flexShrink: 0,
        display: "flex", alignItems: "center", gap: 28,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{entries.length}</span>
          <span style={{ fontSize: 11, color: C.muted }}>puntos</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{withTime.length}</span>
          <span style={{ fontSize: 11, color: C.muted }}>programados</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{entries.length - withTime.length}</span>
          <span style={{ fontSize: 11, color: C.muted }}>sin hora</span>
        </div>
        {barrios.length > 0 && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{barrios.length}</span>
            <span style={{ fontSize: 11, color: C.muted }}>barrios</span>
          </div>
        )}
        {entries.length === 0 && (
          <span style={{ fontSize: 11, color: C.dim }}>
            Ve a Mapa y sube un Excel para añadir puntos
          </span>
        )}

        {entries.length > 0 && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              onClick={exportToExcel}
              title={barrioFiltro ? `Exportar barrio "${barrioFiltro}"` : "Exportar todo el timetable"}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 7, cursor: "pointer",
                background: "rgba(52,211,153,0.08)", border: `1px solid rgba(52,211,153,0.25)`,
                color: C.green, fontSize: 12, fontWeight: 500,
                fontFamily: font, transition: "all .15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(52,211,153,0.14)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(52,211,153,0.08)"; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Excel
            </button>
            <a href="/scheduling" style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 12px", borderRadius: 7, cursor: "pointer",
              background: C.blueDim, border: `1px solid ${C.blue}44`,
              color: C.blueText, fontSize: 12, fontWeight: 500,
              fontFamily: font, transition: "all .15s", textDecoration: "none",
            }}
              onMouseEnter={e => { e.currentTarget.style.background = "#1a3570"; }}
              onMouseLeave={e => { e.currentTarget.style.background = C.blueDim; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              Scheduling
            </a>
          </div>
        )}
      </div>

      {/* Body: sidebar + table */}
      {entries.length === 0 ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <div style={{ fontSize: 13, color: C.muted }}>No hay puntos en el timetable</div>
          <div style={{ fontSize: 11, color: C.dim }}>Sube un Excel con columna "coordenadas" en la pestaña Mapa</div>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

          {/* Barrio sidebar */}
          {barrios.length > 0 && (
            <div style={{
              width: 192, flexShrink: 0,
              borderRight: `1px solid ${C.border}`,
              background: C.card,
              display: "flex", flexDirection: "column",
              overflowY: "auto",
            }}>
              <div style={{
                padding: "10px 14px 6px",
                fontSize: 9, color: C.dim, letterSpacing: 1.5,
                textTransform: "uppercase", fontWeight: 600, flexShrink: 0,
              }}>
                Barrios
              </div>

              {/* "Todos" item */}
              <button onClick={() => setBarrioFiltro(null)} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "7px 14px",
                background: barrioFiltro === null ? C.blueDim : "none",
                border: "none", borderLeft: `2px solid ${barrioFiltro === null ? C.blue : "transparent"}`,
                color: barrioFiltro === null ? C.blueText : C.muted,
                cursor: "pointer", fontFamily: font, fontSize: 12, fontWeight: 500,
                textAlign: "left", width: "100%", transition: "all .12s",
              }}
                onMouseEnter={e => { if (barrioFiltro !== null) e.currentTarget.style.background = C.surface2; }}
                onMouseLeave={e => { if (barrioFiltro !== null) e.currentTarget.style.background = "none"; }}
              >
                <span>Todos</span>
                <span style={{
                  fontSize: 10, fontWeight: 600, fontFamily: mono,
                  background: barrioFiltro === null ? "rgba(79,142,247,0.15)" : C.surface2,
                  color: barrioFiltro === null ? C.blueText : C.dim,
                  padding: "1px 6px", borderRadius: 4,
                }}>
                  {entries.length}
                </span>
              </button>

              <div style={{ height: 1, background: C.border, margin: "3px 14px" }} />

              {barrios.map(b => {
                const active = barrioFiltro === b;
                const count  = grouped[b]?.length ?? 0;
                const prog   = grouped[b]?.filter(e => e.horaInicio).length ?? 0;
                return (
                  <button key={b} onClick={() => setBarrioFiltro(active ? null : b)} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "7px 14px",
                    background: active ? C.blueDim : "none",
                    border: "none", borderLeft: `2px solid ${active ? C.blue : "transparent"}`,
                    color: active ? C.blueText : C.muted,
                    cursor: "pointer", fontFamily: font, fontSize: 12, fontWeight: active ? 500 : 400,
                    textAlign: "left", width: "100%", transition: "all .12s",
                  }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = C.surface2; }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = "none"; }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 6 }}>
                      {b}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 600, fontFamily: mono, flexShrink: 0,
                      background: active ? "rgba(79,142,247,0.15)" : C.surface2,
                      color: active ? C.blueText : C.dim,
                      padding: "1px 6px", borderRadius: 4,
                    }}>
                      {prog}/{count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Table */}
          <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thS}>Punto</th>
                  <th style={{ ...thS, width: 116 }}>Hora inicio</th>
                  <th style={{ ...thS, width: 106 }}>Duración</th>
                  <th style={{ ...thS, width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {renderBarrios.map(barrio => (
                  <Fragment key={barrio}>
                    {barrioFiltro === null && (
                      <tr>
                        <td colSpan={4} style={{
                          padding: "8px 14px 7px",
                          background: C.surface2,
                          borderTop: `1px solid ${C.border2}`,
                          borderBottom: `1px solid ${C.border}`,
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.muted, flexShrink: 0 }} />
                            <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>{barrio}</span>
                            <span style={{ fontSize: 10, color: C.dim }}>
                              {grouped[barrio]?.length ?? 0} punto{(grouped[barrio]?.length ?? 0) !== 1 ? "s" : ""}
                              {" · "}{grouped[barrio]?.filter(e => e.horaInicio).length ?? 0} programados
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                    {(grouped[barrio] ?? []).map(entry => (
                      <TimetableRow
                        key={entry._id}
                        entry={entry}
                        onUpdate={changes => updateEntry(entry._id, changes)}
                        onDelete={() => deleteEntry(entry._id)}
                      />
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

        </div>
      )}
    </div>
  );
}

// ── PLANNING PAGE ─────────────────────────────────────────────────
export function PlanningPage({ sesion, onLogout, projectId, embedded = false }) {
  const orgId = sesion?.org_id ?? null;

  const [layers,       setLayers]       = useState([]);
  const [depots,       setDepots]       = useState([]);
  const [barrioColors, setBarrioColors] = useState({});
  const [mapStyle,     setMapStyle]     = useState("dark");

  const layersMigratedRef  = useRef(false);
  const depotsMigratedRef  = useRef(false);
  const colorDebounceRef   = useRef(null);

  // ── Layers: Firestore subscription + one-time localStorage migration ──
  useEffect(() => {
    if (!projectId) return;
    const q = query(collection(db, "planning_layers"), where("projectId", "==", projectId));
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => d.data()).sort((a, b) => a.id - b.id);
      setLayers(docs);
      if (!layersMigratedRef.current) {
        layersMigratedRef.current = true;
        if (snap.empty) {
          const migKey = `fc_migrated_layers_v1_${projectId}`;
          if (!localStorage.getItem(migKey)) {
            try {
              const old = JSON.parse(localStorage.getItem(`fc_layers_${projectId}`)) ?? [];
              for (const l of old) {
                setDoc(doc(db, "planning_layers", `${projectId}_${l.id}`), {
                  ...l, projectId, orgId, createdAt: serverTimestamp(),
                });
              }
              if (old.length > 0) localStorage.removeItem(`fc_layers_${projectId}`);
            } catch {}
            localStorage.setItem(migKey, "1");
          }
        }
      }
    });
    return () => unsub();
  }, [projectId]);

  // ── Depots: Firestore subscription + one-time localStorage migration ──
  useEffect(() => {
    if (!projectId) return;
    const unsub = onSnapshot(doc(db, "planning_depots", projectId), snap => {
      const list = snap.exists() ? (snap.data().depots ?? []) : [];
      setDepots(list);
      if (!depotsMigratedRef.current) {
        depotsMigratedRef.current = true;
        if (!snap.exists()) {
          const migKey = `fc_migrated_depots_v1_${projectId}`;
          if (!localStorage.getItem(migKey)) {
            try {
              const old = JSON.parse(localStorage.getItem(`fc_depots_${projectId}`)) ?? [];
              if (old.length > 0) {
                setDoc(doc(db, "planning_depots", projectId), {
                  depots: old, projectId, orgId, updatedAt: serverTimestamp(),
                });
                localStorage.removeItem(`fc_depots_${projectId}`);
              }
            } catch {}
            localStorage.setItem(migKey, "1");
          }
        }
      }
    });
    return () => unsub();
  }, [projectId]);

  // ── Settings: read once on mount, migrate from localStorage if needed ──
  useEffect(() => {
    if (!projectId) return;
    getDoc(doc(db, "planning_settings", projectId)).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        setBarrioColors(data.barrioColors ?? {});
        setMapStyle(data.mapStyle ?? "dark");
      } else {
        const migKey = `fc_migrated_settings_v1_${projectId}`;
        if (!localStorage.getItem(migKey)) {
          try {
            const oldColors = JSON.parse(localStorage.getItem(`fc_barrio_colors_${projectId}`)) ?? {};
            const oldStyle  = localStorage.getItem(`fc_map_style_${projectId}`) ?? "dark";
            setBarrioColors(oldColors);
            setMapStyle(oldStyle);
            setDoc(doc(db, "planning_settings", projectId), {
              barrioColors: oldColors, mapStyle: oldStyle,
              projectId, orgId, updatedAt: serverTimestamp(),
            });
            if (Object.keys(oldColors).length > 0) localStorage.removeItem(`fc_barrio_colors_${projectId}`);
            localStorage.removeItem(`fc_map_style_${projectId}`);
          } catch {}
          localStorage.setItem(migKey, "1");
        }
      }
    });
  }, [projectId]);

  // Debounced helper for barrio color writes
  function saveBarrioColors(newColors) {
    if (!projectId) return;
    clearTimeout(colorDebounceRef.current);
    colorDebounceRef.current = setTimeout(() => {
      setDoc(doc(db, "planning_settings", projectId), {
        barrioColors: newColors, updatedAt: serverTimestamp(),
      }, { merge: true });
    }, 800);
  }

  const [uploading, setUploading]           = useState(false);
  const [depotUploading, setDepotUploading] = useState(false);
  const [errors, setErrors]                 = useState([]);
  const [tab, setTab]                       = useState("mapa");
  const [searchQuery, setSearchQuery]       = useState("");

  const timetableCol = projectId
    ? collection(db, "scheduling_projects", projectId, "timetable")
    : collection(db, "planning_timetable");

  async function handleDepotImport(files) {
    setDepotUploading(true);
    const newErrors = [];
    for (const file of files) {
      const ext = file.name.split(".").pop().toLowerCase();
      let result;
      try {
        if (ext === "csv")       result = parseCSV(await file.text());
        else if (ext === "kml")  result = parseKMLPlanning(await file.text());
        else if (ext === "xlsx") result = await parseXLSX(file);
        else { newErrors.push(`${file.name}: formato no soportado`); continue; }
      } catch (e) { newErrors.push(`${file.name}: ${e.message}`); continue; }
      if (result.error) { newErrors.push(`${file.name}: ${result.error}`); continue; }
      const newDepots = result.markers.map(m => ({
        id: Date.now() + Math.random(),
        lat: m.lat, lng: m.lng,
        nombre: m.nombre || m.name || m.id || `Depot ${m.lat?.toFixed(4)},${m.lng?.toFixed(4)}`,
        fields: Object.fromEntries(
          Object.entries(m).filter(([k]) => !["lat","lng","nombre","name"].includes(k.toLowerCase()))
        ),
      }));
      if (projectId) {
        const merged = [...depots, ...newDepots];
        setDoc(doc(db, "planning_depots", projectId), {
          depots: merged, projectId, orgId, updatedAt: serverTimestamp(),
        });
      } else {
        setDepots(prev => [...prev, ...newDepots]);
      }
    }
    if (newErrors.length) setErrors(prev => [...prev, ...newErrors]);
    setDepotUploading(false);
  }

  async function handleUpload(files) {
    setUploading(true);
    setErrors([]);
    const newErrors = [];

    for (const file of files) {
      const name = file.name.replace(/\.[^.]+$/, "");
      const ext = file.name.split(".").pop().toLowerCase();
      const color = LAYER_COLORS[layers.length % LAYER_COLORS.length];

      let result;
      try {
        if (ext === "csv") {
          result = parseCSV(await file.text());
        } else if (ext === "kml") {
          result = parseKMLPlanning(await file.text());
        } else if (ext === "xlsx") {
          result = await parseXLSX(file);
        } else {
          newErrors.push(`${file.name}: formato no soportado (solo CSV, KML y XLSX)`);
          continue;
        }
      } catch (e) {
        newErrors.push(`${file.name}: Error inesperado al procesar el archivo: ${e.message}`);
        continue;
      }

      if (result.error) {
        newErrors.push(`${file.name}: ${result.error}`);
        continue;
      }

      const newLayer = {
        id: Date.now() + Math.random(),
        name, type: ext, color,
        markers: result.markers, visible: true,
      };
      if (projectId) {
        setDoc(doc(db, "planning_layers", `${projectId}_${newLayer.id}`), {
          ...newLayer, projectId, orgId, createdAt: serverTimestamp(),
        });
      } else {
        setLayers(prev => [...prev, newLayer]);
      }
    }

    if (newErrors.length) setErrors(newErrors);
    setUploading(false);
  }

  const initials = ((sesion.nombre?.[0] ?? "") + (sesion.apellidos?.[0] ?? "")).toUpperCase();

  const filteredLayers = searchQuery.trim()
    ? layers.map(l => ({
        ...l,
        markers: l.markers.filter(m =>
          Object.values(m).some(v => String(v ?? "").toLowerCase().includes(searchQuery.toLowerCase()))
        ),
      }))
    : layers;

  const totalFiltered = filteredLayers.reduce((s, l) => s + l.markers.length, 0);
  const totalAll      = layers.reduce((s, l) => s + l.markers.length, 0);

  const inner = (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: embedded ? "100%" : "100vh", background: C.bg, fontFamily: font }}>
      {/* Header — only when standalone */}
      {!embedded && <div style={{
        height: 52, flexShrink: 0,
        background: C.card, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px", zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: C.muted,
            letterSpacing: 2, textTransform: "uppercase",
          }}>
            Operanzia
          </div>
          <div style={{ width: 1, height: 16, background: C.border2 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Planning</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{sesion.nombre}</div>
            <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: .5 }}>{sesion.rol}</div>
          </div>
          <button
            onClick={onLogout}
            title="Cerrar sesión"
            style={{
              width: 32, height: 32, borderRadius: "50%",
              background: C.surface2,
              border: `1px solid ${C.border}`,
              color: C.muted, fontSize: 11, fontWeight: 600,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all .15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
          >
            {initials}
          </button>
        </div>
      </div>}

      {/* Error toasts */}
      {errors.length > 0 && (
        <div style={{ position: "absolute", top: 60, right: 16, zIndex: 1000, display: "flex", flexDirection: "column", gap: 6 }}>
          {errors.map((err, i) => (
            <div key={i} style={{
              background: C.card, border: `1px solid rgba(248,113,113,0.3)`,
              color: C.red, borderRadius: 8, padding: "10px 14px",
              fontSize: 12, display: "flex", alignItems: "center", gap: 8,
              maxWidth: 380, boxShadow: "0 4px 20px rgba(0,0,0,.4)",
              animation: "planning-fadein .2s ease both",
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span style={{ flex: 1 }}>{err}</span>
              <button onClick={() => setErrors(prev => prev.filter((_, j) => j !== i))}
                style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1, transition: "color .12s" }}
                onMouseEnter={e => e.currentTarget.style.color = C.red}
                onMouseLeave={e => e.currentTarget.style.color = C.dim}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <div style={{
        height: 40, flexShrink: 0,
        background: C.card, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "stretch", padding: "0 20px", gap: 2,
        zIndex: 5,
      }}>
        {[
          { key: "mapa",      label: "Mapa" },
          { key: "timetable", label: "Timetable" },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "0 14px", fontFamily: font,
            fontSize: 13, fontWeight: tab === t.key ? 600 : 400,
            color: tab === t.key ? C.text : C.muted,
            borderBottom: `2px solid ${tab === t.key ? C.blue : "transparent"}`,
            marginBottom: -1,
            display: "flex", alignItems: "center", gap: 6,
            transition: "color .12s",
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {tab === "mapa" ? (
          <>
            <Sidebar
              layers={layers}
              setLayers={setLayers}
              onUpload={handleUpload}
              uploading={uploading}
              depots={depots}
              setDepots={setDepots}
              onDepotImport={handleDepotImport}
              depotUploading={depotUploading}
              barrioColors={barrioColors}
              setBarrioColors={setBarrioColors}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              totalFiltered={totalFiltered}
              totalAll={totalAll}
            />
            <MapaPlanning layers={filteredLayers} depots={depots} barrioColors={barrioColors} mapStyle={mapStyle} setMapStyle={setMapStyle} />
          </>
        ) : (
          <TabTimetable layers={layers} projectId={projectId} />
        )}
      </div>
    </div>
  );

  return inner;
}

// ── LOGIN ─────────────────────────────────────────────────────────
function LoginPlanning({ onLogin }) {
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function go() {
    if (!usuario || !password) { setErr("Introduce usuario y contraseña."); return; }
    setLoading(true); setErr("");

    let found = null;
    try {
      await new Promise((resolve, reject) => {
        const q = query(collection(db, "usuarios"));
        const unsub = onSnapshot(q, snap => {
          unsub();
          const u = snap.docs.map(d => ({ ...d.data(), _id: d.id }))
            .find(u => u.usuario === usuario && u.password === password && u.activo !== false);
          if (u) found = u;
          resolve();
        }, reject);
      });
    } catch {}

    if (!found) {
      found = USUARIOS_INIT.find(u => u.usuario === usuario && u.password === password);
    }

    if (!found) { setErr("Credenciales incorrectas."); setLoading(false); return; }
    if (found.rol !== "admin") { setErr("Acceso restringido a administradores."); setLoading(false); return; }

    onLogin(found);
    setLoading(false);
  }

  const inputStyle = {
    width: "100%", background: "rgba(255,255,255,0.04)",
    border: `1px solid ${C.border}`, color: C.text,
    padding: "11px 14px", borderRadius: 7, fontSize: 13,
    boxSizing: "border-box", fontFamily: font, outline: "none",
    transition: "border-color .15s",
  };

  return (
    <div style={{
      minHeight: "100vh", background: C.bg, display: "flex",
      alignItems: "center", justifyContent: "center", fontFamily: font,
    }}>
      <div style={{
        width: 360, background: C.card,
        border: `1px solid ${C.border}`, borderRadius: 12,
        padding: "32px 28px",
        boxShadow: "0 16px 48px rgba(0,0,0,.5)",
        animation: "planning-fadein .3s ease both",
      }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>Operanzia</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>Planning</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Acceso para administradores</div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6, fontWeight: 500 }}>
            Usuario
          </label>
          <input
            value={usuario} onChange={e => setUsuario(e.target.value)}
            placeholder="usuario" autoComplete="username"
            onKeyDown={e => e.key === "Enter" && go()}
            style={{
              ...inputStyle,
              borderColor: usuario ? "rgba(79,142,247,0.35)" : C.border,
            }}
            onFocus={e => e.target.style.borderColor = "rgba(79,142,247,0.5)"}
            onBlur={e => e.target.style.borderColor = usuario ? "rgba(79,142,247,0.35)" : C.border}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6, fontWeight: 500 }}>
            Contraseña
          </label>
          <input
            value={password} onChange={e => setPassword(e.target.value)}
            type="password" placeholder="••••••••" autoComplete="current-password"
            onKeyDown={e => e.key === "Enter" && go()}
            style={{
              ...inputStyle,
              borderColor: password ? "rgba(79,142,247,0.35)" : C.border,
            }}
            onFocus={e => e.target.style.borderColor = "rgba(79,142,247,0.5)"}
            onBlur={e => e.target.style.borderColor = password ? "rgba(79,142,247,0.35)" : C.border}
          />
        </div>

        {err && (
          <div style={{
            background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)",
            color: C.red, borderRadius: 7, padding: "9px 13px",
            fontSize: 12, marginBottom: 16, display: "flex", alignItems: "center", gap: 8,
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {err}
          </div>
        )}

        <button
          onClick={go} disabled={loading}
          style={{
            width: "100%", padding: "11px", fontSize: 13, fontWeight: 600,
            background: loading ? C.blueDim : C.blue,
            border: "none", color: loading ? C.blueText : "#fff",
            borderRadius: 8, cursor: loading ? "wait" : "pointer",
            fontFamily: font, transition: "all .15s",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
          onMouseEnter={e => { if (!loading) e.currentTarget.style.background = "#3a7ef5"; }}
          onMouseLeave={e => { if (!loading) e.currentTarget.style.background = C.blue; }}
        >
          {loading
            ? <><span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid rgba(163,196,252,0.3)", borderTopColor: C.blueText, borderRadius: "50%", animation: "planning-spin .6s linear infinite" }} /> Accediendo…</>
            : "Acceder"
          }
        </button>

        <div style={{ marginTop: 20, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1, marginBottom: 8, textTransform: "uppercase", fontWeight: 500 }}>Acceso de prueba</div>
          <div
            onClick={() => { setUsuario("admin"); setPassword("admin123"); }}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", padding: "4px 0", transition: "opacity .15s" }}
            onMouseEnter={e => e.currentTarget.style.opacity = ".6"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}
          >
            <span style={{ fontSize: 12, color: C.muted, fontFamily: mono }}>admin</span>
            <span style={{ fontSize: 11, color: C.dim, fontFamily: mono }}>admin123</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PLANNING APP (root) ───────────────────────────────────────────
export default function PlanningApp() {
  const [sesion, setSesion] = useState(undefined);

  useEffect(() => {
    return onAuthStateChanged(auth, async user => {
      if (user) {
        try {
          const snap = await getDoc(doc(db, "usuarios", user.uid));
          if (snap.exists() && snap.data().activo !== false) {
            setSesion({ uid: user.uid, ...snap.data() });
          } else { await signOut(auth); setSesion(null); }
        } catch { setSesion(null); }
      } else { setSesion(null); }
    });
  }, []);

  async function handleLogout() {
    await signOut(auth);
    setSesion(null);
    window.location.href = "/scheduling";
  }

  if (sesion === undefined) return null;
  if (!sesion || sesion.rol !== "admin") {
    window.location.href = "/scheduling";
    return null;
  }

  return <PlanningPage sesion={sesion} onLogout={handleLogout} />;
}
