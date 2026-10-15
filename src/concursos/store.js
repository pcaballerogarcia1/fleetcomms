// Concursos (licitaciones): lo que se lee y se escribe en Firestore.
// Cada concurso tiene su ficha (concursos/{id}, de la empresa) y su propio
// espacio aislado «{org}--c-{id}»: ahí viven su proyecto (Planning,
// Scheduling), sus vehículos, su plantilla, su cuadrante y su convenio, con
// ese org_id. Así los módulos de siempre funcionan dentro del concurso sin
// tocar nunca la operativa, y los conductores no lo ven (reglas: esEspacioDeConcurso).
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch } from "firebase/firestore";
import { logAudit } from "../audit.js";
import { db } from "../firebase.js";

export const ESTADOS = [
  { id: "estudio", nombre: "En estudio", color: "#5b7cfa" },
  { id: "presentado", nombre: "Presentado", color: "#f5b84a" },
  { id: "ganado", nombre: "Ganado", color: "#3fcf8e" },
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
export const RUTAS_CONCURSO = [["/calculo", "calculo", "Cálculo"], ["/alternativas", "alternativas", "Alternativas"], ["/documentos", "documentos", "Documentos"], ["/resumen", "resumen", "Resumen"]];
