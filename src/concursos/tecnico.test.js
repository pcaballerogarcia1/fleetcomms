import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cuentaExplotacion } from "./calculo.js";
import { estudioDeCostes } from "./estudio.js";
import { dimensionar, serviciosDelTecnico } from "./ficha.js";
import { minimoDePersonal, personalExigido, serviciosPorFrecuencia, serviciosPorMediciones, textoPersonal, vecesAlAnio } from "./tecnico.js";

const paginas = f => readFileSync(new URL(`./__fixtures__/${f}`, import.meta.url), "utf8").split(/=== PÁGINA \d+ ===\n/).slice(1);

describe("frecuencias", () => {
  it("veces al año", () => {
    expect(vecesAlAnio("6 veces por semana").veces).toBe(312);
    expect(vecesAlAnio("dos veces al mes").veces).toBe(24);
    expect(vecesAlAnio("diariamente").veces).toBe(365);
    expect(vecesAlAnio("cada 15 días").veces).toBe(24);
    expect(vecesAlAnio("cuando haga falta")).toBeNull();
  });
  it("limpieza viaria de Santo Domingo: barrido manual y mecánico por zona", () => {
    const s = serviciosPorFrecuencia(paginas("viaria-ppt-frecuencias.txt"));
    expect(s).toHaveLength(8);
    expect(s[0]).toMatchObject({ nombre: "Barrido manual", zona: "Zona 1 · CASCO HISTÓRICO", cantidadAnual: 312 });
    expect(s.find(x => x.zona.startsWith("Zona 4") && x.nombre === "Barrido mecánico").cantidadAnual).toBe(104);
  });
  it("el personal que exige: jefe al 25 %, 4 peones especialistas y 4 peones", () => {
    const p = personalExigido(paginas("viaria-ppt-frecuencias.txt"));
    const texto = textoPersonal(p);
    expect(texto).toBe("1 Jefe de Servicio (25 %) · 4 Peones especialistas · 4 Peones");
    expect(minimoDePersonal(texto)).toEqual({ operarios: 8, encargados: 0, jefe: 0.25 });
  });
});

describe("mediciones del presupuesto", () => {
  it("transporte de lodos: 260 t, 130 t y 78 t con su precio", () => {
    const m = serviciosPorMediciones(paginas("lodos-mediciones.txt"));
    expect(m.map(x => [x.cantidad, x.unidad, x.precio])).toEqual([[260, "t", 21.08], [130, "t", 44.75], [78, "t", 31.28]]);
    expect(m[0].nombre).toMatch(/^Servicio de transporte de fangos EDAR Arguinegu/);
    const [prop] = serviciosDelTecnico({ mediciones: m }, "doc1");
    expect(prop.lineas[0]).toMatchObject({ nombre: "Transporte de residuos", cantidadAnual: 260, unidad: "t", precioUnitario: 21.08 });
  });
});

describe("de la ficha al coste", () => {
  it("los servicios por frecuencia se dimensionan y la plantilla no baja del mínimo del pliego", () => {
    const [prop] = serviciosDelTecnico({ frecuencias: serviciosPorFrecuencia(paginas("viaria-ppt-frecuencias.txt")) }, "d");
    const d = dimensionar(prop.lineas);
    expect(d.equipos.map(e => e.equipo).sort()).toEqual(["barredora", "carro de barrido manual"]);
    const c = cuentaExplotacion(d, { minimoPliego: { operarios: 8, encargados: 0, jefe: 0.25 } });
    expect(c.plantilla.servicio).toBeGreaterThanOrEqual(8);
    expect(c.plantilla.jefe).toBe(0.25);
  });
  it("estructura de costes con el total en la línea del título (Anexo II de Santo Domingo)", () => {
    const e = estudioDeCostes(paginas("viaria-estructura-costes.txt"));
    expect(e.partidas.map(p => [p.id, p.total])).toEqual([["personal", 260672.5], ["funcionamiento", 59444.91], ["otros", 38751.25], ["inversion", 61636.5]]);
    expect([e.costeEjecucion, e.ggbiPct, e.baseImponible, e.ivaPct, e.totalConIva, e.cuadra]).toEqual([420505.15, 8, 454145.57, 10, 499560.12, true]);
  });
});
