// ── Optimizador de cuadrante (Rostering) ─────────────────────────────
// Reparte los "turnos a cubrir" que deja un escenario de Scheduling generado
// en modo libre (día + vehículo + horario) entre los trabajadores reales,
// respetando unas reglas configurables por organización:
//
//   - maxDiasSeguidos: no más de N días trabajados seguidos
//   - maxHorasMes:     tope de horas al mes (sobrescribible por trabajador)
//   - descansoMinH:    horas mínimas entre el fin de un turno y el inicio
//                      del siguiente (p.ej. 12h prohíbe Noche → Mañana)
//   - equilibrar:      repartir horas y fines de semana de forma equitativa
//
// Reglas típicas de convenio colectivo (0 = no se aplica), rellenadas a
// mano desde Rostering → Reglas → Convenio:
//   - maxHorasDia:        jornada máxima diaria (ET art. 34.3: 9h)
//   - jornadaAnualH:      jornada anual; se prorratea al mes y se combina con
//                         maxHorasMes (manda el menor)
//   - descansoSemanalH:   descanso ininterrumpido mínimo en cada semana
//                         natural L–D (ET art. 37.1: día y medio = 36h)
//   - minFindesLibres:    fines de semana completos (sáb+dom) libres al mes
//   - minLibresSeguidos / vecesLibresSeguidos: al menos `veces` bloques de
//                         `minLibresSeguidos` días libres seguidos al mes
//                         (p. ej. 4 días × 1, o 2 días × 4 = "dos libres
//                         seguidos cada semana")
//   - maxNochesSeguidas / maxNochesMes: turnos de noche
//   - maxDomingosFestivos: domingos + festivos (lista `festivos`, fechas
//                         "YYYY-MM-DD") trabajados al mes
//
// Todas menos "equilibrar" son OBLIGATORIAS: un turno que no se puede
// cubrir sin romper alguna queda sin cubrir, con el motivo. "equilibrar"
// es una preferencia (solo influye en a quién se elige entre los que cumplen).
//
// Lo que ya hay escrito a mano en el cuadrante manda: L/B = no disponible
// ese día; M/T/N = ese día trabaja ese turno (solo se le puede asignar un
// turno del mismo código, y cuenta como día trabajado aunque no se le
// asigne ninguno); G/D/vacío = disponible.
//
// Algoritmo: voraz cronológico (día a día, por hora de inicio) eligiendo
// entre los trabajadores que cumplen todas las reglas al que mejor puntúa
// (menos horas acumuladas, continuidad de vehículo/turno, su turno
// preferido, menos fines de semana), más una reparación por intercambio
// para los turnos que se quedan sin cubrir. No busca el óptimo global — con
// plantillas de decenas/cientos de personas y un mes, basta y es inmediato.

import { shiftCodeFromStart } from "./vrp-engine.js";

// Penalización por cada día de racha que ya lleva un trabajador (ver score).
// Simulado con 89 vehículos × mañana+tarde × 31 días y 230 trabajadores:
// ≤4 deja decenas de turnos sin cubrir (todos se agotan a la vez), ≥6 los
// cubre todos; 8 deja margen.
const RUN_WEIGHT = 8;
export const DEFAULT_ROSTER_RULES = {
  maxDiasSeguidos: 6,
  maxHorasMes: 220,
  descansoMinH: 12,
  equilibrar: true,
  maxHorasDia: 0,
  jornadaAnualH: 0,
  descansoSemanalH: 0,
  minFindesLibres: 0,
  minLibresSeguidos: 0,
  vecesLibresSeguidos: 1,
  maxNochesSeguidas: 0,
  maxNochesMes: 0,
  maxDomingosFestivos: 0,
  festivos: [],
  // Manda el cuadrante: un turno que no cabe en su día se mueve al día más
  // cercano en que alguien pueda hacerlo (Scheduling adapta sus rutas).
  moverTurnos: true,
};

