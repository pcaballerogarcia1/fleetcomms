import { describe, it, expect } from "vitest";
import { dayMetrics, dayIssues, pvr, scenarioKpis } from "./scenario-metrics.js";

// Fila tipo: sale de cochera 06:00, paradas y viajes, vuelve 14:00
const T = (h, m = 0) => h * 60 + m;
const fila = (asg, extra = {}) => ({ _id: "v1", nombre: "CL-1", assignments: asg, ...extra });
const viaje = (s, e, km, extra = {}) => ({ _start: s, _end: e, _travel: true, km, ...extra });
const parada = (s, e, extra = {}) => ({ _start: s, _end: e, nombre: "P", ...extra });
const pausa = (s, e) => ({ _start: s, _end: e, _break: true });

describe("métricas por día", () => {
  it("separa conducción, trabajo, pausas y km en vacío (cochera)", () => {
    const m = dayMetrics(fila([
      viaje(T(6), T(6, 30), 12, { _depot_exit: true }),
      parada(T(6, 30), T(7)),
      viaje(T(7), T(7, 20), 5),
      pausa(T(7, 20), T(7, 50)),
      parada(T(7, 50), T(9)),
      viaje(T(9), T(9, 40), 15, { _depot_return: true }),
    ]), 0);
    expect(m).toMatchObject({ inicio: T(6), fin: T(9, 40), amplitud: 220, conduccion: 90, trabajo: 100, pausas: 30, km: 32, kmVacio: 27, paradas: 2 });
  });
  it("solo cuenta el día pedido", () => {
    const m = dayMetrics(fila([parada(T(8), T(9)), parada(1440 + T(8), 1440 + T(10))]), 1);
    expect(m.trabajo).toBe(120);
  });
});

describe("avisos de reglas", () => {
  it("conducción continua > 4h30 sin pausa de 45 min (UE 561/2006)", () => {
    const m = dayMetrics(fila([viaje(T(6), T(9), 100), parada(T(9), T(9, 5)), viaje(T(9, 5), T(11), 80)]), 0);
    const iss = dayIssues(m);
    expect(iss.some(i => /sin la pausa de 45 min/.test(i.texto))).toBe(true);
  });
  it("con pausa de 45 min (o 15 + 30) no avisa", () => {
    const m1 = dayMetrics(fila([viaje(T(6), T(9), 100), pausa(T(9), T(9, 45)), viaje(T(9, 45), T(12), 80)]), 0);
    expect(dayIssues(m1).some(i => /conducción sin la pausa/.test(i.texto))).toBe(false);
    const m2 = dayMetrics(fila([viaje(T(6), T(8), 1), pausa(T(8), T(8, 15)), viaje(T(8, 15), T(10), 1), pausa(T(10), T(10, 30)), viaje(T(10, 30), T(13), 1)]), 0);
    expect(dayIssues(m2).some(i => /conducción sin la pausa/.test(i.texto))).toBe(false);
  });
  it("se puede desactivar el 561 (residuos exentos)", () => {
    const m = dayMetrics(fila([viaje(T(6), T(16), 300)]), 0);
    expect(dayIssues(m, { reglas: { aplicar561: false } }).filter(i => /561/.test(i.texto))).toHaveLength(0);
    expect(dayIssues(m).filter(i => /561/.test(i.texto)).length).toBeGreaterThan(0);
  });
  it("jornada máxima, parada fuera de franja y jornada > 6h sin descanso", () => {
    const m = dayMetrics(fila([parada(T(6), T(13), { windowStart: T(6), windowEnd: T(5, 30) })]), 0);
    const iss = dayIssues(m, { maxShiftMin: 360 });
    expect(iss.map(i => i.texto).join(" | ")).toMatch(/supera el máximo de 6h00.*fuera de su franja.*sin descanso de 15 min/);
  });
});

describe("indicadores del escenario", () => {
  const v1 = fila([viaje(T(6), T(6, 30), 10, { _depot_exit: true }), parada(T(6, 30), T(12)), viaje(T(12), T(12, 30), 10, { _depot_return: true })]);
  const v2 = { ...fila([viaje(T(10), T(10, 20), 5, { _depot_exit: true }), parada(T(10, 20), T(14)), viaje(T(14), T(14, 30), 5)]), _id: "v2" };
  const v3 = { ...fila([parada(T(15), T(16))]), _id: "v3" };
  it("PVR = vehículos a la vez en el peor momento", () => {
    expect(pvr([v1, v2, v3], 1)).toBe(2);
  });
  it("eficiencias, coste y avisos", () => {
    const k = scenarioKpis({ vehicles: [v1, v2, v3], unassigned: 3, days: 1, costeHora: 20, costeKm: 1 });
    expect(k).toMatchObject({ vehiculos: 3, pvr: 2, turnos: 3, paradas: 3, km: 30, kmVacio: 25, sinAsignar: 3 });
    expect(k.eficVehiculo).toBeCloseTo(5 / 30);
    expect(k.eficPersonal).toBeCloseTo(1); // sin esperas ni pausas: todo es productivo
    expect(k.coste).toBeCloseTo((k.pagado / 60) * 20 + 30);
    expect(scenarioKpis({ vehicles: [v1] }).coste).toBe(null); // sin tarifas no se inventa un coste
  });
});
