// Scheduling de rutas por puntos: las acciones largas de la pantalla (generar el
// escenario, simular, Excel, publicar a Rutas, guardar en la nube). Reciben de la
// pantalla (ctx) el estado y las funciones que usan; hacen lo mismo que hacían dentro.
import { addDoc, collection, deleteDoc, doc, getDoc, serverTimestamp } from "firebase/firestore";
import { logAudit } from "../audit.js";
import { enviarAvisos, resumenEnvio } from "../avisos.js";
import { db } from "../firebase.js";
import { diaDelPlan, planDelDia, planEmpezado, planesPublicados, taskToUbicacion, trabajoParaGuardar } from "../publicar-rutas.js";
import { saveScenarioRoster } from "../roster-store.js";
import { SHIFT_META, VEHICLE_STATUS_META, isUnavailable, isVehicleUnavailable, vehicleCodeOnDay, workerCodeOnDay } from "../rostering/datos.js";
import { diaDe, rutasLargas, scenarioKpis, sinDuplicados } from "../scenario-metrics.js";
import { loadScenarioCloud, newScenarioVersion, saveScenarioCloud } from "../scenario-store.js";
import { autoScaleFleetBg, generateScenarioBg, rutaMaestraBg } from "../vrp-client.js";
import { hasCoords, minToTime, shiftCodeFromStart, turnoWindow } from "../vrp-engine.js";
import { deriveWorkerRows, extractShifts, kpiHistorial, lastScenarioDay, loadTasksFromLayers, vehicleDayWindows, workerDayWindows } from "./datos.js";
import { idbSave } from "./idb.js";
import { aplicarDescargas, capacidadDe, reservarDescargas, sinReserva } from "./capacidad.js";
import { NOMBRE_DIA } from "./frecuencias.js";
import { pagadoSimulado, ponerTrabajadoresExtra } from "./simulador.js";
import { ponerNombres } from "./nombres.js";
import { enrichWithOSRM } from "./osrm.js";
import { medirCarretera, textoCarretera } from "./carretera.js";
import { cargarVecinos } from "./vecinos-guardados.js";
import { fijarCarretera, fueraDeAutonomia } from "../vrp-engine.js";

// La librería de Excel se descarga solo cuando se usa
const loadXLSX = () => import("xlsx");


