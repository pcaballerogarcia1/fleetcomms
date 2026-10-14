// ── Servicio publicado de líneas en Firestore (Control y app del conductor) ──
// servicio_lineas/{proyecto}_{fecha}            la cabecera: qué día, qué escenario, la lista de turnos
// servicio_lineas/{id}/turnos/{T12}             cada turno: viajes, autobuses, trazados, quién lo hace y lo real
// ubicaciones_lineas/{uid}                      la última posición de cada conductor de autobús
// (aparte de ubicaciones_activas, que es la de rutas por puntos: no se mezclan)

import { db } from "./firebase.js";
import { doc, collection, query, where, onSnapshot, writeBatch, getDocs, setDoc, updateDoc, runTransaction, serverTimestamp, deleteDoc } from "firebase/firestore";
import { servicioId } from "./lineas-servicio.js";
import { asignacionDelDia } from "./lineas-rostering.js";

const turnosDe = sid => collection(db, "servicio_lineas", sid, "turnos");

/**
 * Publica (o vuelve a publicar) los turnos de un día. Lo que ya se hubiera
 * hecho en la calle ese día se pierde: la pantalla lo avisa antes.
 */
export async function publicarServicio({ projectId, orgId, fecha, dia, nombreDia, proyecto, servicio, por }) {
  const sid = servicioId(projectId, fecha);
  const viejos = await getDocs(query(turnosDe(sid), where("org_id", "==", orgId)));
  const nuevos = new Set(servicio.turnos.map(t => t.id));
  const ops = [];
  ops.push(b => b.set(doc(db, "servicio_lineas", sid), {
    projectId, org_id: orgId, fecha, dia, nombreDia: nombreDia || dia, proyecto: proyecto || "",
    lista: servicio.lista, resumen: servicio.resumen, publicadoAt: Date.now(), publicadoPor: por || null, updatedAt: serverTimestamp(),
  }));
  const pesos = [JSON.stringify(servicio.lista).length];
  for (const t of servicio.turnos) {
    const datos = {
      ...t, org_id: orgId, servicioId: sid, fecha,
      conductorUid: null, conductorNombre: null, trabajadorId: null, inicioReal: null, finReal: null, real: { salidas: {}, llegadas: {}, saltados: [] }, actualizado: Date.now(),
    };
    ops.push(b => b.set(doc(turnosDe(sid), t.id), datos));
    pesos.push(JSON.stringify(datos).length);
  }
  for (const d of viejos.docs) if (!nuevos.has(d.id)) { ops.push(b => b.delete(d.ref)); pesos.push(100); }
  // en tandas pequeñas (~500 KB, 100 escrituras): Firestore rechaza los envíos grandes ("Transaction too big")
  let b = writeBatch(db), n = 0, bytes = 0;
  for (const [i, op] of ops.entries()) {
    if (n && (n >= 100 || bytes + pesos[i] > 5e5)) { await b.commit(); b = writeBatch(db); n = 0; bytes = 0; }
    op(b); n++; bytes += pesos[i];
  }
  if (n) await b.commit();
  return sid;
}
export async function borrarServicio(sid, orgId) {
  const viejos = await getDocs(query(turnosDe(sid), where("org_id", "==", orgId)));
  for (let i = 0; i < viejos.docs.length; i += 400) {
    const b = writeBatch(db);
    for (const d of viejos.docs.slice(i, i + 400)) b.delete(d.ref);
    await b.commit();
  }
  await deleteDoc(doc(db, "servicio_lineas", sid));
}
/** ¿Ya hay algo hecho en la calle en ese día publicado? (para avisar antes de volver a publicar) */
export async function hayAlgoHecho(sid, orgId) {
  const s = await getDocs(query(turnosDe(sid), where("org_id", "==", orgId)));
  return s.docs.some(d => d.data().inicioReal != null || d.data().conductorUid);
}

