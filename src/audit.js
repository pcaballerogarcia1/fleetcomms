// ── Historial de cambios (auditoría) ─────────────────────────────────
// Cada acción importante deja una línea en  auditoria/{id}:
//   { org_id, uid, nombre, rol, modulo, accion, detalle, projectId,
//     proyecto, at (servidor), atMs (cliente, para ordenar) }
// Las fichas no se pueden modificar ni borrar (reglas de Firestore): es el
// registro de quién hizo qué y cuándo. Lo leen los usuarios de oficina de
// la organización; el superadmin, todas.
//
// Quien registra es la sesión abierta (setAuditUser, al iniciar sesión),
// así cada pantalla solo tiene que decir qué ha pasado.

import { db } from "./firebase.js";
import { addDoc, collection, onSnapshot, query, where, orderBy, limit, serverTimestamp } from "firebase/firestore";

let user = null;
let project = null;

export function setAuditUser(sesion) {
  user = sesion?.uid ? {
    uid: sesion.uid, org_id: sesion.org_id ?? null, rol: sesion.rol ?? "",
    nombre: [sesion.nombre, sesion.apellidos].filter(Boolean).join(" ") || "Usuario",
  } : null;
}
// Proyecto abierto (para que cada línea sepa a qué proyecto pertenece)
export function setAuditProject(p) {
  project = p?._id ? { id: p._id, nombre: p.nombre || "", org_id: p.org_id ?? null } : null;
}

/** Registra una acción. orgId: solo hace falta si la sesión no tiene org
 *  (superadmin trabajando en un proyecto de una organización). */
export function logAudit({ modulo, accion, detalle = "", projectId, proyecto, orgId } = {}) {
  if (!user?.uid || !accion) return Promise.resolve();
  const org = orgId ?? user.org_id ?? project?.org_id ?? null;
  if (!org) return Promise.resolve();
  const pid = projectId === undefined ? project?.id ?? null : projectId;
  return addDoc(collection(db, "auditoria"), {
    org_id: org, uid: user.uid, nombre: user.nombre, rol: user.rol,
    modulo: modulo || "", accion, detalle: String(detalle || "").slice(0, 500),
    projectId: pid, proyecto: proyecto ?? (pid && project?.id === pid ? project.nombre : null),
    at: serverTimestamp(), atMs: Date.now(),
  }).catch(e => console.warn("auditoría:", e.code || e));
}

// ── Ediciones seguidas en una sola línea ─────────────────────────────
// Pintar 30 casillas del cuadrante en un minuto no son 30 líneas: se
// acumulan por clave y se registran juntas tras 60 s sin cambios (o al
// salir de la página).
const GROUP_MS = 60_000;
const groups = new Map(); // key → { entry, acc, describe, timer }

export function logAuditGrouped(key, entry, add, describe) {
  let g = groups.get(key);
  if (!g) { g = { entry, acc: {}, describe, timer: null }; groups.set(key, g); }
  add(g.acc);
  clearTimeout(g.timer);
  g.timer = setTimeout(() => flushAuditGroup(key), GROUP_MS);
}

export function flushAuditGroup(key) {
  const g = groups.get(key);
  if (!g) return;
  clearTimeout(g.timer);
  groups.delete(key);
  const detalle = g.describe(g.acc);
  if (detalle) logAudit({ ...g.entry, detalle });
}
export function flushAllAudit() { for (const k of [...groups.keys()]) flushAuditGroup(k); }
if (typeof window !== "undefined") window.addEventListener("pagehide", flushAllAudit);

// Ayudante para casillas de cuadrantes: acc = { cells:Set, rows:Set }
export const addCells = cells => acc => {
  acc.cells ||= new Set(); acc.rows ||= new Set();
  for (const [row, day] of cells) { acc.cells.add(`${row}:${day}`); acc.rows.add(row); }
};

/** Escucha el historial visible para esta sesión (últimas `n` líneas). */
export function watchAudit(sesion, n, cb) {
  if (!sesion?.uid) return () => {};
  const base = collection(db, "auditoria");
  const q = sesion.rol === "superadmin"
    ? query(base, orderBy("atMs", "desc"), limit(n))
    : sesion.org_id
      ? query(base, where("org_id", "==", sesion.org_id), orderBy("atMs", "desc"), limit(n))
      : null;
  if (!q) return () => {};
  return onSnapshot(q,
    snap => cb(snap.docs.map(d => ({ _id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))),
    err => { console.warn("auditoría:", err.code || err); cb(null, err); });
}