export async function runCloudSave(ctx) {
  const { cloudPendingRef, cloudTimerRef, cloudVRef, orgId, scenarioProjectRef, sesion, setCloudConflict, setCloudSync } = ctx;
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
    await saveScenarioCloud(job.projectId, orgId, job.payload, v, { baseV, savedBy, motivo: job.force ? "sobrescribir" : job.motivo, nombre: job.nombre });
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
export async function takeTheirScenario(ctx) {
  const { applyScenario, cloudConflict, cloudPendingRef, cloudTimerRef, cloudVRef, scenarioProjectRef, setCloudConflict, setCloudSync } = ctx;
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

// Restaurar un punto de restauración: pasa a ser la versión actual (y la
// que había queda a su vez como punto, por si acaso)
export async function restorePoint(ctx, p) {
  const { activeProject, applyScenario, persistScenario, scenarioProjectRef, scenarioStampRef, setCloudSync, setShowHistorial } = ctx;
  const pid = activeProject?._id;
  if (!pid || !p?.v) return;
  const cuando = p.savedAtMs ? new Date(p.savedAtMs).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  const otraGeneracion = p.stamp && scenarioStampRef.current && p.stamp !== scenarioStampRef.current;
  if (!confirm(`¿Restaurar la versión${cuando ? " del " + cuando : ""}${p.savedBy?.nombre ? " (" + p.savedBy.nombre + ")" : ""}?\n\nLa versión actual no se pierde: queda como punto de restauración.` +
    (otraGeneracion ? "\n\nOjo: es de un escenario generado antes. Cuadrante sigue con los turnos del último generado — si trabajáis con Optimizar, vuelve a generar." : ""))) return;
  setShowHistorial(false);
  setCloudSync("loading");
  try {
    const { data } = await loadScenarioCloud(pid, p);
    if (scenarioProjectRef.current !== pid && activeProject?._id !== pid) return;
    applyScenario(pid, data);
    persistScenario(pid, data, "restaurar", { nombre: p.nombre || null }); // con el nombre que tenía esa versión
    setCloudSync(null);
    logAudit({ modulo: "Scheduling", accion: "Restauró una versión anterior del escenario",
      detalle: [p.motivo, cuando, p.savedBy?.nombre].filter(Boolean).join(" · ") });
  } catch (e) {
    console.error("restore point:", e);
    setCloudSync("error");
  }
}

export async function importFromPlanning(ctx) {
  const { activeProject, onProjectUpdate, setImporting, setTasks } = ctx;
  if (!activeProject) return;
  setImporting(true);
  try {
    const allTasks = await loadTasksFromLayers(activeProject._id);

    if (allTasks.length === 0) {
      alert("No hay puntos en planning para este proyecto.\nVe a Planificación, sube el Excel y vuelve aquí a importar.");
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

export async function runGenerate(ctx) {
  const { activeProject, appliedMovesRef, constraints: constraintsProyecto, onProjectUpdate, orgId, rosterGrid, scenarioProjectRef, scenarioStampRef, schedDaysInMonth, setConstraints, setGenError, setGenPhase, setGenerating, setHistoryIndex, setMoveHistory, setOsrmRunning, setSaveSummaryError, setSavingSummary, setScaleInfo, setScaleProgress, setScenarioRosterMode, setSchedules, setUnassigneds, tasks, vehicleRosterGrid, vehicles, workers } = ctx;
  // se le añade la carretera medida de la zona al generar
  let constraints = constraintsProyecto;
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
    let plantas = []; // plantas de descarga (Planning → Depots marcados como «Planta»)
    try {
      if (activeProject?._id) {
        const snap = await getDoc(doc(db, "planning_depots", activeProject._id));
        if (snap.exists()) {
          const list = snap.data().depots ?? [];
          const depositos = list.filter(d => !d.planta);
          if (depositos.length > 0) planningDepot = { lat: +depositos[0].lat, lng: +depositos[0].lng };
          plantas = list.filter(d => d.planta && hasCoords(d.lat, d.lng)).map(d => ({ nombre: d.nombre, lat: +d.lat, lng: +d.lng }));
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
    // La ruta maestra es una semana tipo: tampoco mira el cuadrante de un mes concreto.
    const rosterLibre = constraints.rosterMode === "libre" || !!constraints.usarFrecuencias;
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
    // La carretera de la zona: el motor mide en línea recta; con el rodeo y la
    // velocidad medidos aquí, las distancias y los tiempos son de carretera
    setGenPhase("carretera");
    const puntosRed = [...tasks, ...vehiclesForVRP.map(v => ({ lat: v.depotLat, lng: v.depotLng }))];
    const medida = await medirCarretera(puntosRed);
    // y la carretera real entre paradas vecinas (guardada en este ordenador: la segunda vez, al momento)
    const vec = medida.medido ? await cargarVecinos(puntosRed, (i, n) => setScaleProgress({ texto: `Carretera real entre paradas vecinas: ${i} de ${n}`, i, n })) : null;
    setScaleProgress(null);
    const carretera = medida.medido ? { ...medida, vecinosPares: vec?.pares || 0, vecinosHuella: vec?.huella || null, vecinosCompleta: !!vec?.completa } : null; // lo que se guarda
    const carreteraMotor = carretera && vec?.pares ? { ...carretera, vecinos: vec.vecinos, tiempos: vec.tiempos, vecinosMaxKm: vec.maxKm } : carretera;
    fijarCarretera(carreteraMotor); // también aquí: la capacidad y lo que se mueve a mano usan el mismo modelo
    constraints = { ...constraints, carretera };
    const consMotor = { ...constraints, carretera: carreteraMotor }; // al motor, con la tabla (no se guarda)
    setGenPhase("vrp");
    // Capacidad del camión: cada parada reserva su parte del viaje a descargar
    const opcCapacidad = capacidadDe(constraints);
    const tasksVRP = reservarDescargas(tasks, vehiclesForVRP, plantas, opcCapacidad);
    let maestra = null;
    if (vehiclesForVRP.length > 0 && constraints.usarFrecuencias) {
      // Ruta maestra: la semana tipo con las frecuencias de cada parada y cada vehículo en su zona
      vr = await rutaMaestraBg(tasksVRP, vehiclesForVRP, consMotor);
      maestra = vr.resumen;
    } else if (vehiclesForVRP.length > 0) {
      vr = await generateScenarioBg(tasksVRP, vehiclesForVRP, consMotor);

      // Días máximos de escenario: si sobran paradas dentro de ese límite,
      // añade vehículos virtuales "Vehículo necesario N" hasta que quepan todas.
      if (constraints.maxDays > 0 && vr.unassigned.length > 0) {
        const scaled = await autoScaleFleetBg(tasksVRP, vehiclesForVRP, consMotor, setScaleProgress);
        vr = scaled.result;
        vehiclesForSchedule = scaled.resources;
        addedVehicles = scaled.resources.slice(vehiclesForVRP.length);
      }
    }
    console.timeEnd("[PERF] vrp+autoscale");
    // las que no alcanza ningún vehículo con su autonomía (ficha del vehículo), marcadas para decirlo
    if (vr.unassigned?.length && vehiclesForVRP.some(v => Number(v.autonomiaKm) > 0)) {
      vr = { ...vr, unassigned: vr.unassigned.map(t => (!t._fueraAutonomia && fueraDeAutonomia(t, vehiclesForVRP) ? { ...t, _fueraAutonomia: true } : t)) };
    }
    // (sin copias exactas de un mismo bloque: red de seguridad, ver sinDuplicados)
    const { rows: vehicleScheduleRaw, quitadas: bloquesRepetidos } = sinDuplicados(vehiclesForSchedule.map((v, i) => ({
      ...v,
      assignments: vr.schedule[i]?.assignments || [],
      totalKm:     vr.schedule[i]?.totalKm     || 0,
      shiftStart:  vr.schedule[i]?.shiftStart,
      shiftEnd:    vr.schedule[i]?.shiftEnd,
    })));
    if (bloquesRepetidos) console.warn(`[Rutas] ${bloquesRepetidos} bloques repetidos quitados`);

    // Enrich travel block km with real road distances via OSRM
    setGenPhase("osrm");
    setOsrmRunning(true);
    console.time("[PERF] osrm");
    const conCarretera = await enrichWithOSRM(vehicleScheduleRaw);
    // y, con las rutas hechas, los viajes a la planta cuando el camión se llena
    const { schedule: vehicleSchedule, resumen: descargas } = aplicarDescargas(conCarretera, plantas, opcCapacidad);
    vr = { ...vr, unassigned: vr.unassigned.map(sinReserva) };
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
    // los nombres que se dieron a mano a los vehículos y conductores del cálculo
    setSchedules({ vehicles: ponerNombres(vehicleSchedule, constraints.nombresVirtuales), workers: ponerNombres(usedWorkerRows, constraints.nombresVirtuales) });
    logAudit({ modulo: "Scheduling", accion: "Generó un escenario",
      detalle: `${vehicleSchedule.length} vehículos · ${vehicleSchedule.reduce((n, v) => n + v.assignments.filter(a => !a._break && !a._travel && !a._wait).length, 0)} paradas · ${vr.daysUsed} día(s) · ${vr.unassigned.length} sin asignar${rosterLibre ? " · modo libre" : ""}` });
    setScenarioRosterMode(rosterLibre ? "libre" : "cuadrante");
    const scenarioStamp = new Date().toISOString();
    scenarioStampRef.current = scenarioStamp;
    appliedMovesRef.current = 0;
    scenarioProjectRef.current = activeProject?._id ?? null;
    setMoveHistory([]); setHistoryIndex(-1); // un escenario nuevo invalida el historial de movimientos manuales
    setUnassigneds({ vehicles: vr.unassigned, workers: vr.unassigned });
    // los días con trabajo de verdad, aunque el motor diga menos (si no, el último no se ve)
    const newDays = Math.max(vr.daysUsed || 1, lastScenarioDay(vehicleSchedule, constraints.startMin));
    setConstraints(prev => ({ ...prev, days: newDays }));
    const usedVirtualWorkerCount = usedWorkerRows.filter(w => w._virtual && !w._onlyDayWindows).length;
    const usedCoverWorkers = usedWorkerRows.filter(w => w._onlyDayWindows);
    const coverDaysCount = usedCoverWorkers.reduce((s, w) =>
      s + new Set(w.assignments.map(a => Math.floor((a._start - constraints.startMin) / 1440))).size, 0);
    const horasMin = m => { const t = Math.round(m); return `${Math.floor(t / 60)} h${t % 60 ? ` ${t % 60} min` : ""}`; };
    // por conductor si los hay (un vehículo de 24 h con tres conductores no es una ruta de 24 h)
    const largas = rutasLargas(usedWorkerRows.some(w => w.assignments?.length) ? usedWorkerRows : vehicleSchedule, constraints.maxShiftMin > 0 ? constraints.maxShiftMin + 15 : 540);
    const scaleMsgs = [
      `Distancias y tiempos ${textoCarretera(carretera || medida)}.`,
      bloquesRepetidos ? `Se han quitado ${bloquesRepetidos} bloques repetidos (la misma parada o el mismo viaje dos veces a la misma hora).` : null,
      addedVehicles.length > 0
        ? `Se han añadido ${addedVehicles.length} vehículo(s) y ${usedVirtualWorkerCount} conductor(es) necesarios para encajar todas las paradas en ${constraints.maxDays} día(s).`
        : null,
      maestra
        ? `Ruta maestra: ${maestra.visitas} visitas a la semana de ${maestra.paradas} paradas, cada vehículo en su zona (${maestra.dias.map((d, i) => `Día ${i + 1} = ${NOMBRE_DIA[d]}`).join(", ")}).${vr.unassigned.length ? ` ${vr.unassigned.length} visita(s) no caben en su día: hacen falta más vehículos o más horas.` : ""}`
        : null,
      descargas.descargas > 0
        ? `${descargas.descargas} viaje(s) a descargar${plantas.length ? "" : " (sin plantas marcadas en Planificación: se descarga en el depósito)"}${descargas.rutasPasadas ? ` · ${descargas.rutasPasadas} ruta(s) acaban hasta ${descargas.minPasados} min más tarde de lo previsto por las descargas` : ""}.`
        : null,
      // rutas larguísimas: sin límite de turno el motor llena el día entero (06:00–22:00)
      largas.n > 0
        ? `Atención: ${largas.n} ruta(s) duran más de ${constraints.maxShiftMin > 0 ? horasMin(constraints.maxShiftMin) : "9 h"} (la más larga, ${horasMin(largas.max)}).${constraints.maxShiftMin > 0 ? "" : " No hay duración máxima de turno: ponla en Restricciones → «Duración máxima de turno» y vuelve a generar."}`
        : null,
      usedCoverWorkers.length > 0
        ? `${usedCoverWorkers.length} vehículo(s) salen ${coverDaysCount} día(s) con todos sus conductores en Libre/Baja según Cuadrante — cubiertos por "Conductor necesario".`
        : null,
    ].filter(Boolean);
    setScaleInfo(scaleMsgs.length ? scaleMsgs : null); // una línea en pantalla; el resto, al desplegar
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
            setSaveSummaryError("No se pudieron guardar los turnos para Cuadrante: " + (e.message || e));
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
export async function runSimulation(ctx) {
  const { activeProject, constraints, schedules, setSimError, setSimResult, setSimRunning, simDelta, simTrab = 0, tasks, vehicles, workers } = ctx;
  if (!tasks.length || !vehicles.length) return;
  setSimRunning(true);
  setSimError(null);
  setSimResult(null);
  try {
    let planningDepot = null;
    let plantas = [];
    try {
      if (activeProject?._id) {
        const snap = await getDoc(doc(db, "planning_depots", activeProject._id));
        if (snap.exists()) {
          const list = snap.data().depots ?? [];
          const depositos = list.filter(d => !d.planta);
          if (depositos.length > 0) planningDepot = { lat: +depositos[0].lat, lng: +depositos[0].lng };
          plantas = list.filter(d => d.planta && hasCoords(d.lat, d.lng)).map(d => ({ nombre: d.nombre, lat: +d.lat, lng: +d.lng }));
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

    // Trabajadores de más: cada uno, un segundo turno en el vehículo con menos horas
    const jornada = +constraints.personalNecesarioMaxMin || +constraints.maxShiftMin || 480;
    const extra = ponerTrabajadoresExtra(simVehicles, simTrab, jornada, constraints.startMin, constraints.endMin);
    if (simTrab > 0) simVehicles = extra.vehicles;

    // Coste: horas pagadas (de cada vehículo, de su primera salida a su última llegada) y km,
    // contado igual en el escenario actual y en el simulado para que se puedan comparar
    const costes = { costeHora: +constraints.costeHora || 0, costeKm: +constraints.costeKm || 0 };
    const actualDias = Math.max(constraints.days || 1, lastScenarioDay(schedules?.vehicles || [], constraints.startMin));
    const kAct = scenarioKpis({ vehicles: schedules?.vehicles || [], days: actualDias, ...costes });
    const actual = { pagado: kAct.pagado, coste: kAct.coste, trabajadores: workers.length };

    if (simVehicles.length === 0) {
      setSimResult({ vehicleCount: 0, unassigned: tasks.length, totalKm: 0, daysUsed: 0, actual });
      return;
    }

    // con capacidad, cada parada lleva su parte del viaje a descargar (como al generar)
    const tasksVRP = reservarDescargas(tasks, simVehicles, plantas, capacidadDe(constraints));
    let vr = await generateScenarioBg(tasksVRP, simVehicles, constraints);
    let finalVehicleCount = simVehicles.length;
    if (constraints.maxDays > 0 && vr.unassigned.length > 0) {
      const scaled = await autoScaleFleetBg(tasksVRP, simVehicles, constraints);
      vr = scaled.result;
      finalVehicleCount = scaled.resources.length;
    }
    const totalKm = vr.schedule.reduce((s, v) => s + (v.totalKm || 0), 0);
    const diasSim = Math.max(vr.daysUsed || 1, lastScenarioDay(vr.schedule, constraints.startMin));
    const kSim = scenarioKpis({ vehicles: vr.schedule, days: diasSim, ...costes });
    // los trabajadores de más se pagan enteros (ver simulador.js)
    if (extra.puestos.length) {
      kSim.pagado = pagadoSimulado(vr.schedule, extra.puestos, diasSim);
      if (kSim.coste != null) kSim.coste = (kSim.pagado / 60) * costes.costeHora + kSim.km * costes.costeKm;
    }
    setSimResult({
      vehicleCount: finalVehicleCount, unassigned: vr.unassigned.length,
      totalKm: +totalKm.toFixed(1), daysUsed: vr.daysUsed,
      pagado: kSim.pagado, coste: kSim.coste, trabajadores: workers.length + extra.puestos.length,
      puestos: extra.puestos, actual,
    });
  } catch (e) {
    console.error("Simulación error:", e);
    setSimError(e.message || "Error al simular");
  } finally {
    setSimRunning(false);
  }
}

// ── Excel export ───────────────────────────────────────────────
export async function downloadVehicleXLSX(ctx) {
  const { activeProject, schedules } = ctx;
  const XLSX = await loadXLSX();
  const vs = schedules.vehicles;
  if (!vs) return;
  const rows = [["Vehículo","Matrícula","Día","Hora inicio","Hora fin","Tipo","Nombre parada","Dirección","Barrio","Lat","Lng","Duración (min)","Km"]];
  for (const v of vs) {
    const name = v.nombre || v.matricula || v._id || "";
    const mat  = v.matricula || "";
    for (const a of v.assignments) {
      const day   = diaDe(v, a) + 1; // el de su jornada (la de noche, el día en que empieza)
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

export async function downloadCrewXLSX(ctx) {
  const { activeProject, schedules, vehicles } = ctx;
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
      const day  = diaDe(w, a) + 1;
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

export function handleUploadXLSX(ctx, e) {
  const { setSchedules, vehicles, workers } = ctx;
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

export async function publishToRoutes(ctx, tipo, mes, trabajo = "") {
  const { activeProject, constraints, orgId, rosterAsign, rosterGrid, scenarioRosterMode, schedules, setPublishModal, setPublishing, vehicleRosterGrid, workers } = ctx;
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
    const sinConductor = []; // vehículo-día sin ningún conductor real (solo «conductor necesario» o nadie): nadie lo verá en Rutas
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
        let avisado = false;
        if (scenarioRosterMode === "libre" && !row._virtual) {
          const noDriver = stops.filter(a => !ownerOf.get(a)).length;
          if (noDriver) { unstaffed.push({ label: vehicleLabel, day: calDay, stops: noDriver }); avisado = true; }
        }
        const drivers = [...new Set(stops.map(a => ownerOf.get(a)).filter(Boolean))];
        if (!avisado && !drivers.some(w => !w._virtual)) sinConductor.push({ label: vehicleLabel, day: calDay, stops: stops.length });
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
          tipo, ...trabajoParaGuardar(tipo, trabajo), nombre, archivo: "vrp-generado",
          turno: row.turno || "",
          conductorNombre: conductorLabel,
          vehiculoNombre: row.nombre || row.matricula || "",
          mes, diaServicio: dayLabel, diaNum: d + 1,
          ubicaciones, recorrido,
          // lo previsto ese día (jornada y km de la ruta), para Análisis → Realizado
          plan: planDelDia(row.assignments.filter(a => Math.floor((a._start - startMin) / 1440) === d),
            row.assignments.filter(a => a._travel && Math.floor((a._start - startMin) / 1440) === d).reduce((x, a) => x + (a.km || 0), 0)),
          fechaSubida: Date.now(),
          origenVRP: true, origenScheduling: true,
          sector: activeProject?.sector || null, // la app del conductor adapta sus palabras
          conductorUid: null, // por vehículo: compartido (los conductores lo buscan así)
          // Para que Analytics (facturación) sepa de qué proyecto es el plan
          projectId: activeProject?._id || null,
          org_id: orgId,
        });
      }
    }

    if (skipped.length || unstaffed.length || sinConductor.length) {
      const fmt = list => {
        const lines = list.slice(0, 10).map(x => `• Día ${x.day}: ${x.label} — ${x.stops} parada(s)`);
        if (list.length > 10) lines.push(`• …y ${list.length - 10} más`);
        return lines.join("\n");
      };
      const total = list => list.reduce((s, x) => s + x.stops, 0);
      const parts = [];
      if (skipped.length) parts.push(`${total(skipped)} parada(s) NO se publicarán por el cuadrante actual de Cuadrante:\n${fmt(skipped)}`);
      if (unstaffed.length) parts.push(`${total(unstaffed)} parada(s) se publicarán SIN conductor asignado en Cuadrante (usa Optimizar en Cuadrante):\n${fmt(unstaffed)}`);
      if (sinConductor.length) parts.push(`${sinConductor.length} ruta(s) (${total(sinConductor)} paradas) no tienen ningún conductor: nadie las verá en la app de conductores. Asigna conductores a los vehículos en Planificación o en Cuadrante:\n${fmt(sinConductor)}`);
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
    // aviso al móvil de los conductores (las rutas por vehículo son de todos)
    enviarAvisos(orgId, "todos", { titulo: "Rutas nuevas", cuerpo: `Ya están publicadas las rutas de ${mes}.`, url: "/rutas", etiqueta: `rutas-${mes}` })
      .then(r => console.info("[avisos]", resumenEnvio(r)), e => console.warn("[avisos] no enviados:", e));
    logAudit({ modulo: "Scheduling", accion: "Publicó los planes en Rutas", detalle: `${docs.length} plan(es)${aSustituir.length ? ` · sustituye ${aSustituir.length}` : ""}${yaEmpezadas ? ` · ${yaEmpezadas} ya empezados se conservan` : ""}` });
  } catch (e) {
    console.error("publishToRoutes error:", e);
    alert("Error al publicar: " + (e.message || e));
  }
  setPublishing(false);
}
