import { describe, expect, it } from "vitest";
import { SECTORES, fijarSector, sectorDe } from "./sector.js";

describe("sector del proyecto", () => {
  it("sin sector es residuos (los proyectos de siempre no cambian)", () => {
    expect(sectorDe({}).id).toBe("residuos");
    expect(sectorDe(null).t.elementos).toBe("contenedores");
    expect(sectorDe({ sector: "inventado" }).id).toBe("residuos");
  });
  it("cada sector tiene todas las palabras y dice qué se enseña", () => {
    const claves = Object.keys(SECTORES[0].t), ver = Object.keys(SECTORES[0].ver);
    for (const s of SECTORES) {
      expect(Object.keys(s.t).sort()).toEqual([...claves].sort());
      expect(Object.keys(s.ver).sort()).toEqual([...ver].sort());
    }
    expect(sectorDe("contadores").t.Elementos).toBe("Contadores");
    expect(sectorDe("viaria")).toMatchObject({ nombre: "Limpieza viaria", ver: { callejero: true, pesadas: false } });
    expect(sectorDe({ sector: "contadores" }).ver.pesadas).toBe(false);
  });
  it("fijarSector acepta un id o nada", () => {
    expect(() => { fijarSector("contadores"); fijarSector(undefined); }).not.toThrow();
  });
});
