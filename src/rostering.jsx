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
export function RosteringPage({ sesion, embedded = false }) {
  const orgId = sesion?.org_id ?? null;

  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [workers, setWorkers] = useState([]);

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

  function clearCell(workerId, day, e) {
    e.preventDefault();
    const key   = String(day);
    const wGrid = { ...(grid[workerId] ?? {}) };
    delete wGrid[key];
    const newGrid = { ...grid, [workerId]: wGrid };
    setGrid(newGrid);
    pendingRef.current = newGrid;
    clearTimeout(debounceRef.current[workerId]);
    debounceRef.current[workerId] = setTimeout(() => {
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
                      const meta     = shift ? SHIFT_META[shift] : null;
                      const weekend  = isWeekend(d);
                      const today    = isToday(d);
                      const selected = isCellSelected(wi, dIdx);

                      return (
                        <td key={d}
                          onMouseDown={e => handleCellMouseDown(e, wi, dIdx)}
                          onMouseEnter={e => { handleCellMouseEnter(wi, dIdx); e.currentTarget.style.filter = "brightness(1.35)"; }}
                          onMouseLeave={e => { e.currentTarget.style.filter = "brightness(1)"; }}
                          onContextMenu={e => clearCell(w._id, d, e)}
                          title={shift
                            ? `${[w.nombre, w.apellidos].filter(Boolean).join(" ")} · día ${d} · ${SHIFT_META[shift].label}`
                            : `Día ${d} · sin asignar — selecciona y escribe M/T/N/L/G/B/D`}
                          style={{
                            width: CELL_W, minWidth: CELL_W, height: 32,
                            textAlign: "center", fontSize: 11, fontWeight: 700,
                            cursor: "pointer",
                            background: meta
                              ? meta.bg
                              : (today ? "#0e2040" : weekend ? "#141c30" : "transparent"),
                            color: meta ? meta.text : C.dim,
                            borderRight: `1px solid ${C.border}`,
                            borderBottom: `1px solid ${C.border}`,
                            transition: "filter .1s",
                            userSelect: "none",
                            position: "relative",
                          }}
                        >
                          {shift}
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
              </>
            )}
          </div>
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
