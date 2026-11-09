// Conectar con IA (MCP) · el entorno: qué proyecto de Firebase usa este
// despliegue y desde qué dirección se le llama. Las vistas previas de Vercel
// (rama pruebas) van contra el proyecto de pruebas, igual que la app
// (vite.config.js); producción, contra el real. Las claves web de Firebase
// son públicas (van en la app); la seguridad la ponen las reglas.

const PRODUCCION = { apiKey: "AIzaSyDqzT7OqBTlNApkB_ERriA6Eag7MQLMQcM", projectId: "fleetcomms-13d89" };
const PRUEBAS = { apiKey: "AIzaSyDfsCXOt8HZGZjdgEKl7b8oh_1frAwyFnk", projectId: "operanzia-pruebas" };

/** { apiKey, projectId } del proyecto de Firebase de este despliegue */
export function firebaseDelEntorno(env = globalThis.process?.env || {}) {
  if (env.IA_FIREBASE_API_KEY && env.IA_FIREBASE_PROJECT_ID) return { apiKey: env.IA_FIREBASE_API_KEY, projectId: env.IA_FIREBASE_PROJECT_ID };
  const pruebas = env.VERCEL_ENV === "preview" || env.ENTORNO === "pruebas";
  return pruebas ? PRUEBAS : PRODUCCION;
}

/** «https://app.operanzia.com»: la dirección pública desde la que se llama (también en las vistas previas) */
export function origenDe(req) {
  const h = req?.headers || {};
  const host = String(h["x-forwarded-host"] || h.host || "app.operanzia.com").split(",")[0].trim();
  const proto = String(h["x-forwarded-proto"] || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https")).split(",")[0].trim();
  return `${proto}://${host}`;
}

/** Fecha «AAAA-MM-DD» y hora (minutos) de ahora en España (el servidor va en UTC) */
export function ahoraEnEspana(ahora = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(ahora).map(x => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, minutos: Number(p.hour) * 60 + Number(p.minute) };
}

/** Minutos del día en España de un instante (ms) */
export const minutosEnEspana = ms => ahoraEnEspana(new Date(ms)).minutos;
