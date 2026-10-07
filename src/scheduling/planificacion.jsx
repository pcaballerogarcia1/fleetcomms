// Pestaña de planificación: generar, ver y publicar el escenario.
// (Separado de scheduling.jsx sin cambiar su comportamiento.)
import { addDoc, collection, deleteDoc, doc, getDoc, limit, onSnapshot, query, serverTimestamp } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import { logAudit, logAuditGrouped } from "../audit.js";
import { db } from "../firebase.js";
import { t, useLang } from "../i18n.js";
import { diaDelPlan, planEmpezado, planesPublicados, taskToUbicacion } from "../publicar-rutas.js";
import { saveScenarioRoster } from "../roster-store.js";
import { SHIFT_META, VEHICLE_STATUS_META, isUnavailable, isVehicleUnavailable, useRostering, useVehicleAvailability, vehicleCodeOnDay, workerCodeOnDay } from "../rostering.jsx";
import { scenarioKpis } from "../scenario-metrics.js";
import { loadScenarioCloud, newScenarioVersion, saveScenarioCloud, watchScenarioMeta } from "../scenario-store.js";
import { autoScaleFleetBg, generateScenarioBg } from "../vrp-client.js";
import { applyTaskMove, hasCoords, minToTime, shiftCodeFromStart, turnoWindow } from "../vrp-engine.js";
import { ROSTER_TURNO, applyShiftMoves, deriveWorkerRows, extractShifts, kpiHistorial, lastScenarioDay, loadTasksFromLayers, spliceWorkerWindowIntoVehicle, vehicleDayWindows, workerDayWindows } from "./datos.js";
import { C, font, mono } from "./estilo.js";
import { GanttChart, KpiBar } from "./gantt.jsx";
import { idbLoad, idbSave } from "./idb.js";
import { enrichWithOSRM } from "./osrm.js";
import { ConstraintsPanel } from "./restricciones.jsx";
// La librería de Excel (~430 KB) se descarga solo cuando se usa (importar o
// exportar un Excel), no al abrir cualquier proyecto.
const loadXLSX = () => import("xlsx");

