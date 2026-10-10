// ── Datos de un proyecto de "Líneas regulares" ───────────────────────
// Red (lo que sale del GTFS): comprimida y troceada como una capa de
// Planning, en planning_layers/{proyecto}_red (mismas reglas y la copia de
// proyectos la duplica sin hacer nada especial).
// Configuración que edita el planificador (tipos de vehículo por línea,
// tiempos corregidos, regulación): planning_settings/{proyecto}.lineasCfg
//   { [lineaId]: { tipos: [id], preferente: id, regulacion: min,
//                  tiempos: { "0|06-09": min, "1|16-20": min } } }

import { db } from "./firebase.js";
import { doc, setDoc, getDoc, updateDoc, onSnapshot, serverTimestamp, deleteField, query, collection, where } from "firebase/firestore";
import { uploadLayerMarkers, loadLayerMarkers, deleteLayerPieces } from "./layer-store.js";
import { cambiarDocumento } from "./concurrencia.js";

export const TIPOS_VEHICULO = [
  { id: "micro", nombre: "Microbús", detalle: "hasta ~25 plazas" },
  { id: "midi", nombre: "Midibús 8–10 m", detalle: "~50 plazas, calles estrechas" },
  { id: "estandar", nombre: "Estándar 12 m", detalle: "~80–100 plazas" },
  { id: "articulado", nombre: "Articulado 18 m", detalle: "~140–160 plazas" },
  { id: "electrico", nombre: "Eléctrico 12 m", detalle: "autonomía limitada: ojo con los recorridos largos" },
  { id: "interurbano", nombre: "Interurbano / autocar", detalle: "plazas sentadas, carretera" },
];

export const redDocId = projectId => `${projectId}_red`;

/** Sigue la ficha de la red y descarga sus datos cuando cambian. cb({ ficha, red, cargando, error }) */
// Con una consulta por proyecto y no leyendo la ficha directamente: las
// reglas de planning_layers miran el projectId DE LA FICHA, así que leer una
// que aún no existe da "sin permiso" y la escucha se corta para siempre
// (después de importar, la pantalla no se enteraba de la red nueva).
export function watchRed(projectId, cb) {
  let vigente = null;
  const q = query(collection(db, "planning_layers"), where("projectId", "==", projectId));
  return onSnapshot(q, async snap => {
    const d = snap.docs.find(x => x.id === redDocId(projectId));
    if (!d) { vigente = null; cb({ ficha: null, red: null, cargando: false }); return; }
    const ficha = d.data();
    if (!ficha.cloud) { cb({ ficha, red: null, cargando: false }); return; }
    vigente = ficha.cloud.v;
    cb({ ficha, red: null, cargando: true });
    try {
      const [red] = await loadLayerMarkers(redDocId(projectId), ficha.cloud);
      if (vigente === ficha.cloud.v) cb({ ficha, red, cargando: false });
    } catch (e) {
      cb({ ficha, red: null, cargando: false, error: e.message || String(e) });
    }
  }, e => cb({ ficha: null, red: null, cargando: false, error: e.message }));
}

/** Guarda una red nueva (sustituye a la anterior, que se borra después). */
export async function guardarRed(projectId, orgId, red, { archivo, anterior } = {}) {
  const id = redDocId(projectId);
  const cloud = await uploadLayerMarkers(id, projectId, [red]);
  await setDoc(doc(db, "planning_layers", id), {
    id: "red", name: archivo || "Red de líneas", type: "red_lineas", visible: true, markers: [],
    cloud, totalMarkers: red.paradas.length, totalLineas: red.lineas.length,
    agencias: red.agencias, dias: red.dias, archivo: archivo || null,
    projectId, orgId, createdAt: serverTimestamp(),
  });
  if (anterior?.v && anterior.v !== cloud.v) deleteLayerPieces(id, anterior).catch(() => {});
  await escribirResumenRed(projectId, red, archivo, cloud.v).catch(e => console.warn("resumen de la red:", e));
  return cloud;
}

// Resumen de la red en el propio proyecto (scheduling_projects.redResumen),
// para que la lista de proyectos lo enseñe sin descargar la red.
const resumenDe = (red, archivo, v) => ({
  v, archivo: archivo || null, lineas: red.lineas.length, paradas: red.paradas.length, calendarios: (red.calendarios || []).length,
});
function escribirResumenRed(projectId, red, archivo, v) {
  return updateDoc(doc(db, "scheduling_projects", projectId), { redResumen: resumenDe(red, archivo, v) });
}
/** Proyectos importados antes de existir el resumen: se rellena al abrir su Planning (una lectura). */
export async function asegurarResumenRed(projectId, ficha, red) {
  if (!ficha?.cloud?.v || !red) return;
  const p = await getDoc(doc(db, "scheduling_projects", projectId));
  if (p.exists() && p.data().redResumen?.v !== ficha.cloud.v) await escribirResumenRed(projectId, red, ficha.archivo, ficha.cloud.v);
}

