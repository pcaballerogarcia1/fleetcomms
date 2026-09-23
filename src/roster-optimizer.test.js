import { describe, it, expect } from "vitest";
import { optimizeRoster, checkWorkerMonth, describeReasons, monthlyCap, festivoDays } from "./roster-optimizer.js";

// Septiembre 2026: día 1 = martes
const BASE = { year: 2026, month: 9, daysInMonth: 30 };
const mkShift = (day, start, end, v = "v1") => ({ id: `${v}_${day}_${start}`, day, start, end, vehicleId: v, vehicleName: v });
const mkWorkers = n => Array.from({ length: n }, (_, i) => ({ id: `w${i + 1}`, name: `W${i + 1}` }));
const daysOf = (res, wid, shifts) => shifts.filter(s => res.assignments[s.id] === wid).map(s => s.day);

describe("optimizeRoster", () => {
  it("cubre todos los turnos cuando hay gente de sobra", () => {
    const shifts = Array.from({ length: 30 }, (_, i) => mkShift(i + 1, 360, 840));
    const r = optimizeRoster({ ...BASE, shifts, workers: mkWorkers(3) });
    expect(r.uncovered).toHaveLength(0);
    expect(Object.keys(r.assignments)).toHaveLength(30);
  });

  it("nunca más de N días seguidos", () => {
    const shifts = Array.from({ length: 30 }, (_, i) => mkShift(i + 1, 360, 840));
    const r = optimizeRoster({ ...BASE, shifts, workers: mkWorkers(2), rules: { maxDiasSeguidos: 6, equilibrar: false } });
    for (const w of ["w1", "w2"]) expect(r.stats[w].maxRun).toBeLessThanOrEqual(6);
    expect(r.uncovered).toHaveLength(0);
  });

  it("respeta el tope de horas/mes y deja sin cubrir con el motivo", () => {
    // 30 turnos de 8h = 240h, un solo trabajador con 220h → 27 turnos como mucho
    const shifts = Array.from({ length: 30 }, (_, i) => mkShift(i + 1, 360, 840));
    const r = optimizeRoster({ ...BASE, shifts, workers: mkWorkers(1), rules: { maxDiasSeguidos: 0 } });
    expect(r.stats.w1.hours).toBeLessThanOrEqual(220);
    expect(r.uncovered.length).toBe(3);
    expect(r.uncovered[0].reasons.hours).toBe(1);
    expect(describeReasons(r.uncovered[0].reasons)).toMatch(/horas/);
  });

  it("horas por trabajador sobrescriben las de la organización", () => {
    const shifts = Array.from({ length: 10 }, (_, i) => mkShift(i + 1, 360, 840));
    const workers = [{ id: "w1", name: "Media jornada", maxHoras: 40 }];
    const r = optimizeRoster({ ...BASE, shifts, workers });
    expect(r.stats.w1.hours).toBe(40);
  });

  it("descanso mínimo: no encadena Noche → Mañana al día siguiente", () => {
    const shifts = [mkShift(1, 1320, 1800), mkShift(2, 360, 840)];
    const r = optimizeRoster({ ...BASE, shifts, workers: mkWorkers(1), rules: { moverTurnos: false } });
    expect(r.uncovered).toHaveLength(1);
    expect(r.uncovered[0].reasons.rest).toBe(1);
    const r2 = optimizeRoster({ ...BASE, shifts, workers: mkWorkers(2) });
    expect(r2.uncovered).toHaveLength(0);
    expect(r2.assignments[shifts[0].id]).not.toBe(r2.assignments[shifts[1].id]);
  });

  it("respeta lo escrito a mano: L/B no, M/T/N solo ese turno", () => {
    const shifts = [mkShift(3, 360, 840), mkShift(4, 840, 1320)];
    const fixed = { w1: { 3: "B", 4: "M" } };
    const r = optimizeRoster({ ...BASE, shifts, workers: mkWorkers(1), fixed, rules: { moverTurnos: false } });
    expect(r.uncovered.map(u => Object.keys(u.reasons)[0]).sort()).toEqual(["code", "off"]);
  });

  it("un M escrito a mano cuenta como día trabajado para los días seguidos", () => {
    const fixed = { w1: { 1: "M", 2: "M", 3: "M", 4: "M", 5: "M", 6: "M" } };
    const r = optimizeRoster({ ...BASE, shifts: [mkShift(7, 360, 840)], workers: mkWorkers(1), fixed, rules: { moverTurnos: false } });
    expect(r.uncovered[0].reasons.run).toBe(1);
  });

  it("equilibra horas entre trabajadores", () => {
    const shifts = Array.from({ length: 20 }, (_, i) => mkShift(i + 1, 360, 840));
    const r = optimizeRoster({ ...BASE, shifts, workers: mkWorkers(4) });
    const hours = Object.values(r.stats).map(s => s.hours);
    expect(Math.max(...hours) - Math.min(...hours)).toBeLessThanOrEqual(8);
  });

  it("prefiere mantener el mismo vehículo que el día anterior", () => {
    const shifts = [mkShift(1, 360, 840, "A"), mkShift(1, 360, 840, "B"), mkShift(2, 360, 840, "A"), mkShift(2, 360, 840, "B")];
    const r = optimizeRoster({ ...BASE, shifts, workers: mkWorkers(2), rules: { equilibrar: false } });
    expect(r.assignments[shifts[0].id]).toBe(r.assignments[shifts[2].id]);
    expect(daysOf(r, r.assignments[shifts[1].id], shifts)).toEqual([1, 2]);
  });

  it("ignora (y cuenta) turnos fuera del mes", () => {
    const r = optimizeRoster({ ...BASE, shifts: [mkShift(31, 360, 840)], workers: mkWorkers(1) });
    expect(r.outOfMonth).toBe(1);
  });
});

