// Rostering → Vehículos: disponibilidad de la flota por día (taller, ITV…).
import { useState, useEffect, useRef } from "react";
import { db } from "../firebase.js";
import { logAuditGrouped, addCells } from "../audit.js";
import { saveVehicleCells, mergeCells } from "../roster-store.js";
import { onSnapshot, collection, query, where } from "firebase/firestore";
import { C, DAY_NAMES, MONTH_NAMES, VEHICLE_STATUSES, VEHICLE_STATUS_META, font, navBtnStyle, useVehicleAvailability, thStyle } from "./datos.js";
import { alfa } from "../tema.js";
import { tono } from "../tema.js";
import { Truck } from "lucide-react";

// Selector "Trabajadores / Vehículos" — compartido entre las dos vistas
// del módulo Rostering.
export function ModeTabs({ mode, setMode, conSalida = false }) {
  const pestanas = [["workers", "Trabajadores"], ["vehicles", "Vehículos"], ...(conSalida ? [["salida", "Salida del día"]] : [])];
  return (
    <div style={{ display: "flex", gap: 2, background: C.surface2, borderRadius: 8, padding: 2 }}>
      {pestanas.map(([m, label]) => (
        <button key={m} onClick={() => setMode(m)} style={{
          padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer",
          fontFamily: font, fontSize: 12, fontWeight: 600,
          background: mode === m ? alfa(0.1) : "transparent",
          color: mode === m ? C.text : C.muted,
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
export function VehicleAvailabilityGrid({ orgId, year, month, setYear, setMonth, mode, setMode, embedded, conSalida }) {
  const [vehicles, setVehicles] = useState([]);
  // En vivo: lo que cambian otros aparece aquí sin recargar, y lo que se
  // edita aquí se guarda casilla a casilla (saveVehicleCells) sin pisar lo
  // de los demás.
  const { grid: remoteGrid, loading: gridLoading, docId } = useVehicleAvailability(orgId, year, month, { live: true });

  const [grid,    setGrid]    = useState({});
  const gridRef  = useRef({});   // cuadrícula local al día (incluye lo no guardado)
  const savedRef = useRef({});   // lo último guardado/recibido de Firestore
  const docIdRef = useRef(docId);
  useEffect(() => {
    // Cambio de mes: se empieza de cero con lo de Firestore
    if (docIdRef.current !== docId) { docIdRef.current = docId; gridRef.current = {}; savedRef.current = {}; }
    const next = mergeCells(gridRef.current, savedRef.current, remoteGrid);
    savedRef.current = remoteGrid;
    gridRef.current = next;
    setGrid(next);
  }, [remoteGrid, docId]);

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

  function persist(newGrid, cells = []) {
    if (cells.length && docId) {
      logAuditGrouped(`veh-edit:${docId}`, { modulo: "Rostering", accion: "Editó la disponibilidad de vehículos", projectId: null },
        addCells(cells), acc => `${acc.cells.size} casilla(s) de ${acc.rows.size} vehículo(s) · ${MONTH_NAMES[month - 1]} ${year}`);
    }
    gridRef.current = newGrid;
    setGrid(newGrid);
    pendingRef.current = true;
    clearTimeout(debounceRef.current._batch);
    const target = docId;
    debounceRef.current._batch = setTimeout(() => {
      if (!target || !pendingRef.current || docIdRef.current !== target) return;
      pendingRef.current = null;
      const next = gridRef.current, prev = savedRef.current;
      // Lo guardado vuelve enseguida por la escucha en vivo (y pasa a savedRef)
      saveVehicleCells(target, orgId, year, month, prev, next)
        .catch(e => alert("No se pudo guardar la disponibilidad: " + (e.message || e)));
    }, 400);
  }

  function applyToSelection(code) {
    const r = getSelRange();
    if (!r) return;
    let newGrid = { ...gridRef.current };
    const touched = [];
    for (let vi = r.r0; vi <= r.r1; vi++) {
      const v = vehicles[vi];
      if (!v) continue;
      const vGrid = { ...(newGrid[v._id] ?? {}) };
      for (let di = r.c0; di <= r.c1; di++) {
        const d = days[di];
        if (d === undefined) continue;
        if (code) vGrid[String(d)] = code;
        else delete vGrid[String(d)];
        touched.push([v._id, d]);
      }
      newGrid[v._id] = vGrid;
    }
    persist(newGrid, touched);
  }

  function fillRow(vehicleId, code) {
    const vGrid = {};
    for (const d of days) vGrid[String(d)] = code;
    persist({ ...gridRef.current, [vehicleId]: vGrid }, days.map(d => [vehicleId, d]));
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
          <ModeTabs mode={mode} setMode={setMode} conSalida={conSalida} />
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
            <Truck size={32} color={C.dim} />
            <div>Sin vehículos. Añade vehículos en el módulo de Rutas.</div>
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
                      background: today ? C.blueDim : weekend ? tono("#151922", "#ebedf2") : C.card,
                      borderBottom: `2px solid ${today ? C.blue : C.border}`,
                      borderRight: `1px solid ${C.border}`,
                      padding: "3px 0", textAlign: "center",
                    }}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: today ? C.blue : weekend ? C.orange : C.dim }}>
                        {DAY_NAMES[dow]}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: today ? 700 : 500, color: today ? C.blue : weekend ? `${C.orange}88` : C.muted }}>
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
                const rowBg = vi % 2 === 0 ? C.bg : tono("#12161f", "#eaedf3");
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
                          data-cell={`${v._id}:${d}`}
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
                            background: meta ? meta.bg : (today ? tono("#0e2040", "#e4ecf8") : weekend ? tono("#141c30", "#e8ecf5") : "transparent"),
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
                              boxShadow: `inset 0 0 0 2px ${C.blue}`,
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
                  textTransform: "uppercase", letterSpacing: 0.5,
                }}>
                  Totales día
                </td>
                {days.map(d => {
                  const totals = dayTotals(d);
                  const today  = isToday(d);
                  return (
                    <td key={d} style={{
                      width: CELL_W, textAlign: "center", height: 38,
                      background: today ? C.blueDim : C.surface2,
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
