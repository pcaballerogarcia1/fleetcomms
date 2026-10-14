// Pesadas de báscula en Firestore: pesadas/{id}
//   { org_id, projectId, mes, fecha, hora, vehiculo, planta, fraccion, kg, ticket, nota, creadoPor, creadoNombre, creadoEn }
// Se leen por organización y mes (dos igualdades: sin índice compuesto).
import { db } from "./firebase.js";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, where } from "firebase/firestore";

export function escucharPesadas(orgId, mes, cb, onError) {
  const q = query(collection(db, "pesadas"), where("org_id", "==", orgId), where("mes", "==", mes));
  return onSnapshot(q, s => cb(s.docs.map(d => ({ _id: d.id, ...d.data() })).sort((a, b) => `${b.fecha} ${b.hora || ""}`.localeCompare(`${a.fecha} ${a.hora || ""}`))), onError);
}

export function apuntarPesada(orgId, datos, quien) {
  const fecha = datos.fecha || new Date().toISOString().slice(0, 10);
  return addDoc(collection(db, "pesadas"), {
    org_id: orgId, projectId: datos.projectId || null, mes: fecha.slice(0, 7), fecha, hora: datos.hora || "",
    vehiculo: datos.vehiculo || "", planta: datos.planta || "", fraccion: datos.fraccion || "",
    kg: datos.kg, ticket: datos.ticket || "", nota: datos.nota || "",
    creadoPor: quien?.id || null, creadoNombre: quien?.nombre || "", creadoEn: Date.now(),
  });
}

export const borrarPesada = id => deleteDoc(doc(db, "pesadas", id));
