// GPS de las empresas: qué proveedores hay, qué datos pide cada uno, cómo se
// guarda la conexión (gps_conexiones/{orgId}) y cómo se piden las posiciones
// a /api/gps. La traducción de cada proveedor está en api/_gps/proveedores.js.
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase.js";

// tipo: el traductor del servidor (los de «JSON por URL» usan el genérico)
export const PROVEEDORES_GPS = [
  { id: "webfleet", tipo: "webfleet", nombre: "Webfleet (Bridgestone)", campos: [["cuenta", "Cuenta (account)"], ["usuario", "Usuario"], ["clave", "Contraseña", true], ["apikey", "Clave de API (apikey)", true]],
    ayuda: "Un usuario de WEBFLEET.connect con permiso de lectura. Lo crea el administrador de Webfleet de la empresa." },
  { id: "geotab", tipo: "geotab", nombre: "Geotab (MyGeotab)", campos: [["base", "Base de datos (empresa)"], ["usuario", "Usuario"], ["clave", "Contraseña", true], ["servidor", "Servidor (si no es my.geotab.com)"]],
    ayuda: "Un usuario de MyGeotab con permiso para ver vehículos. La base de datos es el nombre de la empresa en MyGeotab." },
  { id: "samsara", tipo: "samsara", nombre: "Samsara", campos: [["token", "Token de API", true]],
    ayuda: "En Samsara: Ajustes → Tokens de API, con permiso de lectura de vehículos." },
  { id: "movildata", tipo: "generico", nombre: "Movildata", generico: true,
    ayuda: "Pide a Movildata la dirección de su API de posiciones y la clave. Se rellena como «Otro GPS»." },
  { id: "frotcom", tipo: "generico", nombre: "Frotcom", generico: true,
    ayuda: "Pide a Frotcom acceso a su API (posiciones de los vehículos). Se rellena como «Otro GPS»." },
  { id: "verizon", tipo: "generico", nombre: "Verizon Connect", generico: true,
    ayuda: "Pide a Verizon Connect acceso a su API de posiciones. Se rellena como «Otro GPS»." },
  { id: "generico", tipo: "generico", nombre: "Otro GPS (JSON por URL)", generico: true,
    ayuda: "Una dirección https que devuelva los vehículos en JSON, y dónde está cada dato (por ejemplo «gps.latitude»)." },
];
export const CAMPOS_GENERICO = [["url", "Dirección (https://…)"], ["cabecera", "Cabecera de acceso (p. ej. «Authorization: Bearer …»)", true], ["lista", "Dónde está la lista (p. ej. «data»)"]];
export const RUTAS_GENERICO = [["id", "Identificador"], ["nombre", "Nombre"], ["matricula", "Matrícula"], ["lat", "Latitud"], ["lng", "Longitud"], ["velocidad", "Velocidad (km/h)"], ["hora", "Hora"], ["odometro", "Cuentakilómetros (km)"]];

export const proveedorGps = id => PROVEEDORES_GPS.find(p => p.id === id) || null;

export function escucharConexionGps(orgId, cb) {
  if (!orgId) return () => {};
  return onSnapshot(doc(db, "gps_conexiones", orgId), s => cb(s.exists() ? s.data() : null), () => cb(null));
}

export const guardarConexionGps = (orgId, datos) =>
  setDoc(doc(db, "gps_conexiones", orgId), { ...datos, org_id: orgId, actualizado: Date.now() });

/** Vehículos del GPS con su posición: [{ id, nombre, matricula, lat, lng, velocidad, rumbo, hora, odometroKm }] */
export async function pedirPosicionesGps(conexion) {
  const p = proveedorGps(conexion?.proveedor);
  if (!p) throw new Error("Elige el GPS");
  const token = await auth.currentUser?.getIdToken();
  const r = await fetch("/api/gps", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
    body: JSON.stringify({ proveedor: p.tipo, cred: conexion.cred || {} }),
  });
  let d = {};
  try { d = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) throw new Error(d.error || `El servidor respondió ${r.status}`);
  return d.vehiculos || [];
}

const limpia = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Cada vehículo del GPS con el de la flota de Operanzia: el que se eligió a
 * mano (enlaces: gpsId → vehicleId) o, si no, el de la misma matrícula o nombre.
 * @returns Map gpsId → vehículo de la flota (o null)
 */
export function emparejarGps(delGps = [], flota = [], enlaces = {}) {
  const porId = new Map(flota.map(v => [v._id, v]));
  const porClave = new Map();
  for (const v of flota) for (const k of [v.matricula, v.nombre]) if (limpia(k)) porClave.set(limpia(k), v);
  const out = new Map();
  for (const g of delGps) {
    const manual = enlaces[g.id];
    if (manual === "") { out.set(g.id, null); continue; } // «sin vehículo», elegido a mano
    out.set(g.id, (manual && porId.get(manual)) || porClave.get(limpia(g.matricula)) || porClave.get(limpia(g.nombre)) || null);
  }
  return out;
}
