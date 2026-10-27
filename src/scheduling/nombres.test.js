import { describe, it, expect } from "vitest";
import { ponerNombres, renombrarEnEscenario } from "./nombres.js";

describe("nombres de los vehículos y conductores del cálculo", () => {
  const sch = {
    vehicles: [{ _id: "v1", nombre: "Camión 1" }, { _id: "virtual_veh_1", nombre: "Vehículo necesario 1", _virtual: true }],
    workers: [{ _id: "virtual_wrk_1_1", nombre: "Conductor necesario 1", _virtual: true }],
  };
  it("solo se renombran los del cálculo", () => {
    const a = renombrarEnEscenario(sch, "virtual_veh_1", "4521 KLM");
    expect(a.vehicles[1]).toMatchObject({ nombre: "4521 KLM", _renombrado: true });
    expect(renombrarEnEscenario(sch, "v1", "Otro").vehicles[0].nombre).toBe("Camión 1");
  });
  it("al volver a generar se ponen los nombres guardados", () => {
    const w = ponerNombres(sch.workers, { virtual_wrk_1_1: "Luis Pérez" });
    expect(w[0]).toMatchObject({ nombre: "Luis Pérez", apellidos: "" });
    expect(ponerNombres(sch.vehicles, { v1: "X" })[0].nombre).toBe("Camión 1");
  });
});
