// Rostering: datos y utilidades sin pantalla — códigos de turno y de vehículo,
// el cuadrante del mes y la disponibilidad de vehículos (Firestore), estilos.
import { useState, useEffect } from "react";
import { db } from "../firebase.js";
import { listenRosterMonth } from "../roster-store.js";
import { doc, onSnapshot } from "firebase/firestore";

// ── DESIGN TOKENS ─────────────────────────────────────────────────
export const C = {
  bg: "#0f1623", card: "#172035", surface2: "#1e2d48",
  border: "rgba(88,130,225,0.22)", border2: "rgba(88,130,225,0.40)",
  text: "#e2eeff", muted: "#8aa5cc", dim: "#4a5f82",
  blue: "#5c9bff",
};

export const font = "'Inter',system-ui,sans-serif";

// ── SHIFT METADATA ─────────────────────────────────────────────────
export const SHIFTS = ["M", "T", "N", "L", "G", "B", "D"];

export const SHIFT_META = {
  M: { label: "Mañana",     bg: "#0d2248", text: "#4f8ef7" },
  T: { label: "Tarde",      bg: "#3d1a00", text: "#fb923c" },
  N: { label: "Noche",      bg: "#1a0d3d", text: "#a78bfa" },
  L: { label: "Libre",      bg: "#1c2a3a", text: "#64748b" },
  G: { label: "Guardia",    bg: "#2d2200", text: "#fbbf24" },
  B: { label: "Baja",       bg: "#3d0d0d", text: "#f87171" },
  D: { label: "Disponible", bg: "#072015", text: "#34d399" },
};

export const DAY_NAMES  = ["D","L","M","X","J","V","S"];

export const MONTH_NAMES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

