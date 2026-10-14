// Despacho del día: lo que se lee y se escribe en Firestore.
// No hay colecciones nuevas: todo va donde ya vive.
//  · rostering/{org}_{AAAA}_{MM}/trabajadores/{id}: grid (código del día),
//    asign (horario y vehículo de Optimizar) y despacho (el hueco, quién lo
//    cubre, el vehículo cambiado) — casilla a casilla, sin pisar a nadie.
//  · planes (Rutas): la ruta del día pasa al que cubre.
//  · cuadrantes (Mi cuadrante en el móvil): el día de los dos se actualiza.
//  · rostering_vehicles: un vehículo al taller / averiado ese día.
import { collection, deleteField, doc, FieldPath, onSnapshot, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { logAudit } from "./audit.js";
import { enviarAvisos } from "./avisos.js";
import { nombre } from "./despacho.js";
import { db } from "./firebase.js";
import { DEFAULT_ROSTER_RULES } from "./roster-optimizer.js";

const mesId = (orgId, y, m) => `${orgId}_${y}_${String(m).padStart(2, "0")}`;
const mesTxt = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
const refTrab = (orgId, y, m, wid) => doc(db, "rostering", mesId(orgId, y, m), "trabajadores", wid);
const hora = min => `${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const NOMBRE_TURNO = { M: "de mañana", T: "de tarde", N: "de noche" };

/** El mes del cuadrante por trabajador: { [workerId]: { grid, asign, despacho } } */
export function escucharMes(orgId, y, m, cb, onError) {
  return onSnapshot(query(collection(db, "rostering", mesId(orgId, y, m), "trabajadores"), where("org_id", "==", orgId)),
    s => cb(Object.fromEntries(s.docs.map(d => [d.id, d.data()]))), e => { cb({}); onError?.(e); });
}
export function escucharReglas(orgId, cb) {
  // sin reglas guardadas valen las de por defecto (las mismas que usa Rostering)
  return onSnapshot(doc(db, "rostering", `${orgId}_reglas`), s => cb({ ...DEFAULT_ROSTER_RULES, ...(s.exists() ? s.data().rules || {} : {}) }), () => cb({ ...DEFAULT_ROSTER_RULES }));
}
export function escucharGridVehiculos(orgId, y, m, cb) {
  return onSnapshot(doc(db, "rostering_vehicles", mesId(orgId, y, m)), s => cb(s.exists() ? s.data().grid || {} : {}), () => cb({}));
}
/** Rutas del mes publicadas por trabajador (las de Rostering) */
export function escucharPlanes(orgId, y, m, cb) {
  return onSnapshot(query(collection(db, "planes"), where("org_id", "==", orgId), where("mes", "==", mesTxt(y, m))),
    s => cb(s.docs.map(d => ({ _id: d.id, ...d.data() })).filter(p => p.origenRostering || p.workerId)), () => cb([]));
}

// Una casilla de la ficha del trabajador (la crea si ese mes aún no la tenía)
function escribir(batch, orgId, y, m, wid, cambios) {
  const ref = refTrab(orgId, y, m, wid);
  batch.set(ref, { org_id: orgId, year: y, month: m }, { merge: true });
  const pares = Object.entries(cambios).flatMap(([ruta, v]) => [new FieldPath(...ruta.split(".")), v]);
  batch.update(ref, ...pares);
}

// El día de «Mi cuadrante» en el móvil (si ese mes está publicado)
async function diaCuadrante(orgId, y, m, worker, d, valor, crear = false) {
  if (!worker?.uid) return;
  const ref = doc(db, "cuadrantes", `${orgId}_${mesTxt(y, m)}_${worker.uid}`);
  try { await updateDoc(ref, new FieldPath("dias", String(d)), valor); }
  catch {
    if (crear) await setDoc(ref, { org_id: orgId, uid: worker.uid, workerId: worker._id, nombre: nombre(worker), year: y, month: m, mes: mesTxt(y, m), dias: { [d]: valor }, publicadoEn: Date.now() }, { merge: true }).catch(() => {});
  }
}

/** Un trabajador no viene: su turno queda como hueco por cubrir */
export async function noViene({ orgId, y, m, d, worker, turno, vehiculo, planes, motivo }) {
  const batch = writeBatch(db);
  escribir(batch, orgId, y, m, worker._id, {
    [`grid.${d}`]: "B",
    [`despacho.${d}`]: { hueco: { code: turno.code, s: turno.s, e: turno.e, v: vehiculo?.id || null, vn: vehiculo?.nombre || null, planes: planes.map(p => p._id) }, motivo, at: Date.now() },
  });
  await batch.commit();
  await diaCuadrante(orgId, y, m, worker, d, { c: "B" });
  logAudit({ modulo: "Despacho", accion: "Marcó una ausencia", detalle: `${nombre(worker)} · día ${d} · ${motivo}` });
}

/** Deshace una ausencia aún sin cubrir: vuelve su turno */
export async function deshacerAusencia({ orgId, y, m, d, hueco }) {
  const batch = writeBatch(db);
  escribir(batch, orgId, y, m, hueco.workerId, { [`grid.${d}`]: hueco.code, [`despacho.${d}`]: deleteField() });
  await batch.commit();
  await diaCuadrante(orgId, y, m, hueco.worker, d, { c: hueco.code, ...(hueco.vn ? { v: hueco.vn } : {}), s: hueco.s, e: hueco.e });
  logAudit({ modulo: "Despacho", accion: "Deshizo una ausencia", detalle: `${nombre(hueco.worker)} · día ${d}` });
}

/**
 * Otro trabajador cubre el hueco: el turno, la ruta del día, «Mi cuadrante» y un aviso al móvil.
 * @returns el resultado del aviso ({ enviados, sinAvisos }) o null si no se pudo avisar
 */
export async function cubrir({ orgId, y, m, d, hueco, cubre, asignAusente }) {
  const batch = writeBatch(db);
  escribir(batch, orgId, y, m, cubre._id, {
    [`grid.${d}`]: hueco.code,
    [`despacho.${d}`]: { cubreA: hueco.workerId, at: Date.now(), ...(hueco.v ? { vehiculo: { id: hueco.v, nombre: hueco.vn } } : {}) },
    ...(asignAusente ? { [`asign.${d}`]: asignAusente } : {}),
  });
  escribir(batch, orgId, y, m, hueco.workerId, {
    [`despacho.${d}.cubiertoPor`]: cubre._id,
    ...(asignAusente ? { [`asign.${d}`]: deleteField() } : {}),
  });
  for (const id of hueco.planes || []) batch.update(doc(db, "planes", id), { conductorUid: cubre.uid || null, workerId: cubre._id, conductorNombre: nombre(cubre) });
  await batch.commit();
  await diaCuadrante(orgId, y, m, cubre, d, { c: hueco.code, ...(hueco.vn ? { v: hueco.vn } : {}), s: hueco.s, e: hueco.e }, true);
  logAudit({ modulo: "Despacho", accion: "Cubrió un turno", detalle: `${nombre(cubre)} cubre a ${nombre(hueco.worker)} · día ${d} · ${hora(hueco.s)}–${hora(hueco.e)}` });
  if (!cubre.uid) return null;
  return enviarAvisos(orgId, [cubre.uid], {
    titulo: `Hoy cubres un turno ${NOMBRE_TURNO[hueco.code] || ""}`.trim(),
    cuerpo: `${hora(hueco.s)}–${hora(hueco.e)}${hueco.vn ? ` · ${hueco.vn}` : ""}. Tienes la ruta en la app.`,
    url: "/rutas", etiqueta: `despacho-${d}`,
  }).catch(() => null);
}

/** Cambia el vehículo de un trabajador ese día (el suyo no está disponible) */
export async function cambiarVehiculo({ orgId, y, m, d, fila, nuevo }) {
  const veh = { id: nuevo._id || nuevo.id, nombre: nuevo.nombre || nuevo.matricula || "Vehículo" };
  const batch = writeBatch(db);
  escribir(batch, orgId, y, m, fila.worker._id, { [`despacho.${d}.vehiculo`]: veh });
  for (const p of fila.planes) batch.update(doc(db, "planes", p._id), { vehiculoNombre: veh.nombre });
  await batch.commit();
  await diaCuadrante(orgId, y, m, fila.worker, d, { c: fila.turno.code, v: veh.nombre, s: fila.turno.s, e: fila.turno.e });
  logAudit({ modulo: "Despacho", accion: "Cambió el vehículo de un turno", detalle: `${nombre(fila.worker)} · día ${d} · ${fila.vehiculo?.nombre || "—"} → ${veh.nombre}` });
  if (!fila.worker.uid) return null;
  return enviarAvisos(orgId, [fila.worker.uid], { titulo: "Cambio de vehículo", cuerpo: `Hoy sales con ${veh.nombre}${fila.vehiculo ? ` (no con ${fila.vehiculo.nombre})` : ""}.`, url: "/rutas", etiqueta: `vehiculo-${d}` }).catch(() => null);
}

/** Un vehículo al taller, averiado o a la ITV ese día ("" = disponible otra vez) */
export async function estadoVehiculo({ orgId, y, m, d, vehiculoId, estado }) {
  const ref = doc(db, "rostering_vehicles", mesId(orgId, y, m));
  const batch = writeBatch(db);
  batch.set(ref, { org_id: orgId, year: y, month: m }, { merge: true });
  batch.update(ref, new FieldPath("grid", vehiculoId, String(d)), estado || deleteField());
  await batch.commit();
  logAudit({ modulo: "Despacho", accion: "Cambió el estado de un vehículo", detalle: `día ${d} · ${estado || "disponible"}` });
}
