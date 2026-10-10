import { describe, it, expect } from "vitest";
import { leerHora, hhmmTxt, agruparVariantes, textoVariante } from "./lineas-horarios-util.js";

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

describe("agruparVariantes", () => {
  it("junta las variantes con el mismo nombre y operador, en orden", () => {
    const l = (id, nombre, agencia = "A") => ({ id, nombre, agencia, sentidos: [] });
    const g = agruparVariantes([l("M01_A", "1"), l("M02_A", "2"), l("M01_B", "1"), l("X1", "1", "B")]);
    expect(g.map(x => x.lineas.map(v => v.id))).toEqual([["M01_A", "M01_B"], ["M02_A"], ["X1"]]);
    expect(g[0].nombre).toBe("1");
  });
  it("una línea sin nombre va sola", () => {
    expect(agruparVariantes([{ id: "a", nombre: "" }, { id: "b", nombre: "" }]).length).toBe(2);
  });
  it("texto de la variante", () => {
    expect(textoVariante({ largo: "Parede - Cascais" })).toBe("Parede - Cascais");
    expect(textoVariante({ sentidos: [{ cabecera: "A" }, { cabecera: "B" }] })).toBe("A ↔ B");
  });
});
