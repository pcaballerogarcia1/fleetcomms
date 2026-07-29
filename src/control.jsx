import { useState, useEffect, useRef, useMemo, memo } from "react";
import { db } from "./firebase.js";
import { collection, query, where, onSnapshot, getDocs, limit } from "firebase/firestore";
import { useLang, t } from "./i18n.js";

const C = {
  bg: "#0f1623", card: "#172035", surface2: "#1e2d48",
  border: "rgba(88,130,225,0.22)", border2: "rgba(88,130,225,0.40)",
  text: "#e2eeff", muted: "#8aa5cc", dim: "#4a5f82",
  blue: "#5c9bff", green: "#34d399", orange: "#fb923c", red: "#f87171",
};
const font = '"Inter","Segoe UI",system-ui,sans-serif';
const mono = '"JetBrains Mono","Fira Mono",monospace';

const BARRIO_PALETTE = [
  "#4f8ef7","#34d399","#fb923c","#f87171",
  "#a78bfa","#fbbf24","#f472b6","#22d3ee","#818cf8","#4ade80",
];
const _bc = {};
function barrioColor(b) {
  if (!b) return "#8b95a5";
  if (_bc[b]) return _bc[b];
  let h = 0;
  for (let i = 0; i < b.length; i++) h = (h * 31 + b.charCodeAt(i)) >>> 0;
  return (_bc[b] = BARRIO_PALETTE[h % BARRIO_PALETTE.length]);
}

function timeAgo(ts) {
  if (!ts) return "";
  const ms = typeof ts === "number" ? ts : (ts?.toMillis?.() ?? 0);
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "Ahora mismo";
  if (d < 3600) return `Hace ${Math.floor(d / 60)}min`;
  if (d < 86400) return `Hace ${Math.floor(d / 3600)}h`;
  return `Hace ${Math.floor(d / 86400)}d`;
}

function fmtMes(k) {
  try { return new Date(k + "-01").toLocaleDateString("es-ES", { month: "long", year: "numeric" }); }
  catch { return k; }
}

function userName(uid, usuarios) {
  const u = usuarios.find(x => x._id === uid || x.id === uid);
  if (!u) return uid?.slice(0, 6) ?? "?";
  return `${u.nombre ?? ""} ${(u.apellidos ?? "")[0] ?? ""}`.trim() || uid?.slice(0, 6);
}

