// Despacho del día: la lógica (sin React ni Firebase).
// Cada mañana pasa algo antes de empezar: un conductor de baja, un camión que
// no arranca. Aquí se calcula, para un día del mes:
//  · los turnos de ese día (quién, a qué hora, con qué vehículo);
//  · los problemas (turnos sin conductor, vehículos que no están disponibles);
//  · quién puede cubrir un hueco, respetando las reglas del cuadrante
//    (descanso mínimo entre turnos, días seguidos, horas del mes).
// Los datos son los del cuadrante (rostering/{org}_{AAAA}_{MM}/trabajadores):
// grid (código del día), asign (horario y vehículo de Optimizar) y despacho
// (lo que se ha hecho en el despacho: { [día]: { hueco, motivo, cubiertoPor } |
// { cubreA } | { vehiculo } }).
import { CODE_WINDOWS, monthlyCap } from "./roster-optimizer.js";

export const TRABAJA = new Set(["M", "T", "N"]);
export const MOTIVOS = ["Baja médica", "Falta sin avisar", "Permiso", "Asunto propio", "Otro"];
const NIVEL = { G: 0, D: 1, "": 2, L: 3 }; // quién cubre antes: Guardia, Disponible, sin turno, Libre (horas extra)
export const NIVEL_TEXTO = ["De guardia", "Disponible", "Sin turno ese día", "Libra: lo haría con horas extra"];

const k = d => String(d);

/** El turno de un trabajador un día: { code, s, e, v, vn } (minutos desde las 00:00 de ese día) o null */
export function turnoDe(datos, d) {
  if (!datos) return null;
  const code = datos.grid?.[k(d)] || "";
  const a = datos.asign?.[k(d)];
  if (code === "B" || code === "L") return null;
  if (a && a.s != null) return { code: TRABAJA.has(code) ? code : "M", s: a.s, e: a.e, v: a.v || null, vn: a.vn || null };
  if (TRABAJA.has(code)) return { code, s: CODE_WINDOWS[code].start, e: CODE_WINDOWS[code].end, v: null, vn: null };
  return null;
}

/** El vehículo de un trabajador un día: lo cambiado en el despacho > Optimizar > el suyo de la ficha */
export function vehiculoDe(worker, datos, d, vehiculos) {
  const cambio = datos?.despacho?.[k(d)]?.vehiculo;
  if (cambio) return cambio;
  const t = turnoDe(datos, d);
  const id = t?.v || worker.vehiculoId || null;
  if (!id) return null;
  const v = vehiculos.find(x => (x._id || x.id) === id);
  return { id, nombre: t?.vn || v?.nombre || v?.matricula || "Vehículo" };
}

/**
 * Los turnos del día y sus problemas.
 * @param porTrabajador { [workerId]: { grid, asign, despacho } }
 * @param gridVehiculos { [vehiculoId]: { [día]: "D"|"T"|"A"|"I" } }
 * @param planes        planes del mes (Rutas), para saber qué ruta lleva cada uno y si ha empezado
 */
export function diaDeDespacho({ workers, vehiculos, porTrabajador, gridVehiculos = {}, d, planes = [] }) {
  const filas = [], huecos = [];
  for (const w of workers) {
    const datos = porTrabajador[w._id] || {};
    const desp = datos.despacho?.[k(d)];
    if (desp?.hueco) {
      const cubre = desp.cubiertoPor ? workers.find(x => x._id === desp.cubiertoPor) : null;
      huecos.push({ workerId: w._id, worker: w, ...desp.hueco, motivo: desp.motivo, cubiertoPor: cubre || null });
    }
    const t = turnoDe(datos, d);
    if (!t) continue;
    const veh = vehiculoDe(w, datos, d, vehiculos);
    const estadoVeh = veh ? gridVehiculos[veh.id]?.[k(d)] || "" : "";
    const suyos = planes.filter(p => p.diaNum === d && (p.workerId === w._id || (w.uid && p.conductorUid === w.uid)));
    const hechas = suyos.reduce((s, p) => s + (p.ubicaciones || []).filter(u => u.realizado).length, 0);
    const total = suyos.reduce((s, p) => s + (p.ubicaciones || []).length, 0);
    filas.push({
      worker: w, turno: t, vehiculo: veh, estadoVeh, cubreA: desp?.cubreA || null,
      planes: suyos, paradas: total, hechas,
      problemaVeh: ["T", "A", "I"].includes(estadoVeh), sinVehiculo: !veh,
    });
  }
  filas.sort((a, b) => a.turno.s - b.turno.s || nombre(a.worker).localeCompare(nombre(b.worker)));
  return { filas, huecos, sinCubrir: huecos.filter(h => !h.cubiertoPor), vehiculosMal: filas.filter(f => f.problemaVeh) };
}

