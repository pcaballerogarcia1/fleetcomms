// GPS de las empresas · la parte del servidor, sin Vercel (se prueba sola).
// Cada proveedor devuelve sus vehículos con su última posición en el mismo
// formato:
//   { id, nombre, matricula, lat, lng, velocidad (km/h), rumbo (º), hora (ms), odometroKm }
// No se guarda nada: Control lo pide mientras está abierto (ver api/gps.js).
//
// Hechos según la documentación pública de cada uno, SIN PROBAR todavía con
// una cuenta real: al conectar el primer cliente de cada proveedor hay que
// revisar los nombres de los campos.

export class GpsError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const num = v => (v == null || v === "" || !Number.isFinite(+v) ? null : +v);
const hora = v => { if (v == null || v === "") return null; const t = typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v); return Number.isFinite(t) ? t : null; };
const valida = p => p.lat != null && p.lng != null && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);
const texto = (v, n = 120) => (v == null ? "" : String(v).slice(0, n));
const MAX = 2000; // vehículos por empresa

async function leerJson(r, quien) {
  const t = await r.text();
  if (r.status === 401 || r.status === 403) throw new GpsError(401, `${quien} no acepta el usuario o la clave`);
  if (!r.ok) throw new GpsError(502, `${quien} respondió con un error (${r.status})`);
  try { return JSON.parse(t); } catch { throw new GpsError(502, `${quien} no devolvió datos legibles`); }
}

