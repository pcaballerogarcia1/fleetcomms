// Pestaña de planificación: generar, ver y publicar el escenario.
// (Separado de scheduling.jsx sin cambiar su comportamiento.)
import { collection, doc, limit, onSnapshot, query } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import { logAudit, logAuditGrouped } from "../audit.js";
import { db } from "../firebase.js";
import { useLang } from "../i18n.js";
import {
  SHIFT_META, VEHICLE_STATUS_META, isUnavailable, isVehicleUnavailable, useRostering, useVehicleAvailability,
  vehicleCodeOnDay, workerCodeOnDay,
} from "../rostering/datos.js";
import { scenarioKpis } from "../scenario-metrics.js";
import { loadScenarioCloud, watchScenarioMeta } from "../scenario-store.js";
import { applyTaskMove, turnoWindow } from "../vrp-engine.js";
import { ROSTER_TURNO, applyShiftMoves, deriveWorkerRows, lastScenarioDay, loadTasksFromLayers, spliceWorkerWindowIntoVehicle } from "./datos.js";
import { C, font, mono } from "./estilo.js";
import { GanttChart } from "./gantt.jsx";
import { KpiBar } from "./kpi-bar.jsx";
import { idbLoad, idbSave } from "./idb.js";
import { ConstraintsPanel } from "./restricciones.jsx";
import { nombreDiaEscenario } from "./frecuencias.js";
import { RESTRICCIONES_DEFECTO } from "./restricciones-defecto.js";
import {
  runCloudSave as runCloudSaveMod, takeTheirScenario as takeTheirScenarioMod, restorePoint as restorePointMod, importFromPlanning as importFromPlanningMod, runGenerate as runGenerateMod, runSimulation as runSimulationMod,
  downloadVehicleXLSX as downloadVehicleXLSXMod, downloadCrewXLSX as downloadCrewXLSXMod, handleUploadXLSX as handleUploadXLSXMod, publishToRoutes as publishToRoutesMod,
} from "./planificacion-acciones.js";
import {
  BarraHerramientas, ProgresoGeneracion, AvisosEscenario, VentanaPublicar, VentanaHistorial, VentanaSimulador,
} from "./planificacion-paneles.jsx";