// Mínimos legales del Estatuto de los Trabajadores — punto de partida al
// rellenar un convenio (el convenio puede mejorarlos, nunca empeorarlos).
export const ESTATUTO_RULES = {
  maxHorasDia: 9,          // art. 34.3
  descansoMinH: 12,        // art. 34.3
  descansoSemanalH: 36,    // art. 37.1 (día y medio ininterrumpido)
  jornadaAnualH: 1826,     // art. 34.1 (40h/semana de promedio anual)
};
export const ESTATUTO_ARTS = {
  maxHorasDia: "ET art. 34.3",
  descansoMinH: "ET art. 34.3",
  descansoSemanalH: "ET art. 37.1",
  jornadaAnualH: "ET art. 34.1",
};

// Tope de horas del mes: el menor entre maxHorasMes y la jornada anual
// prorrateada por días del mes. 0 = sin tope.
export function monthlyCap(rules, daysInMonth) {
  const caps = [];
  if (rules.maxHorasMes > 0) caps.push(rules.maxHorasMes);
  if (rules.jornadaAnualH > 0) caps.push(+(rules.jornadaAnualH * daysInMonth / 365).toFixed(1));
  return caps.length ? Math.min(...caps) : 0;
}

// Franjas nominales de los códigos del cuadrante (minutos desde la
// medianoche del día; la noche termina a las 06:00 del día siguiente).
export const CODE_WINDOWS = {
  M: { start: 360,  end: 840  },
  T: { start: 840,  end: 1320 },
  N: { start: 1320, end: 1800 },
};
const WORK_CODES = new Set(["M", "T", "N"]);
const OFF_CODES  = new Set(["L", "B"]);

export const REASON_LABELS = {
  off:     "de libre/baja",
  busy:    "ya trabajan ese día",
  code:    "tienen fijado otro turno ese día",
  hours:   "superarían sus horas/mes",
  rest:    "no descansarían lo mínimo",
  run:     "superarían los días seguidos",
  dia:     "el turno supera la jornada máxima diaria",
  semanal: "se quedarían sin descanso semanal",
  findes:  "se quedarían sin los fines de semana libres mínimos",
  libres:  "se quedarían sin sus días libres seguidos",
  nochesS: "superarían las noches seguidas",
  noches:  "superarían las noches al mes",
  domingos: "superarían los domingos/festivos al mes",
};

// ── Comprobaciones de convenio sobre un mes ──────────────────────────
// Todas reciben intervalOf(d) → { start, end } (minutos desde la medianoche
// del día d) o null si ese día no trabaja; los días fuera del mes cuentan
// como libres.
const dowOf = (year, month, d) => new Date(year, month - 1, d).getDay();
const isNightIv = iv => !!iv && shiftCodeFromStart(iv.start) === "N";

export function festivoDays(festivos, year, month) {
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  return new Set((festivos || []).filter(f => f.startsWith(prefix)).map(f => parseInt(f.slice(8), 10)));
}

// Mayor hueco sin trabajar (minutos) dentro de la semana natural L–D que
// contiene el día d (incluye lo que se alarga desde el domingo anterior).
function weeklyMaxGap(intervalOf, year, month, d) {
  const monday = d - ((dowOf(year, month, d) + 6) % 7);
  const wStart = (monday - 1) * 1440, wEnd = (monday + 6) * 1440;
  const ivs = [];
  for (let x = monday - 1; x <= monday + 6; x++) {
    const iv = intervalOf(x);
    if (!iv) continue;
    const s = Math.max(wStart, (x - 1) * 1440 + iv.start), e = Math.min(wEnd, (x - 1) * 1440 + iv.end);
    if (e > s) ivs.push([s, e]);
  }
  ivs.sort((a, b) => a[0] - b[0]);
  let gap = 0, cur = wStart;
  for (const [s, e] of ivs) { gap = Math.max(gap, s - cur); cur = Math.max(cur, e); }
  return Math.max(gap, wEnd - cur);
}

