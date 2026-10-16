import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { documentosDeDetalle, licitacionDeCodice } from "./codice.js";

const leer = f => readFileSync(new URL(`./__fixtures__/${f}`, import.meta.url), "utf8");

describe("datos oficiales de la Plataforma (CODICE)", () => {
  const l = licitacionDeCodice(leer("pliego.xml"));
  it("presupuesto, valor estimado, duración y CPV", () => {
    expect(l).toMatchObject({ expediente: "28/2026", cpvs: ["71210000"], presupuesto: { sinIva: 64400, conIva: 68908 }, valorEstimado: 128800, duracion: { valor: 2, unidad: "ANN", meses: 24 } });
  });
  it("criterios con su peso y su tipo", () => {
    expect(l.criterios.map(c => [c.tipo, c.peso])).toEqual([["formula", 18], ["mejora", 7], ["precio", 26], ["juicio", 49]]);
    expect(l.criterios.reduce((s, c) => s + c.peso, 0)).toBe(100);
  });
  it("los pliegos y anexos con su enlace", () => {
    expect(l.documentos.filter(d => d.tipo !== "anexo").map(d => [d.tipo, d.nombre])).toEqual([["pcap", "PCAP_28_2026.pdf"], ["ppt", "PPT_28_2026.pdf"]]);
    expect(l.documentos.every(d => d.uri.startsWith("https://contrataciondelestado.es/"))).toBe(true);
  });
  it("la página de la licitación: cada documento con sus enlaces (HTML, XML y PDF)", () => {
    const d = documentosDeDetalle(leer("detalle.html"));
    expect(d.slice(0, 2).map(x => [x.nombre, x.enlaces.length])).toEqual([["Anuncio de Licitación", 3], ["Pliego", 3]]);
  });
});
