import { useState, useRef, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import { db, auth, getUserProfileSafe } from "./firebase.js";
import { useRostering, workerCodeOnDay, isUnavailable, SHIFT_META } from "./rostering.jsx";
import { PlanningPage, idbGet } from "./planning.jsx";
import {
  collection, onSnapshot, addDoc, deleteDoc, updateDoc,
  doc, serverTimestamp, query, where, getDoc, setDoc, getDocs, limit,
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { LoginScheduling } from "./login-scheduling.jsx";
import {
  timeToMin, minToTime, turnoWindow, shiftCodeFromStart, hasCoords,
  computeCandidateSlots, applyTaskMove, generateScenario, autoScaleFleet,
} from "./vrp-engine.js";
import { useLang, t } from "./i18n.js";

// ── DESIGN TOKENS ─────────────────────────────────────────────────
const C = {
  bg:"#0f1623", card:"#172035", surface2:"#1e2d48",
  border:"rgba(88,130,225,0.22)", border2:"rgba(88,130,225,0.40)",
  blue:"#5c9bff", blueDim:"#0d2550", blueText:"#b0ccff",
  green:"#34d399", greenDim:"#082a18",
  orange:"#fb923c", red:"#f87171", amber:"#fbbf24",
  text:"#e2eeff", muted:"#8aa5cc", dim:"#4a5f82",
};
const font = "'Inter',system-ui,sans-serif";
const mono = "'JetBrains Mono','Courier New',monospace";

if (typeof document !== "undefined" && !document.getElementById("sched-styles")) {
  const s = document.createElement("style");
  s.id = "sched-styles";
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
    *,*::before,*::after{box-sizing:border-box;-webkit-font-smoothing:antialiased;}
    body{margin:0;background:#0f1117;color:#f0f4f8;font-family:'Inter',system-ui,sans-serif;}
    ::-webkit-scrollbar{width:5px;height:5px;}
    ::-webkit-scrollbar-track{background:#161b27;}
    ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:3px;}
    @keyframes sched-fadein{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
    @keyframes sched-spin{to{transform:rotate(360deg)}}
    @keyframes sched-shimmer{0%,100%{opacity:1}50%{opacity:.6}}
    @keyframes sched-pulse{0%,100%{opacity:.55}50%{opacity:1}}
    .sched-block{transition:filter .1s,box-shadow .1s;}
    .sched-block:hover{filter:brightness(1.15);box-shadow:0 2px 8px rgba(0,0,0,.4);}
  `;
  document.head.appendChild(s);
}


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

// Minutos -> "8h" / "8h30" — mismo formato que ya se usa en cada fila del Gantt
function fmtDurHM(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${h}h${m > 0 ? String(m).padStart(2, "0") : ""}`;
}

const VEHICLE_TYPES = ["Camión lateral","Camión trasero","Furgón","Barredora","Cisterna","Otro"];
const TURNO_TYPES   = ["Mañana (06-14)","Tarde (14-22)","Noche (22-06)","Jornada completa"];


// ── IndexedDB: persist full VRP schedule across page reloads ─────
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("vrp_cache", 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore("schedules");
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e);
  });
}
async function idbSave(key, value) {
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction("schedules", "readwrite");
      tx.objectStore("schedules").put(value, key);
      tx.oncomplete = () => res();
      tx.onerror    = e => rej(e);
    });
  } catch { /* non-critical */ }
}
async function idbLoad(key) {
  try {
    const db = await idbOpen();
    return await new Promise((res, rej) => {
      const tx  = db.transaction("schedules", "readonly");
      const req = tx.objectStore("schedules").get(key);
      req.onsuccess = e => res(e.target.result ?? null);
      req.onerror   = e => rej(e);
    });
  } catch { return null; }
}


