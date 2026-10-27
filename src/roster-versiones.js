// ── Versiones del cuadrante (Cuadrante → «Versiones») ─────────────────
// Copias con nombre del cuadrante de un mes (turnos y asignaciones de cada
// trabajador) para probar cambios y volver atrás, o comparar dos cuadrantes.
//
//   rostering/{org}_{YYYY}_{MM}/versiones/{id}
//     { org_id, year, month, nombre, autor: { uid, nombre }, at, trabajadores, bytes, datos: Bytes }
//
// `datos` va comprimido (gzip): con cientos de trabajadores y las
// asignaciones de Optimizar pasaría de 1 MB sin comprimir.
import { db } from "./firebase.js";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where, Bytes } from "firebase/firestore";
import { gzip, gunzip } from "./layer-store.js";

const monthId = (orgId, year, month) => `${orgId}_${year}_${String(month).padStart(2, "0")}`;
const versionesDe = (orgId, year, month) => collection(db, "rostering", monthId(orgId, year, month), "versiones");

export const MAX_BYTES_VERSION = 900_000;

export async function guardarVersion(orgId, year, month, { nombre, grid, asign, autor }) {
  const bytes = await gzip(JSON.stringify({ grid: grid || {}, asign: asign || {} }));
  if (bytes.length > MAX_BYTES_VERSION) throw new Error("el cuadrante es demasiado grande para guardarlo como versión");
  const ref = await addDoc(versionesDe(orgId, year, month), {
    org_id: orgId, year, month, nombre: String(nombre || "").trim() || null, autor: autor || null, at: Date.now(),
    trabajadores: Object.keys(grid || {}).filter(w => Object.keys(grid[w] || {}).length).length,
    bytes: bytes.length, datos: Bytes.fromUint8Array(bytes),
  });
  return ref.id;
}

/** Escucha las versiones del mes, la más reciente primero */
export function escucharVersiones(orgId, year, month, cb) {
  if (!orgId) return () => {};
  return onSnapshot(query(versionesDe(orgId, year, month), where("org_id", "==", orgId)),
    s => cb(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.at || 0) - (a.at || 0))),
    () => cb([]));
}

/** { grid, asign } de una versión (de las que da escucharVersiones) */
export async function leerVersion(v) {
  return JSON.parse(await gunzip(v.datos.toUint8Array()));
}

export const renombrarVersion = (orgId, year, month, id, nombre) =>
  updateDoc(doc(versionesDe(orgId, year, month), id), { nombre: String(nombre || "").trim() || null });

export const borrarVersion = (orgId, year, month, id) => deleteDoc(doc(versionesDe(orgId, year, month), id));

export const nombreVersionCuadrante = v => v?.nombre || (v?.at ? `Versión del ${new Date(v.at).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "Versión sin nombre");

/**
 * Qué cambia de un cuadrante (otra) al actual: por trabajador, los días con
 * un turno distinto. @returns { celdas, porTrabajador: [{ wid, dias: [{ d, antes, ahora }] }] }
 */
export function diferenciasCuadrante(actual = {}, otra = {}) {
  const porTrabajador = [];
  let celdas = 0;
  for (const wid of new Set([...Object.keys(actual), ...Object.keys(otra)])) {
    const a = actual[wid] || {}, o = otra[wid] || {};
    const dias = [];
    for (const d of new Set([...Object.keys(a), ...Object.keys(o)])) {
      if ((a[d] || "") !== (o[d] || "")) dias.push({ d: +d, antes: o[d] || "", ahora: a[d] || "" });
    }
    if (dias.length) {
      dias.sort((x, y) => x.d - y.d);
      porTrabajador.push({ wid, dias });
      celdas += dias.length;
    }
  }
  return { celdas, porTrabajador };
}
