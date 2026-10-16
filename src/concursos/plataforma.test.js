import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("../firebase.js", () => ({ auth: {}, db: {} }));
vi.mock("./store.js", () => ({}));
const { datosOficiales, documentosUtiles, tipoPorCpv } = await import("./plataforma.js");
const { licitacionDeCodice } = await import("../../api/_plataforma/codice.js");

const l = { ...licitacionDeCodice(readFileSync(new URL("../../api/_plataforma/__fixtures__/pliego.xml", import.meta.url), "utf8")), enlace: "https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&idEvl=x" };

describe("datos oficiales de la Plataforma → ficha y concurso", () => {
  const { datos, adjudicacion, concurso } = datosOficiales(l);
  it("los datos van confirmados y marcados como oficiales", () => {
    expect(datos.duracion).toMatchObject({ valor: "2 años", estado: "confirmado", doc: "plataforma" });
    expect(datos.importeSinIva.valor).toBe(64400);
    expect(datos.valorEstimado.valor).toBe(128800);
  });
  it("los criterios con su peso; la fórmula del precio se marca como supuesta", () => {
    expect(adjudicacion.criterios.map(c => [c.tipo, c.puntos])).toEqual([["formula", 18], ["mejora", 7], ["precio", 26], ["juicio", 49]]);
    expect(adjudicacion.formulaSupuesta).toBe(true);
  });
  it("el concurso: duración, presupuesto con y sin IVA y enlace", () => {
    expect(concurso).toMatchObject({ duracionMeses: 24, duracionAnios: 2, presupuestoSinIva: 64400, presupuestoConIva: 68908, valorEstimado: 128800 });
    expect(concurso.plataforma.enlace).toMatch(/deeplink/);
  });
  it("solo los documentos útiles (no los modelos de declaración ni el DEUC)", () => {
    const nombres = documentosUtiles(l).map(d => d.nombre);
    expect(nombres).toContain("PCAP_28_2026.pdf");
    expect(nombres).toContain("PPT_28_2026.pdf");
    expect(nombres.some(n => /DEUC|AVAL|SEGURO/i.test(n))).toBe(false);
  });
  it("autobuses o por puntos, por el CPV", () => {
    expect(tipoPorCpv(["60112000"])).toBe("lineas");
    expect(tipoPorCpv(["90511000"])).toBe("puntos");
  });
});
