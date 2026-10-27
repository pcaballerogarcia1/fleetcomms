// Simulador «qué pasaría si»: trabajadores de más.
// Cada trabajador que se añade hace un turno seguido al del vehículo que
// menos horas tiene (un segundo turno), así ese vehículo trabaja más horas
// al día con otra persona. El coste sale de las horas pagadas y los km.
import { minToTime, turnoWindow } from "../vrp-engine.js";
import { dayMetrics } from "../scenario-metrics.js";

/**
 * @param vehicles  vehículos del cálculo (con _effectiveStart/_effectiveEnd si llevan conductores)
 * @param n         trabajadores de más
 * @param jornada   minutos del turno de cada uno
 * @returns { vehicles, puestos: [{ vehiculo, desde, hasta }] }
 */
export function ponerTrabajadoresExtra(vehicles, n, jornada, startMin, endMin) {
  const out = vehicles.map(v => {
    const tw = turnoWindow(v.turno, startMin, endMin);
    return { ...v, _effectiveStart: v._effectiveStart ?? tw.start, _effectiveEnd: v._effectiveEnd ?? tw.end };
  });
  const puestos = [];
  for (let i = 0; i < n; i++) {
    // el vehículo con menos horas que aún tenga sitio en el día
    let mejor = -1;
    for (let j = 0; j < out.length; j++) {
      const v = out[j];
      if (v._effectiveEnd - v._effectiveStart >= 1440 - 30) continue;
      if (mejor < 0 || v._effectiveEnd - v._effectiveStart < out[mejor]._effectiveEnd - out[mejor]._effectiveStart) mejor = j;
    }
    if (mejor < 0) break;
    const v = out[mejor];
    const desde = v._effectiveEnd, hasta = Math.min(v._effectiveEnd + jornada, v._effectiveStart + 1440);
    out[mejor] = { ...v, _effectiveEnd: hasta };
    puestos.push({ id: v._id || v.id || null, vehiculo: v.nombre || v.matricula || `Vehículo ${mejor + 1}`, desde, hasta });
  }
  return { vehicles: out, puestos };
}

/**
 * Horas pagadas (min) de un escenario simulado: cada vehículo, de su primera
 * salida a su última llegada de cada día; pero en los que llevan trabajadores
 * de más, esos turnos se pagan enteros todos los días del escenario (se le
 * contrata aunque el vehículo no llegue a usar sus horas, o no salga).
 */
export function pagadoSimulado(schedule, puestos, days) {
  const extraDe = new Map();
  for (const p of puestos || []) extraDe.set(p.id, (extraDe.get(p.id) || 0) + (p.hasta - p.desde));
  let total = 0;
  for (const v of schedule || []) {
    const extra = extraDe.get(v._id || v.id) || 0;
    total += extra * days; // los de más, su turno entero todos los días
    for (let d = 0; d < days; d++) {
      const m = dayMetrics(v, d);
      if (!m.activo) continue;
      // su conductor de siempre, como mucho su turno de antes
      total += extra ? Math.max(0, Math.min(m.amplitud, (v._effectiveEnd - v._effectiveStart) - extra)) : m.amplitud;
    }
  }
  return total;
}

export const textoPuesto = p => `${p.vehiculo}, de ${minToTime(p.desde % 1440)} a ${minToTime(p.hasta % 1440)}`;
