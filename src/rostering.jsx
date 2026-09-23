import { useState, useEffect, useRef } from "react";
import { db } from "./firebase.js";
import {
  optimizeRoster, checkWorkerMonth, describeReasons,
  DEFAULT_ROSTER_RULES, CODE_WINDOWS, ESTATUTO_RULES, ESTATUTO_ARTS,
} from "./roster-optimizer.js";
import { turnoWindow, shiftCodeFromStart } from "./vrp-engine.js";
import { loadScenario, publishWorker } from "./publicar-rutas.js";
import {
  doc, onSnapshot, setDoc, getDoc, updateDoc, serverTimestamp,
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
// Solo lectura, así que sigue en vivo todos los cambios de Firestore — la
// página de Rostering tiene su propio listener con edición local. Antes
// solo se aplicaba la primera lectura (patrón copiado de la página de
// Rostering), y como Scheduling y Rostering se quedan montados a la vez,
// Scheduling no veía una baja marcada después de abrirlo: ni avisaba del
// conflicto ni la tenía en cuenta al generar o publicar.
export function useRostering(orgId, year, month) {
  const [grid,    setGrid]    = useState({});
  // Trabajador → día → { v, vn, s, e }: qué vehículo y horario le asignó
  // Rostering → Optimizar (escenarios en modo libre). Publicar a Rutas lo
  // usa para saber quién conduce cada tramo.
  const [asignaciones, setAsignaciones] = useState({});
  const [loading, setLoading] = useState(true);

  const docId = (orgId && year && month)
    ? `${orgId}_${year}_${String(month).padStart(2, "0")}`
    : null;

  useEffect(() => {
    if (!docId) { setGrid({}); setAsignaciones({}); setLoading(false); return; }
    setGrid({});
    setAsignaciones({});
    setLoading(true);
    return onSnapshot(doc(db, "rostering", docId), snap => {
      setGrid(snap.exists() ? (snap.data().grid ?? {}) : {});
      setAsignaciones(snap.exists() ? (snap.data().asignaciones ?? {}) : {});
      setLoading(false);
    });
  }, [docId]);

  return { grid, asignaciones, loading, docId };
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
    return onSnapshot(doc(db, "rostering_vehicles", docId), snap => {
      if (live || !loadedRef.current) {
        setGrid(snap.exists() ? (snap.data().grid ?? {}) : {});
        loadedRef.current = true;
      }
      setLoading(false);
    });
  }, [docId, live]);

  return { grid, loading, docId };
}

// Helper exported for scheduling conflict check / publish-time filtering
export function vehicleCodeOnDay(grid, vehicleId, day) {
  return grid[vehicleId]?.[String(day)] ?? "";
}
export function isVehicleUnavailable(code) {
  return code === "T" || code === "A" || code === "I";
}

// Selector "Trabajadores / Vehículos" — compartido entre las dos vistas
// del módulo Rostering.
function ModeTabs({ mode, setMode }) {
  return (
    <div style={{ display: "flex", gap: 2, background: C.surface2, borderRadius: 8, padding: 2 }}>
      {[["workers", "Trabajadores"], ["vehicles", "Vehículos"]].map(([m, label]) => (
        <button key={m} onClick={() => setMode(m)} style={{
          padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer",
          fontFamily: font, fontSize: 12, fontWeight: 600,
          background: mode === m ? C.blue : "transparent",
          color: mode === m ? "#fff" : C.muted,
          transition: "all .12s",
        }}>{label}</button>
      ))}
    </div>
  );
}

