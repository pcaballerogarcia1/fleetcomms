// ── Escenario de Scheduling en la nube ───────────────────────────────
// Antes, el escenario completo (rutas de cada vehículo y conductor, con
// todas sus paradas) solo vivía en el IndexedDB del PC que lo generaba: en
// cualquier otro navegador salía el resumen del proyecto pero no el Gantt.
//
// Ahora va a Firestore igual que las capas grandes de Planning
// (layer-store.js): comprimido con gzip y troceado en fichas de < 900 KB.
//
//   scheduling_scenarios/{projectId}               { org_id, projectId, v, n, bytes, stamp, updatedAt }
//   scheduling_scenarios/{projectId}/trozos/{v}_{i} { projectId, v, i, data: Bytes }
//
// `v` cambia en cada guardado: primero se suben los trozos nuevos, luego se
// apunta la ficha a ellos y al final se borran los de la versión anterior,
// así quien esté leyendo nunca se encuentra una versión a medias.

import { db } from "./firebase.js";
import { doc, getDoc, setDoc, deleteDoc, onSnapshot, serverTimestamp, runTransaction, Bytes } from "firebase/firestore";
import { gzip, gunzip, splitBytes, joinBytes } from "./layer-store.js";

const metaRef  = projectId => doc(db, "scheduling_scenarios", projectId);
const pieceRef = (projectId, v, i) => doc(db, "scheduling_scenarios", projectId, "trozos", `${v}_${i}`);

// Lo que se guarda del escenario (lo mismo que ya iba a IndexedDB)
export function scenarioBody(data) {
  return {
    vehicles:     data?.vehicles || [],
    workers:      data?.workers || [],
    unassigned:   data?.unassigned || null,
    rosterMode:   data?.rosterMode || "cuadrante",
    stamp:        data?.stamp || null,
    appliedMoves: data?.appliedMoves || 0,
  };
}

export const newScenarioVersion = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Otra persona guardó una versión distinta de la que se estaba editando
export class ScenarioConflictError extends Error {
  constructor(meta) { super("otra persona ha guardado este escenario"); this.conflict = true; this.meta = meta; }
}

/** Sube el escenario y devuelve la versión guardada.
 *  baseV: versión de la que partía esta edición. Si en la nube ya hay otra
 *  (alguien guardó entre medias), no se pisa: lanza ScenarioConflictError.
 *  Sin baseV (undefined) se guarda encima sin comprobar. */
export async function saveScenarioCloud(projectId, orgId, data, v = newScenarioVersion(), { baseV, savedBy } = {}) {
  const bytes  = await gzip(JSON.stringify(scenarioBody(data)));
  const pieces = splitBytes(bytes);
  await Promise.all(pieces.map((p, i) =>
    setDoc(pieceRef(projectId, v, i), { projectId, v, i, data: Bytes.fromUint8Array(p) })));
  let prev;
  try {
    prev = await runTransaction(db, async tx => {
      const s = await tx.get(metaRef(projectId));
      const cur = s.exists() ? s.data() : null;
      if (baseV !== undefined && (cur?.v ?? null) !== (baseV ?? null)) throw new ScenarioConflictError(cur);
      tx.set(metaRef(projectId), {
        org_id: orgId ?? null, projectId, v, n: pieces.length, bytes: bytes.length,
        stamp: data?.stamp || null, savedBy: savedBy || null, updatedAt: serverTimestamp(),
      });
      return cur;
    });
  } catch (e) {
    deleteScenarioPieces(projectId, { v, n: pieces.length }).catch(() => {});
    throw e;
  }
  if (prev?.v && prev.v !== v) deleteScenarioPieces(projectId, prev).catch(() => {});
  return v;
}

export async function getScenarioMeta(projectId) {
  const s = await getDoc(metaRef(projectId));
  return s.exists() ? s.data() : null;
}

/** Descarga el escenario de una versión. Si otro PC la sustituyó justo
 *  mientras se leía (faltan trozos), lo intenta una vez con la nueva. */
export async function loadScenarioCloud(projectId, meta, retry = true) {
  const snaps = await Promise.all(Array.from({ length: meta.n }, (_, i) => getDoc(pieceRef(projectId, meta.v, i))));
  if (snaps.some(s => !s.exists())) {
    const fresh = retry ? await getScenarioMeta(projectId) : null;
    if (fresh?.v && fresh.v !== meta.v) return { meta: fresh, data: (await loadScenarioCloud(projectId, fresh, false)).data };
    throw new Error("faltan trozos del escenario en la nube");
  }
  const data = JSON.parse(await gunzip(joinBytes(snaps.map(s => s.data().data.toUint8Array()))));
  return { meta, data };
}

export const watchScenarioMeta = (projectId, cb) =>
  onSnapshot(metaRef(projectId), s => cb(s.exists() ? s.data() : null), () => {});

export async function deleteScenarioPieces(projectId, meta) {
  if (!meta?.v) return;
  await Promise.all(Array.from({ length: meta.n || 0 }, (_, i) =>
    deleteDoc(pieceRef(projectId, meta.v, i)).catch(() => {})));
}
