// Datos de prueba en los EMULADORES de Firebase (nunca en producción): una
// organización de demo con sus usuarios, un plan con paradas, una
// incidencia, stock, flota y plantilla. Lo usan las pruebas de extremo a
// extremo (e2e/*.spec.js) y el medidor de lecturas (e2e/medir.spec.js).

export const PROYECTO = "demo-operanzia";
const FS = `http://127.0.0.1:8080/v1/projects/${PROYECTO}/databases/(default)/documents`;
const AUTH = "http://127.0.0.1:9099";
export const CLAVE = "Prueba-123";
export const ORG = "demo";
export const USUARIOS = {
  admin: { email: "admin@demo.test", rol: "admin", nombre: "Ana", apellidos: "Admin" },
  jefe: { email: "jefe@demo.test", rol: "intermedio", nombre: "Iván", apellidos: "Intermedio" },
  cond1: { email: "cond1@demo.test", rol: "conductor", nombre: "Carlos", apellidos: "Conductor" },
  cond2: { email: "cond2@demo.test", rol: "conductor", nombre: "Clara", apellidos: "Conductora" },
};
export const mesActual = () => new Date().toISOString().slice(0, 7);

// JSON → formato REST de Firestore
export function valor(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() }; // como serverTimestamp()
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valor) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valor(x)])) } };
}
function desValor(v) {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(desValor);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, desValor(x)]));
  return v;
}
const owner = { Authorization: "Bearer owner", "Content-Type": "application/json" };

export async function escribir(ruta, datos) {
  const r = await fetch(`${FS}/${ruta}`, { method: "PATCH", headers: owner, body: JSON.stringify({ fields: valor(datos).mapValue.fields }) });
  if (!r.ok) throw new Error(`semilla ${ruta}: ${r.status} ${await r.text()}`);
}
export async function leer(ruta) {
  const r = await fetch(`${FS}/${ruta}`, { headers: owner });
  if (r.status === 404) return null;
  const j = await r.json();
  return desValor({ mapValue: { fields: j.fields || {} } });
}
export async function listar(coleccion) {
  const r = await fetch(`${FS}/${coleccion}?pageSize=300`, { headers: owner });
  const j = await r.json();
  return (j.documents || []).map(d => ({ _id: d.name.split("/").pop(), ...desValor({ mapValue: { fields: d.fields || {} } }) }));
}

async function vaciar() {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`${AUTH}/emulator/v1/projects/${PROYECTO}/accounts`, { method: "DELETE" });
}
async function crearCuenta(email) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: CLAVE, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.localId) throw new Error(`cuenta ${email}: ${JSON.stringify(j)}`);
  return j.localId;
}

/** Deja los emuladores con los datos de demo. Devuelve { uids } */
export async function sembrar() {
  await vaciar();
  const uids = {};
  await escribir(`orgs/${ORG}`, { nombre: "Demo", org_id: ORG, activo: true, max_usuarios: 50, plan: "pro" });
  for (const [k, u] of Object.entries(USUARIOS)) {
    uids[k] = await crearCuenta(u.email);
    await escribir(`usuarios/${uids[k]}`, { ...u, org_id: ORG, activo: true });
  }
  const mes = mesActual();
  const paradas = Array.from({ length: 5 }, (_, i) => ({
    id: i + 1, nombre: `Parada ${i + 1}`, calle: `Calle ${i + 1}`, num: String(i + 1), barri: "Centro",
    lat: 40.41 + i * 0.002, lng: -3.70 + i * 0.002, elementos: [], realizado: false, orden: i + 1,
  }));
  await escribir("planes/plan-cond1", {
    org_id: ORG, tipo: "prev", nombre: "Ruta de prueba", mes, diaServicio: "Día 01", conductorUid: uids.cond1,
    conductorNombre: "Carlos Conductor", ubicaciones: paradas, fechaSubida: Date.now(), archivo: "semilla",
  });
  await escribir("planes/plan-compartido", {
    org_id: ORG, tipo: "prev", nombre: "Ruta compartida", mes, diaServicio: "Día 02", conductorUid: null,
    ubicaciones: paradas.map(p => ({ ...p })), fechaSubida: Date.now() - 1000, archivo: "semilla",
  });
  await escribir("planes/tarea-corr", { org_id: ORG, tipo: "corr", titulo: "Cambiar pastillas de freno", estado: "pendiente", conductorUid: null, fecha: new Date() });
  await escribir("incidencias/inc-1", { org_id: ORG, titulo: "Pinchazo", descripcion: "Rueda trasera", categoria: 0, prioridad: "media", estado: "abierta", comentarios: [], usuarioId: uids.cond1, fecha: new Date() });
  await escribir("inventario/prod-1", { org_id: ORG, nombre: "Filtro de aceite", referencia: "FA-1", categoria: "Filtros", unidad: "ud", stock: 10, stockMin: 2, ubicacion: "A1" });
  for (let i = 1; i <= 3; i++) {
    await escribir(`scheduling_vehicles/v${i}`, { org_id: ORG, nombre: `Camión ${i}`, matricula: `000${i}ABC`, activo: true });
    await escribir(`scheduling_workers/w${i}`, { org_id: ORG, nombre: `Trabajador ${i}`, apellidos: "Demo", activo: true });
  }
  await escribir("scheduling_projects/p-puntos", { org_id: ORG, nombre: "Proyecto de puntos", tipo: "puntos", mes, createdAt: Date.now(), status: "borrador" });
  return { uids };
}

