// ── Almacenamiento troceado de Rostering / turnos del escenario ──────
// Firestore no admite documentos de más de 1 MB. Dos datos crecían con el
// tamaño del cliente y lo superaban (medido: 100 vehículos × mañana+tarde ×
// 31 días ≈ 1,1 MB solo en turnos + detalle diario):
//
//   scheduling_roster/{projectId}
//     Ficha principal, pequeña: mes, modo, turnoByWorker, moves, marca de
//     generación (generatedAt) y nº de partes. Los turnos a cubrir y el
//     detalle diario por trabajador van en
//     scheduling_roster/{projectId}/partes/{marca}_{i}, cada parte < ~600 KB.
//     Las partes llevan la marca de su generación: al regenerar se escriben
//     las nuevas, luego la principal, y después se borran las viejas — quien
//     lee usa solo las partes cuya marca coincide con la de la principal, así
//     nunca mezcla dos generaciones.
//
//   rostering/{org}_{YYYY}_{MM}/trabajadores/{workerId}
//     Una ficha por trabajador y mes con su cuadrícula (grid) y sus
//     asignaciones de Optimizar. La ficha del mes queda solo con org_id,
//     year y month. Los meses guardados en el formato antiguo (todo en la
//     ficha del mes) se siguen leyendo y pasan al nuevo al guardar.

import { db } from "./firebase.js";
import {
  collection, doc, getDoc, getDocs, onSnapshot, query, setDoc,
  deleteDoc, where, writeBatch, serverTimestamp, runTransaction, deleteField, FieldPath,
} from "firebase/firestore";

// ── Varias personas editando a la vez ────────────────────────────────
// Los cuadrantes se guardan casilla a casilla (solo lo que cambia) y cada
// pantalla recibe en vivo lo que cambian los demás. Así dos personas que
// tocan casillas distintas del mismo mes nunca se pisan; si tocan la misma
// casilla, queda la última.

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Claves (días) cuyo valor difiere entre dos mapas día → valor
export function changedKeys(prev = {}, next = {}) {
  return [...new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])]
    .filter(k => !same(prev?.[k], next?.[k]));
}

// Mezcla una cuadrícula fila → día → valor recibida de Firestore (remote)
// con la local: las casillas que se han tocado aquí y aún no se han
// guardado (local ≠ base, lo último guardado/leído) se conservan; todo lo
// demás pasa a ser lo de Firestore.
export function mergeCells(local = {}, base = {}, remote = {}) {
  const out = {};
  const rows = new Set([...Object.keys(local || {}), ...Object.keys(base || {}), ...Object.keys(remote || {})]);
  for (const r of rows) {
    const L = local?.[r] || {}, B = base?.[r] || {}, R = remote?.[r] || {};
    const row = {};
    for (const c of new Set([...Object.keys(L), ...Object.keys(B), ...Object.keys(R)])) {
      const v = same(L[c], B[c]) ? R[c] : L[c];
      if (v !== undefined && v !== null && v !== "") row[c] = v;
    }
    if (Object.keys(row).length || r in (remote || {})) out[r] = row;
  }
  return out;
}

// Pares [ruta, valor] para updateDoc: un valor vacío borra el campo
const cellWrites = (prefix, prev, next) =>
  changedKeys(prev, next).flatMap(k => [new FieldPath(...prefix, k), next?.[k] ?? deleteField()]);

export const PART_MAX_BYTES = 600_000;

// Tamaño aproximado en Firestore (suficiente para no pasar de 1 MB con
// margen: JSON sobreestima los números y subestima poco lo demás).
const approxBytes = v => JSON.stringify(v).length;

