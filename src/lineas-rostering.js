// ── Del Scheduling de líneas al Rostering, día a día según el calendario ──
// Cada día del mes circula un calendario (laborables, sábados, festivos,
// verano…): los turnos que hay que cubrir ese día son los del escenario de
// ese calendario. Aquí se decide qué calendario toca cada día y se montan
// los "turnos a cubrir" con la forma que usa el Rostering en modo libre
// ({ id, d, v, vn, s, e, st }). Sin React ni Firebase.
import { COLORES_CAL } from "./lineas-horarios-util.js";

const pad = n => String(n).padStart(2, "0");
const TIPO_POR_SEMANA = ["festivo", "laborable", "laborable", "laborable", "laborable", "laborable", "sabado"];
const NOMBRE_TIPO = { laborable: "Laborable", sabado: "Sábado", festivo: "Domingo / festivo" };

/**
 * Qué calendario circula una fecha (yyyy-mm-dd): el del GTFS (o el de la
 * red dibujada) que la incluye —si hay varios, el más concreto, el de menos
 * días—; sin calendarios en la red, el tipo de día por el día de la semana.
 * null = ese día no hay servicio.
 */
export function diaDeFecha(red, fecha) {
  const cals = red?.calendarios || [];
  if (cals.length) {
    const delDia = cals.filter(c => c.fechas?.includes(fecha));
    if (!delDia.length) return null;
    return delDia.sort((a, b) => a.fechas.length - b.fechas.length)[0].id;
  }
  return TIPO_POR_SEMANA[new Date(fecha + "T12:00:00").getDay()];
}
export const nombreDiaRoster = (red, id) => red?.calendarios?.find(c => c.id === id)?.nombre || NOMBRE_TIPO[id] || id;

/** Los días del mes con el calendario de cada uno: [{ d, fecha, dia }] */
export function diasDelMes(red, year, month) {
  const n = new Date(year, month, 0).getDate();
  return Array.from({ length: n }, (_, i) => {
    const fecha = `${year}-${pad(month)}-${pad(i + 1)}`;
    return { d: i + 1, fecha, dia: diaDeFecha(red, fecha) };
  });
}

/** Lo que necesita el Rostering de cada turno de un escenario (pequeño) */
export function turnosCompactos(res) {
  const busDe = new Map((res?.vehiculos || []).map(v => [v.id, v.autobus ?? v.id]));
  return (res?.turnos || []).map(t => {
    const viajes = t.piezas.flatMap(pz => pz.viajes);
    return {
      id: t.id, tipo: t.tipoNombre || null,
      inicio: viajes[0]?.dep ?? t.inicio ?? 0, fin: viajes.at(-1)?.arr ?? t.fin ?? 0,
      buses: [...new Set(t.piezas.map(pz => busDe.get(pz.vehiculo) ?? pz.vehiculo))],
      viajes: viajes.filter(v => !v.vacio).length,
    };
  });
}

/**
 * Turnos a cubrir del mes para el Rostering (modo libre) y lo que se enseña
 * en la cabecera de cada día.
 * turnosPorDia: { [calendario]: turnosCompactos(...) }
 * → { shifts, cals: [{ id, nombre, color, turnos, dias }], calDia: { d: índice en cals } }
 */
export function turnosDelMes(red, diasMes, turnosPorDia) {
  const usados = [...new Set(diasMes.map(x => x.dia).filter(Boolean))];
  const orden = (red?.calendarios || []).map(c => c.id);
  usados.sort((a, b) => (orden.indexOf(a) + 1 || 99) - (orden.indexOf(b) + 1 || 99));
  const cals = usados.map((id, i) => ({
    id, nombre: nombreDiaRoster(red, id), color: COLORES_CAL[i % COLORES_CAL.length],
    turnos: (turnosPorDia[id] || []).length, dias: diasMes.filter(x => x.dia === id).length,
  }));
  const idx = new Map(cals.map((c, i) => [c.id, i]));
  const calDia = {}, shifts = [];
  for (const { d, dia } of diasMes) {
    if (!dia) continue;
    calDia[d] = idx.get(dia);
    for (const t of turnosPorDia[dia] || []) {
      shifts.push({
        // el mismo turno del mismo calendario y día tiene siempre el mismo id: al reenviar no se pierde lo asignado
        id: `${d}|${dia}|T${t.id}`, d, v: `T${t.id}`,
        vn: `T${t.id}${t.tipo ? ` ${t.tipo}` : ""} · Bus ${t.buses.join("+")}`,
        s: Math.max(0, Math.round(t.inicio)), e: Math.round(t.fin), st: t.viajes,
      });
    }
  }
  return { shifts, cals, calDia };
}

/**
 * Del cuadrante del Rostering a los turnos de un día publicado: qué
 * trabajador lleva cada turno ese día (solo los del mismo calendario que se
 * publicó). asignaciones: trabajador → día → { id: "d|calendario|T12", … }
 * → { "T12": { trabajadorId, nombre, uid } } (uid: su usuario de la app, si está vinculado)
 */
export function asignacionDelDia(asignaciones, trabajadores, d, dia) {
  const pref = `${d}|${dia}|`;
  const porId = new Map((trabajadores || []).map(w => [w._id ?? w.id, w]));
  const out = {};
  for (const [wid, dias] of Object.entries(asignaciones || {})) {
    const a = dias?.[d] ?? dias?.[String(d)];
    if (!a?.id || !String(a.id).startsWith(pref)) continue;
    const w = porId.get(wid);
    out[String(a.id).slice(pref.length)] = { trabajadorId: wid, nombre: w ? [w.nombre, w.apellidos].filter(Boolean).join(" ") || "Trabajador" : "Trabajador", uid: w?.uid || null };
  }
  return out;
}

/**
 * El cuadrante de un trabajador para su móvil: por día, el código (M/T/N, L,
 * B…) y, si el Rostering le ha puesto un turno de líneas, cuál, a qué hora y
 * en qué autobús. → { "12": { c, t: "T12", v: "T12 Mañana · Bus 7", s, e } }
 */
export function diasCuadrante(gridWorker, asignWorker) {
  const dias = {};
  for (const [d, c] of Object.entries(gridWorker || {})) {
    if (!c) continue;
    const a = asignWorker?.[d];
    const t = a?.id ? String(a.id).split("|").at(-1) : null;
    dias[d] = { c, ...(a ? { v: a.vn || "", s: a.s ?? null, e: a.e ?? null } : {}), ...(t ? { t } : {}) };
  }
  return dias;
}

/**
 * Los próximos días de un conductor (desde `desde`, n días) a partir de sus
 * cuadrantes publicados: [{ fecha, c, t, v, s, e }] (c null = sin nada puesto)
 */
export function proximosTurnos(cuadrantes, desde, n = 14) {
  const porMes = new Map((cuadrantes || []).map(c => [c.mes, c]));
  const out = [];
  const d0 = new Date(desde + "T12:00:00");
  for (let i = 0; i < n; i++) {
    const d = new Date(d0); d.setDate(d0.getDate() + i);
    const fecha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dia = porMes.get(fecha.slice(0, 7))?.dias?.[String(d.getDate())];
    out.push({ fecha, c: dia?.c || null, t: dia?.t || null, v: dia?.v || null, s: dia?.s ?? null, e: dia?.e ?? null });
  }
  return out;
}
