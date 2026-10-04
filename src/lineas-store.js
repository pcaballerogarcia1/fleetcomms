// ── Datos de un proyecto de "Líneas regulares" ───────────────────────
// Red (lo que sale del GTFS): comprimida y troceada como una capa de
// Planning, en planning_layers/{proyecto}_red (mismas reglas y la copia de
// proyectos la duplica sin hacer nada especial).
// Configuración que edita el planificador (tipos de vehículo por línea,
// tiempos corregidos, regulación): planning_settings/{proyecto}.lineasCfg
//   { [lineaId]: { tipos: [id], preferente: id, regulacion: min,
//                  tiempos: { "0|06-09": min, "1|16-20": min } } }

import { db } from "./firebase.js";
import { doc, setDoc, onSnapshot, serverTimestamp, deleteField, query, collection, where } from "firebase/firestore";
import { uploadLayerMarkers, loadLayerMarkers, deleteLayerPieces } from "./layer-store.js";

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
  return cloud;
}

export function watchCfg(projectId, cb) {
  return onSnapshot(doc(db, "planning_settings", projectId), s => cb(s.exists() ? s.data().lineasCfg || {} : {}), () => cb({}));
}

/** Cambia la configuración de una línea (null en un campo = quitarlo). */
export function guardarCfgLinea(projectId, lineaId, cambios) {
  const v = {};
  for (const [k, x] of Object.entries(cambios)) {
    if (k === "tiempos") v.tiempos = Object.fromEntries(Object.entries(x).map(([f, m]) => [f, m == null ? deleteField() : m]));
    else v[k] = x === null ? deleteField() : x;
  }
  return setDoc(doc(db, "planning_settings", projectId), { lineasCfg: { [lineaId]: v }, updatedAt: serverTimestamp() }, { merge: true });
}

/** Tiempo de recorrido que vale: el corregido a mano o el calculado del GTFS */
export function tiempoEfectivo(sentido, franja, cfgLinea) {
  const manual = cfgLinea?.tiempos?.[`${sentido.dir}|${franja}`];
  if (manual != null) return { min: manual, manual: true };
  const t = sentido.tiempos?.find(x => x.franja === franja);
  return { min: t?.min ?? null, manual: false, viajes: t?.viajes ?? 0 };
}

// Parámetros del Scheduling de líneas (tipo de día, líneas, límites):
// planning_settings/{proyecto}.lineasSched
export function watchSchedParams(projectId, cb) {
  return onSnapshot(doc(db, "planning_settings", projectId), s => cb(s.exists() ? s.data().lineasSched || null : null), () => cb(null));
}
export function guardarSchedParams(projectId, params) {
  return setDoc(doc(db, "planning_settings", projectId), { lineasSched: params, updatedAt: serverTimestamp() }, { merge: true });
}
