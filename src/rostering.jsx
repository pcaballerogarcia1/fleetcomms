import { useState, useEffect, useRef, useMemo } from "react";
import { db } from "./firebase.js";
import { DEFAULT_ROSTER_RULES, CODE_WINDOWS } from "./roster-optimizer.js";
import { watchServiciosProyecto, aplicarRosterAlServicio, publicarCuadranteLineas } from "./lineas-servicio-store.js";
import { diasCuadrante } from "./lineas-rostering.js";
import { fechaLocal } from "./lineas-servicio.js";
import { logAudit, logAuditGrouped, addCells } from "./audit.js";
import { listenScenarioRoster, listenRosterMonth, saveRosterMonth, savedSnapshotOf, mergeCells } from "./roster-store.js";
import { doc, onSnapshot, setDoc, updateDoc, serverTimestamp, collection, query, where, deleteField, FieldPath } from "firebase/firestore";
import { C, MONTH_NAMES, SHIFTS, font, useVehicleAvailability } from "./rostering/datos.js";
import { OptResultModal, PublishModal, RulesModal } from "./rostering/modales.jsx";
import { VehicleAvailabilityGrid } from "./rostering/vehiculos.jsx";
import { doPublish as doPublishMod, optimizar as optimizarMod, optimizarLibre as optimizarLibreMod } from "./rostering/acciones.js";
import { CabeceraCuadrante, TablaCuadrante, PieYResumen } from "./rostering/cuadrante.jsx";

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

  function doPublish(targets, tipo) {
    return doPublishMod({ activeProject, asign, grid, month, orgId, schedRoster, setPublishModal, setPublishing, viewMes, year }, targets, tipo);
  }

  // Disponibilidad de vehículos del mes (para no mover turnos a días de taller)
  const { grid: vehicleGrid } = useVehicleAvailability(orgId, year, month, { live: true });

  // ── Scheduling roster (populated when a scenario is generated) ──
  // { mes, turnoByWorker, daysWorked }, con el proyecto del que viene
  const [rosterDe, setRosterDe] = useState({ id: null, valor: null });
  const idProyecto = activeProject?._id || null;
  useEffect(() => {
    if (!idProyecto) return;
    // Ficha principal + partes (roster-store.js): los turnos y el detalle
    // diario van troceados para no pasar de 1 MB.
    return listenScenarioRoster(idProyecto, valor => setRosterDe({ id: idProyecto, valor }));
  }, [idProyecto]);
  const schedRoster = idProyecto && rosterDe.id === idProyecto ? rosterDe.valor : null;

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
  // el mes del cuadrante ya leído (se ve «cargando» mientras no sea el que toca)
  const [cargadoDe, setCargadoDe] = useState(null);
  // Asignaciones de Optimizar (modo libre): trabajador → día → { id, v, vn, s, e }
  // (turno cubierto, vehículo y horario). Una celda con asignación la puso
  // el optimizador; sin ella, la escribió alguien a mano.
  const [asign, setAsign] = useState({});
  const asignRef = useRef({});
  // Lo último guardado por trabajador (para escribir solo lo que cambia) y
  // si el mes venía en el formato antiguo de un solo documento.
  const savedRef = useRef({});
  const legacyRef = useRef(false);
  const persistChain = useRef(Promise.resolve());
  // Cuadrícula local al día (incluye lo tocado aquí y aún no guardado): la
  // escucha en vivo mezcla sobre ella lo que cambian los demás.
  const gridRef = useRef({});
  const docIdRef = useRef(null);
  const updateGrid = next => { gridRef.current = next; setGrid(next); };

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
  const loading = !!docId && cargadoDe !== docId;

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
    // lo del mes anterior se olvida; la pantalla espera («cargando») a la primera lectura
    gridRef.current = {}; asignRef.current = {}; savedRef.current = {};
    if (!docId) return;
    loadedRef.current = false;
    docIdRef.current = docId;
    // En vivo: lo que cambian otras personas aparece aquí sin recargar. Las
    // casillas tocadas aquí y aún sin guardar se respetan (mergeCells), y se
    // guarda casilla a casilla (saveRosterMonth), así nadie pisa a nadie.
    return listenRosterMonth(orgId, year, month, m => {
      if (!loadedRef.current) {
        updateGrid(m.grid);
        setAsign(m.asignaciones); asignRef.current = m.asignaciones;
        savedRef.current = m.legacy ? {} : savedSnapshotOf(m.grid, m.asignaciones);
        legacyRef.current = m.legacy;
        loadedRef.current = true;
        setCargadoDe(docId);
        return;
      }
      if (legacyRef.current) return; // formato antiguo: se migra entero al primer guardado
      const base = { grid: {}, asign: {} };
      for (const [wid, json] of Object.entries(savedRef.current)) {
        const p = JSON.parse(json); base.grid[wid] = p.grid; base.asign[wid] = p.asign;
      }
      const g = mergeCells(gridRef.current, base.grid, m.grid);
      const a = mergeCells(asignRef.current, base.asign, m.asignaciones);
      savedRef.current = savedSnapshotOf(m.grid, m.asignaciones);
      updateGrid(g);
      asignRef.current = a; setAsign(a);
    });
  }, [docId, orgId, year, month]);

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
    logAudit({ modulo: "Rostering", accion: "Cambió las reglas del cuadrante", projectId: null,
      detalle: newConvenio?.nombre ? `Convenio: ${newConvenio.nombre}` : "" });
    setConvenio(newConvenio);
    setRules(newRules);
    setHorasPorTrabajador(newHoras);
    if (!rulesDocId) return;
    // Solo lo que ha cambiado (cada regla, las horas de cada trabajador y el
    // convenio por separado): antes se reescribía el documento entero y dos
    // personas editando a la vez se deshacían los cambios.
    const dif = (x, y) => JSON.stringify(x ?? null) !== JSON.stringify(y ?? null);
    const datos = { org_id: orgId, updatedAt: serverTimestamp(), rules: {}, horasPorTrabajador: {} };
    const campos = ["org_id", "updatedAt"];
    for (const [k, v] of Object.entries(newRules)) if (dif(rules[k], v)) { datos.rules[k] = v; campos.push(new FieldPath("rules", k)); }
    for (const k of new Set([...Object.keys(horasPorTrabajador), ...Object.keys(newHoras)])) {
      if (dif(horasPorTrabajador[k], newHoras[k])) { datos.horasPorTrabajador[k] = newHoras[k] === undefined ? deleteField() : newHoras[k]; campos.push(new FieldPath("horasPorTrabajador", k)); }
    }
    if (dif(convenio, newConvenio)) { datos.convenio = newConvenio; campos.push("convenio"); }
    if (campos.length > 2) setDoc(doc(db, "rostering", rulesDocId), datos, { mergeFields: campos })
      .catch(e => alert("No se pudieron guardar las reglas: " + (e.message || e)));
  }

  // Escritura del documento del mes (cuadrante + asignaciones juntos, para
  // que ninguna escritura pise a la otra).
  function persistMonth(newGrid, newAsign = asignRef.current) {
    if (!docId) return;
    // En cola: dos guardados seguidos no se pisan y cada uno escribe solo
    // las casillas que han cambiado desde el anterior. Al tocarle el turno
    // se guarda lo más reciente (incluye lo que haya llegado de otros entre
    // tanto), salvo que ya se haya cambiado de mes.
    const y = year, m = month, target = docId;
    persistChain.current = persistChain.current
      .then(() => {
        const current = docIdRef.current === target;
        return saveRosterMonth(orgId, y, m, current ? gridRef.current : newGrid, current ? asignRef.current : newAsign,
          savedRef, { legacy: legacyRef.current });
      })
      .then(() => { legacyRef.current = false; })
      .catch(e => alert("No se pudo guardar el cuadrante: " + (e.message || e)));
  }

  // Una edición a mano de una celda anula la asignación del optimizador en
  // esa celda (el turno vuelve a quedar sin cubrir hasta re-optimizar).
  function dropAsign(cells) {
    if (cells.length && docId) {
      logAuditGrouped(`roster-edit:${docId}`, { modulo: "Rostering", accion: "Editó el cuadrante", projectId: null },
        addCells(cells), acc => `${acc.cells.size} casilla(s) de ${acc.rows.size} trabajador(es) · ${MONTH_NAMES[month - 1]} ${year}`);
    }
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
    let newGrid = { ...gridRef.current };
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
    updateGrid(newGrid);
    pendingRef.current = newGrid;
    clearTimeout(debounceRef.current._batch);
    debounceRef.current._batch = setTimeout(() => {
      if (!docId || !pendingRef.current) return;
      persistMonth(gridRef.current);
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
    const newGrid = { ...gridRef.current, [workerId]: wGrid };
    dropAsign(days.map(d => [workerId, d]));
    updateGrid(newGrid);
    pendingRef.current = newGrid;
    persistMonth(newGrid);
  }

  // ── Optimizar: auto-assign scheduled shifts respecting availability ──
  function optimizar() {
    return optimizarMod({ activeProject, days, gridRef, month, optimizarLibre, pendingRef, persistMonth, schedDayFor, schedRoster, updateGrid, workers, year });
  }

  // ── Optimizar (escenario en modo libre) ───────────────────────
  // Asigna trabajador + vehículo a cada turno a cubrir del escenario según
  // las reglas. Lo escrito a mano (L/B, M/T/N, G, D) se respeta; lo que puso
  // una optimización anterior se recalcula entero.
  function optimizarLibre() {
    return optimizarLibreMod({ activeProject, asignRef, daysInMonth, gridRef, horasPorTrabajador, month, pendingRef, persistMonth, rules, schedRoster, setAsign, setOptResult, updateGrid, vehicleGrid, workers, year });
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

  // Líneas regulares: qué calendario circula cada día del mes que se ve
  // (lo manda el Scheduling de líneas con «Enviar a Rostering»)
  const calsLineas = useMemo(() => (schedRoster?.lineas && schedRoster.mes === `${year}-${String(month).padStart(2, "0")}` ? schedRoster.cals || [] : null), [schedRoster, year, month]);
  const calDeDia = d => (calsLineas ? calsLineas[schedRoster.calDia?.[d] ?? schedRoster.calDia?.[String(d)]] || null : null);

  // Cada turno, de un trabajador: lo que se asigna aquí pasa solo a los días
  // ya publicados a Control (de hoy en adelante, los de este mes), y a cada
  // conductor le aparece su turno en «Mi turno». Los turnos ya empezados no se tocan.
  const esLineas = !!schedRoster?.lineas;
  const [serviciosLineas, setServiciosLineas] = useState([]);
  useEffect(() => {
    if (!esLineas || !activeProject?._id || !orgId) return;
    return watchServiciosProyecto(activeProject._id, orgId, setServiciosLineas);
  }, [esLineas, activeProject?._id, orgId]);
  const firmaServRef = useRef({});
  const [avisoServicio, setAvisoServicio] = useState(null);
  useEffect(() => {
    if (!esLineas || loading || !workers.length || !serviciosLineas.length) return;
    const hoy = fechaLocal();
    const delMes = serviciosLineas.filter(sv => sv.fecha.startsWith(viewMes) && sv.fecha >= hoy);
    if (!delMes.length) return;
    const t = setTimeout(async () => {
      for (const sv of delMes) {
        // solo si ha cambiado algo de ese día (lo asignado, los usuarios vinculados o la publicación)
        const d = Number(sv.fecha.slice(8, 10));
        const firma = JSON.stringify([sv.publicadoAt, Object.entries(asign).map(([w, ds]) => [w, ds?.[d]?.id || null]).filter(x => x[1]), workers.map(w => [w._id, w.uid || null])]);
        if (firmaServRef.current[sv._id] === firma) continue;
        firmaServRef.current[sv._id] = firma;
        try {
          const r = await aplicarRosterAlServicio(sv, orgId, asign, workers);
          if (r.cambiados) setAvisoServicio(`Control actualizado: ${r.cambiados} turno(s) del ${Number(sv.fecha.slice(8))} con su trabajador${r.empezados ? ` · ${r.empezados} ya empezado(s) no se han cambiado` : ""}`);
        } catch (e) {
          delete firmaServRef.current[sv._id];
          console.error("Rostering → Control:", e);
        }
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [esLineas, loading, asign, workers, serviciosLineas, viewMes, orgId]);
  useEffect(() => { if (!avisoServicio) return; const t = setTimeout(() => setAvisoServicio(null), 6000); return () => clearTimeout(t); }, [avisoServicio]);
  // y el cuadrante del mes, a cada conductor vinculado a la app: en «Mi turno»
  // ve sus turnos de los próximos días (se publica solo, al cambiar algo suyo)
  const firmaCuadRef = useRef({});
  useEffect(() => {
    if (!calsLineas || loading || !orgId) return;
    const t = setTimeout(async () => {
      let n = 0;
      for (const w of workers) {
        if (!w.uid) continue;
        const dias = diasCuadrante(grid[w._id], asign[w._id]);
        const clave = `${viewMes}|${w._id}`;
        const firma = JSON.stringify([w.uid, dias]);
        if (firmaCuadRef.current[clave] === firma) continue;
        firmaCuadRef.current[clave] = firma;
        try { await publicarCuadranteLineas({ orgId, projectId: activeProject?._id, worker: w, year, month, dias }); n++; }
        catch (e) { delete firmaCuadRef.current[clave]; console.error("Cuadrante al móvil:", e); }
      }
      if (n) setAvisoServicio(`Cuadrante enviado al móvil de ${n} conductor${n > 1 ? "es" : ""}`);
    }, 3000);
    return () => clearTimeout(t);
  }, [calsLineas, loading, workers, grid, asign, viewMes, year, month, orgId, activeProject?._id]);

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

      <CabeceraCuadrante {...{ avisoServicio, calsLineas, coveredCount, daysInMonth, libreShifts, mode, month, nextMonth, optimizar, prevMonth, schedRoster, setMode, setShowRules, workers, year }} />

      <TablaCuadrante {...{ CELL_W, NAME_W, PUB_W, STATS_W, asign, calDeDia, calsLineas, coveredIds, dayTotals, days, daysInMonth, fillRow, getDow, grid, handleCellMouseDown, handleCellMouseEnter, handleKeyDown, horasPorTrabajador, isCellSelected, isToday, isWeekend, libreShifts, linkWorker, loading, month, publicados, publishing, rules, scheduledCode, setPublishModal, setSelEnd, setSelStart, setSummaryCell, suggestUser, tableRef, usuarios, workedInterval, workerStats, workers, year }} />

      <PieYResumen {...{ asign, getDow, grid, month, schedDayFor, schedRoster, scheduledCode, selectedCount, setSummaryCell, summaryCell, workers, year }} />

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
