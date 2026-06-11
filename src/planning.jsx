import { useState, useRef, useEffect, useCallback, Fragment } from "react";
import * as XLSX from "xlsx";
import { db } from "./firebase.js";
import { collection, onSnapshot, query, doc, setDoc, deleteDoc, updateDoc, serverTimestamp } from "firebase/firestore";

// ── DESIGN TOKENS ─────────────────────────────────────────────────
const C = {
  bg:      "#0f1117",
  card:    "#161b27",
  surface2:"#1c2333",
  border:  "rgba(255,255,255,0.08)",
  border2: "rgba(255,255,255,0.13)",
  blue:    "#4f8ef7",
  blueDim: "#0d2248",
  blueText:"#a3c4fc",
  cyan:    "#4f8ef7",
  cyanDim: "#0d2248",
  cyanText:"#a3c4fc",
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
function barrioColor(b) {
  if (!b) return "#8b95a5";
  if (_barrioCache[b]) return _barrioCache[b];
  let h = 0;
  for (let i = 0; i < b.length; i++) h = (h * 31 + b.charCodeAt(i)) >>> 0;
  return (_barrioCache[b] = BARRIO_PALETTE[h % BARRIO_PALETTE.length]);
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

// ── MAPA PLANNING ─────────────────────────────────────────────────
function MapaPlanning({ layers }) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const leafletLayersRef = useRef([]);

  const drawLayers = useCallback(() => {
    const L = window.L;
    if (!L || !mapRef.current) return;
    const map = mapRef.current;

    leafletLayersRef.current.forEach(l => { try { map.removeLayer(l); } catch {} });
    leafletLayersRef.current = [];

    const allPoints = [];
    let firstMarkerLogged = false;
    layers.filter(l => l.visible).forEach(layer => {
      layer.markers.forEach(m => {
        if (!firstMarkerLogged) {
          console.log("[planning] campos del primer marcador:", Object.keys(m));
          firstMarkerLogged = true;
        }
        const size = 14;
        const barrio = getBarrio(m);
        const color = barrio ? barrioColor(barrio) : layer.color;
        const icon = L.divIcon({
          className: "",
          html: `<div style="
            width:${size}px;height:${size}px;border-radius:50%;
            background:${color};border:2px solid rgba(255,255,255,0.8);
            box-shadow:0 2px 8px rgba(0,0,0,0.5);
            cursor:pointer;transition:transform .15s;
          "></div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
          popupAnchor: [0, -size / 2],
        });

        const marker = L.marker([m.lat, m.lng], { icon })
          .bindPopup(makePopupHtml(m, color), {
            maxWidth: 320,
            className: "",
          });
        marker.addTo(map);
        leafletLayersRef.current.push(marker);
        allPoints.push([m.lat, m.lng]);
      });
    });

    if (allPoints.length > 0) {
      map.invalidateSize();
      map.fitBounds(allPoints, { padding: [40, 40], maxZoom: 16 });
    }
  }, [layers]);

  const initMap = useCallback(() => {
    if (!divRef.current || mapRef.current) return;
    const L = window.L;
    if (!L) return;
    const map = L.map(divRef.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView([40.416, -3.703], 6);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
    }).addTo(map);

    mapRef.current = map;
    drawLayers();
  }, [drawLayers]);

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
    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
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

  // Call invalidateSize whenever the container is resized (handles tab show/hide)
  useEffect(() => {
    if (!divRef.current) return;
    const ro = new ResizeObserver(() => {
      if (mapRef.current && divRef.current?.offsetWidth > 0) {
        mapRef.current.invalidateSize();
      }
    });
    ro.observe(divRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={divRef}
      className="planning-map"
      style={{ flex: 1, width: "100%", height: "100%", background: "#1c2333" }}
    />
  );
}

// ── SIDEBAR ───────────────────────────────────────────────────────
function Sidebar({ layers, setLayers, onUpload, uploading }) {
  const fileRef = useRef(null);

  function removeLayer(id) {
    setLayers(prev => prev.filter(l => l.id !== id));
  }
  function toggleLayer(id) {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
  }

  const totalMarkers = layers.reduce((s, l) => s + l.markers.length, 0);

  return (
    <div style={{
      width: 280, flexShrink: 0, background: C.card,
      borderRight: `1px solid ${C.border}`,
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Upload area */}
      <div style={{ padding: "16px 16px 14px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>
          Cargar capa
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.kml,.xlsx"
          multiple
          style={{ display: "none" }}
          onChange={e => onUpload(Array.from(e.target.files))}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{
            width: "100%", padding: "9px 14px",
            background: uploading ? C.surface2 : C.blueDim,
            border: `1px solid ${C.blue}44`,
            color: C.blueText, borderRadius: 8, fontSize: 12,
            fontWeight: 600, cursor: uploading ? "wait" : "pointer",
            fontFamily: font, transition: "all .15s",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
          onMouseEnter={e => { if (!uploading) e.currentTarget.style.background = "#1a3570"; }}
          onMouseLeave={e => { if (!uploading) e.currentTarget.style.background = C.blueDim; }}
        >
          {uploading
            ? <><span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(163,196,252,0.2)", borderTopColor: C.blueText, borderRadius: "50%", animation: "planning-spin .6s linear infinite" }} /> Procesando…</>
            : "Subir CSV / KML / Excel"
          }
        </button>
        <div style={{ fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.7 }}>
          <div>CSV: columnas <code style={{ color: C.muted, fontFamily: mono, fontSize: 10 }}>lat</code> y <code style={{ color: C.muted, fontFamily: mono, fontSize: 10 }}>lon</code></div>
          <div>Excel: columna <code style={{ color: C.muted, fontFamily: mono, fontSize: 10 }}>coordenadas</code> (lat,lng)</div>
        </div>
      </div>

      {/* Stats */}
      {layers.length > 0 && (
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 20 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, lineHeight: 1 }}>{layers.length}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>capas</div>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, lineHeight: 1 }}>{totalMarkers}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>puntos</div>
          </div>
        </div>
      )}

      {/* Layers list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
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

      {/* Barrio legend */}
      {(() => {
        const barrios = [...new Set(
          layers.filter(l => l.visible)
            .flatMap(l => l.markers.map(m => getBarrio(m)))
            .filter(Boolean)
        )].sort();
        if (barrios.length === 0) return null;
        return (
          <div style={{ borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
            <div style={{ padding: "8px 12px 4px", fontSize: 9, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>
              Barrios ({barrios.length})
            </div>
            <div style={{ maxHeight: 220, overflowY: "auto", padding: "2px 12px 8px" }}>
              {barrios.map(b => (
                <div key={b} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                    background: barrioColor(b),
                  }} />
                  <span style={{ fontSize: 11, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Bottom: clear all */}
      {layers.length > 0 && (
        <div style={{ padding: "10px 12px", borderTop: `1px solid ${C.border}` }}>
          <button
            onClick={() => setLayers([])}
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
  const [layers, setLayers] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState([]);
  const [tab, setTab] = useState("mapa");

  const timetableCol = projectId
    ? collection(db, "scheduling_projects", projectId, "timetable")
    : collection(db, "planning_timetable");

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

      setLayers(prev => [...prev, {
        id: Date.now() + Math.random(),
        name,
        type: ext,
        color,
        markers: result.markers,
        visible: true,
      }]);
    }

    if (newErrors.length) setErrors(newErrors);
    setUploading(false);
  }

  const initials = ((sesion.nombre?.[0] ?? "") + (sesion.apellidos?.[0] ?? "")).toUpperCase();

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
            FleetComms
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
            />
            <MapaPlanning layers={layers} />
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
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>FleetComms</div>
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
  const [sesion, setSesion] = useState(() => {
    try {
      const s = localStorage.getItem("fc_session");
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });

  function handleLogout() {
    setSesion(null);
    localStorage.removeItem("fc_session");
    window.location.href = "/scheduling";
  }

  if (!sesion || sesion.rol !== "admin") {
    window.location.href = "/scheduling";
    return null;
  }

  return <PlanningPage sesion={sesion} onLogout={handleLogout} />;
}
