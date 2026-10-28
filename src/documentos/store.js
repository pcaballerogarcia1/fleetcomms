// Documentos en la base de datos (ver datos.js): subir, nueva versión,
// archivar, leer el PDF y confirmar la lectura.
import { Bytes, collection, deleteDoc, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase.js";
import { enviarAvisos } from "../avisos.js";
import { logAudit } from "../audit.js";
import { juntar, mimeDe, nombreCategoria, tipoArchivo, trocear } from "./datos.js";

const lista = s => s.docs.map(d => ({ id: d.id, ...d.data() }));
const quien = sesion => ({ uid: sesion?.uid || null, nombre: [sesion?.nombre, sesion?.apellidos].filter(Boolean).join(" ") || null });
const nuevaV = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function subirTrozos(orgId, docId, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const trozos = trocear(bytes);
  const v = nuevaV();
  await Promise.all(trozos.map((t, i) => setDoc(doc(db, "documentos", docId, "trozos", `${v}_${i}`), { org_id: orgId, v, i, data: Bytes.fromUint8Array(t) })));
  return { nombre: file.name, tipo: mimeDe(file), bytes: bytes.length, n: trozos.length, v };
}
const borrarTrozos = (docId, a) => Promise.all(Array.from({ length: a?.n || 0 }, (_, i) => deleteDoc(doc(db, "documentos", docId, "trozos", `${a.v}_${i}`)).catch(() => {})));

function avisar(d, titulo) {
  enviarAvisos(d.org_id, d.paraTodos ? "todos" : d.paraUids, { titulo, cuerpo: `${nombreCategoria(d.categoria)}: ${d.titulo}. Ábrelo en la app y confirma que lo has leído.`, url: "/rutas", etiqueta: `documento-${d.id}` }).catch(() => {});
}

/** Sube un documento nuevo (versión 1) y avisa a quien va dirigido */
export async function subirDocumento({ orgId, sesion, titulo, categoria, descripcion, paraTodos, paraUids, archivo }) {
  const ref = doc(collection(db, "documentos"));
  const meta = await subirTrozos(orgId, ref.id, archivo);
  const d = { org_id: orgId, titulo: titulo.trim(), categoria, descripcion: String(descripcion || "").trim(), version: 1, activo: true,
    paraTodos: !!paraTodos, paraUids: paraTodos ? [] : paraUids, archivo: meta, subidoPor: quien(sesion), subidoAt: Date.now() };
  await setDoc(ref, d);
  logAudit({ modulo: "Rostering", accion: "Subió un documento", detalle: `${nombreCategoria(categoria)} · ${d.titulo}`, projectId: null });
  avisar({ ...d, id: ref.id }, "Documento nuevo para ti");
  return ref.id;
}

/** Sustituye el PDF por una versión nueva: hay que volver a confirmar la lectura */
export async function nuevaVersion(d, archivo, sesion) {
  const meta = await subirTrozos(d.org_id, d.id, archivo);
  await updateDoc(doc(db, "documentos", d.id), { archivo: meta, version: (d.version || 1) + 1, subidoPor: quien(sesion), subidoAt: Date.now() });
  await borrarTrozos(d.id, d.archivo);
  logAudit({ modulo: "Rostering", accion: "Subió una versión nueva de un documento", detalle: `${d.titulo} · v${(d.version || 1) + 1}`, projectId: null });
  avisar(d, "Documento actualizado");
}

export async function archivarDocumento(d, activo = false) {
  await updateDoc(doc(db, "documentos", d.id), { activo });
  logAudit({ modulo: "Rostering", accion: activo ? "Recuperó un documento" : "Archivó un documento", detalle: d.titulo, projectId: null });
}

export async function eliminarDocumento(d) {
  await borrarTrozos(d.id, d.archivo);
  await deleteDoc(doc(db, "documentos", d.id));
  logAudit({ modulo: "Rostering", accion: "Eliminó un documento", detalle: d.titulo, projectId: null });
}

/** El archivo como dirección para abrirlo (blob:) */
export async function abrirArchivo(d) {
  const a = d.archivo;
  const snaps = await Promise.all(Array.from({ length: a.n }, (_, i) => getDoc(doc(db, "documentos", d.id, "trozos", `${a.v}_${i}`))));
  if (snaps.some(s => !s.exists())) throw new Error("Falta parte del archivo; vuelve a intentarlo");
  const bytes = juntar(snaps.map(s => s.data().data.toUint8Array()));
  return URL.createObjectURL(new Blob([bytes], { type: a.tipo || "application/pdf" }));
}

/** Un Word no se ve en el navegador: se descarga con su nombre y lo abre la aplicación del móvil u ordenador */
export function descargar(url, nombre) {
  const a = document.createElement("a");
  a.href = url; a.download = nombre || "documento"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}
export const esWord = d => tipoArchivo(d?.archivo) === "word";

export const escucharDocumentosOrg = (orgId, cb) =>
  onSnapshot(query(collection(db, "documentos"), where("org_id", "==", orgId)), s => cb(lista(s)), () => cb([]));

/** Los del trabajador: los de todos y los dirigidos a él (dos consultas, juntas) */
export function escucharMisDocumentos(orgId, uid, cb) {
  let a = [], b = [];
  const emitir = () => { const m = new Map([...a, ...b].map(d => [d.id, d])); cb([...m.values()]); };
  const base = [where("org_id", "==", orgId), where("activo", "==", true)];
  const u1 = onSnapshot(query(collection(db, "documentos"), ...base, where("paraTodos", "==", true)), s => { a = lista(s); emitir(); }, () => { a = []; emitir(); });
  const u2 = onSnapshot(query(collection(db, "documentos"), ...base, where("paraUids", "array-contains", uid)), s => { b = lista(s); emitir(); }, () => { b = []; emitir(); });
  return () => { u1(); u2(); };
}

export const escucharLecturasOrg = (orgId, cb) =>
  onSnapshot(query(collection(db, "documentos_lecturas"), where("org_id", "==", orgId)), s => cb(lista(s)), () => cb([]));

export const escucharMisLecturas = (orgId, uid, cb) =>
  onSnapshot(query(collection(db, "documentos_lecturas"), where("org_id", "==", orgId), where("uid", "==", uid)), s => cb(lista(s)), () => cb([]));

/** «He leído y entendido» (de la versión actual) */
export const marcarLeido = (d, sesion) =>
  setDoc(doc(db, "documentos_lecturas", `${d.id}_${sesion.uid}`), {
    org_id: d.org_id, docId: d.id, uid: sesion.uid, nombre: quien(sesion).nombre || "Trabajador", version: d.version || 1, leidoAt: Date.now(),
  });
