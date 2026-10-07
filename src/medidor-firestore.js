// ── Medidor de lecturas y escrituras de Firestore ─────────────────────
// Solo en la compilación de medida (MEDIR=1, ver vite.config.js y e2e/):
// sustituye a "firebase/firestore" y anota, por pantalla (ruta de la URL) y
// por colección, los documentos que llegan DEL SERVIDOR (lo que Firestore
// cobra como lecturas) y las escrituras. Nunca entra en producción.
//
// Es una aproximación: un listener cuenta los documentos de su primera
// respuesta y después cada documento que cambia; las lecturas que hacen las
// reglas con get() (una o dos por petición) se cuentan aparte, como
// «peticiones», para estimarlas.

import * as F from "@firebase/firestore";
export * from "@firebase/firestore";

const uso = (globalThis.__firestoreUso = globalThis.__firestoreUso || { lecturas: {}, escrituras: {}, peticiones: {} });
const pantalla = () => (typeof location !== "undefined" ? location.pathname : "?");
// "planes/abc/trozos/x" → "planes/*/trozos"
function coleccion(ref) {
  let p = "?";
  try { p = ref?.path ?? ref?._query?.path?.canonicalString?.() ?? ref?._path?.canonicalString?.() ?? "?"; } catch { /* sin ruta */ }
  const partes = String(p).split("/");
  return partes.filter((_, i) => i % 2 === 0).join("/*/") || "?";
}
function anotar(tipo, col, n = 1) {
  const clave = `${pantalla()} · ${col}`;
  uso[tipo][clave] = (uso[tipo][clave] || 0) + n;
}
const delServidor = snap => !snap?.metadata?.fromCache;

export function onSnapshot(ref, ...args) {
  const col = coleccion(ref);
  anotar("peticiones", col);
  const i = args.findIndex(a => typeof a === "function" || (a && typeof a.next === "function"));
  if (i >= 0) {
    const orig = args[i];
    const llamar = typeof orig === "function" ? orig : orig.next.bind(orig);
    const envuelta = snap => {
      if (delServidor(snap)) anotar("lecturas", col, typeof snap.docChanges === "function" ? Math.max(1, snap.docChanges().length) : 1);
      return llamar(snap);
    };
    args[i] = typeof orig === "function" ? envuelta : { ...orig, next: envuelta };
  }
  return F.onSnapshot(ref, ...args);
}
export async function getDocs(q) {
  anotar("peticiones", coleccion(q));
  const s = await F.getDocs(q);
  if (delServidor(s)) anotar("lecturas", coleccion(q), Math.max(1, s.size));
  return s;
}
export async function getDoc(ref) {
  anotar("peticiones", coleccion(ref));
  const s = await F.getDoc(ref);
  if (delServidor(s)) anotar("lecturas", coleccion(ref));
  return s;
}
export async function getDocFromServer(ref) {
  anotar("peticiones", coleccion(ref));
  anotar("lecturas", coleccion(ref));
  return F.getDocFromServer(ref);
}
const escritura = nombre => (ref, ...args) => { anotar("escrituras", coleccion(ref)); anotar("peticiones", coleccion(ref)); return F[nombre](ref, ...args); };
export const setDoc = escritura("setDoc");
export const updateDoc = escritura("updateDoc");
export const deleteDoc = escritura("deleteDoc");
export const addDoc = escritura("addDoc");

export function writeBatch(db) {
  const b = F.writeBatch(db);
  const contar = op => (ref, ...a) => { anotar("escrituras", coleccion(ref)); return b[op](ref, ...a); };
  return { set: contar("set"), update: contar("update"), delete: contar("delete"), commit: () => { anotar("peticiones", "lote"); return b.commit(); } };
}
export function runTransaction(db, fn, opts) {
  anotar("peticiones", "transaccion");
  return F.runTransaction(db, tx => {
    const w = {
      get: async ref => { const s = await tx.get(ref); anotar("lecturas", coleccion(ref)); return s; },
      set: (ref, ...a) => { anotar("escrituras", coleccion(ref)); tx.set(ref, ...a); return w; },
      update: (ref, ...a) => { anotar("escrituras", coleccion(ref)); tx.update(ref, ...a); return w; },
      delete: ref => { anotar("escrituras", coleccion(ref)); tx.delete(ref); return w; },
    };
    return fn(w);
  }, opts);
}

/** Para las pruebas: lo anotado hasta ahora (y vaciar) */
globalThis.__firestoreUsoTomar = () => { const r = JSON.parse(JSON.stringify(uso)); uso.lecturas = {}; uso.escrituras = {}; uso.peticiones = {}; return r; };
