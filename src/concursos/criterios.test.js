import { describe, expect, it } from "vitest";
import { criteriosDelPliego } from "./criterios.js";

describe("criterios de adjudicación", () => {
  it("anuncio de la Plataforma: Subtipo Criterio / Ponderación, aunque cambie de página", () => {
    const r = criteriosDelPliego([
      "Criterios de Adjudicación\nCriterios evaluables mediante aplicación de fórmulas\nCARACTERÍSTICAS TÉCNICAS\n: Otros Subtipo Criterio\n: 40 Ponderación\nPROPOSICIÓN ECONÓMICA\n: Precio Subtipo Criterio\n: 40 Ponderación\nCriterios evaluables mediante un juicio de valor\nDossier\n: Otros Subtipo Criterio",
      "Dirección Postal\nPlaza de San Sebastián, nº 1\n(41004) Sevilla España\n: 20 Ponderación\nPlazo de Validez de la Oferta",
    ]);
    expect(r.criterios.map(c => [c.nombre, c.puntos, c.tipo])).toEqual([["CARACTERÍSTICAS TÉCNICAS", 40, "formula"], ["PROPOSICIÓN ECONÓMICA", 40, "precio"], ["Dossier", 20, "juicio"]]);
  });

  it("pliego administrativo: «hasta N puntos», fórmula proporcional y artículo 85", () => {
    const r = criteriosDelPliego([`CLÁUSULA 12. CRITERIOS DE ADJUDICACIÓN
A) Criterios evaluables mediante fórmulas (hasta 60 puntos)
1. Oferta económica: hasta 51 puntos.
2. Incremento de la frecuencia de lavado: hasta 9 puntos.
B) Criterios sujetos a juicio de valor (hasta 40 puntos)
1. Memoria técnica del servicio: hasta 25 puntos.
2. Plan de mantenimiento (máximo 15 puntos)
La oferta económica se puntuará con la fórmula Pi = 51 x (Omin / Oi).
Se considerarán ofertas anormalmente bajas las que se encuentren en los supuestos del artículo 85 del Reglamento General de la Ley de Contratos.`]);
    expect(r.criterios.map(c => [c.nombre, c.puntos, c.tipo])).toEqual([
      ["Oferta económica", 51, "precio"], ["Incremento de la frecuencia de lavado", 9, "formula"],
      ["Memoria técnica del servicio", 25, "juicio"], ["Plan de mantenimiento", 15, "juicio"],
    ]);
    expect(r.formula.id).toBe("proporcional");
    expect(r.baja.id).toBe("art85");
  });

  it("baja anormal por puntos sobre la media y fórmula lineal", () => {
    const r = criteriosDelPliego(["Precio: 60 puntos. P = 60 x (PBL - Oi) / (PBL - Omin). Se considerará anormalmente baja la oferta cuya baja supere en 8 unidades porcentuales a la baja media."]);
    expect(r.formula.id).toBe("lineal");
    expect(r.baja).toMatchObject({ id: "media", valor: 8 });
  });
});

describe("criterios reales de Gozón (CON/2026/12)", async () => {
  const { readFileSync } = await import("node:fs");
  const { mejorPropuesta } = await import("./criterios.js");
  const leer = f => readFileSync(new URL(`./__fixtures__/${f}`, import.meta.url), "utf8").split(/=== PÁGINA \d+ ===\n?/).slice(1);
  const pcap = criteriosDelPliego(leer("gozon-pcap-criterios.txt"));
  const anuncio = criteriosDelPliego(leer("gozon-anuncio.txt"));
  it("pliego administrativo: precio, memoria con sus 8 apartados y dos mejoras con escalones; suma 100", () => {
    expect(pcap.criterios.map(c => [c.tipo, c.puntos]).sort()).toEqual([["juicio", 45], ["mejora", 5], ["mejora", 5], ["precio", 45]]);
    expect(pcap.criterios.find(c => c.tipo === "juicio").subcriterios.map(s => s.puntos)).toEqual([12, 12, 3, 3, 9, 2, 2, 2]);
    expect(pcap.criterios.find(c => /papeleras/i.test(c.nombre)).escalones).toEqual([{ desde: 6, hasta: 10, puntos: 1 }, { desde: 11, hasta: 15, puntos: 3 }, { desde: 16, hasta: null, puntos: 5 }]);
    expect(pcap.formula).toBeNull(); // el pliego no dice la fórmula del precio
    expect(pcap.baja.id).toBe("art85");
  });
  it("con el anuncio: el grupo que suma 100, con los apartados y escalones del pliego", () => {
    const p = mejorPropuesta([{ nombre: "anuncio.pdf", adjudicacion: anuncio }, { nombre: "PCAP.pdf", adjudicacion: pcap }]);
    expect(p.suma).toBe(100);
    expect(p.criterios.filter(c => c.tipo === "mejora").every(c => c.escalones?.length === 3)).toBe(true);
    expect(p.criterios.find(c => c.tipo === "juicio").subcriterios).toHaveLength(8);
    expect(p.baja.id).toBe("art85");
  });
});