// dailyDetail guarda minutos absolutos (pueden pasar de 1440 en turnos de
// noche que cruzan medianoche) — %1440 para la hora de reloj.
export function fmtClock(min) {
  if (min == null) return "--:--";
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// ── PUBLIC HOOK ────────────────────────────────────────────────────
// Used by scheduling.jsx to load rostering data for a given month.
// Solo lectura, así que sigue en vivo todos los cambios de Firestore — la
// página de Rostering tiene su propio listener con edición local. Antes
// solo se aplicaba la primera lectura (patrón copiado de la página de
// Rostering), y como Scheduling y Rostering se quedan montados a la vez,
// Scheduling no veía una baja marcada después de abrirlo: ni avisaba del
// conflicto ni la tenía en cuenta al generar o publicar.
// Mes sin datos (siempre el mismo objeto, para no rehacer cálculos)
const VACIO = Object.freeze({});

export function useRostering(orgId, year, month) {
  const docId = (orgId && year && month)
    ? `${orgId}_${year}_${String(month).padStart(2, "0")}`
    : null;
  // El mes leído, con el documento del que viene (al cambiar de mes no se ve
  // el anterior). asignaciones: trabajador → día → { v, vn, s, e }: qué
  // vehículo y horario le asignó Rostering → Optimizar (modo libre).
  const [mes, setMes] = useState({ docId: null, grid: VACIO, asignaciones: VACIO });

  useEffect(() => {
    if (!docId) return;
    // Una ficha por trabajador (roster-store.js) — antes todo el mes en un
    // solo documento, que pasaba de 1 MB con plantillas grandes.
    return listenRosterMonth(orgId, year, month, m => setMes({ docId, grid: m.grid, asignaciones: m.asignaciones }));
  }, [docId, orgId, year, month]);

  const listo = !!docId && mes.docId === docId;
  return { grid: listo ? mes.grid : VACIO, asignaciones: listo ? mes.asignaciones : VACIO, loading: !!docId && !listo, docId };
}

// Helper exported for scheduling conflict check
export function workerCodeOnDay(grid, workerId, day) {
  return grid[workerId]?.[String(day)] ?? "";
}

export function isUnavailable(code) {
  return code === "L" || code === "B";
}

// ── VEHICLE AVAILABILITY ─────────────────────────────────────────
// Mismo patrón que el cuadrante de trabajadores de arriba, pero en su
// propia colección de Firestore (rostering_vehicles) para no mezclar IDs
// de trabajador y de vehículo en el mismo documento.
export const VEHICLE_STATUSES = ["D", "T", "A", "I"];

export const VEHICLE_STATUS_META = {
  D: { label: "Disponible", bg: "#072015", text: "#34d399" },
  T: { label: "Taller",     bg: "#3d1a00", text: "#fb923c" },
  A: { label: "Avería",     bg: "#3d0d0d", text: "#f87171" },
  I: { label: "ITV",        bg: "#2d2200", text: "#fbbf24" },
};

// live=true (Scheduling, solo lectura): sigue todos los cambios de
// Firestore. Por defecto (la propia vista de Rostering, que edita en
// local) solo aplica la primera lectura para no pisar las ediciones.
export function useVehicleAvailability(orgId, year, month, { live = false } = {}) {
  const docId = (orgId && year && month)
    ? `${orgId}_${year}_${String(month).padStart(2, "0")}`
    : null;
  const [leido, setLeido] = useState({ docId: null, grid: VACIO });

  useEffect(() => {
    if (!docId) return;
    let cargado = false;
    return onSnapshot(doc(db, "rostering_vehicles", docId), snap => {
      if (live || !cargado) {
        setLeido({ docId, grid: snap.exists() ? (snap.data().grid ?? {}) : {} });
        cargado = true;
      }
    });
  }, [docId, live]);

  const listo = !!docId && leido.docId === docId;
  return { grid: listo ? leido.grid : VACIO, loading: !!docId && !listo, docId };
}

// Helper exported for scheduling conflict check / publish-time filtering
export function vehicleCodeOnDay(grid, vehicleId, day) {
  return grid[vehicleId]?.[String(day)] ?? "";
}

export function isVehicleUnavailable(code) {
  return code === "T" || code === "A" || code === "I";
}

// ── MODAL: reglas del cuadrante + convenio colectivo ───────────────
// Formulario guiado: el convenio (PDF) se abre al lado para ir leyéndolo, y
// cada regla lleva el artículo del que sale y qué buscar en el texto. El
// PDF se guarda troceado en Firestore (colección `rostering`, docs
// `${orgId}_convenio_pdf_${uploadId}_${i}`) para que lo vea todo el equipo sin
// depender de Firebase Storage. Cada subida usa su propio uploadId: si se
// cancela el modal, el PDF anterior sigue intacto.
export const RULE_FIELDS = [
  { key: "maxHorasMes",         label: "Máx. horas al mes",              suffix: "h/mes", busca: "cómputo mensual, jornada" },
  { key: "jornadaAnualH",       label: "Jornada anual",                  suffix: "h/año", busca: "jornada anual, horas de trabajo efectivo" },
  { key: "maxHorasDia",         label: "Jornada máxima diaria",          suffix: "h",     busca: "jornada diaria, horas ordinarias" },
  { key: "descansoMinH",        label: "Descanso entre jornadas",        suffix: "h",     busca: "descanso entre jornadas" },
  { key: "descansoSemanalH",    label: "Descanso semanal seguido",       suffix: "h",     busca: "descanso semanal, día y medio" },
  { key: "maxDiasSeguidos",     label: "Máx. días seguidos",             suffix: "días",  busca: "días consecutivos, días de trabajo seguidos" },
  { key: "minFindesLibres",     label: "Fines de semana libres al mes",  suffix: "mín.",  busca: "fines de semana, sábados y domingos" },
  { key: "minLibresSeguidos",   label: "Libres consecutivos mínimos",    suffix: "días",  busca: "descanso consecutivo, días libres seguidos" },
  { key: "vecesLibresSeguidos", label: "…esos libres, veces al mes",     suffix: "veces", busca: "p. ej. 2 días × 4 = dos libres seguidos cada semana" },
  { key: "maxNochesSeguidas",   label: "Máx. noches seguidas",           suffix: "",      busca: "trabajo nocturno, nocturnidad" },
  { key: "maxNochesMes",        label: "Máx. noches al mes",             suffix: "",      busca: "nocturnidad, turno de noche" },
  { key: "maxDomingosFestivos", label: "Máx. domingos/festivos al mes",  suffix: "",      busca: "domingos, festivos" },
];

export const PDF_CHUNK = 700_000;          // caracteres base64 por documento (< 1MB)

export const PDF_MAX_BYTES = 10 * 1024 * 1024;

// "12/10/2026, 2026-12-25" → ["2026-10-12", "2026-12-25"]
export function parseFestivos(text) {
  const out = [];
  for (const raw of text.split(/[\s,;]+/).filter(Boolean)) {
    let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) { out.push(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`); continue; }
    m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) out.push(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  }
  return [...new Set(out)].sort();
}

// ── MODAL: publicar a Rutas ────────────────────────────────────────
export const TIPOS_RUTA = [
  { key: "prev", label: "Mantenimiento Preventivo" },
  { key: "ext",  label: "Limpieza Exterior" },
  { key: "int",  label: "Limpieza Interior" },
];

export const inputStyle = {
  width: 72, background: C.surface2, border: `1px solid ${C.border}`, color: C.text,
  borderRadius: 6, padding: "5px 8px", fontSize: 12, outline: "none", fontFamily: font,
};

export const primaryBtn = {
  padding: "6px 14px", borderRadius: 6, background: C.blue, border: "none",
  color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font,
};

export const pubBtn = {
  padding: "3px 10px", borderRadius: 5, background: "#5c9bff22", border: "1px solid #5c9bff55",
  color: "#5c9bff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font,
};

export const secondaryBtn = {
  padding: "6px 14px", borderRadius: 6, background: "none", border: `1px solid ${C.border2}`,
  color: C.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font,
};

// ── STYLE CONSTANTS ────────────────────────────────────────────────
export const navBtnStyle = {
  width: 28, height: 28, borderRadius: 6,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#94a3b8", fontSize: 18, lineHeight: 1,
  cursor: "pointer", fontFamily: font,
  display: "flex", alignItems: "center", justifyContent: "center",
};

export const thStyle = {
  fontSize: 10, color: "#64748b", fontWeight: 500,
  letterSpacing: 1, textTransform: "uppercase",
  borderBottom: `1px solid rgba(255,255,255,0.13)`,
  whiteSpace: "nowrap",
};
