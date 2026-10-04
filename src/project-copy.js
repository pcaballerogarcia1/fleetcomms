// ── Duplicar un proyecto ─────────────────────────────────────────────
// Copia todo lo que es del proyecto a un proyecto nuevo de la misma
// organización:
//   scheduling_projects/{id}                  ficha (nombre nuevo)
//     └ timetable/*                           horas, franjas y duraciones
//   planning_layers/{id}_{capa}(+ _cN)        capas (en línea o troceadas)
//     └ trozos/*                              puntos comprimidos (capas grandes)
//   planning_depots/{id}, planning_settings/{id}
//   precios/{id} + trozos/*                   solo si quien duplica puede leerlos (admin)
//   scheduling_scenarios/{id} + trozos/*      escenario y puntos de restauración
//   scheduling_roster/{id} + partes/*         turnos del escenario
// No se copia lo que es de la operación real o de la organización: planes
// publicados, fichajes, incidencias, historial de generaciones, cuadrantes
// de Rostering, vehículos y trabajadores (estos son de toda la organización
// y el proyecto nuevo los ve igual).

import { db } from "./firebase.js";
import {
  collection, doc, getDoc, getDocs, query, where, setDoc, writeBatch, serverTimestamp,
} from "firebase/firestore";
import { localGet, uploadLayerMarkers } from "./layer-store.js";

const BATCH = 400;

