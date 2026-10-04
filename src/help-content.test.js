import { describe, it, expect } from "vitest";
import { AYUDA, TITULO, buscarAyuda } from "./help-content.js";

describe("ayuda de cada módulo", () => {
  it("hay preguntas en los cinco módulos, sin repetir y con respuesta", () => {
    expect(Object.keys(AYUDA).sort()).toEqual(Object.keys(TITULO).sort());
    for (const items of Object.values(AYUDA)) {
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(new Set(items.map(i => i.q)).size).toBe(items.length);
      for (const it of items) expect(it.a.length).toBeGreaterThan(20);
    }
  });

  it("sin texto muestra todo el módulo", () => {
    expect(buscarAyuda("rostering", "  ")).toHaveLength(AYUDA.rostering.length);
  });

  it("busca sin tildes ni mayúsculas, en pregunta, respuesta, pasos y etiquetas", () => {
    const r = buscarAyuda("scheduling", "RESTAURACION version");
    expect(r[0].item.q).toMatch(/versión anterior/);
    expect(buscarAyuda("scheduling", "tacógrafo").map(x => x.item.q)).toContain("¿Qué son los avisos \"!\" de la tabla?");
    expect(buscarAyuda("planning", "utm").every(x => x.modulo === "planning")).toBe(true);
  });

  it("si no está en el módulo actual, busca en los demás", () => {
    const r = buscarAyuda("analytics", "cochera depósito");
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(x => x.modulo !== "analytics")).toBe(true);
    expect(buscarAyuda("planning", "zzzz inexistente")).toEqual([]);
  });
});
