// Concursos (licitaciones): lo que se lee y se escribe en Firestore.
// Cada concurso tiene su ficha (concursos/{id}, de la empresa) y su propio
// espacio aislado «{org}--c-{id}»: ahí viven su proyecto (Planning,
// Scheduling), sus vehículos, su plantilla, su cuadrante y su convenio, con
// ese org_id. Así los módulos de siempre funcionan dentro del concurso sin
// tocar nunca la operativa, y los conductores no lo ven (reglas: esEspacioDeConcurso).
import { collection, deleteDoc, deleteField, doc, FieldPath, getDoc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { logAudit } from "../audit.js";
import { db } from "../firebase.js";
import { C } from "../tema.js";

export const ESTADOS = [
  { id: "estudio", nombre: "En estudio", color: C.blue },
  { id: "presentado", nombre: "Presentado", color: C.amber },
  { id: "ganado", nombre: "Ganado", color: C.green },
  { id: "perdido", nombre: "Perdido", color: "#8b95a5" },
];
export const TIPOS_CONCURSO = [
  { id: "puntos", nombre: "Recogida, limpieza o servicios por puntos" },
  { id: "lineas", nombre: "Autobuses (líneas regulares)" },
];

/** El espacio aislado de un concurso */
export const espacioDe = (orgId, concursoId) => `${orgId}--c-${concursoId}`;
export const esEspacioConcurso = orgId => typeof orgId === "string" && orgId.includes("--c-");

/** Los concursos de la empresa, del más reciente al más antiguo */
export function escucharConcursos(orgId, cb, onError) {
  if (!orgId) { cb([]); return () => {}; }
  return onSnapshot(query(collection(db, "concursos"), where("org_id", "==", orgId)),
    s => cb(s.docs.map(d => ({ _id: d.id, ...d.data() })).sort((a, b) => (b.creadoEn || 0) - (a.creadoEn || 0))),
    e => { cb([]); onError?.(e); });
}

/** Crea el concurso y su proyecto (en su espacio). Devuelve { concurso, proyecto } */
export async function crearConcurso({ orgId, nombre, tipo, organismo, duracionAnios, fechaLimite }) {
  const ref = doc(collection(db, "concursos"));
  const espacio = espacioDe(orgId, ref.id);
  const pRef = doc(collection(db, "scheduling_projects"));
  const mes = new Date().toISOString().slice(0, 7);
  const concurso = {
    org_id: orgId, nombre, tipo, organismo: organismo || "", duracionAnios: Number(duracionAnios) || null,
    fechaLimite: fechaLimite || null, estado: "estudio", espacio, projectId: pRef.id, creadoEn: Date.now(),
  };
  const proyecto = {
    nombre, descripcion: organismo ? `Concurso · ${organismo}` : "Concurso", mes, status: "nuevo", tipo,
    org_id: espacio, concurso: ref.id, planning: null, scheduling: null,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
  const b = writeBatch(db);
  b.set(ref, concurso);
  b.set(pRef, proyecto);
  await b.commit();
  logAudit({ modulo: "Concursos", accion: "Creó un concurso", detalle: `${nombre}${organismo ? ` · ${organismo}` : ""}` });
  return { concurso: { _id: ref.id, ...concurso }, proyecto: { _id: pRef.id, ...proyecto, createdAt: null, updatedAt: null } };
}

export async function cambiarConcurso(id, cambios, texto) {
  await updateDoc(doc(db, "concursos", id), cambios);
  if (texto) logAudit({ modulo: "Concursos", accion: texto, detalle: id });
}

// Los módulos de un concurso (además de Planning, Scheduling y Rostering) y su ruta
export const RUTAS_CONCURSO = [["/documentos", "documentos", "Documentos"], ["/calculo", "calculo", "Cálculo"], ["/alternativas", "alternativas", "Alternativas"], ["/resumen", "resumen", "Resumen"]];

// ── Documentos del concurso (pliegos) ──────────────────────────────────
// concursos/{id}/documentos/{doc}: nombre, clase, páginas y lo leído
// (leerPliego); el texto de cada página en …/texto/{n} y el PDF en …/pdf/{n},
// troceados (un documento de Firestore no pasa de 1 MB).
const TROZO = 700_000;
export const PDF_MAX = 15 * 1024 * 1024;
const trozos = (txt, n = TROZO) => Array.from({ length: Math.max(1, Math.ceil(txt.length / n)) }, (_, i) => txt.slice(i * n, (i + 1) * n));

export function escucharDocumentos(concursoId, cb) {
  return onSnapshot(collection(db, "concursos", concursoId, "documentos"),
    s => cb(s.docs.map(d => ({ _id: d.id, ...d.data() })).sort((a, b) => (a.subidoEn || 0) - (b.subidoEn || 0))), () => cb([]));
}

/** Guarda un pliego ya leído: { archivo, paginas: [texto], lectura } */
export async function guardarDocumento(concursoId, { archivo, paginas, lectura, onProgreso }) {
  const ref = doc(collection(db, "concursos", concursoId, "documentos"));
  const b64 = await new Promise((ok, mal) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(",")[1]); fr.onerror = mal; fr.readAsDataURL(archivo); });
  const pdf = trozos(b64), texto = trozos(JSON.stringify(paginas));
  let hecho = 0;
  const total = pdf.length + texto.length + 1;
  for (const [i, t] of texto.entries()) { await setDoc(doc(ref, "texto", String(i)), { i, t }); onProgreso?.(++hecho, total); }
  for (const [i, d] of pdf.entries()) { await setDoc(doc(ref, "pdf", String(i)), { i, d }); onProgreso?.(++hecho, total); }
  await setDoc(ref, {
    nombre: archivo.name, tamano: archivo.size, tipo: archivo.type || "application/pdf", paginas: paginas.length, subidoEn: Date.now(),
    trozosTexto: texto.length, trozosPdf: pdf.length, clase: lectura.clase || null, lectura: sinIndefinidos(lectura),
  });
  logAudit({ modulo: "Concursos", accion: "Subió un pliego", detalle: archivo.name });
  return ref.id;
}

