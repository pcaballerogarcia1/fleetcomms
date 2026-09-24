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
  collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc,
  deleteDoc, where, writeBatch, serverTimestamp,
} from "firebase/firestore";

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
export async function saveShiftMoves(projectId, scenario, movedTo, newMoves) {
  const strip = ({ _p, ...sh }) => sh; // eslint-disable-line no-unused-vars
  const moved = sh => movedTo.has(sh.id) ? { ...sh, d: movedTo.get(sh.id) } : sh;
  const mainRef = doc(db, "scheduling_roster", projectId);
  if (!scenario.parts) {
    await setDoc(mainRef, { shifts: scenario.shifts.map(sh => strip(moved(sh))), moves: [...(scenario.moves || []), ...newMoves] }, { merge: true });
    return;
  }
  const byPart = new Map();
  for (const sh of scenario.shifts) {
    if (!byPart.has(sh._p)) byPart.set(sh._p, []);
    byPart.get(sh._p).push(sh);
  }
  for (const [partId, list] of byPart) {
    if (!list.some(sh => movedTo.has(sh.id))) continue;
    await updateDoc(doc(db, "scheduling_roster", projectId, "partes", partId), { shifts: list.map(sh => strip(moved(sh))) });
  }
  await updateDoc(mainRef, { moves: [...(scenario.moves || []), ...newMoves] });
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

// Escucha en vivo (Scheduling, solo lectura).
export function listenRosterMonth(orgId, year, month, cb) {
  const id = monthId(orgId, year, month);
  let mainData = null, workerDocs = [];
  const emit = () => cb(assembleMonth(mainData, workerDocs));
  const u1 = onSnapshot(doc(db, "rostering", id), s => { mainData = s.exists() ? s.data() : null; emit(); }, () => { mainData = null; emit(); });
  const u2 = onSnapshot(query(collection(db, "rostering", id, "trabajadores"), where("org_id", "==", orgId)),
    s => { workerDocs = s.docs.map(d => ({ id: d.id, data: d.data() })); emit(); },
    () => { workerDocs = []; emit(); });
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
  for (let i = 0; i < changed.length; i += 400) {
    const batch = writeBatch(db);
    for (const [wid, payload] of changed.slice(i, i + 400)) {
      batch.set(doc(db, "rostering", id, "trabajadores", wid), { org_id: orgId, year, month, ...payload });
    }
    await batch.commit();
  }
  for (const [wid, , json] of changed) savedRef.current[wid] = json;
  await setDoc(doc(db, "rostering", id), { org_id: orgId, year, month, formato: 2, updatedAt: serverTimestamp() });
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
