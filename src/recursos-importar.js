// Planning → Recursos: subir vehículos y trabajadores desde un Excel o CSV.
// Se entienden los nombres de columna habituales («Matrícula», «Tipo»,
// «Turno», «Vehículo»…). Lo que ya existe se actualiza en vez de duplicarse:
// los vehículos por matrícula (o por nombre si no tienen), los trabajadores
// por nombre y apellidos. Un trabajador se vincula a su vehículo por la
// matrícula o el nombre del vehículo. Sin React ni Firebase.
import { TURNO_TYPES } from "./scheduling/estilo.js";

const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const texto = v => String(v ?? "").trim();

/** El valor de la primera columna cuyo nombre encaje (sin acentos ni mayúsculas) */
function col(fila, nombres) {
  const claves = Object.keys(fila || {});
  for (const n of nombres) {
    const k = claves.find(c => norm(c) === n);
    if (k != null && texto(fila[k])) return texto(fila[k]);
  }
  return "";
}
// números a la española: «12.000» son doce mil, «39,57» es 39.57 (un número de Excel llega tal cual)
const num = v => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let t = String(v ?? "").trim().replace(/\s/g, "");
  if (!t) return null;
  if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "").replace(",", ".");
  else if (t.includes(",")) t = t.replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
};

/** «mañana», «M», «06-14», «tarde»… → uno de los turnos de la app */
export function turnoDe(v, defecto = "Jornada completa") {
  const x = norm(v);
  if (!x) return defecto;
  if (/^(m|manana|turno manana|06 14|6 14)$/.test(x) || x.startsWith("manana")) return TURNO_TYPES[0];
  if (/^(t|tarde|turno tarde|14 22)$/.test(x) || x.startsWith("tarde")) return TURNO_TYPES[1];
  if (/^(n|noche|turno noche|22 06|22 6)$/.test(x) || x.startsWith("noche")) return TURNO_TYPES[2];
  if (/jornada|completa|partid|^j$|^jc$/.test(x)) return TURNO_TYPES[3];
  return defecto;
}

const C_VEH = {
  nombre: ["nombre", "vehiculo", "nombre vehiculo", "codigo", "id", "unidad", "camion"],
  matricula: ["matricula", "placa", "registration", "plate"],
  tipo: ["tipo", "tipo vehiculo", "tipo de vehiculo", "modelo", "clase"],
  capacidad: ["capacidad", "capacidad kg", "capacidad m3", "carga", "litros"],
  turno: ["turno", "jornada", "horario"],
  lat: ["lat", "latitud", "base lat", "deposito lat", "depot lat"],
  lng: ["lng", "lon", "longitud", "base lng", "deposito lng", "depot lng"],
};
const C_TRAB = {
  nombre: ["nombre", "name", "trabajador", "conductor", "operario"],
  apellidos: ["apellidos", "apellido", "apellido 1", "surname"],
  completo: ["nombre completo", "nombre y apellidos", "empleado"],
  turno: ["turno", "jornada", "horario"],
  rol: ["rol", "puesto", "categoria", "cargo"],
  vehiculo: ["vehiculo", "matricula", "camion", "vehiculo asignado", "unidad"],
  lat: ["lat", "latitud"],
  lng: ["lng", "lon", "longitud"],
};

/** Las filas de un Excel de vehículos → { vehiculos, ignorados: [{ fila, motivo }] } */
export function leerVehiculos(filas) {
  const vehiculos = [], ignorados = [];
  (filas || []).forEach((f, i) => {
    const matricula = col(f, C_VEH.matricula).toUpperCase().replace(/\s+/g, "");
    const nombre = col(f, C_VEH.nombre) || matricula;
    if (!nombre) { ignorados.push({ fila: i + 2, motivo: "sin nombre ni matrícula" }); return; }
    const lat = num(col(f, C_VEH.lat)), lng = num(col(f, C_VEH.lng));
    vehiculos.push({
      nombre, matricula, tipo: col(f, C_VEH.tipo) || "Otro", turno: turnoDe(col(f, C_VEH.turno)),
      capacidad: Math.round(num(col(f, C_VEH.capacidad)) || 0),
      depotLat: lat != null && lng != null ? lat : null, depotLng: lat != null && lng != null ? lng : null,
    });
  });
  return { vehiculos, ignorados };
}

