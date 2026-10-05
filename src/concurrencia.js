// ── Escribir sin pisar a otros ────────────────────────────────────────
// Firestore guarda lo último que llega. Si dos personas leen una lista (o un
// número), la cambian en su pantalla y la guardan entera, la segunda borra
// sin saberlo lo que hizo la primera. Aquí está lo necesario para evitarlo:
//
//  · parcheDe: de un documento cambiado en pantalla, solo los campos que han
//    cambiado de verdad, y las listas a las que solo se ha AÑADIDO al final
//    como arrayUnion (se suman a lo que haya en el servidor, no lo pisan).
//  · cambiarEnLista: cambia UN elemento (por id) de una lista de un
//    documento leyendo la versión del servidor dentro de una transacción. Sin
//    conexión, una transacción no puede hacerse: se guarda la lista local en
//    cola, como antes (el conductor sin cobertura tiene que poder trabajar).
//  · cambiarDocumento: leer-cambiar-guardar en una transacción.

import { runTransaction, updateDoc, arrayUnion } from "firebase/firestore";
import { db } from "./firebase.js";

const igual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Campos de `nuevo` que difieren de `orig` (sin `_id`). Una lista que solo
 * crece por el final se escribe con `union(...añadidos)`.
 */
export function parcheDe(orig = {}, nuevo = {}, union = arrayUnion) {
  const parche = {};
  for (const [k, v] of Object.entries(nuevo)) {
    if (k === "_id") continue;
    const antes = orig?.[k];
    if (igual(antes, v)) continue;
    if (Array.isArray(antes) && Array.isArray(v) && v.length > antes.length && antes.every((x, i) => igual(x, v[i]))) {
      parche[k] = union(...v.slice(antes.length));
    } else parche[k] = v;
  }
  return parche;
}

/** Aplica `cambio` al elemento `id` de la lista (puro, para la transacción y para la pantalla) */
export function aplicarEnLista(lista = [], id, cambio) {
  return lista.map(x => (x?.id === id ? cambio(x) : x));
}

const sinConexion = () => typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * Cambia el elemento `id` de `doc[campo]` sobre lo que hay en el servidor.
 * @param listaLocal la lista ya cambiada en pantalla (se guarda tal cual si no hay red)
 */
export async function cambiarEnLista(ref, campo, id, cambio, listaLocal) {
  if (!sinConexion()) {
    try {
      await runTransaction(db, async tx => {
        const s = await tx.get(ref);
        if (!s.exists()) throw Object.assign(new Error("el documento ya no existe"), { code: "not-found" });
        tx.update(ref, { [campo]: aplicarEnLista(s.data()[campo] || [], id, cambio) });
      });
      return "transaccion";
    } catch (e) {
      if (e?.code === "not-found" || e?.code === "permission-denied") throw e;
      // sin red o servidor no disponible: a la cola, como antes
    }
  }
  updateDoc(ref, { [campo]: listaLocal }).catch(e => console.error(`Guardando ${campo}:`, e));
  return "cola";
}

/** Leer-cambiar-guardar atómico. `cambio(datos)` devuelve el parche a escribir (o null para no escribir). */
export async function cambiarDocumento(ref, cambio) {
  return runTransaction(db, async tx => {
    const s = await tx.get(ref);
    const parche = cambio(s.exists() ? s.data() : null, tx);
    if (parche) tx.set(ref, parche, { merge: true });
    return parche;
  });
}