// Haversine distance in km
function haversineKm(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return 0;
  const R = 6371, toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── ALERTAS DE FLOTA ────────────────────────────────────────────────
// A partir de la posición en vivo de un conductor (ubicaciones_activas) y
// el plan de hoy al que está vinculado (planId, ver App.jsx.jsx), calcula
// dos alertas sin necesitar sensores ni hardware adicional:
//  · parada: lleva parado más de UMBRAL_PARADA_MS y no está cerca de
//    ninguna parada pendiente de su plan — puede ser una parada no
//    programada (avería, descanso fuera de sitio, desvío).
//  · zona: su posición actual queda fuera del área que cubren las paradas
//    de su plan de hoy (con un margen), como un geofence calculado sobre
//    la marcha en vez de dibujado a mano.
const UMBRAL_PARADA_MS = 10 * 60 * 1000;  // 10 min parado sin estar en una parada programada
const RADIO_PARADA_KM  = 0.15;             // 150m — se considera "en la parada" dentro de este radio
const MARGEN_ZONA_KM   = 1.5;              // margen alrededor del área de las paradas del plan

function computeFleetAlerts(driver, planes, now) {
  const plan = driver.planId ? planes.find(p => p._id === driver.planId) : null;
  if (!plan || !driver.lat || !driver.lng) return { parada: false, zona: false, distanciaParada: null };

  const stops = (plan.ubicaciones || []).filter(u => u.lat && u.lng);
  const pendientes = stops.filter(u => !u.realizado);

  const distanciaParada = pendientes.length
    ? Math.min(...pendientes.map(s => haversineKm(driver.lat, driver.lng, s.lat, s.lng)))
    : null;
  const stationaryMs = now - (driver.lastMovedAt || driver.updatedAt || now);
  const parada = stationaryMs > UMBRAL_PARADA_MS && (distanciaParada === null || distanciaParada > RADIO_PARADA_KM);

  let zona = false;
  if (stops.length > 0) {
    const lats = stops.map(s => s.lat), lngs = stops.map(s => s.lng);
    const minLat = Math.min(...lats) , maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    // Margen en grados — aproximación suficiente a esta escala (no cruza el ecuador/meridiano 180)
    const dLat = MARGEN_ZONA_KM / 111;
    const dLng = MARGEN_ZONA_KM / (111 * Math.cos(((minLat + maxLat) / 2) * Math.PI / 180) || 1);
    zona = driver.lat < minLat - dLat || driver.lat > maxLat + dLat
        || driver.lng < minLng - dLng || driver.lng > maxLng + dLng;
  }

  return { parada, zona, distanciaParada };
}

// ── LEAFLET MINI-MAP (read-only, updates on ubicaciones change) ────
// Stops are drawn on a single canvas overlay instead of one Leaflet DOM
// marker per stop — with hundreds of paradas, recreating a DOM divIcon for
// every point on every real-time update (one driver check-in = full rebuild)
// was the main source of lag. The map is read-only (no marker click/popup),
// so canvas has no functional downside here.
function MapaControl({ ubicaciones, recorrido, height = 280 }) {
  const divRef      = useRef(null);
  const mapRef      = useRef(null);
  const polyRef      = useRef(null);
  const canvasRef    = useRef(null); // { canvas, draw }

  function ensureLeaflet(cb) {
    if (!document.getElementById("leaflet-css")) {
      const css = document.createElement("link");
      css.id = "leaflet-css"; css.rel = "stylesheet";
      css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(css);
    }
    if (window.L) { cb(); return; }
    const js = document.createElement("script");
    js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    js.onload = cb;
    document.head.appendChild(js);
  }

  function drawLayers() {
    const L = window.L;
    if (!L || !mapRef.current) return;
    const map = mapRef.current;

    if (polyRef.current) { try { map.removeLayer(polyRef.current); } catch {} polyRef.current = null; }
    if (recorrido && recorrido.length > 1) {
      const ll = recorrido.map(p => Array.isArray(p) ? p : [p.lat, p.lng]);
      polyRef.current = L.polyline(ll, { color: "#1e3a5f", weight: 2, opacity: 0.6, dashArray: "6,4" }).addTo(map);
    }

    if (canvasRef.current) {
      const { canvas, draw } = canvasRef.current;
      try { map.off("moveend zoomend viewreset resize", draw); } catch {}
      try { canvas.remove(); } catch {}
      canvasRef.current = null;
    }

    const pts = (ubicaciones || []).filter(u => u.lat && u.lng);
    if (pts.length === 0) return;

    const showLabels = pts.length <= 300; // order number inside the dot — skip when it'd just be visual noise
    const packed = pts.map(u => ({
      lat: u.lat, lng: u.lng, orden: u.orden,
      done: !!u.realizado,
      color: u.realizado ? C.green : barrioColor(u.barri),
    }));

    const PAD = 60;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;pointer-events:none;";
    map.getPanes().overlayPane.appendChild(canvas);

    function draw() {
      if (!canvas.parentNode || !mapRef.current) return;
      const sz = map.getSize();
      const topLeft = map.containerPointToLayerPoint([-PAD, -PAD]);
      L.DomUtil.setPosition(canvas, topLeft);
      canvas.width  = sz.x + 2 * PAD;
      canvas.height = sz.y + 2 * PAD;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      packed.forEach(p => {
        const cp = map.latLngToContainerPoint([p.lat, p.lng]);
        const x = cp.x + PAD, y = cp.y + PAD;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = p.done ? "#ffffff88" : p.color + "55";
        ctx.stroke();
        if (showLabels) {
          ctx.fillStyle = "#fff";
          ctx.font = `800 8px ${mono}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(p.orden ?? ""), x, y + 0.5);
        }
      });
    }

    draw();
    map.on("moveend zoomend viewreset resize", draw);
    canvasRef.current = { canvas, draw };

    map.invalidateSize();
    map.fitBounds(pts.map(u => [u.lat, u.lng]), { padding: [16, 16] });
  }

  function initMap() {
    if (!divRef.current || mapRef.current) return;
    const L = window.L;
    const pts = (ubicaciones || []).filter(u => u.lat && u.lng);
    const center = pts.length > 0 ? [pts[0].lat, pts[0].lng] : [39.57, 2.65];
    const map = L.map(divRef.current, { zoomControl: false, attributionControl: false }).setView(center, 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
    mapRef.current = map;
    drawLayers();
  }

  useEffect(() => {
    ensureLeaflet(() => {
      if (!mapRef.current) initMap();
      else drawLayers();
    });
  }, [ubicaciones]);

  // Destroy map instance on unmount to avoid canvas leaks
  useEffect(() => () => {
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
  }, []);

  return (
    <div style={{ borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}` }}>
      <div ref={divRef} style={{ height, background: "#131e35" }} />
      <div style={{ background: C.card, padding: "6px 12px", display: "flex", gap: 14, borderTop: `1px solid ${C.border}` }}>
        {[[C.green, "Realizada"], ["#8b95a5", "Pendiente"]].map(([color, label]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
            <span style={{ fontSize: 10, color: C.muted }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── FLEET MAP (live position of every driver currently sharing location) ──
const DRIVER_STALE_MS = 3 * 60 * 1000;   // grey out / "desconectado" past this
const DRIVER_WARN_MS  = 90 * 1000;        // amber past this

if (typeof document !== "undefined" && !document.getElementById("control-styles")) {
  const s = document.createElement("style");
  s.id = "control-styles";
  s.textContent = `@keyframes control-pulse{0%{box-shadow:0 0 0 0 rgba(248,113,113,0.55)}70%{box-shadow:0 0 0 10px rgba(248,113,113,0)}100%{box-shadow:0 0 0 0 rgba(248,113,113,0)}}`;
  document.head.appendChild(s);
}

function MapaFlota({ orgId, isSuperAdmin, planes }) {
  const divRef      = useRef(null);
  const mapRef      = useRef(null);
  const markersRef  = useRef(new Map()); // uid -> Leaflet marker
  const firstFitRef = useRef(false);
  const [drivers, setDrivers] = useState([]);
  // "now" congelado en estado (no Date.now() directo en el render, que React
  // considera impuro) — se refresca cada 30s para que los marcadores y las
  // alertas envejezcan aunque no llegue ninguna escritura nueva.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!orgId && !isSuperAdmin) return;
    const col = collection(db, "ubicaciones_activas");
    const q = orgId ? query(col, where("org_id", "==", orgId)) : col;
    return onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
      console.log("[flota] ubicaciones_activas:", docs.length, "docs", docs);
      setDrivers(docs);
    }, e => console.error("[flota] error leyendo ubicaciones_activas:", e));
  }, [orgId, isSuperAdmin]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  function ensureLeaflet(cb) {
    if (!document.getElementById("leaflet-css")) {
      const css = document.createElement("link");
      css.id = "leaflet-css"; css.rel = "stylesheet";
      css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(css);
    }
    if (window.L) { cb(); return; }
    const js = document.createElement("script");
    js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    js.onload = cb;
    document.head.appendChild(js);
  }

  function initMap() {
    if (!divRef.current || mapRef.current) return;
    const L = window.L;
    const map = L.map(divRef.current, { zoomControl: true, attributionControl: false }).setView([39.57, 2.65], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
    mapRef.current = map;
  }

  function drawDrivers() {
    const L = window.L;
    if (!L || !mapRef.current) return;
    const map = mapRef.current;
    const seen = new Set();

    drivers.forEach(d => {
      if (!d.lat || !d.lng) return;
      seen.add(d.uid);
      const age   = now - (d.updatedAt || 0);
      const stale = age > DRIVER_STALE_MS;
      const alerts = stale ? { parada: false, zona: false } : computeFleetAlerts(d, planes || [], now);
      const alerted = alerts.parada || alerts.zona;

      const color = alerted ? C.red : stale ? C.dim : age > DRIVER_WARN_MS ? C.orange : C.green;
      const sufijo = stale ? " · desconectado"
        : alerts.parada && alerts.zona ? " · parada + fuera de zona"
        : alerts.parada ? " · parada sin programar"
        : alerts.zona ? " · fuera de zona"
        : "";
      const label = `${d.nombre || "?"}${sufijo}`;
      const pulse = alerted ? "animation:control-pulse 1.6s infinite;" : "";

      const html = `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none;">
        <div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.5);${pulse}"></div>
        <div style="margin-top:3px;padding:2px 7px;border-radius:5px;background:${alerted ? "rgba(248,113,113,0.15)" : C.card};border:1px solid ${alerted ? C.red : C.border};color:${alerted ? "#fff" : C.text};font-size:10px;font-weight:600;font-family:${font};white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.4);">${label}</div>
      </div>`;
      const icon = L.divIcon({ className: "", html, iconSize: [16, 16], iconAnchor: [8, 8] });

      const existing = markersRef.current.get(d.uid);
      if (existing) {
        existing.setLatLng([d.lat, d.lng]);
        existing.setIcon(icon);
      } else {
        markersRef.current.set(d.uid, L.marker([d.lat, d.lng], { icon }).addTo(map));
      }
    });

    for (const [uid, marker] of markersRef.current.entries()) {
      if (!seen.has(uid)) { map.removeLayer(marker); markersRef.current.delete(uid); }
    }

    if (!firstFitRef.current) {
      const pts = drivers.filter(d => d.lat && d.lng).map(d => [d.lat, d.lng]);
      if (pts.length > 0) {
        firstFitRef.current = true;
        map.fitBounds(pts, { padding: [50, 50], maxZoom: 14 });
      }
    }
  }

  useEffect(() => {
    ensureLeaflet(() => { if (!mapRef.current) initMap(); drawDrivers(); });
  }, [drivers, now, planes]);

  useEffect(() => () => {
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
  }, []);

  const activeCount = drivers.filter(d => now - (d.updatedAt || 0) < DRIVER_STALE_MS).length;

  const alertedDrivers = useMemo(() => {
    return drivers
      .filter(d => now - (d.updatedAt || 0) < DRIVER_STALE_MS)
      .map(d => ({ d, alerts: computeFleetAlerts(d, planes || [], now) }))
      .filter(x => x.alerts.parada || x.alerts.zona);
  }, [drivers, planes, now]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: C.muted }}>
          <span style={{ color: C.green, fontWeight: 700, fontFamily: mono }}>{activeCount}</span>{" "}
          conductor{activeCount !== 1 ? "es" : ""} compartiendo ubicación ahora
        </span>
        {alertedDrivers.length > 0 && (
          <span style={{ fontSize: 12, color: C.red, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.red, animation: "control-pulse 1.6s infinite" }} />
            <span style={{ fontWeight: 700, fontFamily: mono }}>{alertedDrivers.length}</span> alerta{alertedDrivers.length !== 1 ? "s" : ""} activa{alertedDrivers.length !== 1 ? "s" : ""}
          </span>
        )}
        {drivers.length === 0 && (
          <span style={{ fontSize: 11, color: C.dim }}>Nadie está compartiendo ubicación todavía — se activa al entrar en Rutas y aceptar el permiso</span>
        )}
      </div>

      {alertedDrivers.length > 0 && (
        <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", flexWrap: "wrap", gap: 8, flexShrink: 0, background: "rgba(248,113,113,0.05)" }}>
          {alertedDrivers.map(({ d, alerts }) => {
            const stationaryMin = Math.round((now - (d.lastMovedAt || d.updatedAt || now)) / 60000);
            const motivos = [
              alerts.parada && `parado ${stationaryMin} min fuera de una parada programada`,
              alerts.zona && "fuera de la zona de su ruta",
            ].filter(Boolean).join(" · ");
            return (
              <div key={d.uid} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "5px 10px",
                background: C.card, border: `1px solid ${C.red}55`, borderRadius: 7,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.red, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>{d.nombre || "?"}</span>
                <span style={{ fontSize: 10, color: C.muted }}>{motivos}</span>
              </div>
            );
          })}
        </div>
      )}

      <div ref={divRef} style={{ flex: 1, background: "#131e35" }} />
    </div>
  );
}

// ── FICHAJES PANEL ────────────────────────────────────────────────
function fmtHoraF(ts) { return ts ? new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "—"; }
function fmtFecha(f) { try { return new Date(f + "T00:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }); } catch { return f; } }
function fmtDur(ms) {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${String(m).padStart(2, "0")}min`;
}

function PanelFichajes({ orgId, isSuperAdmin, usuarios }) {
  const [fichajes, setFichajes] = useState([]);
  const [mesFilter, setMesFilter] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  });
  const [vistaFichajes, setVistaFichajes] = useState("calendario"); // calendario | tabla
  const [diaSeleccionado, setDiaSeleccionado] = useState(null); // "YYYY-MM-DD" | null

  useEffect(() => {
    if (!orgId && !isSuperAdmin) return;
    const col = collection(db, "fichajes");
    const q = orgId ? query(col, where("org_id", "==", orgId), limit(500)) : query(col, limit(500));
    return onSnapshot(q, snap => {
      setFichajes(snap.docs.map(d => ({ _id: d.id, ...d.data() })));
    }, e => console.error("[fichajes] error leyendo:", e));
  }, [orgId, isSuperAdmin]);

  const meses = useMemo(() =>
    [...new Set(fichajes.map(f => f.fecha?.slice(0, 7)).filter(Boolean))].sort((a, b) => b.localeCompare(a)),
    [fichajes]
  );

  const delMes = useMemo(() =>
    fichajes.filter(f => f.fecha?.startsWith(mesFilter)).sort((a, b) => (b.horaEntrada || 0) - (a.horaEntrada || 0)),
    [fichajes, mesFilter]
  );

  // Fila visible en la tabla: si hay un día del calendario seleccionado, solo ese día
  const filasTabla = useMemo(() =>
    diaSeleccionado ? delMes.filter(f => f.fecha === diaSeleccionado) : delMes,
    [delMes, diaSeleccionado]
  );

  // Días del mes con al menos un fichaje, con su recuento y si alguno sigue abierto
  const porDia = useMemo(() => {
    const map = {};
    delMes.forEach(f => {
      if (!f.fecha) return;
      if (!map[f.fecha]) map[f.fecha] = { count: 0, abierto: false };
      map[f.fecha].count++;
      if (f.estado === "abierto") map[f.fecha].abierto = true;
    });
    return map;
  }, [delMes]);

  const abiertosAhora = useMemo(() => fichajes.filter(f => f.estado === "abierto"), [fichajes]);

  const stats = useMemo(() => {
    let ms = 0, km = 0;
    delMes.forEach(f => {
      if (f.horaSalida) ms += f.horaSalida - f.horaEntrada;
      km += f.kmRecorridos || 0;
    });
    return { horas: fmtDur(ms), km: km.toFixed(0), registros: delMes.length };
  }, [delMes]);

  function nombreDe(f) { return f.nombre || userName(f.uid, usuarios); }

  function exportarExcel() {
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Conductor", "Matrícula", "Fecha", "Entrada", "Salida", "Duración", "Km inicio", "Km fin", "Km recorridos", "Estado"];
    const rows = delMes.map(f => [
      nombreDe(f), f.matricula ?? "", f.fecha, fmtHoraF(f.horaEntrada), fmtHoraF(f.horaSalida),
      f.horaSalida ? fmtDur(f.horaSalida - f.horaEntrada) : "en curso",
      f.kmInicio ?? "", f.kmFin ?? "", f.kmRecorridos ?? "", f.estado,
    ]);
    const csv = "﻿" + [header, ...rows].map(r => r.map(esc).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `fichajes_${mesFilter}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select
              value={mesFilter}
              onChange={e => { setMesFilter(e.target.value); setDiaSeleccionado(null); }}
              style={{
                background: C.surface2, border: `1px solid ${C.border2}`,
                color: C.text, borderRadius: 7, padding: "5px 10px",
                fontSize: 12, fontFamily: font, cursor: "pointer", outline: "none",
              }}
            >
              {!meses.includes(mesFilter) && <option value={mesFilter}>{fmtMes(mesFilter)}</option>}
              {meses.map(m => <option key={m} value={m}>{fmtMes(m)}</option>)}
            </select>
            <div style={{ display: "flex", gap: 2, background: C.surface2, borderRadius: 7, padding: 2 }}>
              {[["calendario", "Calendario"], ["tabla", "Tabla"]].map(([k, l]) => (
                <button key={k} onClick={() => setVistaFichajes(k)} style={{
                  padding: "4px 10px", borderRadius: 5, border: "none", cursor: "pointer",
                  background: vistaFichajes === k ? C.blue : "none",
                  color: vistaFichajes === k ? "#fff" : C.muted,
                  fontSize: 11, fontWeight: vistaFichajes === k ? 600 : 400, fontFamily: font,
                  transition: "all .12s",
                }}>{l}</button>
              ))}
            </div>
          </div>
          <button
            onClick={exportarExcel}
            disabled={delMes.length === 0}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)",
              color: C.green, borderRadius: 7, padding: "5px 12px",
              fontSize: 12, fontWeight: 600, cursor: delMes.length === 0 ? "not-allowed" : "pointer",
              opacity: delMes.length === 0 ? 0.4 : 1, fontFamily: font,
            }}
          >Excel</button>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {[
            { l: "Fichados ahora", v: abiertosAhora.length, c: abiertosAhora.length > 0 ? C.green : C.dim },
            { l: "Registros del mes", v: stats.registros, c: C.blue },
            { l: "Horas del mes", v: stats.horas, c: C.muted },
            { l: "Km del mes", v: stats.km, c: C.orange },
          ].map(s => (
            <div key={s.l} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 14px", flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.c, fontFamily: mono, lineHeight: 1 }}>{s.v}</div>
              <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {vistaFichajes === "calendario" ? (
          <div style={{ padding: "14px 16px" }}>
            <CalendarioFichajes mesFilter={mesFilter} porDia={porDia} diaSeleccionado={diaSeleccionado} onSelectDia={setDiaSeleccionado} />
            {diaSeleccionado && (
              <div style={{ marginTop: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>
                    {fmtFecha(diaSeleccionado)} · {filasTabla.length} fichaje{filasTabla.length !== 1 ? "s" : ""}
                  </div>
                  <button onClick={() => setDiaSeleccionado(null)} style={{ background: "none", border: "none", color: C.dim, fontSize: 11, cursor: "pointer", fontFamily: font }}>
                    ver todo el mes
                  </button>
                </div>
                {filasTabla.length === 0 ? (
                  <div style={{ color: C.dim, fontSize: 13, textAlign: "center", padding: "30px 0" }}>Sin fichajes este día</div>
                ) : (
                  <TablaFichajes rows={filasTabla} nombreDe={nombreDe} />
                )}
              </div>
            )}
          </div>
        ) : (
          filasTabla.length === 0 ? (
            <div style={{ color: C.dim, fontSize: 13, textAlign: "center", padding: "60px 0" }}>
              Sin fichajes este mes
            </div>
          ) : (
            <TablaFichajes rows={filasTabla} nombreDe={nombreDe} />
          )
        )}
      </div>
    </div>
  );
}

// ── TABLA DE FICHAJES (reutilizada por la vista tabla y el detalle del día) ──
function TablaFichajes({ rows, nombreDe }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ position: "sticky", top: 0, background: C.card, zIndex: 1 }}>
          {["Conductor", "Matrícula", "Fecha", "Entrada", "Salida", "Duración", "Km inicio", "Km fin", "Km recorridos", ""].map(h => (
            <th key={h} style={{ textAlign: "left", padding: "8px 14px", color: C.dim, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", borderBottom: `1px solid ${C.border}`, fontWeight: 600 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(f => (
          <tr key={f._id} style={{ borderBottom: `1px solid ${C.border}` }}>
            <td style={{ padding: "8px 14px", color: C.text, fontWeight: 600 }}>{nombreDe(f)}</td>
            <td style={{ padding: "8px 14px", color: C.muted, fontFamily: mono }}>{f.matricula || "—"}</td>
            <td style={{ padding: "8px 14px", color: C.muted }}>{fmtFecha(f.fecha)}</td>
            <td style={{ padding: "8px 14px", color: C.muted, fontFamily: mono }}>{fmtHoraF(f.horaEntrada)}</td>
            <td style={{ padding: "8px 14px", color: C.muted, fontFamily: mono }}>{fmtHoraF(f.horaSalida)}</td>
            <td style={{ padding: "8px 14px", color: C.muted }}>{f.horaSalida ? fmtDur(f.horaSalida - f.horaEntrada) : "—"}</td>
            <td style={{ padding: "8px 14px", color: C.dim, fontFamily: mono }}>{f.kmInicio ?? "—"}</td>
            <td style={{ padding: "8px 14px", color: C.dim, fontFamily: mono }}>{f.kmFin ?? "—"}</td>
            <td style={{ padding: "8px 14px", color: C.orange, fontFamily: mono, fontWeight: 600 }}>{f.kmRecorridos ?? "—"}</td>
            <td style={{ padding: "8px 14px" }}>
              {f.estado === "abierto" && (
                <span style={{ fontSize: 10, color: C.green, background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 4, padding: "2px 7px" }}>en curso</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── CALENDARIO DE FICHAJES ───────────────────────────────────────────
const DIAS_SEMANA_CORTO = ["L", "M", "X", "J", "V", "S", "D"];

function CalendarioFichajes({ mesFilter, porDia, diaSeleccionado, onSelectDia }) {
  const [y, m] = mesFilter.split("-").map(Number);
  const firstWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7; // lunes=0
  const daysInMonth = new Date(y, m, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${mesFilter}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 4 }}>
        {DIAS_SEMANA_CORTO.map(d => (
          <div key={d} style={{ textAlign: "center", fontSize: 10, color: C.dim, fontWeight: 600, padding: "4px 0" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} />;
          const info = porDia[day];
          const isToday = day === todayStr;
          const isSelected = day === diaSeleccionado;
          const dayNum = +day.slice(-2);
          return (
            <button
              key={day}
              onClick={() => onSelectDia(isSelected ? null : day)}
              style={{
                aspectRatio: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 3, borderRadius: 8, cursor: "pointer", fontFamily: font, padding: 0,
                background: isSelected ? C.blueDim : info ? C.card : "transparent",
                border: `1px solid ${isSelected ? C.blue : isToday ? C.border2 : info ? C.border : "transparent"}`,
                color: isSelected ? C.blueText : info ? C.text : C.dim,
                transition: "all .12s",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: isToday ? 700 : 400 }}>{dayNum}</span>
              {info && (
                <span style={{
                  fontSize: 9, fontFamily: mono, fontWeight: 700,
                  color: info.abierto ? C.green : (isSelected ? C.blueText : C.muted),
                }}>
                  {info.abierto ? "● en curso" : `${info.count} fich.`}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── PLAN CARD ─────────────────────────────────────────────────────
const PlanCard = memo(function PlanCard({ plan, selected, onSelect }) {
  const ubs   = plan.ubicaciones || [];
  const total = ubs.length;
  const done  = ubs.filter(u => u.realizado).length;
  const pct   = total > 0 ? Math.round(done / total * 100) : 0;
  const color = pct === 100 ? C.green : pct > 50 ? C.blue : pct > 0 ? C.orange : C.dim;

  return (
    <div
      onClick={() => onSelect(plan._id === selected ? null : plan._id)}
      style={{
        background: selected ? C.surface2 : C.card,
        border: `1px solid ${selected ? C.blue + "55" : C.border}`,
        borderRadius: 10, padding: "12px 14px", cursor: "pointer",
        transition: "all .15s", marginBottom: 8,
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.borderColor = C.border2; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = C.border; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {plan.nombre || plan.archivo || "Plan"}
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
            {[plan.turno, plan.diaServicio, plan.mes].filter(Boolean).join(" · ")}
          </div>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: mono, marginLeft: 8, flexShrink: 0 }}>
          {pct}%
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: C.surface2, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2, transition: "width .5s" }} />
      </div>

      <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
        {[
          { l: "Total",  v: total,        c: C.muted   },
          { l: "Hechas", v: done,          c: C.green   },
          { l: "Pend.",  v: total - done,  c: total - done > 0 ? C.orange : C.dim },
        ].map(s => (
          <div key={s.l} style={{ fontSize: 10, color: s.c, fontFamily: mono }}>
            <span style={{ fontWeight: 700 }}>{s.v}</span>
            <span style={{ color: C.dim, marginLeft: 3 }}>{s.l}</span>
          </div>
        ))}
      </div>
    </div>
  );
});

// ── ACTIVITY FEED ─────────────────────────────────────────────────
function ActivityFeed({ events, usuarios }) {
  if (events.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: C.dim, fontSize: 13 }}>
        Sin actividad registrada
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {events.map((ev, i) => (
        <div key={i} style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderLeft: `3px solid ${C.green}`, borderRadius: 8, padding: "9px 12px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                {ev.calle ? `${ev.calle}${ev.num ? " " + ev.num : ""}` : (ev.pa || `Parada ${ev.orden}`)}
              </div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                {ev.planNombre}{ev.barri ? ` · ${ev.barri}` : ""}
              </div>
              {ev.nota && (
                <div style={{ fontSize: 10, color: C.dim, marginTop: 3, fontStyle: "italic" }}>"{ev.nota}"</div>
              )}
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 10, color: C.green, fontWeight: 600 }}>{timeAgo(ev.realizadoEn)}</div>
              <div style={{ fontSize: 10, color: C.dim, marginTop: 1 }}>{userName(ev.realizadoPor, usuarios)}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── MAIN PAGE ──────────────────────────────────────────────────────
export function ControlPage({ sesion, orgId: orgIdProp, embedded = false }) {
  const lang = useLang();
  const orgId = orgIdProp ?? sesion?.org_id ?? null;
  const isSuperAdmin = sesion?.rol === "superadmin";

  const [planes,      setPlanes]      = useState([]);
  const [usuarios,    setUsuarios]    = useState([]);
  const [selectedId,  setSelectedId]  = useState(null);
  const [mesesDisponibles, setMesesDisponibles] = useState([]);
  const [vista, setVista] = useState("planes"); // planes | flota
  const PAGE_SIZE = 60;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const now    = new Date();
  const curMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [mesFilter, setMesFilter] = useState(curMes);
  const PLANES_QUERY_LIMIT = 300;
  const [planesCapped, setPlanesCapped] = useState(false);

  // Real-time: planes — scoped to the selected month when one is chosen (the
  // common case) so we don't stream every plan ever created for the org on
  // every stop check-in. docChanges() keeps object refs stable for unchanged
  // plans, so the map/feed only re-render for the plan that actually changed.
  // limit() bounds how many full documents (each carrying an ubicaciones
  // array) Firestore has to fetch + the SDK has to decode every time this
  // listener (re)connects — without it, a month with 1000+ plans took ~11s
  // to show ANYTHING every single time you switched away from Control and
  // back, because the whole set was re-downloaded and re-decoded from
  // scratch on every mount.
  useEffect(() => {
    if (!orgId && !isSuperAdmin) return;
    const col = collection(db, "planes");
    const filters = [];
    if (orgId) filters.push(where("org_id", "==", orgId));
    if (mesFilter) filters.push(where("mes", "==", mesFilter));
    const q = query(col, ...filters, limit(PLANES_QUERY_LIMIT));
    const cache = new Map();
    return onSnapshot(q, snap => {
      snap.docChanges().forEach(change => {
        if (change.type === "removed") cache.delete(change.doc.id);
        else cache.set(change.doc.id, { _id: change.doc.id, ...change.doc.data() });
      });
      setPlanesCapped(snap.size >= PLANES_QUERY_LIMIT);
      setPlanes([...cache.values()]);
    });
  }, [orgId, isSuperAdmin, mesFilter]);

  // One-time (not real-time) fetch of which months have plans, to populate the
  // month picker without keeping a permanent listener on the whole org's history.
  useEffect(() => {
    if (!orgId && !isSuperAdmin) return;
    const col = collection(db, "planes");
    const filters = orgId ? [where("org_id", "==", orgId)] : [];
    const q = query(col, ...filters, limit(500));
    getDocs(q).then(snap => {
      const set = new Set();
      snap.docs.forEach(d => { const m = d.data().mes; if (m) set.add(m); });
      setMesesDisponibles([...set]);
    }).catch(() => {});
  }, [orgId, isSuperAdmin]);

  // Real-time: usuarios (for name resolution)
  useEffect(() => {
    if (!orgId && !isSuperAdmin) return;
    const col = collection(db, "usuarios");
    const q = orgId ? query(col, where("org_id", "==", orgId)) : col;
    return onSnapshot(q, snap => {
      setUsuarios(snap.docs.map(d => ({ _id: d.id, id: d.id, ...d.data() })));
    });
  }, [orgId, isSuperAdmin]);

  // Available months
  const meses = useMemo(() =>
    [...mesesDisponibles].sort((a, b) => b.localeCompare(a)),
    [mesesDisponibles]
  );

  // Planes filtered by month (exclude correctivos — they have no ubicaciones map)
  const filteredPlanes = useMemo(() =>
    planes.filter(p => p.tipo !== "corr" && (!mesFilter || p.mes === mesFilter))
      .sort((a, b) => (b.fechaSubida ?? 0) - (a.fechaSubida ?? 0)),
    [planes, mesFilter]
  );

  // Global stats
  const stats = useMemo(() => {
    const total = filteredPlanes.reduce((s, p) => s + (p.ubicaciones?.length || 0), 0);
    const done  = filteredPlanes.reduce((s, p) => s + (p.ubicaciones?.filter(u => u.realizado).length || 0), 0);
    return { planes: filteredPlanes.length, total, done, pct: total > 0 ? Math.round(done / total * 100) : 0 };
  }, [filteredPlanes]);

  // Selected plan
  const activePlan = selectedId ? filteredPlanes.find(p => p._id === selectedId) : null;

  // Activity feed: built from the selected plan, or all plans of the month.
  // Dependency is deliberately a single value that IS whichever source is
  // actually relevant (activePlan when one is selected, filteredPlanes
  // otherwise) — not both. Depending on both would recompute this on every
  // write to ANY plan in the month even while looking at one specific plan,
  // since filteredPlanes gets a new array reference on every such write.
  // That was rebuilding (and re-sorting) the whole events list — every stop
  // of the plan — on updates that had nothing to do with the open plan.
  const activityEvents = useMemo(() => {
    const source = activePlan ? [activePlan] : filteredPlanes;
    const events = [];
    source.forEach(plan => {
      (plan.ubicaciones || []).forEach(u => {
        if (u.realizado && u.realizadoEn) {
          events.push({ ...u, planNombre: plan.nombre || plan.archivo || "Plan" });
        }
      });
    });
    return events.sort((a, b) => b.realizadoEn - a.realizadoEn).slice(0, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlan ?? filteredPlanes]);

  const hasMapa = activePlan && (activePlan.ubicaciones || []).some(u => u.lat && u.lng);

  const pctColor = stats.pct === 100 ? C.green : stats.pct > 50 ? C.blue : stats.pct > 0 ? C.orange : C.dim;

  function exportCSV() {
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const fmtDate = ts => {
      if (!ts) return "";
      const d = new Date(typeof ts === "number" ? ts : ts.toMillis?.() ?? 0);
      return d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    };

    const header = ["Plan", "Mes", "Turno", "Orden", "Dirección", "Barrio", "Trabajador", "Fecha y hora", "Nota"];
    const rows = activityEvents.map(ev => [
      ev.planNombre,
      mesFilter || "",
      ev.turno ?? "",
      ev.orden ?? "",
      ev.calle ? `${ev.calle}${ev.num ? " " + ev.num : ""}` : (ev.pa ?? ""),
      ev.barri ?? "",
      userName(ev.realizadoPor, usuarios),
      fmtDate(ev.realizadoEn),
      ev.nota ?? "",
    ]);

    const csv = "﻿" + [header, ...rows].map(r => r.map(esc).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `control_actividad${mesFilter ? "_" + mesFilter : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: C.bg, fontFamily: font, overflow: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ padding: "14px 20px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase", fontWeight: 700 }}>
            Control · tiempo real
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 2, background: C.surface2, borderRadius: 7, padding: 2 }}>
              {[["planes", t("planes", lang)], ["flota", t("mapaFlota", lang)], ["fichajes", t("fichajes", lang)]].map(([k, l]) => (
                <button key={k} onClick={() => setVista(k)} style={{
                  padding: "5px 11px", borderRadius: 5, border: "none", cursor: "pointer",
                  background: vista === k ? C.blue : "none",
                  color: vista === k ? "#fff" : C.muted,
                  fontSize: 11, fontWeight: vista === k ? 600 : 400, fontFamily: font,
                  transition: "all .12s",
                }}>{l}</button>
              ))}
            </div>
            <select
              value={mesFilter}
              onChange={e => { setMesFilter(e.target.value); setSelectedId(null); setVisibleCount(PAGE_SIZE); }}
              style={{
                background: C.surface2, border: `1px solid ${C.border2}`,
                color: C.text, borderRadius: 7, padding: "5px 10px",
                fontSize: 12, fontFamily: font, cursor: "pointer", outline: "none",
              }}
            >
              <option value="">Todos los meses</option>
              {meses.map(m => <option key={m} value={m}>{fmtMes(m)}</option>)}
            </select>
            <button
              onClick={exportCSV}
              disabled={activityEvents.length === 0}
              title="Descargar actividad (.csv)"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)",
                color: C.green, borderRadius: 7, padding: "5px 12px",
                fontSize: 12, fontWeight: 600, cursor: activityEvents.length === 0 ? "not-allowed" : "pointer",
                opacity: activityEvents.length === 0 ? 0.4 : 1, fontFamily: font, transition: "all .15s",
              }}
              onMouseEnter={e => { if (activityEvents.length > 0) e.currentTarget.style.background = "rgba(52,211,153,0.16)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(52,211,153,0.08)"; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Excel
            </button>
          </div>
        </div>

        {/* Stat chips */}
        <div style={{ display: "flex", gap: 10 }}>
          {[
            { l: "Planes",           v: stats.planes, c: C.blue    },
            { l: "Paradas totales",  v: stats.total,  c: C.muted   },
            { l: "Completadas",      v: stats.done,   c: C.green   },
            { l: "Progreso global",  v: `${stats.pct}%`, c: pctColor },
          ].map(s => (
            <div key={s.l} style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
              padding: "8px 14px", flex: 1,
            }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.c, fontFamily: mono, lineHeight: 1 }}>{s.v}</div>
              <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {vista === "flota" ? (
        <MapaFlota orgId={orgId} isSuperAdmin={isSuperAdmin} planes={planes} />
        ) : vista === "fichajes" ? (
        <PanelFichajes orgId={orgId} isSuperAdmin={isSuperAdmin} usuarios={usuarios} />
        ) : (
        <>
        {/* Left: plan list */}
        <div style={{
          width: 290, flexShrink: 0, borderRight: `1px solid ${C.border}`,
          overflowY: "auto", padding: "12px 12px",
        }}>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
            {filteredPlanes.length}{planesCapped ? `+` : ""} planes
          </div>
          {planesCapped && (
            <div style={{ fontSize: 10, color: C.orange, background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.25)", borderRadius: 6, padding: "6px 8px", marginBottom: 10, lineHeight: 1.5 }}>
              Hay más de {PLANES_QUERY_LIMIT} planes este mes — se muestran los primeros {PLANES_QUERY_LIMIT}. Progreso global también es solo de estos.
            </div>
          )}
          {filteredPlanes.length === 0 && (
            <div style={{ color: C.dim, fontSize: 13, textAlign: "center", padding: "40px 0" }}>
              Sin planes para este mes
            </div>
          )}
          {filteredPlanes.slice(0, visibleCount).map(plan => (
            <PlanCard
              key={plan._id}
              plan={plan}
              selected={selectedId === plan._id}
              onSelect={setSelectedId}
            />
          ))}
          {filteredPlanes.length > visibleCount && (
            <button
              onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
              style={{
                width: "100%", padding: "9px", marginTop: 4, background: "none",
                border: `1px solid ${C.border}`, color: C.muted,
                borderRadius: 8, fontSize: 12, cursor: "pointer",
                fontFamily: font, transition: "all .15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.text; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
            >
              Cargar {Math.min(PAGE_SIZE, filteredPlanes.length - visibleCount)} más ({filteredPlanes.length - visibleCount} restantes)
            </button>
          )}
        </div>

        {/* Right: map + feed */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Mini-map (only when selected plan has geo data) */}
          {hasMapa && (
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 600 }}>
                {activePlan.nombre || activePlan.archivo}
                <span style={{ fontWeight: 400, color: C.dim, marginLeft: 8 }}>
                  {(activePlan.ubicaciones || []).filter(u => u.realizado).length} / {(activePlan.ubicaciones || []).length} paradas
                </span>
              </div>
              <MapaControl
                ubicaciones={activePlan.ubicaciones}
                recorrido={activePlan.recorrido}
                height={260}
              />
            </div>
          )}

          {/* Activity feed */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
            <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
              {selectedId ? "Actividad del plan" : "Actividad global"} · {activityEvents.length} registros
            </div>
            <ActivityFeed events={activityEvents} usuarios={usuarios} />
          </div>

        </div>
        </>
        )}
      </div>
    </div>
  );
}
