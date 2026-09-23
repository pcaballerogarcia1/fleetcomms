import { describe, it, expect } from "vitest";
import { optimizeRoster, checkWorkerMonth, describeReasons } from "./roster-optimizer.js";

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
    const r = optimizeRoster({ ...BASE, shifts, workers: mkWorkers(1) });
    expect(r.uncovered).toHaveLength(1);
    expect(r.uncovered[0].reasons.rest).toBe(1);
    const r2 = optimizeRoster({ ...BASE, shifts, workers: mkWorkers(2) });
    expect(r2.uncovered).toHaveLength(0);
    expect(r2.assignments[shifts[0].id]).not.toBe(r2.assignments[shifts[1].id]);
  });

  it("respeta lo escrito a mano: L/B no, M/T/N solo ese turno", () => {
    const shifts = [mkShift(3, 360, 840), mkShift(4, 840, 1320)];
    const fixed = { w1: { 3: "B", 4: "M" } };
    const r = optimizeRoster({ ...BASE, shifts, workers: mkWorkers(1), fixed });
    expect(r.uncovered.map(u => Object.keys(u.reasons)[0]).sort()).toEqual(["code", "off"]);
  });

  it("un M escrito a mano cuenta como día trabajado para los días seguidos", () => {
    const fixed = { w1: { 1: "M", 2: "M", 3: "M", 4: "M", 5: "M", 6: "M" } };
    const r = optimizeRoster({ ...BASE, shifts: [mkShift(7, 360, 840)], workers: mkWorkers(1), fixed });
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