function freeWeekends(intervalOf, year, month, daysInMonth) {
  let free = 0;
  for (let d = 1; d < daysInMonth; d++) {
    if (dowOf(year, month, d) !== 6) continue; // sábado con su domingo dentro del mes
    if (!intervalOf(d) && !intervalOf(d + 1)) free++;
  }
  return free;
}

// Cuántos bloques de `n` días libres seguidos (sin solaparse) caben aún en
// el mes: los días sin trabajar (o de L/B) cuentan como libres.
function freeBlocks(intervalOf, daysInMonth, n) {
  let blocks = 0, run = 0;
  for (let d = 1; d <= daysInMonth + 1; d++) {
    if (d <= daysInMonth && !intervalOf(d)) { run++; continue; }
    blocks += Math.floor(run / n);
    run = 0;
  }
  return blocks;
}

function nightRunAround(intervalOf, d, daysInMonth) {
  let run = 1;
  for (let x = d - 1; x >= 1 && isNightIv(intervalOf(x)); x--) run++;
  for (let x = d + 1; x <= daysInMonth && isNightIv(intervalOf(x)); x++) run++;
  return run;
}

function countDays(intervalOf, daysInMonth, pred) {
  let n = 0;
  for (let d = 1; d <= daysInMonth; d++) { const iv = intervalOf(d); if (iv && pred(iv, d)) n++; }
  return n;
}

function isWeekend(year, month, day) {
  const dow = new Date(year, month - 1, day).getDay();
  return dow === 0 || dow === 6;
}

/**
 * @param {object} p
 * @param {Array}  p.shifts   [{ id, day, start, end, vehicleId, vehicleName }] — day 1-based
 *                            del mes; start/end en minutos desde la medianoche de ese día
 *                            (end puede pasar de 1440 en turnos de noche)
 * @param {Array}  p.workers  [{ id, name, maxHoras?, prefStart? }]
 * @param {object} p.fixed    { [workerId]: { [day]: code } } — celdas escritas a mano
 * @param {object} p.rules    ver DEFAULT_ROSTER_RULES
 * @param {number} p.year, p.month, p.daysInMonth
 * @param {object} p.vehicleOff { [vehicleId]: [día, …] } días en taller/avería/ITV (no se
 *                            mueve ningún turno a ellos)
 *
 * Devuelve también `moves`: [{ id, fromDay, toDay }] — turnos que, por no
 * poder cubrirse en su día, se han movido a otro día del mes (mismo
 * vehículo y horario). Quien llame debe trasladar esas rutas en Scheduling.
 */
