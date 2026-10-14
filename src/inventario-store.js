// ── Inventario de contenedores en la nube ────────────────────────────
// Igual que el escenario (scenario-store.js): comprimido con gzip y troceado.
//
//   planning_inventario/{projectId}                 { org_id, projectId, v, n, count, updatedAt }
//   planning_inventario/{projectId}/trozos/{v}_{i}  { projectId, v, i, data: Bytes }
//
// Cada guardado sube una versión nueva y luego apunta la ficha a ella. Si
// otra persona guardó entre medias, sus cambios no se pierden: se vuelven a
// aplicar los míos (solo las fichas que he tocado) encima de los suyos.
import { db } from "./firebase.js";
import { doc, getDoc, deleteDoc, onSnapshot, serverTimestamp, runTransaction, setDoc, Bytes } from "firebase/firestore";
import { gzip, gunzip, splitBytes, joinBytes, localGet, localPut } from "./layer-store.js";

const metaRef = projectId => doc(db, "planning_inventario", projectId);
const pieceRef = (projectId, v, i) => doc(db, "planning_inventario", projectId, "trozos", `${v}_${i}`);
const nuevaVersion = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function descargar(projectId, meta) {
  const clave = `inv_${projectId}`;
  if ((await localGet(`${clave}__v`)) === meta.v) {
    const l = await localGet(clave);
    if (Array.isArray(l)) return l;
  }
  const snaps = await Promise.all(Array.from({ length: meta.n }, (_, i) => getDoc(pieceRef(projectId, meta.v, i))));
  if (snaps.some(s => !s.exists())) throw new Error("faltan trozos del inventario");
  const lista = JSON.parse(await gunzip(joinBytes(snaps.map(s => s.data().data.toUint8Array()))));
  await localPut(clave, lista);
  await localPut(`${clave}__v`, meta.v);
  return lista;
}

/** El inventario actual (sin escuchar cambios): { v, lista } */
export async function leerInventario(projectId) {
  const s = await getDoc(metaRef(projectId));
  if (!s.exists() || !s.data().v) return { v: null, lista: [] };
  return { v: s.data().v, lista: await descargar(projectId, s.data()) };
}

/** Escucha el inventario: cb({ v, lista }) cada vez que alguien lo guarda */
export function escucharInventario(projectId, cb, onError) {
  let ultima = null;
  return onSnapshot(metaRef(projectId), s => {
    const meta = s.exists() ? s.data() : null;
    if (!meta?.v) { ultima = null; cb({ v: null, lista: [] }); return; }
    if (meta.v === ultima) return;
    ultima = meta.v;
    descargar(projectId, meta).then(lista => { if (ultima === meta.v) cb({ v: meta.v, lista }); }).catch(e => onError?.(e));
  }, e => onError?.(e));
}

/**
 * Guarda el inventario.
 * @param baseV     versión de la que partía la edición
 * @param cambiados ids de las fichas que he tocado (null = todas: la lista entera manda)
 * @returns { v, lista } lo que ha quedado guardado
 */
export async function guardarInventario(projectId, orgId, lista, { baseV = null, cambiados = null, borrados = [] } = {}) {
  let final = lista;
  const cur = await getDoc(metaRef(projectId));
  if (cambiados && cur.exists() && cur.data().v && cur.data().v !== baseV) {
    // alguien guardó entre medias: sus fichas + las que yo he tocado
    const suya = await descargar(projectId, cur.data());
    const mias = new Map(lista.filter(c => cambiados.has(c.id)).map(c => [c.id, c]));
    const fuera = new Set(borrados);
    final = suya.filter(c => !fuera.has(c.id)).map(c => mias.get(c.id) || c);
    const ids = new Set(final.map(c => c.id));
    for (const c of mias.values()) if (!ids.has(c.id)) final.push(c);
  }
  const v = nuevaVersion();
  const pieces = splitBytes(await gzip(JSON.stringify(final)));
  await Promise.all(pieces.map((p, i) => setDoc(pieceRef(projectId, v, i), { projectId, v, i, data: Bytes.fromUint8Array(p) })));
  const anterior = await runTransaction(db, async tx => {
    const s = await tx.get(metaRef(projectId));
    const prev = s.exists() ? s.data() : null;
    tx.set(metaRef(projectId), { org_id: orgId, projectId, v, n: pieces.length, count: final.length, updatedAt: serverTimestamp() });
    return prev;
  });
  await localPut(`inv_${projectId}`, final);
  await localPut(`inv_${projectId}__v`, v);
  if (anterior?.v) for (let i = 0; i < (anterior.n || 0); i++) deleteDoc(pieceRef(projectId, anterior.v, i)).catch(() => {});
  return { v, lista: final };
}