describe("checkWorkerMonth", () => {
  it("detecta horas de más, racha y descansos cortos", () => {
    const iv = { 1: { start: 1320, end: 1800 }, 2: { start: 360, end: 840 }, 3: { start: 360, end: 840 } };
    const r = checkWorkerMonth(d => iv[d] || null, 30, { maxDiasSeguidos: 2, maxHorasMes: 20, descansoMinH: 12 }, 0);
    expect(r.hours).toBe(24);
    expect(r.overHours).toBe(true);
    expect(r.overRun).toBe(true);
    expect(r.restBreaks).toBe(1);
  });
});

// Septiembre 2026: día 5 = sábado, 6 = domingo; semanas L–D: 7–13, 14–20…
describe("reglas de convenio", () => {
  const month = n => Array.from({ length: n }, (_, i) => mkShift(i + 1, 360, 840));

  it("jornada máxima diaria: un turno más largo no lo cubre nadie", () => {
    const r = optimizeRoster({ ...BASE, shifts: [mkShift(1, 360, 960)], workers: mkWorkers(3), rules: { maxHorasDia: 9 } });
    expect(r.uncovered[0].reasons.dia).toBe(3);
  });

  it("jornada anual prorrateada: manda el menor tope", () => {
    expect(monthlyCap({ maxHorasMes: 220, jornadaAnualH: 1752 }, 30)).toBe(144);
    expect(monthlyCap({ maxHorasMes: 0, jornadaAnualH: 0 }, 30)).toBe(0);
    const r = optimizeRoster({ ...BASE, shifts: month(30), workers: mkWorkers(1), rules: { maxDiasSeguidos: 0, jornadaAnualH: 1752 } });
    expect(r.stats.w1.hours).toBeLessThanOrEqual(144);
  });

  it("descanso semanal: cada semana L–D deja 36h seguidas libres", () => {
    const r = optimizeRoster({ ...BASE, shifts: month(30), workers: mkWorkers(2), rules: { maxDiasSeguidos: 0, descansoSemanalH: 36 } });
    expect(r.uncovered).toHaveLength(0);
    const one = optimizeRoster({ ...BASE, shifts: month(14).slice(6, 13), workers: mkWorkers(1), rules: { maxDiasSeguidos: 0, descansoSemanalH: 36, moverTurnos: false } });
    // semana 7–13 completa con un solo trabajador: alguno de los 7 días se queda sin cubrir
    expect(one.uncovered.length).toBeGreaterThan(0);
    expect(one.uncovered[0].reasons.semanal).toBe(1);
  });

  it("fines de semana libres mínimos", () => {
    const r = optimizeRoster({ ...BASE, shifts: month(30), workers: mkWorkers(1), rules: { maxDiasSeguidos: 0, maxHorasMes: 0, minFindesLibres: 4 } });
    // sept 2026 tiene 4 findes completos (5-6, 12-13, 19-20, 26-27): ninguno se puede trabajar
    const worked = Object.keys(r.assignments).map(id => +id.split("_")[1]);
    for (const d of [5, 6, 12, 13, 19, 20, 26, 27]) expect(worked).not.toContain(d);
  });

  it("noches seguidas y noches al mes", () => {
    const nights = Array.from({ length: 10 }, (_, i) => mkShift(i + 1, 1320, 1800));
    const r = optimizeRoster({ ...BASE, shifts: nights, workers: mkWorkers(1), rules: { maxDiasSeguidos: 0, maxNochesSeguidas: 3, descansoMinH: 0 } });
    expect(r.stats.w1.maxRun).toBeLessThanOrEqual(3);
    const r2 = optimizeRoster({ ...BASE, shifts: nights, workers: mkWorkers(1), rules: { maxDiasSeguidos: 0, maxNochesMes: 4, descansoMinH: 0 } });
    expect(Object.keys(r2.assignments)).toHaveLength(4);
  });

  it("domingos y festivos al mes", () => {
    expect([...festivoDays(["2026-09-11", "2026-10-12"], 2026, 9)]).toEqual([11]);
    const shifts = [mkShift(6, 360, 840), mkShift(11, 360, 840), mkShift(13, 360, 840)]; // dom, festivo, dom
    const r = optimizeRoster({ ...BASE, shifts, workers: mkWorkers(1), rules: { maxDomingosFestivos: 2, festivos: ["2026-09-11"], moverTurnos: false } });
    expect(Object.keys(r.assignments)).toHaveLength(2);
    expect(r.uncovered[0].reasons.domingos).toBe(1);
  });

  it("checkWorkerMonth enumera las reglas de convenio incumplidas", () => {
    const iv = d => (d <= 10 ? { start: 360, end: 960 } : null); // 10 días de 10h seguidos
    const r = checkWorkerMonth(iv, 30, { maxHorasDia: 9, descansoSemanalH: 36, maxDiasSeguidos: 6 }, 0, { year: 2026, month: 9 });
    expect(r.issues.join(" | ")).toContain("jornada(s) de más de 9h");
    expect(r.issues.join(" | ")).toContain("semana(s) sin 36h");
    expect(r.issues.join(" | ")).toMatch(/días seguidos/);
  });
});

