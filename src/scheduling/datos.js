// Tareas desde las capas de Planning y ayudas puras de turnos/ventanas.
// (Separado de scheduling.jsx sin cambiar su comportamiento.)
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase.js";
import { loadLayerMarkers } from "../layer-store.js";
import { idbGet, isJunkCoord } from "../planning.jsx";
import { isUnavailable, isVehicleUnavailable, vehicleCodeOnDay, workerCodeOnDay } from "../rostering.jsx";
import { shiftForDay, timeToMin, turnoWindow } from "../vrp-engine.js";

// ── helpers for loading tasks from planning_layers ────────────────
const BARRIO_KEYS_VRP = ["barri","barrio","barri_nom","sector","zona","zone","district",
                         "districte","municipio","area","neighbourhood","neighborhood"];
export function extractFieldVRP(fields, keys) {
  // Se llama por cada parada al importar (44.249 en MADRID): se decide una
  // sola vez por nombre de columna si es de las buscadas, en vez de pasar
  // cada nombre a minúsculas por cada parada.
  let c = _vrpKeyCache.get(keys);
  if (!c) { c = { set: new Set(keys), is: new Map() }; _vrpKeyCache.set(keys, c); }
  for (const k in fields || {}) {
    let is = c.is.get(k);
    if (is === undefined) { is = c.set.has(k.toLowerCase().trim()); c.is.set(k, is); }
    if (is && fields[k]) return String(fields[k]);
  }
  return "";
}
const _vrpKeyCache = new WeakMap();
export async function loadTasksFromLayers(projectId) {
  const snap = await getDocs(
    query(collection(db, "planning_layers"), where("projectId", "==", projectId))
  );
  const mainDocs  = snap.docs.filter(d => !d.id.match(/_c\d+$/));
  const chunkDocs = snap.docs.filter(d =>  d.id.match(/_c\d+$/));

  const assembled = await Promise.all(mainDocs.map(async d => {
    const layer = { _docId: d.id, ...d.data() };
    if (layer.cloud) {
      // Capa grande en la nube (layer-store.js): la ve cualquier navegador
      layer.markers = await loadLayerMarkers(d.id, layer.cloud).catch(() => []);
    } else if (layer.localOnly) {
      // Capa antigua, solo en el navegador que la subió
      layer.markers = await idbGet(d.id).catch(() => []);
    } else if (layer.chunked) {
      const chunks = chunkDocs
        .filter(c => c.data().layerId === layer.id)
        .sort((a, b) => a.data().chunkIndex - b.data().chunkIndex);
      layer.markers = chunks.flatMap(c => c.data().markers || []);
    }
    return layer;
  }));

  const allTasks = [];
  assembled.forEach(layer => {
    if (!layer.visible) return;
    (layer.markers || []).forEach(m => {
      const lat = parseFloat(m.lat), lng = parseFloat(m.lng);
      // Sin coordenadas o en 0,0 (filas del Excel vacías): no es una parada
      // real — antes entraba en la ruta como si estuviera en el golfo de Guinea.
      if (isJunkCoord(lat, lng)) return;
      // IDB markers are flat { lat, lng, Barrio: "X", ... }; Firestore markers nest under .campos/.fields
      const nested = m.campos || m.fields || null;
      const fields = (nested && Object.keys(nested).length > 0) ? nested : m;
      const nombre = extractFieldVRP(fields, ["nombre","name","calle","street"]) || "";
      const barrio = extractFieldVRP(fields, BARRIO_KEYS_VRP) || "";
      const puntoKey = `${lat.toFixed(5)}_${lng.toFixed(5)}`;
      allTasks.push({ _id: puntoKey, lat, lng, nombre, barrio, campos: fields, layerColor: layer.color });
    });
  });

  // Franja horaria del Timetable (Planning) → ventana horaria del VRP.
  // "Hora inicio" (un único valor) es una hora exacta obligatoria: ventana
  // de un solo instante [h, h]. "Franja horaria" es un rango [inicio, fin]
  // y manda si está puesta. Sin ninguno de los dos, la tarea sigue libre —
  // el algoritmo la coloca donde le convenga, como hasta ahora.
  try {
    const ttSnap = await getDocs(collection(db, "scheduling_projects", projectId, "timetable"));
    const byPunto = new Map(ttSnap.docs.map(d => [d.id, d.data()]));
    if (byPunto.size) {
      for (const t of allTasks) {
        const e = byPunto.get(t._id);
        if (!e) continue;
        let windowStart = null, windowEnd = null;
        if (e.franjaInicio) {
          windowStart = timeToMin(e.franjaInicio);
          windowEnd   = e.franjaFin ? timeToMin(e.franjaFin) : windowStart;
        } else if (e.horaInicio) {
          windowStart = windowEnd = timeToMin(e.horaInicio);
        }
        if (windowStart != null) { t.windowStart = windowStart; t.windowEnd = windowEnd; }
        if (e.duracion != null && t.duracion == null) t.duracion = e.duracion;
        // Nombre renombrado a mano en el Timetable (Planning) — manda sobre
        // el nombre calculado del layer original, igual que ya pasa con la
        // ventana horaria y la duración: el Timetable es quien lo edita.
        if (e.nombre) t.nombre = e.nombre;
      }
    }
  } catch { /* sin timetable — las tareas siguen sin ventana, comportamiento de siempre */ }

  // Apply default duration from project settings (set in Timetable tab)
  try {
    const settingsSnap = await getDoc(doc(db, "planning_settings", projectId));
    if (settingsSnap.exists()) {
      const defDur = settingsSnap.data().defaultDuracion;
      if (defDur != null && defDur > 0) {
        allTasks.forEach(t => { if (t.duracion == null) t.duracion = defDur; });
      }
    }
  } catch {}

  return allTasks;
}