/** Lo leído de un documento, otra vez (con un lector mejor) */
export function releerDocumento(concursoId, d, lectura) {
  return updateDoc(doc(db, "concursos", concursoId, "documentos", d._id), { lectura: sinIndefinidos(lectura), clase: lectura.clase || null });
}

export async function textoDocumento(concursoId, d) {
  const partes = await Promise.all(Array.from({ length: d.trozosTexto || 0 }, (_, i) => getDoc(doc(db, "concursos", concursoId, "documentos", d._id, "texto", String(i)))));
  return JSON.parse(partes.map(p => p.data()?.t || "").join("") || "[]");
}
export async function pdfDocumento(concursoId, d) {
  const partes = await Promise.all(Array.from({ length: d.trozosPdf || 0 }, (_, i) => getDoc(doc(db, "concursos", concursoId, "documentos", d._id, "pdf", String(i)))));
  const b64 = partes.map(p => p.data()?.d || "").join("");
  return new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: d.tipo || "application/pdf" });
}
export async function borrarDocumento(concursoId, d) {
  const base = ["concursos", concursoId, "documentos", d._id];
  for (let i = 0; i < (d.trozosTexto || 0); i++) await deleteDoc(doc(db, ...base, "texto", String(i)));
  for (let i = 0; i < (d.trozosPdf || 0); i++) await deleteDoc(doc(db, ...base, "pdf", String(i)));
  await deleteDoc(doc(db, ...base));
  logAudit({ modulo: "Concursos", accion: "Quitó un pliego", detalle: d.nombre });
}

// ── Ficha de requisitos (lo confirmado del pliego: concursos/{id}/requisitos/ficha) ──
const refFicha = concursoId => doc(db, "concursos", concursoId, "requisitos", "ficha");
export function escucharFicha(concursoId, cb) {
  return onSnapshot(refFicha(concursoId), s => cb(s.exists() ? { datos: {}, servicios: {}, ...s.data() } : { datos: {}, servicios: {} }), () => cb({ datos: {}, servicios: {} }));
}
async function cambiarFicha(concursoId, ruta, valor) {
  const ref = refFicha(concursoId);
  try { await updateDoc(ref, new FieldPath(...ruta), valor); }
  catch (e) {
    if (e?.code !== "not-found") throw e;
    await setDoc(ref, { datos: {}, servicios: {} }, { merge: true });
    await updateDoc(ref, new FieldPath(...ruta), valor);
  }
}
/** Un dato revisado: { valor, estado: "confirmado" | "corregido" | "descartado", propuesto, pagina, frase, doc } (null = volver a pendiente) */
export const fijarDato = (concursoId, clave, dato) => cambiarFicha(concursoId, ["datos", clave], dato ? { ...dato, en: Date.now() } : deleteField());
/** Un servicio de la ficha (null = quitarlo) */
export const fijarServicio = (concursoId, id, servicio) => cambiarFicha(concursoId, ["servicios", id], servicio ? { ...servicio, en: Date.now() } : deleteField());

// ── Dimensionamiento por rendimientos (Planning del concurso): concursos/{id}/requisitos/dimension ──
// { parametros: { jornadasAnio, horasTurno, … }, porServicio: { [servicio]: { porTurno, equipo } } }
const refDimension = concursoId => doc(db, "concursos", concursoId, "requisitos", "dimension");
export function escucharDimension(concursoId, cb) {
  return onSnapshot(refDimension(concursoId), s => cb(s.exists() ? { parametros: {}, porServicio: {}, ...s.data() } : { parametros: {}, porServicio: {} }), () => cb({ parametros: {}, porServicio: {} }));
}
export const guardarDimension = (concursoId, cambios) => setDoc(refDimension(concursoId), { ...cambios, en: Date.now() }, { merge: true });