/** Días publicados de un proyecto (Control) → cb([{ _id, fecha, … }]) ordenados por fecha */
export function watchServiciosProyecto(projectId, orgId, cb) {
  if (!orgId) { cb([]); return () => {}; }
  const q = query(collection(db, "servicio_lineas"), where("org_id", "==", orgId), where("projectId", "==", projectId));
  return onSnapshot(q, s => cb(s.docs.map(d => ({ ...d.data(), _id: d.id })).sort((a, b) => a.fecha.localeCompare(b.fecha))), e => { console.error("servicios publicados:", e); cb([]); });
}
/** Servicios de la organización en esas fechas (app del conductor) */
export function watchServiciosFechas(orgId, fechas, cb) {
  if (!orgId) { cb([]); return () => {}; }
  const q = query(collection(db, "servicio_lineas"), where("org_id", "==", orgId), where("fecha", "in", fechas));
  return onSnapshot(q, s => cb(s.docs.map(d => ({ ...d.data(), _id: d.id }))), e => { console.error("servicios del día:", e); cb([]); });
}
/** Todos los turnos de un día publicado (Control) */
export function watchTurnos(sid, orgId, cb) {
  if (!sid || !orgId) { cb([]); return () => {}; }
  return onSnapshot(query(turnosDe(sid), where("org_id", "==", orgId)), s => cb(s.docs.map(d => ({ ...d.data(), _id: d.id }))), e => { console.error("turnos:", e); cb([]); });
}
/** Los turnos que tiene cogidos este conductor ese día */
export function watchMisTurnos(sid, orgId, uid, cb) {
  if (!sid || !orgId || !uid) { cb([]); return () => {}; }
  const q = query(turnosDe(sid), where("org_id", "==", orgId), where("conductorUid", "==", uid));
  return onSnapshot(q, s => cb(s.docs.map(d => ({ ...d.data(), _id: d.id }))), e => { console.error("mis turnos:", e); cb([]); });
}

/** El conductor coge un turno (si nadie lo tiene). Error con mensaje claro si ya es de otro. */
export async function cogerTurno(sid, turnoId, { uid, nombre }) {
  const ref = doc(turnosDe(sid), turnoId);
  await runTransaction(db, async tx => {
    const s = await tx.get(ref);
    if (!s.exists()) throw new Error("Ese turno ya no está publicado.");
    const d = s.data();
    if (d.conductorUid && d.conductorUid !== uid) throw new Error(`El ${turnoId} ya lo tiene ${d.conductorNombre || "otro conductor"}.`);
    tx.update(ref, { conductorUid: uid, conductorNombre: nombre || null, actualizado: Date.now() });
  });
}
export const dejarTurno = (sid, turnoId) => updateDoc(doc(turnosDe(sid), turnoId), { conductorUid: null, conductorNombre: null, actualizado: Date.now() });
export const empezarTurno = (sid, turnoId, min) => updateDoc(doc(turnosDe(sid), turnoId), { inicioReal: Math.round(min), finReal: null, actualizado: Date.now() });
export const terminarTurno = (sid, turnoId, min) => updateDoc(doc(turnosDe(sid), turnoId), { finReal: Math.round(min), actualizado: Date.now() });
/** Guarda lo real del turno (salidas, llegadas y viajes saltados) */
export const guardarReal = (sid, turnoId, real) => updateDoc(doc(turnosDe(sid), turnoId), { real, actualizado: Date.now() });

/** Posición del conductor de autobús (un documento por persona, se sobrescribe) */
export const escribirPosicion = (uid, datos) => setDoc(doc(db, "ubicaciones_lineas", uid), { ...datos, uid, updatedAt: Date.now() }, { merge: true });
export function watchPosiciones(orgId, sid, cb) {
  if (!orgId || !sid) { cb([]); return () => {}; }
  const q = query(collection(db, "ubicaciones_lineas"), where("org_id", "==", orgId), where("servicioId", "==", sid));
  return onSnapshot(q, s => cb(s.docs.map(d => ({ ...d.data(), _id: d.id }))), e => { console.error("posiciones:", e); cb([]); });
}

// ── Cada turno, de un trabajador: lo que asigna el Rostering ───────────
/** La plantilla de la empresa (scheduling_workers: nombre, apellidos y su usuario de la app, uid) */
export async function leerTrabajadores(orgId) {
  const s = await getDocs(query(collection(db, "scheduling_workers"), where("org_id", "==", orgId)));
  return s.docs.map(d => ({ ...d.data(), _id: d.id }));
}
/**
 * Pone en los turnos de un día publicado el trabajador que les ha asignado el
 * Rostering (porTurno: { T12: { trabajadorId, nombre, uid } }). Los turnos ya
 * empezados no se tocan; uno que el Rostering ha dejado sin nadie se queda
 * libre solo si lo había puesto el Rostering (si lo cogió un conductor en el
 * móvil, sigue siendo suyo). → { cambiados, empezados }
 */
