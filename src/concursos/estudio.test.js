import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { estudioDeCostes, subidaAnio } from "./estudio.js";

// Anexo 1 del pliego técnico de Gozón (CON/2026/12, documento público): el estudio de costes del Ayuntamiento
const paginas = readFileSync(new URL("./__fixtures__/gozon-ppt-anexo.txt", import.meta.url), "utf8").split(/=== PÁGINA \d+ ===\n?/).slice(1);

describe("estudio de costes del Ayuntamiento", () => {
  const e = estudioDeCostes(paginas);
  it("las partidas, con sus totales, y que cuadran", () => {
    expect(e.partidas.map(p => [p.id, p.total])).toEqual([
      ["personal", 612918.33], ["inversion", 229881.52], ["funcionamiento", 127076.63], ["seguros", 9820], ["otros", 132177.37],
    ]);
    expect(e.cuadra).toBe(true);
    expect(e.costeEjecucion).toBe(1111873.85);
  });
  it("gastos generales y beneficio, IVA y valor estimado", () => {
    expect([e.ggbiPct, e.ggbi, e.baseImponible, e.ivaPct, e.totalConIva, e.valorEstimado]).toEqual([15, 166781.08, 1278654.93, 10, 1406520.42, 14301991.98]);
  });
  it("las categorías de personal y las líneas partidas en varias líneas", () => {
    const pe = e.partidas.find(p => p.id === "personal");
    expect(pe.lineas[0]).toMatchObject({ uds: 2.14, concepto: "Peón RBU día", unitario: 23379.27, total: 49941.49 });
    const otros = e.partidas.find(p => p.id === "otros");
    expect(otros.lineas.find(l => /fiestas/.test(l.concepto))).toMatchObject({ uds: 12, total: 2920.2 });
  });
  it("los 10 años y lo que sube cada uno", () => {
    expect(e.anios.base).toHaveLength(10);
    expect(e.anios.base[9]).toBe(1586787.46);
    expect(subidaAnio(e, 1)).toEqual({ manoObra: 3.25, resto: 3 });
    expect(subidaAnio(e, 9)).toEqual({ manoObra: 2.75, resto: 3 });
  });
  it("sin estudio: null", () => {
    expect(estudioDeCostes(["El servicio se prestará de lunes a viernes."])).toBeNull();
  });
});
