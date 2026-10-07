// Diagrama de Gantt del escenario y barra de KPIs.
// (Separado de scheduling.jsx sin cambiar su comportamiento.)
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { dayIssues, dayMetrics } from "../scenario-metrics.js";
import { applyTaskMove, computeCandidateSlots, minToTime, turnoWindow } from "../vrp-engine.js";
import { C, barrioColor, fmtDurHM, font, mono } from "./estilo.js";

// ── GANTT CHART ───────────────────────────────────────────────────
const ROW_H    = 52;
const HEADER_H = 44;
const LABEL_W_DEFAULT = 210;
const LABEL_W_MIN = 150;
const LABEL_W_MAX = 480;

// Vista "Tabla" del Gantt: columnas de datos por fila (como un planificador
// profesional): métricas del día que se está viendo, ordenables, con avisos
// de reglas (ver scenario-metrics.js) y fila de totales abajo.
const TABLE_COLS = [
  { k: "avisos",     l: "",         w: 22, align: "center", t: "Avisos de reglas (pasa el ratón por el !)" },
  { k: "nombre",     l: "Recurso",  w: 150, align: "left" },
  { k: "turno",      l: "Turno",    w: 64, align: "left" },
  { k: "inicio",     l: "Inicio",   w: 50, t: "Primera tarea del día" },
  { k: "fin",        l: "Fin",      w: 50, t: "Última tarea del día" },
  { k: "amplitud",   l: "Amplitud", w: 62, t: "De la primera a la última tarea (tiempo pagado)" },
  { k: "conduccion", l: "Conduc.",  w: 58, t: "Tiempo conduciendo" },
  { k: "trabajo",    l: "Trabajo",  w: 58, t: "Tiempo en paradas" },
  { k: "pausas",     l: "Pausas",   w: 52 },
  { k: "km",         l: "Km",       w: 52 },
  { k: "kmVacio",    l: "Km vacío", w: 58, t: "Salida y vuelta a cochera" },
  { k: "paradas",    l: "Paradas",  w: 54 },
];
const TABLE_W = TABLE_COLS.reduce((sum, c) => sum + c.w, 0) + 8;
const COL_COLOR = { amplitud: "#34d399", km: "#fb923c", kmVacio: "#fb923c" };
const rowName = r => [r?.nombre, r?.apellidos].filter(Boolean).join(" ") || r?.name || r?.matricula || "?";
const turnoCorto = r => r?._virtual ? "—" : ((r?.turno || "").split(/[ (]/)[0] || "—");

// Explicación de cada indicador (al pasar el ratón)
const KPI_AYUDA = {
  "Vehículos": "Vehículos con alguna ruta en el escenario. PVR: los que están en ruta a la vez en el momento de más actividad — los que necesitas de verdad.",
  "Turnos": "Jornadas de trabajo: cada conductor (o vehículo, si no hay conductores) en cada día con ruta.",
  "Eficiencia vehículo": "Km en ruta / km totales. Lo que falta hasta el 100 % son los km en vacío de salida y vuelta a cochera.",
  "Eficiencia personal": "Tiempo productivo (conducción + trabajo en paradas) / tiempo pagado (de inicio a fin de jornada). Lo que falta son pausas y esperas.",
  "Km": "Kilómetros totales del escenario; debajo, los recorridos en vacío (salida y vuelta a cochera).",
  "Paradas": "Paradas asignadas a alguna ruta; debajo, las que el algoritmo no pudo encajar (panel \"Sin asignar\").",
  "Coste estimado": "Horas pagadas × €/hora + km × €/km, con las tarifas de Restricciones. Es una estimación para comparar escenarios.",
  "Avisos": "Filas que incumplen alguna regla: conducción UE 561/2006, descanso del Estatuto (art. 34.4), jornada máxima o franja horaria. Detalle en la columna \"!\" de la tabla.",
};

// Barra de indicadores del escenario, con el cambio respecto a la generación anterior.
// `cambios` adapta indicadores sin tocar los de aquí (lo usa el Scheduling de
// líneas regulares): { "Paradas": { l: "Viajes", sub, ayuda }, "Eficiencia vehículo": { ocultar: true } }
export function KpiBar({ k, base, onConfigCostes, cambios = {} }) {
  const pct = v => v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")} %`;
  const num = v => v == null ? "—" : Math.round(v).toLocaleString("es-ES");
  const eur = v => v == null ? "—" : v.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  // mejor: "up" = subir es bueno, "down" = bajar es bueno
  const delta = (cur, prev, mejor, fmt) => {
    if (cur == null || prev == null) return null;
    const d = cur - prev;
    if (Math.abs(d) < 1e-9) return null;
    const bueno = mejor === "up" ? d > 0 : d < 0;
    return <span style={{ fontSize: 11, fontWeight: 700, color: bueno ? C.green : C.red, marginLeft: 6 }}>{d > 0 ? "▲" : "▼"} {fmt(Math.abs(d))}</span>;
  };
  const pp = d => `${(d * 100).toFixed(1).replace(".", ",")} pp`;
  const h = min => `${Math.round(min / 60).toLocaleString("es-ES")} h`;
  const items = [
    { l: "Vehículos", v: num(k.vehiculos), d: delta(k.vehiculos, base?.vehicleCount, "down", num), sub: `PVR ${k.pvr} (a la vez en punta)` },
    { l: "Turnos", v: num(k.turnos), d: delta(k.turnos, base?.turnos, "down", num), sub: "conductor × día" },
    { l: "Eficiencia vehículo", v: pct(k.eficVehiculo), d: delta(k.eficVehiculo, base?.eficVehiculo, "up", pp), sub: `km en ruta / km totales · ${num(k.km - k.kmVacio)} / ${num(k.km)}` },
    { l: "Eficiencia personal", v: pct(k.eficPersonal), d: delta(k.eficPersonal, base?.eficPersonal, "up", pp), sub: `tiempo productivo / pagado · ${h(k.conduccion + k.trabajo)} / ${h(k.pagado)}` },
    { l: "Km", v: num(k.km), d: delta(k.km, base?.totalKm, "down", num), sub: `${num(k.kmVacio)} en vacío (cochera)` },
    { l: "Paradas", v: num(k.paradas), d: delta(k.paradas, base?.totalStops, "up", num), sub: k.sinAsignar ? `${num(k.sinAsignar)} sin asignar` : "todas asignadas", subColor: k.sinAsignar ? C.red : C.green },
    k.coste != null
      ? { l: "Coste estimado", v: eur(k.coste), d: delta(k.coste, base?.coste, "down", eur), sub: "personal + km (Restricciones)" }
      : { l: "Coste estimado", v: <button onClick={onConfigCostes} style={{ background: "none", border: `1px dashed ${C.border2}`, color: C.muted, borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", fontFamily: font }}>Configurar €/h y €/km</button>, sub: "en Restricciones" },
    { l: "Avisos", v: num(k.filasConAviso), d: delta(k.filasConAviso, base?.avisos, "down", num), sub: k.avisos ? `${k.avisos} incumplimientos de reglas` : "sin incumplimientos", color: k.filasConAviso ? C.red : C.green },
  ];
  const vistos = items
    .filter(it => !cambios[it.l]?.ocultar)
    .map(it => ({ ...it, ...(cambios[it.l] || {}), ayuda: cambios[it.l]?.ayuda || KPI_AYUDA[it.l] }));
  return (
    <div style={{ flexShrink: 0, background: C.card, borderBottom: `1px solid ${C.border}`, display: "flex", overflowX: "auto" }}>
      {vistos.map((it, i) => (
        <div key={it.l} title={it.ayuda} style={{ padding: "10px 18px", borderRight: i < vistos.length - 1 ? `1px solid ${C.border}` : "none", minWidth: 150, flexShrink: 0, cursor: "help" }}>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: it.color || C.blueText, fontFamily: mono, lineHeight: 1.1 }}>{it.v}</span>
            {it.d}
          </div>
          <div style={{ fontSize: 9.5, color: C.text, textTransform: "uppercase", letterSpacing: .8, fontWeight: 700, marginTop: 3 }}>{it.l}</div>
          <div style={{ fontSize: 10, color: it.subColor || C.dim, marginTop: 1, whiteSpace: "nowrap" }}>{it.sub}</div>
        </div>
      ))}
      {base && <div style={{ padding: "10px 14px", fontSize: 10, color: C.dim, alignSelf: "center", whiteSpace: "nowrap" }}>▲▼ respecto a la generación anterior</div>}
    </div>
  );
}
const ZOOM_STEPS = [0.25, 0.5, 1, 2, 4, 8];
const UNASSIGNED_RENDER_CAP = 300;

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
  const [vLineMin,     setVLineMin]     = useState(null);
  useEffect(() => { setVLineMin(null); }, [selectedDay]);
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

      {/* ── Toolbar ── */}
      <div style={{
        flexShrink: 0, background: C.surface2, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 6, padding: "5px 16px", flexWrap: "wrap",
      }}>
        {/* Vista */}
        <div style={{ display: "flex", gap: 2, background: C.card, borderRadius: 6, padding: 2, marginRight: 8 }}>
          {[["tabla", "Tabla"], ["compacta", "Compacta"]].map(([v, l]) => (
            <button key={v} onClick={() => cambiarVista(v)} style={{ padding: "2px 9px", borderRadius: 4, border: "none", fontSize: 10, fontFamily: font, cursor: "pointer", fontWeight: 600, background: vista === v ? C.blue : "transparent", color: vista === v ? "#fff" : C.dim }}>{l}</button>
          ))}
        </div>
        {/* Zoom */}
        <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600, marginRight: 4 }}>Zoom</span>
        <button onClick={zoomOut} style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid ${C.border}`, background: "none", color: C.muted, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
        <span style={{ fontSize: 11, color: C.text, fontFamily: mono, minWidth: 28, textAlign: "center" }}>{zoomLabel}</span>
        <button onClick={zoomIn}  style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid ${C.border}`, background: "none", color: C.muted, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
        <div style={{ width: 1, height: 16, background: C.border, margin: "0 4px" }} />
        {ZOOM_STEPS.map(z => (
          <button key={z} onClick={() => setZoom(z)} style={{
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

        {totals.conAviso > 0 && (
          <span title="Filas del día con avisos de reglas — mira la columna ! de la tabla" style={{ marginLeft: 8, fontSize: 10, fontFamily: mono, color: C.red, fontWeight: 700 }}>
            ! {totals.conAviso} con avisos
          </span>
        )}

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
              {/* Con proyectos grandes puede haber miles de paradas sin
                  asignar — pintar todas de golpe (cada una arrastrable)
                  mete miles de nodos DOM y vuelve la pestaña lentísima.
                  Este stack es para colocar a mano las últimas que quedan,
                  no para miles a la vez, así que se limita el pintado. */}
              {unassigned.slice(0, UNASSIGNED_RENDER_CAP).map((task, i) => {
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
              {unassigned.length > UNASSIGNED_RENDER_CAP && (
                <div style={{ display: "flex", alignItems: "center", padding: "0 8px", fontSize: 10.5, color: C.dim }}>
                  +{(unassigned.length - UNASSIGNED_RENDER_CAP).toLocaleString()} más — coloca o filtra estas para ver el resto
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
