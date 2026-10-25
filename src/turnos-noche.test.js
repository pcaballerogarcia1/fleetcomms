import { describe, expect, it } from "vitest";
import { dayMetrics, diaDe, jornadasDe, scenarioKpis } from "./scenario-metrics.js";
import { autoScaleFleet, computeCandidateSlots, kmDelDia } from "./vrp-engine.js";

// un conductor de noche (22:00-06:00) dos noches seguidas: cada parada de 20 min
const noche = d => Array.from({ length: 22 }, (_, i) => ({ id: `n${d}-${i}`, lat: 40.42, lng: -3.70, duracion: 20, _start: d * 1440 + 1320 + i * 21, _end: d * 1440 + 1320 + i * 21 + 20 }));
const fila = { _id: "w", nombre: "Conductor noche", _tw: { start: 1320, end: 1800 }, assignments: [...noche(0), ...noche(1)] };

describe("turnos de noche", () => {
  it("una jornada que cruza la medianoche cuenta entera en el día en que empieza", () => {
    expect(diaDe(fila, { _start: 1320 })).toBe(0);
    expect(diaDe(fila, { _start: 1440 + 300 })).toBe(0); // 05:00 del día siguiente: sigue siendo la noche del día 1
    expect(diaDe(fila, { _start: 1440 + 1320 })).toBe(1);
    expect([...jornadasDe(fila).keys()]).toEqual([0, 1]);
    const m = dayMetrics(fila, 0);
    expect(m.inicio).toBe(1320);
    expect(m.amplitud).toBe(21 * 21 + 20); // 7 h 41 min, no 24 h
  });
  it("los indicadores no pasan del 100 % ni cuentan turnos de más", () => {
    const k = scenarioKpis({ vehicles: [fila], workers: [fila], days: 2 });
    expect(k.turnos).toBe(2);
    expect(k.eficPersonal).toBeLessThanOrEqual(1);
  });
  it("sin turno conocido, como siempre (por días de 00:00 a 24:00)", () => {
    expect(diaDe({}, { _start: 1500 })).toBe(1);
  });
  it("mover una parada en un turno de noche ve su jornada entera", () => {
    const veh = { _id: "v", shiftStart: 1320, shiftEnd: 1800, depotLat: 40.4168, depotLng: -3.7038, assignments: noche(0).slice(0, 3).concat(noche(0).slice(-2)) };
    const slots = computeCandidateSlots({ id: "x", lat: 40.421, lng: -3.70, duracion: 10 }, veh, 0);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.some(s => s.nextStop?.id === "n0-20")).toBe(true); // ve las paradas de pasada la medianoche
    expect(slots.every(s => s.taskEnd <= 1740 || s.arrival >= 1760)).toBe(true); // y no se le echa encima
    expect(kmDelDia({ ...veh, assignments: [{ _travel: true, km: 5, _start: 1500, _end: 1510 }] }, 0)).toBe(5);
  });
  it("vehículos necesarios de 24 h con personal de 8 h: tres conductores, el de noche incluido", async () => {
    const tareas = Array.from({ length: 150 }, (_, i) => ({ id: `t${i}`, lat: 40.42 + (i % 10) * 0.001, lng: -3.70 + Math.floor(i / 10) * 0.001, duracion: 25 }));
    const veh = { _id: "v1", nombre: "Camión", turno: "Mañana (06-14)", depotLat: 40.4168, depotLng: -3.7038, _effectiveStart: 360, _effectiveEnd: 840 };
    const r = await autoScaleFleet(tareas, [veh], { startMin: 360, endMin: 1320, maxDays: 1, circular: false, maxShiftMin: 480, maxStops: 0, breakAfter: 0, breakDur: 0, optimizeWeight: 0, vehiculoNecesarioMaxMin: 0, personalNecesarioMaxMin: 480 });
    const anadido = r.resources.find(v => v._virtual);
    expect(anadido).toMatchObject({ _effectiveStart: 360, _effectiveEnd: 1800, _shiftBreaks: [840, 1320] });
    const fila = r.result.schedule[r.resources.indexOf(anadido)];
    expect(fila.assignments.some(a => a._start >= 1320)).toBe(true); // trabaja de noche
    expect(dayMetrics({ ...anadido, ...fila }, 0).activo).toBe(true);
    expect(jornadasDe({ ...anadido, ...fila }).size).toBe(1); // todo en el día 1
  });
});