describe("mover turnos de día (manda el cuadrante)", () => {
  // Caso real: 3 vehículos × mañana+tarde durante 16 días = 6 turnos/día con
  // 6 trabajadores y máx. 5 días seguidos — imposible sin mover turnos
  // a los días 17–30, que están libres.
  const shifts = [];
  for (let d = 1; d <= 16; d++) for (const v of ["A", "B", "C"]) {
    shifts.push(mkShift(d, 360, 830, v));
    shifts.push(mkShift(d, 840, 1310, v));
  }
  const rules = { maxDiasSeguidos: 5, maxHorasMes: 150 };

  it("sin mover: quedan turnos sin cubrir", () => {
    const r = optimizeRoster({ ...BASE, shifts, workers: mkWorkers(6), rules: { ...rules, moverTurnos: false } });
    expect(r.uncovered.length).toBeGreaterThan(0);
  });

  it("moviendo: lo cubre todo y cumple las reglas", () => {
    const r = optimizeRoster({ ...BASE, shifts, workers: mkWorkers(6), rules });
    expect(r.uncovered).toHaveLength(0);
    expect(r.moves.length).toBeGreaterThan(0);
    for (const s of Object.values(r.stats)) {
      expect(s.maxRun).toBeLessThanOrEqual(5);
      expect(s.hours).toBeLessThanOrEqual(150);
    }
  });

  it("nunca pone dos turnos del mismo vehículo a la misma hora, ni en días de taller", () => {
    const r = optimizeRoster({ ...BASE, shifts, workers: mkWorkers(6), rules, vehicleOff: { A: [17, 18, 19] } });
    const moved = new Map(r.moves.map(m => [m.id, m.toDay]));
    const slots = new Set();
    for (const sh of shifts) {
      const day = moved.get(sh.id) ?? sh.day;
      const key = `${sh.vehicleId}_${day}_${sh.start}`;
      expect(slots.has(key)).toBe(false);
      slots.add(key);
      if (sh.vehicleId === "A" && moved.has(sh.id)) expect([17, 18, 19]).not.toContain(day);
    }
  });

  it("mueve al día libre más cercano", () => {
    // un solo trabajador, turnos días 1–6 con máx. 5 seguidos → el del día 6 pasa al 7 (descansa el 6)
    const six = Array.from({ length: 6 }, (_, i) => mkShift(i + 1, 360, 840));
    const r = optimizeRoster({ ...BASE, shifts: six, workers: mkWorkers(1), rules: { maxDiasSeguidos: 5, equilibrar: false } });
    expect(r.uncovered).toHaveLength(0);
    expect(r.moves).toEqual([{ id: six[5].id, fromDay: 6, toDay: 7 }]);
  });
});