export const nombre = w => [w?.nombre, w?.apellidos].filter(Boolean).join(" ") || "Trabajador";
const hm = min => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`;

/**
 * Quién puede cubrir un hueco (el turno { s, e } del día d).
 * @returns [{ worker, nivel, valido, motivo, horasMes }] los válidos primero (Guardia, Disponible, sin turno, Libre)
 */
export function candidatos({ hueco, workers, porTrabajador, rules = {}, d, daysInMonth }) {
  const out = [];
  const tope = monthlyCap(rules, daysInMonth || 31);
  const dur = (hueco.e - hueco.s) / 60;
  for (const w of workers) {
    if (w._id === hueco.workerId || w.activo === false) continue;
    const datos = porTrabajador[w._id] || {};
    const code = datos.grid?.[k(d)] || "";
    if (code === "B") continue; // de baja: ni se enseña
    if (turnoDe(datos, d)) continue; // ya trabaja ese día
    let valido = true, motivo = null;
    // descanso con el turno de ayer y el de mañana
    const ayer = turnoDe(datos, d - 1), manana = turnoDe(datos, d + 1);
    const minDesc = (rules.descansoMinH || 0) * 60;
    if (minDesc && ayer && hueco.s + 1440 - ayer.e < minDesc) { valido = false; motivo = `solo descansaría ${hm(hueco.s + 1440 - ayer.e)} desde el turno de ayer`; }
    if (valido && minDesc && manana && manana.s + 1440 - hueco.e < minDesc) { valido = false; motivo = `solo descansaría ${hm(manana.s + 1440 - hueco.e)} hasta el turno de mañana`; }
    // días seguidos trabajando (contando este)
    if (valido && rules.maxDiasSeguidos > 0) {
      let seguidos = 1;
      for (let x = d - 1; x >= 1 && turnoDe(datos, x); x--) seguidos++;
      for (let x = d + 1; x <= (daysInMonth || 31) && turnoDe(datos, x); x++) seguidos++;
      if (seguidos > rules.maxDiasSeguidos) { valido = false; motivo = `serían ${seguidos} días seguidos (máx. ${rules.maxDiasSeguidos})`; }
    }
    // horas del mes
    let horasMes = 0;
    for (let x = 1; x <= (daysInMonth || 31); x++) { const t = turnoDe(datos, x); if (t) horasMes += (t.e - t.s) / 60; }
    const pasaHoras = tope > 0 && horasMes + dur > tope;
    out.push({ worker: w, nivel: NIVEL[code] ?? 2, valido, motivo, horasMes: Math.round(horasMes * 10) / 10, aviso: pasaHoras ? `pasaría de ${tope} h en el mes` : null });
  }
  return out.sort((a, b) => (b.valido - a.valido) || (a.nivel - b.nivel) || (!!a.aviso - !!b.aviso) || (a.horasMes - b.horasMes) || nombre(a.worker).localeCompare(nombre(b.worker)));
}

/** Vehículos libres un día: disponibles y que no lleve nadie que trabaja */
export function vehiculosLibres({ vehiculos, filas, gridVehiculos = {}, d }) {
  const usados = new Set(filas.map(f => f.vehiculo?.id).filter(Boolean));
  return vehiculos.filter(v => {
    const id = v._id || v.id;
    return !usados.has(id) && !["T", "A", "I"].includes(gridVehiculos[id]?.[k(d)] || "");
  });
}