export const nuevoIdProyecto = () => `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** Nombre por defecto de la copia: "ROMA (copia)", "ROMA (copia 2)"… */
export function nombreCopia(nombre, existentes = []) {
  const base = String(nombre || "Proyecto").replace(/ \(copia(?: \d+)?\)$/, "");
  const usados = new Set(existentes.map(n => String(n).trim().toLowerCase()));
  for (let i = 1; ; i++) {
    const n = i === 1 ? `${base} (copia)` : `${base} (copia ${i})`;
    if (!usados.has(n.toLowerCase())) return n;
  }
}

/** ID de una ficha de capa en el proyecto nuevo ({proyecto}_{capa}[_cN]) */
export function idCapaNuevo(docId, srcId, dstId) {
  return docId.startsWith(`${srcId}_`) ? `${dstId}_${docId.slice(srcId.length + 1)}` : `${dstId}_${docId}`;
}

// Apunta al proyecto nuevo el campo projectId de una ficha copiada (si lo tiene)
function reasignar(data, dstId) {
  const out = { ...data };
  if ("projectId" in out) out.projectId = dstId;
  return out;
}

// Escribe [ref, data] en lotes. Los trozos (hasta ~1 MB cada uno) van de
// uno en uno: un lote no puede pasar de 10 MB en total.
async function escribir(pares, { unoAUno = false } = {}) {
  if (unoAUno) {
    for (const [ref, data] of pares) await setDoc(ref, data);
    return;
  }
  for (let i = 0; i < pares.length; i += BATCH) {
    const b = writeBatch(db);
    for (const [ref, data] of pares.slice(i, i + BATCH)) b.set(ref, data);
    await b.commit();
  }
}

async function copiarSubcoleccion(srcPath, dstPath, dstId, opts) {
  const snap = await getDocs(collection(db, ...srcPath));
  await escribir(snap.docs.map(d => [doc(db, ...dstPath, d.id), reasignar(d.data(), dstId)]), opts);
  return snap.size;
}

async function copiarFicha(col, srcId, dstId, extra = {}) {
  const s = await getDoc(doc(db, col, srcId));
  if (!s.exists()) return false;
  await setDoc(doc(db, col, dstId), { ...reasignar(s.data(), dstId), ...extra });
  return true;
}

/**
 * Duplica el proyecto `src` ({ _id, org_id, ... }) con el nombre dado.
 * Devuelve { proyecto, avisos } — `proyecto` listo para abrirlo.
 * `onPaso(texto)` informa del avance.
 */
export async function duplicarProyecto(src, nombre, { onPaso = () => {}, newId = nuevoIdProyecto() } = {}) {
  const srcId = src._id;
  const avisos = [];

  onPaso("Copiando la ficha del proyecto…");
  const ficha = await getDoc(doc(db, "scheduling_projects", srcId));
  if (!ficha.exists()) throw new Error("El proyecto original ya no existe");
  const datos = ficha.data();
  const orgId = datos.org_id || src.org_id;
  // La ficha va primero: las reglas de todo lo demás comprueban la
  // organización a través de ella
  await setDoc(doc(db, "scheduling_projects", newId), {
    ...datos, nombre, org_id: orgId, duplicadoDe: srcId,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });

  onPaso("Copiando las capas del mapa…");
  const capas = await getDocs(query(collection(db, "planning_layers"), where("projectId", "==", srcId)));
  for (const d of capas.docs) {
    const data = d.data();
    const nuevo = idCapaNuevo(d.id, srcId, newId);
    if (data.cloud) {
      // Los trozos antes que la ficha: al aparecer la ficha, el mapa los
      // descarga. Se leen por su nombre ({v}_{i}): las reglas no dejan
      // listar la subcolección (se comprueban por el projectId de cada trozo).
      const { v, n } = data.cloud;
      for (let i = 0; i < n; i++) {
        const t = await getDoc(doc(db, "planning_layers", d.id, "trozos", `${v}_${i}`));
        if (!t.exists()) throw new Error(`Falta un trozo de la capa «${data.name || d.id}» en la nube`);
        await setDoc(doc(db, "planning_layers", nuevo, "trozos", `${v}_${i}`), reasignar(t.data(), newId));
      }
      await setDoc(doc(db, "planning_layers", nuevo), reasignar(data, newId));
    } else if (data.localOnly) {
      // Capa antigua guardada solo en el navegador que la subió: se copia si
      // está en este navegador (y de paso queda en la nube)
      const markers = await localGet(d.id);
      if (Array.isArray(markers) && markers.length) {
        const cloud = await uploadLayerMarkers(nuevo, newId, markers);
        await setDoc(doc(db, "planning_layers", nuevo), { ...reasignar(data, newId), localOnly: false, cloud, totalMarkers: markers.length });
      } else {
        avisos.push(`La capa «${data.name || d.id}» solo estaba guardada en el navegador que la subió y no se ha podido copiar: súbela de nuevo en la copia.`);
      }
    } else {
      await setDoc(doc(db, "planning_layers", nuevo), reasignar(data, newId));
    }
  }

  onPaso("Copiando depósitos y horarios…");
  await copiarFicha("planning_depots", srcId, newId);
  await copiarFicha("planning_settings", srcId, newId);
  await copiarSubcoleccion(["scheduling_projects", srcId, "timetable"], ["scheduling_projects", newId, "timetable"], newId);

  onPaso("Copiando precios…");
  try {
    if (await copiarFicha("precios", srcId, newId)) {
      await copiarSubcoleccion(["precios", srcId, "trozos"], ["precios", newId, "trozos"], newId, { unoAUno: true });
    }
  } catch (e) {
    if (e?.code === "permission-denied") avisos.push("Los precios no se han copiado: solo los puede ver y copiar un administrador.");
    else throw e;
  }

  onPaso("Copiando el escenario de Scheduling…");
  // Trozos antes que la ficha (la ficha dice qué versión leer)
  await copiarSubcoleccion(["scheduling_scenarios", srcId, "trozos"], ["scheduling_scenarios", newId, "trozos"], newId, { unoAUno: true });
  await copiarFicha("scheduling_scenarios", srcId, newId);
  await copiarSubcoleccion(["scheduling_roster", srcId, "partes"], ["scheduling_roster", newId, "partes"], newId, { unoAUno: true });
  await copiarFicha("scheduling_roster", srcId, newId);

  return { proyecto: { ...datos, _id: newId, nombre, org_id: orgId, duplicadoDe: srcId }, avisos };
}