/** Las filas de un Excel de trabajadores → { trabajadores, ignorados } (vehiculo: texto para buscarlo luego) */
export function leerTrabajadores(filas) {
  const trabajadores = [], ignorados = [];
  (filas || []).forEach((f, i) => {
    let nombre = col(f, C_TRAB.nombre), apellidos = col(f, C_TRAB.apellidos);
    const completo = col(f, C_TRAB.completo);
    if (!nombre && completo) { const p = completo.split(/\s+/); nombre = p[0]; apellidos = apellidos || p.slice(1).join(" "); }
    if (!nombre) { ignorados.push({ fila: i + 2, motivo: "sin nombre" }); return; }
    const lat = num(col(f, C_TRAB.lat)), lng = num(col(f, C_TRAB.lng));
    trabajadores.push({
      nombre, apellidos, turno: turnoDe(col(f, C_TRAB.turno), TURNO_TYPES[0]),
      rol: (col(f, C_TRAB.rol) || "conductor").toLowerCase(), vehiculo: col(f, C_TRAB.vehiculo),
      depotLat: lat != null && lng != null ? lat : null, depotLng: lat != null && lng != null ? lng : null,
    });
  });
  return { trabajadores, ignorados };
}

const claveVeh = v => (v.matricula ? `m:${norm(v.matricula)}` : `n:${norm(v.nombre)}`);
const claveTrab = t => norm(`${t.nombre} ${t.apellidos || ""}`);

/**
 * Qué hay que hacer con los vehículos leídos frente a los que ya hay.
 * @returns { nuevos: [datos], cambios: [{ id, datos }] }
 */
export function planVehiculos(leidos, existentes = []) {
  // el mismo vehículo: misma matrícula si los dos la tienen; si no, el mismo nombre
  const mismo = (e, v) => (e.matricula && v.matricula ? norm(e.matricula) === norm(v.matricula) : norm(e.nombre) === norm(v.nombre));
  const nuevos = [], cambios = [], vistos = new Set();
  for (const v of leidos) {
    const k = claveVeh(v);
    if (vistos.has(k)) continue; // repetido en el propio archivo
    vistos.add(k);
    const ya = existentes.find(e => mismo(e, v));
    if (ya) cambios.push({ id: ya._id, datos: v });
    else nuevos.push(v);
  }
  return { nuevos, cambios };
}

/**
 * Lo mismo con los trabajadores; el vehículo se busca por matrícula o nombre.
 * @returns { nuevos, cambios, sinVehiculo: [nombre del vehículo que no se encontró] }
 */
export function planTrabajadores(leidos, existentes = [], vehiculos = []) {
  const porClave = new Map(existentes.map(t => [claveTrab(t), t]));
  const buscarVeh = txt => {
    const x = norm(txt);
    if (!x) return null;
    return vehiculos.find(v => norm(v.matricula) === x || norm(v.matricula).replace(/ /g, "") === x.replace(/ /g, "")) || vehiculos.find(v => norm(v.nombre) === x) || null;
  };
  const nuevos = [], cambios = [], sinVehiculo = new Set(), vistos = new Set();
  for (const t of leidos) {
    const k = claveTrab(t);
    if (vistos.has(k)) continue;
    vistos.add(k);
    const v = buscarVeh(t.vehiculo);
    if (t.vehiculo && !v) sinVehiculo.add(t.vehiculo);
    const { vehiculo: _v, ...resto } = t; void _v;
    const datos = { ...resto, vehiculoId: v?._id || "" };
    const ya = porClave.get(k);
    if (ya) cambios.push({ id: ya._id, datos: t.vehiculo ? datos : { ...datos, vehiculoId: ya.vehiculoId || "" } });
    else nuevos.push(datos);
  }
  return { nuevos, cambios, sinVehiculo: [...sinVehiculo] };
}

/** Las filas de ejemplo de las plantillas */
export const PLANTILLA_VEHICULOS = [
  { Nombre: "Camión 1", Matrícula: "1234ABC", Tipo: "Camión lateral", Capacidad: 12000, Turno: "Jornada completa", Latitud: "", Longitud: "" },
  { Nombre: "Furgoneta 2", Matrícula: "5678DEF", Tipo: "Furgón", Capacidad: 800, Turno: "Mañana", Latitud: "", Longitud: "" },
];
export const PLANTILLA_TRABAJADORES = [
  { Nombre: "Ana", Apellidos: "García López", Turno: "Mañana", Rol: "conductor", Vehículo: "1234ABC" },
  { Nombre: "Luis", Apellidos: "Martín Ruiz", Turno: "Tarde", Rol: "conductor", Vehículo: "1234ABC" },
];