export function optimizeRoster({ shifts, workers, fixed = {}, rules = {}, year, month, daysInMonth, vehicleOff = {} }) {
  const R = { ...DEFAULT_ROSTER_RULES, ...rules };
  const restMin = (R.descansoMinH || 0) * 60;
  const festSet = festivoDays(R.festivos, year, month);
  const isSunFest = d => dowOf(year, month, d) === 0 || festSet.has(d);

  // Estado por trabajador: qué hace cada día (código fijo y/o turno asignado)
  const st = new Map();
  for (const w of workers) {
    const days = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const code = fixed[w.id]?.[d] || fixed[w.id]?.[String(d)] || "";
      days[d] = { code, shift: null };
    }
    let nominalMin = 0;
    for (const day of Object.values(days)) {
      if (WORK_CODES.has(day.code)) nominalMin += CODE_WINDOWS[day.code].end - CODE_WINDOWS[day.code].start;
    }
    st.set(w.id, {
      w, days, weekends: 0,
      workedMin: nominalMin, // horas trabajadas en minutos, al día con assign/unassign
      maxHoras: w.maxHoras > 0 ? w.maxHoras : monthlyCap(R, daysInMonth),
    });
  }

  // Intervalo trabajado un día (asignado > nominal de un M/T/N fijo) o null
  const workedInterval = (s, d) => {
    const day = s.days[d];
    if (!day) return null;
    if (day.shift) return { start: day.shift.start, end: day.shift.end };
    if (WORK_CODES.has(day.code)) return CODE_WINDOWS[day.code];
    return null;
  };
  const worksOn = (s, d) => !!workedInterval(s, d);
  const hoursOf = s => s.workedMin / 60;
  // Minutos que cuenta un día: el turno asignado sustituye al nominal del código fijo
  const dayMinDelta = (s, sh) => {
    const code = s.days[sh.day].code;
    const nominal = WORK_CODES.has(code) ? CODE_WINDOWS[code].end - CODE_WINDOWS[code].start : 0;
    return (sh.end - sh.start) - nominal;
  };

  // Primer motivo por el que `s` no puede hacer `sh` (o null si puede)
  function blockReason(s, sh) {
    const d = sh.day;
    const day = s.days[d];
    if (OFF_CODES.has(day.code)) return "off";
    if (day.shift) return "busy";
    if (WORK_CODES.has(day.code) && shiftCodeFromStart(sh.start) !== day.code) return "code";
    if (R.maxHorasDia > 0 && sh.end - sh.start > R.maxHorasDia * 60) return "dia";

    const newHours = (s.workedMin + dayMinDelta(s, sh)) / 60;
    if (s.maxHoras > 0 && newHours > s.maxHoras + 1e-9) return "hours";

    if (restMin > 0) {
      const prev = workedInterval(s, d - 1);
      if (prev && (sh.start + 1440) - prev.end < restMin) return "rest";
      const next = workedInterval(s, d + 1);
      if (next && (next.start + 1440) - sh.end < restMin) return "rest";
    }

    if (R.maxDiasSeguidos > 0) {
      let run = 1;
      for (let x = d - 1; x >= 1 && worksOn(s, x); x--) run++;
      for (let x = d + 1; x <= daysInMonth && worksOn(s, x); x++) run++;
      if (run > R.maxDiasSeguidos) return "run";
    }

    // Reglas de convenio que dependen del resto del mes: se evalúan como si
    // el turno ya estuviera asignado (day.shift es null aquí — "busy" arriba).
    day.shift = sh;
    try {
      const iv = x => workedInterval(s, x);
      if (R.descansoSemanalH > 0 && weeklyMaxGap(iv, year, month, d) < R.descansoSemanalH * 60) return "semanal";
      if (R.minFindesLibres > 0 && (dowOf(year, month, d) === 6 || dowOf(year, month, d) === 0) &&
          freeWeekends(iv, year, month, daysInMonth) < R.minFindesLibres) return "findes";
      if (R.minLibresSeguidos > 0 &&
          freeBlocks(iv, daysInMonth, R.minLibresSeguidos) < Math.max(1, R.vecesLibresSeguidos || 1)) return "libres";
      if (isNightIv(sh)) {
        if (R.maxNochesSeguidas > 0 && nightRunAround(iv, d, daysInMonth) > R.maxNochesSeguidas) return "nochesS";
        if (R.maxNochesMes > 0 && countDays(iv, daysInMonth, isNightIv) > R.maxNochesMes) return "noches";
      }
      if (R.maxDomingosFestivos > 0 && isSunFest(d) &&
          countDays(iv, daysInMonth, (_, x) => isSunFest(x)) > R.maxDomingosFestivos) return "domingos";
    } finally {
      day.shift = null;
    }
    return null;
  }

  function score(s, sh) {
    let sc = 0;
    const hours = hoursOf(s);
    if (R.equilibrar) {
      // Penaliza ir por delante del ritmo justo (horas repartidas hasta hoy
      // entre toda la plantilla), no las horas a secas: así la continuidad
      // de abajo (mismo vehículo/turno que ayer) gana entre los que van al
      // día, pero nadie encadena semanas mientras otros esperan.
      sc -= Math.max(0, hours - paceByDay[sh.day]) * 10;
      if (isWeekend(year, month, sh.day)) sc -= s.weekends * 15;
    }
    // Escalonar descansos: cuanto más larga la racha que ya lleva, menos
    // apetece darle otro día seguido. Sin esto, con todos al mismo ritmo,
    // la plantilla entera llegaba a la vez al tope de días seguidos y el
    // día siguiente se quedaba sin nadie (caso real simulado: 126 turnos
    // sin cubrir, todos el día 7).
    if (R.maxDiasSeguidos > 0) {
      let runBefore = 0;
      for (let x = sh.day - 1; x >= 1 && worksOn(s, x); x--) runBefore++;
      sc -= runBefore * RUN_WEIGHT;
    }
    sc -= hours * 0.01;                                    // desempate estable
    const prev = s.days[sh.day - 1]?.shift;
    if (prev?.vehicleId === sh.vehicleId) sc += 20;        // mismo vehículo que ayer
    if (prev && shiftCodeFromStart(prev.start) === shiftCodeFromStart(sh.start)) sc += 10; // mismo turno
    if (s.w.prefStart != null && shiftCodeFromStart(s.w.prefStart) === shiftCodeFromStart(sh.start)) sc += 15;
    if (WORK_CODES.has(s.days[sh.day].code)) sc += 50;     // ya iba a trabajar ese día de todos modos
    return sc;
  }

  function assign(s, sh) {
    s.workedMin += dayMinDelta(s, sh);
    s.days[sh.day].shift = sh;
    if (isWeekend(year, month, sh.day)) s.weekends++;
  }
  function unassign(s, sh) {
    s.days[sh.day].shift = null;
    s.workedMin -= dayMinDelta(s, sh);
    if (isWeekend(year, month, sh.day)) s.weekends--;
  }

  const ordered = [...shifts]
    .filter(sh => sh.day >= 1 && sh.day <= daysInMonth)
    .sort((a, b) => a.day - b.day || a.start - b.start);
  const outOfMonth = shifts.length - ordered.length;

  // Ritmo justo: horas de turno acumuladas hasta cada día / nº de trabajadores
  const paceByDay = new Array(daysInMonth + 2).fill(0);
  {
    const perDay = new Array(daysInMonth + 2).fill(0);
    for (const sh of ordered) perDay[sh.day] += (sh.end - sh.start) / 60;
    let acc = 0;
    for (let d = 1; d <= daysInMonth; d++) { acc += perDay[d]; paceByDay[d] = acc / Math.max(1, workers.length); }
  }

  const assignments = {};
  const pending = [];
  for (const sh of ordered) {
    let best = null, bestSc = -Infinity;
    for (const s of st.values()) {
      if (blockReason(s, sh)) continue;
      const sc = score(s, sh);
      if (sc > bestSc) { bestSc = sc; best = s; }
    }
    if (best) { assign(best, sh); assignments[sh.id] = best.w.id; }
    else pending.push(sh);
  }

  // Reparación por intercambio: para un turno U sin cubrir, busca un
  // trabajador A que solo no puede porque ya tiene otro turno X ese día, y
  // un trabajador B que sí puede hacer X — B se queda X y A pasa a U.
  // Ocupación de cada vehículo por día (todos sus turnos, cubiertos o no):
  // a un turno solo se le puede mover a un día en que su vehículo esté libre
  // en ese horario.
  const occ = new Map(); // vehicleId → Map(day → [shift])
  const occOf = (v, d) => {
    if (!occ.has(v)) occ.set(v, new Map());
    const m = occ.get(v);
    if (!m.has(d)) m.set(d, []);
    return m.get(d);
  };
  for (const sh of ordered) occOf(sh.vehicleId, sh.day).push(sh);
  const offDays = new Map(Object.entries(vehicleOff).map(([v, days]) => [v, new Set((days || []).map(Number))]));

  function tryRelocate(U) {
    const candidates = [];
    for (let d = 1; d <= daysInMonth; d++) if (d !== U.day) candidates.push(d);
    candidates.sort((a, b) => Math.abs(a - U.day) - Math.abs(b - U.day) || a - b);
    for (const d of candidates) {
      if (offDays.get(U.vehicleId)?.has(d)) continue;
      if (occOf(U.vehicleId, d).some(o => o.start < U.end && U.start < o.end)) continue;
      const moved = { ...U, day: d };
      let best = null, bestSc = -Infinity;
      for (const s of st.values()) {
        if (blockReason(s, moved)) continue;
        const sc = score(s, moved);
        if (sc > bestSc) { bestSc = sc; best = s; }
      }
      if (!best) continue;
      const from = occOf(U.vehicleId, U.day);
      from.splice(from.indexOf(U), 1);
      occOf(U.vehicleId, d).push(moved);
      assign(best, moved);
      assignments[U.id] = best.w.id;
      return moved;
    }
    return null;
  }

  const uncovered = [];
  const moves = [];
  for (const U of pending) {
    let fixedIt = false;
    for (const A of st.values()) {
      const X = A.days[U.day].shift;
      if (!X) continue;
      unassign(A, X);
      if (!blockReason(A, U)) {
        const B = [...st.values()].find(b => b !== A && !blockReason(b, X));
        if (B) {
          assign(B, X); assignments[X.id] = B.w.id;
          assign(A, U); assignments[U.id] = A.w.id;
          fixedIt = true;
          break;
        }
      }
      assign(A, X);
    }
    if (fixedIt) continue;

    if (R.moverTurnos) {
      const moved = tryRelocate(U);
      if (moved) { moves.push({ id: U.id, fromDay: U.day, toDay: moved.day }); continue; }
    }

    const counts = {};
    for (const s of st.values()) {
      const r = blockReason(s, U);
      if (r) counts[r] = (counts[r] || 0) + 1;
    }
    uncovered.push({ shift: U, reasons: counts });
  }

  // Pasada final de equilibrado: el voraz cronológico deja algo de
  // desajuste al final del mes (quien iba en racha acaba con uno o dos
  // turnos de más). Pasa turnos del que más horas lleva (en proporción a su
  // tope) al que menos, mientras cumpla todas las reglas y reduzca la
  // diferencia.
  if (R.equilibrar) {
    const load = s => s.workedMin / 60 / (s.maxHoras || R.maxHorasMes || 1);
    const t0 = Date.now(); // acotado: con plantillas grandes, mejor casi equilibrado que bloquear la pestaña
    for (let iter = 0; iter < ordered.length && Date.now() - t0 < 2000; iter++) {
      const list = [...st.values()].sort((a, b) => load(b) - load(a));
      let moved = false;
      for (const hi of list) {
        for (const lo of [...list].reverse()) {
          if (lo === hi || load(lo) >= load(hi)) break;
          for (const sh of Object.values(hi.days).map(d => d.shift).filter(Boolean)) {
            if (blockReason(lo, sh)) continue;
            const before = load(hi) - load(lo);
            unassign(hi, sh); assign(lo, sh);
            if (Math.abs(load(hi) - load(lo)) < before - 1e-9) { assignments[sh.id] = lo.w.id; moved = true; break; }
            unassign(lo, sh); assign(hi, sh);
          }
          if (moved) break;
        }
        if (moved) break;
      }
      if (!moved) break;
    }
  }

  const stats = {};
  for (const s of st.values()) {
    let days = 0, maxRun = 0, run = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      if (worksOn(s, d)) { days++; run++; maxRun = Math.max(maxRun, run); } else run = 0;
    }
    stats[s.w.id] = { hours: +hoursOf(s).toFixed(1), days, maxRun, weekends: s.weekends, maxHoras: s.maxHoras };
  }

  return { assignments, uncovered, stats, outOfMonth, moves };
}

