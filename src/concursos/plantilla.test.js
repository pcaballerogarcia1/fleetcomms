import { describe, expect, it } from "vitest";
import { costePlantilla, entenderPlantilla } from "./plantilla.js";

const csv = t => t.trim().split("\n").map(l => l.split(";"));
describe("plantilla a subrogar", () => {
  it("con el coste para la empresa: se suma, con la cobertura de absentismo", () => {
    const m = csv(`Relación de personal a subrogar\nNº;Categoría;Antigüedad;% Jornada;Salario bruto anual;Coste empresa anual
1;Conductor;01/03/2009;100;29.000,00;38.570,00
2;Peón;15/06/2015;100;23.000,00;30.590,00
3;Peón;01/07/2020;50;11.500,00;15.295,00
;TOTAL;;;63.500,00;84.455,00`);
    const e = entenderPlantilla(m);
    expect(e.columnas).toMatchObject({ categoria: 1, antiguedad: 2, jornada: 3, bruto: 4, coste: 5 });
    const r = costePlantilla(m, e, { absentismoPct: 5 });
    expect([r.personas, r.etc]).toEqual([3, 2.5]);
    expect(r.coste).toBeCloseTo(84455 * 1.05, 1);
    expect(r.porCategoria.map(c => [c.categoria, c.personas])).toEqual([["Peón", 2], ["Conductor", 1]]);
  });
  it("solo con el bruto: más la Seguridad Social de la empresa", () => {
    const m = csv(`Puesto;Jornada;Bruto anual\nPeón;1;20000\nPeón;0,5;10000`);
    const r = costePlantilla(m, entenderPlantilla(m), { ssPct: 33, absentismoPct: 0 });
    expect(r.etc).toBe(1.5);
    expect(r.coste).toBeCloseTo(30000 * 1.33, 1);
  });
  it("sin sueldo ni coste: lo pide", () => {
    expect(costePlantilla(csv(`Nombre;Categoría\nAna;Peón`)).error).toMatch(/sueldo/);
  });
});