// ── OSRM ROAD ENRICHMENT ──────────────────────────────────────────
// After VRP generation (which uses fast Haversine), replace travel block km
// with real road distances from OSRM. Time layout stays unchanged.
async function enrichWithOSRM(schedule) {
  // Skip OSRM entirely when routes are too large — the URL would exceed 100KB,
  // causing fetch to hang regardless of the timeout signal in some environments.
  const OSRM_MAX_STOPS = 80;
  const maxStopsAny = Math.max(0, ...schedule.map(row =>
    row.assignments.filter(a => !a._travel && !a._break && !a._wait).length
  ));
  if (maxStopsAny > OSRM_MAX_STOPS) return schedule;

  return Promise.all(schedule.map(async (row) => {
    const depot = (row.depotLat && row.depotLng)
      ? { lat: +row.depotLat, lng: +row.depotLng } : null;

    // Build ordered waypoints: [depot?] + stops + [depot?]
    const waypoints = []; // {lng, lat, assignmentIdx | null}
    if (depot) waypoints.push({ lng: depot.lng, lat: depot.lat, idx: null, isDepot: true });
    row.assignments.forEach((a, i) => {
      if (!a._travel && !a._break && !a._wait && hasCoords(a.lat, a.lng))
        waypoints.push({ lng: +a.lng, lat: +a.lat, idx: i, isDepot: false });
    });
    if (depot) waypoints.push({ lng: depot.lng, lat: depot.lat, idx: null, isDepot: true, isReturn: true });

    if (waypoints.filter(w => !w.isDepot).length < 1) return row;
    if (waypoints.length < 2) return row;

    // Manual timeout via AbortController — more reliable than AbortSignal.timeout
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 10000);
    const coords = waypoints.map(w => `${w.lng},${w.lat}`).join(';');
    try {
      const resp = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`,
        { signal: ctrl.signal }
      );
      clearTimeout(tid);
      const data = await resp.json();
      if (data.code !== 'Ok' || !data.routes?.[0]?.legs) return row;

      const legs = data.routes[0].legs;
      const newAssignments = [...row.assignments];

      // Each leg[i] = waypoints[i] → waypoints[i+1]
      // Find travel blocks between consecutive waypoints and update their km
      for (let i = 0; i < waypoints.length - 1 && i < legs.length; i++) {
        const roadKm = legs[i].distance / 1000;
        const fromIdx = waypoints[i].idx;     // null = depot
        const toIdx   = waypoints[i + 1].idx; // null = depot

        // Find the travel block between fromIdx and toIdx in assignments array
        const searchFrom = fromIdx !== null ? fromIdx + 1 : 0;
        const searchTo   = toIdx   !== null ? toIdx       : newAssignments.length;
        for (let j = searchFrom; j < searchTo; j++) {
          if (newAssignments[j]?._travel) {
            newAssignments[j] = { ...newAssignments[j], km: +roadKm.toFixed(3) };
            break;
          }
        }
      }

      const totalKm = newAssignments
        .filter(a => a._travel)
        .reduce((s, a) => s + (a.km || 0), 0);

      return { ...row, assignments: newAssignments, totalKm: +totalKm.toFixed(2) };
    } catch {
      clearTimeout(tid);
      return row;
    }
  }));
}


// ── GANTT CHART ───────────────────────────────────────────────────
const ROW_H    = 52;
const HEADER_H = 44;
const LABEL_W_DEFAULT = 210;
const LABEL_W_MIN = 150;
const LABEL_W_MAX = 480;
const ZOOM_STEPS = [0.25, 0.5, 1, 2, 4, 8];

const DAY_OPTIONS = [1, 2, 3, 5, 7, 14];

// Distintivo de "tiene franja horaria / hora fija" — antes era solo un
// borde más oscuro en el bloque, pero con bloques de 15px de ancho entre
// miles de paradas (aquí solo el 1-2% suele tener franja) era casi
// imposible verlo a simple vista. Un reloj en la esquina destaca mucho
// más aunque el bloque sea diminuto.
function ClockBadge({ size = 11 }) {
  return (
    <div title="Tiene franja horaria / hora fija" style={{
      position: "absolute", top: -4, right: -4, width: size, height: size, borderRadius: "50%",
      background: "#fbbf24", border: "1.5px solid #000", zIndex: 6,
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 1px 3px rgba(0,0,0,.7)", pointerEvents: "none",
    }}>
      <svg width={size - 4} height={size - 4} viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.2 2" />
      </svg>
    </div>
  );
}

function GanttChart({ rows, startMin, endMin, days = 1, mode, allWorkers = [], allVehicles = [], onScheduleChange, unassigned = [], onPlaceUnassigned }) {
  const [tooltip,      setTooltip]      = useState(null);
  const [pxPerMin,     setPxPerMin]     = useState(2);
  const [unassignedOpen, setUnassignedOpen] = useState(true);
  const [selectedDay,  setSelectedDay]  = useState(0);
  const [compactDayNav, setCompactDayNav] = useState(() => days > 10);
  const [dragging,     setDragging]     = useState(null); // { task, fromRowId }
  const [dropRowId,    setDropRowId]    = useState(null);
  const [stackPanel,   setStackPanel]   = useState(null); // { task, row }
  const [ganttSort,    setGanttSort]    = useState("default"); // "default" | "salida_asc" | "salida_desc" | "servicio_asc" | "servicio_desc"
  const [movePreview,  setMovePreview]  = useState(null); // { task, fromRow, dayOffset, slotsByRowId }
  const [labelW,       setLabelW]       = useState(LABEL_W_DEFAULT);
  const resizingRef = useRef(null);

  // Arrastrar el borde derecho de la columna "Recurso" para ensancharla —
  // los nombres largos de vehículo/trabajador se cortaban ("Vehículo ...").
  const startResizeLabel = e => {
    e.preventDefault(); e.stopPropagation();
    resizingRef.current = { startX: e.clientX, startW: labelW };
    const onMove = ev => {
      if (!resizingRef.current) return;
      const { startX, startW } = resizingRef.current;
      const w = Math.min(LABEL_W_MAX, Math.max(LABEL_W_MIN, startW + (ev.clientX - startX)));
      setLabelW(w);
    };
    const onUp = () => {
      resizingRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const closePanel = () => { setStackPanel(null); setMovePreview(null); };

  const openTaskPanel = (task, row) => {
    if (stackPanel?.task === task) { closePanel(); return; }
    setStackPanel({ task, row });
    if (!onScheduleChange) return;
    const dayOffset = Math.floor(task._start / 1440) * 1440;
    const slotsByRowId = new Map();
    rows.forEach(r => {
      if ((r._id || r.id) === (row._id || row.id)) return;
      const slots = computeCandidateSlots(task, r, dayOffset);
      if (slots.length) slotsByRowId.set(r._id || r.id, slots);
    });
    setMovePreview({ task, fromRow: row, dayOffset, slotsByRowId });
  };

  const describeRow = r => [r?.nombre, r?.apellidos].filter(Boolean).join(" ") || r?.matricula || r?.turno || "recurso";

  // Intenta ejecutar un movimiento ya validado (slot factible). Si la
  // tarea tiene franja horaria, pide confirmación explícita antes de
  // aplicarlo — moverla de vehículo puede cambiar la hora de llegada. El
  // historial de deshacer/rehacer (botones ↶↷ de la barra) vive en el
  // componente padre, que recibe el movimiento ya resuelto.
  const attemptMove = (task, fromRow, toRow, slot, dayOffset) => {
    const commit = () => {
      const { newFromAssignments, newToAssignments } = applyTaskMove(task, fromRow, toRow, slot, dayOffset);
      onScheduleChange({
        fromRow, toRow, newFromAssignments, newToAssignments, dayOffset,
        label: `Movido a ${describeRow(toRow)}`,
      });
      closePanel();
    };
    if (task.windowStart != null) {
      const winTxt  = `${minToTime(task.windowStart % 1440)}–${minToTime((task.windowEnd ?? task.windowStart) % 1440)}`;
      const waitTxt = slot.wait > 0 ? ` (con ${slot.wait} min de espera)` : "";
      const destName = describeRow(toRow);
      const ok = window.confirm(
        `Esta parada tiene franja horaria ${winTxt}.\nSe colocaría a las ${minToTime(slot.arrival % 1440)}${waitTxt}.\n\n¿Confirmas el traslado a ${destName}?`
      );
      if (!ok) return;
    }
    commit();
  };

  // Igual que attemptMove pero para una tarea que viene del stack de "sin
  // asignar" (nunca ha tenido fila ni _start) — no hay "fromRow" del que
  // quitarla, solo se inserta en la fila destino.
  const attemptPlace = (task, toRow, slot, dayOffset) => {
    const commit = () => {
      onPlaceUnassigned(task, toRow, slot, dayOffset);
      closePanel();
    };
    if (task.windowStart != null) {
      const winTxt  = `${minToTime(task.windowStart % 1440)}–${minToTime((task.windowEnd ?? task.windowStart) % 1440)}`;
      const waitTxt = slot.wait > 0 ? ` (con ${slot.wait} min de espera)` : "";
      const destName = describeRow(toRow);
      const ok = window.confirm(
        `Esta parada tiene franja horaria ${winTxt}.\nSe colocaría a las ${minToTime(slot.arrival % 1440)}${waitTxt}.\n\n¿Confirmas colocarla en ${destName}?`
      );
      if (!ok) return;
    }
    commit();
  };

  // Sin hueco factible: aviso de solape/franja imposible, no se mueve nada.
  const rejectMove = () => {
    window.alert("No se puede colocar esta parada ahí: se solaparía con otra parada existente o no llegaría a tiempo dentro de su franja horaria.");
  };

  const sortedRows = useMemo(() => {
    if (ganttSort === "default") return rows;
    const type = ganttSort.startsWith("salida") ? "salida" : "servicio";
    const asc  = ganttSort.endsWith("asc");
    const getKey = row => {
      const dayA = (row.assignments || []).filter(a => Math.floor(a._start / 1440) === selectedDay);
      if (type === "salida") {
        const dep = dayA.find(a => a._depot_exit);
        return dep ? dep._start : (dayA.length ? dayA[0]._start : Infinity);
      } else {
        const stop = dayA.find(a => !a._travel && !a._break && !a._wait);
        return stop ? stop._start : Infinity;
      }
    };
    return [...rows].sort((a, b) => {
      const ka = getKey(a), kb = getKey(b);
      if (ka === Infinity && kb === Infinity) return 0;
      if (ka === Infinity) return 1;
      if (kb === Infinity) return -1;
      return asc ? ka - kb : kb - ka;
    });
  }, [rows, ganttSort, selectedDay]);

  // Jornada media del día seleccionado — duración real (primera parada a
  // última) de cada fila con trabajo ese día, promediada. Sirve para ver
  // de un vistazo si los turnos están descompensados (p.ej. el fallo real
  // que hubo con mañana llena y tarde casi vacía en Palma de Mallorca).
  const jornadaStats = useMemo(() => {
    const dayOffset = selectedDay * 1440;
    const durations = rows.map(r => {
      const dayA = (r.assignments || []).filter(a => a._start >= dayOffset && a._start < dayOffset + 1440);
      if (!dayA.length) return null;
      const start = Math.min(...dayA.map(a => a._start));
      const end   = Math.max(...dayA.map(a => a._end));
      return end - start;
    }).filter(d => d != null && d > 0);
    if (!durations.length) return null;
    const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
    return { avg, min: Math.min(...durations), max: Math.max(...durations), count: durations.length };
  }, [rows, selectedDay]);

  // Night-shift support: extend chart width beyond 24h if any row has shiftEnd > 1440
  // Memoized: rows can be dozens of workers with per-day assignments, and this
  // component re-renders on every drag-and-drop mouse move (dragging/dropRowId).
  const maxShiftEnd = useMemo(() => Math.max(1440, ...rows.map(r => r.shiftEnd ?? 1440)), [rows]);
  const hasNightShift = maxShiftEnd > 1440;
  const chartW = maxShiftEnd * pxPerMin;

  // Hour ticks — density adapts to zoom, go up to maxShiftEnd
  const ticks = [];
  const tickStep = pxPerMin < 0.75 ? 2 : 1;
  const maxH = Math.ceil(maxShiftEnd / 60);
  for (let h = 0; h <= maxH; h += tickStep) {
    ticks.push({ h, x: h * 60 * pxPerMin });
  }

  // Sub-hour ticks
  const subTicks = [];
  const subMin = pxPerMin >= 4 ? 15 : 30;
  for (let m = 0; m < maxShiftEnd; m += subMin) {
    if (m % 60 === 0) continue;
    subTicks.push({ x: m * pxPerMin, quarter: m % 60 === 15 || m % 60 === 45 });
  }

  // Inactive-hour bands: left = before first shift, right = after all shifts (none if night-aware)
  const minShiftStart = useMemo(() => rows.length > 0
    ? Math.min(...rows.map(r => r.shiftStart ?? startMin))
    : startMin, [rows, startMin]);
  const inactiveBands = [
    minShiftStart > 0 ? { x: 0, w: minShiftStart * pxPerMin } : null,
    // Right inactive: only when no night shifts (night extends past midnight)
    !hasNightShift && endMin < 1440 ? { x: endMin * pxPerMin, w: (1440 - endMin) * pxPerMin } : null,
  ].filter(Boolean);

  const zoomIn  = () => { const i = ZOOM_STEPS.indexOf(pxPerMin); if (i < ZOOM_STEPS.length - 1) setPxPerMin(ZOOM_STEPS[i + 1]); else setPxPerMin(Math.min(12, pxPerMin * 2)); };
  const zoomOut = () => { const i = ZOOM_STEPS.indexOf(pxPerMin); if (i > 0) setPxPerMin(ZOOM_STEPS[i - 1]); else setPxPerMin(Math.max(0.1, pxPerMin / 2)); };

  const zoomLabel = pxPerMin >= 1 ? `${pxPerMin}×` : `${pxPerMin}×`;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── Toolbar ── */}
      <div style={{
        flexShrink: 0, background: C.surface2, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 6, padding: "5px 16px", flexWrap: "wrap",
      }}>
        {/* Zoom */}
        <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600, marginRight: 4 }}>Zoom</span>
        <button onClick={zoomOut} style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid ${C.border}`, background: "none", color: C.muted, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
        <span style={{ fontSize: 11, color: C.text, fontFamily: mono, minWidth: 28, textAlign: "center" }}>{zoomLabel}</span>
        <button onClick={zoomIn}  style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid ${C.border}`, background: "none", color: C.muted, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
        <div style={{ width: 1, height: 16, background: C.border, margin: "0 4px" }} />
        {ZOOM_STEPS.map(z => (
          <button key={z} onClick={() => setPxPerMin(z)} style={{
            padding: "2px 8px", borderRadius: 4, fontSize: 10, fontFamily: mono, cursor: "pointer",
            border: `1px solid ${pxPerMin === z ? C.blue : C.border}`,
            background: pxPerMin === z ? C.blueDim : "none",
            color: pxPerMin === z ? C.blueText : C.dim,
            transition: "all .1s",
          }}>{z}×</button>
        ))}

        {/* Sort */}
        <div style={{ width: 1, height: 16, background: C.border, margin: "0 4px" }} />
        <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600, marginRight: 2 }}>Ordenar</span>
        {[
          { key: "salida_asc",    label: "Salida ↑" },
          { key: "salida_desc",   label: "Salida ↓" },
          { key: "servicio_asc",  label: "1ª parada ↑" },
          { key: "servicio_desc", label: "1ª parada ↓" },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setGanttSort(s => s === key ? "default" : key)} style={{
            padding: "2px 8px", borderRadius: 4, fontSize: 10, fontFamily: mono, cursor: "pointer",
            border: `1px solid ${ganttSort === key ? C.blue : C.border}`,
            background: ganttSort === key ? C.blueDim : "none",
            color: ganttSort === key ? C.blueText : C.dim,
            transition: "all .1s",
          }}>{label}</button>
        ))}

        {/* Day navigation */}
        {days > 1 && <>
          <div style={{ width: 1, height: 16, background: C.border, margin: "0 8px" }} />
          <button onClick={() => setSelectedDay(d => Math.max(0, d - 1))} disabled={selectedDay === 0}
            style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid ${C.border}`, background: "none", color: selectedDay === 0 ? C.dim : C.muted, cursor: selectedDay === 0 ? "default" : "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>

          {compactDayNav ? (
            /* Compact: input + total */
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="number" min="1" max={days} value={selectedDay + 1}
                onChange={e => { const v = parseInt(e.target.value, 10) - 1; if (v >= 0 && v < days) setSelectedDay(v); }}
                style={{
                  width: 48, background: C.card, border: `1px solid ${C.green}55`,
                  color: C.green, borderRadius: 5, padding: "1px 6px",
                  fontSize: 11, fontFamily: mono, fontWeight: 700,
                  textAlign: "center", outline: "none",
                }}
              />
              <span style={{ fontSize: 10, color: C.dim, fontFamily: mono }}>/ {days}</span>
            </div>
          ) : (
            /* Expanded: all day pills */
            Array.from({ length: days }, (_, d) => (
              <button key={d} onClick={() => setSelectedDay(d)} style={{
                padding: "2px 10px", borderRadius: 4, fontSize: 10, fontFamily: mono, cursor: "pointer",
                border: `1px solid ${selectedDay === d ? C.green : C.border}`,
                background: selectedDay === d ? C.greenDim : "none",
                color: selectedDay === d ? C.green : C.dim,
                fontWeight: selectedDay === d ? 700 : 400,
                transition: "all .1s",
              }}>Día {d + 1}</button>
            ))
          )}

          <button onClick={() => setSelectedDay(d => Math.min(days - 1, d + 1))} disabled={selectedDay === days - 1}
            style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid ${C.border}`, background: "none", color: selectedDay === days - 1 ? C.dim : C.muted, cursor: selectedDay === days - 1 ? "default" : "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>

          {/* Toggle compact/expanded */}
          <button
            onClick={() => setCompactDayNav(v => !v)}
            title={compactDayNav ? "Mostrar todos los días" : "Ocultar días"}
            style={{
              width: 22, height: 22, borderRadius: 5, border: `1px solid ${C.border}`,
              background: "none", color: C.dim, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all .12s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blueText; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              {compactDayNav
                ? <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>
                : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></>
              }
            </svg>
          </button>
        </>}
      </div>

      {/* ── Scrollable Gantt ── */}
      <div style={{ flex: 1, overflowX: "auto", overflowY: "auto", position: "relative" }} onClick={closePanel}>
        <div style={{ display: "inline-block", minWidth: labelW + chartW, minHeight: "100%" }}>

          {/* Time axis header */}
          <div style={{
            display: "flex", height: HEADER_H,
            position: "sticky", top: 0, zIndex: 10,
            background: C.card, borderBottom: `1px solid ${C.border2}`,
          }}>
            <div style={{
              width: labelW, flexShrink: 0, position: "sticky", left: 0, zIndex: 12,
              background: C.card, borderRight: `1px solid ${C.border}`,
              display: "flex", alignItems: "flex-end", padding: "0 16px 8px",
            }}>
              <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>Recurso</span>
              {/* Asa de redimensión — arrastrar para ensanchar la columna */}
              <div
                onMouseDown={startResizeLabel}
                title="Arrastrar para ensanchar"
                style={{
                  position: "absolute", top: 0, right: -3, bottom: 0, width: 7,
                  cursor: "col-resize", zIndex: 13,
                }}
                onClick={e => e.stopPropagation()}
              >
                <div style={{ position: "absolute", top: 0, bottom: 0, left: 3, width: 1, background: C.border2 }} />
              </div>
            </div>
            <div style={{ position: "relative", width: chartW, flexShrink: 0 }}>
              {/* Inactive-hours shading in header */}
              {inactiveBands.map(({ x, w }, i) => (
                <div key={i} style={{ position: "absolute", left: x, top: 0, width: w, height: "100%", background: "rgba(0,0,0,0.30)", pointerEvents: "none" }} />
              ))}
              {subTicks.map(({ x, quarter }, i) => (
                <div key={i} style={{ position: "absolute", left: x, top: "70%", bottom: 0, width: 1, background: C.border, opacity: quarter ? .3 : .2 }} />
              ))}
              {ticks.map(({ h, x }) => (
                <div key={h} style={{ position: "absolute", left: x, top: 0, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", paddingBottom: 7 }}>
                  <div style={{ width: 1, height: 10, background: C.border2, marginLeft: -0.5 }} />
                  <span style={{ fontSize: 10, color: C.muted, fontFamily: mono, marginTop: 3, transform: "translateX(-50%)", display: "inline-block", whiteSpace: "nowrap" }}>
                    {String(h % 24).padStart(2,"0")}:00
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Resource rows */}
          {sortedRows.map((row, ri) => (
            <div key={row._id || row.id || ri} style={{ display: "flex", height: ROW_H, borderBottom: `1px solid ${C.border}` }}>
              {/* Label */}
              <div style={{
                width: labelW, flexShrink: 0, position: "sticky", left: 0, zIndex: 3,
                background: ri % 2 === 0 ? C.card : C.surface2,
                borderRight: `1px solid ${C.border}`,
                display: "flex", alignItems: "center", padding: "0 14px", gap: 10,
              }}>
                {(() => {
                  const fullName = [row.nombre, row.apellidos].filter(Boolean).join(" ") || row.name || "?";
                  const letter = fullName[0].toUpperCase();
                  const dayAssignments = (row.assignments || []).filter(a => Math.floor(a._start / 1440) === selectedDay);
                  const stopCount = dayAssignments.filter(a => !a._break && !a._travel && !a._wait).length;
                  const dayKm = dayAssignments.filter(a => a._travel).reduce((s, a) => s + (a.km || 0), 0);

                  // Actual shift times from real assignments
                  const hasWork = dayAssignments.length > 0;
                  const actStart = hasWork ? Math.min(...dayAssignments.map(a => a._start)) : null;
                  const actEnd   = hasWork ? Math.max(...dayAssignments.map(a => a._end))   : null;
                  const durMin   = hasWork ? actEnd - actStart : 0;
                  const durH     = Math.floor(durMin / 60);
                  const durM     = durMin % 60;
                  const durLabel = durMin > 0
                    ? `${durH}h${durM > 0 ? String(durM).padStart(2, "0") : ""}`
                    : null;

                  // Fallback: theoretical turno window
                  const tw = row.turno ? turnoWindow(row.turno, startMin, endMin) : null;
                  const timeLabel = hasWork
                    ? `${minToTime(actStart % 1440)}–${minToTime(actEnd % 1440)}`
                    : tw
                      ? `${String(Math.floor(tw.start / 60)).padStart(2,"0")}–${String(Math.floor((tw.end % 1440) / 60)).padStart(2,"0")}h`
                      : (row.matricula || "");

                  return (
                    <>
                      <div style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, background: C.blueDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: C.blueText }}>
                        {letter}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Nombre + hora en la misma línea */}
                        <div style={{ display: "flex", alignItems: "baseline", gap: 5, overflow: "hidden" }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 1, minWidth: 0 }}>
                            {fullName}
                          </span>
                          <span style={{ fontSize: 10, color: C.blueText, fontFamily: mono, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>
                            {timeLabel}
                          </span>
                        </div>
                        {/* Stats en línea propia — no hay overflow */}
                        <div style={{ fontSize: 10, fontFamily: mono, display: "flex", gap: 5, alignItems: "center", marginTop: 2 }}>
                          {durLabel && <span style={{ color: "#34d399", fontWeight: 700, whiteSpace: "nowrap" }}>{durLabel}</span>}
                          {stopCount > 0 && <span style={{ color: C.muted, whiteSpace: "nowrap" }}>{stopCount}p</span>}
                          {dayKm > 0 && <span style={{ color: "#fb923c", fontWeight: 700, whiteSpace: "nowrap" }}>{dayKm.toFixed(1)}km</span>}
                          {row.depotLat && row.depotLng && <span title={`Depot: ${(+row.depotLat).toFixed(4)}, ${(+row.depotLng).toFixed(4)}`} style={{ flexShrink: 0 }}>🏠</span>}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Timeline */}
              <div
                style={{
                  position: "relative", width: chartW, flexShrink: 0,
                  background: dropRowId === (row._id || row.id) && dragging
                    ? `${C.blue}18`
                    : ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                  transition: "background .1s",
                }}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropRowId(row._id || row.id); }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropRowId(null); }}
                onDrop={e => {
                  e.preventDefault(); setDropRowId(null);
                  if (!dragging) return;
                  const toRowId = row._id || row.id;
                  const task = dragging.task;
                  setDragging(null);

                  // Viene del stack de "sin asignar": nunca ha tenido fila
                  // ni _start, así que no hay "fromRow" del que quitarla —
                  // se coloca directamente en el día que se está viendo.
                  if (dragging.fromRowId == null) {
                    if (!onPlaceUnassigned) return;
                    const dayOffset = selectedDay * 1440;
                    const slots = computeCandidateSlots(task, row, dayOffset);
                    if (!slots.length) { rejectMove(); return; }
                    const rect = e.currentTarget.getBoundingClientRect();
                    const dropMin = dayOffset + (e.clientX - rect.left) / pxPerMin;
                    const best = slots.reduce((a, b) => Math.abs(b.arrival - dropMin) < Math.abs(a.arrival - dropMin) ? b : a);
                    attemptPlace(task, row, best, dayOffset);
                    return;
                  }

                  if (!onScheduleChange) return;
                  if (dragging.fromRowId === toRowId) return;
                  const fromRow = rows.find(r => (r._id || r.id) === dragging.fromRowId);
                  if (!fromRow) return;
                  const dayOffset = Math.floor(task._start / 1440) * 1440;
                  const slots = computeCandidateSlots(task, row, dayOffset);
                  if (!slots.length) { rejectMove(); return; }
                  const rect = e.currentTarget.getBoundingClientRect();
                  const dropMin = dayOffset + (e.clientX - rect.left) / pxPerMin;
                  const best = slots.reduce((a, b) => Math.abs(b.arrival - dropMin) < Math.abs(a.arrival - dropMin) ? b : a);
                  attemptMove(task, fromRow, row, best, dayOffset);
                }}
              >
                {ticks.map(({ h, x }) => (
                  <div key={h} style={{ position: "absolute", left: x, top: 0, bottom: 0, width: 1, background: C.border, opacity: .5 }} />
                ))}
                {subTicks.map(({ x }, i) => (
                  <div key={i} style={{ position: "absolute", left: x, top: 0, bottom: 0, width: 1, background: C.border, opacity: .15 }} />
                ))}
                {/* Midnight marker for night shifts */}
                {hasNightShift && (
                  <div style={{ position: "absolute", left: (1440 - selectedDay * 1440 < 0 ? 0 : (1440 - selectedDay * 1440)) * pxPerMin, top: 0, bottom: 0, width: 2, background: `${C.blue}55`, pointerEvents: "none", zIndex: 2 }} />
                )}

                {/* Inactive-hours shading per row */}
                {(() => {
                  const rs = row._tw?.start ?? row.shiftStart ?? minShiftStart;
                  const re = row._tw?.end   ?? row.shiftEnd   ?? (hasNightShift ? maxShiftEnd : endMin);
                  // re may exceed 1440 for night shifts (22-06 → end=1800); cap display at maxShiftEnd
                  const reNorm = Math.min(re, maxShiftEnd);
                  const bands = [
                    rs > 0               ? { x: 0,                 w: rs * pxPerMin }                     : null,
                    reNorm < maxShiftEnd ? { x: reNorm * pxPerMin, w: (maxShiftEnd - reNorm) * pxPerMin } : null,
                  ].filter(Boolean);
                  return bands.map(({ x, w: bw }, i) => (
                    <div key={i} style={{ position: "absolute", left: x, top: 0, width: bw, height: "100%", background: "rgba(0,0,0,0.25)", pointerEvents: "none", zIndex: 1 }} />
                  ));
                })()}

              {(row.assignments || []).filter(task => {
                  const dayOffset = selectedDay * 1440;
                  return task._start >= dayOffset && task._start < dayOffset + maxShiftEnd;
                }).map((task, ti) => {
                  const left = (task._start - selectedDay * 1440) * pxPerMin;
                  const dur  = task.duracion || 15;
                  const w    = Math.max(dur * pxPerMin - 2, 3);
                  if (left < 0 || left > chartW) return null;

                  // Break block
                  if (task._break) return (
                    <div key={`b${ti}`} title={`Pausa · ${dur} min`} style={{
                      position: "absolute", left, top: ROW_H * 0.3, width: w, height: ROW_H * 0.4, zIndex: 3,
                      background: "repeating-linear-gradient(45deg,rgba(251,146,60,0.15) 0,rgba(251,146,60,0.15) 4px,transparent 4px,transparent 8px)",
                      border: "1px dashed rgba(251,146,60,0.4)", borderRadius: 3,
                    }} />
                  );

                  // Wait block — llegó antes de que abriera la franja horaria de la
                  // siguiente parada y tiene que esperar in situ.
                  if (task._wait) return (
                    <div key={`w${ti}`} title={`Espera franja horaria · ${dur} min`} style={{
                      position: "absolute", left, top: ROW_H * 0.3, width: w, height: ROW_H * 0.4, zIndex: 3,
                      background: "repeating-linear-gradient(45deg,rgba(34,211,238,0.15) 0,rgba(34,211,238,0.15) 4px,transparent 4px,transparent 8px)",
                      border: "1px dashed rgba(34,211,238,0.4)", borderRadius: 3,
                    }} />
                  );

                  // Travel block
                  if (task._travel) {
                    const tH = ROW_H * 0.38;
                    const tTop = (ROW_H - tH) / 2;
                    const kmLabel = task.km != null ? `${task.km.toFixed(2)} km` : "";
                    const minLabel = `${dur} min`;
                    const isDepotMove = task._depot_exit || task._depot_return;
                    const depotLabel = task._depot_exit ? "Salida depot" : "Vuelta depot";
                    const bg = isDepotMove
                      ? "repeating-linear-gradient(135deg, #92400e 0px, #92400e 6px, #fb923c99 6px, #fb923c99 12px)"
                      : "repeating-linear-gradient(135deg, #111 0px, #111 6px, #c0000099 6px, #c0000099 12px)";
                    const borderColor = isDepotMove ? "#fb923cbb" : "#c00000bb";
                    return (
                      <div key={`tr${ti}`}
                        title={isDepotMove ? `${depotLabel}: ${kmLabel} · ${minLabel}` : `Km en vacío: ${kmLabel} · ${minLabel}`}
                        style={{
                          position: "absolute", left, top: tTop,
                          width: Math.max(w, 4), height: tH,
                          background: bg,
                          border: `1px solid ${borderColor}`,
                          borderRadius: 3,
                          display: "flex", alignItems: "center", gap: 3,
                          overflow: "hidden", zIndex: 3, boxSizing: "border-box",
                          paddingLeft: 4,
                        }}
                      >
                        {w > 14 && (
                          isDepotMove ? (
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="#fb923c" stroke="none" style={{ flexShrink: 0, filter: "drop-shadow(0 0 2px #000)" }}>
                              <path d="M3 12l9-9 9 9M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9"/>
                            </svg>
                          ) : (
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" style={{ flexShrink: 0, filter: "drop-shadow(0 0 2px #000)" }}>
                              <path d="M5 12h14M13 6l6 6-6 6"/>
                            </svg>
                          )
                        )}
                        {w > 36 && kmLabel && (
                          <span style={{ fontSize: 9, color: "#fff", whiteSpace: "nowrap", fontWeight: 700, fontFamily: "monospace", textShadow: "0 0 4px #000, 0 0 4px #000" }}>
                            {kmLabel}
                          </span>
                        )}
                        {w > 72 && (
                          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.7)", whiteSpace: "nowrap", textShadow: "0 0 3px #000" }}>
                            · {isDepotMove ? depotLabel : minLabel}
                          </span>
                        )}
                      </div>
                    );
                  }

                  // PA stop block — derive label: prefer nombre/IdSAP over barrio
                  const color = barrioColor(task.barrio);
                  const paCode = task.nombre
                    || Object.entries(task.campos || {}).find(([k]) =>
                         ["pa","idsap","id_sap","codigopoint","codigo"].includes(k.toLowerCase())
                       )?.[1]
                    || "";
                  const label = paCode || task.barrio || "";
                  const isActive = stackPanel?.task === task;
                  const hasWindow = task.windowStart != null;
                  return (
                    <div key={ti} className="sched-block"
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.effectAllowed = "move";
                        setDragging({ task, fromRowId: row._id || row.id });
                        setTooltip(null);
                      }}
                      onDragEnd={() => setDragging(null)}
                      onClick={e => { e.stopPropagation(); openTaskPanel(task, row); setTooltip(null); }}
                      onMouseEnter={e => !dragging && setTooltip({ task, row, x: e.clientX, y: e.clientY })}
                      onMouseMove={e => !dragging && setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
                      onMouseLeave={() => setTooltip(null)}
                      style={{
                        position: "absolute", left, top: 5, height: ROW_H - 10, width: w, zIndex: 4,
                        background: isActive ? color : color + "d0",
                        border: `1px solid ${color}`,
                        boxShadow: isActive ? `0 0 0 2px ${color}, 0 4px 12px rgba(0,0,0,.5)` : "none",
                        borderRadius: 4, overflow: "visible", cursor: "grab",
                        display: "flex", alignItems: "center", gap: 3, padding: "0 4px",
                        opacity: dragging?.task === task ? 0.4 : 1,
                        transition: "box-shadow .1s, opacity .1s",
                      }}
                    >
                      {hasWindow && <ClockBadge />}
                      <div style={{ position: "absolute", inset: 0, borderRadius: 4, overflow: "hidden", display: "flex", alignItems: "center", gap: 3, padding: "0 4px" }}>
                        {w >= 14 && (
                          <>
                            <div style={{ width: 3, height: "60%", borderRadius: 2, background: "#fff", opacity: 0.5, flexShrink: 0 }} />
                            {w >= 22 && (
                              <span style={{ fontSize: Math.min(10, w / 5), color: "#fff", fontWeight: 600, overflow: "hidden", textOverflow: w >= 60 ? "ellipsis" : "clip", whiteSpace: "nowrap", lineHeight: 1.2 }}>
                                {w >= 60 ? label : label.slice(0, Math.max(2, Math.floor(w / 7)))}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Huecos válidos resaltados — visibles tras hacer clic en una
                    parada, solo en su propio día. Clicar coloca la parada ahí. */}
                {movePreview && movePreview.dayOffset === selectedDay * 1440 && movePreview.slotsByRowId.get(row._id || row.id)?.map((slot, si) => {
                  const left = (slot.arrival - selectedDay * 1440) * pxPerMin;
                  const w    = Math.max((slot.taskEnd - slot.arrival) * pxPerMin - 2, 6);
                  const color = slot.wait > 0 ? "#f59e0b" : "#34d399";
                  return (
                    <div key={`slot${si}`}
                      title={`Colocar aquí a las ${minToTime(slot.arrival % 1440)} · ${slot.kmDelta >= 0 ? "+" : ""}${slot.kmDelta.toFixed(2)} km${slot.wait > 0 ? ` · espera ${slot.wait} min` : ""}`}
                      onClick={e => { e.stopPropagation(); attemptMove(movePreview.task, movePreview.fromRow, row, slot, movePreview.dayOffset); }}
                      style={{
                        position: "absolute", left, top: 5, height: ROW_H - 10, width: w, zIndex: 6,
                        background: `${color}30`, border: `2px dashed ${color}`, borderRadius: 4,
                        cursor: "pointer", animation: "sched-pulse 1.2s ease-in-out infinite",
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          {rows.length === 0 && (
            <div style={{ padding: "48px 0", textAlign: "center", color: C.dim, fontSize: 13, width: labelW + chartW }}>Sin recursos asignados</div>
          )}
        </div>

        {/* Hover Tooltip */}
        {tooltip && !dragging && !stackPanel && (
          <div style={{
            position: "fixed",
            left: Math.min(tooltip.x + 14, window.innerWidth - 270),
            top: Math.max(tooltip.y - 70, 8),
            background: C.card, border: `1px solid ${C.border2}`,
            borderRadius: 9, padding: "11px 14px", zIndex: 2000,
            boxShadow: "0 8px 28px rgba(0,0,0,.6)",
            fontSize: 12, color: C.text, minWidth: 190, maxWidth: 270,
            pointerEvents: "none", animation: "sched-fadein .1s ease both",
          }}>
            {tooltip.task.barrio && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: barrioColor(tooltip.task.barrio), flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: C.muted }}>{tooltip.task.barrio}</span>
              </div>
            )}
            <div style={{ fontWeight: 700, marginBottom: 4, color: C.text, fontSize: 13 }}>
              {tooltip.task.nombre
                || Object.entries(tooltip.task.campos || {}).find(([k]) => ["pa","idsap","id_sap","codigopoint","codigo"].includes(k.toLowerCase()))?.[1]
                || tooltip.task.barrio || "Parada"}
            </div>
            <div style={{ color: C.muted, fontFamily: mono, fontSize: 11, marginBottom: 3 }}>
              {minToTime(tooltip.task._start % 1440)} → {minToTime(tooltip.task._end % 1440)}
              <span style={{ color: C.dim }}> · {tooltip.task.duracion || 15} min</span>
            </div>
            {(() => {
              const campos = tooltip.task.campos || {};
              const calle  = Object.entries(campos).find(([k]) => k.toLowerCase() === "calle")?.[1];
              const num    = Object.entries(campos).find(([k]) => ["num","num.","número","numero"].includes(k.toLowerCase()))?.[1];
              return calle ? <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{calle}{num ? ` ${num}` : ""}</div> : null;
            })()}
            {(() => {
              const row = tooltip.row;
              if (!row) return null;
              if (mode === "vehicles") {
                const linked = allWorkers.find(w => w.vehiculoId === (row._id || row.id));
                if (!linked) return null;
                const name = [linked.nombre, linked.apellidos].filter(Boolean).join(" ");
                return (
                  <div style={{ marginTop: 8, paddingTop: 7, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: C.greenDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: C.green, fontWeight: 700, flexShrink: 0 }}>{name[0]}</div>
                    <div>
                      <div style={{ fontSize: 10, color: C.dim, marginBottom: 1 }}>Conductor asignado</div>
                      <div style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>{name}</div>
                    </div>
                  </div>
                );
              }
              if (mode === "workers") {
                const vId = row.vehiculoId;
                if (!vId) return null;
                const v = allVehicles.find(v => (v._id || v.id) === vId);
                if (!v) return null;
                return (
                  <div style={{ marginTop: 8, paddingTop: 7, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 20, height: 20, borderRadius: 5, background: C.blueDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: C.blue, fontWeight: 700, flexShrink: 0 }}>🚛</div>
                    <div>
                      <div style={{ fontSize: 10, color: C.dim, marginBottom: 1 }}>Vehículo asignado</div>
                      <div style={{ fontSize: 11, color: C.blue, fontWeight: 600 }}>{v.nombre || v.matricula}{v.matricula && v.nombre ? ` · ${v.matricula}` : ""}</div>
                    </div>
                  </div>
                );
              }
              return null;
            })()}
          </div>
        )}

        {/* Stack panel — click-open detail + reassign */}
        {stackPanel && (
          <div style={{
            position: "fixed", right: 0, top: 0, bottom: 0, width: 300,
            background: C.card, borderLeft: `1px solid ${C.border2}`,
            zIndex: 3000, overflowY: "auto",
            boxShadow: "-8px 0 40px rgba(0,0,0,.55)",
            animation: "sched-fadein .15s ease both",
          }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "flex-start", gap: 10 }}>
              {stackPanel.task.barrio && (
                <div style={{ width: 12, height: 12, borderRadius: 3, background: barrioColor(stackPanel.task.barrio), flexShrink: 0, marginTop: 2 }} />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 }}>
                  {stackPanel.task.nombre
                    || Object.entries(stackPanel.task.campos || {}).find(([k]) => ["pa","idsap","id_sap","codigopoint","codigo"].includes(k.toLowerCase()))?.[1]
                    || stackPanel.task.barrio || "Parada"}
                </div>
                {stackPanel.task.barrio && <div style={{ fontSize: 10, color: C.muted }}>{stackPanel.task.barrio}</div>}
              </div>
              <button onClick={closePanel} style={{ background: "none", border: "none", color: C.dim, fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>×</button>
            </div>

            {/* Time + assigned resource */}
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>
                {minToTime(stackPanel.task._start % 1440)} → {minToTime(stackPanel.task._end % 1440)}
                <span style={{ color: C.dim }}> · {stackPanel.task.duracion || 15} min</span>
              </div>
              {stackPanel.task._start >= 1440 && (
                <div style={{ fontSize: 10, color: C.amber, marginTop: 3 }}>⏱ Turno de noche (continúa desde noche anterior)</div>
              )}
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: C.blueDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: C.blueText, fontWeight: 700, flexShrink: 0 }}>
                  {(stackPanel.row.nombre || "?")[0].toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.dim }}>Asignado a</div>
                  <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>
                    {[stackPanel.row.nombre, stackPanel.row.apellidos].filter(Boolean).join(" ") || stackPanel.row.matricula || "?"}
                  </div>
                </div>
              </div>
            </div>

            {/* Reasignar — huecos calculados por openTaskPanel; también se
                pueden ver y elegir directamente sobre el Gantt (resaltado). */}
            {onScheduleChange && rows.length > 1 && (
              <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 }}>Mover a</div>
                <div style={{ fontSize: 9.5, color: C.dim, marginBottom: 8, lineHeight: 1.4 }}>
                  Los huecos válidos también se resaltan en el Gantt — haz clic ahí para elegir un momento concreto.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {rows.filter(r => (r._id || r.id) !== (stackPanel.row._id || stackPanel.row.id)).map(r => {
                    const slots = movePreview?.slotsByRowId.get(r._id || r.id) || [];
                    const best = slots.length ? slots.reduce((a, b) => b.kmDelta < a.kmDelta ? b : a) : null;
                    return (
                      <button key={r._id || r.id} disabled={!best} onClick={() => {
                        if (!best) { rejectMove(); return; }
                        attemptMove(stackPanel.task, stackPanel.row, r, best, movePreview.dayOffset);
                      }} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                        background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 7,
                        cursor: best ? "pointer" : "not-allowed", textAlign: "left", transition: "border-color .1s",
                        opacity: best ? 1 : 0.45,
                      }}
                        onMouseEnter={e => best && (e.currentTarget.style.borderColor = C.blue)}
                        onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
                      >
                        <div style={{ width: 22, height: 22, borderRadius: "50%", background: C.surface2, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: C.muted, fontWeight: 700 }}>
                          {(r.nombre || "?")[0].toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>
                            {[r.nombre, r.apellidos].filter(Boolean).join(" ") || r.matricula || "?"}
                          </div>
                          <div style={{ fontSize: 10, color: C.dim }}>
                            {best
                              ? `${best.kmDelta >= 0 ? "+" : ""}${best.kmDelta.toFixed(2)} km${best.wait > 0 ? ` · espera ${best.wait} min` : ""}`
                              : "Sin hueco disponible"}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* All campos */}
            {Object.keys(stackPanel.task.campos || {}).length > 0 && (
              <div style={{ padding: "10px 16px" }}>
                <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 8 }}>Datos</div>
                {Object.entries(stackPanel.task.campos).filter(([, v]) => v != null && String(v).trim()).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 11 }}>
                    <span style={{ color: C.dim, minWidth: 80, flexShrink: 0, textOverflow: "ellipsis", overflow: "hidden" }}>{k}</span>
                    <span style={{ color: C.text, fontWeight: 500, wordBreak: "break-all" }}>{String(v)}</span>
                  </div>
                ))}
                {stackPanel.task.lat && stackPanel.task.lng && (
                  <div style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 11 }}>
                    <span style={{ color: C.dim, minWidth: 80 }}>Coords</span>
                    <span style={{ color: C.muted, fontFamily: mono, fontSize: 10 }}>{(+stackPanel.task.lat).toFixed(5)}, {(+stackPanel.task.lng).toFixed(5)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Jornada media del día — indicador rápido para detectar turnos
          descompensados (p.ej. mañana llena y tarde casi vacía) de un
          vistazo, sin tener que abrir cada fila una a una. ── */}
      {jornadaStats && (
        <div style={{
          flexShrink: 0, background: C.card, borderTop: `1px solid ${C.border}`,
          padding: "8px 16px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>Jornada media</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.blueText, fontFamily: mono }}>{fmtDurHM(jornadaStats.avg)}</span>
          <span style={{ fontSize: 11, color: C.dim, fontFamily: mono }}>
            mín {fmtDurHM(jornadaStats.min)} · máx {fmtDurHM(jornadaStats.max)}
          </span>
          <span style={{ fontSize: 11, color: C.muted }}>
            {jornadaStats.count} turno{jornadaStats.count !== 1 ? "s" : ""} con paradas
          </span>
          {jornadaStats.max - jornadaStats.min > 120 && (
            <span style={{ fontSize: 10.5, color: C.amber, display: "flex", alignItems: "center", gap: 4 }} title="Hay más de 2h de diferencia entre el turno más corto y el más largo del día">
              ⚠ turnos descompensados
            </span>
          )}
        </div>
      )}

      {/* ── Sin asignar — stack arrastrable para colocarlas a mano ── */}
      {unassigned.length > 0 && (
        <div style={{ flexShrink: 0, background: C.card, borderTop: `1px solid ${C.border}` }}>
          <button onClick={() => setUnassignedOpen(o => !o)} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8,
            padding: "6px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left",
          }}>
            <span style={{ fontSize: 9, color: C.red, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700 }}>Sin asignar</span>
            <span style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", color: C.red, borderRadius: 10, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>{unassigned.length}</span>
            <span style={{ fontSize: 10, color: C.dim }}>arrastra una parada a una fila para colocarla</span>
            <span style={{ fontSize: 10, color: C.dim, marginLeft: "auto" }}>{unassignedOpen ? "▲" : "▼"}</span>
          </button>
          {unassignedOpen && (
            <div style={{ padding: "6px 16px 10px", display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 140, overflowY: "auto" }}>
              {unassigned.map((task, i) => {
                const hasWindow = task.windowStart != null;
                const label = task.nombre || task.barrio || task.id || "?";
                const color = barrioColor(task.barrio);
                return (
                  <div key={task.id || i}
                    draggable
                    onDragStart={e => { e.dataTransfer.effectAllowed = "move"; setDragging({ task, fromRowId: null }); }}
                    onDragEnd={() => setDragging(null)}
                    title={hasWindow ? `Franja ${minToTime(task.windowStart % 1440)}–${minToTime((task.windowEnd ?? task.windowStart) % 1440)}` : label}
                    style={{
                      position: "relative", height: ROW_H - 22, minWidth: 60, background: color + "d0",
                      border: `1px solid ${color}`, borderRadius: 4, overflow: "visible", cursor: "grab",
                      display: "flex", alignItems: "center", gap: 3, padding: "0 6px",
                      opacity: dragging?.task === task ? 0.4 : 1,
                    }}
                  >
                    {hasWindow && <ClockBadge size={10} />}
                    <div style={{ width: 3, height: "60%", borderRadius: 2, background: "#fff", opacity: 0.5, flexShrink: 0 }} />
                    <span style={{ fontSize: 10.5, color: "#fff", fontWeight: 600, whiteSpace: "nowrap" }}>{label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── CONSTRAINTS PANEL ─────────────────────────────────────────────
function ConstraintsPanel({ c, onChange, orgId }) {
  const lang = useLang();
  const set = (key, val) => onChange({ ...c, [key]: val });

  // ── Plantillas de restricciones reutilizables entre proyectos ──
  const [templates, setTemplates] = useState([]);
  const [selectedTpl, setSelectedTpl] = useState("");

  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(
      query(collection(db, "scheduling_constraint_templates"), where("org_id", "==", orgId)),
      snap => setTemplates(snap.docs.map(d => ({ _id: d.id, ...d.data() })).sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""))),
      () => {}
    );
  }, [orgId]);

  async function guardarPlantilla() {
    const nombre = window.prompt("Nombre para esta plantilla de restricciones:");
    if (!nombre || !nombre.trim()) return;
    await addDoc(collection(db, "scheduling_constraint_templates"), {
      org_id: orgId, nombre: nombre.trim(), constraints: c, createdAt: serverTimestamp(),
    });
  }
  function cargarPlantilla(id) {
    setSelectedTpl(id);
    const tpl = templates.find(x => x._id === id);
    if (tpl) onChange({ ...c, ...tpl.constraints });
  }
  async function borrarPlantillaActual() {
    if (!selectedTpl) return;
    if (!window.confirm("¿Eliminar esta plantilla? No afecta a los proyectos donde ya se usó.")) return;
    await deleteDoc(doc(db, "scheduling_constraint_templates", selectedTpl));
    setSelectedTpl("");
  }
  const row = (label, children) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <label style={{ fontSize: 11, color: C.muted, width: 200, flexShrink: 0 }}>{label}</label>
      {children}
    </div>
  );
  const numInput = (key, min, max, suffix) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input type="number" min={min} max={max} value={c[key] || ""}
        onChange={e => set(key, parseInt(e.target.value) || 0)}
        style={{ width: 72, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: mono, outline: "none" }}
      />
      {suffix && <span style={{ fontSize: 11, color: C.dim }}>{suffix}</span>}
    </div>
  );
  const timeInput = (key) => (
    <input type="time"
      value={minToTime(c[key])}
      onChange={e => { const m = timeToMin(e.target.value); if (m !== null) set(key, m); }}
      style={{ background: C.surface2, border: `1px solid ${C.border}`, color: C.blueText, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: mono, outline: "none" }}
    />
  );
  const checkbox = (key) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
      <input type="checkbox" checked={!!c[key]} onChange={e => set(key, e.target.checked)}
        style={{ width: 15, height: 15, accentColor: C.blue, cursor: "pointer" }}
      />
    </label>
  );

  return (
    <div style={{
      background: C.surface2, borderBottom: `1px solid ${C.border}`,
      padding: "14px 20px", flexShrink: 0,
      animation: "sched-fadein .15s ease both",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>{t("restricciones", lang)}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase" }}>{t("plantillas", lang)}</span>
          <select
            value={selectedTpl}
            onChange={e => e.target.value ? cargarPlantilla(e.target.value) : setSelectedTpl("")}
            style={{ background: C.surface2, border: `1px solid ${C.border2}`, color: C.text, borderRadius: 6, padding: "4px 8px", fontSize: 11, fontFamily: font, cursor: "pointer", outline: "none", maxWidth: 160 }}
          >
            <option value="">— ninguna —</option>
            {templates.map(tpl => <option key={tpl._id} value={tpl._id}>{tpl.nombre}</option>)}
          </select>
          {selectedTpl && (
            <button onClick={borrarPlantillaActual} title="Eliminar esta plantilla" style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1 }}>×</button>
          )}
          <button onClick={guardarPlantilla} style={{
            padding: "4px 9px", background: "none", border: `1px solid ${C.border}`, color: C.muted,
            borderRadius: 6, fontSize: 10.5, cursor: "pointer", fontFamily: font, whiteSpace: "nowrap",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blue; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
          >Guardar como plantilla</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 40px" }}>
        {row("Duración máxima de turno (0 = sin límite)", numInput("maxShiftMin", 0, 1440, "min"))}
        {row("Máximo de paradas (0 = sin límite)", numInput("maxStops", 0, 500, "paradas"))}
        {row("Pausa automática cada", numInput("breakAfter", 0, 480, "min trabajo"))}
        {row("Duración de la pausa", numInput("breakDur", 0, 120, "min"))}
        {row("Ventana: hora de inicio", timeInput("startMin"))}
        {row("Ventana: hora de fin", timeInput("endMin"))}
        {row("Días máximos de escenario (0 = automático)", numInput("maxDays", 0, 365, "días"))}
        {row("Circularidad (vuelve donde empieza)", checkbox("circular"))}
      </div>
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: C.muted }}>Priorizar optimización</span>
          <span style={{ fontSize: 11, color: C.blueText, fontFamily: mono }}>
            {c.optimizeWeight > 0 ? `${c.optimizeWeight}% turnos` : "kilómetros"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase", flexShrink: 0 }}>Kilómetros</span>
          <input type="range" min={0} max={100} step={5} value={c.optimizeWeight || 0}
            onChange={e => set("optimizeWeight", parseInt(e.target.value))}
            style={{ flex: 1, accentColor: C.blue, cursor: "pointer" }}
          />
          <span style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase", flexShrink: 0 }}>Turnos</span>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: C.dim }}>
          Hacia "Kilómetros": rutas más compactas por vehículo, aunque la carga de trabajo quede desigual entre ellos.
          Hacia "Turnos": reparte el trabajo por tiempo estimado para evitar que un solo vehículo alargue los días del escenario, a costa de más km totales.
        </div>
      </div>
      {c.maxDays > 0 && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 10 }}>
            Si con la flota actual no caben todas las paradas en {c.maxDays} día{c.maxDays === 1 ? "" : "s"},
            se añadirán automáticamente los vehículos y conductores necesarios ("Vehículo necesario 1", "Conductor necesario 1"…) para cumplir el límite.
          </div>
          {row("Jornada máx. de los añadidos (0 = jornada completa)", numInput("virtualShiftMin", 0, 1440, "min"))}
        </div>
      )}
      {c.circular && (
        <div style={{ marginTop: 10, fontSize: 11, color: C.dim }}>
          Cada vehículo (y cada conductor, si hay relevo de turno en el mismo vehículo) termina su recorrido
          en el mismo punto donde lo empezó: el depósito si el vehículo tiene uno configurado, o si no,
          la ubicación de su primera parada del día.
        </div>
      )}
    </div>
  );
}

// ── VEHICLES TAB ──────────────────────────────────────────────────
export function TabVehiculos({ vehicles, loading, activeProject, orgId }) {
  const empty = { nombre: "", matricula: "", tipo: "Camión lateral", capacidad: "", turno: "Jornada completa", depotLat: "", depotLng: "" };
  const [form,   setForm]   = useState(empty);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [planningDepots, setPlanningDepots] = useState([]);
  const [showDepotPicker, setShowDepotPicker] = useState(null); // vehicleId | "new"

  // Load depots from Firestore planning_depots (migrated from localStorage)
  useEffect(() => {
    if (!activeProject?._id) return;
    const projectId = activeProject._id;
    return onSnapshot(doc(db, "planning_depots", projectId), snap => {
      if (snap.exists()) {
        setPlanningDepots(snap.data().depots ?? []);
      } else {
        // Fallback: legacy localStorage data
        try {
          const raw = localStorage.getItem(`fc_depots_${projectId}`);
          if (raw) setPlanningDepots(JSON.parse(raw) ?? []);
        } catch { /* ignore */ }
      }
    }, () => {
      try {
        const raw = localStorage.getItem(`fc_depots_${activeProject._id}`);
        if (raw) setPlanningDepots(JSON.parse(raw) ?? []);
      } catch { /* ignore */ }
    });
  }, [activeProject?._id]);

  const selStyle = { flex: 1, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: "8px 11px", fontSize: 12, fontFamily: font, outline: "none" };
  const inpStyle = { ...selStyle };

  async function create() {
    if (!form.nombre.trim()) return;
    if (!orgId) { alert("No se puede crear un vehículo sin org_id. Abre un proyecto primero."); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, "scheduling_vehicles"), {
        nombre: form.nombre.trim(), matricula: form.matricula.trim(),
        tipo: form.tipo, turno: form.turno,
        capacidad: parseInt(form.capacidad) || 0,
        depotLat: form.depotLat ? +form.depotLat : null,
        depotLng: form.depotLng ? +form.depotLng : null,
        activo: true, org_id: orgId, createdAt: serverTimestamp(),
      });
      setForm(empty); setAdding(false);
    } catch (e) { console.error("create vehicle:", e); alert("Error al crear vehículo: " + e.message); }
    setSaving(false);
  }

  async function save(id) {
    setSaving(true);
    try {
      await updateDoc(doc(db, "scheduling_vehicles", id), {
        nombre: editForm.nombre.trim(), matricula: editForm.matricula.trim(),
        tipo: editForm.tipo, turno: editForm.turno,
        capacidad: parseInt(editForm.capacidad) || 0,
        depotLat: editForm.depotLat ? +editForm.depotLat : null,
        depotLng: editForm.depotLng ? +editForm.depotLng : null,
      });
      setEditId(null);
    } catch (e) { console.error("save vehicle:", e); alert("Error al guardar."); }
    setSaving(false);
  }

  async function remove(id) {
    if (!window.confirm("¿Eliminar este vehículo?")) return;
    await deleteDoc(doc(db, "scheduling_vehicles", id));
  }

  function startEdit(v) {
    setEditId(v._id);
    setEditForm({ nombre: v.nombre || "", matricula: v.matricula || "", tipo: v.tipo || "Camión lateral", turno: v.turno || "Jornada completa", capacidad: v.capacidad || "", depotLat: v.depotLat ?? "", depotLng: v.depotLng ?? "" });
    setAdding(false);
  }

  const inp = (key, placeholder, type = "text") => (
    <input type={type} placeholder={placeholder} value={form[key]}
      onChange={e => setForm({ ...form, [key]: e.target.value })}
      onKeyDown={e => e.key === "Enter" && create()}
      style={inpStyle} />
  );

  const eInp = (key, placeholder, type = "text") => (
    <input type={type} placeholder={placeholder} value={editForm[key] ?? ""}
      onChange={e => setEditForm({ ...editForm, [key]: e.target.value })}
      onKeyDown={e => e.key === "Enter" && save(editId)}
      style={inpStyle} />
  );

  function DepotPicker({ onPick }) {
    if (planningDepots.length === 0) return (
      <div style={{ padding: "8px 12px", fontSize: 11, color: C.muted }}>No hay depots en Planning para este proyecto.</div>
    );
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {planningDepots.map(d => (
          <button key={d.id} onClick={() => onPick(d)} style={{
            background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6,
            color: C.text, fontSize: 12, padding: "6px 10px", cursor: "pointer",
            fontFamily: font, textAlign: "left", transition: "border-color .12s",
          }}
            onMouseEnter={e => e.currentTarget.style.borderColor = C.blue}
            onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
          >
            <span style={{ marginRight: 6 }}>🏠</span>
            <b>{d.nombre}</b>
            <span style={{ color: C.dim, marginLeft: 8, fontSize: 10, fontFamily: mono }}>{(+d.lat).toFixed(5)}, {(+d.lng).toFixed(5)}</span>
          </button>
        ))}
      </div>
    );
  }

  const depotSection = (formObj, setFormObj, pickerKey) => (
    <div style={{ marginTop: 10, padding: "10px 12px", background: C.surface2, borderRadius: 8, border: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: .5 }}>DEPOT (inicio/fin de turno)</span>
        {planningDepots.length > 0 && (
          <button onClick={() => setShowDepotPicker(showDepotPicker === pickerKey ? null : pickerKey)} style={{
            fontSize: 10, padding: "3px 8px", background: "none", border: `1px solid ${C.border}`, borderRadius: 5,
            color: C.blueText, cursor: "pointer", fontFamily: font,
          }}>Importar desde Planning</button>
        )}
      </div>
      {showDepotPicker === pickerKey && (
        <div style={{ marginBottom: 8 }}>
          <DepotPicker onPick={d => { setFormObj({ ...formObj, depotLat: String(d.lat), depotLng: String(d.lng) }); setShowDepotPicker(null); }} />
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input type="number" placeholder="Lat (ej: 41.3851)" value={formObj.depotLat ?? ""}
          onChange={e => setFormObj({ ...formObj, depotLat: e.target.value })}
          step="0.00001" style={{ ...inpStyle, flex: 1, minWidth: 0 }} />
        <input type="number" placeholder="Lng (ej: 2.1734)" value={formObj.depotLng ?? ""}
          onChange={e => setFormObj({ ...formObj, depotLng: e.target.value })}
          step="0.00001" style={{ ...inpStyle, flex: 1, minWidth: 0 }} />
        {(formObj.depotLat || formObj.depotLng) && (
          <button onClick={() => setFormObj({ ...formObj, depotLat: "", depotLng: "" })} title="Quitar depot"
            style={{ padding: "0 10px", background: "none", border: `1px solid ${C.border}`, color: C.dim, borderRadius: 7, cursor: "pointer", fontSize: 14, fontFamily: font }}>
            ×
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Vehículos</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{vehicles.length} registrado{vehicles.length !== 1 ? "s" : ""}</div>
        </div>
        <button onClick={() => { setAdding(!adding); setEditId(null); }} style={{
          padding: "7px 14px", background: adding ? C.surface2 : C.blueDim, border: `1px solid ${C.blue}44`,
          color: adding ? C.muted : C.blueText, borderRadius: 7, fontSize: 12, fontWeight: 600,
          cursor: "pointer", fontFamily: font, transition: "all .12s",
        }}>{adding ? "Cancelar" : "+ Añadir vehículo"}</button>
      </div>

      {adding && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 16, animation: "sched-fadein .15s ease both" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {inp("nombre", "Nombre (p.ej. Vehículo 01)")}
            {inp("matricula", "Matrícula")}
            {inp("capacidad", "Capacidad (m³)", "number")}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })} style={selStyle}>
              {VEHICLE_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <select value={form.turno} onChange={e => setForm({ ...form, turno: e.target.value })} style={selStyle}>
              {TURNO_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <button onClick={create} disabled={saving || !form.nombre.trim()} style={{
              padding: "8px 18px", background: C.blue, border: "none", color: "#fff",
              borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: saving ? "wait" : "pointer",
              fontFamily: font, opacity: !form.nombre.trim() ? .5 : 1,
            }}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
          {depotSection(form, setForm, "new")}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: C.dim, fontSize: 13 }}>Cargando…</div>
      ) : vehicles.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: C.dim, fontSize: 13 }}>No hay vehículos. Añade uno para empezar.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {vehicles.map(v => editId === v._id ? (
            <div key={v._id} style={{ background: C.card, border: `1px solid ${C.blue}55`, borderRadius: 10, padding: 14, animation: "sched-fadein .12s ease both" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {eInp("nombre", "Nombre")}
                {eInp("matricula", "Matrícula")}
                {eInp("capacidad", "Capacidad (m³)", "number")}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select value={editForm.tipo} onChange={e => setEditForm({ ...editForm, tipo: e.target.value })} style={selStyle}>
                  {VEHICLE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                <select value={editForm.turno} onChange={e => setEditForm({ ...editForm, turno: e.target.value })} style={selStyle}>
                  {TURNO_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                <button onClick={() => save(v._id)} disabled={saving} style={{ padding: "8px 16px", background: C.blue, border: "none", color: "#fff", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                  {saving ? "…" : "Guardar"}
                </button>
                <button onClick={() => setEditId(null)} style={{ padding: "8px 12px", background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 7, fontSize: 12, cursor: "pointer", fontFamily: font }}>
                  Cancelar
                </button>
              </div>
              {depotSection(editForm, setEditForm, v._id)}
            </div>
          ) : (
            <div key={v._id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: "11px 16px", display: "flex", alignItems: "center", gap: 14, animation: "sched-fadein .15s ease both" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.blueDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: C.blueText, flexShrink: 0 }}>
                {v.nombre[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{v.nombre}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {v.matricula && <span style={{ fontFamily: mono }}>{v.matricula}</span>}
                  <span>{v.tipo}</span>
                  {v.capacidad > 0 && <span>{v.capacidad} m³</span>}
                  {v.turno && <span style={{ color: C.blueText }}>{v.turno}</span>}
                  {v.depotLat && v.depotLng && (
                    <span style={{ color: "#fb923c", display: "flex", alignItems: "center", gap: 3 }}>
                      🏠 {(+v.depotLat).toFixed(4)}, {(+v.depotLng).toFixed(4)}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => startEdit(v)} title="Editar" style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .12s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blueText; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}>
                ✎
              </button>
              <button onClick={() => remove(v._id)} title="Eliminar" style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .12s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── WORKERS TAB ───────────────────────────────────────────────────
export function TabTrabajadores({ workers, vehicles, loading, orgId }) {
  const empty = { nombre: "", apellidos: "", turno: "Mañana (06-14)", rol: "conductor", vehiculoId: "" };
  const [form,     setForm]     = useState(empty);
  const [adding,   setAdding]   = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [editId,   setEditId]   = useState(null);
  const [editForm, setEditForm] = useState({});

  const selStyle = { flex: 1, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: "8px 11px", fontSize: 12, fontFamily: font, outline: "none" };

  async function create() {
    if (!form.nombre.trim()) return;
    if (!orgId) { alert("No se puede crear un trabajador sin org_id. Abre un proyecto primero."); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, "scheduling_workers"), {
        nombre: form.nombre.trim(), apellidos: form.apellidos.trim(),
        turno: form.turno, rol: form.rol,
        vehiculoId: form.vehiculoId || "",
        activo: true, org_id: orgId, createdAt: serverTimestamp(),
      });
      setForm(empty); setAdding(false);
    } catch (e) { console.error("create worker:", e); alert("Error al crear trabajador: " + e.message); }
    setSaving(false);
  }

  async function save(id) {
    setSaving(true);
    try {
      await updateDoc(doc(db, "scheduling_workers", id), {
        nombre: editForm.nombre.trim(), apellidos: (editForm.apellidos || "").trim(),
        turno: editForm.turno, rol: editForm.rol,
        vehiculoId: editForm.vehiculoId || "",
      });
      setEditId(null);
    } catch (e) { console.error("save worker:", e); alert("Error al guardar."); }
    setSaving(false);
  }

  async function remove(id) {
    if (!window.confirm("¿Eliminar este trabajador?")) return;
    await deleteDoc(doc(db, "scheduling_workers", id));
  }

  function startEdit(w) {
    setEditId(w._id);
    setEditForm({ nombre: w.nombre || "", apellidos: w.apellidos || "", turno: w.turno || "Mañana (06-14)", rol: w.rol || "conductor", vehiculoId: w.vehiculoId || "" });
    setAdding(false);
  }

  const inp = (key, placeholder) => (
    <input type="text" placeholder={placeholder} value={form[key]}
      onChange={e => setForm({ ...form, [key]: e.target.value })}
      onKeyDown={e => e.key === "Enter" && create()}
      style={selStyle} />
  );

  const eInp = (key, placeholder) => (
    <input type="text" placeholder={placeholder} value={editForm[key] ?? ""}
      onChange={e => setEditForm({ ...editForm, [key]: e.target.value })}
      onKeyDown={e => e.key === "Enter" && save(editId)}
      style={selStyle} />
  );

  const VehicleSelect = ({ value, onChange }) => (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ ...selStyle, color: value ? C.text : C.dim }}>
      <option value="">Sin vehículo asignado</option>
      {(vehicles || []).map(v => <option key={v._id} value={v._id}>{v.nombre || v.matricula}{v.matricula && v.nombre ? ` (${v.matricula})` : ""}</option>)}
    </select>
  );

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Trabajadores</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{workers.length} registrado{workers.length !== 1 ? "s" : ""}</div>
        </div>
        <button onClick={() => { setAdding(!adding); setEditId(null); }} style={{
          padding: "7px 14px", background: adding ? C.surface2 : C.blueDim, border: `1px solid ${C.blue}44`,
          color: adding ? C.muted : C.blueText, borderRadius: 7, fontSize: 12, fontWeight: 600,
          cursor: "pointer", fontFamily: font, transition: "all .12s",
        }}>{adding ? "Cancelar" : "+ Añadir trabajador"}</button>
      </div>

      {adding && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 16, animation: "sched-fadein .15s ease both" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {inp("nombre", "Nombre")}
            {inp("apellidos", "Apellidos")}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <select value={form.turno} onChange={e => setForm({ ...form, turno: e.target.value })} style={selStyle}>
              {TURNO_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <div style={{ display: "flex", gap: 4, background: C.surface2, borderRadius: 6, padding: 3 }}>
              {[["conductor","Conductor"],["supervisor","Supervisor"]].map(([v, l]) => (
                <button key={v} onClick={() => setForm({ ...form, rol: v })} style={{
                  padding: "5px 10px", borderRadius: 4, border: "none", cursor: "pointer",
                  background: form.rol === v ? C.blue : "none",
                  color: form.rol === v ? "#fff" : C.muted,
                  fontSize: 11, fontFamily: font, transition: "all .12s",
                }}>{l}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <VehicleSelect value={form.vehiculoId} onChange={v => setForm({ ...form, vehiculoId: v })} />
            <button onClick={create} disabled={saving || !form.nombre.trim()} style={{
              padding: "8px 18px", background: C.blue, border: "none", color: "#fff",
              borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: saving ? "wait" : "pointer",
              fontFamily: font, opacity: !form.nombre.trim() ? .5 : 1,
            }}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: C.dim, fontSize: 13 }}>Cargando…</div>
      ) : workers.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: C.dim, fontSize: 13 }}>No hay trabajadores. Añade uno para empezar.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {workers.map(w => editId === w._id ? (
            <div key={w._id} style={{ background: C.card, border: `1px solid ${C.blue}55`, borderRadius: 10, padding: 14, animation: "sched-fadein .12s ease both" }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                {eInp("nombre", "Nombre")}
                {eInp("apellidos", "Apellidos")}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <select value={editForm.turno} onChange={e => setEditForm({ ...editForm, turno: e.target.value })} style={selStyle}>
                  {TURNO_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                <div style={{ display: "flex", gap: 4, background: C.surface2, borderRadius: 6, padding: 3 }}>
                  {[["conductor","Conductor"],["supervisor","Supervisor"]].map(([v, l]) => (
                    <button key={v} onClick={() => setEditForm({ ...editForm, rol: v })} style={{
                      padding: "5px 10px", borderRadius: 4, border: "none", cursor: "pointer",
                      background: editForm.rol === v ? C.blue : "none",
                      color: editForm.rol === v ? "#fff" : C.muted,
                      fontSize: 11, fontFamily: font, transition: "all .12s",
                    }}>{l}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <VehicleSelect value={editForm.vehiculoId} onChange={v => setEditForm({ ...editForm, vehiculoId: v })} />
                <button onClick={() => save(w._id)} disabled={saving} style={{ padding: "8px 16px", background: C.blue, border: "none", color: "#fff", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                  {saving ? "…" : "Guardar"}
                </button>
                <button onClick={() => setEditId(null)} style={{ padding: "8px 12px", background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 7, fontSize: 12, cursor: "pointer", fontFamily: font }}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div key={w._id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: "11px 16px", display: "flex", alignItems: "center", gap: 14, animation: "sched-fadein .15s ease both" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.greenDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: C.green, flexShrink: 0, fontWeight: 700 }}>
                {w.nombre[0].toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{w.nombre} {w.apellidos}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span>{w.turno}</span>
                  <span style={{ color: w.rol === "supervisor" ? C.amber : C.dim }}>{w.rol}</span>
                  {(() => {
                    const v = (vehicles || []).find(v => v._id === w.vehiculoId);
                    return v
                      ? <span style={{ color: C.blue, background: C.blueDim, borderRadius: 4, padding: "1px 6px", fontSize: 10 }}>🚛 {v.nombre || v.matricula}</span>
                      : <span style={{ color: C.red, fontSize: 10 }}>Sin vehículo</span>;
                  })()}
                </div>
              </div>
              <button onClick={() => startEdit(w)} title="Editar" style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .12s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blueText; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}>
                ✎
              </button>
              <button onClick={() => remove(w._id)} title="Eliminar" style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .12s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── helpers for loading tasks from planning_layers ────────────────
const BARRIO_KEYS_VRP = ["barri","barrio","barri_nom","sector","zona","zone","district",
                         "districte","municipio","area","neighbourhood","neighborhood"];
function extractFieldVRP(fields, keys) {
  for (const [k, v] of Object.entries(fields || {})) {
    if (keys.includes(k.toLowerCase().trim()) && v) return String(v);
  }
  return "";
}
async function loadTasksFromLayers(projectId) {
  const snap = await getDocs(
    query(collection(db, "planning_layers"), where("projectId", "==", projectId))
  );
  const mainDocs  = snap.docs.filter(d => !d.id.match(/_c\d+$/));
  const chunkDocs = snap.docs.filter(d =>  d.id.match(/_c\d+$/));

  const assembled = await Promise.all(mainDocs.map(async d => {
    const layer = { _docId: d.id, ...d.data() };
    if (layer.localOnly) {
      layer.markers = await idbGet(d.id).catch(() => []);
    } else if (layer.chunked) {
      const chunks = chunkDocs
        .filter(c => c.data().layerId === layer.id)
        .sort((a, b) => a.data().chunkIndex - b.data().chunkIndex);
      layer.markers = chunks.flatMap(c => c.data().markers || []);
    }
    return layer;
  }));

  const allTasks = [];
  assembled.forEach(layer => {
    if (!layer.visible) return;
    (layer.markers || []).forEach(m => {
      const lat = parseFloat(m.lat), lng = parseFloat(m.lng);
      if (!isFinite(lat) || !isFinite(lng)) return;
      // IDB markers are flat { lat, lng, Barrio: "X", ... }; Firestore markers nest under .campos/.fields
      const nested = m.campos || m.fields || null;
      const fields = (nested && Object.keys(nested).length > 0) ? nested : m;
      const nombre = extractFieldVRP(fields, ["nombre","name","calle","street"]) || "";
      const barrio = extractFieldVRP(fields, BARRIO_KEYS_VRP) || "";
      const puntoKey = `${lat.toFixed(5)}_${lng.toFixed(5)}`;
      allTasks.push({ _id: puntoKey, lat, lng, nombre, barrio, campos: fields, layerColor: layer.color });
    });
  });

  // Franja horaria del Timetable (Planning) → ventana horaria del VRP.
  // "Hora inicio" (un único valor) es una hora exacta obligatoria: ventana
  // de un solo instante [h, h]. "Franja horaria" es un rango [inicio, fin]
  // y manda si está puesta. Sin ninguno de los dos, la tarea sigue libre —
  // el algoritmo la coloca donde le convenga, como hasta ahora.
  try {
    const ttSnap = await getDocs(collection(db, "scheduling_projects", projectId, "timetable"));
    const byPunto = new Map(ttSnap.docs.map(d => [d.id, d.data()]));
    if (byPunto.size) {
      for (const t of allTasks) {
        const e = byPunto.get(t._id);
        if (!e) continue;
        let windowStart = null, windowEnd = null;
        if (e.franjaInicio) {
          windowStart = timeToMin(e.franjaInicio);
          windowEnd   = e.franjaFin ? timeToMin(e.franjaFin) : windowStart;
        } else if (e.horaInicio) {
          windowStart = windowEnd = timeToMin(e.horaInicio);
        }
        if (windowStart != null) { t.windowStart = windowStart; t.windowEnd = windowEnd; }
        if (e.duracion != null && t.duracion == null) t.duracion = e.duracion;
      }
    }
  } catch { /* sin timetable — las tareas siguen sin ventana, comportamiento de siempre */ }

  // Apply default duration from project settings (set in Timetable tab)
  try {
    const settingsSnap = await getDoc(doc(db, "planning_settings", projectId));
    if (settingsSnap.exists()) {
      const defDur = settingsSnap.data().defaultDuracion;
      if (defDur != null && defDur > 0) {
        allTasks.forEach(t => { if (t.duracion == null) t.duracion = defDur; });
      }
    }
  } catch {}

  return allTasks;
}

// Reparte las assignments de UN vehículo entre los conductores vinculados a
// él, según a qué ventana (turno) pertenece cada bloque — misma regla de
// "dueño" que runGenerate (primer conductor cuya ventana contiene el inicio
// del bloque; el regreso a depósito se atribuye a quien tenga esa hora
// dentro de su ventana, o al último del día si cae justo fuera por el
// redondeo). Se usa para volver a derivar la vista de conductores después
// de un movimiento manual a nivel de vehículo, y para traducir un
// movimiento hecho a nivel de conductor al vehículo real que lo sostiene
// (turnos.jsx no tiene rutas propias, siempre son las del vehículo).
function deriveWorkerRows(vehicleRow, peersIn, startMin) {
  const peers = [...peersIn].sort((a, b) =>
    a._tw.start !== b._tw.start ? a._tw.start - b._tw.start : (a.nombre || "").localeCompare(b.nombre || "")
  );
  return peers.map(w => {
    const wId = w._id || w.id;
    const myAssignments = (vehicleRow.assignments || []).filter(a => {
      const dayOffset = Math.floor((a._start - startMin) / 1440) * 1440;
      const tStart = a._start - dayOffset;
      if (a._depot_return) {
        const owner = peers.find(p => tStart >= p._tw.start && tStart < p._tw.end);
        if (owner) return (owner._id || owner.id) === wId;
        const last = peers.reduce((best, p) => !best || p._tw.end > best._tw.end ? p : best, null);
        return last && (last._id || last.id) === wId;
      }
      const owner = peers.find(p => tStart >= p._tw.start && tStart < p._tw.end);
      return owner && (owner._id || owner.id) === wId;
    });
    const myKm = myAssignments.filter(a => a._travel).reduce((s, a) => s + (a.km || 0), 0);
    return { ...w, assignments: myAssignments, totalKm: myKm };
  });
}

// Sustituye, dentro de la lista completa de un vehículo, todo lo que cae en
// la ventana (turno) de UN conductor por su nuevo contenido ya calculado —
// así un movimiento hecho a nivel de conductor (fila más estrecha, ya
// acotada a su propio turno) se traslada al vehículo (la lista completa,
// fuente real de la ruta) sin arriesgarse a coger como vecina una parada de
// OTRO conductor del mismo vehículo.
function spliceWorkerWindowIntoVehicle(vehicleRow, worker, dayOffset, newWorkerAssignments) {
  const wStart = dayOffset + worker._tw.start;
  const wEnd   = dayOffset + worker._tw.end;
  const rest = (vehicleRow.assignments || []).filter(a => !(a._start >= wStart && a._start < wEnd));
  return [...rest, ...newWorkerAssignments].sort((a, b) => a._start - b._start);
}

// ── PLANIFICACION TAB ─────────────────────────────────────────────
export function TabPlanificacion({ vehicles, workers, activeProject, onProjectUpdate, orgId }) {
  const lang = useLang();
  const [tasks,        setTasks]       = useState([]);
  const [loadingTasks, setLoadingTasks]= useState(false);

  // Load tasks when project opens (from IDB for large localOnly layers, Firestore for rest)
  useEffect(() => {
    setTasks([]);
    if (!activeProject?._id || !activeProject?.planning?.tasksCount) return;
    setLoadingTasks(true);
    loadTasksFromLayers(activeProject._id)
      .then(t => { setTasks(t); setLoadingTasks(false); })
      .catch(() => setLoadingTasks(false));
  }, [activeProject?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [importing,    setImporting]   = useState(false);
  const [mode,         setMode]        = useState("vehicles");
  const [showC,        setShowC]       = useState(false);
  const [showHistorial, setShowHistorial] = useState(false);
  const [scenarioHistory, setScenarioHistory] = useState([]);
  const [showSimulador, setShowSimulador] = useState(false);
  const [simDelta,     setSimDelta]     = useState(1);
  const [simRunning,   setSimRunning]   = useState(false);
  const [simResult,    setSimResult]    = useState(null);
  const [simError,     setSimError]     = useState(null);
  const [constraints,  setConstraints] = useState({
    maxShiftMin: 0, maxStops: 0, breakAfter: 240, breakDur: 30,
    startMin: 360, endMin: 1320, days: 1, maxDays: 0, circular: false,
    optimizeWeight: 0, virtualShiftMin: 0,
  });
  const [schedules,    setSchedules]   = useState({ vehicles: null, workers: null });
  const [moveHistory,  setMoveHistory] = useState([]); // { beforeVehicles, afterVehicles, beforeWorkers, afterWorkers, unassignedTask, label }
  const [historyIndex, setHistoryIndex] = useState(-1); // -1 = nada aplicado todavía
  const [unassigneds,  setUnassigneds] = useState({ vehicles: [], workers: [] });
  const [showDayStrip, setShowDayStrip] = useState(true);
  const [generating,   setGenerating]  = useState(false);
  const [osrmRunning,  setOsrmRunning] = useState(false);
  const [genError,     setGenError]    = useState(null);
  const [scaleInfo,    setScaleInfo]   = useState(null);
  const [genPhase,     setGenPhase]    = useState(null); // "vrp"|"osrm"|"workers"|"saving"
  const [focusMode,    setFocusMode]   = useState(false); // hide all panels except gantt
  const [elapsedSec,   setElapsedSec]  = useState(0);
  const genStartRef = useRef(null);

  const GEN_PHASES = {
    vrp:     { label: "Calculando rutas VRP…",            pct: 20 },
    osrm:    { label: "Calculando km reales por carretera…", pct: 55 },
    workers: { label: "Asignando trabajadores…",          pct: 78 },
    saving:  { label: "Guardando resultado…",             pct: 92 },
  };

  // Elapsed-time counter — starts when generating=true, resets when done
  useEffect(() => {
    if (!generating) { setElapsedSec(0); return; }
    genStartRef.current = Date.now();
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - genStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [generating]);

  const [publishModal, setPublishModal] = useState(null);
  const [publishing,   setPublishing]  = useState(false);

  // ── Rostering integration ────────────────────────────────────
  const [schedYear, schedMonth] = (activeProject?.mes ?? "").split("-").map(Number);
  const { grid: rosterGrid } = useRostering(orgId, schedYear || null, schedMonth || null);

  // Compute worker-day conflicts after VRP (L/B days assigned to routes)
  const rosterConflicts = (() => {
    if (!schedules.vehicles || !rosterGrid) return [];
    const conflicts = [];
    for (const row of schedules.vehicles) {
      const linked = workers.filter(w => w.vehiculoId === (row._id || row.id));
      if (!linked.length) continue;
      const byDay = {};
      for (const a of row.assignments) {
        if (a._break || a._travel || a._wait) continue;
        const d = Math.floor((a._start - constraints.startMin) / 1440) + 1;
        byDay[d] = true;
      }
      for (const w of linked) {
        for (const day of Object.keys(byDay).map(Number)) {
          const code = workerCodeOnDay(rosterGrid, w._id, day);
          if (isUnavailable(code)) {
            conflicts.push({
              name: [w.nombre, w.apellidos].filter(Boolean).join(" "),
              day,
              code,
              label: SHIFT_META[code]?.label ?? code,
            });
          }
        }
      }
    }
    return conflicts;
  })();

  const schedule   = schedules[mode];
  const unassigned = unassigneds[mode];
  // Only use saved constraints.days when there is actually a loaded schedule;
  // an empty array [] is truthy in JS but means "no data yet".
  const activeDays = schedule?.length > 0 ? (constraints.days || 1) : 1;

  // Reasignación manual de paradas en el Gantt (mover de vehículo/trabajador)
  // — historial tipo Excel: cada movimiento guarda el estado de TODOS los
  // vehículos y conductores afectados (no solo la fila que se ve en el modo
  // actual), así "atrás"/"adelante" es exacto y vehículos/conductores nunca
  // se desincronizan entre sí.
  //
  // Los conductores nunca tienen ruta propia — son siempre un recorte por
  // horario de la del vehículo (ver runGenerate/deriveWorkerRows) — así que
  // el vehículo es la fuente de verdad. Cualquier cambio, se haga desde el
  // modo "Vehículos" o desde "Trabajadores", se aplica primero al/los
  // vehículo(s) afectado(s) y desde ahí se re-derivan sus conductores
  // vinculados, para que las dos vistas nunca queden descoordinadas.
  const describeRowLabel = r => [r?.nombre, r?.apellidos].filter(Boolean).join(" ") || r?.matricula || r?.turno || "recurso";

  const applyVehicleWorkerState = (vehicleMap, workerMap) => {
    setSchedules(prev => ({
      vehicles: (prev.vehicles || []).map(v => {
        const vid = v._id || v.id;
        return vid in vehicleMap ? { ...v, assignments: vehicleMap[vid] } : v;
      }),
      workers: (prev.workers || []).map(w => {
        const wid = w._id || w.id;
        return wid in workerMap ? { ...w, assignments: workerMap[wid] } : w;
      }),
    }));
  };

  // vehicleUpdates: [{ vehicleId, newAssignments }]. Re-deriva los
  // conductores vinculados a cada vehículo tocado y guarda un único paso de
  // historial con el antes/después de vehículos + conductores + (si aplica)
  // la tarea que entra o sale de "sin asignar".
  const commitVehicleChange = (vehicleUpdates, { unassignedTask, label } = {}) => {
    const vehiclesArr = schedules.vehicles || [];
    const workersArr  = schedules.workers  || [];
    const beforeVehicles = {}, afterVehicles = {};
    const beforeWorkers  = {}, afterWorkers  = {};

    let working = vehiclesArr;
    for (const { vehicleId, newAssignments } of vehicleUpdates) {
      const prevRow = vehiclesArr.find(v => (v._id || v.id) === vehicleId);
      if (!prevRow) continue;
      beforeVehicles[vehicleId] = prevRow.assignments;
      afterVehicles[vehicleId]  = newAssignments;
      working = working.map(v => (v._id || v.id) === vehicleId ? { ...v, assignments: newAssignments } : v);

      const peers = workersArr.filter(w => w.vehiculoId === vehicleId);
      if (peers.length) {
        const updatedRow = working.find(v => (v._id || v.id) === vehicleId);
        for (const w of deriveWorkerRows(updatedRow, peers, constraints.startMin)) {
          const wid = w._id || w.id;
          if (!(wid in beforeWorkers)) {
            const prevW = workersArr.find(x => (x._id || x.id) === wid);
            beforeWorkers[wid] = prevW ? prevW.assignments : [];
          }
          afterWorkers[wid] = w.assignments;
        }
      }
    }

    const entry = { beforeVehicles, afterVehicles, beforeWorkers, afterWorkers, unassignedTask: unassignedTask || null, label };
    setMoveHistory(h => [...h.slice(0, historyIndex + 1), entry]);
    setHistoryIndex(i => i + 1);
    applyVehicleWorkerState(afterVehicles, afterWorkers);
    if (unassignedTask) {
      setUnassigneds(prev => ({
        vehicles: (prev.vehicles || []).filter(t => t.id !== unassignedTask.id),
        workers:  (prev.workers  || []).filter(t => t.id !== unassignedTask.id),
      }));
    }
  };

  const handleScheduleChange = ({ fromRow, toRow, newFromAssignments, newToAssignments, dayOffset, label }) => {
    const fromRowId = fromRow._id || fromRow.id;
    const toRowId   = toRow._id || toRow.id;

    if (mode === "vehicles") {
      const updates = fromRowId === toRowId
        ? [{ vehicleId: toRowId, newAssignments: newToAssignments }]
        : [{ vehicleId: fromRowId, newAssignments: newFromAssignments }, { vehicleId: toRowId, newAssignments: newToAssignments }];
      commitVehicleChange(updates, { label });
      return;
    }

    // mode === "workers": newFromAssignments/newToAssignments ya vienen
    // acotados al turno de cada conductor (computeCandidateSlots usó su
    // _tw) — se trasladan al vehículo real sustituyendo solo el contenido
    // de esa ventana, no la ruta entera.
    const fromVehicleRow = (schedules.vehicles || []).find(v => (v._id || v.id) === fromRow.vehiculoId);
    const toVehicleRow   = (schedules.vehicles || []).find(v => (v._id || v.id) === toRow.vehiculoId);
    if (!fromVehicleRow || !toVehicleRow) {
      window.alert("No se puede reflejar este cambio en el vehículo: el conductor de origen o de destino no está vinculado a ningún vehículo. El movimiento se ha cancelado.");
      return;
    }
    const fromVehicleId = fromVehicleRow._id || fromVehicleRow.id;
    const toVehicleId   = toVehicleRow._id || toVehicleRow.id;
    if (fromVehicleId === toVehicleId) {
      let va = spliceWorkerWindowIntoVehicle(fromVehicleRow, fromRow, dayOffset, newFromAssignments);
      va = spliceWorkerWindowIntoVehicle({ ...fromVehicleRow, assignments: va }, toRow, dayOffset, newToAssignments);
      commitVehicleChange([{ vehicleId: fromVehicleId, newAssignments: va }], { label });
    } else {
      const vaFrom = spliceWorkerWindowIntoVehicle(fromVehicleRow, fromRow, dayOffset, newFromAssignments);
      const vaTo   = spliceWorkerWindowIntoVehicle(toVehicleRow, toRow, dayOffset, newToAssignments);
      commitVehicleChange([
        { vehicleId: fromVehicleId, newAssignments: vaFrom },
        { vehicleId: toVehicleId,   newAssignments: vaTo },
      ], { label });
    }
  };

  // Colocar a mano una parada del stack de "sin asignar". Si estamos en
  // modo Trabajadores, se traduce igual que un movimiento: se calcula sobre
  // la fila del conductor (acotada a su turno) y se traslada al vehículo
  // real. Si el conductor no está vinculado a un vehículo, no hay dónde
  // reflejarlo de verdad — se avisa con una alarma y no se coloca nada, en
  // vez de dejar vehículo/conductor desincronizados.
  const placeUnassignedTask = (task, toRow, slot, dayOffset) => {
    if (mode === "vehicles") {
      const { newToAssignments } = applyTaskMove(task, { assignments: [] }, toRow, slot, dayOffset);
      commitVehicleChange([{ vehicleId: toRow._id || toRow.id, newAssignments: newToAssignments }], {
        unassignedTask: task, label: `Colocado en ${describeRowLabel(toRow)}`,
      });
      return;
    }
    const vehicleRow = (schedules.vehicles || []).find(v => (v._id || v.id) === toRow.vehiculoId);
    if (!vehicleRow) {
      window.alert(`No se puede colocar esta parada: "${describeRowLabel(toRow)}" no está vinculado a ningún vehículo.`);
      return;
    }
    const { newToAssignments: newWorkerAssignments } = applyTaskMove(task, { assignments: [] }, toRow, slot, dayOffset);
    const newVehicleAssignments = spliceWorkerWindowIntoVehicle(vehicleRow, toRow, dayOffset, newWorkerAssignments);
    commitVehicleChange([{ vehicleId: vehicleRow._id || vehicleRow.id, newAssignments: newVehicleAssignments }], {
      unassignedTask: task, label: `Colocado en ${describeRowLabel(toRow)}`,
    });
  };

  const canUndoMove = historyIndex >= 0;
  const canRedoMove = historyIndex < moveHistory.length - 1;

  const undoMove = () => {
    if (!canUndoMove) return;
    const entry = moveHistory[historyIndex];
    applyVehicleWorkerState(entry.beforeVehicles, entry.beforeWorkers);
    if (entry.unassignedTask) {
      setUnassigneds(prev => ({
        vehicles: [...(prev.vehicles || []), entry.unassignedTask],
        workers:  [...(prev.workers  || []), entry.unassignedTask],
      }));
    }
    setHistoryIndex(i => i - 1);
  };
  const redoMove = () => {
    if (!canRedoMove) return;
    const entry = moveHistory[historyIndex + 1];
    applyVehicleWorkerState(entry.afterVehicles, entry.afterWorkers);
    if (entry.unassignedTask) {
      setUnassigneds(prev => ({
        vehicles: (prev.vehicles || []).filter(t => t.id !== entry.unassignedTask.id),
        workers:  (prev.workers  || []).filter(t => t.id !== entry.unassignedTask.id),
      }));
    }
    setHistoryIndex(i => i + 1);
  };

  // When active project changes, restore its scheduling state (IndexedDB first, Firestore summary as fallback)
  useEffect(() => {
    setMoveHistory([]); setHistoryIndex(-1); // el historial de deshacer no sobrevive a un cambio de proyecto
    if (!activeProject) {
      setSchedules({ vehicles: null, workers: null });
      return;
    }
    const sc = activeProject.scheduling;
    idbLoad(`vrp_${activeProject._id}`).then(cached => {
      if (cached?.vehicles?.length) {
        setSchedules({ vehicles: cached.vehicles, workers: cached.workers || [] });
        if (sc?.constraints) setConstraints(prev => ({ ...prev, ...sc.constraints, days: sc.daysUsed || 1 }));
      } else if (sc) {
        setSchedules({ vehicles: sc.vehicleSchedule || [], workers: sc.workerSchedule || [] });
        setConstraints(prev => ({ ...prev, ...(sc.constraints || {}), days: sc.daysUsed || 1 }));
      } else {
        setSchedules({ vehicles: null, workers: null });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?._id]);

  // Historial de versiones del escenario (solo métricas — ver comentario
  // junto a addDoc en runGenerate) — últimas 20, más reciente primero.
  useEffect(() => {
    if (!activeProject?._id) { setScenarioHistory([]); return; }
    return onSnapshot(
      query(collection(db, "scheduling_projects", activeProject._id, "scenario_history"), limit(100)),
      snap => {
        const rows = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
          .sort((a, b) => (b.generatedAt?.toMillis?.() ?? 0) - (a.generatedAt?.toMillis?.() ?? 0));
        setScenarioHistory(rows.slice(0, 20));
      },
      () => {}
    );
  }, [activeProject?._id]);

  async function importFromPlanning() {
    if (!activeProject) return;
    setImporting(true);
    try {
      const allTasks = await loadTasksFromLayers(activeProject._id);

      if (allTasks.length === 0) {
        alert("No hay puntos en planning para este proyecto.\nVe a Planning, sube el Excel y vuelve aquí a importar.");
        setImporting(false);
        return;
      }

      const uniqueBarrios = [...new Set(allTasks.map(t => t.barrio).filter(Boolean))];
      setTasks(allTasks);
      onProjectUpdate({
        planning: {
          tasksCount: allTasks.length,
          importedAt: new Date().toISOString(),
          uniqueBarrios: uniqueBarrios.slice(0, 30),
        },
        status: "con_planning",
      });
    } catch (e) {
      console.error("importFromPlanning:", e);
      alert("Error al importar: " + e.message);
    }
    setImporting(false);
  }

  async function runGenerate() {
    if (!tasks.length) return;
    if (!vehicles.length && !workers.length) return;
    setGenerating(true);
    setGenError(null);
    setScaleInfo(null);
    setGenPhase("vrp");
    await new Promise(resolve => setTimeout(resolve, 30)); // let React render the phase

    try {
      // Read Planning depots from Firestore as fallback depot for vehicles
      let planningDepot = null;
      try {
        if (activeProject?._id) {
          const snap = await getDoc(doc(db, "planning_depots", activeProject._id));
          if (snap.exists()) {
            const list = snap.data().depots ?? [];
            if (list.length > 0) planningDepot = { lat: +list[0].lat, lng: +list[0].lng };
          }
        }
      } catch { /* ignore */ }

      // Inject planning depot into vehicles that have no depot set
      const vehiclesWithDepot = vehicles.map(v => {
        if (v.depotLat && v.depotLng) return v;
        if (!planningDepot) return v;
        return { ...v, depotLat: planningDepot.lat, depotLng: planningDepot.lng };
      });

      // Compute each vehicle's effective shift from its linked workers' union.
      // A vehicle with only a morning worker works 06–14; morning+afternoon → 06–22.
      // Vehicles with no linked workers keep their own turno.
      const vehiclesForVRP = vehiclesWithDepot.map(v => {
        const linked = workers.filter(w => w.vehiculoId === (v._id || v.id));
        if (!linked.length) return v;
        const wins = linked.map(w => turnoWindow(w.turno, constraints.startMin, constraints.endMin))
          .sort((a, b) => a.start - b.start);
        const effStart = Math.min(...wins.map(w => w.start));
        const effEnd   = Math.max(...wins.map(w => w.end));
        // Circularidad por conductor: cada relevo entre conductores vinculados
        // a este vehículo (fin del turno de uno = inicio del siguiente) es un
        // punto donde, si "circular" está activo, el vehículo debe volver al
        // anchor del día antes de que empiece el siguiente conductor. El fin
        // del último turno YA es effEnd (el regreso de fin de jornada existe
        // siempre), así que solo hacen falta los bordes intermedios.
        const shiftBreaks = [...new Set(wins.slice(0, -1).map(w => w.end))]
          .filter(b => b > effStart && b < effEnd)
          .sort((a, b) => a - b);
        return { ...v, _effectiveStart: effStart, _effectiveEnd: effEnd, _shiftBreaks: shiftBreaks };
      });

      // ── Step 1: Vehicle VRP ──────────────────────────────────────
      // generateScenario preserves resource order: vr.schedule[i] ↔ vehiclesForSchedule[i]
      console.time("[PERF] vrp+autoscale");
      let vr = { schedule: [], unassigned: [...tasks], daysUsed: 1 };
      let vehiclesForSchedule = vehiclesForVRP;
      let addedVehicles = [];
      if (vehiclesForVRP.length > 0) {
        vr = await generateScenario(tasks, vehiclesForVRP, constraints);

        // Días máximos de escenario: si sobran paradas dentro de ese límite,
        // añade vehículos virtuales "Vehículo necesario N" hasta que quepan todas.
        if (constraints.maxDays > 0 && vr.unassigned.length > 0) {
          const scaled = await autoScaleFleet(tasks, vehiclesForVRP, constraints);
          vr = scaled.result;
          vehiclesForSchedule = scaled.resources;
          addedVehicles = scaled.resources.slice(vehiclesForVRP.length);
        }
      }
      console.timeEnd("[PERF] vrp+autoscale");
      const vehicleScheduleRaw = vehiclesForSchedule.map((v, i) => ({
        ...v,
        assignments: vr.schedule[i]?.assignments || [],
        totalKm:     vr.schedule[i]?.totalKm     || 0,
        shiftStart:  vr.schedule[i]?.shiftStart,
        shiftEnd:    vr.schedule[i]?.shiftEnd,
      }));

      // Enrich travel block km with real road distances via OSRM
      setGenPhase("osrm");
      setOsrmRunning(true);
      console.time("[PERF] osrm");
      const vehicleSchedule = await enrichWithOSRM(vehicleScheduleRaw);
      console.timeEnd("[PERF] osrm");
      setOsrmRunning(false);

      // ── Step 2: Worker schedule ──────────────────────────────────
      setGenPhase("workers");
      console.time("[PERF] worker-rows");
      await new Promise(resolve => setTimeout(resolve, 0));
      // Routes come ONLY from vehicles. Workers are human assignments
      // on top of a vehicle route — they never generate routes on their own.
      //
      // Each worker must be linked to a vehicle via vehiculoId.
      // Multiple workers can share one vehicle (e.g. morning + afternoon driver).
      // Each assignment belongs to EXACTLY ONE worker: the linked worker whose
      // turno window covers that time slot (earliest-start wins on overlap).
      // Workers without a valid vehiculoId appear with empty assignments.

      // Virtual drivers to pair with any virtual "Vehículo necesario N" added
      // by autoScaleFleet — un conductor por cada turno del vehículo
      // (v._effectiveStart/_shiftBreaks/_effectiveEnd, ya calculados allí:
      // 1 turno "Jornada completa" si no hay virtualShiftMin, o varios turnos
      // consecutivos —mañana/tarde— del vehículo si sí lo hay), en vez de un
      // único conductor por vehículo que dejaba la tarde sin cubrir.
      const virtualWorkers = addedVehicles.flatMap((v, vi) => {
        const bounds = [v._effectiveStart, ...(v._shiftBreaks || []), v._effectiveEnd];
        return bounds.slice(0, -1).map((start, si) => {
          const end = bounds[si + 1];
          const label = bounds.length > 2 ? ` (${minToTime(start)}-${minToTime(end)})` : "";
          return {
            _id: `virtual_wrk_${vi + 1}_${si + 1}`, id: `virtual_wrk_${vi + 1}_${si + 1}`,
            nombre: `Conductor necesario ${vi + 1}${label}`, apellidos: "",
            turno: "Jornada completa", rol: "conductor",
            vehiculoId: v._id, _virtual: true,
            _effectiveStart: start, _effectiveEnd: end,
          };
        });
      });

      // Pre-compute turno window for every worker (real + virtual). Un
      // conductor virtual con jornada acotada usa esa ventana directamente
      // en vez de resolverla por turno.
      const workersWithTw = [...workers, ...virtualWorkers].map(w => ({
        ...w,
        _tw: w._effectiveStart != null
          ? { start: w._effectiveStart, end: w._effectiveEnd }
          : turnoWindow(w.turno, constraints.startMin, constraints.endMin),
      }));

      // Group workers by vehiculoId so we can resolve ownership per vehicle
      const vehicleWorkerMap = {};
      for (const w of workersWithTw) {
        const vid = w.vehiculoId;
        if (!vid) continue;
        if (!vehicleWorkerMap[vid]) vehicleWorkerMap[vid] = [];
        vehicleWorkerMap[vid].push(w);
      }
      // Sort each vehicle's workers by turno start (earliest first → first-match wins)
      for (const list of Object.values(vehicleWorkerMap)) {
        list.sort((a, b) =>
          a._tw.start !== b._tw.start
            ? a._tw.start - b._tw.start
            : (a.nombre || "").localeCompare(b.nombre || "")
        );
      }

      const workerRows = workersWithTw.map(w => {
        const vehicleRow = vehicleSchedule.find(v => (v._id || v.id) === w.vehiculoId);
        if (!vehicleRow) return { ...w, assignments: [], totalKm: 0 };

        const peers = vehicleWorkerMap[w.vehiculoId] || [];
        const wId   = w._id || w.id;

        const myAssignments = vehicleRow.assignments.filter(a => {
          const dayOffset = Math.floor((a._start - constraints.startMin) / 1440) * 1440;
          const tStart = a._start - dayOffset;
          // Depot/anchor return: normally owned by whichever peer's window
          // contains its start (with circularidad hay una vuelta por cada
          // relevo, no solo una al final del día). Si el tramo cae fuera de
          // todas las ventanas (p.ej. la vuelta de cierre de jornada se sale
          // unos minutos del turno), se atribuye al último conductor del día
          // como red de seguridad.
          if (a._depot_return) {
            const owner = peers.find(p => tStart >= p._tw.start && tStart < p._tw.end);
            if (owner) return (owner._id || owner.id) === wId;
            const last = peers.reduce((best, p) => !best || p._tw.end > best._tw.end ? p : best, null);
            return last && (last._id || last.id) === wId;
          }
          // All other blocks: owner = first peer whose window contains the slot start
          const owner = peers.find(p => tStart >= p._tw.start && tStart < p._tw.end);
          return owner && (owner._id || owner.id) === wId;
        });

        const myKm = myAssignments.filter(a => a._travel).reduce((s, a) => s + (a.km || 0), 0);
        return { ...w, assignments: myAssignments, totalKm: myKm };
      });

      // Un conductor virtual sin ninguna asignación (el turno de tarde de un
      // vehículo cuyo cluster ya se agotó en la mañana) no aporta nada —
      // existe solo porque cada vehículo virtual se empareja con
      // mañana+tarde por defecto, sin saber de antemano si va a hacer falta
      // la tarde. Quitarlo del recuento es seguro: el vehículo en sí sigue
      // contando (si tuviera cero paradas en TODOS sus turnos, la búsqueda
      // binaria de autoScaleFleet ya lo habría excluido de la flota). Los
      // conductores reales nunca se filtran, aunque ese día no tengan nada
      // asignado — son personas reales, no un hueco de turno inventado.
      const usedWorkerRows = workerRows.filter(w =>
        !w._virtual || w.assignments.some(a => !a._break && !a._travel && !a._wait));
      console.timeEnd("[PERF] worker-rows");

      const totalBlocks = vehicleSchedule.reduce((s, v) => s + (v.assignments?.length || 0), 0);
      console.log(`[PERF] setSchedules — vehicles=${vehicleSchedule.length} workers=${usedWorkerRows.length} totalBlocks=${totalBlocks}`);
      const t_setSchedules = performance.now();
      setSchedules({ vehicles: vehicleSchedule, workers: usedWorkerRows });
      setMoveHistory([]); setHistoryIndex(-1); // un escenario nuevo invalida el historial de movimientos manuales
      setUnassigneds({ vehicles: vr.unassigned, workers: vr.unassigned });
      const newDays = vr.daysUsed;
      setConstraints(prev => ({ ...prev, days: newDays }));
      const usedVirtualWorkerCount = usedWorkerRows.filter(w => w._virtual).length;
      setScaleInfo(addedVehicles.length > 0
        ? `Se han añadido ${addedVehicles.length} vehículo(s) y ${usedVirtualWorkerCount} conductor(es) necesarios para encajar todas las paradas en ${constraints.maxDays} día(s).`
        : null);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        console.log(`[PERF] pintado tras setSchedules: ${(performance.now() - t_setSchedules).toFixed(0)}ms`);
      }));

      // Persist full schedule to IndexedDB (too large for Firestore)
      if (activeProject?._id) {
        idbSave(`vrp_${activeProject._id}`, { vehicles: vehicleSchedule, workers: usedWorkerRows });
      }

      // Auto-save summary to project (assignments excluded — too large for Firestore 1MB limit)
      setGenPhase("saving");
      console.time("[PERF] firestore-save");
      if (activeProject && onProjectUpdate) {
        const totalKm    = vehicleSchedule.reduce((s, v) => s + (v.totalKm || 0), 0);
        const totalStops = vehicleSchedule.reduce((s, v) =>
          s + v.assignments.filter(a => !a._break && !a._travel && !a._wait).length, 0);
        await onProjectUpdate({
          scheduling: {
            vehicleCount: vehicleSchedule.length,
            workerCount:  usedWorkerRows.length,
            constraints:  { ...constraints, days: newDays },
            daysUsed: newDays, totalKm, totalStops,
            generatedAt: new Date().toISOString(),
          },
          status: "schedulado",
        });
        // Historial de versiones — solo métricas (no las assignments, muy
        // grandes para Firestore), para poder comparar "esta semana vs la
        // anterior" sin tener que rehacer el escenario.
        if (activeProject._id) {
          addDoc(collection(db, "scheduling_projects", activeProject._id, "scenario_history"), {
            vehicleCount: vehicleSchedule.length, workerCount: usedWorkerRows.length,
            unassigned: vr.unassigned.length, daysUsed: newDays,
            totalKm: +totalKm.toFixed(1), totalStops,
            generatedAt: serverTimestamp(),
          }).catch(() => {});
        }
      }

      // Save worker–day roster so Rostering can display scheduled shifts
      if (activeProject?._id && orgId) {
        try {
          const turnoByWorker = {};
          const daysWorked    = {};
          // Resumen por trabajador+día (paradas, km, horario, vehículo) para
          // el popup de "resumen del turno" en Rostering (clic derecho en una
          // celda). Solo números pequeños, no las paradas completas — eso sí
          // superaría el límite de 1MB de Firestore con escenarios grandes.
          const dailyDetail = {};
          for (const wRow of workerRows) {
            const wId = wRow._id || wRow.id;
            // Antes se sacaba el código M/T/N con una regex sobre el texto
            // del turno ("Mañana (06-14)"...) — funciona para trabajadores
            // reales, pero los conductores virtuales (autoScaleFleet) tienen
            // turno:"Jornada completa" siempre, así que nunca hacían match y
            // se quedaban sin código: "Optimizar" en Rostering los saltaba
            // en silencio (parecía no hacer nada con escenarios grandes,
            // donde la mayoría de conductores son virtuales). Usar la
            // ventana horaria real (_tw.start, ya calculada para cada
            // trabajador, real o virtual) es agnóstico al texto del turno.
            const code = wRow._tw ? shiftCodeFromStart(wRow._tw.start) : null;
            if (code) turnoByWorker[wId] = code;

            const byDay = {}; // dayNum -> { stops, km, start, end }
            for (const a of (wRow.assignments ?? [])) {
              const dayNum = Math.floor((a._start - constraints.startMin) / 1440) + 1;
              const dd = byDay[dayNum] ?? (byDay[dayNum] = { stops: 0, km: 0, start: a._start, end: a._end });
              dd.start = Math.min(dd.start, a._start);
              dd.end   = Math.max(dd.end, a._end);
              if (a._travel) dd.km += a.km || 0;
              else if (!a._break && !a._wait) dd.stops += 1;
            }
            const dayNums = Object.keys(byDay).map(Number).sort((a, b) => a - b);
            if (dayNums.length) {
              daysWorked[wId] = dayNums;
              const vehicleRow = wRow.vehiculoId
                ? vehicleSchedule.find(v => (v._id || v.id) === wRow.vehiculoId)
                : null;
              const vehiculo = vehicleRow ? (vehicleRow.nombre || vehicleRow.matricula || "") : "";
              dailyDetail[wId] = {};
              for (const dn of dayNums) {
                const dd = byDay[dn];
                dailyDetail[wId][dn] = {
                  stops: dd.stops, km: +dd.km.toFixed(1),
                  start: dd.start, end: dd.end, vehiculo,
                };
              }
            }
          }
          await setDoc(doc(db, "scheduling_roster", activeProject._id), {
            projectId: activeProject._id,
            orgId,
            mes: activeProject.mes ?? "",   // "YYYY-MM" — schedule starts on day 1 of this month
            turnoByWorker,
            daysWorked,
            dailyDetail,
            generatedAt: new Date().toISOString(),
          });
        } catch { /* non-critical */ }
      }
      console.timeEnd("[PERF] firestore-save");

    } catch (e) {
      console.error("generateScenario error:", e);
      setGenError(e.message || "Error al generar el escenario");
    } finally {
      setGenerating(false);
      setGenPhase(null);
    }
  }

  // ── Simulador "qué pasaría si" ────────────────────────────────────
  // Corre el VRP en memoria con la flota real +/- N vehículos, sin tocar
  // schedules/Firestore — solo para comparar métricas. No pasa por OSRM
  // (estimación por distancia en línea recta, más rápida) ni por el paso
  // de conductores — es una previsión de vehículos/km/días, no un
  // escenario publicable.
  async function runSimulation() {
    if (!tasks.length || !vehicles.length) return;
    setSimRunning(true);
    setSimError(null);
    setSimResult(null);
    try {
      let planningDepot = null;
      try {
        if (activeProject?._id) {
          const snap = await getDoc(doc(db, "planning_depots", activeProject._id));
          if (snap.exists()) {
            const list = snap.data().depots ?? [];
            if (list.length > 0) planningDepot = { lat: +list[0].lat, lng: +list[0].lng };
          }
        }
      } catch { /* ignore */ }

      const vehiclesWithDepot = vehicles.map(v => {
        if (v.depotLat && v.depotLng) return v;
        if (!planningDepot) return v;
        return { ...v, depotLat: planningDepot.lat, depotLng: planningDepot.lng };
      });
      const vehiclesForVRP = vehiclesWithDepot.map(v => {
        const linked = workers.filter(w => w.vehiculoId === (v._id || v.id));
        if (!linked.length) return v;
        const wins = linked.map(w => turnoWindow(w.turno, constraints.startMin, constraints.endMin))
          .sort((a, b) => a.start - b.start);
        return { ...v, _effectiveStart: Math.min(...wins.map(w => w.start)), _effectiveEnd: Math.max(...wins.map(w => w.end)) };
      });

      // Aplica el delta sobre la flota real: +N clona la plantilla del primer
      // vehículo (igual que autoScaleFleet con "Vehículo necesario N"), -N
      // quita los últimos N de la lista.
      let simVehicles = vehiclesForVRP;
      if (simDelta > 0) {
        const template = vehiclesForVRP[0] || {};
        const extra = Array.from({ length: simDelta }, (_, i) => ({
          ...template,
          _id: `sim_veh_${i + 1}`, id: `sim_veh_${i + 1}`,
          nombre: `Simulado ${i + 1}`, matricula: "", _virtual: true,
        }));
        simVehicles = [...vehiclesForVRP, ...extra];
      } else if (simDelta < 0) {
        simVehicles = vehiclesForVRP.slice(0, Math.max(0, vehiclesForVRP.length + simDelta));
      }

      if (simVehicles.length === 0) {
        setSimResult({ vehicleCount: 0, unassigned: tasks.length, totalKm: 0, daysUsed: 0 });
        return;
      }

      let vr = await generateScenario(tasks, simVehicles, constraints);
      let finalVehicleCount = simVehicles.length;
      if (constraints.maxDays > 0 && vr.unassigned.length > 0) {
        const scaled = await autoScaleFleet(tasks, simVehicles, constraints);
        vr = scaled.result;
        finalVehicleCount = scaled.resources.length;
      }
      const totalKm = vr.schedule.reduce((s, v) => s + (v.totalKm || 0), 0);
      setSimResult({
        vehicleCount: finalVehicleCount, unassigned: vr.unassigned.length,
        totalKm: +totalKm.toFixed(1), daysUsed: vr.daysUsed,
      });
    } catch (e) {
      console.error("Simulación error:", e);
      setSimError(e.message || "Error al simular");
    } finally {
      setSimRunning(false);
    }
  }

  function taskToUbicacion(task, idx) {
    const campos = task.campos || {};
    const field = (...keys) => {
      for (const k of keys) {
        const e = Object.entries(campos).find(([fk]) => fk.toLowerCase().trim() === k);
        if (e?.[1] != null && String(e[1]).trim()) return String(e[1]).trim();
      }
      return "";
    };
    return {
      id: "u" + idx,
      pa: task.nombre || field("pa","idsap","id_sap","codigopoint","codigo","codi") || ("PA-" + (idx + 1)),
      orden: idx + 1,
      calle: field("calle","carrer","street","via"),
      num: field("num","num.","número","numero"),
      comentari: field("comentari","comentario","comment"),
      barri: task.barrio || field("barri","barrio","neighbourhood","neighborhood","sector","zona"),
      districte: field("districte","distrito","district"),
      turno: field("turno","turn","shift"),
      dia: field("día","dia","day"),
      lat: +task.lat || 0,
      lng: +task.lng || 0,
      elementos: [],
      realizado: false,
      realizadoPor: null,
      realizadoEn: null,
      nota: "",
    };
  }

  // ── Excel export ───────────────────────────────────────────────
  function downloadVehicleXLSX() {
    const vs = schedules.vehicles;
    if (!vs) return;
    const rows = [["Vehículo","Matrícula","Día","Hora inicio","Hora fin","Tipo","Nombre parada","Dirección","Barrio","Lat","Lng","Duración (min)","Km"]];
    for (const v of vs) {
      const name = v.nombre || v.matricula || v._id || "";
      const mat  = v.matricula || "";
      for (const a of v.assignments) {
        const day   = Math.floor(a._start / 1440) + 1;
        const type  = a._break ? "Descanso" : a._wait ? "Espera" : a._depot_exit ? "Salida depósito" : a._depot_return ? "Vuelta depósito" : a._travel ? "Viaje" : "Parada";
        rows.push([
          name, mat, day,
          minToTime(a._start % 1440), minToTime(a._end % 1440),
          type,
          a._break || a._travel || a._wait ? "" : (a.nombre || a.name || ""),
          a._break || a._travel || a._wait ? "" : (a.direccion || a.address || ""),
          a.barrio || "",
          a.lat ?? "", a.lng ?? "",
          a.duracion || (a._end - a._start),
          a.km ? +a.km.toFixed(3) : "",
        ]);
      }
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [20,12,5,10,10,20,30,30,15,10,10,13,8].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, "Vehículos");
    XLSX.writeFile(wb, `vehicle_scheduling_${activeProject?.nombre || "export"}.xlsx`);
  }

  function downloadCrewXLSX() {
    const ws2 = schedules.workers;
    if (!ws2) return;
    const rows = [["Trabajador","Turno","Vehículo","Día","Hora inicio","Hora fin","Tipo","Nombre parada","Dirección","Duración (min)","Km"]];
    for (const w of ws2) {
      const name   = [w.nombre, w.apellidos].filter(Boolean).join(" ") || w._id || "";
      const turno  = w.turno || "";
      const veh    = vehicles.find(v => (v._id || v.id) === w.vehiculoId);
      const vehNm  = veh ? (veh.nombre || veh.matricula || "") : "";
      for (const a of w.assignments) {
        const day  = Math.floor(a._start / 1440) + 1;
        const type = a._break ? "Descanso" : a._wait ? "Espera" : a._depot_exit ? "Salida depósito" : a._depot_return ? "Vuelta depósito" : a._travel ? "Viaje" : "Parada";
        rows.push([
          name, turno, vehNm, day,
          minToTime(a._start % 1440), minToTime(a._end % 1440),
          type,
          a._break || a._travel || a._wait ? "" : (a.nombre || a.name || ""),
          a._break || a._travel || a._wait ? "" : (a.direccion || a.address || ""),
          a.duracion || (a._end - a._start),
          a.km ? +a.km.toFixed(3) : "",
        ]);
      }
    }
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = [25,15,14,5,10,10,20,30,30,13,8].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, sheet, "Trabajadores");
    XLSX.writeFile(wb, `crew_scheduling_${activeProject?.nombre || "export"}.xlsx`);
  }

  // ── Excel import ───────────────────────────────────────────────
  const xlsxUploadRef = useRef(null);

  function handleUploadXLSX(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parseT = t => {
          const s = String(t ?? "00:00");
          const [h, m] = s.split(":").map(Number);
          return ((isNaN(h) ? 0 : h) * 60) + (isNaN(m) ? 0 : m);
        };
        const wb   = XLSX.read(ev.target.result, { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        if (data.length < 2) return;
        const h0 = String(data[0][0] ?? "").toLowerCase().trim();

        if (h0 === "vehículo" || h0 === "vehiculo") {
          // Vehicle schedule
          const byVeh = {};
          for (let i = 1; i < data.length; i++) {
            const r = data[i];
            if (!r[0]) continue;
            const vName = String(r[0]);
            const mat   = String(r[1] ?? "");
            if (!byVeh[vName]) {
              const ex = vehicles.find(v => (v.nombre || "") === vName || (v.matricula || "") === mat);
              byVeh[vName] = { _id: ex?._id || vName, nombre: ex?.nombre || vName, matricula: ex?.matricula || mat, assignments: [], totalKm: 0 };
            }
            const day    = parseInt(r[2]) || 1;
            const _start = (day - 1) * 1440 + parseT(r[3]);
            const _end   = (day - 1) * 1440 + parseT(r[4]);
            const type   = String(r[5] ?? "");
            const dur    = parseInt(r[11]) || (_end - _start);
            const km     = r[12] ? +r[12] : 0;
            const a      = { _start, _end, duracion: dur };
            if (type === "Descanso")         a._break = true;
            else if (type === "Salida depósito") { a._travel = true; a._depot_exit  = true; a.km = km; }
            else if (type === "Vuelta depósito") { a._travel = true; a._depot_return = true; a.km = km; }
            else if (type === "Viaje")       { a._travel = true; a.km = km; }
            else {
              a.nombre    = String(r[6] ?? "");
              a.direccion = String(r[7] ?? "");
              a.barrio    = String(r[8] ?? "");
              if (r[9]) a.lat = +r[9];
              if (r[10]) a.lng = +r[10];
            }
            byVeh[vName].assignments.push(a);
            byVeh[vName].totalKm += km;
          }
          setSchedules(prev => ({ ...prev, vehicles: Object.values(byVeh) }));

        } else if (h0 === "trabajador") {
          // Crew schedule
          const byW = {};
          for (let i = 1; i < data.length; i++) {
            const r = data[i];
            if (!r[0]) continue;
            const wName = String(r[0]);
            const turno = String(r[1] ?? "");
            if (!byW[wName]) {
              const ex   = workers.find(w => [w.nombre, w.apellidos].filter(Boolean).join(" ") === wName);
              const pts  = wName.split(" ");
              byW[wName] = { _id: ex?._id || wName, nombre: ex?.nombre || pts[0] || wName, apellidos: ex?.apellidos || pts.slice(1).join(" ") || "", turno, vehiculoId: ex?.vehiculoId || null, assignments: [], totalKm: 0 };
            }
            const day    = parseInt(r[3]) || 1;
            const _start = (day - 1) * 1440 + parseT(r[4]);
            const _end   = (day - 1) * 1440 + parseT(r[5]);
            const type   = String(r[6] ?? "");
            const dur    = parseInt(r[9]) || (_end - _start);
            const km     = r[10] ? +r[10] : 0;
            const a      = { _start, _end, duracion: dur };
            if (type === "Descanso")         a._break = true;
            else if (type === "Salida depósito") { a._travel = true; a._depot_exit  = true; a.km = km; }
            else if (type === "Vuelta depósito") { a._travel = true; a._depot_return = true; a.km = km; }
            else if (type === "Viaje")       { a._travel = true; a.km = km; }
            else {
              a.nombre    = String(r[7] ?? "");
              a.direccion = String(r[8] ?? "");
            }
            byW[wName].assignments.push(a);
            byW[wName].totalKm += km;
          }
          setSchedules(prev => ({ ...prev, workers: Object.values(byW) }));
        }
      } catch (err) {
        console.error("Error al importar Excel:", err);
        alert("Error al importar el archivo: " + err.message);
      }
      e.target.value = "";
    };
    reader.readAsArrayBuffer(file);
  }

  async function publishToRoutes(tipo, mes) {
    const vehicleSchedule = schedules.vehicles;
    if (!vehicleSchedule) return;
    // Sin org_id, cada plan se creaba igualmente pero SIN el campo org_id —
    // ninguna consulta real (Control, Rutas del conductor) filtra nunca por
    // "sin org_id", así que los planes quedaban invisibles en todas partes
    // sin ningún error visible. Mejor parar aquí que publicar en el vacío.
    if (!orgId) { alert("No se puede publicar sin organización — este proyecto no tiene una asignada."); return; }
    setPublishing(true);
    const startMin = constraints.startMin;
    const col = collection(db, "planes");
    try {
      // Build all plan documents first, then write concurrently in chunks
      const docs = [];
      for (const row of vehicleSchedule) {
        const allStops = row.assignments.filter(a => !a._break && !a._travel && !a._wait);
        if (allStops.length === 0) continue;

        const byDay = {};
        for (const a of allStops) {
          const d = Math.floor((a._start - startMin) / 1440);
          if (!byDay[d]) byDay[d] = [];
          byDay[d].push(a);
        }

        const linkedWorkers = workers
          .filter(w => w.vehiculoId === (row._id || row.id))
          .sort((a, b) => {
            const ta = turnoWindow(a.turno, constraints.startMin, constraints.endMin);
            const tb = turnoWindow(b.turno, constraints.startMin, constraints.endMin);
            return ta.start - tb.start;
          });
        const conductor = linkedWorkers[0];
        const conductorLabel = conductor
          ? [conductor.nombre, conductor.apellidos].filter(Boolean).join(" ")
          : (row.nombre || row.matricula || "Vehículo");

        const daysList = Object.keys(byDay).map(Number).sort((a, b) => a - b);
        const totalDays = daysList.length;

        for (const d of daysList) {
          if (conductor) {
            const code = workerCodeOnDay(rosterGrid, conductor._id ?? conductor.id ?? "", d);
            if (isUnavailable(code)) continue;
          }
          const stops = byDay[d];
          const ubicaciones = stops.map((a, i) => taskToUbicacion(a, i));
          const recorrido = stops
            .filter(a => hasCoords(a.lat, a.lng))
            .map(a => ({ lat: +a.lat, lng: +a.lng }));
          const dayLabel = `Día ${String(d + 1).padStart(2, "0")}`;
          const nombre = totalDays > 1
            ? `${conductorLabel} · ${dayLabel} · ${mes}`
            : `${conductorLabel} · ${mes}`;
          docs.push({
            tipo, nombre, archivo: "vrp-generado",
            turno: row.turno || "",
            conductorNombre: conductorLabel,
            vehiculoNombre: row.nombre || row.matricula || "",
            mes, diaServicio: dayLabel,
            ubicaciones, recorrido,
            fechaSubida: Date.now(),
            origenVRP: true,
            org_id: orgId,
          });
        }
      }

      // Write 50 docs concurrently per round
      const CHUNK = 50;
      for (let i = 0; i < docs.length; i += CHUNK) {
        await Promise.all(docs.slice(i, i + CHUNK).map(d => addDoc(col, d)));
      }

      setPublishModal(null);
    } catch (e) {
      console.error("publishToRoutes error:", e);
      alert("Error al publicar: " + (e.message || e));
    }
    setPublishing(false);
  }

  if (!activeProject) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: C.dim }}>
        <div style={{ fontSize: 32 }}>📋</div>
        <div style={{ fontSize: 14, color: C.muted, fontWeight: 600 }}>Ningún proyecto activo</div>
        <div style={{ fontSize: 12, color: C.dim }}>Abre o crea un proyecto desde la pestaña Proyectos</div>
      </div>
    );
  }

  const canGenerate  = (vehicles.length > 0 || workers.length > 0) && tasks.length > 0 && !generating;
  const totalAssigned = schedule ? schedule.reduce((s, r) => s + r.assignments.filter(a => !a._break && !a._travel && !a._wait).length, 0) : 0;
  const totalKm       = schedule ? schedule.reduce((s, r) => s + (r.totalKm || 0), 0) : 0;

  // Scenario-wide summary (independent of the vehicles/workers mode toggle)
  const vehicleRows     = schedules.vehicles || [];
  const workerRows      = schedules.workers || [];
  const summaryKm        = vehicleRows.length ? vehicleRows.reduce((s, r) => s + (r.totalKm || 0), 0) : totalKm;
  const summaryAssigned  = vehicleRows.length
    ? vehicleRows.reduce((s, r) => s + r.assignments.filter(a => !a._break && !a._travel && !a._wait).length, 0)
    : totalAssigned;
  const vehiclesUsed     = vehicleRows.filter(r => r.assignments.some(a => !a._break && !a._travel && !a._wait)).length;
  const workersUsed      = workerRows.filter(r => r.assignments.some(a => !a._break && !a._travel && !a._wait)).length;
  const stopsPerDay   = schedule ? (() => {
    const counts = {};
    schedule.forEach(r => r.assignments.filter(a => !a._break && !a._travel && !a._wait).forEach(a => {
      const d = Math.floor((a._start - constraints.startMin) / 1440);
      counts[d] = (counts[d] || 0) + 1;
    }));
    return counts;
  })() : {};

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── TOOLBAR ──────────────────────────────────────────────── */}
      {!focusMode && <div style={{
        padding: "0 16px", height: 46, borderBottom: `1px solid ${C.border}`,
        background: C.card, flexShrink: 0,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        {/* Import */}
        <button onClick={importFromPlanning} disabled={importing} style={{
          padding: "5px 11px", background: importing ? C.surface2 : !!tasks.length ? C.greenDim : C.surface2,
          border: `1px solid ${!!tasks.length ? C.green + "44" : C.border}`,
          color: !!tasks.length ? C.green : C.muted,
          borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: importing ? "wait" : "pointer",
          fontFamily: font, transition: "all .15s", display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
        }}>
          {importing
            ? <><span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(52,211,153,.2)", borderTopColor: C.green, borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> Importando…</>
            : !!tasks.length
              ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg> {tasks.length.toLocaleString()} paradas</>
              : "Importar desde Planning"
          }
        </button>

        <div style={{ width: 1, height: 18, background: C.border, flexShrink: 0 }} />

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 2, background: C.surface2, borderRadius: 6, padding: 2, flexShrink: 0 }}>
          {[["vehicles",t("vehiculos", lang)],["workers",t("trabajadores", lang)]].map(([v, l]) => (
            <button key={v} onClick={() => setMode(v)} style={{
              padding: "4px 10px", borderRadius: 4, border: "none", cursor: "pointer",
              background: mode === v ? C.blue : "none",
              color: mode === v ? "#fff" : C.muted,
              fontSize: 11, fontWeight: mode === v ? 600 : 400, fontFamily: font,
              transition: "all .12s",
            }}>{l}</button>
          ))}
        </div>

        {/* Constraints toggle */}
        <button onClick={() => setShowC(!showC)} title={t("restricciones", lang)} style={{
          padding: "5px 10px", background: showC ? C.surface2 : "none",
          border: `1px solid ${showC ? C.border2 : C.border}`, color: showC ? C.text : C.muted,
          borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: font, transition: "all .12s",
          display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/>
          </svg>
          {t("restricciones", lang)}
        </button>

        {activeProject && (
          <button onClick={() => setShowHistorial(true)} title="Historial de versiones del escenario" style={{
            padding: "5px 10px", background: "none", border: `1px solid ${C.border}`, color: C.muted,
            borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: font, transition: "all .12s",
            display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l4 2"/>
            </svg>
            {t("historial", lang)}
          </button>
        )}

        {schedule && (
          <button onClick={() => { setShowSimulador(true); setSimResult(null); setSimError(null); }} title="Simular +/- vehículos sin tocar el escenario actual" style={{
            padding: "5px 10px", background: "none", border: `1px solid ${C.border}`, color: C.muted,
            borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: font, transition: "all .12s",
            display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18M3 9v10a2 2 0 0 0 2 2h4"/>
            </svg>
            {t("simulador", lang)}
          </button>
        )}

        {/* Inline KPI chips — only when schedule exists */}
        {schedule && <>
          <div style={{ width: 1, height: 18, background: C.border, flexShrink: 0 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11 }}>
            <span><span style={{ fontWeight: 700, color: C.green }}>{totalAssigned.toLocaleString()}</span> <span style={{ color: C.dim }}>asig.</span></span>
            {unassigned.length > 0 && <span><span style={{ fontWeight: 700, color: C.red }}>{unassigned.length.toLocaleString()}</span> <span style={{ color: C.dim }}>sin asig.</span></span>}
            <span><span style={{ fontWeight: 700, color: C.blue }}>{constraints.days || 1}</span> <span style={{ color: C.dim }}>días</span></span>
            {totalKm > 0 && <span><span style={{ fontWeight: 700, color: C.amber }}>{totalKm.toFixed(0)}</span> <span style={{ color: C.dim }}>km∅</span></span>}
          </div>
          {schedules.vehicles && (
            <>
              <div style={{ width: 1, height: 18, background: C.border, flexShrink: 0 }} />
              {/* Excel export */}
              <button onClick={downloadVehicleXLSX} title="Descargar vehicle scheduling en Excel"
                style={{ padding: "5px 10px", background: "rgba(52,211,153,.08)", border: `1px solid rgba(52,211,153,.3)`, color: "#34d399", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Vehículos
              </button>
              {schedules.workers && (
                <button onClick={downloadCrewXLSX} title="Descargar crew scheduling en Excel"
                  style={{ padding: "5px 10px", background: "rgba(52,211,153,.08)", border: `1px solid rgba(52,211,153,.3)`, color: "#34d399", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Trabajadores
                </button>
              )}
              {/* Excel import */}
              <input ref={xlsxUploadRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleUploadXLSX} />
              <button onClick={() => xlsxUploadRef.current?.click()} title="Importar vehicle scheduling o crew scheduling desde Excel"
                style={{ padding: "5px 10px", background: "rgba(92,155,255,.08)", border: `1px solid rgba(92,155,255,.3)`, color: C.blue, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                {t("importar", lang)}
              </button>
              <div style={{ width: 1, height: 18, background: C.border, flexShrink: 0 }} />
              <button
                onClick={() => { const now = new Date(); setPublishModal({ tipo: "prev", mes: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}` }); }}
                style={{
                  padding: "5px 10px", background: C.greenDim, border: `1px solid ${C.green}44`,
                  color: C.green, borderRadius: 6, fontSize: 11, fontWeight: 600,
                  cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                {t("publicarRutas", lang)}
              </button>

              {/* Deshacer / rehacer movimientos manuales del Gantt (tipo Excel) */}
              <div style={{ width: 1, height: 18, background: C.border, flexShrink: 0 }} />
              <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
                <button
                  onClick={undoMove} disabled={!canUndoMove}
                  title={canUndoMove ? `Deshacer: ${moveHistory[historyIndex]?.label || "último movimiento"}` : "Nada que deshacer"}
                  style={{
                    width: 26, height: 26, borderRadius: 6, background: "transparent", border: "none",
                    color: canUndoMove ? C.text : C.dim, cursor: canUndoMove ? "pointer" : "not-allowed",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: canUndoMove ? 1 : 0.35, flexShrink: 0,
                  }}
                  onMouseEnter={e => canUndoMove && (e.currentTarget.style.background = C.surface2)}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 7"/>
                  </svg>
                </button>
                <button
                  onClick={redoMove} disabled={!canRedoMove}
                  title={canRedoMove ? `Rehacer: ${moveHistory[historyIndex + 1]?.label || "movimiento"}` : "Nada que rehacer"}
                  style={{
                    width: 26, height: 26, borderRadius: 6, background: "transparent", border: "none",
                    color: canRedoMove ? C.text : C.dim, cursor: canRedoMove ? "pointer" : "not-allowed",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: canRedoMove ? 1 : 0.35, flexShrink: 0,
                  }}
                  onMouseEnter={e => canRedoMove && (e.currentTarget.style.background = C.surface2)}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 7v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 7"/>
                  </svg>
                </button>
              </div>
            </>
          )}
        </>}

        {/* Worker mode hint */}
        {mode === "workers" && !schedules.vehicles && (
          <span style={{ fontSize: 11, color: C.amber, display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <span>⚠</span> Genera primero el escenario de vehículos
          </span>
        )}

        {/* Generate + Focus mode toggle */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={runGenerate} disabled={!canGenerate} style={{
            padding: "6px 14px", background: canGenerate ? C.blue : C.blueDim,
            border: "none", color: canGenerate ? "#fff" : C.blueText,
            borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: canGenerate ? "pointer" : "not-allowed",
            fontFamily: font, transition: "all .15s", display: "flex", alignItems: "center", gap: 6,
            opacity: canGenerate ? 1 : .6,
          }}>
            {osrmRunning
              ? <><span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> {t("calculandoKm", lang)}</>
              : generating
              ? <><span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> {t("generando", lang)}</>
              : t("generarEscenario", lang)
            }
          </button>
          {schedule && (
            <button
              onClick={() => setFocusMode(true)}
              title="Modo pantalla completa (Gantt)"
              style={{
                width: 30, height: 30, borderRadius: 6,
                background: C.surface2, border: `1px solid ${C.border}`,
                color: C.dim, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blue; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
                <path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
              </svg>
            </button>
          )}
        </div>
      </div>}

      {/* Focus-mode mini bar — only when focusMode */}
      {focusMode && (
        <div style={{
          position: "absolute", top: 8, right: 8, zIndex: 999,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          {schedule && <div style={{
            background: "rgba(23,32,53,0.9)", border: `1px solid ${C.border}`,
            borderRadius: 8, padding: "5px 12px", fontSize: 11,
            display: "flex", gap: 12, backdropFilter: "blur(4px)",
          }}>
            <span><span style={{ fontWeight: 700, color: C.green }}>{totalAssigned.toLocaleString()}</span> <span style={{ color: C.dim }}>asig.</span></span>
            {unassigned.length > 0 && <span><span style={{ fontWeight: 700, color: C.red }}>{unassigned.length.toLocaleString()}</span> <span style={{ color: C.dim }}>sin asig.</span></span>}
            <span><span style={{ fontWeight: 700, color: C.blue }}>{constraints.days || 1}</span> <span style={{ color: C.dim }}>días</span></span>
          </div>}
          <button
            onClick={() => setFocusMode(false)}
            style={{
              padding: "5px 12px", background: "rgba(23,32,53,0.9)", border: `1px solid ${C.border2}`,
              color: C.muted, borderRadius: 8, cursor: "pointer",
              fontFamily: font, fontSize: 11, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 5, backdropFilter: "blur(4px)",
              transition: "all .15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.muted; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/>
              <path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>
            </svg>
            Salir
          </button>
        </div>
      )}

      {/* Warnings */}
      {!focusMode && !!tasks.length && vehicles.length === 0 && workers.length === 0 && (
        <div style={{ padding: "7px 16px", background: "rgba(251,146,60,0.08)", borderBottom: `1px solid rgba(251,146,60,0.2)`, fontSize: 11, color: C.orange, flexShrink: 0 }}>
          No hay vehículos ni trabajadores registrados. Añade recursos en las pestañas correspondientes.
        </div>
      )}
      {!focusMode && mode === "workers" && schedules.workers && (() => {
        const sinVehiculo = workers.filter(w => !w.vehiculoId || !vehicles.some(v => (v._id || v.id) === w.vehiculoId));
        if (!sinVehiculo.length) return null;
        const nombres = sinVehiculo.map(w => w.nombre).join(", ");
        return (
          <div style={{ padding: "5px 16px", background: "rgba(248,113,113,0.08)", borderBottom: `1px solid rgba(248,113,113,0.25)`, fontSize: 11, color: C.red, flexShrink: 0 }}>
            <strong>Sin vehículo asignado:</strong> {nombres}. Ve a Trabajadores y asigna un vehículo.
          </div>
        );
      })()}

      {/* Constraints panel */}
      {!focusMode && showC && <ConstraintsPanel c={constraints} onChange={setConstraints} orgId={orgId} />}

      {/* Progress bar */}
      {generating && (
        <div style={{
          padding: "10px 16px 12px",
          background: C.card,
          borderBottom: `1px solid ${C.border}`,
          animation: "sched-fadein .15s ease both",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(92,155,255,.3)", borderTopColor: C.blue, borderRadius: "50%", animation: "sched-spin .7s linear infinite", flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                {GEN_PHASES[genPhase]?.label ?? "Preparando…"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, color: elapsedSec >= 60 ? "#f59e0b" : C.muted }}>
                {elapsedSec >= 60
                  ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`
                  : `${elapsedSec}s`}
              </span>
              <span style={{ fontSize: 11, color: C.dim }}>
                {tasks.length.toLocaleString()} paradas · {(vehicles.length || workers.length) > 0 ? `${Math.max(vehicles.length, workers.length)} recurso${Math.max(vehicles.length, workers.length) !== 1 ? "s" : ""}` : ""}
              </span>
            </div>
          </div>
          {/* Track */}
          <div style={{ height: 4, background: C.surface2, borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${GEN_PHASES[genPhase]?.pct ?? 4}%`,
              background: `linear-gradient(90deg, ${C.blue}, #818cf8)`,
              borderRadius: 3,
              transition: "width 0.5s ease",
              animation: "sched-shimmer 1.8s ease-in-out infinite",
            }} />
          </div>
          {/* Phase steps */}
          <div style={{ display: "flex", gap: 0, marginTop: 7 }}>
            {Object.entries(GEN_PHASES).map(([key, ph]) => {
              const currentIdx  = Object.keys(GEN_PHASES).indexOf(genPhase);
              const thisIdx     = Object.keys(GEN_PHASES).indexOf(key);
              const done        = currentIdx > thisIdx;
              const active      = key === genPhase;
              return (
                <div key={key} style={{ flex: 1, display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: done ? C.green : active ? C.blue : C.surface2,
                    border: `1px solid ${done ? C.green : active ? C.blue : C.border}`,
                    transition: "all .3s",
                  }} />
                  <span style={{
                    fontSize: 9, color: done ? C.green : active ? C.blueText : C.dim,
                    letterSpacing: .3, fontWeight: active ? 600 : 400,
                    transition: "color .3s", whiteSpace: "nowrap",
                  }}>
                    {ph.label.replace("…", "").replace(" por carretera", "")}
                  </span>
                  {thisIdx < Object.keys(GEN_PHASES).length - 1 && (
                    <div style={{ flex: 1, height: 1, background: done ? C.green : C.border, margin: "0 4px", transition: "background .3s" }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Error banner */}
      {genError && !focusMode && (
        <div style={{ padding: "7px 16px", background: "rgba(248,113,113,0.08)", borderBottom: `1px solid rgba(248,113,113,0.25)`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: C.red }}>Error al generar: {genError}</span>
          <button onClick={() => setGenError(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>×</button>
        </div>
      )}

      {/* Auto-scale (virtual fleet) banner */}
      {scaleInfo && !focusMode && (
        <div style={{ padding: "7px 16px", background: "rgba(251,191,36,0.08)", borderBottom: `1px solid rgba(251,191,36,0.25)`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: "#fbbf24" }}>⚙ {scaleInfo}</span>
          <button onClick={() => setScaleInfo(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>×</button>
        </div>
      )}

      {/* Rostering conflict banner */}
      {rosterConflicts.length > 0 && !focusMode && (
        <div style={{ padding: "5px 16px", background: "rgba(251,191,36,0.07)", borderBottom: `1px solid rgba(251,191,36,0.2)`, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span style={{ fontSize: 11, color: "#fbbf24", fontWeight: 600 }}>Conflictos:</span>
          {rosterConflicts.map((c, i) => (
            <span key={i} style={{ fontSize: 10, color: "#fbbf24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 4, padding: "1px 6px" }}>
              {c.name} — día {c.day} ({c.label})
            </span>
          ))}
        </div>
      )}

      {/* Per-day breakdown strip */}
      {schedule?.length > 0 && !focusMode && activeDays > 1 && (
        <div style={{
          flexShrink: 0, background: C.surface2, borderBottom: `1px solid ${C.border}`,
          padding: showDayStrip ? "4px 16px" : "3px 16px",
          display: "flex", alignItems: "center", gap: 6, flexWrap: showDayStrip ? "wrap" : "nowrap",
        }}>
          <button onClick={() => setShowDayStrip(v => !v)} style={{
            display: "flex", alignItems: "center", gap: 4,
            background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0,
          }}>
            <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>Reparto por día</span>
            <span style={{ fontSize: 9, color: C.dim, fontFamily: mono }}>({activeDays})</span>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={C.dim} strokeWidth="2.5"
              style={{ transform: showDayStrip ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform .2s", flexShrink: 0 }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {showDayStrip && Array.from({ length: activeDays }, (_, d) => (
            <div key={d} style={{
              display: "flex", alignItems: "center", gap: 4,
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 5, padding: "2px 8px", flexShrink: 0,
            }}>
              <span style={{ fontSize: 9, color: C.blue, fontWeight: 700, fontFamily: mono }}>Día {d + 1}</span>
              <span style={{ fontSize: 9, color: C.muted }}>{stopsPerDay[d] || 0}p</span>
            </div>
          ))}
        </div>
      )}

      {/* Scenario summary bar */}
      {schedule?.length > 0 && !focusMode && (
        <div style={{
          flexShrink: 0, background: C.card, borderBottom: `1px solid ${C.border}`,
          padding: "10px 16px", display: "flex", gap: 28,
        }}>
          {[
            { l: "Kms totales",  v: `${summaryKm.toFixed(0)} km`,       c: C.amber },
            { l: "Días",         v: activeDays,                          c: C.blue  },
            { l: "Asignaciones", v: summaryAssigned.toLocaleString(),    c: C.green },
            { l: "Conductores",  v: workersUsed,                         c: C.text  },
            { l: "Vehículos",    v: vehiclesUsed,                        c: C.text  },
          ].map(s => (
            <div key={s.l} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: s.c, fontFamily: mono, lineHeight: 1 }}>{s.v}</span>
              <span style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: .8 }}>{s.l}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── MAIN CONTENT ──────────────────────────────────────────── */}
      {!schedule?.length ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: C.dim }}>
          {!!!tasks.length
            ? <>
                <div style={{ fontSize: 13, color: C.muted }}>Importa los datos desde Planning para empezar</div>
                <div style={{ fontSize: 11 }}>Planning → Timetable → Exportar a Scheduling</div>
              </>
            : <>
                <div style={{ fontSize: 13, color: C.muted }}>{tasks.length.toLocaleString()} paradas listas</div>
                <div style={{ fontSize: 11 }}>
                  {(vehicles.length > 0 || workers.length > 0)
                    ? "Pulsa «Generar escenario» para asignar paradas"
                    : "Añade vehículos o trabajadores en las pestañas correspondientes"}
                </div>
              </>
          }
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Gantt — fills all available space */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <GanttChart
              rows={schedule}
              startMin={constraints.startMin}
              endMin={constraints.endMin}
              days={activeDays}
              mode={mode}
              allWorkers={workers}
              allVehicles={vehicles}
              onScheduleChange={handleScheduleChange}
              unassigned={unassigned}
              onPlaceUnassigned={placeUnassignedTask}
            />
          </div>
        </div>
      )}

      {/* Publish modal */}
      {publishModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }} onClick={() => !publishing && setPublishModal(null)}>
          <div style={{
            background: C.card, borderRadius: 12, padding: "28px 28px 24px",
            width: 340, boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
            border: `1px solid ${C.border}`,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>Publicar en Rutas</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 20 }}>
              Se creará un plan por cada vehículo con sus paradas asignadas.
            </div>

            {/* Tipo */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600, marginBottom: 6 }}>Tipo de plan</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[["prev","Prev. Mantenimiento"],["ext","Limp. Exterior"],["int","Limp. Interior"]].map(([k, label]) => (
                  <button key={k} onClick={() => setPublishModal(m => ({ ...m, tipo: k }))} style={{
                    flex: 1, padding: "7px 4px", borderRadius: 7, border: `1px solid ${publishModal.tipo === k ? C.blue : C.border}`,
                    background: publishModal.tipo === k ? C.blueDim : "none",
                    color: publishModal.tipo === k ? C.blueText : C.muted,
                    fontSize: 10, fontWeight: publishModal.tipo === k ? 700 : 400,
                    cursor: "pointer", fontFamily: font, textAlign: "center",
                  }}>{label}</button>
                ))}
              </div>
            </div>

            {/* Mes */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600, marginBottom: 6 }}>Mes</div>
              <input
                type="month"
                value={publishModal.mes}
                onChange={e => setPublishModal(m => ({ ...m, mes: e.target.value }))}
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "8px 10px", borderRadius: 7,
                  border: `1px solid ${C.border}`, background: C.surface2,
                  color: C.text, fontSize: 12, fontFamily: font,
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setPublishModal(null)} disabled={publishing} style={{
                flex: 1, padding: "9px 0", borderRadius: 7, border: `1px solid ${C.border}`,
                background: "none", color: C.muted, fontSize: 13, fontWeight: 500,
                cursor: "pointer", fontFamily: font,
              }}>Cancelar</button>
              <button onClick={() => publishToRoutes(publishModal.tipo, publishModal.mes)} disabled={publishing} style={{
                flex: 2, padding: "9px 0", borderRadius: 7, border: "none",
                background: publishing ? C.blueDim : C.blue,
                color: publishing ? C.blueText : "#fff",
                fontSize: 13, fontWeight: 600, cursor: publishing ? "not-allowed" : "pointer",
                fontFamily: font, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                {publishing
                  ? <><span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> Publicando…</>
                  : "Publicar planes"
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Historial de versiones del escenario */}
      {showHistorial && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }} onClick={() => setShowHistorial(false)}>
          <div style={{
            background: C.card, borderRadius: 12, padding: "24px 24px 20px",
            width: 620, maxHeight: "80vh", overflowY: "auto",
            boxShadow: "0 20px 60px rgba(0,0,0,0.4)", border: `1px solid ${C.border}`,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Historial de versiones</div>
              <button onClick={() => setShowHistorial(false)} style={{ background: "none", border: "none", color: C.dim, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 18 }}>
              Cada vez que generas un escenario se guarda un resumen aquí — compara esta semana con la anterior sin tener que volver a generar nada.
            </div>
            {scenarioHistory.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: C.dim, fontSize: 13 }}>
                Todavía no hay historial — se empezará a guardar la próxima vez que generes un escenario.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    {["Fecha", "Vehículos", "Trabajadores", "Días", "Km", "Paradas", "Sin asig."].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 10px", color: C.dim, fontSize: 10, letterSpacing: .5, textTransform: "uppercase", borderBottom: `1px solid ${C.border}`, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scenarioHistory.map((h, i) => {
                    const prev = scenarioHistory[i + 1];
                    const delta = (key, decimals = 0) => {
                      if (!prev || prev[key] == null || h[key] == null) return null;
                      const d = +(h[key] - prev[key]).toFixed(decimals);
                      if (d === 0) return null;
                      const up = d > 0;
                      return <span style={{ fontSize: 9, marginLeft: 4, color: up ? C.orange : C.green }}>{up ? "▲" : "▼"}{Math.abs(d)}</span>;
                    };
                    const fecha = h.generatedAt?.toDate ? h.generatedAt.toDate() : (h.generatedAt?.toMillis ? new Date(h.generatedAt.toMillis()) : null);
                    return (
                      <tr key={h._id} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "7px 10px", color: C.muted, fontFamily: mono, fontSize: 11 }}>
                          {fecha ? fecha.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                        </td>
                        <td style={{ padding: "7px 10px", color: C.text, fontFamily: mono }}>{h.vehicleCount}{delta("vehicleCount")}</td>
                        <td style={{ padding: "7px 10px", color: C.text, fontFamily: mono }}>{h.workerCount}{delta("workerCount")}</td>
                        <td style={{ padding: "7px 10px", color: C.blueText, fontFamily: mono }}>{h.daysUsed}{delta("daysUsed")}</td>
                        <td style={{ padding: "7px 10px", color: C.amber, fontFamily: mono }}>{h.totalKm?.toFixed?.(0) ?? h.totalKm}{delta("totalKm")}</td>
                        <td style={{ padding: "7px 10px", color: C.muted, fontFamily: mono }}>{h.totalStops}{delta("totalStops")}</td>
                        <td style={{ padding: "7px 10px", fontFamily: mono, color: h.unassigned > 0 ? C.red : C.green }}>{h.unassigned ?? 0}{delta("unassigned")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Simulador "qué pasaría si" */}
      {showSimulador && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }} onClick={() => !simRunning && setShowSimulador(false)}>
          <div style={{
            background: C.card, borderRadius: 12, padding: "24px 24px 22px",
            width: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.4)", border: `1px solid ${C.border}`,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Simulador "qué pasaría si"</div>
              {!simRunning && <button onClick={() => setShowSimulador(false)} style={{ background: "none", border: "none", color: C.dim, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 18 }}>
              Prueba a añadir o quitar vehículos sobre tu flota real y compara el resultado con el escenario actual — no se guarda nada hasta que tú lo decidas.
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 11, color: C.muted }}>Vehículos</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button onClick={() => setSimDelta(d => d - 1)} disabled={simRunning} style={{ width: 26, height: 26, borderRadius: 6, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, cursor: simRunning ? "not-allowed" : "pointer", fontSize: 14 }}>−</button>
                <span style={{ width: 46, textAlign: "center", fontFamily: mono, fontSize: 14, fontWeight: 700, color: simDelta > 0 ? C.green : simDelta < 0 ? C.red : C.muted }}>
                  {simDelta > 0 ? `+${simDelta}` : simDelta}
                </span>
                <button onClick={() => setSimDelta(d => d + 1)} disabled={simRunning} style={{ width: 26, height: 26, borderRadius: 6, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, cursor: simRunning ? "not-allowed" : "pointer", fontSize: 14 }}>+</button>
              </div>
              <span style={{ fontSize: 10, color: C.dim }}>respecto a los {vehicles.length} actuales</span>
            </div>

            <button onClick={runSimulation} disabled={simRunning || vehicles.length + simDelta <= 0} style={{
              width: "100%", padding: "9px", background: C.blue, border: "none", color: "#fff",
              borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: simRunning ? "wait" : "pointer",
              fontFamily: font, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              opacity: vehicles.length + simDelta <= 0 ? 0.5 : 1, marginBottom: 16,
            }}>
              {simRunning
                ? <><span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> Simulando…</>
                : "Simular"
              }
            </button>

            {simError && <div style={{ fontSize: 11, color: C.red, marginBottom: 12 }}>{simError}</div>}

            {simResult && (() => {
              const actual = { vehicleCount: schedules.vehicles?.length || 0, unassigned: unassigned.length, totalKm, daysUsed: constraints.days || 1 };
              const rows = [
                ["Vehículos", actual.vehicleCount, simResult.vehicleCount],
                ["Días", actual.daysUsed, simResult.daysUsed],
                ["Km totales", actual.totalKm.toFixed(0), simResult.totalKm.toFixed(0)],
                ["Sin asignar", actual.unassigned, simResult.unassigned],
              ];
              return (
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: C.surface2, padding: "7px 12px" }}>
                    <span style={{ fontSize: 10, color: C.dim, textTransform: "uppercase" }}></span>
                    <span style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", textAlign: "right" }}>Actual</span>
                    <span style={{ fontSize: 10, color: C.blueText, textTransform: "uppercase", textAlign: "right" }}>Simulado</span>
                  </div>
                  {rows.map(([label, a, s]) => {
                    const numA = +a, numS = +s;
                    const better = label === "Sin asignar" || label === "Km totales" || label === "Días" ? numS < numA : null;
                    const worse  = label === "Sin asignar" || label === "Km totales" || label === "Días" ? numS > numA : null;
                    const color = numS === numA ? C.text : better ? C.green : worse ? C.orange : C.text;
                    return (
                      <div key={label} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "8px 12px", borderTop: `1px solid ${C.border}` }}>
                        <span style={{ fontSize: 12, color: C.muted }}>{label}</span>
                        <span style={{ fontSize: 12, color: C.muted, fontFamily: mono, textAlign: "right" }}>{a}</span>
                        <span style={{ fontSize: 12, color, fontFamily: mono, fontWeight: 700, textAlign: "right" }}>{s}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// ── TAB PROYECTOS ─────────────────────────────────────────────────
const PROJECT_STATUS = {
  nuevo:        { label: "Nuevo",       color: C.muted },
  con_planning: { label: "Planning",    color: C.blue  },
  schedulado:   { label: "Schedulado",  color: C.green },
  publicado:    { label: "Publicado",   color: C.amber },
};

export function TabProyectos({ activeProject, onOpenProject, orgId, isSuperAdmin }) {
  const [projects,    setProjects]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [newModal,    setNewModal]    = useState(null);
  const [creating,    setCreating]    = useState(false);
  const [orgs,        setOrgs]        = useState([]);
  const [filterOrg,   setFilterOrg]   = useState("__all__");

  // Load orgs list for superadmin filter
  useEffect(() => {
    if (!isSuperAdmin) return;
    const unsub = onSnapshot(collection(db, "orgs"), snap => {
      setOrgs(snap.docs.map(d => ({ org_id: d.id, ...d.data() })).sort((a, b) => a.nombre?.localeCompare(b.nombre)));
    });
    return () => unsub();
  }, [isSuperAdmin]);

  const effectiveOrgId = isSuperAdmin
    ? (filterOrg === "__all__" ? null : filterOrg)
    : orgId;

  useEffect(() => {
    const constraints = effectiveOrgId ? [where("org_id", "==", effectiveOrgId)] : [];
    const unsub = onSnapshot(
      query(collection(db, "scheduling_projects"), ...constraints),
      snap => {
        const docs = snap.docs
          .map(d => {
            const data = d.data();
            // Strip tasks from memory — list view doesn't need them
            // (tasks remain in Firestore until user re-imports, which saves without them)
            const planning = data.planning
              ? { tasksCount: data.planning.tasksCount, importedAt: data.planning.importedAt, uniqueBarrios: data.planning.uniqueBarrios }
              : null;
            return { _id: d.id, ...data, planning };
          })
          .sort((a, b) => {
            const am = a.updatedAt?.toMillis?.() ?? 0;
            const bm = b.updatedAt?.toMillis?.() ?? 0;
            return bm - am;
          });
        setProjects(docs); setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [effectiveOrgId]);

  function createProject() {
    if (!newModal?.nombre?.trim()) return;
    const docId  = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const nombre = newModal.nombre.trim();
    const desc   = newModal.descripcion?.trim() || "";
    const mes    = newModal.mes || new Date().toISOString().slice(0, 7);
    const projectOrgId = newModal.orgId || effectiveOrgId;
    // Nunca caer en `docId` como org_id: un proyecto "huérfano" con su propio
    // id de documento como org_id parece crearse bien (no da ningún error),
    // pero todo lo que cuelga de él (vehículos, planes publicados en Rutas...)
    // queda invisible para siempre — ninguna consulta real filtra por ese
    // valor. El botón ya se desactiva en este caso, pero esto es la última
    // barrera por si algo lo evita (Enter en el formulario, etc.).
    if (!projectOrgId) { alert("No se puede crear el proyecto sin organización. Selecciona una."); return; }

    // Close modal and navigate immediately (optimistic)
    setNewModal(null);
    onOpenProject({ _id: docId, nombre, status: "nuevo", org_id: projectOrgId });

    // Save in background — alert only on failure
    setDoc(doc(db, "scheduling_projects", docId), {
      nombre, descripcion: desc, mes, status: "nuevo",
      org_id: projectOrgId,
      planning: null, scheduling: null,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }).catch(e => {
      console.error("createProject:", e);
      alert("Error al guardar el proyecto en la nube: " + e.message);
    });
  }

  async function removeProject(id) {
    if (!window.confirm("¿Eliminar este proyecto y todos sus datos?")) return;
    await deleteDoc(doc(db, "scheduling_projects", id));
  }

  const inpStyle = { width: "100%", background: C.surface2, border: `1px solid ${C.border2}`, color: C.text, borderRadius: 8, padding: "9px 12px", fontSize: 13, fontFamily: font, outline: "none", marginBottom: 10 };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 28 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isSuperAdmin ? 12 : 24 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Proyectos</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            Cada proyecto contiene su propio planning (paradas) y scheduling (asignación VRP).
          </div>
        </div>
        <button onClick={() => setNewModal({ nombre: "", descripcion: "", mes: new Date().toISOString().slice(0, 7) })} style={{
          padding: "8px 16px", background: C.blue, border: "none", color: "#fff",
          borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font,
          display: "flex", alignItems: "center", gap: 7,
        }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Nuevo proyecto
        </button>
      </div>

      {/* Superadmin org filter */}
      {isSuperAdmin && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <span style={{ fontSize: 12, color: C.muted, whiteSpace: "nowrap" }}>Organización:</span>
          <select
            value={filterOrg}
            onChange={e => setFilterOrg(e.target.value)}
            style={{ background: C.surface2, border: `1px solid ${C.border2}`, color: C.text, borderRadius: 8, padding: "7px 12px", fontSize: 13, fontFamily: font, outline: "none", cursor: "pointer", flex: 1, maxWidth: 320 }}
          >
            <option value="__all__">Todas las organizaciones ({projects.length})</option>
            {orgs.map(o => (
              <option key={o.org_id} value={o.org_id}>{o.nombre}</option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: C.dim }}>Cargando…</div>
      ) : projects.length === 0 ? (
        <div style={{ textAlign: "center", padding: 80, color: C.dim }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📁</div>
          <div style={{ fontSize: 14, color: C.muted, fontWeight: 600, marginBottom: 6 }}>Sin proyectos todavía</div>
          <div style={{ fontSize: 12 }}>Crea tu primer proyecto para empezar.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 14 }}>
          {projects.map(p => {
            const st = PROJECT_STATUS[p.status] || PROJECT_STATUS.nuevo;
            const isActive = activeProject?._id === p._id;
            const dateStr = p.updatedAt?.toDate?.().toLocaleDateString("es-ES", { day:"2-digit", month:"short", year:"numeric" }) || "—";
            return (
              <div key={p._id} style={{
                background: C.card,
                border: `1px solid ${isActive ? C.blue : C.border}`,
                borderRadius: 12, padding: 20,
                boxShadow: isActive ? `0 0 0 1px ${C.blue}` : "none",
                display: "flex", flexDirection: "column", gap: 14,
                animation: "sched-fadein .15s ease both",
              }}>
                {/* Title row */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{p.nombre}</span>
                      {isActive && <span style={{ fontSize: 9, background: C.blueDim, color: C.blueText, borderRadius: 4, padding: "2px 6px", fontWeight: 600 }}>ABIERTO</span>}
                    </div>
                    <div style={{ fontSize: 10, color: C.dim }}>{p.mes} · {dateStr}</div>
                    {p.descripcion && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{p.descripcion}</div>}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: st.color, background: st.color + "22", borderRadius: 5, padding: "3px 8px", border: `1px solid ${st.color}44`, flexShrink: 0 }}>
                    {st.label}
                  </span>
                </div>

                {/* Planning section */}
                <div style={{ background: C.surface2, borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 9, color: C.dim, letterSpacing: 1.3, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>Planning</div>
                  {p.planning ? (
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>
                        {p.planning.tasksCount} paradas
                      </div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {(p.planning.uniqueBarrios || []).slice(0, 8).map(b => (
                          <span key={b} style={{ fontSize: 9, background: barrioColor(b) + "28", border: `1px solid ${barrioColor(b)}55`, color: barrioColor(b), borderRadius: 4, padding: "1px 6px" }}>{b}</span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: C.dim, fontStyle: "italic" }}>Sin planning — importa desde Planning</div>
                  )}
                </div>

                {/* Scheduling section */}
                <div style={{ background: C.surface2, borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 9, color: C.dim, letterSpacing: 1.3, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>Scheduling</div>
                  {p.scheduling ? (
                    <div style={{ display: "flex", gap: 20 }}>
                      {[
                        [p.scheduling.daysUsed || 1, "días"],
                        [p.scheduling.totalStops || 0, "paradas"],
                        [`${(p.scheduling.totalKm || 0).toFixed(0)} km`, ""],
                        [p.scheduling.vehicleSchedule?.length || 0, "vehículos"],
                      ].map(([v, l]) => (
                        <div key={l}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: C.green }}>{v}</div>
                          <div style={{ fontSize: 9, color: C.dim }}>{l}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: C.dim, fontStyle: "italic" }}>Sin schedule — genera el VRP</div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => onOpenProject(p)}
                    style={{
                      flex: 1, padding: "8px 0",
                      background: isActive ? C.blueDim : C.blue,
                      border: `1px solid ${C.blue}`,
                      color: isActive ? C.blueText : "#fff",
                      borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font,
                      transition: "all .12s",
                    }}
                    onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = "#3a7de0"; } }}
                    onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = C.blue; } }}
                  >{isActive ? "Ya abierto" : "Abrir proyecto"}</button>
                  <button
                    onClick={() => removeProject(p._id)}
                    style={{ width: 34, height: 34, background: "none", border: `1px solid ${C.border}`, color: C.dim, borderRadius: 7, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
                  >×</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New project modal */}
      {newModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}
          onClick={() => setNewModal(null)}>
          <div style={{ background: C.card, borderRadius: 14, padding: "28px 28px 22px", width: 400, boxShadow: "0 24px 64px rgba(0,0,0,0.5)", border: `1px solid ${C.border}` }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 18 }}>Nuevo proyecto</div>
            {isSuperAdmin && (
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 4 }}>Organización *</label>
                <select
                  value={newModal.orgId || effectiveOrgId || ""}
                  onChange={e => setNewModal(p => ({ ...p, orgId: e.target.value }))}
                  style={{ ...inpStyle, marginBottom: 0, cursor: "pointer", colorScheme: "dark" }}
                >
                  <option value="">— Selecciona una organización —</option>
                  {orgs.map(o => <option key={o.org_id} value={o.org_id}>{o.nombre}</option>)}
                </select>
              </div>
            )}
            <input autoFocus placeholder="Nombre del proyecto *" value={newModal.nombre}
              onChange={e => setNewModal(p => ({ ...p, nombre: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && createProject()}
              style={inpStyle} />
            <input placeholder="Descripción (opcional)" value={newModal.descripcion}
              onChange={e => setNewModal(p => ({ ...p, descripcion: e.target.value }))}
              style={inpStyle} />
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 4 }}>Mes de servicio</label>
              <input type="month" value={newModal.mes}
                onChange={e => setNewModal(p => ({ ...p, mes: e.target.value }))}
                style={{ ...inpStyle, marginBottom: 0, width: "auto", colorScheme: "dark" }} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button onClick={() => setNewModal(null)} style={{ flex: 1, padding: "9px 0", background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: font }}>Cancelar</button>
              <button onClick={createProject} disabled={creating || !newModal.nombre.trim() || (isSuperAdmin && !newModal.orgId && !effectiveOrgId)} style={{
                flex: 2, padding: "9px 0", background: C.blue, border: "none", color: "#fff",
                borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: creating ? "wait" : "pointer",
                fontFamily: font, opacity: !newModal.nombre.trim() ? .5 : 1,
              }}>{creating ? "Creando…" : "Crear proyecto"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── SCHEDULING PAGE ───────────────────────────────────────────────
export function SchedulingModuleWrapper({ vehicles, workers, loadingV, loadingW, activeProject, onProjectUpdate, orgId }) {
  const [subTab, setSubTab] = useState("vrp");
  const SUB_TABS = [
    { key: "vrp",          label: "VRP / Gantt" },
    { key: "vehiculos",    label: `Vehículos${vehicles.length ? ` (${vehicles.length})` : ""}` },
    { key: "trabajadores", label: `Trabajadores${workers.length ? ` (${workers.length})` : ""}` },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <div style={{
        height: 38, flexShrink: 0,
        background: C.card, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "stretch", padding: "0 20px", gap: 2,
      }}>
        {SUB_TABS.map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "0 14px", fontFamily: font,
            fontSize: 12, fontWeight: subTab === t.key ? 600 : 400,
            color: subTab === t.key ? C.text : C.muted,
            borderBottom: `2px solid ${subTab === t.key ? C.blue : "transparent"}`,
            marginBottom: -1, transition: "color .12s",
          }}>{t.label}</button>
        ))}
      </div>
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, display: subTab === "vrp" ? "flex" : "none", overflow: "hidden" }}>
          <TabPlanificacion
            vehicles={vehicles} workers={workers}
            activeProject={activeProject}
            onProjectUpdate={onProjectUpdate}
            orgId={orgId}
          />
        </div>
        {subTab === "vehiculos"    && <TabVehiculos vehicles={vehicles} loading={loadingV} activeProject={activeProject} orgId={orgId} />}
        {subTab === "trabajadores" && <TabTrabajadores workers={workers} vehicles={vehicles} loading={loadingW} orgId={orgId} />}
      </div>
    </div>
  );
}

function SchedulingPage({ sesion, onLogout }) {
  const [tab,              setTab]              = useState("proyectos");
  const [vehicles,         setVehicles]         = useState([]);
  const [workers,          setWorkers]          = useState([]);
  const [loadingV,         setLoadingV]         = useState(true);
  const [loadingW,         setLoadingW]         = useState(true);
  const [activeProject,    setActiveProject]    = useState(null);
  const [planningEverOpen, setPlanningEverOpen] = useState(false);

  useEffect(() => {
    if (!sesion?.org_id) return;
    const unsub = onSnapshot(
      query(collection(db, "scheduling_vehicles"), where("org_id", "==", sesion.org_id)),
      snap => { setVehicles(snap.docs.map(d => ({ _id: d.id, ...d.data() }))); setLoadingV(false); },
      () => setLoadingV(false)
    );
    return () => unsub();
  }, [sesion?.org_id]);

  useEffect(() => {
    if (!sesion?.org_id) return;
    const unsub = onSnapshot(
      query(collection(db, "scheduling_workers"), where("org_id", "==", sesion.org_id)),
      snap => { setWorkers(snap.docs.map(d => ({ _id: d.id, ...d.data() }))); setLoadingW(false); },
      () => setLoadingW(false)
    );
    return () => unsub();
  }, [sesion?.org_id]);

  const initials = ((sesion.nombre?.[0] ?? "") + (sesion.apellidos?.[0] ?? "")).toUpperCase();

  async function handleProjectUpdate(updates) {
    if (!activeProject) return;
    const ref = doc(db, "scheduling_projects", activeProject._id);
    await updateDoc(ref, { ...updates, updatedAt: serverTimestamp() });
    setActiveProject(prev => ({ ...prev, ...updates }));
  }

  function openProject(p) {
    setActiveProject(p);
    setPlanningEverOpen(false);
    setTab("planificacion");
  }

  function closeProject() {
    setActiveProject(null);
    setPlanningEverOpen(false);
    setTab("planificacion");
  }

  function goToTab(key) {
    if (key === "planning") setPlanningEverOpen(true);
    setTab(key);
  }

  const PROJECT_TABS = [
    { key: "planning",      label: "Planning" },
    { key: "planificacion", label: "Scheduling" },
    { key: "vehiculos",     label: `Vehículos${vehicles.length ? ` (${vehicles.length})` : ""}` },
    { key: "trabajadores",  label: `Trabajadores${workers.length ? ` (${workers.length})` : ""}` },
  ];

  const UserAvatar = (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{sesion.nombre}</div>
        <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: .5 }}>{sesion.rol}</div>
      </div>
      <button onClick={onLogout} title="Cerrar sesión" style={{
        width: 32, height: 32, borderRadius: "50%", background: C.surface2,
        border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, fontWeight: 600,
        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all .15s",
      }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.text; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
      >{initials}</button>
    </div>
  );

  /* ── PROJECTS LANDING (no active project) ─────────────────────── */
  if (!activeProject) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: C.bg, fontFamily: font }}>
        <div style={{
          height: 52, flexShrink: 0, background: C.card,
          borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 20px", zIndex: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <a href="/planning" style={{ fontSize: 11, color: C.dim, letterSpacing: 2, textTransform: "uppercase", fontWeight: 600, textDecoration: "none", transition: "color .12s" }}
              onMouseEnter={e => e.currentTarget.style.color = C.muted}
              onMouseLeave={e => e.currentTarget.style.color = C.dim}>
              Operanzia
            </a>
            <div style={{ width: 1, height: 16, background: C.border2 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Proyectos</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <a href="/planning" style={{
              fontSize: 12, color: C.muted, fontFamily: font, textDecoration: "none",
              padding: "5px 12px", borderRadius: 6, border: `1px solid ${C.border}`,
              transition: "all .15s", display: "flex", alignItems: "center", gap: 6,
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blue; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="9 3 9 21"/></svg>
              Planning
            </a>
            {UserAvatar}
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          <TabProyectos activeProject={null} onOpenProject={openProject} orgId={sesion?.org_id} isSuperAdmin={sesion?.rol === "superadmin"} />
        </div>
      </div>
    );
  }

  /* ── PROJECT WORKSPACE (active project) ────────────────────────── */
  const STATUS_COLORS = { nuevo: C.dim, con_planning: C.blue, schedulado: C.green, publicado: "#f59e0b" };
  const STATUS_LABELS = { nuevo: "Nuevo", con_planning: "Con planning", schedulado: "Schedulado", publicado: "Publicado" };

  const IconPlanning = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>;
  const IconSchedule = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;

  function RailBtn({ navKey, icon, label }) {
    const active = tab === navKey;
    return (
      <div style={{ position: "relative", display: "flex", justifyContent: "center" }} className="rail-item">
        <button onClick={() => goToTab(navKey)} title={label} style={{
          width: 44, height: 44, borderRadius: 10,
          background: active ? `${C.blue}22` : "none",
          border: `1px solid ${active ? `${C.blue}55` : "transparent"}`,
          color: active ? C.blue : C.dim,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all .15s",
        }}
          onMouseEnter={e => { if (!active) { e.currentTarget.style.background = C.surface2; e.currentTarget.style.color = C.muted; } }}
          onMouseLeave={e => { if (!active) { e.currentTarget.style.background = active ? `${C.blue}22` : "none"; e.currentTarget.style.color = active ? C.blue : C.dim; } }}
        >
          {icon}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", background: C.bg, fontFamily: font }}>

      {/* ── ICON RAIL (48px) ───────────────────────────────────────── */}
      <div style={{
        width: 56, flexShrink: 0,
        background: C.card, borderRight: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column", alignItems: "center",
        paddingTop: 10, paddingBottom: 10, gap: 4, zIndex: 20,
      }}>
        {/* Back to projects */}
        <button onClick={closeProject} title="Todos los proyectos" style={{
          width: 44, height: 36, borderRadius: 8, background: "none",
          border: "none", color: C.dim, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all .15s", marginBottom: 6,
        }}
          onMouseEnter={e => { e.currentTarget.style.background = C.surface2; e.currentTarget.style.color = C.muted; }}
          onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = C.dim; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>

        {/* Project initial */}
        <div title={activeProject.nombre} style={{
          width: 32, height: 32, borderRadius: 8,
          background: `${C.blue}22`, border: `1px solid ${C.blue}44`,
          color: C.blue, fontSize: 12, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 8, cursor: "default",
        }}>
          {(activeProject.nombre?.[0] ?? "P").toUpperCase()}
        </div>

        {/* Nav icons */}
        <RailBtn navKey="planning"      icon={IconPlanning} label="Planning"   />
        <RailBtn navKey="planificacion" icon={IconSchedule} label="Scheduling" />

        {/* User at bottom */}
        <div style={{ flex: 1 }} />
        <button onClick={onLogout} title={`${sesion.nombre} — Cerrar sesión`} style={{
          width: 32, height: 32, borderRadius: "50%", background: C.surface2,
          border: `1px solid ${C.border}`, color: C.muted, fontSize: 10, fontWeight: 700,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all .15s",
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
        >{initials}</button>
      </div>

      {/* ── CONTENT AREA — position:relative so tabs stack with absolute inset ── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* Planning: always mounted once opened, visibility:hidden preserves
            Leaflet dimensions so tiles render correctly when tab is inactive */}
        {planningEverOpen && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", overflow: "hidden",
            visibility: tab === "planning" ? "visible" : "hidden",
            pointerEvents: tab === "planning" ? "auto" : "none",
          }}>
            <PlanningPage sesion={sesion} onLogout={() => {}} projectId={activeProject._id} embedded />
          </div>
        )}
        {/* Scheduling — standard display toggle, no Leaflet inside */}
        <div style={{
          position: "absolute", inset: 0, display: tab === "planificacion" ? "flex" : "none",
          flexDirection: "column", overflow: "hidden",
        }}>
          <SchedulingModuleWrapper
            vehicles={vehicles} workers={workers} loadingV={loadingV} loadingW={loadingW}
            activeProject={activeProject} onProjectUpdate={handleProjectUpdate}
            orgId={sesion?.org_id}
          />
        </div>
      </div>
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────
// LoginScheduling vive en ./login-scheduling.jsx (sin depender de este
// archivo) para que la pantalla de login no tenga que descargar todo el
// bundle de Scheduling/Planning/Rostering solo para mostrar un formulario.
// Se re-exporta aquí porque otros módulos aún la importan desde ./scheduling.jsx.
export { LoginScheduling };

// ── ROOT ──────────────────────────────────────────────────────────
export default function SchedulingApp() {
  const [sesion, setSesion] = useState(undefined); // undefined=cargando

  useEffect(() => {
    return onAuthStateChanged(auth, async user => {
      if (user) {
        try {
          const snap = await getUserProfileSafe(user.uid);
          if (snap.exists() && snap.data().activo !== false) {
            setSesion({ uid: user.uid, ...snap.data() });
          } else { await signOut(auth); setSesion(null); }
        } catch { setSesion(null); }
      } else { setSesion(null); }
    });
  }, []);

  async function handleLogin(profile) { setSesion(profile); }
  async function handleLogout() { await signOut(auth); setSesion(null); }

  if (sesion === undefined) return (
    <div style={{ display:"flex", height:"100vh", alignItems:"center", justifyContent:"center", background:C.bg, fontFamily:font }}>
      <div style={{ color:C.muted, fontSize:13 }}>Cargando…</div>
    </div>
  );
  if (!sesion || sesion.rol !== "admin") return <LoginScheduling onLogin={handleLogin} />;
  return <SchedulingPage sesion={sesion} onLogout={handleLogout} />;
}