// ── VEHICLE AVAILABILITY GRID ────────────────────────────────────
// Mismo cuadrante mensual que el de trabajadores (arrastrar para
// seleccionar, escribir el código, Supr para borrar) pero para vehículos:
// Disponible/Taller/Avería/ITV en vez de los turnos M/T/N/L/G/B/D. No
// tiene el solape de "turno planificado" de Scheduling ni el botón
// "Optimizar" — eso es específico del reparto de conductores.
function VehicleAvailabilityGrid({ orgId, year, month, setYear, setMonth, mode, setMode, embedded }) {
  const [vehicles, setVehicles] = useState([]);
  const { grid: loadedGrid, loading: gridLoading, docId } = useVehicleAvailability(orgId, year, month);

  const [grid,    setGrid]    = useState({});
  useEffect(() => { setGrid(loadedGrid); }, [loadedGrid]);

  const debounceRef = useRef({});
  const pendingRef   = useRef(null);
  const tableRef      = useRef(null);
  const isDragging    = useRef(false);

  const [selStart, setSelStart] = useState(null);
  const [selEnd,   setSelEnd]   = useState(null);

  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(
      query(collection(db, "scheduling_vehicles"), where("org_id", "==", orgId)),
      snap => setVehicles(
        snap.docs
          .map(d => ({ _id: d.id, ...d.data() }))
          .sort((a, b) => (a.nombre || a.matricula || "").localeCompare(b.nombre || b.matricula || ""))
      )
    );
  }, [orgId]);

  const daysInMonth = new Date(year, month, 0).getDate();
  const days        = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  function getDow(day)    { return new Date(year, month - 1, day).getDay(); }
  function isWeekend(day) { const d = getDow(day); return d === 0 || d === 6; }
  function isToday(day) {
    const t = new Date();
    return t.getFullYear() === year && t.getMonth() + 1 === month && t.getDate() === day;
  }
  function prevMonth() { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); }
  function nextMonth() { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); }

  useEffect(() => {
    const stop = () => { isDragging.current = false; };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  function getSelRange() {
    if (!selStart) return null;
    const end = selEnd ?? selStart;
    return {
      r0: Math.min(selStart.vIdx, end.vIdx), r1: Math.max(selStart.vIdx, end.vIdx),
      c0: Math.min(selStart.dIdx, end.dIdx), c1: Math.max(selStart.dIdx, end.dIdx),
    };
  }
  function isCellSelected(vIdx, dIdx) {
    const r = getSelRange();
    if (!r) return false;
    return vIdx >= r.r0 && vIdx <= r.r1 && dIdx >= r.c0 && dIdx <= r.c1;
  }
  function selectedCount() {
    const r = getSelRange();
    if (!r) return 0;
    return (r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1);
  }

  function persist(newGrid) {
    setGrid(newGrid);
    pendingRef.current = newGrid;
    clearTimeout(debounceRef.current._batch);
    debounceRef.current._batch = setTimeout(() => {
      if (!docId || !pendingRef.current) return;
      setDoc(doc(db, "rostering_vehicles", docId), {
        org_id: orgId, year, month, grid: pendingRef.current, updatedAt: serverTimestamp(),
      });
    }, 400);
  }

  function applyToSelection(code) {
    const r = getSelRange();
    if (!r) return;
    let newGrid = { ...grid };
    for (let vi = r.r0; vi <= r.r1; vi++) {
      const v = vehicles[vi];
      if (!v) continue;
      const vGrid = { ...(newGrid[v._id] ?? {}) };
      for (let di = r.c0; di <= r.c1; di++) {
        const d = days[di];
        if (d === undefined) continue;
        if (code) vGrid[String(d)] = code;
        else delete vGrid[String(d)];
      }
      newGrid[v._id] = vGrid;
    }
    persist(newGrid);
  }

  function fillRow(vehicleId, code) {
    const vGrid = {};
    for (const d of days) vGrid[String(d)] = code;
    persist({ ...grid, [vehicleId]: vGrid });
  }

  function handleKeyDown(e) {
    if (!selStart) return;
    const { vIdx, dIdx } = selStart;
    const key = e.key.toUpperCase();
    const multi = selEnd && (selEnd.vIdx !== selStart.vIdx || selEnd.dIdx !== selStart.dIdx);

    if (VEHICLE_STATUSES.includes(key)) {
      e.preventDefault();
      applyToSelection(key);
      if (!multi) {
        const next = Math.min(days.length - 1, dIdx + 1);
        setSelStart({ vIdx, dIdx: next });
        setSelEnd(null);
      }
      return;
    }
    if (key === "DELETE" || key === "BACKSPACE") { e.preventDefault(); applyToSelection(""); return; }
    if (key === "ARROWLEFT")  { e.preventDefault(); setSelStart({ vIdx, dIdx: Math.max(0, dIdx - 1) }); setSelEnd(null); return; }
    if (key === "ARROWRIGHT") { e.preventDefault(); setSelStart({ vIdx, dIdx: Math.min(days.length - 1, dIdx + 1) }); setSelEnd(null); return; }
    if (key === "ARROWUP")    { e.preventDefault(); setSelStart({ vIdx: Math.max(0, vIdx - 1), dIdx }); setSelEnd(null); return; }
    if (key === "ARROWDOWN")  { e.preventDefault(); setSelStart({ vIdx: Math.min(vehicles.length - 1, vIdx + 1), dIdx }); setSelEnd(null); return; }
    if (key === "ESCAPE")     { e.preventDefault(); setSelStart(null); setSelEnd(null); tableRef.current?.blur(); return; }
  }

  function handleCellMouseDown(e, vIdx, dIdx) {
    e.preventDefault();
    isDragging.current = true;
    if (e.shiftKey && selStart) setSelEnd({ vIdx, dIdx });
    else { setSelStart({ vIdx, dIdx }); setSelEnd(null); }
    tableRef.current?.focus();
  }
  function handleCellMouseEnter(vIdx, dIdx) {
    if (!isDragging.current) return;
    setSelEnd({ vIdx, dIdx });
  }

  function dayTotals(day) {
    const key = String(day);
    const counts = {};
    for (const v of vehicles) {
      const c = grid[v._id]?.[key];
      if (c) counts[c] = (counts[c] ?? 0) + 1;
    }
    return counts;
  }
  function vehicleStats(vehicleId) {
    const counts = {};
    for (const c of Object.values(grid[vehicleId] ?? {})) {
      if (c) counts[c] = (counts[c] ?? 0) + 1;
    }
    return counts;
  }

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
        flexShrink: 0, background: C.card, borderBottom: `1px solid ${C.border}`,
        padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ModeTabs mode={mode} setMode={setMode} />
          <button onClick={prevMonth} style={navBtnStyle}>‹</button>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, minWidth: 200, textAlign: "center" }}>
            {MONTH_NAMES[month - 1]} {year}
          </div>
          <button onClick={nextMonth} style={navBtnStyle}>›</button>
          <div style={{ fontSize: 11, color: C.dim, marginLeft: 8 }}>
            {vehicles.length} vehículos · {daysInMonth} días
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {VEHICLE_STATUSES.map(s => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{
                width: 22, height: 22, borderRadius: 4,
                background: VEHICLE_STATUS_META[s].bg,
                border: `1px solid ${VEHICLE_STATUS_META[s].text}55`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: VEHICLE_STATUS_META[s].text, fontWeight: 700, fontSize: 11,
              }}>{s}</div>
              <span style={{ fontSize: 11, color: C.muted }}>{VEHICLE_STATUS_META[s].label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── GRID ────────────────────────────────────────────────── */}
      <div ref={tableRef} tabIndex={0} onKeyDown={handleKeyDown}
        style={{ flex: 1, overflow: "auto", outline: "none" }}
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) { setSelStart(null); setSelEnd(null); } }}
      >
        {gridLoading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.dim, fontSize: 13 }}>
            Cargando…
          </div>
        ) : vehicles.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: C.dim, fontSize: 13, gap: 8 }}>
            <div style={{ fontSize: 32 }}>🚐</div>
            <div>Sin vehículos. Añade vehículos en el módulo de Scheduling.</div>
          </div>
        ) : (
          <table style={{ borderCollapse: "collapse", tableLayout: "fixed", minWidth: NAME_W + daysInMonth * CELL_W + STATS_W }}>
            <thead>
              <tr>
                <th style={{
                  ...thStyle, width: NAME_W, minWidth: NAME_W,
                  position: "sticky", left: 0, top: 0, zIndex: 5,
                  background: C.card, textAlign: "left",
                  padding: "6px 12px", borderRight: `1px solid ${C.border2}`,
                }}>
                  Vehículo
                </th>
                {days.map(d => {
                  const dow = getDow(d), weekend = isWeekend(d), today = isToday(d);
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
              {vehicles.map((v, vi) => {
                const stats = vehicleStats(v._id);
                const rowBg = vi % 2 === 0 ? C.bg : "#12161f";
                const vLabel = v.nombre || v.matricula || "Vehículo";

                return (
                  <tr key={v._id}>
                    <td style={{
                      position: "sticky", left: 0, zIndex: 2,
                      background: rowBg, height: 32,
                      borderRight: `1px solid ${C.border2}`,
                      borderBottom: `1px solid ${C.border}`,
                      padding: "0 10px",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{
                          fontSize: 12, color: C.text, fontWeight: 500,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          maxWidth: NAME_W - 40, cursor: "default",
                        }} title={vLabel}>
                          {vLabel}
                        </span>
                        <button onClick={() => fillRow(v._id, "D")}
                          title="Rellenar mes con Disponible"
                          style={{
                            marginLeft: "auto", width: 14, height: 14, borderRadius: 2, border: "none",
                            background: VEHICLE_STATUS_META.D.bg, color: VEHICLE_STATUS_META.D.text,
                            fontSize: 8, fontWeight: 700, cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            padding: 0, lineHeight: 1, flexShrink: 0,
                          }}
                        >D</button>
                      </div>
                    </td>

                    {days.map((d, dIdx) => {
                      const code    = grid[v._id]?.[String(d)] ?? "";
                      const meta    = code ? VEHICLE_STATUS_META[code] : null;
                      const weekend = isWeekend(d);
                      const today   = isToday(d);
                      const selected = isCellSelected(vi, dIdx);

                      return (
                        <td key={d}
                          onMouseDown={e => handleCellMouseDown(e, vi, dIdx)}
                          onMouseEnter={e => { handleCellMouseEnter(vi, dIdx); e.currentTarget.style.filter = "brightness(1.35)"; }}
                          onMouseLeave={e => { e.currentTarget.style.filter = "brightness(1)"; }}
                          title={code
                            ? `${vLabel} · día ${d} · ${VEHICLE_STATUS_META[code].label}`
                            : `${vLabel} · día ${d} · sin marcar — selecciona y escribe D/T/A/I`}
                          style={{
                            width: CELL_W, minWidth: CELL_W, height: 32,
                            textAlign: "center", fontSize: 11, fontWeight: 700,
                            cursor: "pointer",
                            background: meta ? meta.bg : (today ? "#0e2040" : weekend ? "#141c30" : "transparent"),
                            color: meta ? meta.text : C.dim,
                            borderRight: `1px solid ${C.border}`,
                            borderBottom: `1px solid ${C.border}`,
                            transition: "filter .1s", userSelect: "none", position: "relative",
                          }}
                        >
                          {code}
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

                    <td style={{
                      position: "sticky", right: 0, zIndex: 2,
                      background: rowBg, borderLeft: `1px solid ${C.border2}`,
                      borderBottom: `1px solid ${C.border}`,
                      padding: "0 8px",
                    }}>
                      <div style={{ display: "flex", gap: 5, justifyContent: "center", flexWrap: "wrap" }}>
                        {VEHICLE_STATUSES.filter(s => stats[s]).map(s => (
                          <div key={s} style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10 }}>
                            <span style={{ color: VEHICLE_STATUS_META[s].text, fontWeight: 700 }}>{s}</span>
                            <span style={{ color: C.dim }}>{stats[s]}</span>
                          </div>
                        ))}
                        {Object.keys(stats).length === 0 && <span style={{ color: C.dim, fontSize: 10 }}>—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}

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
                        {VEHICLE_STATUSES.filter(s => totals[s]).map(s => (
                          <div key={s} style={{ fontSize: 9, fontWeight: 700, color: VEHICLE_STATUS_META[s].text, lineHeight: 1.2 }}>
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
                <span>Escribe <b style={{color:C.muted}}>D T A I</b> para asignar a todas · <b style={{color:C.muted}}>Supr</b> para borrar · <b style={{color:C.muted}}>Esc</b> para deseleccionar</span>
              </>
            ) : (
              <>
                <span>Clic o arrastra para seleccionar · <b style={{color:C.muted}}>Shift+clic</b> para extender</span>
                <span>Escribe <b style={{color:C.muted}}>D T A I</b> · <b style={{color:C.muted}}>Supr</b> para borrar · Flechas para navegar</span>
                <span>Botón D en el nombre → todo el mes disponible</span>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── MAIN PAGE ──────────────────────────────────────────────────────
export function RosteringPage({ sesion, embedded = false, activeProject = null, orgId: orgIdProp = null }) {
  const orgId = orgIdProp ?? sesion?.org_id ?? null;

  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [mode,  setMode]  = useState("workers"); // "workers" | "vehicles"

  const [workers, setWorkers] = useState([]);
  // ── Publicar a Rutas por trabajador ─────────────────────────────
  // Usuarios de la app (para vincular cada trabajador con quien inicia
  // sesión en Rutas) y cuadrantes ya publicados este mes (estado de la
  // columna "Rutas").
  const [usuarios, setUsuarios] = useState([]);
  const [publicados, setPublicados] = useState({}); // uid → publicadoEn
  const [publishModal, setPublishModal] = useState(null); // { targets: [worker] }
  const [publishing, setPublishing] = useState(null); // texto de progreso
  const viewMes = `${year}-${String(month).padStart(2, "0")}`;

  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(query(collection(db, "usuarios"), where("org_id", "==", orgId)),
      snap => setUsuarios(snap.docs.map(d => ({ _id: d.id, ...d.data() })).filter(u => u.rol !== "superadmin")),
      () => {});
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(query(collection(db, "cuadrantes"), where("org_id", "==", orgId), where("mes", "==", viewMes)),
      snap => setPublicados(Object.fromEntries(snap.docs.map(d => [d.data().uid, d.data().publicadoEn]))),
      () => setPublicados({}));
  }, [orgId, viewMes]);

  const normName = s => (s || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  function suggestUser(w) {
    const full = normName([w.nombre, w.apellidos].filter(Boolean).join(" "));
    const linked = new Set(workers.map(x => x.uid).filter(Boolean));
    return usuarios.find(u => !linked.has(u._id) && normName([u.nombre, u.apellidos].filter(Boolean).join(" ")) === full) || null;
  }
  async function linkWorker(workerId, uid) {
    try { await updateDoc(doc(db, "scheduling_workers", workerId), { uid: uid || null }); }
    catch (e) { alert("No se pudo vincular: " + (e.message || e)); }
  }

  async function doPublish(targets, tipo) {
    setPublishModal(null);
    const projectId = activeProject?._id || null;
    const sameMonth = schedRoster?.mes === viewMes;
    const scenario = projectId && sameMonth ? await loadScenario(projectId) : null;
    const startMin = activeProject?.scheduling?.constraints?.startMin ?? 360;
    const lines = [];
    let i = 0;
    for (const w of targets) {
      setPublishing(`Publicando ${++i}/${targets.length}…`);
      try {
        const r = await publishWorker({
          orgId, projectId, worker: w, year, month, tipo, scenario, startMin,
          gridWorker: grid[w._id] || {}, asignWorker: asign[w._id] || {},
          dailyDetailWorker: schedRoster?.dailyDetail?.[w._id],
        });
        const name = [w.nombre, w.apellidos].filter(Boolean).join(" ");
        lines.push(`• ${name}: ${r.created} ruta(s)${r.kept.length ? ` · días ${r.kept.join(", ")} ya empezados, no se tocan` : ""}`);
      } catch (e) {
        lines.push(`• ${w.nombre}: error — ${e.message || e}`);
      }
    }
    setPublishing(null);
    alert(
      `Publicado en Rutas (${viewMes}):\n\n${lines.join("\n")}` +
      (scenario ? "" : `\n\nSolo se ha publicado el cuadrante: ${!projectId ? "no hay proyecto abierto" : !sameMonth ? "el escenario de Scheduling es de otro mes" : "el escenario no está guardado en este navegador — ábrelo en Scheduling primero"}.`)
    );
  }

  // Disponibilidad de vehículos del mes (para no mover turnos a días de taller)
  const { grid: vehicleGrid } = useVehicleAvailability(orgId, year, month, { live: true });

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
  // Asignaciones de Optimizar (modo libre): trabajador → día → { id, v, vn, s, e }
  // (turno cubierto, vehículo y horario). Una celda con asignación la puso
  // el optimizador; sin ella, la escribió alguien a mano.
  const [asign, setAsign] = useState({});
  const asignRef = useRef({});

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
    if (!docId) { setGrid({}); setAsign({}); asignRef.current = {}; setLoading(false); return; }
    loadedRef.current = false;
    setGrid({});
    setAsign({}); asignRef.current = {};
    setLoading(true);
    return onSnapshot(doc(db, "rostering", docId), snap => {
      if (!loadedRef.current) {
        setGrid(snap.exists() ? (snap.data().grid ?? {}) : {});
        const a = snap.exists() ? (snap.data().asignaciones ?? {}) : {};
        setAsign(a); asignRef.current = a;
        loadedRef.current = true;
      }
      setLoading(false);
    }, () => setLoading(false));
  }, [docId]);

  // ── Reglas del cuadrante (por organización) ───────────────────
  // Se guardan en la misma colección `rostering` (doc `${orgId}_reglas`, con
  // org_id) para no necesitar reglas de Firestore nuevas.
  const [rules, setRules] = useState(DEFAULT_ROSTER_RULES);
  const [horasPorTrabajador, setHorasPorTrabajador] = useState({});
  // Convenio colectivo del que salen las reglas: { nombre, codigo, vigencia,
  // url, arts: { regla: "art. 23" }, pdf: { name, size, chunks } }
  const [convenio, setConvenio] = useState({});
  const [showRules, setShowRules] = useState(false);
  const [optResult, setOptResult] = useState(null);
  const rulesDocId = orgId ? `${orgId}_reglas` : null;

  useEffect(() => {
    if (!rulesDocId) return;
    return onSnapshot(doc(db, "rostering", rulesDocId), snap => {
      const d = snap.exists() ? snap.data() : {};
      setRules({ ...DEFAULT_ROSTER_RULES, ...(d.rules || {}) });
      setHorasPorTrabajador(d.horasPorTrabajador || {});
      setConvenio(d.convenio || {});
    }, () => { /* aún sin reglas guardadas: valen las de por defecto */ });
  }, [rulesDocId]);

  function saveRules(newRules, newHoras, newConvenio = convenio) {
    setConvenio(newConvenio);
    setRules(newRules);
    setHorasPorTrabajador(newHoras);
    if (rulesDocId) setDoc(doc(db, "rostering", rulesDocId), {
      org_id: orgId, rules: newRules, horasPorTrabajador: newHoras, convenio: newConvenio, updatedAt: serverTimestamp(),
    });
  }

  // Escritura del documento del mes (cuadrante + asignaciones juntos, para
  // que ninguna escritura pise a la otra).
  function persistMonth(newGrid, newAsign = asignRef.current) {
    if (!docId) return;
    setDoc(doc(db, "rostering", docId), {
      org_id: orgId, year, month, grid: newGrid, asignaciones: newAsign, updatedAt: serverTimestamp(),
    });
  }

  // Una edición a mano de una celda anula la asignación del optimizador en
  // esa celda (el turno vuelve a quedar sin cubrir hasta re-optimizar).
  function dropAsign(cells) {
    let changed = false;
    const next = { ...asignRef.current };
    for (const [wId, d] of cells) {
      if (next[wId]?.[String(d)]) {
        next[wId] = { ...next[wId] };
        delete next[wId][String(d)];
        changed = true;
      }
    }
    if (changed) { asignRef.current = next; setAsign(next); }
  }

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
    const touched = [];
    for (let wi = r.r0; wi <= r.r1; wi++) {
      const w = workers[wi];
      if (!w) continue;
      const wGrid = { ...(newGrid[w._id] ?? {}) };
      for (let di = r.c0; di <= r.c1; di++) {
        const d = days[di];
        if (d === undefined) continue;
        if (shift) wGrid[String(d)] = shift;
        else delete wGrid[String(d)];
        touched.push([w._id, d]);
      }
      newGrid[w._id] = wGrid;
    }
    dropAsign(touched);
    setGrid(newGrid);
    pendingRef.current = newGrid;
    clearTimeout(debounceRef.current._batch);
    debounceRef.current._batch = setTimeout(() => {
      if (!docId || !pendingRef.current) return;
      persistMonth(pendingRef.current);
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
    dropAsign(days.map(d => [workerId, d]));
    setGrid(newGrid);
    pendingRef.current = newGrid;
    persistMonth(newGrid);
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

    if (schedRoster.modo === "libre") { optimizarLibre(); return; }

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
    persistMonth(newGrid);

    if (assignedCount === 0) {
      alert(skippedNoCode > 0
        ? "No se ha asignado ningún turno nuevo — las celdas ya estaban marcadas manualmente (M/T/N/G), libres o de baja."
        : "No se ha asignado ningún turno — regenera el escenario en Scheduling para este proyecto/mes.");
    } else {
      alert(`Se han asignado ${assignedCount} turno(s).${skippedNoCode > 0 ? ` ${skippedNoCode} trabajador(es) con paradas asignadas no tenían un turno reconocible.` : ""}`);
    }
  }

  // ── Optimizar (escenario en modo libre) ───────────────────────
  // Asigna trabajador + vehículo a cada turno a cubrir del escenario según
  // las reglas. Lo escrito a mano (L/B, M/T/N, G, D) se respeta; lo que puso
  // una optimización anterior se recalcula entero.
  function optimizarLibre() {
    const shiftsRaw = schedRoster.shifts || [];
    if (!shiftsRaw.length) {
      alert("El escenario no tiene turnos guardados — regenéralo en Scheduling (modo libre).");
      return;
    }
    if (Object.keys(asignRef.current).some(w => Object.keys(asignRef.current[w] || {}).length) &&
        !confirm("Se recalcularán los turnos que asignó la optimización anterior (lo escrito a mano se mantiene). ¿Continuar?")) return;

    // Celdas puestas por el optimizador → fuera; el resto son restricciones.
    const baseGrid = {};
    const fixed = {};
    for (const w of workers) {
      const wGrid = { ...(grid[w._id] ?? {}) };
      // Se restaura lo que había a mano antes (p. ej. G o D) en vez de
      // dejar la celda vacía.
      for (const [d, a] of Object.entries(asignRef.current[w._id] || {})) {
        if (a?.p) wGrid[d] = a.p; else delete wGrid[d];
      }
      baseGrid[w._id] = wGrid;
      fixed[w._id] = wGrid;
    }

    const shifts = shiftsRaw.map(sh => ({
      id: sh.id, day: sh.d, start: sh.s, end: sh.e,
      vehicleId: sh.v, vehicleName: sh.vn, stops: sh.st,
    }));
    const optWorkers = workers.map(w => ({
      id: w._id,
      name: [w.nombre, w.apellidos].filter(Boolean).join(" "),
      maxHoras: +horasPorTrabajador[w._id] || 0,
      prefStart: w.turno ? turnoWindow(w.turno, null, null).start : null,
    }));

    // Días en taller/avería/ITV de cada vehículo: no se mueve ningún turno a ellos
    const vehicleOff = {};
    for (const [vid, byDay] of Object.entries(vehicleGrid || {})) {
      vehicleOff[vid] = Object.entries(byDay || {}).filter(([, c]) => isVehicleUnavailable(c)).map(([d]) => Number(d));
    }

    const res = optimizeRoster({ shifts, workers: optWorkers, fixed, rules, year, month, daysInMonth, vehicleOff });

    const newGrid = { ...baseGrid };
    const newAsign = {};
    const byId = new Map(shifts.map(sh => [sh.id, sh]));
    const movedTo = new Map(res.moves.map(m => [m.id, m.toDay]));
    for (const [shiftId, wId] of Object.entries(res.assignments)) {
      const sh = byId.get(shiftId);
      const key = String(movedTo.get(shiftId) ?? sh.day);
      newGrid[wId] = { ...(newGrid[wId] ?? {}), [key]: shiftCodeFromStart(sh.start) };
      const prevCode = baseGrid[wId]?.[key];
      newAsign[wId] = { ...(newAsign[wId] ?? {}), [key]: {
        id: sh.id, v: sh.vehicleId, vn: sh.vehicleName, s: sh.start, e: sh.end,
        ...(prevCode ? { p: prevCode } : {}),
      } };
    }
    setGrid(newGrid);
    pendingRef.current = newGrid;
    asignRef.current = newAsign;
    setAsign(newAsign);
    persistMonth(newGrid, newAsign);

    // Turnos movidos de día: se reflejan en el escenario (scheduling_roster)
    // para que Scheduling traslade esas rutas — manda el cuadrante. Los
    // movimientos se acumulan en orden; Scheduling aplica cada uno una sola vez.
    if (res.moves.length && activeProject?._id) {
      const newShifts = shiftsRaw.map(sh => movedTo.has(sh.id) ? { ...sh, d: movedTo.get(sh.id) } : sh);
      const newMoves = res.moves.map(m => {
        const sh = byId.get(m.id);
        return { id: m.id, v: sh.vehicleId, s: sh.start, e: sh.end, fromDay: m.fromDay, toDay: m.toDay };
      });
      setDoc(doc(db, "scheduling_roster", activeProject._id), {
        shifts: newShifts,
        moves: [...(schedRoster.moves || []), ...newMoves],
      }, { merge: true }).catch(e => alert("No se pudieron guardar los turnos movidos en el escenario: " + (e.message || e)));
    }

    setOptResult({
      moves: res.moves.map(m => ({ ...m, shift: byId.get(m.id) })),
      total: shifts.length - res.outOfMonth,
      covered: Object.keys(res.assignments).length,
      uncovered: res.uncovered,
      outOfMonth: res.outOfMonth,
      stats: res.stats,
    });
  }

  // Horario trabajado por un trabajador un día (para horas y reglas):
  // asignación del optimizador > detalle del escenario (modo cuadrante) >
  // franja nominal del código M/T/N. null si ese día no trabaja.
  function workedInterval(workerId, d) {
    const a = asign[workerId]?.[String(d)];
    if (a) return { start: a.s, end: a.e };
    const code = grid[workerId]?.[String(d)] || scheduledCode(workerId, d);
    if (!CODE_WINDOWS[code]) return null;
    const dayNum = schedDayFor(d);
    const det = dayNum ? schedRoster?.dailyDetail?.[workerId]?.[String(dayNum)] : null;
    if (det) {
      const off = (dayNum - 1) * 1440;
      return { start: det.start - off, end: det.end - off };
    }
    return CODE_WINDOWS[code];
  }

  // Cobertura de los turnos del escenario libre en el mes que se ve
  const libreShifts = schedRoster?.modo === "libre" &&
    schedRoster.mes === `${year}-${String(month).padStart(2, "0")}` ? (schedRoster.shifts || []) : null;
  const coveredIds = new Set(Object.values(asign).flatMap(w => Object.values(w || {}).map(a => a?.id)));
  const coveredCount = libreShifts ? libreShifts.filter(sh => coveredIds.has(sh.id)).length : 0;

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
  const STATS_W = 170;
  const PUB_W   = 150;

  if (mode === "vehicles") {
    return (
      <VehicleAvailabilityGrid
        orgId={orgId} year={year} month={month}
        setYear={setYear} setMonth={setMonth}
        mode={mode} setMode={setMode} embedded={embedded}
      />
    );
  }

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
          <ModeTabs mode={mode} setMode={setMode} />
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

          <button onClick={() => setShowRules(true)}
            title="Reglas del cuadrante: días seguidos, horas/mes, descanso, reparto"
            style={{
              padding: "4px 12px", borderRadius: 6, background: "none",
              border: `1px solid ${C.border2}`, color: C.muted, fontSize: 12, fontWeight: 600,
              cursor: "pointer", fontFamily: font,
            }}>
            Reglas
          </button>

          {libreShifts && (
            <span title="Turnos del escenario (modo libre) con trabajador asignado"
              style={{
                fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "3px 8px",
                color: coveredCount === libreShifts.length ? "#34d399" : "#fbbf24",
                background: coveredCount === libreShifts.length ? "#34d39918" : "#fbbf2418",
              }}>
              {coveredCount}/{libreShifts.length} turnos cubiertos
            </span>
          )}

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
                title={schedRoster.modo === "libre"
                  ? "Asigna trabajador y vehículo a cada turno del escenario respetando las Reglas"
                  : "Asigna los turnos del escenario de scheduling a los trabajadores disponibles"}
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
          <table style={{ borderCollapse: "collapse", tableLayout: "fixed", minWidth: NAME_W + daysInMonth * CELL_W + STATS_W + PUB_W }}>
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
                  position: "sticky", right: PUB_W, top: 0, zIndex: 5,
                  background: C.card, textAlign: "center",
                  borderLeft: `1px solid ${C.border2}`,
                }}>
                  Resumen mes
                </th>

                {/* Publicar a Rutas */}
                <th style={{
                  ...thStyle, width: PUB_W, minWidth: PUB_W,
                  position: "sticky", right: 0, top: 0, zIndex: 5,
                  background: C.card, textAlign: "center",
                  borderLeft: `1px solid ${C.border}`,
                }}>
                  <div>Rutas</div>
                  <button disabled={!!publishing || !workers.some(w => w.uid)}
                    onClick={() => setPublishModal({ targets: workers.filter(w => w.uid) })}
                    title="Publica en Rutas las rutas y el cuadrante de todos los trabajadores vinculados a un usuario"
                    style={{ ...pubBtn, marginTop: 3, opacity: workers.some(w => w.uid) ? 1 : 0.4 }}>
                    {publishing || "Publicar todos"}
                  </button>
                </th>
              </tr>
            </thead>

            <tbody>
              {workers.map((w, wi) => {
                const stats = workerStats(w._id);
                const check = checkWorkerMonth(d => workedInterval(w._id, d), daysInMonth, rules, +horasPorTrabajador[w._id] || 0, { year, month });
                const ruleIssues = check.issues;
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
                            ? `${[w.nombre, w.apellidos].filter(Boolean).join(" ")} · día ${d} · ${SHIFT_META[shift].label}` +
                              (asign[w._id]?.[String(d)]
                                ? ` · ${asign[w._id][String(d)].vn} ${fmtClock(asign[w._id][String(d)].s)}–${fmtClock(asign[w._id][String(d)].e)} (optimizado)`
                                : "")
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
                          {asign[w._id]?.[String(d)] && (
                            <div title="Asignado por Optimizar" style={{
                              position: "absolute", top: 3, right: 3, width: 4, height: 4,
                              borderRadius: 2, background: C.blue, pointerEvents: "none",
                            }} />
                          )}
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
                      position: "sticky", right: PUB_W, zIndex: 2,
                      background: rowBg, borderLeft: `1px solid ${C.border2}`,
                      borderBottom: `1px solid ${C.border}`,
                      padding: "0 8px",
                    }}>
                      <div style={{ display: "flex", gap: 5, justifyContent: "center", flexWrap: "wrap", alignItems: "center" }}>
                        {check.hours > 0 && (
                          <span title={ruleIssues.length ? ruleIssues.join(" · ") : `${check.hours}h de ${check.cap}h · máx. ${check.maxRun} días seguidos`}
                            style={{
                              fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "0 4px",
                              color: ruleIssues.length ? "#f87171" : C.muted,
                              background: ruleIssues.length ? "#f8717122" : "transparent",
                            }}>
                            {ruleIssues.length ? "⚠ " : ""}{Math.round(check.hours)}h
                          </span>
                        )}
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

                    {/* Publicar a Rutas: vincular con su usuario de la app + publicar */}
                    <td style={{
                      position: "sticky", right: 0, zIndex: 2,
                      background: rowBg, borderLeft: `1px solid ${C.border}`,
                      borderBottom: `1px solid ${C.border}`,
                      padding: "0 6px", textAlign: "center",
                    }}>
                      {w.uid ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
                          <button disabled={!!publishing} onClick={() => setPublishModal({ targets: [w] })}
                            title={`Publicar en Rutas a ${usuarios.find(u => u._id === w.uid)?.email || "su usuario"}`}
                            style={pubBtn}>
                            Publicar
                          </button>
                          {publicados[w.uid] && (
                            <span title={`Publicado ${new Date(publicados[w.uid]).toLocaleString()}`}
                              style={{ fontSize: 10, color: "#34d399" }}>✓</span>
                          )}
                          <button onClick={() => { if (confirm("¿Desvincular este trabajador de su usuario de la app?")) linkWorker(w._id, null); }}
                            title="Desvincular usuario" style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 11, padding: 0 }}>×</button>
                        </div>
                      ) : (
                        <select value="" onChange={e => e.target.value && linkWorker(w._id, e.target.value)}
                          title="Vincula el trabajador con su usuario de la app para poder publicarle sus rutas"
                          style={{ width: "100%", background: C.surface2, border: `1px dashed ${C.border2}`, color: C.muted, borderRadius: 5, fontSize: 10.5, padding: "3px 4px", fontFamily: font, cursor: "pointer" }}>
                          <option value="">Vincular usuario…</option>
                          {(() => {
                            const sug = suggestUser(w);
                            const linked = new Set(workers.map(x => x.uid).filter(Boolean));
                            return [
                              ...(sug ? [<option key={"s" + sug._id} value={sug._id}>★ {[sug.nombre, sug.apellidos].filter(Boolean).join(" ")}</option>] : []),
                              ...usuarios.filter(u => !linked.has(u._id) && u._id !== sug?._id).map(u => (
                                <option key={u._id} value={u._id}>{[u.nombre, u.apellidos].filter(Boolean).join(" ") || u.email}</option>
                              )),
                            ];
                          })()}
                        </select>
                      )}
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
                  position: "sticky", right: PUB_W, zIndex: 2,
                  background: C.surface2, borderLeft: `1px solid ${C.border2}`,
                  borderTop: `2px solid ${C.border2}`,
                }}/>
                <td style={{
                  position: "sticky", right: 0, zIndex: 2,
                  background: C.surface2, borderLeft: `1px solid ${C.border}`,
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

              {asign[w._id]?.[String(day)] ? (() => {
                const a = asign[w._id][String(day)];
                const sh = (schedRoster?.shifts || []).find(x => x.id === a.id);
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: C.dim }}>Vehículo</span>
                      <span style={{ color: C.text }}>{a.vn}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: C.dim }}>Horario</span>
                      <span style={{ color: C.text, fontFamily: "'JetBrains Mono','Courier New',monospace" }}>
                        {fmtClock(a.s)} – {fmtClock(a.e)}
                      </span>
                    </div>
                    {sh && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: C.dim }}>Paradas · km</span>
                        <span style={{ color: C.text }}>{sh.st} · {sh.km}</span>
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: C.dim }}>Asignado por Optimizar — editar la celda lo anula.</div>
                  </div>
                );
              })() : detail ? (
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

      {showRules && (
        <RulesModal
          rules={rules} horas={horasPorTrabajador} convenio={convenio} workers={workers} orgId={orgId}
          onClose={() => setShowRules(false)}
          onSave={(r, h, c) => { saveRules(r, h, c); setShowRules(false); }}
        />
      )}
      {publishModal && (
        <PublishModal targets={publishModal.targets} mes={viewMes}
          onClose={() => setPublishModal(null)}
          onConfirm={tipo => doPublish(publishModal.targets, tipo)} />
      )}
      {optResult && (
        <OptResultModal result={optResult} workers={workers} rules={rules} onClose={() => setOptResult(null)} />
      )}
    </div>
  );
}

// ── MODAL: reglas del cuadrante + convenio colectivo ───────────────
// Formulario guiado: el convenio (PDF) se abre al lado para ir leyéndolo, y
// cada regla lleva el artículo del que sale y qué buscar en el texto. El
// PDF se guarda troceado en Firestore (colección `rostering`, docs
// `${orgId}_convenio_pdf_${uploadId}_${i}`) para que lo vea todo el equipo sin
// depender de Firebase Storage. Cada subida usa su propio uploadId: si se
// cancela el modal, el PDF anterior sigue intacto.
const RULE_FIELDS = [
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
const PDF_CHUNK = 700_000;          // caracteres base64 por documento (< 1MB)
const PDF_MAX_BYTES = 10 * 1024 * 1024;

// "12/10/2026, 2026-12-25" → ["2026-10-12", "2026-12-25"]
function parseFestivos(text) {
  const out = [];
  for (const raw of text.split(/[\s,;]+/).filter(Boolean)) {
    let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) { out.push(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`); continue; }
    m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) out.push(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  }
  return [...new Set(out)].sort();
}

function RulesModal({ rules, horas, convenio, workers, orgId, onClose, onSave }) {
  const [r, setR] = useState({ ...DEFAULT_ROSTER_RULES, ...rules });
  const [h, setH] = useState(horas);
  const [cv, setCv] = useState({ arts: {}, ...convenio });
  const [festText, setFestText] = useState((rules.festivos || []).join(", "));
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(null); // texto de progreso
  const fileRef = useRef(null);

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  async function uploadPdf(file) {
    if (!file) return;
    if (file.type !== "application/pdf") { alert("Sube el convenio en PDF."); return; }
    if (file.size > PDF_MAX_BYTES) { alert("El PDF pasa de 10 MB — sube una versión más ligera."); return; }
    setPdfBusy("Subiendo convenio…");
    try {
      const b64 = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(",")[1]);
        fr.onerror = rej;
        fr.readAsDataURL(file);
      });
      const n = Math.ceil(b64.length / PDF_CHUNK);
      const uploadId = Date.now().toString(36);
      for (let i = 0; i < n; i++) {
        setPdfBusy(`Subiendo convenio… ${i + 1}/${n}`);
        await setDoc(doc(db, "rostering", `${orgId}_convenio_pdf_${uploadId}_${i}`), {
          org_id: orgId, i, data: b64.slice(i * PDF_CHUNK, (i + 1) * PDF_CHUNK),
        });
      }
      setCv(c => ({ ...c, pdf: { name: file.name, size: file.size, chunks: n, uploadId, uploadedAt: new Date().toISOString() } }));
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(URL.createObjectURL(file)); // se abre ya, sin volver a descargarlo
    } catch (e) {
      alert("No se pudo subir el convenio: " + (e.message || e));
    } finally {
      setPdfBusy(null);
    }
  }

  async function openPdf() {
    if (pdfUrl || !cv.pdf?.chunks) return;
    setPdfBusy("Abriendo convenio…");
    try {
      let b64 = "";
      for (let i = 0; i < cv.pdf.chunks; i++) {
        const snap = await getDoc(doc(db, "rostering", `${orgId}_convenio_pdf_${cv.pdf.uploadId}_${i}`));
        b64 += snap.data()?.data || "";
      }
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      setPdfUrl(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })));
    } catch (e) {
      alert("No se pudo abrir el convenio: " + (e.message || e));
    } finally {
      setPdfBusy(null);
    }
  }

  function fillEstatuto() {
    const next = { ...r };
    const arts = { ...(cv.arts || {}) };
    for (const [k, v] of Object.entries(ESTATUTO_RULES)) {
      next[k] = v;
      if (!arts[k]) arts[k] = ESTATUTO_ARTS[k];
    }
    setR(next);
    setCv({ ...cv, arts });
  }

  function save() {
    onSave({ ...r, festivos: parseFestivos(festText) }, h, cv);
  }

  const setArt = (key, val) => setCv({ ...cv, arts: { ...(cv.arts || {}), [key]: val } });
  const meta = (key, placeholder, width = "100%") => (
    <input value={cv[key] || ""} placeholder={placeholder}
      onChange={e => setCv({ ...cv, [key]: e.target.value })}
      style={{ ...inputStyle, width }} />
  );
  const sectionTitle = t => (
    <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase", fontWeight: 600, margin: "14px 0 6px" }}>{t}</div>
  );

  return (
    <ModalShell title="Reglas del cuadrante" onClose={onClose} width={pdfUrl ? 1280 : 640}>
      <div style={{ display: "flex", gap: 16, alignItems: "stretch", flexWrap: "wrap" }}>
        {pdfUrl && (
          <div style={{ flex: "1 1 520px", minHeight: 520, display: "flex", flexDirection: "column" }}>
            <iframe title="Convenio" src={pdfUrl}
              style={{ flex: 1, width: "100%", minHeight: 520, border: `1px solid ${C.border}`, borderRadius: 6, background: "#fff" }} />
            <div style={{ fontSize: 10.5, color: C.dim, marginTop: 4 }}>
              Ctrl+F dentro del documento para buscar lo que indica cada regla.
            </div>
          </div>
        )}

        <div style={{ flex: "1 1 520px", minWidth: 0 }}>
          {/* ── Convenio ── */}
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>
            Sube el convenio colectivo y rellena cada regla con lo que dice, anotando el artículo.
            Se aplican al pulsar <b style={{ color: C.muted }}>Optimizar</b> y se comprueban siempre en la columna de resumen.
            0 = no se aplica.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }}
              onChange={e => { uploadPdf(e.target.files?.[0]); e.target.value = ""; }} />
            <button onClick={() => fileRef.current?.click()} disabled={!!pdfBusy} style={secondaryBtn}>
              {cv.pdf ? "Cambiar PDF del convenio" : "Subir PDF del convenio"}
            </button>
            {cv.pdf && !pdfUrl && (
              <button onClick={openPdf} disabled={!!pdfBusy} style={secondaryBtn}>Abrir al lado</button>
            )}
            {pdfUrl && <button onClick={() => { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }} style={secondaryBtn}>Cerrar PDF</button>}
            <button onClick={fillEstatuto} style={secondaryBtn}
              title="Jornada diaria 9h, descanso entre jornadas 12h, descanso semanal 36h, jornada anual 1.826h">
              Rellenar mínimos del Estatuto
            </button>
            {pdfBusy && <span style={{ fontSize: 11, color: C.blue }}>{pdfBusy}</span>}
            {cv.pdf && !pdfBusy && (
              <span style={{ fontSize: 11, color: C.dim }}>{cv.pdf.name} · {(cv.pdf.size / 1024 / 1024).toFixed(1)} MB</span>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {meta("nombre", "Nombre del convenio")}
            {meta("codigo", "Código de convenio (REGCON)")}
            {meta("vigencia", "Vigencia (p. ej. 2025–2027)")}
            {meta("url", "Enlace BOE / BOP")}
          </div>

          {/* ── Reglas ── */}
          {sectionTitle("Reglas")}
          {RULE_FIELDS.map(f => (
            <div key={f.key} style={{ display: "grid", gridTemplateColumns: "190px 110px 1fr", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 12, color: C.muted }}>{f.label}</div>
                <div style={{ fontSize: 10, color: C.dim }}>Busca: {f.busca}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input type="number" min={0} value={r[f.key] ?? 0}
                  onChange={e => setR({ ...r, [f.key]: Math.max(0, parseFloat(e.target.value) || 0) })}
                  style={{ ...inputStyle, width: 64 }} />
                <span style={{ fontSize: 10.5, color: C.dim }}>{f.suffix}</span>
              </div>
              <input value={cv.arts?.[f.key] || ""} placeholder="Artículo (p. ej. art. 23.2)"
                onChange={e => setArt(f.key, e.target.value)}
                style={{ ...inputStyle, width: "100%" }} />
            </div>
          ))}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted, margin: "8px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={!!r.equilibrar} onChange={e => setR({ ...r, equilibrar: e.target.checked })}
              style={{ accentColor: C.blue }} />
            Repartir horas y fines de semana de forma equitativa (preferencia, no obligatoria)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted, margin: "8px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={r.moverTurnos !== false} onChange={e => setR({ ...r, moverTurnos: e.target.checked })}
              style={{ accentColor: C.blue }} />
            Si un turno no se puede cubrir en su día, moverlo al día más cercano en que se pueda (Scheduling adapta la ruta)
          </label>

          {sectionTitle("Festivos (para el máximo de domingos/festivos)")}
          <textarea value={festText} onChange={e => setFestText(e.target.value)} rows={2}
            placeholder="12/10/2026, 01/11/2026, 2026-12-08…"
            style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: font }} />
          <div style={{ fontSize: 10.5, color: C.dim }}>
            {parseFestivos(festText).length} fecha(s) reconocida(s) — nacionales, autonómicos y locales del año.
          </div>

          {sectionTitle(`Horas/mes por trabajador (vacío = las de arriba${r.jornadaAnualH ? " y la jornada anual" : ""})`)}
          <div style={{ maxHeight: 180, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px" }}>
            {workers.length === 0 && <div style={{ fontSize: 11, color: C.dim, padding: 6 }}>Sin trabajadores.</div>}
            {workers.map(w => (
              <div key={w._id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0" }}>
                <span style={{ fontSize: 12, color: C.text }}>{[w.nombre, w.apellidos].filter(Boolean).join(" ")}</span>
                <input type="number" min={0} placeholder={String(r.maxHorasMes || "")} value={h[w._id] ?? ""}
                  onChange={e => {
                    const v = parseInt(e.target.value);
                    const next = { ...h };
                    if (v > 0) next[w._id] = v; else delete next[w._id];
                    setH(next);
                  }}
                  style={{ ...inputStyle, width: 64 }} />
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button onClick={onClose} style={secondaryBtn}>Cancelar</button>
            <button onClick={save} disabled={!!pdfBusy} style={primaryBtn}>Guardar</button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

// ── MODAL: publicar a Rutas ────────────────────────────────────────
const TIPOS_RUTA = [
  { key: "prev", label: "Mantenimiento Preventivo" },
  { key: "ext",  label: "Limpieza Exterior" },
  { key: "int",  label: "Limpieza Interior" },
];
function PublishModal({ targets, mes, onClose, onConfirm }) {
  const [tipo, setTipo] = useState(() => {
    try { return localStorage.getItem("rostering_pub_tipo") || "prev"; } catch { return "prev"; }
  });
  const names = targets.map(w => [w.nombre, w.apellidos].filter(Boolean).join(" "));
  return (
    <ModalShell title="Publicar en Rutas" onClose={onClose} width={440}>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
        {targets.length === 1 ? names[0] : `${targets.length} trabajadores`} · {mes}
      </div>
      <div style={{ fontSize: 11, color: C.dim, marginBottom: 12 }}>
        Cada uno verá en Rutas solo sus rutas (una por día trabajado, con su vehículo) y su cuadrante del mes.
        Se sustituye lo publicado antes de este proyecto y mes, salvo los días en que ya haya marcado paradas.
      </div>
      <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 4 }}>Tipo de trabajo</label>
      <select value={tipo} onChange={e => setTipo(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 16 }}>
        {TIPOS_RUTA.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onClose} style={secondaryBtn}>Cancelar</button>
        <button onClick={() => { try { localStorage.setItem("rostering_pub_tipo", tipo); } catch { /* sin almacenamiento */ } onConfirm(tipo); }}
          style={primaryBtn}>Publicar</button>
      </div>
    </ModalShell>
  );
}

// ── MODAL: resultado de Optimizar ──────────────────────────────────
function OptResultModal({ result, workers, rules, onClose }) {
  const nameOf = id => {
    const w = workers.find(x => x._id === id);
    return w ? [w.nombre, w.apellidos].filter(Boolean).join(" ") : id;
  };
  const rows = Object.entries(result.stats)
    .map(([id, s]) => ({ id, ...s }))
    .filter(s => s.days > 0)
    .sort((a, b) => b.hours - a.hours);
  const allCovered = result.covered === result.total;
  return (
    <ModalShell title="Resultado de la optimización" onClose={onClose} width={560}>
      <div style={{
        fontSize: 13, fontWeight: 600, marginBottom: 12,
        color: allCovered ? "#34d399" : "#fbbf24",
      }}>
        {result.covered} de {result.total} turnos cubiertos
        {result.outOfMonth > 0 && <span style={{ color: C.dim, fontWeight: 400, fontSize: 11 }}> · {result.outOfMonth} fuera de este mes (no se optimizan)</span>}
      </div>

      {result.moves?.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>
            Movidos de día para cumplir las reglas ({result.moves.length})
          </div>
          <div style={{ maxHeight: 140, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px", marginBottom: 8 }}>
            {result.moves.map(m => (
              <div key={m.id} style={{ fontSize: 11, padding: "3px 0", color: C.muted }}>
                <span style={{ color: C.text, fontWeight: 600 }}>Día {m.fromDay} → {m.toDay}</span>
                {" · "}{m.shift?.vehicleName} · {fmtClock(m.shift?.start)}–{fmtClock(m.shift?.end)}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 14 }}>
            Scheduling mueve esas rutas al nuevo día (mismo vehículo y horario). Revísalas en el Gantt antes de publicar.
          </div>
        </>
      )}

      {result.uncovered.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>
            Sin cubrir
          </div>
          <div style={{ maxHeight: 180, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px", marginBottom: 14 }}>
            {result.uncovered.map(({ shift, reasons }) => (
              <div key={shift.id} style={{ fontSize: 11, padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
                <span style={{ color: C.text, fontWeight: 600 }}>Día {shift.day}</span>
                <span style={{ color: C.muted }}> · {shift.vehicleName} · {fmtClock(shift.start)}–{fmtClock(shift.end)}</span>
                <div style={{ color: C.dim, fontSize: 10.5 }}>Nadie puede: {describeReasons(reasons)}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 14 }}>
            Para cubrirlos: más plantilla, relajar alguna regla, o revisar L/B/turnos fijados a mano esos días.
          </div>
        </>
      )}

      <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>
        Carga por trabajador
      </div>
      <div style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ color: C.dim, textAlign: "left" }}>
              <th style={{ padding: "4px 8px", fontWeight: 500 }}>Trabajador</th>
              <th style={{ padding: "4px 8px", fontWeight: 500, textAlign: "right" }}>Horas</th>
              <th style={{ padding: "4px 8px", fontWeight: 500, textAlign: "right" }}>Días</th>
              <th style={{ padding: "4px 8px", fontWeight: 500, textAlign: "right" }}>Racha máx.</th>
              <th style={{ padding: "4px 8px", fontWeight: 500, textAlign: "right" }}>Findes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(s => (
              <tr key={s.id} style={{ borderTop: `1px solid ${C.border}`, color: C.text }}>
                <td style={{ padding: "3px 8px" }}>{nameOf(s.id)}</td>
                <td style={{ padding: "3px 8px", textAlign: "right" }}>{s.hours} / {s.maxHoras || "—"}</td>
                <td style={{ padding: "3px 8px", textAlign: "right" }}>{s.days}</td>
                <td style={{ padding: "3px 8px", textAlign: "right", color: rules.maxDiasSeguidos && s.maxRun > rules.maxDiasSeguidos ? "#f87171" : C.text }}>{s.maxRun}</td>
                <td style={{ padding: "3px 8px", textAlign: "right" }}>{s.weekends}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10.5, color: C.dim, marginTop: 10 }}>
        Los días seguidos no tienen en cuenta el final del mes anterior.
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <button onClick={onClose} style={primaryBtn}>Cerrar</button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, width, children }) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.55)" }} />
      <div style={{
        position: "fixed", zIndex: 1001, top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        width: `min(${width}px, calc(100vw - 32px))`, maxHeight: "calc(100vh - 48px)", overflowY: "auto",
        background: C.card, border: `1px solid ${C.border2}`, borderRadius: 12,
        boxShadow: "0 16px 48px rgba(0,0,0,.5)", padding: 18, fontFamily: font,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </>
  );
}

const inputStyle = {
  width: 72, background: C.surface2, border: `1px solid ${C.border}`, color: C.text,
  borderRadius: 6, padding: "5px 8px", fontSize: 12, outline: "none", fontFamily: font,
};
const primaryBtn = {
  padding: "6px 14px", borderRadius: 6, background: C.blue, border: "none",
  color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font,
};
const pubBtn = {
  padding: "3px 10px", borderRadius: 5, background: "#5c9bff22", border: "1px solid #5c9bff55",
  color: "#5c9bff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font,
};
const secondaryBtn = {
  padding: "6px 14px", borderRadius: 6, background: "none", border: `1px solid ${C.border2}`,
  color: C.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font,
};

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
