// Control de rutas por puntos: colores y utilidades (tiempos, nombres, alertas de flota).





export const C = {
  bg: "#0b0d12", card: "#12151c", surface2: "#181c25",
  border: "rgba(255,255,255,0.08)", border2: "rgba(255,255,255,0.14)",
  text: "#e6e8ee", muted: "#9aa3b2", dim: "#5d6574",
  blue: "#5b7cfa", green: "#3fcf8e", orange: "#f59e5b", red: "#f26d6d",
};

export const font = "var(--font)";
export const mono = "var(--mono)";
const BARRIO_PALETTE = [
  "#5b7cfa","#3fcf8e","#f59e5b","#f26d6d",
  "#a78bfa","#f5b84a","#f472b6","#22d3ee","#818cf8","#4ade80",
];

const _bc = {};

export function barrioColor(b) {
  if (!b) return "#9aa3b2";
  if (_bc[b]) return _bc[b];
  let h = 0;
  for (let i = 0; i < b.length; i++) h = (h * 31 + b.charCodeAt(i)) >>> 0;
  return (_bc[b] = BARRIO_PALETTE[h % BARRIO_PALETTE.length]);
}

export function timeAgo(ts) {
  if (!ts) return "";
  const ms = typeof ts === "number" ? ts : (ts?.toMillis?.() ?? 0);
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "Ahora mismo";
  if (d < 3600) return `Hace ${Math.floor(d / 60)}min`;
  if (d < 86400) return `Hace ${Math.floor(d / 3600)}h`;
  return `Hace ${Math.floor(d / 86400)}d`;
}

export function fmtMes(k) {
  try { return new Date(k + "-01").toLocaleDateString("es-ES", { month: "long", year: "numeric" }); }
  catch { return k; }
}

export function userName(uid, usuarios) {
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

export function computeFleetAlerts(driver, planes, now) {
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

// ── FLEET MAP (live position of every driver currently sharing location) ──
export const DRIVER_STALE_MS = 3 * 60 * 1000;   // grey out / "desconectado" past this

export const DRIVER_WARN_MS  = 90 * 1000;        // amber past this

if (typeof document !== "undefined" && !document.getElementById("control-styles")) {
  const s = document.createElement("style");
  s.id = "control-styles";
  s.textContent = `@keyframes control-pulse{0%{box-shadow:0 0 0 0 rgba(242,109,109,0.55)}70%{box-shadow:0 0 0 10px rgba(242,109,109,0)}100%{box-shadow:0 0 0 0 rgba(242,109,109,0)}}`;
  document.head.appendChild(s);
}

// ── FICHAJES PANEL ────────────────────────────────────────────────
export function fmtHoraF(ts) { return ts ? new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "—"; }

export function fmtFecha(f) { try { return new Date(f + "T00:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }); } catch { return f; } }

export function fmtDur(ms) {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${String(m).padStart(2, "0")}min`;
}

// ── CALENDARIO DE FICHAJES ───────────────────────────────────────────
export const DIAS_SEMANA_CORTO = ["L", "M", "X", "J", "V", "S", "D"];