// Reparte las assignments de UN vehículo entre los conductores vinculados a
// él, según a qué ventana (turno) pertenece cada bloque — misma regla de
// "dueño" que runGenerate (primer conductor cuya ventana contiene el inicio
// del bloque; el regreso a depósito se atribuye a quien tenga esa hora
// dentro de su ventana, o al último del día si cae justo fuera por el
// redondeo). Se usa para volver a derivar la vista de conductores después
// de un movimiento manual a nivel de vehículo, y para traducir un
// movimiento hecho a nivel de conductor al vehículo real que lo sostiene
// (turnos.jsx no tiene rutas propias, siempre son las del vehículo).
// La ventana de cada conductor es la de ESE día (shiftForDay: cuadrante de
// Rostering si lo hay, si no la de su ficha) — un conductor de baja ese día
// no es dueño de nada, y uno puesto de tarde en el cuadrante se queda con la
// tarde aunque su ficha diga mañana.
export function deriveWorkerRows(vehicleRow, peersIn, startMin) {
  const peers = [...peersIn].sort((a, b) =>
    a._tw.start !== b._tw.start ? a._tw.start - b._tw.start : (a.nombre || "").localeCompare(b.nombre || "")
  );
  const byWorker = new Map(peers.map(p => [p._id || p.id, []]));
  const onDutyCache = new Map(); // dayIdx -> [{ p, w }]
  for (const a of vehicleRow.assignments || []) {
    const dayIdx = Math.floor((a._start - startMin) / 1440);
    const tStart = a._start - dayIdx * 1440;
    let onDuty = onDutyCache.get(dayIdx);
    if (!onDuty) {
      onDuty = peers.map(p => ({ p, w: shiftForDay(p, dayIdx) })).filter(x => x.w);
      onDutyCache.set(dayIdx, onDuty);
    }
    let owner = onDuty.find(x => tStart >= x.w.start && tStart < x.w.end);
    // Regreso a depósito que se sale unos minutos de todas las ventanas
    // (redondeo): al último conductor del día como red de seguridad.
    if (!owner && a._depot_return) owner = onDuty.reduce((best, x) => !best || x.w.end > best.w.end ? x : best, null);
    if (owner) byWorker.get(owner.p._id || owner.p.id).push(a);
  }
  return peers.map(w => {
    const myAssignments = byWorker.get(w._id || w.id);
    const myKm = myAssignments.filter(a => a._travel).reduce((s, a) => s + (a.km || 0), 0);
    return { ...w, assignments: myAssignments, totalKm: myKm };
  });
}