export async function asignarTrabajadores(sid, orgId, porTurno) {
  const snap = await getDocs(query(turnosDe(sid), where("org_id", "==", orgId)));
  let b = writeBatch(db), n = 0, cambiados = 0, empezados = 0;
  for (const d of snap.docs) {
    const t = d.data(), a = porTurno[d.id] || null;
    if (t.inicioReal != null) { if (a && a.trabajadorId !== t.trabajadorId) empezados++; continue; }
    if (!a && !t.trabajadorId) continue;
    const nuevo = a ? { trabajadorId: a.trabajadorId, conductorUid: a.uid || null, conductorNombre: a.nombre || null } : { trabajadorId: null, conductorUid: null, conductorNombre: null };
    if ((t.trabajadorId ?? null) === nuevo.trabajadorId && (t.conductorUid ?? null) === nuevo.conductorUid && (t.conductorNombre ?? null) === nuevo.conductorNombre) continue;
    b.update(d.ref, { ...nuevo, actualizado: Date.now() });
    n++; cambiados++;
    if (n >= 400) { await b.commit(); b = writeBatch(db); n = 0; }
  }
  if (n) await b.commit();
  return { cambiados, empezados };
}
/** Lo del Rostering a un día publicado (servicio: { _id, fecha, dia }) → { asignados, sinUsuario, cambiados, empezados } */
export async function aplicarRosterAlServicio(servicio, orgId, asignaciones, trabajadores) {
  const d = Number(servicio.fecha.slice(8, 10));
  const porTurno = asignacionDelDia(asignaciones, trabajadores, d, servicio.dia);
  const r = await asignarTrabajadores(servicio._id, orgId, porTurno);
  const lista = Object.values(porTurno);
  return { ...r, asignados: lista.length, sinUsuario: lista.filter(a => !a.uid).length, porTurno };
}

/**
 * Publica en el móvil del conductor su cuadrante de líneas del mes (el mismo
 * documento que «Mi cuadrante» de Rutas: cuadrantes/{org}_{mes}_{uid}), con
 * el turno de cada día. Lo hace solo el Rostering al cambiar algo.
 */
export function publicarCuadranteLineas({ orgId, projectId, worker, year, month, dias }) {
  const mes = `${year}-${String(month).padStart(2, "0")}`;
  return setDoc(doc(db, "cuadrantes", `${orgId}_${mes}_${worker.uid}`), {
    org_id: orgId, uid: worker.uid, workerId: worker._id, nombre: [worker.nombre, worker.apellidos].filter(Boolean).join(" ") || "Trabajador",
    year, month, mes, dias, projectId: projectId || null, lineas: true, publicadoEn: Date.now(),
  });
}
/** Los cuadrantes publicados de este conductor (todos sus meses) */
export function watchMisCuadrantes(orgId, uid, cb) {
  if (!orgId || !uid) { cb([]); return () => {}; }
  const q = query(collection(db, "cuadrantes"), where("org_id", "==", orgId), where("uid", "==", uid));
  return onSnapshot(q, s => cb(s.docs.map(d => ({ ...d.data(), _id: d.id }))), e => { console.error("cuadrantes:", e); cb([]); });
}

/**
 * Los días publicados de un proyecto entre dos fechas, con sus turnos (para el
 * análisis de tiempos reales de Analytics). Lee una vez (no escucha): cada
 * turno es una lectura. → [{ fecha, dia, turnos: [{ viajes, real }] }]
 */
export async function leerRealPeriodo(projectId, orgId, desde, hasta) {
  const q = query(collection(db, "servicio_lineas"), where("org_id", "==", orgId), where("projectId", "==", projectId));
  const dias = (await getDocs(q)).docs.map(d => ({ ...d.data(), _id: d.id })).filter(s => s.fecha >= desde && s.fecha <= hasta).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const out = [];
  for (const s of dias) {
    const ts = await getDocs(query(turnosDe(s._id), where("org_id", "==", orgId)));
    out.push({ fecha: s.fecha, dia: s.dia, nombreDia: s.nombreDia, turnos: ts.docs.map(d => { const x = d.data(); return { viajes: x.viajes || [], real: x.real || {} }; }) });
  }
  return out;
}
