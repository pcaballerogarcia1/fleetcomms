// Fichar solo cerca de un depot.
// Los depots viven en cada proyecto (planning_depots/{proyecto}), que el
// conductor no puede leer. Aquí se mantiene una lista por empresa que sí
// puede leer: depots_fichaje/{org}.porProyecto.{proyecto}.{depot} = { nombre, lat, lng }.
// La pone al día la oficina cada vez que abre un proyecto o cambia sus depots
// (workspace.jsx). Las plantas de descarga no cuentan: ahí no se ficha.
// Sin depots configurados se ficha como siempre (si no, nadie podría fichar).
// Las reglas de Firestore comprueban lo mismo (con un margen cuadrado), así que
// tampoco se puede fichar lejos saltándose la app.
import { deleteField, doc, FieldPath, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { db } from "./firebase.js";

// (aquí y no de vrp-engine.js: la app del conductor no carga el motor de rutas)
const hasCoords = (lat, lng) => lat != null && lng != null && isFinite(+lat) && isFinite(+lng) && (+lat !== 0 || +lng !== 0);
function haversineKm(lat1, lng1, lat2, lng2) {
  const r = x => (x * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const RADIO_FICHAJE_M = 1000;

/** Los depots de un proyecto que cuentan para fichar: { [id]: { nombre, lat, lng } } */
export function lugaresDeProyecto(depots = []) {
  const out = {};
  depots.forEach((d, i) => {
    if (d?.planta || !hasCoords(d?.lat, d?.lng)) return;
    out[String(d.id ?? i)] = { nombre: d.nombre || `Depot ${i + 1}`, lat: +d.lat, lng: +d.lng };
  });
  return out;
}

const escritos = new Map(); // proyecto → texto de lo último escrito en esta sesión
/** La oficina deja al día los depots de un proyecto en la lista de la empresa */
export async function sincronizarDepotsFichaje(orgId, projectId, depots) {
  if (!orgId || !projectId) return;
  const lugares = lugaresDeProyecto(depots);
  const texto = JSON.stringify(lugares);
  if (escritos.get(projectId) === texto) return;
  const ref = doc(db, "depots_fichaje", orgId);
  const valor = Object.keys(lugares).length ? lugares : deleteField();
  try { await updateDoc(ref, new FieldPath("porProyecto", projectId), valor); }
  catch (e) {
    if (e?.code !== "not-found") throw e;
    if (!Object.keys(lugares).length) { escritos.set(projectId, texto); return; }
    await setDoc(ref, { org_id: orgId, porProyecto: { [projectId]: lugares } }, { merge: true });
  }
  escritos.set(projectId, texto);
}

/** Todos los depots de la empresa, en una lista: [{ p, d, nombre, lat, lng }] */
export function escucharDepotsFichaje(orgId, cb) {
  if (!orgId) { cb([]); return () => {}; }
  return onSnapshot(doc(db, "depots_fichaje", orgId), s => cb(listaLugares(s.exists() ? s.data().porProyecto : null)), () => cb([]));
}
export const listaLugares = porProyecto => Object.entries(porProyecto || {})
  .flatMap(([p, ds]) => Object.entries(ds || {}).map(([d, l]) => ({ p, d, ...l })));

/** El depot más cercano a una posición: { lugar, distanciaM } o null */
export function depotMasCercano(lugares, lat, lng) {
  let mejor = null;
  for (const l of lugares) {
    const m = haversineKm(lat, lng, l.lat, l.lng) * 1000;
    if (!mejor || m < mejor.distanciaM) mejor = { lugar: l, distanciaM: Math.round(m) };
  }
  return mejor;
}

/** Posición del móvil ahora mismo (con GPS si lo hay) */
export function posicionActual() {
  return new Promise((ok, mal) => {
    if (!navigator.geolocation) { mal(new Error("Este móvil no da la ubicación")); return; }
    navigator.geolocation.getCurrentPosition(
      p => ok({ lat: p.coords.latitude, lng: p.coords.longitude, precision: Math.round(p.coords.accuracy || 0) }),
      e => mal(new Error(e.code === 1 ? "Activa el permiso de ubicación para fichar" : "No se ha podido saber dónde estás; prueba otra vez al aire libre")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 },
    );
  });
}

const km = m => (m >= 1000 ? `${(m / 1000).toFixed(1).replace(".", ",")} km` : `${m} m`);

/**
 * Comprueba si se puede fichar aquí.
 * @returns { lugar: null } si la empresa no tiene depots (se ficha como siempre),
 *          { lugar: { p, d, nombre, lat, lng, distanciaM, precision } } si estás cerca,
 *          o lanza un error con el motivo (lejos, sin ubicación).
 */
export async function comprobarLugarFichaje(lugares) {
  if (!lugares?.length) return { lugar: null };
  const pos = await posicionActual();
  const cerca = depotMasCercano(lugares, pos.lat, pos.lng);
  if (cerca.distanciaM > RADIO_FICHAJE_M) {
    throw new Error(`Estás a ${km(cerca.distanciaM)} de ${cerca.lugar.nombre}, el depot más cercano. Solo se puede fichar a menos de ${km(RADIO_FICHAJE_M)} de un depot.`);
  }
  return { lugar: { p: cerca.lugar.p, d: cerca.lugar.d, nombre: cerca.lugar.nombre, lat: pos.lat, lng: pos.lng, distanciaM: cerca.distanciaM, precision: pos.precision } };
}