// Turnos a cubrir de un escenario: por vehículo y día, uno por tramo entre
// relevos (breaks de su franja de ese día) que tenga alguna parada. Horario
// = del primer al último bloque del tramo (salida y vuelta a cochera
// incluidas), en minutos desde la medianoche de ese día. Claves cortas: con
// escenarios grandes (≈90 vehículos × 2 tramos × 31 días) son miles de
// objetos en un solo documento de Firestore (límite 1MB).
export function extractShifts(vehicleSchedule, startMin) {
  const out = [];
  for (const v of vehicleSchedule) {
    const vid = v._id || v.id;
    const byDay = new Map();
    for (const a of v.assignments || []) {
      const di = Math.floor((a._start - startMin) / 1440);
      if (!byDay.has(di)) byDay.set(di, []);
      byDay.get(di).push(a);
    }
    for (const [di, items] of byDay) {
      const off = di * 1440;
      const sh = shiftForDay(v, di) ?? { start: 0, end: 1440, breaks: [] };
      const bounds = sh.breaks.filter(b => b > sh.start && b < sh.end).sort((a, b) => a - b);
      const segs = bounds.map(() => []).concat([[]]);
      for (const a of items) {
        const t = a._start - off;
        segs[bounds.filter(b => b <= t).length].push(a);
      }
      for (const seg of segs) {
        const stops = seg.filter(a => !a._travel && !a._break && !a._wait);
        if (!stops.length) continue;
        const s = Math.min(...seg.map(a => a._start)) - off;
        const e = Math.max(...seg.map(a => a._end)) - off;
        out.push({
          id: `${vid}_${di + 1}_${s}`, d: di + 1, v: vid,
          vn: v.nombre || v.matricula || "Vehículo", ...(v._virtual ? { virt: true } : {}),
          s, e, st: stops.length,
          km: +seg.reduce((acc, a) => acc + (a._travel ? (a.km || 0) : 0), 0).toFixed(1),
        });
      }
    }
  }
  return out;
}

// Código del cuadrante de Rostering → franja obligatoria ese día.
export const ROSTER_TURNO = { M: "Mañana (06-14)", T: "Tarde (14-22)", N: "Noche (22-06)" };

// Franjas por día de un trabajador según el cuadrante del mes del proyecto
// (clave = día del escenario, 0 = día 1 del mes): M/T/N obligan a esa
// franja; L/B = no trabaja (null); D/G/vacío = sin entrada, la de su ficha.
export function workerDayWindows(workerId, rosterGrid, daysInMonth, startMin, endMin) {
  const out = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const code = workerCodeOnDay(rosterGrid, workerId, d);
    if (isUnavailable(code)) out[d - 1] = null;
    else if (ROSTER_TURNO[code]) out[d - 1] = { ...turnoWindow(ROSTER_TURNO[code], startMin, endMin), breaks: [] };
  }
  return out;
}

// Franjas por día de un vehículo: la unión de las de sus conductores ese
// día, con un relevo en cada fin de turno intermedio (igual que la franja
// habitual en runGenerate). Taller/Avería/ITV en Rostering → Vehículos = no
// sale (null). Si todos sus conductores están en L/B, sale igualmente con su
// franja habitual y ese día lo cubre un conductor virtual (coverDays).
export function vehicleDayWindows(vehicleId, linked, vehicleGrid, daysInMonth) {
  const windows = {}, coverDays = [];
  for (let d = 0; d < daysInMonth; d++) {
    if (vehicleGrid && isVehicleUnavailable(vehicleCodeOnDay(vehicleGrid, vehicleId, d + 1))) {
      windows[d] = null;
      continue;
    }
    if (!linked.length) continue;
    const wins = linked.map(w => shiftForDay(w, d)).filter(Boolean).sort((a, b) => a.start - b.start);
    if (!wins.length) { coverDays.push(d); continue; }
    const start = Math.min(...wins.map(w => w.start));
    const end   = Math.max(...wins.map(w => w.end));
    const breaks = [...new Set(wins.slice(0, -1).map(w => w.end))]
      .filter(b => b > start && b < end)
      .sort((a, b) => a - b);
    windows[d] = { start, end, breaks };
  }
  return { windows, coverDays };
}

