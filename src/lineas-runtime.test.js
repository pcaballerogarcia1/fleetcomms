import { describe, it, expect } from "vitest";
import { analizarTiempos } from "./lineas-runtime.js";

describe("análisis de tiempos reales", () => {
  it("por línea, sentido y franja: real frente a previsto, y puntualidad", () => {
    const v = (k, dep, arr, extra = {}) => ({ k, lid: "L1", l: "481", dir: 0, s: "Ida", dep, arr, v: 0, ...extra });
    const turnos = [
      { viajes: [v(0, 420, 460), v(1, 470, 510), v(2, 600, 640, { v: 1 })], real: { salidas: { 0: 421, 1: 476, 2: 600 }, llegadas: { 0: 466, 1: 523, 2: 640 } } },
      { viajes: [v(0, 440, 480)], real: { salidas: { 0: 440 }, llegadas: { 0: 488 } } },
      { viajes: [v(0, 500, 540)], real: { salidas: { 0: 499 } } }, // sin llegada: cuenta para la puntualidad, no para el tiempo
    ];
    const { filas, totales } = analizarTiempos(turnos);
    const f = filas.find(x => x.franja === "06-09");
    expect(f).toMatchObject({ linea: "481", n: 3, previsto: 40, real: 47 }); // 45, 47, 48
    expect(f.diferencia).toBe(7);
    const g = filas.find(x => x.franja === "06-09");
    expect(g.salidas).toBe(4); // las cuatro salen entre las 6 y las 9
    expect(totales.viajesMedidos).toBe(3);
    expect(totales.salidasMedidas).toBe(4);
    expect(totales.puntualidad).toBeCloseTo(3 / 4, 5); // la de 476 sale 6 min tarde
  });
});