// Reparte turnos y detalle diario en partes de hasta maxBytes. El detalle
// de un trabajador (todo su mes) no se parte: son unos pocos KB.
export function chunkScenario(shifts, dailyDetail, maxBytes = PART_MAX_BYTES) {
  const parts = [];
  let cur = { shifts: [], detail: {} }, bytes = 0;
  const flush = () => { if (cur.shifts.length || Object.keys(cur.detail).length) parts.push(cur); cur = { shifts: [], detail: {} }; bytes = 0; };
  for (const sh of shifts || []) {
    const b = approxBytes(sh) + 1;
    if (bytes + b > maxBytes) flush();
    cur.shifts.push(sh); bytes += b;
  }
  for (const [wid, det] of Object.entries(dailyDetail || {})) {
    const b = approxBytes(det) + wid.length + 4;
    if (bytes + b > maxBytes) flush();
    cur.detail[wid] = det; bytes += b;
  }
  flush();
  return parts;
}

// Reconstruye el objeto que usa Rostering (misma forma que el formato
// antiguo: shifts, dailyDetail, daysWorked…) a partir de principal + partes.
// Cada turno lleva _p = id de su parte, para poder reescribirla al moverlo.
export function assembleScenario(main, partDocs) {
  if (!main) return null;
  if (!main.parts) return main; // formato antiguo: todo en la principal
  const mine = partDocs
    .filter(p => p.data.stamp === main.generatedAt)
    .sort((a, b) => a.data.i - b.data.i);
  const shifts = [], dailyDetail = {}, daysWorked = {};
  for (const p of mine) {
    for (const sh of p.data.shifts || []) shifts.push({ ...sh, _p: p.id });
    for (const [wid, det] of Object.entries(p.data.detail || {})) {
      dailyDetail[wid] = det;
      daysWorked[wid] = Object.keys(det).map(Number).sort((a, b) => a - b);
    }
  }
  return { ...main, shifts, dailyDetail, daysWorked, _partsComplete: mine.length === main.parts };
}

const safeStamp = s => String(s).replace(/[^0-9A-Za-z]/g, "");

// Guarda los turnos de un escenario recién generado (Scheduling).
export async function saveScenarioRoster(projectId, main, shifts, dailyDetail) {
  const stamp = main.generatedAt;
  const partsCol = collection(db, "scheduling_roster", projectId, "partes");
  const parts = chunkScenario(shifts, dailyDetail);
  for (let i = 0; i < parts.length; i++) {
    await setDoc(doc(partsCol, `${safeStamp(stamp)}_${i}`), { stamp, i, ...parts[i] });
  }
  await setDoc(doc(db, "scheduling_roster", projectId), { ...main, parts: parts.length, formato: 2 });
  // Limpieza de generaciones anteriores (si falla, quien lee ya las ignora)
  try {
    const old = await getDocs(partsCol);
    await Promise.all(old.docs.filter(d => d.data().stamp !== stamp).map(d => deleteDoc(d.ref)));
  } catch { /* no crítico */ }
}

// Escucha principal + partes y avisa con el escenario ya montado.
export function listenScenarioRoster(projectId, cb) {
  let main, partDocs = [], gotMain = false, gotParts = false;
  const emit = () => { if (gotMain && gotParts) cb(main ? assembleScenario(main, partDocs) : null); };
  const u1 = onSnapshot(doc(db, "scheduling_roster", projectId), snap => {
    main = snap.exists() ? snap.data() : null; gotMain = true; emit();
  }, () => { main = null; gotMain = true; emit(); });
  const u2 = onSnapshot(collection(db, "scheduling_roster", projectId, "partes"), snap => {
    partDocs = snap.docs.map(d => ({ id: d.id, data: d.data() })); gotParts = true; emit();
  }, () => { partDocs = []; gotParts = true; emit(); });
  return () => { u1(); u2(); };
}