// Escritura en lote (hasta 500 por petición) para la semilla grande
async function escribirLote(docs) {
  for (let i = 0; i < docs.length; i += 400) {
    const writes = docs.slice(i, i + 400).map(([ruta, datos]) => ({
      update: { name: `projects/${PROYECTO}/databases/(default)/documents/${ruta}`, fields: valor(datos).mapValue.fields },
    }));
    const r = await fetch(`${FS}:commit`, { method: "POST", headers: owner, body: JSON.stringify({ writes }) });
    if (!r.ok) throw new Error(`lote: ${r.status} ${await r.text()}`);
  }
}

/**
 * La semilla normal más el volumen de un cliente mediano: 3 meses de rutas,
 * 40 trabajadores, 25 vehículos, incidencias, inventario, 2.000 líneas de
 * historial, 1.000 fichajes y 20 conductores con ubicación en vivo. Para el
 * medidor de lecturas (e2e/medir.spec.js): así se ve qué pantallas crecen
 * con los datos.
 */
export async function sembrarGrande() {
  const { uids } = await sembrar();
  const docs = [];
  const hoy = new Date();
  const meses = [0, 1, 2].map(k => new Date(hoy.getFullYear(), hoy.getMonth() - k, 15).toISOString().slice(0, 7));
  const conductores = Array.from({ length: 20 }, (_, i) => (i === 0 ? uids.cond1 : `cond-falso-${i}`));
  for (let i = 0; i < 600; i++) {
    const mes = meses[i % 3];
    docs.push([`planes/pl-${i}`, {
      org_id: ORG, tipo: ["prev", "ext", "int"][i % 3], nombre: `Ruta ${i}`, mes, diaServicio: `Día ${String((i % 28) + 1).padStart(2, "0")}`,
      conductorUid: i % 10 === 0 ? null : conductores[i % 20], fechaSubida: Date.now() - i * 60000, archivo: "semilla",
      ubicaciones: Array.from({ length: 30 }, (_, k) => ({ id: k + 1, calle: `Calle ${k}`, barri: "Centro", lat: 40.4 + k / 1000, lng: -3.7, elementos: [], realizado: k < (i % 30) })),
    }]);
  }
  for (let i = 4; i <= 40; i++) docs.push([`scheduling_workers/w${i}`, { org_id: ORG, nombre: `Trabajador ${i}`, apellidos: "Demo", activo: true }]);
  for (let i = 4; i <= 25; i++) docs.push([`scheduling_vehicles/v${i}`, { org_id: ORG, nombre: `Camión ${i}`, matricula: `${1000 + i}XYZ`, activo: true }]);
  for (let i = 0; i < 150; i++) docs.push([`incidencias/i-${i}`, { org_id: ORG, titulo: `Incidencia ${i}`, estado: i % 4 ? "cerrada" : "abierta", prioridad: "media", categoria: 0, comentarios: [], usuarioId: uids.cond1, fecha: new Date(Date.now() - i * 86400_000) }]);
  for (let i = 0; i < 80; i++) docs.push([`inventario/pr-${i}`, { org_id: ORG, nombre: `Recambio ${i}`, referencia: `R-${i}`, categoria: "Filtros", unidad: "ud", stock: 20, stockMin: 3 }]);
  for (let i = 0; i < 400; i++) docs.push([`movimientos/m-${i}`, { org_id: ORG, productoId: `pr-${i % 80}`, tipo: "salida", cantidad: 1, stockAntes: 20, stockDespues: 19, usuarioId: uids.cond1, fecha: new Date(Date.now() - i * 3600_000) }]);
  for (let i = 0; i < 2000; i++) docs.push([`auditoria/a-${i}`, { org_id: ORG, uid: uids.admin, nombre: "Ana Admin", modulo: ["Planning", "Scheduling", "Rostering"][i % 3], accion: "Cambio de prueba", atMs: Date.now() - i * 3600_000 }]);
  for (let i = 0; i < 1000; i++) {
    const entrada = Date.now() - Math.floor(i / 20) * 86400_000 - 8 * 3600_000;
    docs.push([`fichajes/f-${i}`, { org_id: ORG, uid: conductores[i % 20], fecha: new Date(entrada).toISOString().slice(0, 10), estado: "cerrado", horaEntrada: entrada, horaSalida: entrada + 8 * 3600_000, kmRecorridos: 120, nombre: `Conductor ${i % 20}` }]);
  }
  for (let i = 0; i < 20; i++) docs.push([`ubicaciones_activas/${conductores[i]}`, { org_id: ORG, uid: conductores[i], lat: 40.4 + i / 100, lng: -3.7, at: Date.now() }]);
  await escribirLote(docs);
  return { uids, documentos: docs.length };
}
