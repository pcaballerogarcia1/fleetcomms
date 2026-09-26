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

// ── Puntos de restauración ───────────────────────────────────────────
// Cada guardado sustituye a la versión anterior, pero algunas se conservan
// (hasta MAX_PUNTOS, en meta.puntos) para poder volver a ellas:
//   · la que había antes de volver a generar el escenario,
//   · la que había antes de restaurar otra,
//   · la de otra persona antes de guardar la mía encima,
//   · y una copia automática cada 30 min de edición.
export const MAX_PUNTOS = 15;
export const AUTO_PUNTO_MS = 30 * 60_000;

/** Decide si la versión actual (cur) se conserva al guardar la nueva. */
export function motivoPunto(cur, nextStamp, motivo, now = Date.now()) {
  if (!cur?.v) return null;
  if (motivo === "restaurar") return "Antes de restaurar una versión anterior";
  if (motivo === "sobrescribir") return `Versión de ${cur.savedBy?.nombre || "otra persona"} antes de guardar otra encima`;
  if ((cur.stamp || null) !== (nextStamp || null)) return "Antes de volver a generar el escenario";
  // Los 30 min cuentan desde el último punto (o desde que existe el escenario)
  if (now - (cur.puntoRefMs ?? now) >= AUTO_PUNTO_MS) return "Copia automática";
  return null;
}

/** Sube el escenario y devuelve la versión guardada.
 *  baseV: versión de la que partía esta edición. Si en la nube ya hay otra
 *  (alguien guardó entre medias), no se pisa: lanza ScenarioConflictError.
 *  Sin baseV (undefined) se guarda encima sin comprobar.
 *  motivo: "restaurar" | "sobrescribir" | undefined (puntos de restauración). */
export async function saveScenarioCloud(projectId, orgId, data, v = newScenarioVersion(), { baseV, savedBy, motivo } = {}) {
  const bytes  = await gzip(JSON.stringify(scenarioBody(data)));
  const pieces = splitBytes(bytes);
  await Promise.all(pieces.map((p, i) =>
    setDoc(pieceRef(projectId, v, i), { projectId, v, i, data: Bytes.fromUint8Array(p) })));
  let borrar;
  try {
    borrar = await runTransaction(db, async tx => {
      const s = await tx.get(metaRef(projectId));
      const cur = s.exists() ? s.data() : null;
      if (baseV !== undefined && (cur?.v ?? null) !== (baseV ?? null)) throw new ScenarioConflictError(cur);
      const now = Date.now();
      let puntos = cur?.puntos || [];
      const quitar = [];
      const razon = motivoPunto(cur, data?.stamp, motivo, now);
      if (razon) {
        puntos = [{ v: cur.v, n: cur.n, bytes: cur.bytes || 0, stamp: cur.stamp || null,
          savedBy: cur.savedBy || null, savedAtMs: cur.savedAtMs || null, at: now, motivo: razon }, ...puntos];
        quitar.push(...puntos.slice(MAX_PUNTOS));
        puntos = puntos.slice(0, MAX_PUNTOS);
      } else if (cur?.v && cur.v !== v && !puntos.some(p => p.v === cur.v)) {
        quitar.push(cur); // la anterior no se conserva
      }
      tx.set(metaRef(projectId), {
        org_id: orgId ?? null, projectId, v, n: pieces.length, bytes: bytes.length,
        stamp: data?.stamp || null, savedBy: savedBy || null, savedAtMs: now,
        puntos, puntoRefMs: razon ? now : (cur?.puntoRefMs ?? now), updatedAt: serverTimestamp(),
      });
      return quitar;
    });
  } catch (e) {
    deleteScenarioPieces(projectId, { v, n: pieces.length }).catch(() => {});
    throw e;
  }
  for (const p of borrar) deleteScenarioPieces(projectId, p).catch(() => {});
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