// ── PLANIFICACION TAB ─────────────────────────────────────────────
export function TabPlanificacion({ vehicles, workers, activeProject, onProjectUpdate, orgId, sesion = null }) {
  const lang = useLang();
  const [tasks,        setTasks]       = useState([]);

  // Al abrir el proyecto, sus tareas (de IndexedDB para capas grandes solo
  // locales, de Firestore el resto). Esta pantalla se crea de nuevo con cada
  // proyecto (key en scheduling.jsx), así que no hay nada que vaciar antes.
  const idProyecto = activeProject?._id;
  const hayTareas = !!activeProject?.planning?.tasksCount;
  useEffect(() => {
    if (!idProyecto || !hayTareas) return;
    loadTasksFromLayers(idProyecto).then(t => setTasks(t)).catch(() => {});
  }, [idProyecto, hayTareas]);

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
  const [constraints,  setConstraints] = useState(() => ({ ...RESTRICCIONES_DEFECTO }));
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
  const [segundosGen,  setSegundosGen] = useState(0);
  const genStartRef = useRef(null);

  const GEN_PHASES = {
    vrp:     { label: constraints.optimizarAFondo ? "Calculando y mejorando rutas a fondo (hasta minuto y medio más)…" : "Calculando y mejorando rutas…", pct: 20 },
    osrm:    { label: "Calculando km reales por carretera…", pct: 55 },
    workers: { label: "Asignando trabajadores…",          pct: 78 },
  };

  // Segundos que lleva generando (0 cuando no genera)
  useEffect(() => {
    if (!generating) return;
    genStartRef.current = Date.now();
    const tic = () => setSegundosGen(Math.floor((Date.now() - genStartRef.current) / 1000));
    const t0 = setTimeout(tic, 0);
    const id = setInterval(tic, 1000);
    return () => { clearTimeout(t0); clearInterval(id); };
  }, [generating]);
  const elapsedSec = generating ? segundosGen : 0;

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

  function runCloudSave() {
    return runCloudSaveMod({ cloudPendingRef, cloudTimerRef, cloudVRef, orgId, scenarioProjectRef, sesion, setCloudConflict, setCloudSync });
  }

  // Conflicto: quedarse con la versión de la otra persona…
  function takeTheirScenario() {
    return takeTheirScenarioMod({ applyScenario, cloudConflict, cloudPendingRef, cloudTimerRef, cloudVRef, scenarioProjectRef, setCloudConflict, setCloudSync });
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
  function restorePoint(p) {
    return restorePointMod({ activeProject, applyScenario, persistScenario, scenarioProjectRef, scenarioStampRef, setCloudSync, setShowHistorial }, p);
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
    // (el historial de deshacer y la nube empiezan vacíos: la pantalla es nueva con cada proyecto)
    if (!activeProject) return;
    const pid = activeProject._id;
    const sc = activeProject.scheduling;
    let cancelled = false, unsub = null;
    cloudVRef.current = null;
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
    if (!activeProject?._id) return;
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

  function importFromPlanning() {
    return importFromPlanningMod({ activeProject, onProjectUpdate, setImporting, setTasks });
  }

  function runGenerate() {
    return runGenerateMod({ activeProject, appliedMovesRef, constraints, onProjectUpdate, orgId, rosterGrid, scenarioProjectRef, scenarioStampRef, schedDaysInMonth, setConstraints, setGenError, setGenPhase, setGenerating, setHistoryIndex, setMoveHistory, setOsrmRunning, setSaveSummaryError, setSavingSummary, setScaleInfo, setScaleProgress, setScenarioRosterMode, setSchedules, setUnassigneds, tasks, vehicleRosterGrid, vehicles, workers });
  }

  // ── Simulador "qué pasaría si" ────────────────────────────────────
  // Corre el VRP en memoria con la flota real +/- N vehículos, sin tocar
  // schedules/Firestore — solo para comparar métricas. No pasa por OSRM
  // (estimación por distancia en línea recta, más rápida) ni por el paso
  // de conductores — es una previsión de vehículos/km/días, no un
  // escenario publicable.
  function runSimulation() {
    return runSimulationMod({ activeProject, constraints, setSimError, setSimResult, setSimRunning, simDelta, tasks, vehicles, workers });
  }

  // ── Excel export ───────────────────────────────────────────────
  function downloadVehicleXLSX() {
    return downloadVehicleXLSXMod({ activeProject, schedules });
  }

  function downloadCrewXLSX() {
    return downloadCrewXLSXMod({ activeProject, schedules, vehicles });
  }

  // ── Excel import ───────────────────────────────────────────────
  const xlsxUploadRef = useRef(null);

  function handleUploadXLSX(e) {
    return handleUploadXLSXMod({ setSchedules, vehicles, workers }, e);
  }

  function publishToRoutes(tipo, mes, trabajo) {
    return publishToRoutesMod({ activeProject, constraints, orgId, rosterAsign, rosterGrid, scenarioRosterMode, schedules, setPublishModal, setPublishing, vehicleRosterGrid, workers }, tipo, mes, trabajo);
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

      <BarraHerramientas {...{ activeProject, canGenerate, canRedoMove, canUndoMove, constraints, setConstraints, downloadCrewXLSX, downloadVehicleXLSX, focusMode, generating, handleUploadXLSX, historyIndex, importFromPlanning, importing, lang, mode, moveHistory, osrmRunning, redoMove, runGenerate, schedule, schedules, setFocusMode, setMode, setPublishModal, setShowC, setShowHistorial, setShowSimulador, setSimError, setSimResult, showC, tasks, totalAssigned, totalKm, unassigned, undoMove, xlsxUploadRef }} />

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
        <div style={{ padding: "7px 16px", background: "rgba(245,158,91,0.08)", borderBottom: `1px solid rgba(245,158,91,0.2)`, fontSize: 11, color: C.orange, flexShrink: 0 }}>
          No hay vehículos ni trabajadores registrados. Añade recursos en las pestañas correspondientes.
        </div>
      )}
      {!focusMode && mode === "workers" && schedules.workers && (() => {
        const sinVehiculo = workers.filter(w => !w.vehiculoId || !vehicles.some(v => (v._id || v.id) === w.vehiculoId));
        if (!sinVehiculo.length) return null;
        const nombres = sinVehiculo.map(w => w.nombre).join(", ");
        return (
          <div style={{ padding: "5px 16px", background: "rgba(242,109,109,0.08)", borderBottom: `1px solid rgba(242,109,109,0.25)`, fontSize: 11, color: C.red, flexShrink: 0 }}>
            <strong>Sin vehículo asignado:</strong> {nombres}. Ve a Trabajadores y asigna un vehículo.
          </div>
        );
      })()}

      {/* Constraints panel */}
      {!focusMode && showC && <ConstraintsPanel c={constraints} onChange={setConstraints} orgId={orgId} onCerrar={() => setShowC(false)} />}

      <ProgresoGeneracion {...{ GEN_PHASES, elapsedSec, genPhase, generating, scaleProgress, tasks, vehicles, workers }} />

      <AvisosEscenario {...{ activeProject, cloudConflict, cloudSync, focusMode, genError, keepMyScenario, rosterConflicts, saveSummaryError, savingSummary, scaleInfo, setCloudSync, setGenError, setSaveSummaryError, setScaleInfo, takeTheirScenario }} />

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
            <span style={{ fontSize: 10.5, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600 }}>Reparto por día</span>
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
              <span style={{ fontSize: 9, color: C.blue, fontWeight: 700, fontFamily: mono }}>{nombreDiaEscenario(constraints, d)}</span>
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
          {!tasks.length
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
              nombreDia={d => nombreDiaEscenario(constraints, d)}
            />
          </div>
        </div>
      )}

      <VentanaPublicar {...{ publishModal, publishToRoutes, publishing, setPublishModal }} />

      <VentanaHistorial {...{ cloudMeta, restorePoint, scenarioHistory, setShowHistorial, showHistorial }} />

      <VentanaSimulador {...{ constraints, runSimulation, schedules, setShowSimulador, setSimDelta, showSimulador, simDelta, simError, simResult, simRunning, totalKm, unassigned, vehicles }} />
    </div>
  );
}