// ── Inventario de contenedores sin coordenadas (Planning del concurso): concursos/{id}/requisitos/inventario ──
const refInventario = concursoId => doc(db, "concursos", concursoId, "requisitos", "inventario");
export function escucharInventario(concursoId, cb) {
  return onSnapshot(refInventario(concursoId), s => cb(s.exists() ? s.data() : null), () => cb(null));
}
export async function guardarInventario(concursoId, { nombre, contenedores }) {
  await setDoc(refInventario(concursoId), { nombre, subidoEn: Date.now(), contenedores });
  logAudit({ modulo: "Concursos", accion: "Subió un inventario de contenedores", detalle: `${nombre} · ${contenedores.length} contenedores` });
}
export async function borrarInventario(concursoId, capa) {
  if (capa) await deleteDoc(doc(db, "planning_layers", capa)).catch(() => {});
  await deleteDoc(refInventario(concursoId));
}
/** Quita del mapa la capa del inventario anterior (al cambiar de listado) */
export const quitarCapaInventario = capa => (capa ? deleteDoc(doc(db, "planning_layers", capa)).catch(() => {}) : Promise.resolve());

/** Criterios de adjudicación confirmados: { criterios: [{ nombre, puntos, tipo }], formula, saciedad, baja: { id, valor }, origen } */
export const fijarAdjudicacion = (concursoId, adj) => cambiarFicha(concursoId, ["adjudicacion"], adj ? { ...adj, en: Date.now() } : deleteField());

// ── Cálculo (concursos/{id}/requisitos/calculo) y oferta (…/requisitos/oferta) ──
// calculo: { parametros, vehiculos: { [tipo]: { precio, … } }, presupuestoAnual }
// oferta: { competidores: [{ nombre, baja, tecnicaPct }], tecnicaPct, margenMinimoPct, bajaElegida }
export function escucharRequisito(concursoId, nombre, cb) {
  return onSnapshot(doc(db, "concursos", concursoId, "requisitos", nombre), s => cb(s.exists() ? s.data() : {}), () => cb({}));
}
export const guardarRequisito = (concursoId, nombre, datos) => setDoc(doc(db, "concursos", concursoId, "requisitos", nombre), { ...datos, en: Date.now() }, { merge: true });

// ── El inventario, en el mapa del Planning del concurso (una capa más, como en Proyectos) ──
// La capa va al proyecto del concurso (su espacio); si ya había una del
// inventario, se quita antes. Más de 500 puntos: a la nube troceados (layer-store).
export async function volcarInventarioAlMapa(concursoId, { nombre, marcadores, capaAnterior }) {
  const c = (await getDoc(doc(db, "concursos", concursoId))).data();
  if (!c?.projectId) throw new Error("El concurso no tiene proyecto.");
  if (capaAnterior) await deleteDoc(doc(db, "planning_layers", capaAnterior)).catch(() => {});
  const id = Date.now() + Math.random();
  const docId = `${c.projectId}_${id}`;
  const capa = { id, name: `Inventario · ${nombre}`, type: "xlsx", color: C.green, visible: true, projectId: c.projectId, orgId: c.espacio, createdAt: serverTimestamp() };
  if (marcadores.length > 500) {
    const { uploadLayerMarkers } = await import("../layer-store.js");
    const cloud = await uploadLayerMarkers(docId, c.projectId, marcadores);
    await setDoc(doc(db, "planning_layers", docId), { ...capa, markers: [], cloud, totalMarkers: marcadores.length });
  } else {
    await setDoc(doc(db, "planning_layers", docId), { ...capa, markers: marcadores });
  }
  await updateDoc(refInventario(concursoId), { capa: docId });
  logAudit({ modulo: "Concursos", accion: "Pasó el inventario al mapa", detalle: `${nombre} · ${marcadores.length} contenedores` });
  return docId;
}
/** Guarda las coordenadas encontradas en el inventario */
export const guardarCoordenadas = (concursoId, cambios) => updateDoc(refInventario(concursoId), cambios);

/** Sin campos vacíos (Firestore no admite undefined), a cualquier profundidad */
export const sinIndefinidos = v => (Array.isArray(v) ? v.map(sinIndefinidos)
  : v && typeof v === "object" && !(v instanceof Date) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, sinIndefinidos(x)])) : v);

/** El estudio de costes del Ayuntamiento que usa Cálculo (null = no usarlo) */
export const fijarEstudio = (concursoId, estudio, docNombre) => cambiarFicha(concursoId, ["estudio"], estudio ? sinIndefinidos({ ...estudio, docNombre: docNombre || null, en: Date.now() }) : deleteField());

// ── Vigilancia de licitaciones por CPV (concursos_vigilancia/{org}) ──
// { cpvs: ["9051", …], autoCrear, ultima (ISO), encontradas: [licitación resumida], descartadas: [id], creadas: { [id]: concursoId } }
const refVigilancia = orgId => doc(db, "concursos_vigilancia", orgId);
export function escucharVigilancia(orgId, cb) {
  if (!orgId) { cb(null); return () => {}; }
  return onSnapshot(refVigilancia(orgId), s => cb(s.exists() ? s.data() : {}), () => cb({}));
}
export const guardarVigilancia = (orgId, cambios) => setDoc(refVigilancia(orgId), sinIndefinidos({ ...cambios, org_id: orgId }), { merge: true });
