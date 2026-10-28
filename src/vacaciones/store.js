// Vacaciones y permisos en la base de datos (ver solicitudes.js).
// Al aprobar se marca «V» cada día en el cuadrante de la oficina
// (rostering/{org}_{YYYY}_{MM}/trabajadores/{workerId}) y en el que ve el
// trabajador en la app (cuadrantes/{org}_{YYYY-MM}_{uid}), y se le avisa.
import { addDoc, collection, doc, FieldPath, onSnapshot, query, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase.js";
import { enviarAvisos } from "../avisos.js";
import { logAudit } from "../audit.js";
import { diasDe, diasPorMes, nombreTipo, problemaSolicitud } from "./solicitudes.js";

const COL = "solicitudes_ausencia";
const fechaCorta = f => new Date(f + "T12:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" });
export const periodo = s => (s.desde === s.hasta ? fechaCorta(s.desde) : `${fechaCorta(s.desde)} – ${fechaCorta(s.hasta)}`);

/** El trabajador pide días desde la app */
export async function pedirAusencia(sesion, { tipo, desde, hasta, comentario }) {
  const p = problemaSolicitud({ tipo, desde, hasta });
  if (p) throw new Error(p);
  await addDoc(collection(db, COL), {
    org_id: sesion.org_id, uid: sesion.uid, nombre: [sesion.nombre, sesion.apellidos].filter(Boolean).join(" ") || "Trabajador",
    tipo, desde, hasta, dias: diasDe(desde, hasta).length, comentario: String(comentario || "").slice(0, 500),
    estado: "pendiente", creadaAt: Date.now(),
  });
}

/** El trabajador retira una solicitud que aún no se ha contestado */
export const cancelarAusencia = id => updateDoc(doc(db, COL, id), { estado: "cancelada", canceladaAt: Date.now() });

export const escucharMisAusencias = (orgId, uid, cb) =>
  onSnapshot(query(collection(db, COL), where("org_id", "==", orgId), where("uid", "==", uid)), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => cb([]));

export const escucharAusenciasOrg = (orgId, cb) =>
  onSnapshot(query(collection(db, COL), where("org_id", "==", orgId)), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => cb([]));

const quien = sesion => ({ uid: sesion?.uid || null, nombre: [sesion?.nombre, sesion?.apellidos].filter(Boolean).join(" ") || null });

/** La oficina aprueba: «V» en el cuadrante (oficina y app) cada día, y aviso al trabajador */
export async function aprobarAusencia(s, worker, sesion) {
  const orgId = s.org_id;
  const batch = writeBatch(db);
  for (const [mes, dias] of Object.entries(diasPorMes(s.desde, s.hasta))) {
    const [y, m] = mes.split("-").map(Number);
    if (worker?._id) {
      const ref = doc(db, "rostering", `${orgId}_${y}_${String(m).padStart(2, "0")}`, "trabajadores", worker._id);
      batch.set(ref, { org_id: orgId, year: y, month: m }, { merge: true });
      const campos = dias.flatMap(d => [new FieldPath("grid", String(d)), "V"]);
      batch.update(ref, ...campos);
    }
    batch.set(doc(db, "cuadrantes", `${orgId}_${mes}_${s.uid}`), {
      org_id: orgId, uid: s.uid, workerId: worker?._id || null, nombre: s.nombre, year: y, month: m, mes,
      dias: Object.fromEntries(dias.map(d => [String(d), { c: "V" }])),
    }, { merge: true });
  }
  batch.update(doc(db, COL, s.id), { estado: "aprobada", resueltaPor: quien(sesion), resueltaAt: Date.now() });
  await batch.commit();
  logAudit({ modulo: "Rostering", accion: "Aprobó una solicitud de ausencia", detalle: `${s.nombre} · ${nombreTipo(s.tipo)} · ${periodo(s)}`, projectId: null });
  enviarAvisos(orgId, [s.uid], { titulo: "Solicitud aprobada", cuerpo: `${nombreTipo(s.tipo)}: ${periodo(s)}. Ya está en tu cuadrante.`, url: "/rutas", etiqueta: `ausencia-${s.id}` }).catch(() => {});
}

/** La oficina rechaza, con el motivo, y avisa al trabajador */
export async function rechazarAusencia(s, motivo, sesion) {
  await updateDoc(doc(db, COL, s.id), { estado: "rechazada", motivo: String(motivo || "").slice(0, 300), resueltaPor: quien(sesion), resueltaAt: Date.now() });
  logAudit({ modulo: "Rostering", accion: "Rechazó una solicitud de ausencia", detalle: `${s.nombre} · ${nombreTipo(s.tipo)} · ${periodo(s)}`, projectId: null });
  enviarAvisos(s.org_id, [s.uid], { titulo: "Solicitud rechazada", cuerpo: `${nombreTipo(s.tipo)}: ${periodo(s)}.${motivo ? ` ${motivo}` : ""}`, url: "/rutas", etiqueta: `ausencia-${s.id}` }).catch(() => {});
}

