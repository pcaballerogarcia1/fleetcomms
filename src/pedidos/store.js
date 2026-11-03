// Pedidos con fecha y pedidos fijos en la base de datos (ver datos.js).
import { addDoc, arrayUnion, collection, deleteDoc, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase.js";
import { logAudit } from "../audit.js";
import { pedidosDeFijos } from "./datos.js";

const lista = s => s.docs.map(d => ({ id: d.id, ...d.data() }));
const quien = sesion => ({ uid: sesion?.uid || null, nombre: [sesion?.nombre, sesion?.apellidos].filter(Boolean).join(" ") || null });

/** Los pedidos de un día de un proyecto, en directo */
export function escucharPedidos(orgId, projectId, fecha, cb, onError) {
  const q = query(collection(db, "pedidos"), where("org_id", "==", orgId), where("projectId", "==", projectId), where("fecha", "==", fecha));
  return onSnapshot(q, s => cb(lista(s).sort((a, b) => (a.creadoEn ?? 0) - (b.creadoEn ?? 0))), e => onError?.(e));
}
/** Los pedidos fijos de un proyecto, en directo */
export function escucharFijos(orgId, projectId, cb, onError) {
  const q = query(collection(db, "pedidos_fijos"), where("org_id", "==", orgId), where("projectId", "==", projectId));
  return onSnapshot(q, s => cb(lista(s).sort((a, b) => String(a.cliente?.nombre).localeCompare(String(b.cliente?.nombre)))), e => onError?.(e));
}

export async function crearPedido(datos, sesion) {
  const r = await addDoc(collection(db, "pedidos"), { ...datos, creadoPor: quien(sesion), creadoEn: Date.now() });
  return r.id;
}
/** Varios a la vez (lo pegado desde Excel) */
export async function crearPedidos(lista, sesion) {
  const ahora = Date.now();
  await Promise.all(lista.map((d, i) => addDoc(collection(db, "pedidos"), { ...d, creadoPor: quien(sesion), creadoEn: ahora + i })));
  logAudit({ modulo: "Planning", accion: "Añadió pedidos pegados de Excel", detalle: `${lista.length} pedidos · ${lista[0]?.fecha || ""}`, projectId: lista[0]?.projectId || null });
}
export const cambiarPedido = (id, cambio) => updateDoc(doc(db, "pedidos", id), cambio);
/** Anular (los fijos se anulan para ese día: no vuelven a salir) o recuperar */
export const anularPedido = (id, anulado = true) => updateDoc(doc(db, "pedidos", id), { estado: anulado ? "anulado" : "pendiente" });
export const borrarPedido = id => deleteDoc(doc(db, "pedidos", id));

/** Crea los pedidos de los fijos que tocan ese día y aún no existen. `existentes`: los de ese día
 *  (también los anulados), tal como llegan en directo — no se lee cada uno antes: leer uno que no
 *  existe no lo permiten las reglas. Su id es fijo, así que crearlo dos veces no lo duplica. */
const creando = new Set();
export async function crearPedidosDeFijos(fijos, fecha, existentes, sesion) {
  const faltan = pedidosDeFijos(fijos, fecha, existentes).filter(f => !creando.has(f.id));
  for (const f of faltan) {
    creando.add(f.id);
    try { await setDoc(doc(db, "pedidos", f.id), { ...f.datos, creadoPor: quien(sesion), creadoEn: Date.now() }); }
    finally { setTimeout(() => creando.delete(f.id), 5000); } // hasta que llegue en la lista del día
  }
  return faltan.length;
}

export async function guardarFijo(fijo, sesion) {
  const { id, ...datos } = fijo;
  if (id) return updateDoc(doc(db, "pedidos_fijos", id), datos);
  const r = await addDoc(collection(db, "pedidos_fijos"), { ...datos, activo: true, creadoPor: quien(sesion), creadoEn: Date.now() });
  logAudit({ modulo: "Planning", accion: "Creó un pedido fijo", detalle: datos.cliente?.nombre || "", projectId: datos.projectId || null });
  return r.id;
}
export const borrarFijo = id => deleteDoc(doc(db, "pedidos_fijos", id));

/**
 * Un cliente nuevo (escrito al hacer un pedido) a la lista de clientes del
 * proyecto: una capa «Clientes nuevos» de Planificación, para que la próxima
 * vez salga al escribir su nombre.
 */
export async function anadirClienteNuevo(projectId, orgId, cliente, campos) {
  const id = "clientes-nuevos";
  const ref = doc(db, "planning_layers", `${projectId}_${id}`);
  const punto = { lat: cliente.lat, lng: cliente.lng, Cliente: cliente.nombre, Dirección: cliente.direccion, ...campos };
  // de una vez, la cree o la amplíe (leerla antes, si aún no existe, no lo permiten las reglas)
  await setDoc(ref, { id, name: "Clientes nuevos", type: "pedidos", color: "#22d3ee", visible: true, markers: arrayUnion(punto), projectId, orgId, createdAt: serverTimestamp() }, { merge: true });
}

/** Los pedidos de un día (una vez, para planificarlo) */
export async function leerPedidosDelDia(orgId, projectId, fecha) {
  const s = await getDocs(query(collection(db, "pedidos"), where("org_id", "==", orgId), where("projectId", "==", projectId), where("fecha", "==", fecha)));
  return lista(s);
}
/** Al publicar el día: en qué ruta (vehículo) va cada pedido */
export async function marcarEnRuta(porPedido) {
  const ahora = Date.now();
  await Promise.all(Object.entries(porPedido).map(([id, ruta]) => updateDoc(doc(db, "pedidos", id), { ruta, publicadoEn: ahora }).catch(() => {})));
}