// Texto corto del motivo de un turno sin cubrir: "3 superarían sus
// horas/mes, 2 no descansarían lo mínimo…" (los más frecuentes primero).
export function describeReasons(reasons) {
  const parts = Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${REASON_LABELS[k] ?? k}`);
  return parts.length ? parts.join(", ") : "no hay trabajadores";
}

// Comprobación de reglas sobre un cuadrante ya hecho (manual u optimizado)
// para la columna de resumen. `intervalOf(d)` da el intervalo trabajado ese
// día ({start,end} en minutos) o null. Devuelve las cifras y `issues`: un
// texto por cada regla incumplida.
export function checkWorkerMonth(intervalOf, daysInMonth, rules, maxHoras, { year, month } = {}) {
  const R = { ...DEFAULT_ROSTER_RULES, ...rules };
  let min = 0, run = 0, maxRun = 0, restBreaks = 0, longDays = 0, nightRun = 0, maxNightRun = 0;
  let prev = null;
  for (let d = 1; d <= daysInMonth; d++) {
    const iv = intervalOf(d);
    if (iv) {
      min += iv.end - iv.start;
      run++; maxRun = Math.max(maxRun, run);
      if (prev && R.descansoMinH > 0 && (iv.start + 1440) - prev.end < R.descansoMinH * 60) restBreaks++;
      if (R.maxHorasDia > 0 && iv.end - iv.start > R.maxHorasDia * 60) longDays++;
      prev = iv;
    } else { run = 0; prev = null; }
    nightRun = isNightIv(iv) ? nightRun + 1 : 0;
    maxNightRun = Math.max(maxNightRun, nightRun);
  }
  const hours = min / 60;
  const cap = maxHoras > 0 ? maxHoras : monthlyCap(R, daysInMonth);
  const out = {
    hours: +hours.toFixed(1), maxRun, restBreaks, cap,
    overHours: cap > 0 && hours > cap + 1e-9,
    overRun:   R.maxDiasSeguidos > 0 && maxRun > R.maxDiasSeguidos,
  };
  const issues = [];
  if (out.overHours) issues.push(`${out.hours}h supera el tope de ${cap}h`);
  if (out.overRun) issues.push(`${maxRun} días seguidos (máx. ${R.maxDiasSeguidos})`);
  if (restBreaks) issues.push(`${restBreaks} descanso(s) de menos de ${R.descansoMinH}h`);
  if (longDays) issues.push(`${longDays} jornada(s) de más de ${R.maxHorasDia}h`);
  if (R.maxNochesSeguidas > 0 && maxNightRun > R.maxNochesSeguidas) issues.push(`${maxNightRun} noches seguidas (máx. ${R.maxNochesSeguidas})`);
  const nights = countDays(intervalOf, daysInMonth, isNightIv);
  if (R.maxNochesMes > 0 && nights > R.maxNochesMes) issues.push(`${nights} noches (máx. ${R.maxNochesMes})`);
  if (year && month) {
    if (R.descansoSemanalH > 0) {
      let bad = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        if (dowOf(year, month, d) !== 1 && d !== 1) continue; // un chequeo por semana
        if (weeklyMaxGap(intervalOf, year, month, d) < R.descansoSemanalH * 60) bad++;
      }
      if (bad) issues.push(`${bad} semana(s) sin ${R.descansoSemanalH}h de descanso seguido`);
    }
    if (R.minLibresSeguidos > 0) {
      const need = Math.max(1, R.vecesLibresSeguidos || 1);
      const got = freeBlocks(intervalOf, daysInMonth, R.minLibresSeguidos);
      if (got < need) issues.push(`${got} de ${need} bloque(s) de ${R.minLibresSeguidos} días libres seguidos`);
    }
    if (R.minFindesLibres > 0) {
      const free = freeWeekends(intervalOf, year, month, daysInMonth);
      if (free < R.minFindesLibres) issues.push(`${free} fin(es) de semana libre(s) (mín. ${R.minFindesLibres})`);
    }
    if (R.maxDomingosFestivos > 0) {
      const fest = festivoDays(R.festivos, year, month);
      const n = countDays(intervalOf, daysInMonth, (_, x) => dowOf(year, month, x) === 0 || fest.has(x));
      if (n > R.maxDomingosFestivos) issues.push(`${n} domingos/festivos (máx. ${R.maxDomingosFestivos})`);
    }
  }
  return { ...out, issues };
}