// Sustituye, dentro de la lista completa de un vehículo, todo lo que cae en
// la ventana (turno) de UN conductor por su nuevo contenido ya calculado —
// así un movimiento hecho a nivel de conductor (fila más estrecha, ya
// acotada a su propio turno) se traslada al vehículo (la lista completa,
// fuente real de la ruta) sin arriesgarse a coger como vecina una parada de
// OTRO conductor del mismo vehículo.
// Aplica al escenario los turnos que Rostering → Optimizar ha movido de día
// para cumplir las reglas del cuadrante (manda el cuadrante; Scheduling
// apoya): cada movimiento traslada los bloques de ese vehículo que caen en
// el horario [s, e) del día fromDay al día toDay, mismo horario. Los
// conductores de los vehículos tocados se re-derivan. Devuelve el mismo
// objeto si no había nada que mover.
export function applyShiftMoves(schedules, moves, startMin) {
  let vehicles = schedules.vehicles || [];
  const touched = new Set();
  for (const m of moves) {
    const delta = (m.toDay - m.fromDay) * 1440;
    const off = (m.fromDay - 1) * 1440;
    vehicles = vehicles.map(v => {
      if ((v._id || v.id) !== m.v) return v;
      let changed = false;
      const assignments = (v.assignments || []).map(a => {
        const di = Math.floor((a._start - startMin) / 1440);
        const t = a._start - off;
        if (di !== m.fromDay - 1 || t < m.s || t >= m.e) return a;
        changed = true;
        return { ...a, _start: a._start + delta, _end: a._end + delta };
      });
      if (!changed) return v;
      touched.add(m.v);
      return { ...v, assignments: assignments.sort((a, b) => a._start - b._start) };
    });
  }
  if (!touched.size) return schedules;
  let workers = schedules.workers || [];
  for (const vid of touched) {
    const peers = workers.filter(w => w.vehiculoId === vid);
    if (!peers.length) continue;
    const vRow = vehicles.find(v => (v._id || v.id) === vid);
    const derived = new Map(deriveWorkerRows(vRow, peers, startMin).map(w => [w._id || w.id, w]));
    workers = workers.map(w => derived.get(w._id || w.id) ?? w);
  }
  return { vehicles, workers };
}

// Último día (1-based) con algún bloque en el escenario
export function lastScenarioDay(vehicles, startMin) {
  let max = 1;
  for (const v of vehicles || []) for (const a of v.assignments || []) {
    max = Math.max(max, Math.floor((a._start - startMin) / 1440) + 1);
  }
  return max;
}

export function spliceWorkerWindowIntoVehicle(vehicleRow, worker, dayOffset, newWorkerAssignments) {
  const win = shiftForDay(worker, Math.floor(dayOffset / 1440)) ?? worker._tw;
  const wStart = dayOffset + win.start;
  const wEnd   = dayOffset + win.end;
  const rest = (vehicleRow.assignments || []).filter(a => !(a._start >= wStart && a._start < wEnd));
  return [...rest, ...newWorkerAssignments].sort((a, b) => a._start - b._start);
}

// Indicadores que se guardan con cada generación (para comparar versiones)
export function kpiHistorial(k) {
  if (!k) return {};
  const n = v => (v == null || !isFinite(v) ? null : +(+v).toFixed(4));
  return { pvr: k.pvr, turnos: k.turnos, kmVacio: n(k.kmVacio), eficVehiculo: n(k.eficVehiculo), eficPersonal: n(k.eficPersonal), avisos: k.filasConAviso, coste: n(k.coste) };
}
