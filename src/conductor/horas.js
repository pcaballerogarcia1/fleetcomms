// App del conductor: la hora prevista de cada parada (la del Scheduling, guardada al
// publicar en ubicaciones[].horaPlan, minutos del día) y, si ya está hecha, cuánto
// se adelantó o se retrasó. Sin React ni Firebase.
import { hhmm } from "../entregas/datos.js";

/** «09:35», o "" si la parada no trae hora prevista (rutas subidas a mano) */
export const horaPrevista = ub => (Number.isFinite(ub?.horaPlan) ? hhmm(ub.horaPlan) : "");

/** Margen para decir «en hora» (minutos, a cada lado) */
export const MARGEN_EN_HORA = 15;

/**
 * Lo hecho frente a lo previsto: { hecha: "09:42", min: 7, como: "enHora" | "tarde" | "antes" } o null.
 * El día no cuenta: solo la hora (las rutas son de un día).
 */
export function frenteAPrevista(ub) {
  if (!Number.isFinite(ub?.horaPlan) || !ub?.realizadoEn) return null;
  const d = new Date(typeof ub.realizadoEn === "number" ? ub.realizadoEn : ub.realizadoEn?.toMillis?.() ?? 0);
  if (Number.isNaN(d.getTime())) return null;
  const real = d.getHours() * 60 + d.getMinutes();
  let min = real - ub.horaPlan;
  if (min > 720) min -= 1440; else if (min < -720) min += 1440; // turnos de noche
  return { hecha: hhmm(real), min, como: Math.abs(min) <= MARGEN_EN_HORA ? "enHora" : min > 0 ? "tarde" : "antes" };
}

/** «+7 min», «−20 min», «en hora» */
export const textoDesfase = min => (min === 0 ? "en hora" : `${min > 0 ? "+" : "−"}${Math.abs(min) >= 60 ? `${Math.floor(Math.abs(min) / 60)} h ${Math.abs(min) % 60} min` : `${Math.abs(min)} min`}`);
