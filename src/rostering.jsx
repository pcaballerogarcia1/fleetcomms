import { useState, useEffect, useRef } from "react";
import { db } from "./firebase.js";
import {
  doc, onSnapshot, setDoc, serverTimestamp,
  collection, query, where,
} from "firebase/firestore";

// ── DESIGN TOKENS ─────────────────────────────────────────────────
const C = {
  bg: "#0f1623", card: "#172035", surface2: "#1e2d48",
  border: "rgba(88,130,225,0.22)", border2: "rgba(88,130,225,0.40)",
  text: "#e2eeff", muted: "#8aa5cc", dim: "#4a5f82",
  blue: "#5c9bff",
};
const font = "'Inter',system-ui,sans-serif";

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

const DAY_NAMES  = ["D","L","M","X","J","V","S"];
const MONTH_NAMES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

// dailyDetail guarda minutos absolutos (pueden pasar de 1440 en turnos de
// noche que cruzan medianoche) — %1440 para la hora de reloj.
function fmtClock(min) {
  if (min == null) return "--:--";
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// ── PUBLIC HOOK ────────────────────────────────────────────────────
// Used by scheduling.jsx to load rostering data for a given month.
export function useRostering(orgId, year, month) {
  const [grid,    setGrid]    = useState({});
  const [loading, setLoading] = useState(true);

  const docId = (orgId && year && month)
    ? `${orgId}_${year}_${String(month).padStart(2, "0")}`
    : null;

  const loadedRef = useRef(false);

  useEffect(() => {
    if (!docId) { setGrid({}); setLoading(false); return; }
    loadedRef.current = false;
    setGrid({});
    setLoading(true);
    return onSnapshot(doc(db, "rostering", docId), snap => {
      // Only overwrite from Firestore on initial load; local edits take over after
      if (!loadedRef.current) {
        setGrid(snap.exists() ? (snap.data().grid ?? {}) : {});
        loadedRef.current = true;
      }
      setLoading(false);
    });
  }, [docId]);

  return { grid, loading, docId };
}

// Helper exported for scheduling conflict check
export function workerCodeOnDay(grid, workerId, day) {
  return grid[workerId]?.[String(day)] ?? "";
}
export function isUnavailable(code) {
  return code === "L" || code === "B";
}

// ── MAIN PAGE ──────────────────────────────────────────────────────
export function RosteringPage({ sesion, embedded = false, activeProject = null, orgId: orgIdProp = null }) {
  const orgId = orgIdProp ?? sesion?.org_id ?? null;

  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [workers, setWorkers] = useState([]);

  // ── Scheduling roster (populated when a scenario is generated) ──
  const [schedRoster, setSchedRoster] = useState(null); // { mes, turnoByWorker, daysWorked }

  useEffect(() => {
    if (!activeProject?._id) { setSchedRoster(null); return; }
    return onSnapshot(doc(db, "scheduling_roster", activeProject._id), snap => {
      setSchedRoster(snap.exists() ? snap.data() : null);
    });
  }, [activeProject?._id]);

  // Given a calendar day in the current view, return the scheduling day number
  // (1-indexed from the first day of schedRoster.mes). Returns null if out of range.
  function schedDayFor(calDay) {
    if (!schedRoster?.mes) return null;
    const [sy, sm] = schedRoster.mes.split("-").map(Number);
    const startDate = new Date(sy, sm - 1, 1);
    const thisDate  = new Date(year, month - 1, calDay);
    const diff = Math.round((thisDate - startDate) / 86400000);
    const dayNum = diff + 1;
    return dayNum >= 1 ? dayNum : null;
  }

  // Returns the scheduled shift code for a worker on a calendar day, or null
  function scheduledCode(workerId, calDay) {
    if (!schedRoster) return null;
    const dayNum = schedDayFor(calDay);
    if (!dayNum) return null;
    const days = schedRoster.daysWorked?.[workerId];
    if (!days || !days.includes(dayNum)) return null;
    return schedRoster.turnoByWorker?.[workerId] ?? null;
  }

  // Local grid state (Firestore is the backing store, but we edit locally)
  const [grid,    setGrid]    = useState({});
  const [loading, setLoading] = useState(true);

  const loadedRef    = useRef(false);
  const debounceRef  = useRef({});
  const pendingRef   = useRef(null);
  const tableRef     = useRef(null);
  const isDragging   = useRef(false);

  // Selection range: anchor + active corner of the rectangle
  const [selStart, setSelStart] = useState(null); // { wIdx, dIdx }
  const [selEnd,   setSelEnd]   = useState(null); // { wIdx, dIdx }

  // Resumen del turno (clic derecho en una celda) — el borrado por clic
  // derecho ya era redundante con Supr/Retroceso sobre la selección, así
  // que se libera el botón derecho para esto en vez de quitar la manera de
  // borrar.
  const [summaryCell, setSummaryCell] = useState(null); // { workerId, day, x, y }

  const docId = orgId
    ? `${orgId}_${year}_${String(month).padStart(2, "0")}`
    : null;

  // Load workers
  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(
      query(collection(db, "scheduling_workers"), where("org_id", "==", orgId)),
      snap => setWorkers(
        snap.docs
          .map(d => ({ _id: d.id, ...d.data() }))
          .sort((a, b) =>
            `${a.nombre ?? ""}${a.apellidos ?? ""}`.localeCompare(
              `${b.nombre ?? ""}${b.apellidos ?? ""}`
            )
          )
      )
    );
  }, [orgId]);

  // Load rostering for selected month
  useEffect(() => {
    if (!docId) { setGrid({}); setLoading(false); return; }
    loadedRef.current = false;
    setGrid({});
    setLoading(true);
    return onSnapshot(doc(db, "rostering", docId), snap => {
      if (!loadedRef.current) {
        setGrid(snap.exists() ? (snap.data().grid ?? {}) : {});
        loadedRef.current = true;
      }
      setLoading(false);
    });
  }, [docId]);

  // ── Calendar helpers ──────────────────────────────────────────
  const daysInMonth = new Date(year, month, 0).getDate();
  const days        = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  function getDow(day)     { return new Date(year, month - 1, day).getDay(); }
  function isWeekend(day)  { const d = getDow(day); return d === 0 || d === 6; }
  function isToday(day) {
    const t = new Date();
    return t.getFullYear() === year && t.getMonth() + 1 === month && t.getDate() === day;
  }

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  // Global mouseup to stop drag (even if mouse leaves the table)
  useEffect(() => {
    const stop = () => { isDragging.current = false; };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  // ── Selection helpers ─────────────────────────────────────────
  function getSelRange() {
    if (!selStart) return null;
    const end = selEnd ?? selStart;
    return {
      r0: Math.min(selStart.wIdx, end.wIdx),
      r1: Math.max(selStart.wIdx, end.wIdx),
      c0: Math.min(selStart.dIdx, end.dIdx),
      c1: Math.max(selStart.dIdx, end.dIdx),
    };
  }

  function isCellSelected(wIdx, dIdx) {
    const r = getSelRange();
    if (!r) return false;
    return wIdx >= r.r0 && wIdx <= r.r1 && dIdx >= r.c0 && dIdx <= r.c1;
  }

  function selectedCount() {
    const r = getSelRange();
    if (!r) return 0;
    return (r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1);
  }

  // ── Cell editing ──────────────────────────────────────────────

  // Apply a shift to all currently selected cells in one Firestore write
  function applyToSelection(shift) {
    const r = getSelRange();
    if (!r) return;
    let newGrid = { ...grid };
    for (let wi = r.r0; wi <= r.r1; wi++) {
      const w = workers[wi];
      if (!w) continue;
      const wGrid = { ...(newGrid[w._id] ?? {}) };
      for (let di = r.c0; di <= r.c1; di++) {
        const d = days[di];
        if (d === undefined) continue;
        if (shift) wGrid[String(d)] = shift;
        else delete wGrid[String(d)];
      }
      newGrid[w._id] = wGrid;
    }
    setGrid(newGrid);
    pendingRef.current = newGrid;
    clearTimeout(debounceRef.current._batch);
    debounceRef.current._batch = setTimeout(() => {
      if (!docId || !pendingRef.current) return;
      setDoc(doc(db, "rostering", docId), {
        org_id: orgId, year, month, grid: pendingRef.current, updatedAt: serverTimestamp(),
      });
    }, 400);
  }

  // Keyboard handler for the grid
  function handleKeyDown(e) {
    if (!selStart) return;
    const { wIdx, dIdx } = selStart;
    const key = e.key.toUpperCase();
    const multi = selEnd && (selEnd.wIdx !== selStart.wIdx || selEnd.dIdx !== selStart.dIdx);

    if (SHIFTS.includes(key)) {
      e.preventDefault();
      applyToSelection(key);
      // Single cell only: advance cursor right after assign
      if (!multi) {
        const next = Math.min(days.length - 1, dIdx + 1);
        setSelStart({ wIdx, dIdx: next });
        setSelEnd(null);
      }
      return;
    }

    if (key === "DELETE" || key === "BACKSPACE") {
      e.preventDefault();
      applyToSelection("");
      return;
    }

    // Arrow keys move single-cell selection (collapse range)
    if (key === "ARROWLEFT")  { e.preventDefault(); setSelStart({ wIdx, dIdx: Math.max(0, dIdx - 1) }); setSelEnd(null); return; }
    if (key === "ARROWRIGHT") { e.preventDefault(); setSelStart({ wIdx, dIdx: Math.min(days.length - 1, dIdx + 1) }); setSelEnd(null); return; }
    if (key === "ARROWUP")    { e.preventDefault(); setSelStart({ wIdx: Math.max(0, wIdx - 1), dIdx }); setSelEnd(null); return; }
    if (key === "ARROWDOWN")  { e.preventDefault(); setSelStart({ wIdx: Math.min(workers.length - 1, wIdx + 1), dIdx }); setSelEnd(null); return; }
    if (key === "ESCAPE")     { e.preventDefault(); setSelStart(null); setSelEnd(null); tableRef.current?.blur(); return; }
  }

  // Mouse handlers for drag / shift-click selection
  function handleCellMouseDown(e, wIdx, dIdx) {
    e.preventDefault(); // prevent native text selection during drag
    isDragging.current = true;
    if (e.shiftKey && selStart) {
      setSelEnd({ wIdx, dIdx });
    } else {
      setSelStart({ wIdx, dIdx });
      setSelEnd(null);
    }
    tableRef.current?.focus();
  }

  function handleCellMouseEnter(wIdx, dIdx) {
    if (!isDragging.current) return;
    setSelEnd({ wIdx, dIdx });
  }

  // Fill entire row with a shift
  function fillRow(workerId, shift) {
    const wGrid = {};
    for (const d of days) wGrid[String(d)] = shift;
    const newGrid = { ...grid, [workerId]: wGrid };
    setGrid(newGrid);
    pendingRef.current = newGrid;
    if (docId) setDoc(doc(db, "rostering", docId), {
      org_id: orgId, year, month, grid: newGrid, updatedAt: serverTimestamp(),
    });
  }

  // ── Optimizar: auto-assign scheduled shifts respecting availability ──
  function optimizar() {
    // Antes esto no avisaba de nada si no había escenario generado para
    // este proyecto/mes — el botón "no hacía nada" en silencio y parecía
    // roto. Ahora explica por qué, en vez de quedarse callado.
    if (!activeProject) {
      alert("Abre un proyecto con un escenario generado en Scheduling primero.");
      return;
    }
    if (!schedRoster) {
      alert("Este proyecto todavía no tiene un escenario generado en Scheduling — no hay turnos que asignar.");
      return;
    }
    if (schedRoster.mes && schedRoster.mes !== `${year}-${String(month).padStart(2, "0")}`) {
      alert(`El escenario generado es de ${schedRoster.mes}, pero estás viendo ${year}-${String(month).padStart(2, "0")} — cambia el mes del calendario para verlo.`);
      return;
    }

    const BLOCKED = new Set(["L", "B"]);     // can't override
    const MANUAL  = new Set(["M","T","N","G"]); // already manually set, skip

    const newGrid = { ...grid };
    let assignedCount = 0, skippedNoCode = 0;
    for (const w of workers) {
      const wId  = w._id;
      const code = schedRoster.turnoByWorker?.[wId];
      const scheduledDays = new Set(schedRoster.daysWorked?.[wId] ?? []);
      if (!code) { if (scheduledDays.size) skippedNoCode++; continue; }
      const wGrid = { ...(newGrid[wId] ?? {}) };
      for (const d of days) {
        const dayNum = schedDayFor(d);
        if (!dayNum || !scheduledDays.has(dayNum)) continue;
        const cur = wGrid[String(d)] ?? "";
        if (BLOCKED.has(cur) || MANUAL.has(cur)) continue;
        wGrid[String(d)] = code;
        assignedCount++;
      }
      newGrid[wId] = wGrid;
    }
    setGrid(newGrid);
    pendingRef.current = newGrid;
    if (docId) setDoc(doc(db, "rostering", docId), {
      org_id: orgId, year, month, grid: newGrid, updatedAt: serverTimestamp(),
    });

    if (assignedCount === 0) {
      alert(skippedNoCode > 0
        ? "No se ha asignado ningún turno nuevo — las celdas ya estaban marcadas manualmente (M/T/N/G), libres o de baja."
        : "No se ha asignado ningún turno — regenera el escenario en Scheduling para este proyecto/mes.");
    } else {
      alert(`Se han asignado ${assignedCount} turno(s).${skippedNoCode > 0 ? ` ${skippedNoCode} trabajador(es) con paradas asignadas no tenían un turno reconocible.` : ""}`);
    }
  }

  // ── Totals ────────────────────────────────────────────────────
  function dayTotals(day) {
    const key    = String(day);
    const counts = {};
    for (const w of workers) {
      const v = grid[w._id]?.[key];
      if (v) counts[v] = (counts[v] ?? 0) + 1;
    }
    return counts;
  }

  function workerStats(workerId) {
    const counts = {};
    for (const v of Object.values(grid[workerId] ?? {})) {
      if (v) counts[v] = (counts[v] ?? 0) + 1;
    }
    return counts;
  }

  // ── Render ─────────────────────────────────────────────────────
  const CELL_W  = 34;
  const NAME_W  = 182;
  const STATS_W = 130;

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: embedded ? "100%" : "100vh",
      background: C.bg, fontFamily: font, overflow: "hidden",
    }}>

      {/* ── HEADER ──────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0, background: C.card,
        borderBottom: `1px solid ${C.border}`,
        padding: "10px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      }}>
        {/* Month nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={prevMonth} style={navBtnStyle}>‹</button>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, minWidth: 200, textAlign: "center" }}>
            {MONTH_NAMES[month - 1]} {year}
          </div>
          <button onClick={nextMonth} style={navBtnStyle}>›</button>
          <div style={{ fontSize: 11, color: C.dim, marginLeft: 8 }}>
            {workers.length} trabajadores · {daysInMonth} días
          </div>
        </div>

        {/* Legend + export */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {SHIFTS.map(s => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{
                width: 22, height: 22, borderRadius: 4,
                background: SHIFT_META[s].bg,
                border: `1px solid ${SHIFT_META[s].text}55`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: SHIFT_META[s].text, fontWeight: 700, fontSize: 11,
              }}>{s}</div>
              <span style={{ fontSize: 11, color: C.muted }}>{SHIFT_META[s].label}</span>
            </div>
          ))}

          {/* Scheduling overlay legend + optimizar */}
          {schedRoster && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, borderLeft: `1px solid ${C.border}`, paddingLeft: 10 }}>
              <div style={{
                width: 22, height: 22, borderRadius: 4,
                background: SHIFT_META["M"].bg + "55",
                border: `1px dashed ${SHIFT_META["M"].text}44`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: SHIFT_META["M"].text + "88", fontWeight: 700, fontSize: 11,
              }}>M</div>
              <span style={{ fontSize: 11, color: C.dim }}>= planificado</span>
              <button
                onClick={optimizar}
                style={{
                  marginLeft: 4,
                  padding: "4px 12px", borderRadius: 6,
                  background: C.blue + "22",
                  border: `1px solid ${C.blue}55`,
                  color: C.blue, fontSize: 12, fontWeight: 600,
                  cursor: "pointer", fontFamily: font,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = C.blue + "40"; }}
                onMouseLeave={e => { e.currentTarget.style.background = C.blue + "22"; }}
                title="Asigna los turnos del escenario de scheduling a los trabajadores disponibles"
              >
                Optimizar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── GRID ────────────────────────────────────────────────── */}
      <div ref={tableRef} tabIndex={0} onKeyDown={handleKeyDown}
        style={{ flex: 1, overflow: "auto", outline: "none" }}
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) { setSelStart(null); setSelEnd(null); } }}
      >
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.dim, fontSize: 13 }}>
            Cargando…
          </div>
        ) : workers.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: C.dim, fontSize: 13, gap: 8 }}>
            <div style={{ fontSize: 32 }}>👥</div>
            <div>Sin trabajadores. Añade trabajadores en el módulo de Scheduling.</div>
          </div>
        ) : (
          <table style={{ borderCollapse: "collapse", tableLayout: "fixed", minWidth: NAME_W + daysInMonth * CELL_W + STATS_W }}>
            <thead>
              <tr>
                {/* Name header */}
                <th style={{
                  ...thStyle, width: NAME_W, minWidth: NAME_W,
                  position: "sticky", left: 0, top: 0, zIndex: 5,
                  background: C.card, textAlign: "left",
                  padding: "6px 12px", borderRight: `1px solid ${C.border2}`,
                }}>
                  Trabajador
                </th>

                {/* Day headers */}
                {days.map(d => {
                  const dow     = getDow(d);
                  const weekend = isWeekend(d);
                  const today   = isToday(d);
                  return (
                    <th key={d} style={{
                      width: CELL_W, minWidth: CELL_W,
                      position: "sticky", top: 0, zIndex: 3,
                      background: today ? "#0e2248" : weekend ? "#161e34" : C.card,
                      borderBottom: `2px solid ${today ? C.blue : C.border}`,
                      borderRight: `1px solid ${C.border}`,
                      padding: "3px 0", textAlign: "center",
                    }}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: today ? C.blue : weekend ? "#fb923c" : C.dim }}>
                        {DAY_NAMES[dow]}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: today ? 700 : 500, color: today ? C.blue : weekend ? "#fb923c88" : C.muted }}>
                        {d}
                      </div>
                    </th>
                  );
                })}

                {/* Stats header */}
                <th style={{
                  ...thStyle, width: STATS_W, minWidth: STATS_W,
                  position: "sticky", right: 0, top: 0, zIndex: 5,
                  background: C.card, textAlign: "center",
                  borderLeft: `1px solid ${C.border2}`,
                }}>
                  Resumen mes
                </th>
              </tr>
            </thead>

            <tbody>
              {workers.map((w, wi) => {
                const stats = workerStats(w._id);
                const rowBg = wi % 2 === 0 ? C.bg : "#12161f";
                const shiftMeta = w.turno ? SHIFT_META[w.turno] : null;

                return (
                  <tr key={w._id}>
                    {/* Worker name */}
                    <td style={{
                      position: "sticky", left: 0, zIndex: 2,
                      background: rowBg, height: 32,
                      borderRight: `1px solid ${C.border2}`,
                      borderBottom: `1px solid ${C.border}`,
                      padding: "0 10px",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {shiftMeta && (
                          <div style={{
                            width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                            background: shiftMeta.bg,
                            border: `1px solid ${shiftMeta.text}44`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: shiftMeta.text, fontWeight: 700, fontSize: 9,
                          }}>{w.turno}</div>
                        )}
                        <span style={{
                          fontSize: 12, color: C.text, fontWeight: 500,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          maxWidth: NAME_W - 60, cursor: "default",
                        }}
                          title={`${w.nombre ?? ""} ${w.apellidos ?? ""} — clic derecho en celdas para borrar`}
                        >
                          {[w.nombre, w.apellidos].filter(Boolean).join(" ")}
                        </span>
                        {/* Quick-fill button */}
                        <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
                          {["M","T","N"].map(s => (
                            <button key={s} onClick={() => fillRow(w._id, s)}
                              title={`Rellenar mes con ${SHIFT_META[s].label}`}
                              style={{
                                width: 14, height: 14, borderRadius: 2, border: "none",
                                background: SHIFT_META[s].bg, color: SHIFT_META[s].text,
                                fontSize: 8, fontWeight: 700, cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                padding: 0, lineHeight: 1,
                              }}
                            >{s}</button>
                          ))}
                        </div>
                      </div>
                    </td>

                    {/* Shift cells */}
                    {days.map((d, dIdx) => {
                      const shift    = grid[w._id]?.[String(d)] ?? "";
                      const sched    = scheduledCode(w._id, d); // from scheduling scenario
                      const display  = shift || sched;
                      const isManual = !!shift;
                      const meta     = display ? SHIFT_META[display] : null;
                      const weekend  = isWeekend(d);
                      const today    = isToday(d);
                      const selected = isCellSelected(wi, dIdx);

                      return (
                        <td key={d}
                          onMouseDown={e => handleCellMouseDown(e, wi, dIdx)}
                          onMouseEnter={e => { handleCellMouseEnter(wi, dIdx); e.currentTarget.style.filter = "brightness(1.35)"; }}
                          onMouseLeave={e => { e.currentTarget.style.filter = "brightness(1)"; }}
                          onContextMenu={e => {
                            e.preventDefault();
                            setSummaryCell({ workerId: w._id, day: d, x: e.clientX, y: e.clientY });
                          }}
                          title={shift
                            ? `${[w.nombre, w.apellidos].filter(Boolean).join(" ")} · día ${d} · ${SHIFT_META[shift].label}`
                            : sched
                              ? `${[w.nombre, w.apellidos].filter(Boolean).join(" ")} · día ${d} · ${SHIFT_META[sched].label} (planificado)`
                              : `Día ${d} · sin asignar — selecciona y escribe M/T/N/L/G/B/D`}
                          style={{
                            width: CELL_W, minWidth: CELL_W, height: 32,
                            textAlign: "center", fontSize: 11, fontWeight: 700,
                            cursor: "pointer",
                            background: meta
                              ? (isManual ? meta.bg : meta.bg + "55")
                              : (today ? "#0e2040" : weekend ? "#141c30" : "transparent"),
                            color: meta ? (isManual ? meta.text : meta.text + "88") : C.dim,
                            borderRight: !isManual && sched
                              ? `1px dashed ${SHIFT_META[sched].text}44`
                              : `1px solid ${C.border}`,
                            borderBottom: `1px solid ${C.border}`,
                            transition: "filter .1s",
                            userSelect: "none",
                            position: "relative",
                          }}
                        >
                          {display}
                          {selected && (
                            <div style={{
                              position: "absolute", inset: 0, pointerEvents: "none",
                              boxShadow: "inset 0 0 0 2px #4f8ef7",
                              background: "rgba(79,142,247,0.12)",
                            }} />
                          )}
                        </td>
                      );
                    })}

                    {/* Worker stats */}
                    <td style={{
                      position: "sticky", right: 0, zIndex: 2,
                      background: rowBg, borderLeft: `1px solid ${C.border2}`,
                      borderBottom: `1px solid ${C.border}`,
                      padding: "0 8px",
                    }}>
                      <div style={{ display: "flex", gap: 5, justifyContent: "center", flexWrap: "wrap" }}>
                        {SHIFTS.filter(s => stats[s]).map(s => (
                          <div key={s} style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10 }}>
                            <span style={{ color: SHIFT_META[s].text, fontWeight: 700 }}>{s}</span>
                            <span style={{ color: C.dim }}>{stats[s]}</span>
                          </div>
                        ))}
                        {Object.keys(stats).length === 0 && (
                          <span style={{ color: C.dim, fontSize: 10 }}>—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* Totals row */}
              <tr>
                <td style={{
                  position: "sticky", left: 0, zIndex: 2,
                  background: C.surface2, borderRight: `1px solid ${C.border2}`,
                  borderTop: `2px solid ${C.border2}`,
                  padding: "0 12px", height: 38,
                  fontSize: 10, color: C.muted, fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: 1,
                }}>
                  Totales día
                </td>
                {days.map(d => {
                  const totals = dayTotals(d);
                  const today  = isToday(d);
                  return (
                    <td key={d} style={{
                      width: CELL_W, textAlign: "center", height: 38,
                      background: today ? "#0e2248" : C.surface2,
                      borderRight: `1px solid ${C.border}`,
                      borderTop: `2px solid ${C.border2}`,
                      verticalAlign: "middle", padding: "2px 0",
                    }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                        {SHIFTS.filter(s => totals[s]).map(s => (
                          <div key={s} style={{ fontSize: 9, fontWeight: 700, color: SHIFT_META[s].text, lineHeight: 1.2 }}>
                            {s}{totals[s] > 1 ? <span style={{ fontSize: 8, fontWeight: 400 }}>×{totals[s]}</span> : ""}
                          </div>
                        ))}
                      </div>
                    </td>
                  );
                })}
                <td style={{
                  position: "sticky", right: 0, zIndex: 2,
                  background: C.surface2, borderLeft: `1px solid ${C.border2}`,
                  borderTop: `2px solid ${C.border2}`,
                }}/>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* ── FOOTER HINT ─────────────────────────────────────────── */}
      {(() => {
        const n = selectedCount();
        return (
          <div style={{
            flexShrink: 0, padding: "5px 16px",
            background: C.card, borderTop: `1px solid ${C.border}`,
            display: "flex", gap: 20, fontSize: 10, color: C.dim, alignItems: "center",
          }}>
            {n > 1 ? (
              <>
                <span style={{ color: C.blue, fontWeight: 600 }}>{n} celdas seleccionadas</span>
                <span>Escribe <b style={{color:C.muted}}>M T N L G B D</b> para asignar a todas · <b style={{color:C.muted}}>Supr</b> para borrar · <b style={{color:C.muted}}>Esc</b> para deseleccionar</span>
              </>
            ) : (
              <>
                <span>Clic o arrastra para seleccionar · <b style={{color:C.muted}}>Shift+clic</b> para extender</span>
                <span>Escribe <b style={{color:C.muted}}>M T N L G B D</b> · <b style={{color:C.muted}}>Supr</b> para borrar · Flechas para navegar</span>
                <span>Botones M/T/N en el nombre → rellenar mes completo</span>
                <span>Clic derecho → resumen del turno</span>
              </>
            )}
          </div>
        );
      })()}

      {/* ── RESUMEN DEL TURNO (clic derecho en una celda) ──────────── */}
      {summaryCell && (() => {
        const w = workers.find(w => w._id === summaryCell.workerId);
        if (!w) return null;
        const { day } = summaryCell;
        const shift  = grid[w._id]?.[String(day)] ?? "";
        const sched  = scheduledCode(w._id, day);
        const code   = shift || sched;
        const meta   = code ? SHIFT_META[code] : null;
        const dayNum = schedDayFor(day);
        const detail = dayNum ? schedRoster?.dailyDetail?.[w._id]?.[String(dayNum)] : null;
        const dow    = DAY_NAMES[getDow(day)];

        // Clamp near viewport edges so el popup no se salga de la pantalla
        const PW = 260, PH = 260;
        const left = Math.min(summaryCell.x, window.innerWidth  - PW - 12);
        const top  = Math.min(summaryCell.y, window.innerHeight - PH - 12);

        return (
          <>
            <div onClick={() => setSummaryCell(null)}
              style={{ position: "fixed", inset: 0, zIndex: 998 }} />
            <div style={{
              position: "fixed", left, top, zIndex: 999, width: PW,
              background: C.card, border: `1px solid ${C.border2}`, borderRadius: 10,
              boxShadow: "0 12px 36px rgba(0,0,0,.5)", padding: 14, fontFamily: font,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                  {[w.nombre, w.apellidos].filter(Boolean).join(" ") || "Trabajador"}
                </div>
                <button onClick={() => setSummaryCell(null)} style={{
                  background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14, lineHeight: 1,
                }}>×</button>
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>
                {dow} {day} de {MONTH_NAMES[month - 1]} {year}
              </div>

              {meta ? (
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 10,
                  background: meta.bg, border: `1px solid ${meta.text}44`, borderRadius: 6,
                  padding: "3px 9px",
                }}>
                  <span style={{ color: meta.text, fontWeight: 700, fontSize: 12 }}>{code}</span>
                  <span style={{ color: meta.text, fontSize: 11 }}>{meta.label}</span>
                  {!shift && sched && <span style={{ color: C.dim, fontSize: 10 }}>(planificado)</span>}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: C.dim, marginBottom: 10 }}>Sin turno asignado.</div>
              )}

              {detail ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: C.dim }}>Horario</span>
                    <span style={{ color: C.text, fontFamily: "'JetBrains Mono','Courier New',monospace" }}>
                      {fmtClock(detail.start)} – {fmtClock(detail.end)}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: C.dim }}>Paradas</span>
                    <span style={{ color: C.text }}>{detail.stops}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: C.dim }}>Km</span>
                    <span style={{ color: C.text }}>{detail.km}</span>
                  </div>
                  {detail.vehiculo && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: C.dim }}>Vehículo</span>
                      <span style={{ color: C.text }}>{detail.vehiculo}</span>
                    </div>
                  )}
                </div>
              ) : sched ? (
                <div style={{ fontSize: 10, color: C.dim }}>
                  Sin detalle de paradas/km guardado — regenera el escenario en Scheduling para verlo aquí.
                </div>
              ) : null}
            </div>
          </>
        );
      })()}
    </div>
  );
}

// ── STYLE CONSTANTS ────────────────────────────────────────────────
const navBtnStyle = {
  width: 28, height: 28, borderRadius: 6,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#94a3b8", fontSize: 18, lineHeight: 1,
  cursor: "pointer", fontFamily: font,
  display: "flex", alignItems: "center", justifyContent: "center",
};
const thStyle = {
  fontSize: 10, color: "#64748b", fontWeight: 500,
  letterSpacing: 1, textTransform: "uppercase",
  borderBottom: `1px solid rgba(255,255,255,0.13)`,
  whiteSpace: "nowrap",
};
