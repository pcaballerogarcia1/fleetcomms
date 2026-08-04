import { describe, it, expect } from "vitest";
import { workerCodeOnDay, isUnavailable, SHIFTS, SHIFT_META } from "./rostering.jsx";

describe("workerCodeOnDay", () => {
  const grid = { w1: { "5": "M", "6": "L" } };

  it("devuelve el código del turno de ese día", () => {
    expect(workerCodeOnDay(grid, "w1", 5)).toBe("M");
  });
  it("devuelve cadena vacía si el trabajador no tiene turno ese día", () => {
    expect(workerCodeOnDay(grid, "w1", 12)).toBe("");
  });
  it("devuelve cadena vacía si el trabajador no existe en la rejilla", () => {
    expect(workerCodeOnDay(grid, "desconocido", 5)).toBe("");
  });
  it("indexa el día como string aunque se pase un número", () => {
    expect(workerCodeOnDay(grid, "w1", 6)).toBe("L");
  });
});

describe("isUnavailable", () => {
  it("Libre y Baja cuentan como no disponible", () => {
    expect(isUnavailable("L")).toBe(true);
    expect(isUnavailable("B")).toBe(true);
  });
  it("el resto de códigos de turno cuentan como disponible", () => {
    for (const code of SHIFTS.filter(c => c !== "L" && c !== "B")) {
      expect(isUnavailable(code)).toBe(false);
    }
  });
  it("cadena vacía (sin turno asignado) no cuenta como no disponible", () => {
    expect(isUnavailable("")).toBe(false);
  });
});

// Regresión de consistencia de datos: cualquier código en SHIFTS debe tener
// su metadata (label/color) — un código sin entrada en SHIFT_META rompería
// el render del Gantt de Rostering con un label "undefined".
describe("SHIFT_META", () => {
  it("tiene metadata para todos los códigos de SHIFTS", () => {
    for (const code of SHIFTS) {
      expect(SHIFT_META[code]).toBeDefined();
      expect(typeof SHIFT_META[code].label).toBe("string");
    }
  });
});
