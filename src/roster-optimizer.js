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
// Las tres primeras son OBLIGATORIAS: un turno que no se puede cubrir sin
// romper alguna queda sin cubrir, con el motivo. "equilibrar" es una
// preferencia (solo influye en a quién se elige entre los que cumplen).
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
};

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
};

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
 */
export function optimizeRoster({ shifts, workers, fixed = {}, rules = {}, year, month, daysInMonth }) {
  const R = { ...DEFAULT_ROSTER_RULES, ...rules };
  const restMin = (R.descansoMinH || 0) * 60;

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
      maxHoras: w.maxHoras > 0 ? w.maxHoras : R.maxHorasMes,
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
  const uncovered = [];
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

  return { assignments, uncovered, stats, outOfMonth };
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
// para la columna de resumen: horas del mes, racha máxima de días
// seguidos y nº de descansos por debajo del mínimo. `intervalOf(d)` da el
// intervalo trabajado ese día ({start,end} en minutos) o null.
export function checkWorkerMonth(intervalOf, daysInMonth, rules, maxHoras) {
  const R = { ...DEFAULT_ROSTER_RULES, ...rules };
  let min = 0, run = 0, maxRun = 0, restBreaks = 0;
  let prev = null;
  for (let d = 1; d <= daysInMonth; d++) {
    const iv = intervalOf(d);
    if (iv) {
      min += iv.end - iv.start;
      run++; maxRun = Math.max(maxRun, run);
      if (prev && R.descansoMinH > 0 && (iv.start + 1440) - prev.end < R.descansoMinH * 60) restBreaks++;
      prev = iv;
    } else { run = 0; prev = null; }
  }
  const hours = min / 60;
  const cap = maxHoras > 0 ? maxHoras : R.maxHorasMes;
  return {
    hours: +hours.toFixed(1), maxRun, restBreaks, cap,
    overHours: cap > 0 && hours > cap + 1e-9,
    overRun:   R.maxDiasSeguidos > 0 && maxRun > R.maxDiasSeguidos,
  };
}
