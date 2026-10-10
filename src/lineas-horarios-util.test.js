import { describe, it, expect } from "vitest";
import { leerHora, hhmmTxt } from "./lineas-horarios-util.js";

describe("horas de salida escritas a mano", () => {
  it("lee formatos habituales y las de después de medianoche", () => {
    expect(leerHora("07:35")).toBe(455);
    expect(leerHora("7:05")).toBe(425);
    expect(leerHora("7.05")).toBe(425);
    expect(leerHora("0735")).toBe(455);
    expect(leerHora("25:10")).toBe(1510);
    expect(leerHora("7:65")).toBe(null);
    expect(leerHora("hola")).toBe(null);
    expect(hhmmTxt(1510)).toBe("25:10");
  });
});