// Turnos movidos de día por Optimizar: reescribe solo las partes afectadas
// (o la principal, en formato antiguo) y añade los movimientos a la lista.
// En una transacción: se leen las partes y la lista de movimientos tal como
// están AHORA en Firestore (no la copia de esta pantalla), así dos personas
// que optimizan a la vez no se borran los movimientos la una a la otra.
export async function saveShiftMoves(projectId, scenario, movedTo, newMoves) {
  const strip = ({ _p, ...sh }) => sh; // eslint-disable-line no-unused-vars
  const moved = sh => movedTo.has(sh.id) ? { ...sh, d: movedTo.get(sh.id) } : sh;
  const mainRef = doc(db, "scheduling_roster", projectId);
  const partRef = id => doc(db, "scheduling_roster", projectId, "partes", id);
  const partIds = [...new Set((scenario.shifts || []).filter(sh => movedTo.has(sh.id) && sh._p).map(sh => sh._p))];
  await runTransaction(db, async tx => {
    const mainSnap = await tx.get(mainRef);
    const main = mainSnap.exists() ? mainSnap.data() : {};
    if (scenario.generatedAt && main.generatedAt && main.generatedAt !== scenario.generatedAt) {
      throw new Error("el escenario de Scheduling se ha vuelto a generar mientras tanto; vuelve a optimizar");
    }
    const moves = [...(main.moves || []), ...newMoves];
    if (!main.parts) {
      tx.set(mainRef, { shifts: (main.shifts || scenario.shifts || []).map(sh => strip(moved(sh))), moves }, { merge: true });
      return;
    }
    const snaps = await Promise.all(partIds.map(id => tx.get(partRef(id))));
    snaps.forEach((s, i) => {
      if (s.exists()) tx.update(partRef(partIds[i]), { shifts: (s.data().shifts || []).map(sh => strip(moved(sh))) });
    });
    tx.update(mainRef, { moves });
  });
}

// ── Cuadrante del mes ──────────────────────────────────────────────
const monthId = (orgId, year, month) => `${orgId}_${year}_${String(month).padStart(2, "0")}`;

// Mezcla formato antiguo (grid/asignaciones en la ficha del mes) con las
// fichas por trabajador (mandan éstas).
export function assembleMonth(mainData, workerDocs) {
  const grid = { ...(mainData?.grid || {}) };
  const asignaciones = { ...(mainData?.asignaciones || {}) };
  for (const w of workerDocs) {
    grid[w.id] = w.data.grid || {};
    if (w.data.asign && Object.keys(w.data.asign).length) asignaciones[w.id] = w.data.asign;
    else delete asignaciones[w.id];
  }
  return { grid, asignaciones, legacy: !!(mainData?.grid || mainData?.asignaciones) };
}

async function readMonthParts(orgId, year, month) {
  const id = monthId(orgId, year, month);
  let mainData = null, workerDocs = [];
  try { const s = await getDoc(doc(db, "rostering", id)); mainData = s.exists() ? s.data() : null; } catch { /* aún no existe */ }
  try {
    const s = await getDocs(query(collection(db, "rostering", id, "trabajadores"), where("org_id", "==", orgId)));
    workerDocs = s.docs.map(d => ({ id: d.id, data: d.data() }));
  } catch { /* aún no existe */ }
  return { mainData, workerDocs };
}

// Lectura única (página de Rostering, que edita en local).
export async function loadRosterMonth(orgId, year, month) {
  const { mainData, workerDocs } = await readMonthParts(orgId, year, month);
  return assembleMonth(mainData, workerDocs);
}

// Escucha en vivo (Scheduling y la propia pantalla de Rostering). No avisa
// hasta tener las dos lecturas (ficha del mes + fichas por trabajador): si
// no, el primer aviso podía llegar con el mes vacío.
export function listenRosterMonth(orgId, year, month, cb) {
  const id = monthId(orgId, year, month);
  let mainData = null, workerDocs = [], gotMain = false, gotWorkers = false;
  const emit = () => { if (gotMain && gotWorkers) cb(assembleMonth(mainData, workerDocs)); };
  const u1 = onSnapshot(doc(db, "rostering", id),
    s => { mainData = s.exists() ? s.data() : null; gotMain = true; emit(); },
    () => { mainData = null; gotMain = true; emit(); });
  const u2 = onSnapshot(query(collection(db, "rostering", id, "trabajadores"), where("org_id", "==", orgId)),
    s => { workerDocs = s.docs.map(d => ({ id: d.id, data: d.data() })); gotWorkers = true; emit(); },
    () => { workerDocs = []; gotWorkers = true; emit(); });
  return () => { u1(); u2(); };
}

