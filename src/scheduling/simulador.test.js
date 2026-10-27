import { describe, it, expect } from "vitest";
import { pagadoSimulado, ponerTrabajadoresExtra, textoPuesto } from "./simulador.js";
import { dayMetrics } from "../scenario-metrics.js";

describe("ponerTrabajadoresExtra", () => {
  const veh = [
    { nombre: "Camión 1", _effectiveStart: 360, _effectiveEnd: 840 },   // 06–14
    { nombre: "Camión 2", _effectiveStart: 360, _effectiveEnd: 1320 },  // 06–22
  ];
  it("pone el turno de más seguido al del vehículo con menos horas", () => {
    const { vehicles, puestos } = ponerTrabajadoresExtra(veh, 1, 480, 360, 1320);
    expect(vehicles[0]._effectiveEnd).toBe(1320);
    expect(vehicles[1]._effectiveEnd).toBe(1320);
    expect(textoPuesto(puestos[0])).toBe("Camión 1, de 14:00 a 22:00");
  });
  it("no pasa de 24 h por vehículo", () => {
    const { vehicles, puestos } = ponerTrabajadoresExtra(veh, 5, 480, 360, 1320);
    expect(vehicles.every(v => v._effectiveEnd - v._effectiveStart <= 1440)).toBe(true);
    expect(puestos.length).toBe(3); // Camión 1: 06–14 → 06–22 → 24 h; Camión 2: 06–22 → 24 h
  });
  it("sin trabajadores de más no cambia nada", () => {
    expect(ponerTrabajadoresExtra(veh, 0, 480, 360, 1320).puestos).toEqual([]);
  });
});

describe("pagadoSimulado", () => {
  const fila = { _id: "c1", _effectiveStart: 360, _effectiveEnd: 1320, assignments: [{ _start: 400, _end: 500, nombre: "P1" }, { _start: 700, _end: 800, nombre: "P2" }] };
  it("el trabajador de más cobra su turno entero aunque el vehículo no use sus horas", () => {
    const amp = dayMetrics(fila, 0).amplitud;
    expect(pagadoSimulado([fila], [], 1)).toBe(amp);
    expect(pagadoSimulado([fila], [{ id: "c1", desde: 840, hasta: 1320 }], 1)).toBe(Math.min(amp, 480) + 480);
    // un vehículo que no sale: su trabajador de más se paga igual
    expect(pagadoSimulado([{ _id: "c2", _effectiveStart: 360, _effectiveEnd: 1320, assignments: [] }], [{ id: "c2", desde: 840, hasta: 1320 }], 2)).toBe(960);
  });
});