/** Lee un campo por su ruta («gps.latitude», «data.0.id») */
export function campo(obj, ruta) {
  if (!ruta) return undefined;
  return String(ruta).split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// ── Webfleet (Bridgestone) · WEBFLEET.connect ──────────────────────────
// showObjectReportExtern: objectno, objectname, latitude_mdeg, longitude_mdeg
// (millonésimas de grado), pos_time, speed (km/h), course, odometer (en 100 m).
async function webfleet(c, fetchFn) {
  const q = new URLSearchParams({ account: c.cuenta, username: c.usuario, password: c.clave, apikey: c.apikey || "", lang: "es",
    action: "showObjectReportExtern", outputformat: "json", useISO8601: "true" });
  const d = await leerJson(await fetchFn(`https://csv.webfleet.com/extern?${q}`), "Webfleet");
  if (d && !Array.isArray(d) && (d.errorCode || d.errorMsg)) throw new GpsError(d.errorCode === 8011 || /auth|password|user/i.test(d.errorMsg || "") ? 401 : 502, `Webfleet: ${d.errorMsg || d.errorCode}`);
  return (Array.isArray(d) ? d : []).map(o => ({
    id: texto(o.objectno || o.objectuid), nombre: texto(o.objectname || o.objectno), matricula: texto(o.licenseplatenumber || ""),
    lat: num(o.latitude_mdeg) != null ? o.latitude_mdeg / 1e6 : num(o.latitude), lng: num(o.longitude_mdeg) != null ? o.longitude_mdeg / 1e6 : num(o.longitude),
    velocidad: num(o.speed), rumbo: num(o.course), hora: hora(o.pos_time || o.msgtime), odometroKm: num(o.odometer) != null ? o.odometer / 10 : null,
  }));
}

// ── Geotab · MyGeotab API (JSON-RPC) ──────────────────────────────────
// Authenticate → credentials; Get DeviceStatusInfo (posición) y Device (nombre, matrícula).
async function geotab(c, fetchFn) {
  const servidor = /^[a-z0-9.-]+$/i.test(c.servidor || "") ? c.servidor : "my.geotab.com";
  const rpc = async (host, method, params) => {
    const d = await leerJson(await fetchFn(`https://${host}/apiv1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method, params }) }), "Geotab");
    if (d.error) throw new GpsError(/Invalid|Authentication/i.test(d.error.message || d.error.name || "") ? 401 : 502, `Geotab: ${d.error.message || d.error.name}`);
    return d.result;
  };
  const auth = await rpc(servidor, "Authenticate", { database: c.base, userName: c.usuario, password: c.clave });
  const host = auth?.path && auth.path !== "ThisServer" ? auth.path : servidor;
  const [estados, equipos] = await rpc(host, "ExecuteMultiCall", { credentials: auth.credentials, calls: [
    { method: "Get", params: { typeName: "DeviceStatusInfo" } },
    { method: "Get", params: { typeName: "Device", resultsLimit: MAX } },
  ] });
  const porId = new Map((equipos || []).map(e => [e.id, e]));
  return (estados || []).map(s => {
    const e = porId.get(s.device?.id) || {};
    return { id: texto(s.device?.id), nombre: texto(e.name || s.device?.id), matricula: texto(e.licensePlate || ""),
      lat: num(s.latitude), lng: num(s.longitude), velocidad: num(s.speed), rumbo: num(s.bearing), hora: hora(s.dateTime), odometroKm: null };
  });
}

// ── Samsara · REST ─────────────────────────────────────────────────────
// /fleet/vehicles/stats?types=gps,obdOdometerMeters (token de API).
async function samsara(c, fetchFn) {
  const fuera = [];
  let after = "";
  for (let i = 0; i < 4; i++) {
    const d = await leerJson(await fetchFn(`https://api.samsara.com/fleet/vehicles/stats?types=gps,obdOdometerMeters${after ? `&after=${encodeURIComponent(after)}` : ""}`,
      { headers: { Authorization: `Bearer ${c.token}` } }), "Samsara");
    for (const v of d.data || []) {
      fuera.push({ id: texto(v.id), nombre: texto(v.name || v.id), matricula: texto(v.licensePlate || ""),
        lat: num(v.gps?.latitude), lng: num(v.gps?.longitude), velocidad: num(v.gps?.speedMilesPerHour) != null ? Math.round(v.gps.speedMilesPerHour * 1.609344) : null,
        rumbo: num(v.gps?.headingDegrees), hora: hora(v.gps?.time), odometroKm: num(v.obdOdometerMeters?.value) != null ? Math.round(v.obdOdometerMeters.value / 1000) : null });
    }
    if (!d.pagination?.hasNextPage || !d.pagination?.endCursor) break;
    after = d.pagination.endCursor;
  }
  return fuera;
}

// ── Cualquier otro (Movildata, Frotcom, Verizon Connect…) · JSON por URL ──
// La empresa (o su proveedor) da una dirección que devuelve sus vehículos en
// JSON, y se dice dónde está cada dato. Solo https y a internet (no a la red interna).
export function urlPermitida(u) {
  let url;
  try { url = new URL(u); } catch { return false; }
  if (url.protocol !== "https:") return false;
  const h = url.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return false;
  }
  if (h.startsWith("[") || h.includes(":")) return false; // IPv6 literal
  return true;
}
async function generico(c, fetchFn) {
  if (!urlPermitida(c.url)) throw new GpsError(400, "La dirección tiene que empezar por https:// y ser de internet");
  const headers = {};
  if (c.cabecera) { const i = String(c.cabecera).indexOf(":"); if (i > 0) headers[c.cabecera.slice(0, i).trim()] = c.cabecera.slice(i + 1).trim(); }
  const d = await leerJson(await fetchFn(c.url, { headers }), "El GPS");
  const lista = c.lista ? campo(d, c.lista) : d;
  if (!Array.isArray(lista)) throw new GpsError(502, `No hay una lista de vehículos${c.lista ? ` en «${c.lista}»` : ""}`);
  const k = { id: "id", nombre: "nombre", matricula: "matricula", lat: "lat", lng: "lng", velocidad: "velocidad", hora: "hora", odometro: "", ...(c.campos || {}) };
  return lista.map(o => ({ id: texto(campo(o, k.id)), nombre: texto(campo(o, k.nombre) ?? campo(o, k.id)), matricula: texto(campo(o, k.matricula) ?? ""),
    lat: num(campo(o, k.lat)), lng: num(campo(o, k.lng)), velocidad: num(campo(o, k.velocidad)), rumbo: null, hora: hora(campo(o, k.hora)),
    odometroKm: k.odometro ? num(campo(o, k.odometro)) : null }));
}

// Qué pide cada uno (lo mismo enseña la pantalla de conexión, src/gps/proveedores.js)
export const PROVEEDORES = {
  webfleet: { leer: webfleet, piden: ["cuenta", "usuario", "clave"] },
  geotab: { leer: geotab, piden: ["base", "usuario", "clave"] },
  samsara: { leer: samsara, piden: ["token"] },
  generico: { leer: generico, piden: ["url"] },
};

/** Vehículos con posición, en el formato común; GpsError si algo falla */
export async function posiciones(proveedor, cred, fetchFn = globalThis.fetch) {
  const p = PROVEEDORES[proveedor];
  if (!p) throw new GpsError(400, "Proveedor de GPS desconocido");
  const falta = p.piden.filter(k => !String(cred?.[k] ?? "").trim());
  if (falta.length) throw new GpsError(400, `Falta: ${falta.join(", ")}`);
  let lista;
  try { lista = await p.leer(cred, fetchFn); } catch (e) {
    if (e instanceof GpsError) throw e;
    throw new GpsError(502, `No se pudo conectar con el GPS: ${e.message || e}`);
  }
  return lista.filter(valida).slice(0, MAX);
}
