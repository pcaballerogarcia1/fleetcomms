// Scheduling de líneas · el coste de los turnos según el convenio: horas
// ordinarias, plus de nocturnidad (22:00–6:00), plus por partido, horas extra,
// mínimo pagado, coste fijo por turno y recargo de festivo. Sin React ni Firebase.
// Se separan los minutos (dependen de las reglas: extra desde, mínimo pagado)
// de los precios (se pueden cambiar sin recalcular el escenario).

// Minutos de [a, b) que caen de noche (22:00–6:00, también pasada la medianoche)
function minutosNoche(a, b) {
  let n = 0;
  for (let d = Math.floor(a / 1440) - 1; d <= Math.floor(b / 1440); d++) {
    const ini = d * 1440 + 1320, fin = d * 1440 + 1440 + 360; // 22:00 de ese día → 6:00 del siguiente
    n += Math.max(0, Math.min(b, fin) - Math.max(a, ini));
  }
  return n;
}

/** Los precios que cuentan para el coste (si ninguno es > 0, no hay coste) */
export const CAMPOS_PRECIO = ["costeHora", "costeKm", "costeVehiculoDia", "plusNocturnidad", "plusPartido", "costeHoraExtra", "costeFijoTurno", "plusFestivoPct", "costeCambioBus"];
export const hayPrecios = p => CAMPOS_PRECIO.some(k => k !== "costeCambioBus" && p[k] > 0);

/** Minutos que se pagan de un turno, por concepto */
export function minutosTurno(t, p) {
  const trabajo = t.trabajo || 0;
  const pagado = Math.max(trabajo, p.minimoPagado > 0 ? p.minimoPagado : 0);
  const extra = p.horaExtraDesde > 0 ? Math.max(0, trabajo - p.horaExtraDesde) : 0;
  // los ratos trabajados: de la toma al deje, sin los huecos que no se pagan
  const tramos = [];
  let desde = t.inicio - (t.antes || 0);
  (t.piezas || []).slice(1).forEach((pz, i) => {
    const a = t.piezas[i];
    if (pz.inicio - a.fin >= (p.huecoNoPagado ?? 60)) { tramos.push([desde, a.fin]); desde = pz.inicio; }
  });
  tramos.push([desde, t.fin + (t.despues || 0)]);
  return { ordinario: pagado - extra, extra, noche: tramos.reduce((s, [a, b]) => s + minutosNoche(a, b), 0), partidos: t.partidos ? 1 : 0, turnos: 1 };
}

/** Los minutos de varios turnos, sumados */
export function minutosCoste(turnos, p) {
  const m = { ordinario: 0, extra: 0, noche: 0, partidos: 0, turnos: 0 };
  for (const t of turnos || []) { const x = minutosTurno(t, p); for (const k of Object.keys(m)) m[k] += x[k]; }
  return m;
}

/** € de unos minutos con los precios: { total, ordinario, extra, nocturnidad, partido, festivo, fijo } */
export function costeDeMinutos(m, p) {
  const ordinario = m.ordinario * ((p.costeHora || 0) / 60);
  const extra = m.extra * ((p.costeHoraExtra > 0 ? p.costeHoraExtra : p.costeHora || 0) / 60);
  const nocturnidad = m.noche * ((p.plusNocturnidad || 0) / 60);
  const partido = m.partidos * (p.plusPartido || 0);
  const festivo = p.dia === "festivo" && p.plusFestivoPct > 0 ? (ordinario + extra) * (p.plusFestivoPct / 100) : 0;
  const fijo = m.turnos * (p.costeFijoTurno || 0);
  return { total: ordinario + extra + nocturnidad + partido + festivo + fijo, ordinario, extra, nocturnidad, partido, festivo, fijo };
}

/** € de un turno (o de un turno a medio hacer, en la partición) */
export const costeTurnoEuros = (t, p) => costeDeMinutos(minutosTurno(t, p), p).total;
