import { describe, it, expect } from "vitest";
import { diferenciasCuadrante, nombreVersionCuadrante } from "./roster-versiones.js";

describe("diferenciasCuadrante", () => {
  it("lista por trabajador los días con otro turno", () => {
    const d = diferenciasCuadrante(
      { w1: { 1: "M", 2: "T" }, w2: { 1: "L" } },
      { w1: { 1: "M", 2: "M", 3: "N" }, w2: { 1: "L" } });
    expect(d.celdas).toBe(2);
    expect(d.porTrabajador).toEqual([{ wid: "w1", dias: [{ d: 2, antes: "M", ahora: "T" }, { d: 3, antes: "N", ahora: "" }] }]);
  });
  it("iguales: nada", () => {
    expect(diferenciasCuadrante({ w1: { 1: "M" } }, { w1: { 1: "M" } }).celdas).toBe(0);
  });
  it("sin nombre, la fecha", () => {
    expect(nombreVersionCuadrante({ nombre: "Base" })).toBe("Base");
    expect(nombreVersionCuadrante({ at: Date.UTC(2026, 9, 27, 10) })).toMatch(/^Versión del 27\/10/);
  });
});
