// Diagrama de Gantt del escenario y barra de KPIs.
// (Separado de scheduling.jsx sin cambiar su comportamiento.)
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { dayIssues, dayMetrics } from "../scenario-metrics.js";
import { applyTaskMove, computeCandidateSlots, minToTime, turnoWindow } from "../vrp-engine.js";
import { C, barrioColor, fmtDurHM, font, mono } from "./estilo.js";
import { BarraGantt, TooltipGantt, PanelDetalleGantt, PieGantt } from "./gantt-paneles.jsx";
import {
  COL_COLOR, HEADER_H, LABEL_W_DEFAULT, LABEL_W_MAX, LABEL_W_MIN, ROW_H,
  TABLE_COLS, TABLE_W, ZOOM_STEPS, rowName, turnoCorto,
} from "./gantt-comun.js";
import { ClockBadge } from "./kpi-bar.jsx";

export function GanttChart({ rows, startMin, endMin, days = 1, mode, allWorkers = [], allVehicles = [], onScheduleChange, unassigned = [], onPlaceUnassigned, maxShiftMin = 0, reglas = null }) {
  // Vista "Tabla" (columnas de datos) o "Compacta" (solo nombre y resumen)
  const [vista, setVista] = useState(() => { try { return localStorage.getItem("fc_gantt_vista") || "tabla"; } catch { return "tabla"; } });
  const cambiarVista = v => { setVista(v); try { localStorage.setItem("fc_gantt_vista", v); } catch { /* sin almacenamiento local */ } };
  const [colSort, setColSort] = useState(null); // { key, dir: 1 | -1 }
  const [tooltip,      setTooltip]      = useState(null);
  const [pxPerMin,     setPxPerMin]     = useState(1); // x1 por defecto: se ve la jornada entera
  const [unassignedOpen, setUnassignedOpen] = useState(true);
  const [selectedDay,  setSelectedDay]  = useState(0);
  const [compactDayNav, setCompactDayNav] = useState(() => days > 10);
  const [dragging,     setDragging]     = useState(null); // { task, fromRowId }
  const [dropRowId,    setDropRowId]    = useState(null);
  const [stackPanel,   setStackPanel]   = useState(null); // { task, row }
  const [ganttSort,    setGanttSort]    = useState("default"); // "default" | "salida_asc" | "salida_desc" | "servicio_asc" | "servicio_desc"
  const [movePreview,  setMovePreview]  = useState(null); // { task, fromRow, dayOffset, slotsByRowId }
  // Línea vertical de referencia: clic en la regla de horas (arriba, donde
  // salen 06:00, 07:00...) la pone a esa hora cruzando todas las filas;
  // clic cerca de una ya puesta la quita, clic en otro sitio la mueve ahí.
  // Minuto-de-día (mismo espacio que ticks/subTicks), se resetea al cambiar
  // de día porque cada día es un contexto distinto.
  const [vLine,        setVLine]        = useState({ dia: selectedDay, min: null });
  const vLineMin = vLine.dia === selectedDay ? vLine.min : null;
  const setVLineMin = f => setVLine(v => {
    const antes = v.dia === selectedDay ? v.min : null;
    return { dia: selectedDay, min: typeof f === "function" ? f(antes) : f };
  });
  const [labelW,       setLabelW]       = useState(LABEL_W_DEFAULT);
  const resizingRef = useRef(null);

  // ── Windowing de filas ──────────────────────────────────────────
  // Con proyectos grandes (cientos de vehículos, decenas de miles de
  // paradas) renderizar TODAS las filas de golpe — cada una con decenas de
  // bloques de tarea/viaje — mete decenas de miles de nodos DOM en la
  // página aunque el usuario solo vea 15 filas a la vez, y la pestaña se
  // vuelve lentísima. Solo se pinta el contenido real de las filas
  // visibles (+ margen); el resto deja un hueco vacío de la misma altura
  // para que el scroll y el tamaño total no cambien.
  const ganttScrollRef = useRef(null);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const handleGanttScroll = e => {
    setViewport({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight });
  };
  useEffect(() => {
    if (ganttScrollRef.current) setViewport(v => ({ ...v, height: ganttScrollRef.current.clientHeight }));
  }, []);
  const ROW_BUFFER = 10;
  const firstVisibleRow = Math.max(0, Math.floor(viewport.top / ROW_H) - ROW_BUFFER);
  const lastVisibleRow  = Math.ceil((viewport.top + viewport.height) / ROW_H) + ROW_BUFFER;

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
      const slots = computeCandidateSlots(task, r, dayOffset, maxShiftMin);
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

  // Métricas y avisos de cada fila en el día que se está viendo
  const metricsById = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const m = dayMetrics(r, selectedDay);
      map.set(r._id || r.id, { m, issues: dayIssues(m, { maxShiftMin, reglas }) });
    }
    return map;
  }, [rows, selectedDay, maxShiftMin, reglas]);
  const totals = useMemo(() => {
    const t = { n: 0, conAviso: 0, conduccion: 0, trabajo: 0, pausas: 0, km: 0, kmVacio: 0, paradas: 0, amplitud: 0, inicio: Infinity, fin: -Infinity };
    for (const { m, issues } of metricsById.values()) {
      if (issues.length) t.conAviso++;
      if (!m.activo) continue;
      t.n++;
      for (const k of ["conduccion", "trabajo", "pausas", "km", "kmVacio", "paradas", "amplitud"]) t[k] += m[k];
      t.inicio = Math.min(t.inicio, m.inicio); t.fin = Math.max(t.fin, m.fin);
    }
    return t;
  }, [metricsById]);

  const sortedRows = useMemo(() => {
    if (colSort) {
      const val = r => {
        const x = metricsById.get(r._id || r.id);
        if (colSort.key === "nombre") return rowName(r).toLowerCase();
        if (colSort.key === "turno") return turnoCorto(r);
        if (colSort.key === "avisos") return x?.issues.length || 0;
        return x?.m.activo ? x.m[colSort.key] : null;
      };
      return [...rows].sort((a, b) => {
        const va = val(a), vb = val(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * colSort.dir;
      });
    }
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
  }, [rows, ganttSort, selectedDay, colSort, metricsById]);

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

  // ── Encuadre horizontal ──
  // El Gantt pinta el día desde las 00:00; con turnos que empiezan a las
  // 6:00 se abría con seis horas vacías a la izquierda. Al abrir un
  // escenario, cambiar de día o de vista (vehículos/trabajadores) se
  // desplaza a 30 min antes de la primera tarea de ese día. No se recentra
  // al mover paradas a mano (las filas son las mismas), para no saltar.
  const firstActiveMin = useMemo(() => {
    const dayOffset = selectedDay * 1440;
    let first = Infinity;
    for (const r of rows) {
      for (const a of r.assignments || []) {
        if (a._start >= dayOffset && a._start < dayOffset + 1440 && a._start - dayOffset < first) first = a._start - dayOffset;
      }
    }
    return isFinite(first) ? first : minShiftStart;
  }, [rows, selectedDay, minShiftStart]);
  const rowsKey = rows.map(r => r._id || r.id).join("|");
  const centeredForRef = useRef(null);
  // Si el Gantt está oculto (otra pestaña de Scheduling) no se puede
  // desplazar: se espera a que tenga ancho (ResizeObserver) para encuadrar.
  const [scrollerW, setScrollerW] = useState(0);
  useEffect(() => {
    const el = ganttScrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setScrollerW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = ganttScrollRef.current;
    if (!el || !rows.length || !el.clientWidth) return;
    const key = `${selectedDay}#${rowsKey}`;
    if (centeredForRef.current === key) return;
    centeredForRef.current = key;
    el.scrollLeft = Math.max(0, (firstActiveMin - 30) * pxPerMin);
  }, [selectedDay, rowsKey, firstActiveMin, pxPerMin, rows.length, scrollerW]);

  // Zoom manteniendo la hora que se ve en el borde izquierdo (antes se
  // conservaban los píxeles y la vista saltaba a otra hora).
  const zoomAnchorRef = useRef(null);
  const setZoom = z => {
    const el = ganttScrollRef.current;
    if (el) zoomAnchorRef.current = el.scrollLeft / pxPerMin;
    setPxPerMin(z);
  };
  useLayoutEffect(() => {
    const el = ganttScrollRef.current;
    if (el && zoomAnchorRef.current != null) el.scrollLeft = zoomAnchorRef.current * pxPerMin;
    zoomAnchorRef.current = null;
  }, [pxPerMin]);

  const zoomIn  = () => { const i = ZOOM_STEPS.indexOf(pxPerMin); if (i < ZOOM_STEPS.length - 1) setZoom(ZOOM_STEPS[i + 1]); else setZoom(Math.min(12, pxPerMin * 2)); };
  const zoomOut = () => { const i = ZOOM_STEPS.indexOf(pxPerMin); if (i > 0) setZoom(ZOOM_STEPS[i - 1]); else setZoom(Math.max(0.1, pxPerMin / 2)); };

  const zoomLabel = pxPerMin >= 1 ? `${pxPerMin}×` : `${pxPerMin}×`;

  const leftW = vista === "tabla" ? TABLE_W : labelW;
  const fmtCell = (k, m) => {
    if (!m.activo) return "—";
    if (k === "inicio" || k === "fin") return minToTime(m[k] % 1440);
    if (k === "km" || k === "kmVacio") return m[k] ? m[k].toFixed(1) : "0";
    if (k === "paradas") return m.paradas;
    return m[k] ? fmtDurHM(m[k]) : "0";
  };
  const renderTableCells = row => {
    const x = metricsById.get(row._id || row.id) || { m: dayMetrics(row, selectedDay), issues: [] };
    const hasErr = x.issues.some(i => i.nivel === "error");
    return TABLE_COLS.map(col => {
      let content;
      if (col.k === "avisos") {
        content = x.issues.length
          ? <span title={x.issues.map(i => "• " + i.texto).join("\n")} style={{ color: hasErr ? C.red : C.amber, fontWeight: 800, fontSize: 13, cursor: "help" }}>!</span>
          : null;
      } else if (col.k === "nombre") {
        content = <span title={rowName(row)} style={{ fontFamily: font, fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
          {rowName(row)}{row._virtual && <span style={{ color: C.dim, fontWeight: 400 }}> · necesario</span>}
        </span>;
      } else if (col.k === "turno") {
        content = <span style={{ color: C.muted, fontFamily: font, fontSize: 11 }}>{turnoCorto(row)}</span>;
      } else {
        content = <span style={{ color: !x.m.activo ? C.dim : COL_COLOR[col.k] || C.text }}>{fmtCell(col.k, x.m)}</span>;
      }
      return <div key={col.k} style={{ width: col.w, flexShrink: 0, textAlign: col.align || "right", padding: "0 5px", fontFamily: mono, fontSize: 11, overflow: "hidden" }}>{content}</div>;
    });
  };
  const footerCell = k => {
    const t = totals;
    if (!t.n) return "";
    switch (k) {
      case "avisos": return t.conAviso ? String(t.conAviso) : "";
      case "nombre": return `${t.n} activos`;
      case "turno": return "Total";
      case "inicio": return minToTime(t.inicio % 1440);
      case "fin": return minToTime(t.fin % 1440);
      case "amplitud": return "x̄ " + fmtDurHM(t.amplitud / t.n);
      case "km": case "kmVacio": return t[k].toFixed(0);
      case "paradas": return t.paradas.toLocaleString("es-ES");
      default: return fmtDurHM(t[k]);
    }
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      <BarraGantt {...{ cambiarVista, compactDayNav, days, ganttSort, pxPerMin, selectedDay, setCompactDayNav, setGanttSort, setSelectedDay, setZoom, totals, vista, zoomIn, zoomLabel, zoomOut }} />

      {/* ── Scrollable Gantt ── */}
      <div ref={ganttScrollRef} onScroll={handleGanttScroll} style={{ flex: 1, overflowX: "auto", overflowY: "auto", position: "relative" }} onClick={closePanel}>
        <div style={{ display: "inline-block", minWidth: leftW + chartW, minHeight: "100%", position: "relative" }}>

          {/* Línea vertical de referencia — cruza header + todas las filas.
              zIndex por encima del header (10, sticky) — si no, la
              etiqueta de la hora quedaba tapada detrás nada más pasar el
              scroll, invisible en la práctica. */}
          {vLineMin != null && (
            <div style={{
              position: "absolute", left: leftW + vLineMin * pxPerMin, top: 0, bottom: 0, width: 2,
              background: C.blue, zIndex: 14, pointerEvents: "none", boxShadow: `0 0 6px ${C.blue}`,
            }}>
              <div style={{
                position: "sticky", top: 2, left: 4, fontSize: 10, fontFamily: mono, fontWeight: 700,
                color: C.blueText, background: C.card, padding: "1px 5px", borderRadius: 4,
                border: `1px solid ${C.blue}`, whiteSpace: "nowrap", width: "fit-content",
              }}>
                {minToTime(((Math.round(vLineMin) % 1440) + 1440) % 1440)}
              </div>
            </div>
          )}

          {/* Time axis header */}
          <div style={{
            display: "flex", height: HEADER_H,
            position: "sticky", top: 0, zIndex: 10,
            background: C.card, borderBottom: `1px solid ${C.border2}`,
          }}>
            <div style={{
              width: leftW, flexShrink: 0, position: "sticky", left: 0, zIndex: 12,
              background: C.card, borderRight: `1px solid ${C.border}`,
              display: "flex", alignItems: "flex-end", padding: vista === "tabla" ? "0 4px 8px" : "0 16px 8px",
            }}>
              {vista === "tabla" ? TABLE_COLS.map(col => (
                <div key={col.k} title={col.t || (col.l ? `Ordenar por ${col.l.toLowerCase()}` : "")}
                  onClick={e => {
                    e.stopPropagation();
                    setColSort(prev => prev?.key === col.k
                      ? (prev.dir === (col.k === "nombre" || col.k === "turno" ? 1 : -1) ? { key: col.k, dir: -prev.dir } : null)
                      : { key: col.k, dir: col.k === "nombre" || col.k === "turno" ? 1 : -1 });
                  }}
                  style={{ width: col.w, flexShrink: 0, textAlign: col.align || "right", padding: "0 5px", cursor: "pointer", fontSize: 9, letterSpacing: .6, textTransform: "uppercase", fontWeight: 700, color: colSort?.key === col.k ? C.blueText : C.dim, whiteSpace: "nowrap", userSelect: "none" }}>
                  {col.k === "avisos" ? "!" : col.l}{colSort?.key === col.k ? (colSort.dir === 1 ? " ▲" : " ▼") : ""}
                </div>
              )) : <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>Recurso</span>}
              {/* Asa de redimensión — arrastrar para ensanchar la columna */}
              {vista !== "tabla" && <div
                onMouseDown={startResizeLabel}
                title="Arrastrar para ensanchar"
                style={{
                  position: "absolute", top: 0, right: -3, bottom: 0, width: 7,
                  cursor: "col-resize", zIndex: 13,
                }}
                onClick={e => e.stopPropagation()}
              >
                <div style={{ position: "absolute", top: 0, bottom: 0, left: 3, width: 1, background: C.border2 }} />
              </div>}
            </div>
            <div
              onClick={e => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const clickMin = (e.clientX - rect.left) / pxPerMin;
                const TOLERANCE_PX = 10;
                setVLineMin(prev =>
                  prev != null && Math.abs(prev - clickMin) * pxPerMin < TOLERANCE_PX ? null : clickMin
                );
              }}
              title="Clic para poner/quitar una línea vertical de referencia"
              style={{ position: "relative", width: chartW, flexShrink: 0, cursor: "crosshair" }}
            >
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
          {sortedRows.map((row, ri) => {
            if (ri < firstVisibleRow || ri > lastVisibleRow) {
              return <div key={row._id || row.id || ri} style={{ height: ROW_H, borderBottom: `1px solid ${C.border}` }} />;
            }
            return (
            <div key={row._id || row.id || ri} style={{ display: "flex", height: ROW_H, borderBottom: `1px solid ${C.border}` }}>
              {/* Label */}
              <div style={{
                width: leftW, flexShrink: 0, position: "sticky", left: 0, zIndex: 3,
                background: ri % 2 === 0 ? C.card : C.surface2,
                borderRight: `1px solid ${C.border}`,
                display: "flex", alignItems: "center", padding: vista === "tabla" ? "0 4px" : "0 14px", gap: vista === "tabla" ? 0 : 10,
              }}>
                {vista === "tabla" ? renderTableCells(row) : (() => {
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
                    const slots = computeCandidateSlots(task, row, dayOffset, maxShiftMin);
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
                  const slots = computeCandidateSlots(task, row, dayOffset, maxShiftMin);
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
            );
          })}

          {rows.length === 0 && (
            <div style={{ padding: "48px 0", textAlign: "center", color: C.dim, fontSize: 13, width: leftW + chartW }}>Sin recursos asignados</div>
          )}

          {/* Totales y medias del día (vista Tabla) */}
          {vista === "tabla" && totals.n > 0 && (
            <div style={{ display: "flex", height: 30, position: "sticky", bottom: 0, zIndex: 9, background: C.surface2, borderTop: `1px solid ${C.border2}` }}>
              <div style={{ width: leftW, flexShrink: 0, position: "sticky", left: 0, zIndex: 11, background: C.surface2, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 4px" }}>
                {TABLE_COLS.map(col => (
                  <div key={col.k} style={{ width: col.w, flexShrink: 0, textAlign: col.align || "right", padding: "0 5px", fontFamily: mono, fontSize: 10.5, fontWeight: 700, color: col.k === "avisos" ? C.red : C.text, whiteSpace: "nowrap", overflow: "hidden" }}>
                    {footerCell(col.k)}
                  </div>
                ))}
              </div>
              <div style={{ width: chartW, flexShrink: 0 }} />
            </div>
          )}
        </div>

        <TooltipGantt {...{ allVehicles, allWorkers, dragging, mode, stackPanel, tooltip }} />

        <PanelDetalleGantt {...{ attemptMove, closePanel, movePreview, onScheduleChange, rejectMove, rows, stackPanel }} />
      </div>

      <PieGantt {...{ dragging, jornadaStats, setDragging, setUnassignedOpen, unassigned, unassignedOpen }} />
    </div>
  );
}
