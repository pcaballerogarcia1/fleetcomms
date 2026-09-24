// ── Capas grandes de Planning en la nube ──────────────────────────────
// Antes, una capa de más de 500 puntos se guardaba SOLO en el IndexedDB del
// navegador que la subía (`localOnly`): en cualquier otro PC el mapa salía
// vacío y Scheduling no podía importar sus paradas.
//
// Ahora los puntos van a Firestore comprimidos (gzip) y troceados en fichas
// de < 900 KB:  planning_layers/{docId}/trozos/{version}_{i}
// y la ficha de la capa guarda `cloud: { v, n, bytes, count }`. Cada navegador
// mantiene una copia en IndexedDB con su versión, así que abrir una capa ya
// descargada es tan rápido como antes; solo se descarga cuando cambia.

import { db } from "./firebase.js";
import { doc, getDoc, setDoc, deleteDoc, Bytes } from "firebase/firestore";

export const PIECE_BYTES = 900_000;

// Misma base de datos local que usaba planning.jsx para las capas
const IDB_NAME = "operanzia_v1", IDB_STORE = "layer_markers";
let _conn = null;
function idbOpen() {
  if (!_conn) _conn = new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => { _conn = null; rej(req.error); };
  });
  return _conn;
}
async function idb(mode, fn) {
  const conn = await idbOpen();
  return new Promise((res, rej) => {
    const r = fn(conn.transaction(IDB_STORE, mode).objectStore(IDB_STORE));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export const localGet = key => idb("readonly", s => s.get(key)).catch(() => undefined);
export const localPut = (key, value) => idb("readwrite", s => s.put(value, key)).catch(() => {});
export const localDel = key => idb("readwrite", s => s.delete(key)).catch(() => {});

// ── gzip ─────────────────────────────────────────────────────────────
async function pipe(bytes, stream) {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}
export const gzip   = text  => pipe(new TextEncoder().encode(text), new CompressionStream("gzip"));
export const gunzip = async bytes => new TextDecoder().decode(await pipe(bytes, new DecompressionStream("gzip")));

export function splitBytes(bytes, size = PIECE_BYTES) {
  const out = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size));
  return out.length ? out : [new Uint8Array(0)];
}
export function joinBytes(parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const pieceRef = (docId, v, i) => doc(db, "planning_layers", docId, "trozos", `${v}_${i}`);

/**
 * Sube los puntos de una capa. Devuelve el `cloud` a guardar en la ficha de
 * la capa. Deja además la copia local con esa versión.
 */
export async function uploadLayerMarkers(docId, projectId, markers) {
  const v = Date.now().toString(36);
  const bytes = await gzip(JSON.stringify(markers));
  const pieces = splitBytes(bytes);
  for (let i = 0; i < pieces.length; i++) {
    await setDoc(pieceRef(docId, v, i), { projectId, v, i, data: Bytes.fromUint8Array(pieces[i]) });
  }
  await localPut(docId, markers);
  await localPut(`${docId}__v`, v);
  return { v, n: pieces.length, bytes: bytes.length, count: markers.length };
}

/**
 * Puntos de una capa en la nube: de la copia local si es de la misma
 * versión; si no, se descargan, se descomprimen y se guarda la copia.
 */
export async function loadLayerMarkers(docId, cloud) {
  if ((await localGet(`${docId}__v`)) === cloud.v) {
    const cached = await localGet(docId);
    if (Array.isArray(cached) && cached.length === cloud.count) return cached;
  }
  const snaps = await Promise.all(Array.from({ length: cloud.n }, (_, i) => getDoc(pieceRef(docId, cloud.v, i))));
  if (snaps.some(s => !s.exists())) throw new Error("faltan trozos de la capa en la nube");
  const markers = JSON.parse(await gunzip(joinBytes(snaps.map(s => s.data().data.toUint8Array()))));
  await localPut(docId, markers);
  await localPut(`${docId}__v`, cloud.v);
  return markers;
}

// Borra los trozos de una versión (al sustituirla o al borrar la capa).
export async function deleteLayerPieces(docId, cloud) {
  if (!cloud) return;
  await Promise.all(Array.from({ length: cloud.n }, (_, i) => deleteDoc(pieceRef(docId, cloud.v, i)).catch(() => {})));
}