// Guarda el cuadrante: solo los trabajadores que han cambiado desde lo
// último guardado/leído (`savedRef.current`: workerId → JSON). Si el mes
// venía en formato antiguo, se escriben todos y la ficha del mes se queda
// sin grid/asignaciones (pasa al formato nuevo).
export async function saveRosterMonth(orgId, year, month, grid, asignaciones, savedRef, { legacy = false } = {}) {
  const id = monthId(orgId, year, month);
  const ids = new Set([...Object.keys(grid || {}), ...Object.keys(asignaciones || {}), ...Object.keys(savedRef.current || {})]);
  const changed = [];
  for (const wid of ids) {
    const payload = { grid: grid?.[wid] || {}, asign: asignaciones?.[wid] || {} };
    const json = JSON.stringify(payload);
    if (!legacy && savedRef.current?.[wid] === json) continue;
    changed.push([wid, payload, json]);
  }
  // Formato antiguo: se escribe la ficha entera (migración). Si no, solo las
  // casillas que han cambiado respecto a lo último guardado/leído.
  for (let i = 0; i < changed.length; i += 200) {
    const batch = writeBatch(db);
    for (const [wid, payload] of changed.slice(i, i + 200)) {
      const ref = doc(db, "rostering", id, "trabajadores", wid);
      if (legacy) {
        batch.set(ref, { org_id: orgId, year, month, ...payload });
        continue;
      }
      // También la primera vez (trabajador sin ficha ese mes): se crea por
      // fusión y se escriben solo sus casillas — si dos personas empiezan a
      // la vez el mismo trabajador, ninguna borra lo de la otra.
      const prev = savedRef.current?.[wid] ? JSON.parse(savedRef.current[wid]) : { grid: {}, asign: {} };
      const writes = [...cellWrites(["grid"], prev.grid, payload.grid), ...cellWrites(["asign"], prev.asign, payload.asign)];
      batch.set(ref, { org_id: orgId, year, month }, { merge: true });
      if (writes.length) batch.update(ref, ...writes);
    }
    await batch.commit();
  }
  for (const [wid, , json] of changed) savedRef.current[wid] = json;
  await setDoc(doc(db, "rostering", id), { org_id: orgId, year, month, formato: 2, updatedAt: serverTimestamp() });
}

// Disponibilidad de vehículos (rostering_vehicles/{org}_{YYYY}_{MM}):
// escribe solo las casillas vehículo+día que han cambiado.
export async function saveVehicleCells(docId, orgId, year, month, prevGrid, nextGrid) {
  const writes = [];
  for (const vid of new Set([...Object.keys(prevGrid || {}), ...Object.keys(nextGrid || {})])) {
    writes.push(...cellWrites(["grid", vid], prevGrid?.[vid], nextGrid?.[vid]));
  }
  if (!writes.length) return false;
  const ref = doc(db, "rostering_vehicles", docId);
  const batch = writeBatch(db);
  batch.set(ref, { org_id: orgId, year, month, updatedAt: serverTimestamp() }, { merge: true });
  batch.update(ref, ...writes);
  await batch.commit();
  return true;
}

// Estado "ya guardado" tras leer un mes en formato nuevo (para no reescribir
// lo que no ha cambiado).
export function savedSnapshotOf(grid, asignaciones) {
  const out = {};
  for (const wid of new Set([...Object.keys(grid || {}), ...Object.keys(asignaciones || {})])) {
    out[wid] = JSON.stringify({ grid: grid?.[wid] || {}, asign: asignaciones?.[wid] || {} });
  }
  return out;
}