export function watchCfg(projectId, cb) {
  return onSnapshot(doc(db, "planning_settings", projectId), s => cb(s.exists() ? s.data().lineasCfg || {} : {}), () => cb({}));
}

/** Cambia la configuración de una línea (null en un campo = quitarlo). */
// Qué se cambió de la línea, para el aviso del Scheduling («ha cambiado el Planning»)
const QUE_CAMBIA = { tiempos: "tiempos de recorrido", regulacion: "regulación", tipos: "tipos de vehículo", preferente: "tipo de vehículo preferente", cochera: "cochera", salidas: "horarios de salida" };
export function guardarCfgLinea(projectId, lineaId, cambios, { nombreLinea, detalle } = {}) {
  const v = {};
  for (const [k, x] of Object.entries(cambios)) {
    if (k === "tiempos" || k === "salidas") v[k] = Object.fromEntries(Object.entries(x).map(([f, m]) => [f, m == null ? deleteField() : m]));
    else v[k] = x === null ? deleteField() : x;
  }
  const que = detalle || `${[...new Set(Object.keys(cambios).map(k => QUE_CAMBIA[k] || k))].join(", ")} de la línea ${nombreLinea || lineaId}`;
  return setDoc(doc(db, "planning_settings", projectId), { lineasCfg: { [lineaId]: v }, cambioPlanning: { atMs: Date.now(), detalle: que }, updatedAt: serverTimestamp() }, { merge: true });
}

/** El último cambio del Planning de líneas: { atMs, detalle } (o null) */
export function watchCambioPlanning(projectId, cb) {
  return onSnapshot(doc(db, "planning_settings", projectId), s => cb(s.exists() ? s.data().cambioPlanning || null : null), () => cb(null));
}
export function anotarCambioPlanning(projectId, detalle) {
  return setDoc(doc(db, "planning_settings", projectId), { cambioPlanning: { atMs: Date.now(), detalle } }, { merge: true });
}

/** Tiempo de recorrido que vale: el corregido a mano o el calculado del GTFS */
export function tiempoEfectivo(sentido, franja, cfgLinea) {
  const manual = cfgLinea?.tiempos?.[`${sentido.dir}|${franja}`];
  if (manual != null) return { min: manual, manual: true };
  const t = sentido.tiempos?.find(x => x.franja === franja);
  return { min: t?.min ?? null, manual: false, viajes: t?.viajes ?? 0 };
}

// Cocheras: el mismo documento que los depots del Planning de puntos
// (planning_depots/{proyecto}.depots = [{ id, nombre, lat, lng }]), que ya
// copia el duplicado de proyectos. Cada línea puede fijar la suya en
// lineasCfg[línea].cochera; si no, el Scheduling usa la más cercana.
export function watchCocheras(projectId, cb) {
  return onSnapshot(doc(db, "planning_depots", projectId), s => cb(s.exists() ? s.data().depots || [] : []), () => cb([]));
}
// Cambio sobre la lista del servidor (transacción): dos personas añadiendo o
// moviendo cocheras a la vez no se pisan. `cambio(lista)` devuelve la nueva.
export function cambiarCocheras(projectId, orgId, cambio) {
  return cambiarDocumento(doc(db, "planning_depots", projectId), datos => ({
    depots: cambio(datos?.depots || []), projectId, orgId: orgId || datos?.orgId || null, updatedAt: serverTimestamp(),
  }));
}

// Parámetros del Scheduling de líneas (tipo de día, líneas, límites):
// planning_settings/{proyecto}.lineasSched
export function watchSchedParams(projectId, cb) {
  return onSnapshot(doc(db, "planning_settings", projectId), s => cb(s.exists() ? s.data().lineasSched || null : null), () => cb(null));
}
export function guardarSchedParams(projectId, params) {
  return setDoc(doc(db, "planning_settings", projectId), { lineasSched: params, updatedAt: serverTimestamp() }, { merge: true });
}

/**
 * Cambios a mano de un calendario, sobre la lista del servidor (transacción):
 * si otra persona ha movido piezas del mismo calendario a la vez, su cambio
 * no se pierde. `cambio(lista)` devuelve la lista nueva; `extra` se guarda
 * junto (resumen, claves…). Devuelve { antes, despues }.
 */
export async function cambiarManuales(projectId, dia, cambio, extra = {}) {
  let antes = [], despues = [];
  await cambiarDocumento(doc(db, "planning_settings", projectId), datos => {
    antes = datos?.lineasSched?.porCalendario?.[dia]?.manuales || [];
    despues = cambio(antes);
    return { lineasSched: { porCalendario: { [dia]: { ...extra, manuales: despues } } }, updatedAt: serverTimestamp() };
  });
  return { antes, despues };
}
