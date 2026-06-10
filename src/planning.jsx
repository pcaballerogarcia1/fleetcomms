import { useState, useRef, useEffect, useCallback, Fragment } from "react";
import * as XLSX from "xlsx";
import { db } from "./firebase.js";
import { collection, onSnapshot, query, doc, setDoc, deleteDoc, updateDoc, serverTimestamp } from "firebase/firestore";

// ── DESIGN SYSTEM (same tokens as App) ───────────────────────────
const C = {
  bg:"#080c14", card:"#0d1424", surface2:"#121929",
  border:"#1e2d45", border2:"#253650",
  cyan:"#00d4ff", cyanDim:"#003d4d", cyanText:"#67e8f9",
  green:"#10e88a", greenDim:"#012a1a",
  orange:"#ff8c42", red:"#ff4d6d", amber:"#fbbf24",
  text:"#e8edf5", muted:"#5a7090", dim:"#2d4060",
};
const font = "'Space Grotesk',system-ui,sans-serif";
const mono = "'JetBrains Mono','Courier New',monospace";

const LAYER_COLORS = [
  "#00d4ff","#ff8c42","#10e88a","#ff4d6d",
  "#a78bfa","#fbbf24","#f472b6","#34d399",
];

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
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
    *,*::before,*::after{box-sizing:border-box;-webkit-font-smoothing:antialiased;}
    body{margin:0;background:#080c14;color:#e8edf5;font-family:${font};}
    ::-webkit-scrollbar{width:4px;height:4px;}
    ::-webkit-scrollbar-track{background:#0d1424;}
    ::-webkit-scrollbar-thumb{background:#253650;border-radius:2px;}

    /* Leaflet popup dark theme */
    .planning-map .leaflet-popup-content-wrapper{
      background:#0d1424;color:#e8edf5;border:1px solid #1e2d45;
      border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,.6);padding:0;
    }
    .planning-map .leaflet-popup-content{margin:0;}
    .planning-map .leaflet-popup-tip{background:#0d1424;}
    .planning-map .leaflet-popup-close-button{color:#5a7090!important;font-size:18px!important;top:6px!important;right:10px!important;}
    .planning-map .leaflet-popup-close-button:hover{color:#e8edf5!important;}
    .planning-map .leaflet-control-zoom a{
      background:#0d1424!important;color:#e8edf5!important;border-color:#1e2d45!important;
    }
    .planning-map .leaflet-control-zoom a:hover{background:#1e2d45!important;}
    .planning-map .leaflet-bar{border-color:#1e2d45!important;box-shadow:0 2px 12px rgba(0,0,0,.5)!important;}
    @keyframes planning-spin{to{transform:rotate(360deg)}}
    @keyframes planning-fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
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
      // <SimpleData name="X">Y</SimpleData>
      const sdRe = /<SimpleData\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/SimpleData>/g;
      let m;
      while ((m = sdRe.exec(block)) !== null) fields[m[1]] = m[2].trim();
      // <Data name="X"><value>Y</value></Data>
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

      // Skip LineString placemarks
      if (block.includes("<LineString>")) continue;

      // Coordinates
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
        <td style="color:#5a7090;padding:3px 12px 3px 0;font-size:11px;white-space:nowrap;vertical-align:top;">${k}</td>
        <td style="color:#e8edf5;font-size:11px;word-break:break-word;">${v ?? "—"}</td>
      </tr>`)
    .join("");

  return `
    <div style="font-family:'Space Grotesk',sans-serif;min-width:180px;max-width:300px;padding:12px 14px;">
      ${title ? `<div style="font-size:13px;font-weight:700;color:${color};margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #1e2d45;">${title}</div>` : ""}
      ${rows ? `<table style="width:100%;border-collapse:collapse;">${rows}</table>` : '<div style="color:#5a7090;font-size:12px;">Sin campos adicionales</div>'}
      <div style="font-size:10px;color:#2d4060;margin-top:8px;font-family:monospace;">${marker.lat?.toFixed(5)}, ${marker.lng?.toFixed(5)}</div>
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
    layers.filter(l => l.visible).forEach(layer => {
      layer.markers.forEach(m => {
        const size = 14;
        const icon = L.divIcon({
          className: "",
          html: `<div style="
            width:${size}px;height:${size}px;border-radius:50%;
            background:${layer.color};border:2px solid rgba(255,255,255,0.8);
            box-shadow:0 2px 8px rgba(0,0,0,0.5);
            cursor:pointer;transition:transform .15s;
          "></div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
          popupAnchor: [0, -size / 2],
        });

        const marker = L.marker([m.lat, m.lng], { icon })
          .bindPopup(makePopupHtml(m, layer.color), {
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

  return (
    <div
      ref={divRef}
      className="planning-map"
      style={{ flex: 1, width: "100%", height: "100%", background: "#1a2535" }}
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
      width: 300, flexShrink: 0, background: C.card,
      borderRight: `1px solid ${C.border}`,
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Upload area */}
      <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10, fontWeight: 500 }}>
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
            width: "100%", padding: "10px 14px",
            background: uploading ? C.surface2 : C.cyanDim,
            border: `1px solid ${C.cyan}44`,
            color: C.cyanText, borderRadius: 9, fontSize: 12,
            fontWeight: 600, cursor: uploading ? "wait" : "pointer",
            fontFamily: font, transition: "all .15s",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
          onMouseEnter={e => { if (!uploading) e.currentTarget.style.background = "#005a70"; }}
          onMouseLeave={e => { if (!uploading) e.currentTarget.style.background = C.cyanDim; }}
        >
          {uploading
            ? <><span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #00d4ff33", borderTopColor: C.cyan, borderRadius: "50%", animation: "planning-spin .6s linear infinite" }} /> Procesando…</>
            : <><span style={{ fontSize: 15 }}>📂</span> Subir CSV / KML / Excel</>
          }
        </button>
        <div style={{ fontSize: 10, color: C.dim, marginTop: 7, lineHeight: 1.6 }}>
          <div>CSV: columnas <span style={{ color: C.muted, fontFamily: mono }}>lat</span> y <span style={{ color: C.muted, fontFamily: mono }}>lon</span></div>
          <div>Excel: columna <span style={{ color: C.muted, fontFamily: mono }}>coordenadas</span> (<span style={{ fontFamily: mono }}>lat,lng</span>)</div>
        </div>
      </div>

      {/* Stats */}
      {layers.length > 0 && (
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.cyan, lineHeight: 1 }}>{layers.length}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>capas</div>
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.green, lineHeight: 1 }}>{totalMarkers}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>activos</div>
          </div>
        </div>
      )}

      {/* Layers list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
        {layers.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🗂️</div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
              Sube un archivo CSV o KML para visualizar activos en el mapa
            </div>
          </div>
        ) : (
          layers.map(layer => (
            <div key={layer.id} style={{
              background: C.surface2, border: `1px solid ${C.border}`,
              borderLeft: `3px solid ${layer.visible ? layer.color : C.dim}`,
              borderRadius: 9, padding: "10px 12px", marginBottom: 6,
              opacity: layer.visible ? 1 : 0.55,
              animation: "planning-fadein .2s ease both",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                {/* Visibility toggle */}
                <button
                  onClick={() => toggleLayer(layer.id)}
                  title={layer.visible ? "Ocultar" : "Mostrar"}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: 15, padding: 0, lineHeight: 1, opacity: layer.visible ? 1 : 0.4,
                  }}
                >
                  {layer.visible ? "👁" : "🚫"}
                </button>

                {/* Color swatch */}
                <div style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: layer.color, flexShrink: 0,
                  border: "2px solid rgba(255,255,255,0.3)",
                }} />

                {/* Name */}
                <div style={{
                  flex: 1, fontSize: 12, fontWeight: 600, color: C.text,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {layer.name}
                </div>

                {/* Delete */}
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
                  ✕
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 2 }}>
                <span style={{
                  fontSize: 9, padding: "2px 7px", borderRadius: 10,
                  background: layer.type === "csv" ? "#001a30" : layer.type === "xlsx" ? "#012a1a" : "#1a0d2e",
                  color: layer.type === "csv" ? C.cyanText : layer.type === "xlsx" ? C.green : "#a78bfa",
                  border: `1px solid ${layer.type === "csv" ? "#00d4ff22" : layer.type === "xlsx" ? "#10e88a22" : "#7c3aed22"}`,
                  letterSpacing: .5, textTransform: "uppercase", fontWeight: 600,
                }}>
                  {layer.type}
                </span>
                <span style={{ fontSize: 11, color: C.muted }}>
                  {layer.markers.length} punto{layer.markers.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Bottom: clear all */}
      {layers.length > 0 && (
        <div style={{ padding: "10px 12px", borderTop: `1px solid ${C.border}` }}>
          <button
            onClick={() => setLayers([])}
            style={{
              width: "100%", padding: "8px", background: "none",
              border: `1px solid ${C.border}`, color: C.muted,
              borderRadius: 8, fontSize: 11, cursor: "pointer",
              fontFamily: font, transition: "all .15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
          >
            Eliminar todas las capas
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
      <td style={{ padding: "9px 14px", verticalAlign: "top" }}>
        <div style={{ fontWeight: 600, fontSize: 12, color: C.text, marginBottom: 1 }}>
          {entry.nombre || `${entry.lat?.toFixed(4)}, ${entry.lng?.toFixed(4)}`}
        </div>
        <div style={{ fontSize: 10, color: C.muted, fontFamily: mono, marginBottom: 2 }}>
          {entry.lat?.toFixed(5)}, {entry.lng?.toFixed(5)}
        </div>
        {camposRows.slice(0, 3).map(([k, v]) => (
          <div key={k} style={{ fontSize: 10, color: C.dim, lineHeight: 1.4 }}>
            <span style={{ color: C.muted }}>{k}:</span> {v}
          </div>
        ))}
        {camposRows.length > 3 && (
          <div style={{ fontSize: 9, color: C.dim, marginTop: 2 }}>+{camposRows.length - 3} más</div>
        )}
      </td>

      {/* Hora inicio */}
      <td style={{ padding: "9px 8px", verticalAlign: "middle", width: 116 }}>
        <input
          type="time"
          value={localStart}
          onChange={e => setLocalStart(e.target.value)}
          onBlur={e => onUpdate({ horaInicio: e.target.value || null })}
          style={{
            width: "100%", background: "#0a1020",
            border: `1px solid ${localStart ? C.cyan + "55" : C.border}`,
            color: localStart ? C.cyanText : C.muted,
            padding: "6px 8px", borderRadius: 7, fontSize: 12,
            fontFamily: mono, outline: "none", cursor: "pointer",
          }}
        />
      </td>

      {/* Duración */}
      <td style={{ padding: "9px 8px", verticalAlign: "middle", width: 106 }}>
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
              width: 56, background: "#0a1020",
              border: `1px solid ${localDur ? C.amber + "55" : C.border}`,
              color: localDur ? C.amber : C.muted,
              padding: "6px 8px", borderRadius: 7, fontSize: 12,
              fontFamily: mono, outline: "none", textAlign: "right",
            }}
          />
          <span style={{ fontSize: 10, color: C.dim, flexShrink: 0 }}>min</span>
        </div>
      </td>

      {/* Acciones */}
      <td style={{ padding: "9px 12px 9px 4px", verticalAlign: "middle", width: 36 }}>
        <button onClick={onDelete} title="Eliminar" style={{
          width: 26, height: 26, borderRadius: 7,
          background: "none", border: `1px solid ${C.border}`,
          color: C.dim, cursor: "pointer", fontSize: 13,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all .15s", fontFamily: font,
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
        >✕</button>
      </td>
    </tr>
  );
}

// ── TIMETABLE TAB ─────────────────────────────────────────────────
function TabTimetable({ layers }) {
  const [entries,     setEntries]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [barrioFiltro, setBarrioFiltro] = useState(null); // null = todos

  // Real-time listener
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "planning_timetable"),
      snap => { setEntries(snap.docs.map(d => ({ _id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  // Sync newly uploaded layers → Firebase (merge preserves horaInicio/duracion)
  useEffect(() => {
    const allMarkers = layers.flatMap(l => l.markers.map(m => ({ ...m, layerColor: l.color })));
    if (allMarkers.length === 0) return;
    allMarkers.forEach(m => {
      const { lat, lng, layerColor, nombre: _n, name: _nm, ...campos } = m;
      const nombre  = m.nombre || m.name || m.id || m.pa || "";
      const barrio  = Object.entries(campos).find(([k]) => k.toLowerCase() === "barrio")?.[1] || "";
      const puntoKey = `${lat.toFixed(5)}_${lng.toFixed(5)}`;
      setDoc(
        doc(db, "planning_timetable", puntoKey),
        { puntoKey, lat, lng, campos, nombre, barrio, layerColor, updatedAt: serverTimestamp() },
        { merge: true }
      );
    });
  }, [layers]);

  async function updateEntry(id, changes) {
    await updateDoc(doc(db, "planning_timetable", id), { ...changes, updatedAt: serverTimestamp() });
  }
  async function deleteEntry(id) {
    await deleteDoc(doc(db, "planning_timetable", id));
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

  // Which barrios to render (after chip filter)
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

    // Collect all unique campo keys (excluding barrio — already a top-level column)
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

    // Auto column widths
    const colWidths = Object.keys(rows[0] || {}).map(k => ({
      wch: Math.max(k.length, ...rows.map(r => String(r[k] ?? "").length), 8),
    }));
    ws["!cols"] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Timetable");
    XLSX.writeFile(wb, barrioFiltro ? `timetable_${barrioFiltro.replace(/\s+/g, "_")}.xlsx` : "timetable.xlsx");
  }

  const thS = {
    padding: "9px 14px", fontSize: 9, color: C.muted, fontWeight: 600,
    letterSpacing: 1.5, textTransform: "uppercase",
    borderBottom: `1px solid ${C.border}`, textAlign: "left",
    background: "#06090f", position: "sticky", top: 0, zIndex: 5,
  };

  if (loading) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ color: C.muted, fontSize: 13 }}>Cargando…</span>
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: font }}>

      {/* Stats bar */}
      <div style={{
        padding: "8px 20px", borderBottom: `1px solid ${C.border}`,
        background: C.card, flexShrink: 0,
        display: "flex", alignItems: "center", gap: 24,
      }}>
        <div>
          <span style={{ fontSize: 18, fontWeight: 700, color: C.cyan }}>{entries.length}</span>
          <span style={{ fontSize: 10, color: C.muted, marginLeft: 5 }}>puntos</span>
        </div>
        <div>
          <span style={{ fontSize: 18, fontWeight: 700, color: C.green }}>{withTime.length}</span>
          <span style={{ fontSize: 10, color: C.muted, marginLeft: 5 }}>programados</span>
        </div>
        <div>
          <span style={{ fontSize: 18, fontWeight: 700, color: C.amber }}>{entries.length - withTime.length}</span>
          <span style={{ fontSize: 10, color: C.muted, marginLeft: 5 }}>sin hora</span>
        </div>
        {barrios.length > 0 && (
          <div>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#a78bfa" }}>{barrios.length}</span>
            <span style={{ fontSize: 10, color: C.muted, marginLeft: 5 }}>barrios</span>
          </div>
        )}
        {entries.length === 0 && (
          <span style={{ fontSize: 11, color: C.dim }}>
            Ve a Mapa → sube un Excel para añadir puntos
          </span>
        )}

        {entries.length > 0 && (
          <button
            onClick={exportToExcel}
            title={barrioFiltro ? `Exportar barrio "${barrioFiltro}"` : "Exportar todo el timetable"}
            style={{
              marginLeft: "auto",
              display: "flex", alignItems: "center", gap: 7,
              padding: "7px 14px", borderRadius: 8, cursor: "pointer",
              background: C.greenDim, border: `1px solid ${C.green}44`,
              color: C.green, fontSize: 12, fontWeight: 600,
              fontFamily: font, transition: "all .15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "#024d30"; }}
            onMouseLeave={e => { e.currentTarget.style.background = C.greenDim; }}
          >
            <span style={{ fontSize: 14 }}>⬇</span>
            Exportar{barrioFiltro ? ` "${barrioFiltro}"` : ""}
          </button>
        )}
      </div>

      {/* Body: sidebar + table */}
      {entries.length === 0 ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <div style={{ fontSize: 44 }}>📋</div>
          <div style={{ fontSize: 13, color: C.muted }}>No hay puntos en el timetable</div>
          <div style={{ fontSize: 11, color: C.dim }}>Sube un Excel con columna "coordenadas" en la pestaña Mapa</div>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

          {/* ── Barrio sidebar ── */}
          {barrios.length > 0 && (
            <div style={{
              width: 200, flexShrink: 0,
              borderRight: `1px solid ${C.border}`,
              background: C.card,
              display: "flex", flexDirection: "column",
              overflowY: "auto",
            }}>
              <div style={{
                padding: "10px 14px 6px",
                fontSize: 9, color: C.dim, letterSpacing: 2,
                textTransform: "uppercase", fontWeight: 600, flexShrink: 0,
              }}>
                Barrios
              </div>

              {/* "Todos" item */}
              <button onClick={() => setBarrioFiltro(null)} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 14px", background: barrioFiltro === null ? C.cyanDim : "none",
                border: "none", borderLeft: `3px solid ${barrioFiltro === null ? C.cyan : "transparent"}`,
                color: barrioFiltro === null ? C.cyanText : C.muted,
                cursor: "pointer", fontFamily: font, fontSize: 12, fontWeight: 600,
                textAlign: "left", width: "100%", transition: "all .15s",
              }}
                onMouseEnter={e => { if (barrioFiltro !== null) e.currentTarget.style.background = C.surface2; }}
                onMouseLeave={e => { if (barrioFiltro !== null) e.currentTarget.style.background = "none"; }}
              >
                <span>Todos</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, fontFamily: mono,
                  background: barrioFiltro === null ? "#004d5e" : C.surface2,
                  color: barrioFiltro === null ? C.cyan : C.muted,
                  padding: "1px 6px", borderRadius: 8,
                }}>
                  {entries.length}
                </span>
              </button>

              <div style={{ height: 1, background: C.border, margin: "4px 14px" }} />

              {/* One item per barrio */}
              {barrios.map(b => {
                const active = barrioFiltro === b;
                const count  = grouped[b]?.length ?? 0;
                const prog   = grouped[b]?.filter(e => e.horaInicio).length ?? 0;
                return (
                  <button key={b} onClick={() => setBarrioFiltro(active ? null : b)} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "7px 14px", background: active ? "#1a0d2e" : "none",
                    border: "none", borderLeft: `3px solid ${active ? "#a78bfa" : "transparent"}`,
                    color: active ? "#a78bfa" : C.muted,
                    cursor: "pointer", fontFamily: font, fontSize: 12, fontWeight: active ? 600 : 400,
                    textAlign: "left", width: "100%", transition: "all .15s",
                  }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = C.surface2; }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = "none"; }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 6 }}>
                      {b}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, fontFamily: mono, flexShrink: 0,
                      background: active ? "#2d1f5e" : C.surface2,
                      color: active ? "#a78bfa" : C.muted,
                      padding: "1px 6px", borderRadius: 8,
                    }}>
                      {prog}/{count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Table ── */}
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
                    {/* Group header — only shown when "Todos" is active */}
                    {barrioFiltro === null && (
                      <tr>
                        <td colSpan={4} style={{
                          padding: "10px 16px 7px",
                          background: C.surface2,
                          borderTop: `2px solid ${C.border}`,
                          borderBottom: `1px solid ${C.border2}`,
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#a78bfa", flexShrink: 0, display: "inline-block" }} />
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#a78bfa", letterSpacing: .5 }}>{barrio}</span>
                            <span style={{ fontSize: 10, color: C.dim }}>
                              — {grouped[barrio]?.length ?? 0} punto{(grouped[barrio]?.length ?? 0) !== 1 ? "s" : ""}
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
function PlanningPage({ sesion, onLogout }) {
  const [layers, setLayers] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState([]);
  const [tab, setTab] = useState("mapa");

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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: C.bg, fontFamily: font }}>
      {/* Header */}
      <div style={{
        height: 56, flexShrink: 0,
        background: "#06090f", borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px", zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg,#003d4d,#004d5e)",
            border: "1px solid #00d4ff33",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
          }}>
            🗺️
          </div>
          <div>
            <div style={{ fontSize: 8, color: C.muted, letterSpacing: 3, textTransform: "uppercase" }}>FleetComms</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: -0.3 }}>Planning</div>
          </div>
          <div style={{
            marginLeft: 8, fontSize: 9, padding: "3px 10px", borderRadius: 10,
            background: "#1a0d2e", color: "#a78bfa",
            border: "1px solid #7c3aed33", letterSpacing: .5, textTransform: "uppercase", fontWeight: 600,
          }}>
            Admin
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{sesion.nombre}</div>
            <div style={{ fontSize: 9, color: "#a78bfa", letterSpacing: 1, textTransform: "uppercase" }}>{sesion.rol}</div>
          </div>
          <button
            onClick={onLogout}
            title="Cerrar sesión"
            style={{
              width: 36, height: 36, borderRadius: "50%",
              background: "linear-gradient(135deg,#1a0d2e,#2d1f5e)",
              border: "1px solid #7c3aed55",
              color: "#a78bfa", fontSize: 12, fontWeight: 700,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {((sesion.nombre?.[0] ?? "") + (sesion.apellidos?.[0] ?? "")).toUpperCase()}
          </button>
        </div>
      </div>

      {/* Error toasts */}
      {errors.length > 0 && (
        <div style={{ position: "absolute", top: 64, right: 16, zIndex: 1000, display: "flex", flexDirection: "column", gap: 6 }}>
          {errors.map((err, i) => (
            <div key={i} style={{
              background: "#1a0008", border: "1px solid #ff4d6d44",
              color: C.red, borderRadius: 9, padding: "10px 14px",
              fontSize: 12, display: "flex", alignItems: "center", gap: 8,
              maxWidth: 380, boxShadow: "0 4px 20px rgba(0,0,0,.5)",
              animation: "planning-fadein .2s ease both",
            }}>
              <span>⚠</span>
              <span style={{ flex: 1 }}>{err}</span>
              <button onClick={() => setErrors(prev => prev.filter((_, j) => j !== i))}
                style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1 }}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <div style={{
        height: 44, flexShrink: 0,
        background: "#06090f", borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "stretch", padding: "0 20px", gap: 4,
        zIndex: 5,
      }}>
        {[
          { key: "mapa",      label: "Mapa",      icon: "🗺️" },
          { key: "timetable", label: "Timetable", icon: "🕐" },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "0 14px", fontFamily: font,
            fontSize: 12, fontWeight: 600,
            color: tab === t.key ? C.cyan : C.muted,
            borderBottom: `2px solid ${tab === t.key ? C.cyan : "transparent"}`,
            display: "flex", alignItems: "center", gap: 6,
            transition: "color .15s",
          }}>
            <span style={{ fontSize: 13 }}>{t.icon}</span>{t.label}
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
          <TabTimetable layers={layers} />
        )}
      </div>
    </div>
  );
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

    // Check Firestore first
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

    // Fallback to hardcoded
    if (!found) {
      found = USUARIOS_INIT.find(u => u.usuario === usuario && u.password === password);
    }

    if (!found) { setErr("Credenciales incorrectas."); setLoading(false); return; }
    if (found.rol !== "admin") { setErr("Acceso restringido a administradores."); setLoading(false); return; }

    onLogin(found);
    setLoading(false);
  }

  return (
    <div style={{
      minHeight: "100vh", background: C.bg, display: "flex",
      alignItems: "center", justifyContent: "center", fontFamily: font,
    }}>
      <div style={{
        width: 380, background: C.card,
        border: `1px solid ${C.border}`, borderRadius: 16,
        padding: "36px 32px",
        boxShadow: "0 24px 80px rgba(0,0,0,.6)",
        animation: "planning-fadein .3s ease both",
      }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: "linear-gradient(135deg,#1a0d2e,#2d1f5e)",
            border: "1px solid #7c3aed44",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 26, margin: "0 auto 14px",
          }}>
            🗺️
          </div>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: 3, textTransform: "uppercase" }}>FleetComms</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginTop: 4 }}>Planning</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Acceso exclusivo para administradores</div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 10, color: C.muted, letterSpacing: 2.5, textTransform: "uppercase", display: "block", marginBottom: 7, fontWeight: 500 }}>
            Usuario
          </label>
          <input
            value={usuario} onChange={e => setUsuario(e.target.value)}
            placeholder="usuario" autoComplete="username"
            onKeyDown={e => e.key === "Enter" && go()}
            style={{
              width: "100%", background: "#0a1020", border: `1px solid ${usuario ? "#7c3aed44" : C.border}`,
              color: C.text, padding: "11px 14px", borderRadius: 9, fontSize: 13,
              boxSizing: "border-box", fontFamily: font, outline: "none", transition: "border-color .15s",
            }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 10, color: C.muted, letterSpacing: 2.5, textTransform: "uppercase", display: "block", marginBottom: 7, fontWeight: 500 }}>
            Contraseña
          </label>
          <input
            value={password} onChange={e => setPassword(e.target.value)}
            type="password" placeholder="••••••••" autoComplete="current-password"
            onKeyDown={e => e.key === "Enter" && go()}
            style={{
              width: "100%", background: "#0a1020", border: `1px solid ${password ? "#7c3aed44" : C.border}`,
              color: C.text, padding: "11px 14px", borderRadius: 9, fontSize: 13,
              boxSizing: "border-box", fontFamily: font, outline: "none", transition: "border-color .15s",
            }}
          />
        </div>

        {err && (
          <div style={{
            background: "#1a0008", border: "1px solid #ff4d6d33",
            color: C.red, borderRadius: 8, padding: "10px 14px",
            fontSize: 12, marginBottom: 16, display: "flex", alignItems: "center", gap: 8,
          }}>
            <span>⚠</span> {err}
          </div>
        )}

        <button
          onClick={go} disabled={loading}
          style={{
            width: "100%", padding: 13, fontSize: 14, fontWeight: 700,
            background: loading ? "#1a0d2e" : "linear-gradient(135deg,#2d1f5e,#1a0d2e)",
            border: "1px solid #7c3aed66", color: "#a78bfa",
            borderRadius: 9, cursor: loading ? "wait" : "pointer",
            fontFamily: font, letterSpacing: .5, transition: "all .15s",
            boxShadow: loading ? "none" : "0 4px 20px #7c3aed22",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          {loading
            ? <><span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid #7c3aed33", borderTopColor: "#a78bfa", borderRadius: "50%", animation: "planning-spin .6s linear infinite" }} /> Accediendo…</>
            : "Acceder →"
          }
        </button>

        <div style={{ marginTop: 20, background: "#0a1020", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ fontSize: 9, color: C.dim, letterSpacing: 3, marginBottom: 8, textTransform: "uppercase", fontWeight: 500 }}>Acceso de prueba</div>
          <div
            onClick={() => { setUsuario("admin"); setPassword("admin123"); }}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", padding: "4px 0", transition: "opacity .15s" }}
            onMouseEnter={e => e.currentTarget.style.opacity = ".7"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}
          >
            <span style={{ fontSize: 12, color: "#a78bfa", fontFamily: mono }}>admin</span>
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
      const s = localStorage.getItem("fc_planning_session");
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });

  function handleLogin(user) {
    setSesion(user);
    localStorage.setItem("fc_planning_session", JSON.stringify(user));
  }

  function handleLogout() {
    setSesion(null);
    localStorage.removeItem("fc_planning_session");
  }

  if (!sesion || sesion.rol !== "admin") {
    return <LoginPlanning onLogin={handleLogin} />;
  }

  return <PlanningPage sesion={sesion} onLogout={handleLogout} />;
}
