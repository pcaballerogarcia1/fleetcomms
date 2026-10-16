import { describe, expect, it } from "vitest";
import { anormales, puntosPrecio, simularBajas } from "./oferta.js";

describe("puntos del precio", () => {
  const P = 1000;
  it("lineal: la más baja todos, la que no baja ninguno", () => {
    expect(puntosPrecio([900, 800, 1000], { formula: "lineal", maximo: 40, presupuesto: P })).toEqual([20, 40, 0]);
  });
  it("proporcional a la más baja", () => {
    expect(puntosPrecio([800, 1000], { formula: "proporcional", maximo: 50, presupuesto: P })).toEqual([50, 40]);
  });
  it("umbral de saciedad", () => {
    const [a, b] = puntosPrecio([950, 800], { formula: "saciedad", maximo: 40, presupuesto: P, saciedad: 10 });
    expect(a).toBeCloseTo(20, 6);
    expect(b).toBe(40);
  });
});

describe("baja anormal (art. 85 RGLCAP)", () => {
  it("una oferta: más de 25", () => expect(anormales([26])).toEqual([true]));
  it("dos: más de 20 por debajo de la otra", () => expect(anormales([25, 4])).toEqual([true, false]));
  it("tres: más de 10 sobre la media", () => expect(anormales([25, 5, 6])).toEqual([true, false, false]));
  it("cuatro o más: sin las muy caras en la media", () => expect(anormales([20, 8, 9, 10, 0])).toEqual([true, false, false, false, false]));
  it("regla del pliego: puntos sobre la baja media", () => expect(anormales([20, 6, 6], { id: "media", valor: 8 })).toEqual([true, false, false]));
});

describe("qué baja presentar", () => {
  const criterios = [{ tipo: "precio", puntos: 40 }, { tipo: "formula", puntos: 40 }, { tipo: "juicio", puntos: 20 }];
  it("la menor baja que gana (sin empatar) sin perder dinero ni caer en anormal", () => {
    const r = simularBajas({ criterios, formula: "lineal", presupuesto: 1000, coste: 850, competidores: [{ baja: 8, tecnicaPct: 70 }, { baja: 5, tecnicaPct: 75 }], tecnicaPct: 70, margenMinimoPct: 0 });
    expect(r.recomendada.puesto).toBe(1);
    expect(r.recomendada.baja).toBe(8.5);
    expect(r.recomendada.anormal).toBe(false);
    expect(r.maxima.baja).toBe(15);
  });
  it("si no se puede ganar con margen, la mejor posición posible", () => {
    const r = simularBajas({ criterios, presupuesto: 1000, coste: 990, competidores: [{ baja: 10, tecnicaPct: 90 }], tecnicaPct: 50, margenMinimoPct: 0 });
    expect(r.recomendada.puesto).toBe(2);
  });
});

describe("Gozón de punta a punta: estudio + criterios del pliego", async () => {
  const { readFileSync } = await import("node:fs");
  const { estudioDeCostes } = await import("./estudio.js");
  const { criteriosDelPliego, mejorPropuesta } = await import("./criterios.js");
  const { analizarOferta, nivelesMejora } = await import("./oferta.js");
  const leer = f => readFileSync(new URL(`./__fixtures__/${f}`, import.meta.url), "utf8").split(/=== PÁGINA \d+ ===\n?/).slice(1);
  const estudio = estudioDeCostes(leer("gozon-ppt-anexo.txt"));
  const prop = mejorPropuesta([{ nombre: "anuncio", adjudicacion: criteriosDelPliego(leer("gozon-anuncio.txt")) }, { nombre: "PCAP", adjudicacion: criteriosDelPliego(leer("gozon-pcap-criterios.txt")) }]);
  const ficha = { datos: {}, servicios: {}, estudio, adjudicacion: { criterios: prop.criterios, formula: "lineal", formulaSupuesta: true, baja: prop.baja } };
  const concurso = { duracionAnios: 10, valorEstimado: 14301991.99 };
  const a = analizarOferta({ ficha, dim: {}, calc: {}, concurso, oferta: {} });

  it("los niveles de una mejora", () => {
    expect(nivelesMejora(prop.criterios.find(c => /papeleras/i.test(c.nombre)))).toEqual([{ unidades: 0, puntos: 0 }, { unidades: 6, puntos: 1 }, { unidades: 11, puntos: 3 }, { unidades: 16, puntos: 5 }]);
  });
  it("nada bloquea; avisa de la fórmula supuesta", () => {
    expect(a.bloqueado).toBe(false);
    expect(a.alarmas.some(x => /fórmula/.test(x.texto))).toBe(true);
  });
  it("la baja recomendada es pequeña (el margen del estudio es poco) y las mejoras se eligen solas", () => {
    expect(a.combinaciones).toBe(16);
    expect(a.elegida).toBeTruthy();
    expect(a.elegida.baja).toBeLessThan(8);
    expect(a.mejorasElegidas).toHaveLength(2);
  });
  it("si los años o el presupuesto no cuadran con el valor estimado, bloquea", () => {
    const mal = analizarOferta({ ficha, dim: {}, calc: {}, concurso: { duracionAnios: 10, valorEstimado: 5000000 }, oferta: {} });
    expect(mal.bloqueado).toBe(true);
  });
});