// ── PLANIFICACION TAB ─────────────────────────────────────────────
export function TabPlanificacion({ vehicles, workers, activeProject, onProjectUpdate, orgId, sesion = null }) {
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
    optimizeWeight: 0, virtualShiftMin: 0, rosterMode: "cuadrante",
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
  const [genPhase,     setGenPhase]    = useState(null); // "vrp"|"osrm"|"workers"
  // Guardado del resumen (proyecto + historial + roster) tras generar —
  // deliberadamente fuera de genPhase/generating: el escenario ya está
  // calculado y usable en cuanto sale de "workers", así que no tiene
  // sentido tener al usuario mirando una pantalla de "Guardando resultado"
  // colgada si la conexión a Firestore se atasca en este último paso (pasa
  // con red floja o pestaña que estuvo en segundo plano) — el resumen es
  // secundario y se ve reflejado en la tarjeta de Proyectos, no en el
  // Gantt que el usuario ya tiene delante.
  const [savingSummary,    setSavingSummary]    = useState(false);
  const [saveSummaryError, setSaveSummaryError] = useState(null);
  // Progreso real del auto-escalado (ronda, vehículos probados, sin
  // asignar, tiempo de esa ronda) — sin esto, un cálculo largo en un
  // proyecto grande es indistinguible de uno colgado.
  const [scaleProgress, setScaleProgress] = useState(null);
  const [focusMode,    setFocusMode]   = useState(false); // hide all panels except gantt
  const [elapsedSec,   setElapsedSec]  = useState(0);
  const genStartRef = useRef(null);

  const GEN_PHASES = {
    vrp:     { label: "Calculando rutas VRP…",            pct: 20 },
    osrm:    { label: "Calculando km reales por carretera…", pct: 55 },
    workers: { label: "Asignando trabajadores…",          pct: 78 },
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
  // Modo de Rostering con el que se generó el escenario CARGADO (no el del
  // selector de restricciones, que puede haberse cambiado después sin
  // regenerar): decide de dónde sale el conductor de cada tramo al publicar.
  const [scenarioRosterMode, setScenarioRosterMode] = useState("cuadrante");
  // Movimientos de día que manda Rostering (scheduling_roster.moves), y
  // cuántos de ellos ya están aplicados a este escenario (se guarda con el
  // escenario en IndexedDB). scenarioStampRef = generatedAt del escenario
  // cargado: solo se aplican movimientos de ESE escenario (si no, al
  // regenerar podían colarse los del escenario anterior).
  const [rosterMoves, setRosterMoves] = useState({ stamp: null, moves: [] });
  const appliedMovesRef = useRef(0);
  const scenarioStampRef = useRef(null);
  const scenarioProjectRef = useRef(null); // proyecto al que pertenece el escenario cargado

  // ── Escenario en la nube (scenario-store.js) ──────────────────────
  // Todo cambio del escenario (generar, mover paradas en el Gantt,
  // deshacer, turnos movidos por Rostering) se guarda al momento en el
  // IndexedDB de este navegador y, 1,5 s después, en Firestore — así el
  // escenario se ve desde cualquier PC. Si otro PC guarda una versión
  // nueva mientras este tiene el proyecto abierto, se descarga sola.
  const cloudVRef       = useRef(null);  // versión de la nube que tiene este navegador
  const cloudTimerRef   = useRef(null);
  const cloudPendingRef = useRef(null);  // { projectId, payload } pendiente de subir
  const persistedRef    = useRef(null);  // { s, u } ya guardado/cargado — no se resube
  const [cloudSync, setCloudSync] = useState(null); // null | "loading" | "saving" | "saved" | "error"
  // Otra persona guardó este escenario mientras se editaba aquí:
  // { projectId, payload, meta } — se pregunta qué hacer en vez de pisarla.
  const [cloudConflict, setCloudConflict] = useState(null);
  const cloudConflictRef = useRef(null);
  const [cloudMeta, setCloudMeta] = useState(null); // ficha de la nube: versión actual + puntos de restauración
  useEffect(() => { cloudConflictRef.current = cloudConflict; }, [cloudConflict]);

  async function runCloudSave() {
    clearTimeout(cloudTimerRef.current); cloudTimerRef.current = null;
    const job = cloudPendingRef.current;
    cloudPendingRef.current = null;
    if (!job) return;
    const v = newScenarioVersion();
    const isCurrent = job.projectId === scenarioProjectRef.current;
    // Versión de la que parte esta edición (si alguien guardó otra entre
    // medias, no se pisa: se pregunta). Solo se conoce para el proyecto abierto.
    const baseV = job.force || !isCurrent ? undefined : cloudVRef.current;
    // Nuestra propia escritura: el aviso de cambio que llegue con esta
    // versión no debe volver a descargarla.
    if (isCurrent) cloudVRef.current = v;
    setCloudSync("saving");
    try {
      const savedBy = sesion ? { uid: sesion.uid, nombre: [sesion.nombre, sesion.apellidos].filter(Boolean).join(" ") } : null;
      await saveScenarioCloud(job.projectId, orgId, job.payload, v, { baseV, savedBy, motivo: job.force ? "sobrescribir" : job.motivo });
      idbSave(`vrp_${job.projectId}`, { ...job.payload, cloudV: v, dirty: false });
      setCloudSync(s => (s === "saving" ? "saved" : s));
      setCloudConflict(null);
    } catch (e) {
      if (e.conflict) {
        if (isCurrent) cloudVRef.current = baseV ?? null;
        setCloudSync(null);
        setCloudConflict({ projectId: job.projectId, payload: job.payload, meta: e.meta });
        return;
      }
      console.error("scenario cloud save:", e);
      setCloudSync("error");
    }
  }

  // Conflicto: quedarse con la versión de la otra persona…
  async function takeTheirScenario() {
    const c = cloudConflict;
    if (!c?.meta) return;
    setCloudConflict(null);
    clearTimeout(cloudTimerRef.current); cloudPendingRef.current = null;
    setCloudSync("loading");
    try {
      const { meta, data } = await loadScenarioCloud(c.projectId, c.meta);
      if (c.projectId !== scenarioProjectRef.current) return;
      cloudVRef.current = meta.v;
      applyScenario(c.projectId, data);
      idbSave(`vrp_${c.projectId}`, { ...data, cloudV: meta.v, dirty: false });
      setCloudSync("saved");
    } catch (e) {
      console.error("scenario cloud load:", e);
      setCloudSync("error");
    }
  }
  // …o guardar la mía encima de la suya
  function keepMyScenario() {
    const c = cloudConflict;
    if (!c) return;
    setCloudConflict(null);
    cloudPendingRef.current = { projectId: c.projectId, payload: c.payload, force: true };
    runCloudSave();
    logAudit({ modulo: "Scheduling", accion: "Guardó su escenario encima del de otra persona",
      detalle: `Se sustituyó la versión de ${c.meta?.savedBy?.nombre || "otra persona"} (queda como punto de restauración)` });
  }

  // Restaurar un punto de restauración: pasa a ser la versión actual (y la
  // que había queda a su vez como punto, por si acaso)
  async function restorePoint(p) {
    const pid = activeProject?._id;
    if (!pid || !p?.v) return;
    const cuando = p.savedAtMs ? new Date(p.savedAtMs).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    const otraGeneracion = p.stamp && scenarioStampRef.current && p.stamp !== scenarioStampRef.current;
    if (!confirm(`¿Restaurar la versión${cuando ? " del " + cuando : ""}${p.savedBy?.nombre ? " (" + p.savedBy.nombre + ")" : ""}?\n\nLa versión actual no se pierde: queda como punto de restauración.` +
      (otraGeneracion ? "\n\nOjo: es de un escenario generado antes. Rostering sigue con los turnos del último generado — si trabajáis con Optimizar, vuelve a generar." : ""))) return;
    setShowHistorial(false);
    setCloudSync("loading");
    try {
      const { data } = await loadScenarioCloud(pid, p);
      if (scenarioProjectRef.current !== pid && activeProject?._id !== pid) return;
      applyScenario(pid, data);
      persistScenario(pid, data, "restaurar");
      setCloudSync(null);
      logAudit({ modulo: "Scheduling", accion: "Restauró una versión anterior del escenario",
        detalle: [p.motivo, cuando, p.savedBy?.nombre].filter(Boolean).join(" · ") });
    } catch (e) {
      console.error("restore point:", e);
      setCloudSync("error");
    }
  }

  function persistScenario(projectId, payload, motivo) {
    // Local al momento (sobrevive a recargar aunque la nube falle)…
    idbSave(`vrp_${projectId}`, { ...payload, cloudV: cloudVRef.current, dirty: true });
    // …y a la nube con un pequeño retardo, para no subir el escenario
    // entero por cada parada que se arrastra.
    clearTimeout(cloudTimerRef.current);
    const prevMotivo = cloudPendingRef.current?.projectId === projectId ? cloudPendingRef.current.motivo : undefined;
    cloudPendingRef.current = { projectId, payload, motivo: motivo || prevMotivo };
    cloudTimerRef.current = setTimeout(runCloudSave, 1500);
  }

  // Pinta un escenario cargado (del IndexedDB o de la nube)
  function applyScenario(projectId, data) {
    const sc = activeProject?.scheduling;
    const next = { vehicles: data.vehicles, workers: data.workers || [] };
    const un = data.unassigned || { vehicles: [], workers: [] };
    persistedRef.current = { s: next, u: un };
    setSchedules(next);
    setUnassigneds(un);
    setMoveHistory([]); setHistoryIndex(-1);
    setScenarioRosterMode(data.rosterMode || sc?.constraints?.rosterMode || "cuadrante");
    appliedMovesRef.current = data.appliedMoves || 0;
    scenarioProjectRef.current = projectId;
    scenarioStampRef.current = data.stamp || null;
    // Con turnos movidos de día el escenario puede pasar de daysUsed
    const days = Math.max(sc?.daysUsed || 1, lastScenarioDay(data.vehicles, (sc?.constraints || constraints).startMin));
    if (sc?.constraints) setConstraints(prev => ({ ...prev, ...sc.constraints, days }));
    else setConstraints(prev => ({ ...prev, days }));
  }

  // ── Rostering integration ────────────────────────────────────
  const [schedYear, schedMonth] = (activeProject?.mes ?? "").split("-").map(Number);
  const { grid: rosterGrid, asignaciones: rosterAsign } = useRostering(orgId, schedYear || null, schedMonth || null);
  const { grid: vehicleRosterGrid } = useVehicleAvailability(orgId, schedYear || null, schedMonth || null, { live: true });
  const schedDaysInMonth = schedYear && schedMonth ? new Date(schedYear, schedMonth, 0).getDate() : 0;

  // Turnos movidos de día por Rostering → Optimizar (manda el cuadrante):
  // se escuchan en vivo y se aplican a las rutas, cada uno una sola vez.
  useEffect(() => {
    if (!activeProject?._id) return;
    return onSnapshot(doc(db, "scheduling_roster", activeProject._id), snap => {
      const d = snap.exists() ? snap.data() : {};
      setRosterMoves({ stamp: d.generatedAt || null, moves: d.moves || [] });
    }, () => {});
  }, [activeProject?._id]);

  useEffect(() => {
    if (!schedules.vehicles?.length || !activeProject?._id) return;
    if (scenarioProjectRef.current !== activeProject._id) return; // aún con el escenario de otro proyecto
    // Movimientos de otro escenario (p. ej. el anterior, mientras se guarda
    // el recién generado): no se tocan. Un escenario guardado antes de que
    // existiera la marca (stamp null) acepta los del documento actual.
    if (scenarioStampRef.current && rosterMoves.stamp !== scenarioStampRef.current) return;
    const pending = rosterMoves.moves.slice(appliedMovesRef.current);
    if (!pending.length) return;
    const next = applyShiftMoves(schedules, pending, constraints.startMin);
    appliedMovesRef.current = rosterMoves.moves.length;
    if (next !== schedules) {
      setSchedules(next);
      setMoveHistory([]); setHistoryIndex(-1);
      setConstraints(prev => ({ ...prev, days: Math.max(prev.days || 1, lastScenarioDay(next.vehicles, prev.startMin)) }));
    }
    persistedRef.current = { s: next, u: unassigneds };
    persistScenario(activeProject._id, {
      vehicles: next.vehicles, workers: next.workers, unassigned: unassigneds, rosterMode: scenarioRosterMode,
      stamp: scenarioStampRef.current, appliedMoves: appliedMovesRef.current,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterMoves, schedules, activeProject?._id, constraints.startMin, scenarioRosterMode]);

  // Cualquier otro cambio del escenario (generar, mover paradas a mano,
  // deshacer/rehacer, importar Excel) se guarda — antes los movimientos
  // manuales del Gantt se perdían al recargar.
  useEffect(() => {
    const pid = activeProject?._id;
    if (!pid || !schedules.vehicles?.length) return;
    if (scenarioProjectRef.current !== pid) return; // escenario de otro proyecto o heredado sin cargar
    if (persistedRef.current?.s === schedules && persistedRef.current?.u === unassigneds) return;
    persistedRef.current = { s: schedules, u: unassigneds };
    persistScenario(pid, {
      vehicles: schedules.vehicles, workers: schedules.workers, unassigned: unassigneds,
      rosterMode: scenarioRosterMode, stamp: scenarioStampRef.current, appliedMoves: appliedMovesRef.current,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, unassigneds]);

  // Conflictos entre el escenario ya generado y el cuadrante ACTUAL de
  // Rostering. Al generar ya se respeta el cuadrante (ver runGenerate), así
  // que esto solo salta si el cuadrante cambió después de generar, o tras
  // mover paradas a mano: un trabajador con paradas un día que está en L/B
  // (o con un turno M/T/N distinto al que se le planificó), o un vehículo
  // con ruta un día en Taller/Avería/ITV. Se mira por trabajador (sus
  // propias paradas), no por todos los vinculados al vehículo — si no,
  // salía el conductor de mañana en conflicto por las paradas del de tarde.
  const rosterConflicts = (() => {
    if (!schedules.vehicles) return [];
    const conflicts = [];
    const isStop = a => !a._break && !a._travel && !a._wait;
    const dayOf  = a => Math.floor((a._start - constraints.startMin) / 1440) + 1;

    for (const row of schedules.vehicles) {
      if (row._virtual) continue;
      const vId = row._id || row.id;
      const dayNums = new Set(row.assignments.filter(isStop).map(dayOf));
      for (const day of dayNums) {
        const code = vehicleCodeOnDay(vehicleRosterGrid, vId, day);
        if (isVehicleUnavailable(code)) {
          conflicts.push({
            name: row.nombre || row.matricula || "Vehículo",
            day, code,
            label: VEHICLE_STATUS_META[code]?.label ?? code,
          });
        }
      }
    }

    // En modo libre los conductores del Gantt son solo el vínculo fijo de la
    // ficha, no quién trabaja de verdad (eso lo decide Rostering →
    // Optimizar), así que no tiene sentido cruzarlos con el cuadrante.
    for (const w of (scenarioRosterMode === "libre" ? [] : schedules.workers || [])) {
      if (w._virtual) continue;
      const stopsByDay = {};
      for (const a of (w.assignments || []).filter(isStop)) {
        const d = dayOf(a);
        (stopsByDay[d] || (stopsByDay[d] = [])).push(a);
      }
      for (const [dayStr, stops] of Object.entries(stopsByDay)) {
        const day  = Number(dayStr);
        const code = workerCodeOnDay(rosterGrid, w._id, day);
        let label = null;
        if (isUnavailable(code)) {
          label = SHIFT_META[code]?.label ?? code;
        } else if (ROSTER_TURNO[code]) {
          const win = turnoWindow(ROSTER_TURNO[code], constraints.startMin, constraints.endMin);
          const off = (day - 1) * 1440;
          if (stops.some(a => a._start - off < win.start || a._start - off >= win.end)) {
            label = `ahora de ${SHIFT_META[code].label.toLowerCase()}`;
          }
        }
        if (label) {
          conflicts.push({ name: [w.nombre, w.apellidos].filter(Boolean).join(" "), day, code, label });
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

  // Reglas de avisos e indicadores del escenario (scenario-metrics.js)
  const reglasGantt = useMemo(() => ({ aplicar561: !constraints.sin561 }), [constraints.sin561]);
  const kpis = useMemo(() => schedules.vehicles?.length ? scenarioKpis({
    vehicles: schedules.vehicles, workers: schedules.workers || [],
    unassigned: (unassigneds.vehicles || []).length, days: activeDays,
    maxShiftMin: constraints.maxShiftMin, reglas: reglasGantt,
    costeHora: +constraints.costeHora || 0, costeKm: +constraints.costeKm || 0,
  }) : null, [schedules, unassigneds, activeDays, constraints.maxShiftMin, reglasGantt, constraints.costeHora, constraints.costeKm]);

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
    if (activeProject?._id) {
      logAuditGrouped(`sched-edit:${activeProject._id}`, { modulo: "Scheduling", accion: "Editó el escenario a mano" },
        acc => { acc.n = (acc.n || 0) + 1; if (label) acc.last = label; },
        acc => `${acc.n} cambio${acc.n === 1 ? "" : "s"} en el Gantt${acc.last ? " (último: " + acc.last + ")" : ""}`);
    }
    setMoveHistory(h => [...h.slice(0, historyIndex + 1), entry]);
    setHistoryIndex(i => i + 1);
    applyVehicleWorkerState(afterVehicles, afterWorkers);
    if (unassignedTask) {
      // Identidad por referencia, no por id: las tareas que vienen de
      // Planning solo traen _id (puntoKey), no id — comparar por .id
      // comparaba undefined === undefined y vaciaba el stack entero en vez
      // de solo la pieza colocada.
      setUnassigneds(prev => ({
        vehicles: (prev.vehicles || []).filter(t => t !== unassignedTask),
        workers:  (prev.workers  || []).filter(t => t !== unassignedTask),
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
        vehicles: (prev.vehicles || []).filter(t => t !== entry.unassignedTask),
        workers:  (prev.workers  || []).filter(t => t !== entry.unassignedTask),
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
    const pid = activeProject._id;
    const sc = activeProject.scheduling;
    let cancelled = false, unsub = null;
    cloudVRef.current = null;
    setCloudSync(null);
    setCloudMeta(null);
    idbLoad(`vrp_${pid}`).then(cached => {
      if (cancelled) return;
      const hasLocal = !!cached?.vehicles?.length;
      if (hasLocal) {
        applyScenario(pid, cached);
      } else if (sc) {
        setSchedules({ vehicles: sc.vehicleSchedule || [], workers: sc.workerSchedule || [] });
        setConstraints(prev => ({ ...prev, ...(sc.constraints || {}), days: sc.daysUsed || 1 }));
      } else {
        setSchedules({ vehicles: null, workers: null });
      }
      cloudVRef.current = cached?.cloudV || null;
      // Escenario local que nunca llegó a la nube (generado antes de este
      // cambio, o el guardado no terminó): se sube al ver la nube.
      const localPending = hasLocal && (cached.dirty || !cached.cloudV);
      let first = true;
      unsub = watchScenarioMeta(pid, meta => {
        const isFirst = first; first = false;
        if (!cancelled) setCloudMeta(meta);
        if (!meta?.v || meta.v === cloudVRef.current) {
          if (isFirst && localPending) persistScenario(pid, cached);
          return;
        }
        // Hay cambios de este navegador sin subir: al guardarlos se detecta
        // el conflicto y se pregunta (no se descarga encima)
        if (cloudPendingRef.current?.projectId === pid) return;
        // Conflicto sin resolver: no se descarga encima de lo de esta
        // persona; solo se apunta la versión nueva para "Ver su versión"
        if (cloudConflictRef.current?.projectId === pid) {
          setCloudConflict(c => (c && c.projectId === pid ? { ...c, meta } : c));
          return;
        }
        setCloudSync("loading");
        loadScenarioCloud(pid, meta).then(({ meta: m, data }) => {
          if (cancelled) return;
          cloudVRef.current = m.v;
          applyScenario(pid, data);
          idbSave(`vrp_${pid}`, { ...data, cloudV: m.v, dirty: false });
          setCloudSync("saved");
        }).catch(e => {
          console.error("scenario cloud load:", e);
          if (!cancelled) setCloudSync("error");
        });
      });
    });
    return () => {
      cancelled = true;
      unsub?.();
      if (cloudPendingRef.current) runCloudSave(); // no dejar cambios sin subir al cambiar de proyecto
    };
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
      logAudit({ modulo: "Scheduling", accion: "Importó las paradas de Planning", detalle: `${allTasks.length} paradas` });
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
    setScaleProgress(null);
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

      // Cuadrante de Rostering del mes del proyecto: cada trabajador lleva su
      // franja de ficha (_tw) y, encima, la de cada día según el cuadrante
      // (_dayWindows: M/T/N obligan, L/B no trabaja, D/G/vacío = ficha). Sin
      // mes en el proyecto no hay cuadrante que mirar y todo queda como antes.
      // Modo "libre": el cuadrante de trabajadores no se mira (se optimiza
      // después en Rostering sobre los turnos que salgan de aquí); la
      // disponibilidad de VEHÍCULOS (taller/avería/ITV) sí, en los dos modos.
      const rosterLibre = constraints.rosterMode === "libre";
      const rosterWorkers = workers.map(w => ({
        ...w,
        _tw: turnoWindow(w.turno, constraints.startMin, constraints.endMin),
        ...(schedDaysInMonth && !rosterLibre
          ? { _dayWindows: workerDayWindows(w._id, rosterGrid, schedDaysInMonth, constraints.startMin, constraints.endMin) }
          : {}),
      }));

      // Compute each vehicle's effective shift from its linked workers' union.
      // A vehicle with only a morning worker works 06–14; morning+afternoon → 06–22.
      // Vehicles with no linked workers keep their own turno. Encima, la
      // franja de cada día según el cuadrante (vehicleDayWindows). En modo
      // libre los vinculados solo dan la estructura de turnos del vehículo
      // (mañana+tarde...), no quién lo lleva cada día.
      const vehiclesForVRP = vehiclesWithDepot.map(v => {
        const linked = rosterWorkers.filter(w => w.vehiculoId === (v._id || v.id));
        const daily = schedDaysInMonth
          ? vehicleDayWindows(v._id || v.id, rosterLibre ? [] : linked, vehicleRosterGrid, schedDaysInMonth)
          : null;
        const dayFields = daily ? { _dayWindows: daily.windows, _coverDays: daily.coverDays } : {};
        if (!linked.length) return { ...v, ...dayFields };
        const wins = linked.map(w => w._tw).sort((a, b) => a.start - b.start);
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
        return { ...v, _effectiveStart: effStart, _effectiveEnd: effEnd, _shiftBreaks: shiftBreaks, ...dayFields };
      });

      // ── Step 1: Vehicle VRP ──────────────────────────────────────
      // generateScenario preserves resource order: vr.schedule[i] ↔ vehiclesForSchedule[i]
      console.time("[PERF] vrp+autoscale");
      let vr = { schedule: [], unassigned: [...tasks], daysUsed: 1 };
      let vehiclesForSchedule = vehiclesForVRP;
      let addedVehicles = [];
      if (vehiclesForVRP.length > 0) {
        vr = await generateScenarioBg(tasks, vehiclesForVRP, constraints);

        // Días máximos de escenario: si sobran paradas dentro de ese límite,
        // añade vehículos virtuales "Vehículo necesario N" hasta que quepan todas.
        if (constraints.maxDays > 0 && vr.unassigned.length > 0) {
          const scaled = await autoScaleFleetBg(tasks, vehiclesForVRP, constraints, setScaleProgress);
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

      // Conductor virtual de cobertura: un vehículo real cuyos conductores
      // están todos en L/B un día sale igualmente ese día (con su franja
      // habitual) y lo lleva un "Conductor necesario" que SOLO trabaja esos
      // días (_onlyDayWindows) — así se ve qué ausencias hay que cubrir.
      const coverWorkers = vehiclesForVRP
        .filter(v => v._coverDays?.length)
        .map(v => {
          const vid = v._id || v.id;
          const tw = { start: v._effectiveStart, end: v._effectiveEnd };
          return {
            _id: `virtual_cover_${vid}`, id: `virtual_cover_${vid}`,
            nombre: `Conductor necesario (${v.nombre || v.matricula || "vehículo"})`, apellidos: "",
            turno: "Jornada completa", rol: "conductor",
            vehiculoId: vid, _virtual: true, _onlyDayWindows: true,
            _effectiveStart: tw.start, _effectiveEnd: tw.end,
            _dayWindows: Object.fromEntries(v._coverDays.map(d => [d, { ...tw, breaks: [] }])),
          };
        });

      // Pre-compute turno window for every worker (real + virtual). Un
      // conductor virtual con jornada acotada usa esa ventana directamente
      // en vez de resolverla por turno. Los reales ya la traen (rosterWorkers).
      const workersWithTw = [...rosterWorkers, ...coverWorkers, ...virtualWorkers].map(w => w._tw ? w : ({
        ...w,
        _tw: w._effectiveStart != null
          ? { start: w._effectiveStart, end: w._effectiveEnd }
          : turnoWindow(w.turno, constraints.startMin, constraints.endMin),
      }));

      // Reparto de cada vehículo entre sus conductores — misma regla que tras
      // un movimiento manual (deriveWorkerRows), con la franja de cada día.
      const vehicleWorkerMap = {};
      for (const w of workersWithTw) {
        if (!w.vehiculoId) continue;
        (vehicleWorkerMap[w.vehiculoId] || (vehicleWorkerMap[w.vehiculoId] = [])).push(w);
      }
      const derivedById = new Map();
      for (const [vid, peers] of Object.entries(vehicleWorkerMap)) {
        const vehicleRow = vehicleSchedule.find(v => (v._id || v.id) === vid);
        if (!vehicleRow) continue;
        for (const row of deriveWorkerRows(vehicleRow, peers, constraints.startMin)) derivedById.set(row._id || row.id, row);
      }
      const workerRows = workersWithTw.map(w =>
        derivedById.get(w._id || w.id) ?? { ...w, assignments: [], totalKm: 0 });

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
      logAudit({ modulo: "Scheduling", accion: "Generó un escenario",
        detalle: `${vehicleSchedule.length} vehículos · ${vehicleSchedule.reduce((n, v) => n + v.assignments.filter(a => !a._break && !a._travel && !a._wait).length, 0)} paradas · ${vr.daysUsed} día(s) · ${vr.unassigned.length} sin asignar${rosterLibre ? " · modo libre" : ""}` });
      setScenarioRosterMode(rosterLibre ? "libre" : "cuadrante");
      const scenarioStamp = new Date().toISOString();
      scenarioStampRef.current = scenarioStamp;
      appliedMovesRef.current = 0;
      scenarioProjectRef.current = activeProject?._id ?? null;
      setMoveHistory([]); setHistoryIndex(-1); // un escenario nuevo invalida el historial de movimientos manuales
      setUnassigneds({ vehicles: vr.unassigned, workers: vr.unassigned });
      const newDays = vr.daysUsed;
      setConstraints(prev => ({ ...prev, days: newDays }));
      const usedVirtualWorkerCount = usedWorkerRows.filter(w => w._virtual && !w._onlyDayWindows).length;
      const usedCoverWorkers = usedWorkerRows.filter(w => w._onlyDayWindows);
      const coverDaysCount = usedCoverWorkers.reduce((s, w) =>
        s + new Set(w.assignments.map(a => Math.floor((a._start - constraints.startMin) / 1440))).size, 0);
      const scaleMsgs = [
        addedVehicles.length > 0
          ? `Se han añadido ${addedVehicles.length} vehículo(s) y ${usedVirtualWorkerCount} conductor(es) necesarios para encajar todas las paradas en ${constraints.maxDays} día(s).`
          : null,
        usedCoverWorkers.length > 0
          ? `${usedCoverWorkers.length} vehículo(s) salen ${coverDaysCount} día(s) con todos sus conductores en Libre/Baja según Rostering — cubiertos por "Conductor necesario".`
          : null,
      ].filter(Boolean);
      setScaleInfo(scaleMsgs.length ? scaleMsgs.join(" ") : null);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        console.log(`[PERF] pintado tras setSchedules: ${(performance.now() - t_setSchedules).toFixed(0)}ms`);
      }));

      // El escenario completo se guarda (IndexedDB + nube, scenario-store.js)
      // desde el efecto que vigila `schedules`: scenarioProjectRef ya apunta
      // a este proyecto.

      // El escenario ya está calculado y es utilizable desde aquí (Gantt,
      // mover tareas, publicar...) — lo que queda es guardar el resumen en
      // Firestore (para la tarjeta de Proyectos, el historial y Rostering),
      // y eso ya no debe tener bloqueada la pantalla de generación. Antes,
      // si la conexión a Firestore se atascaba en este último paso (pasa
      // con red floja o una pestaña que estuvo un rato en segundo plano),
      // la pantalla se quedaba en "Guardando resultado…" indefinidamente
      // aunque el guardado normalmente SÍ llegaba a completarse en el
      // servidor — al recargar, ahí estaba. Ver savingSummary más arriba.
      setGenerating(false);
      setGenPhase(null);

      // ── Guardado del resumen — en segundo plano, no bloquea la UI ──────
      (async () => {
        setSavingSummary(true);
        setSaveSummaryError(null);
        try {
          console.time("[PERF] firestore-save");
          // Auto-save summary to project (assignments excluded — too large for Firestore 1MB limit)
          if (activeProject && onProjectUpdate) {
            const totalKm    = vehicleSchedule.reduce((s, v) => s + (v.totalKm || 0), 0);
            const totalStops = vehicleSchedule.reduce((s, v) =>
              s + v.assignments.filter(a => !a._break && !a._travel && !a._wait).length, 0);
            // Vehículos y turnos usados — solo nombre/matrícula/turno (nada de
            // assignments, eso ya vive aparte en IndexedDB) para que la tarjeta
            // de Proyectos pueda listarlos sin cargar el schedule completo.
            const vehiclesUsed = vehicleSchedule.map(v => ({
              nombre: v.nombre || v.matricula || "Vehículo",
              turno:  v.turno || "",
            }));
            const turnosUsed = Array.from(new Set(vehiclesUsed.map(v => v.turno).filter(Boolean)));
            await onProjectUpdate({
              scheduling: {
                vehicleCount: vehicleSchedule.length,
                workerCount:  usedWorkerRows.length,
                constraints:  { ...constraints, days: newDays },
                daysUsed: newDays, totalKm, totalStops,
                vehicles: vehiclesUsed, turnos: turnosUsed,
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
                ...kpiHistorial(scenarioKpis({
                  vehicles: vehicleSchedule, workers: usedWorkerRows, unassigned: vr.unassigned.length, days: newDays,
                  maxShiftMin: constraints.maxShiftMin, reglas: { aplicar561: !constraints.sin561 },
                  costeHora: +constraints.costeHora || 0, costeKm: +constraints.costeKm || 0,
                })),
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
              // Resumen por trabajador+día (paradas, km, horario, vehículo) para
              // el popup de "resumen del turno" en Rostering (clic derecho en una
              // celda). Solo números pequeños, no las paradas completas — eso sí
              // superaría el límite de 1MB de Firestore con escenarios grandes.
              const dailyDetail = {};
              // En modo libre los conductores derivados por vínculo fijo no
              // significan nada (quién lleva cada turno lo decide Rostering
              // → Optimizar) — no se guardan para no pintar un plan falso.
              for (const wRow of (rosterLibre ? [] : workerRows)) {
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
              // Turnos a cubrir (día + vehículo + horario, la entrada de
              // Rostering → Optimizar) y detalle diario por trabajador van
              // troceados en partes (roster-store.js): en un solo documento
              // pasaban de 1 MB con ~100 vehículos. daysWorked ya no se
              // guarda — se deduce del detalle al leer.
              await saveScenarioRoster(activeProject._id, {
                projectId: activeProject._id,
                orgId,
                mes: activeProject.mes ?? "",   // "YYYY-MM" — schedule starts on day 1 of this month
                turnoByWorker,
                modo: rosterLibre ? "libre" : "cuadrante",
                moves: [],
                generatedAt: scenarioStamp,
              }, extractShifts(vehicleSchedule, constraints.startMin), dailyDetail);
            } catch (e) {
              // Antes se tragaba en silencio: con modo libre, sin esto
              // Rostering se queda sin turnos que optimizar sin saber por qué.
              console.error("scheduling_roster save:", e);
              setSaveSummaryError("No se pudieron guardar los turnos para Rostering: " + (e.message || e));
            }
          }
          console.timeEnd("[PERF] firestore-save");
        } catch (e) {
          console.error("post-generate save error:", e);
          setSaveSummaryError(e.message || "No se pudo guardar el resumen del proyecto");
        } finally {
          setSavingSummary(false);
        }
      })();

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

      let vr = await generateScenarioBg(tasks, simVehicles, constraints);
      let finalVehicleCount = simVehicles.length;
      if (constraints.maxDays > 0 && vr.unassigned.length > 0) {
        const scaled = await autoScaleFleetBg(tasks, simVehicles, constraints);
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

  // ── Excel export ───────────────────────────────────────────────
  async function downloadVehicleXLSX() {
    const XLSX = await loadXLSX();
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

  async function downloadCrewXLSX() {
    const XLSX = await loadXLSX();
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
    reader.onload = async ev => {
      const XLSX = await loadXLSX();
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
      // Rutas ya publicadas de este proyecto y mes (desde aquí o desde
      // Rostering): las no empezadas se sustituyen; las empezadas se
      // conservan y no se vuelven a publicar (antes se duplicaban).
      const previas = activeProject?._id ? await planesPublicados(orgId, activeProject._id, mes) : [];
      const empezadas = new Set(previas.filter(d => planEmpezado(d.data())).map(d => `${diaDelPlan(d.data())}|${d.data().vehiculoNombre || ""}`));
      const aSustituir = previas.filter(d => !planEmpezado(d.data()));
      let yaEmpezadas = 0;
      // Build all plan documents first, then write concurrently in chunks
      const docs = [];
      // Paradas que NO se publican por el cuadrante ACTUAL de Rostering
      // (vehículo en Taller/Avería/ITV, o su conductor de ese tramo en L/B)
      // — antes se descartaban en silencio; ahora se avisa antes de escribir.
      const skipped = []; // { label, day, stops }
      const unstaffed = []; // modo libre: tramos publicados sin conductor asignado en Rostering
      for (const row of vehicleSchedule) {
        const allStops = row.assignments.filter(a => !a._break && !a._travel && !a._wait);
        if (allStops.length === 0) continue;

        const byDay = {};
        for (const a of allStops) {
          const d = Math.floor((a._start - startMin) / 1440);
          if (!byDay[d]) byDay[d] = [];
          byDay[d].push(a);
        }

        // Dueño real de cada parada (el conductor de ese tramo ese día, ya
        // resuelto en schedules.workers) — antes se miraba siempre solo el
        // primer conductor vinculado al vehículo, así que la baja del de
        // tarde no se detectaba y la etiqueta decía el de mañana aunque la
        // jornada la hiciera otro.
        const vid = row._id || row.id;
        const ownerOf = new Map();
        if (scenarioRosterMode === "libre") {
          // Modo libre: el conductor de cada tramo es a quien Rostering →
          // Optimizar (o una edición manual posterior) asignó este vehículo
          // ese día en un horario que cubre la parada.
          const assigned = []; // { w, day, s, e }
          for (const w of workers) {
            for (const [day, a] of Object.entries(rosterAsign?.[w._id] || {})) {
              if (a?.v === vid) assigned.push({ w, day: Number(day), s: a.s, e: a.e });
            }
          }
          for (const a of allStops) {
            const day = Math.floor((a._start - startMin) / 1440) + 1;
            const t = a._start - (day - 1) * 1440;
            const hit = assigned.find(x => x.day === day && t >= x.s && t < x.e);
            if (hit) ownerOf.set(a, hit.w);
          }
        } else {
          for (const w of (schedules.workers || [])) {
            if (w.vehiculoId !== vid) continue;
            for (const a of (w.assignments || [])) ownerOf.set(a, w);
          }
        }
        const nameOf = w => [w.nombre, w.apellidos].filter(Boolean).join(" ");
        const vehicleLabel = row.nombre || row.matricula || "Vehículo";

        const daysList = Object.keys(byDay).map(Number).sort((a, b) => a - b);
        const totalDays = daysList.length;

        for (const d of daysList) {
          // d empieza en 0 (día 1 del escenario), el cuadrante en 1 (día
          // del mes) — antes se consultaba con d tal cual, es decir, el
          // cuadrante del día ANTERIOR.
          const calDay = d + 1;
          const vCode = vehicleCodeOnDay(vehicleRosterGrid, vid ?? "", calDay);
          if (isVehicleUnavailable(vCode)) {
            skipped.push({ label: `${vehicleLabel} (${VEHICLE_STATUS_META[vCode]?.label ?? vCode})`, day: calDay, stops: byDay[d].length });
            continue;
          }
          const stops = [];
          const offByWorker = new Map();
          for (const a of byDay[d]) {
            const owner = ownerOf.get(a);
            const code = owner && !owner._virtual ? workerCodeOnDay(rosterGrid, owner._id, calDay) : "";
            if (isUnavailable(code)) offByWorker.set(owner, code);
            else stops.push(a);
          }
          for (const [w, code] of offByWorker) {
            skipped.push({
              label: `${nameOf(w)} (${SHIFT_META[code]?.label ?? code})`, day: calDay,
              stops: byDay[d].filter(a => ownerOf.get(a) === w).length,
            });
          }
          if (!stops.length) continue;
          // Modo libre: paradas cuyo tramo no tiene conductor asignado en
          // Rostering — se publican igual (el plan es del vehículo) pero se
          // avisa, que si no nadie las haría.
          if (scenarioRosterMode === "libre" && !row._virtual) {
            const noDriver = stops.filter(a => !ownerOf.get(a)).length;
            if (noDriver) unstaffed.push({ label: vehicleLabel, day: calDay, stops: noDriver });
          }
          const drivers = [...new Set(stops.map(a => ownerOf.get(a)).filter(Boolean))];
          const conductorLabel = drivers.length ? drivers.map(nameOf).join(" / ") : vehicleLabel;
          const ubicaciones = stops.map((a, i) => taskToUbicacion(a, i));
          const recorrido = stops
            .filter(a => hasCoords(a.lat, a.lng))
            .map(a => ({ lat: +a.lat, lng: +a.lng }));
          const dayLabel = `Día ${String(d + 1).padStart(2, "0")}`;
          if (empezadas.has(`${d + 1}|${row.nombre || row.matricula || ""}`)) { yaEmpezadas++; continue; }
          const nombre = totalDays > 1
            ? `${conductorLabel} · ${dayLabel} · ${mes}`
            : `${conductorLabel} · ${mes}`;
          docs.push({
            tipo, nombre, archivo: "vrp-generado",
            turno: row.turno || "",
            conductorNombre: conductorLabel,
            vehiculoNombre: row.nombre || row.matricula || "",
            mes, diaServicio: dayLabel, diaNum: d + 1,
            ubicaciones, recorrido,
            fechaSubida: Date.now(),
            origenVRP: true, origenScheduling: true,
            conductorUid: null, // por vehículo: compartido (los conductores lo buscan así)
            // Para que Analytics (facturación) sepa de qué proyecto es el plan
            projectId: activeProject?._id || null,
            org_id: orgId,
          });
        }
      }

      if (skipped.length || unstaffed.length) {
        const fmt = list => {
          const lines = list.slice(0, 10).map(x => `• Día ${x.day}: ${x.label} — ${x.stops} parada(s)`);
          if (list.length > 10) lines.push(`• …y ${list.length - 10} más`);
          return lines.join("\n");
        };
        const total = list => list.reduce((s, x) => s + x.stops, 0);
        const parts = [];
        if (skipped.length) parts.push(`${total(skipped)} parada(s) NO se publicarán por el cuadrante actual de Rostering:\n${fmt(skipped)}`);
        if (unstaffed.length) parts.push(`${total(unstaffed)} parada(s) se publicarán SIN conductor asignado en Rostering (usa Optimizar en Rostering):\n${fmt(unstaffed)}`);
        const ok = confirm(`${parts.join("\n\n")}\n\nRegenera u optimiza para corregirlo, o acepta para publicar igualmente.`);
        if (!ok) { setPublishing(false); return; }
      }

      if (aSustituir.length && !confirm(`Ya hay ${aSustituir.length} ruta(s) publicadas de este proyecto en ${mes} que no se han empezado: se sustituirán por estas ${docs.length}.${yaEmpezadas ? ` ${yaEmpezadas} vehículo-día ya empezados se conservan y no se vuelven a publicar.` : ""}\n\n¿Publicar?`)) { setPublishing(false); return; }

      // Primero las nuevas y después se quitan las viejas: si algo falla a
      // medias puede quedar alguna repetida, pero nunca un conductor sin ruta.
      const CHUNK = 50;
      for (let i = 0; i < docs.length; i += CHUNK) {
        await Promise.all(docs.slice(i, i + CHUNK).map(d => addDoc(col, d)));
      }
      for (let i = 0; i < aSustituir.length; i += CHUNK) {
        await Promise.all(aSustituir.slice(i, i + CHUNK).map(d => deleteDoc(d.ref)));
      }

      setPublishModal(null);
      logAudit({ modulo: "Scheduling", accion: "Publicó los planes en Rutas", detalle: `${docs.length} plan(es)${aSustituir.length ? ` · sustituye ${aSustituir.length}` : ""}${yaEmpezadas ? ` · ${yaEmpezadas} ya empezados se conservan` : ""}` });
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
          {/* Progreso real del auto-escalado — sin esto, un proyecto grande
              en fase "vrp" es indistinguible de uno colgado durante los
              minutos (a veces bastantes) que tarda cada ronda. */}
          {genPhase === "vrp" && scaleProgress && (
            <div style={{ marginTop: 8, fontSize: 10.5, color: C.dim, fontFamily: "monospace", display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span style={{ color: C.blueText, fontWeight: 700 }}>
                {scaleProgress.stage === "growth" ? `Ronda ${scaleProgress.round}` : `Afinando`}
              </span>
              <span>{scaleProgress.vehicles.toLocaleString()} vehículos</span>
              <span style={{ color: scaleProgress.unassigned > 0 ? "#fbbf24" : C.green }}>
                {scaleProgress.unassigned.toLocaleString()} sin asignar
              </span>
              <span>{(scaleProgress.roundMs / 1000).toFixed(1)}s esta prueba</span>
            </div>
          )}
        </div>
      )}

      {/* Error banner */}
      {genError && !focusMode && (
        <div style={{ padding: "7px 16px", background: "rgba(248,113,113,0.08)", borderBottom: `1px solid rgba(248,113,113,0.25)`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: C.red }}>Error al generar: {genError}</span>
          <button onClick={() => setGenError(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>×</button>
        </div>
      )}

      {/* Guardado del resumen en segundo plano — no bloquea, solo informa.
          Si tarda mucho o falla (conexión atascada), el escenario ya está
          generado y usable igualmente; esto solo afecta a la tarjeta de
          Proyectos, el historial de versiones y Rostering. */}
      {savingSummary && !focusMode && (
        <div style={{ padding: "5px 16px", background: "rgba(92,155,255,0.06)", borderBottom: `1px solid rgba(92,155,255,0.18)`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ width: 10, height: 10, border: `2px solid ${C.blue}55`, borderTopColor: C.blue, borderRadius: "50%", animation: "sched-spin .7s linear infinite" }} />
          <span style={{ fontSize: 11, color: C.blueText }}>Guardando resumen del proyecto…</span>
        </div>
      )}
      {(cloudSync === "saving" || cloudSync === "loading") && !focusMode && (
        <div style={{ padding: "4px 16px", background: "rgba(92,155,255,0.05)", borderBottom: `1px solid rgba(92,155,255,0.15)`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ width: 9, height: 9, border: `2px solid ${C.blue}55`, borderTopColor: C.blue, borderRadius: "50%", animation: "sched-spin .7s linear infinite" }} />
          <span style={{ fontSize: 11, color: C.blueText }}>
            {cloudSync === "saving" ? "Guardando el escenario en la nube…" : "Cargando la última versión del escenario…"}
          </span>
        </div>
      )}
      {cloudConflict && cloudConflict.projectId === activeProject?._id && !focusMode && (
        <div style={{ padding: "8px 16px", background: "rgba(251,191,36,0.10)", borderBottom: `1px solid rgba(251,191,36,0.35)`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "#fbbf24" }}>
            {cloudConflict.meta?.savedBy?.nombre || "Otra persona"} ha guardado otra versión de este escenario mientras lo editabas. Tus cambios están a salvo en este navegador — elige con cuál te quedas.
          </span>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button onClick={takeTheirScenario} style={{ padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: font, background: C.surface2, border: `1px solid ${C.border}`, color: C.text }}>
              Ver su versión (descarta la mía)
            </button>
            <button onClick={keepMyScenario} style={{ padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: font, background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.45)", color: "#fbbf24", fontWeight: 600 }}>
              Guardar la mía encima
            </button>
          </div>
        </div>
      )}
      {cloudSync === "error" && !focusMode && (
        <div style={{ padding: "5px 16px", background: "rgba(248,113,113,0.08)", borderBottom: `1px solid rgba(248,113,113,0.25)`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: C.red }}>
            No se pudo sincronizar el escenario con la nube. Está guardado en este navegador y se volverá a subir con el próximo cambio o al recargar.
          </span>
          <button onClick={() => setCloudSync(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>×</button>
        </div>
      )}
      {saveSummaryError && !focusMode && (
        <div style={{ padding: "5px 16px", background: "rgba(248,113,113,0.08)", borderBottom: `1px solid rgba(248,113,113,0.25)`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: C.red }}>
            No se pudo guardar el resumen del proyecto ({saveSummaryError}) — el escenario generado sigue intacto, pero la tarjeta de Proyectos y Rostering pueden no reflejarlo. Prueba a recargar.
          </span>
          <button onClick={() => setSaveSummaryError(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>×</button>
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

      {/* Indicadores del escenario (con cambio respecto a la generación anterior) */}
      {schedule?.length > 0 && !focusMode && kpis && (
        <KpiBar k={kpis} base={scenarioHistory[1] || null} onConfigCostes={() => setShowC(true)} />
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
              maxShiftMin={constraints.maxShiftMin}
              reglas={reglasGantt}
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
            {/* Puntos de restauración (versiones completas guardadas en la nube) */}
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, margin: "10px 0 4px" }}>Puntos de restauración</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>
              Versiones completas del escenario a las que puedes volver. Se guarda una antes de volver a generar, antes de restaurar, antes de guardar encima de otra persona y una copia automática cada 30 min de edición (máx. 15).
              {cloudMeta?.savedAtMs ? <> Versión actual: {new Date(cloudMeta.savedAtMs).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{cloudMeta.savedBy?.nombre ? ` · ${cloudMeta.savedBy.nombre}` : ""}.</> : null}
            </div>
            {!(cloudMeta?.puntos?.length) ? (
              <div style={{ padding: "12px 0 16px", color: C.dim, fontSize: 12 }}>
                Todavía no hay puntos de restauración — aparecerán al volver a generar o tras 30 min editando.
              </div>
            ) : (
              <div style={{ marginBottom: 18, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                {cloudMeta.puntos.map(p => (
                  <div key={p.v} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ fontFamily: mono, fontSize: 11, color: C.muted, width: 95, flexShrink: 0 }}>
                      {p.savedAtMs ? new Date(p.savedAtMs).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: C.text }}>{p.motivo}</div>
                      <div style={{ fontSize: 10.5, color: C.dim }}>{p.savedBy?.nombre ? `Guardada por ${p.savedBy.nombre}` : "Autor desconocido"}{p.bytes ? ` · ${(p.bytes / 1e6).toFixed(1)} MB` : ""}</div>
                    </div>
                    <button onClick={() => restorePoint(p)} style={{ padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, fontFamily: font, background: "rgba(92,155,255,0.12)", border: `1px solid ${C.blue}55`, color: C.blueText, fontWeight: 600, flexShrink: 0 }}>
                      Restaurar
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, margin: "6px 0 4px" }}>Resumen de cada generación</div>
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
