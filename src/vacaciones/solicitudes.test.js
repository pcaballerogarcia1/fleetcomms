import { describe, it, expect } from "vitest";
import { companerosTrabajando, diasDe, diasPorMes, ordenarSolicitudes, problemaSolicitud, resumenAño } from "./solicitudes.js";

describe("solicitudes de vacaciones", () => {
  it("días entre dos fechas, aunque cambie de mes", () => {
    expect(diasDe("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(diasDe("2026-11-02", "2026-11-01")).toEqual([]);
    expect(diasPorMes("2026-10-30", "2026-11-02")).toEqual({ "2026-10": [30, 31], "2026-11": [1, 2] });
  });

  it("comprueba lo que se pide", () => {
    const hoy = "2026-10-28";
    expect(problemaSolicitud({ tipo: "vacaciones", desde: "2026-11-02", hasta: "2026-11-06" }, hoy)).toBeNull();
    expect(problemaSolicitud({ tipo: "x", desde: "2026-11-02", hasta: "2026-11-06" }, hoy)).toMatch(/tipo/);
    expect(problemaSolicitud({ tipo: "vacaciones", desde: "2026-11-06", hasta: "2026-11-02" }, hoy)).toMatch(/anterior/);
    expect(problemaSolicitud({ tipo: "vacaciones", desde: "2026-10-01", hasta: "2026-10-02" }, hoy)).toMatch(/pasados/);
    expect(problemaSolicitud({ tipo: "vacaciones", desde: "2026-11-01", hasta: "2027-02-01" }, hoy)).toMatch(/Como mucho/);
  });

  it("días de vacaciones del año: aprobados y pendientes", () => {
    const s = [
      { tipo: "vacaciones", estado: "aprobada", desde: "2026-12-30", hasta: "2027-01-02" }, // 2 en 2026
      { tipo: "vacaciones", estado: "pendiente", desde: "2026-08-01", hasta: "2026-08-05" },
      { tipo: "asuntos", estado: "aprobada", desde: "2026-05-01", hasta: "2026-05-01" },     // no cuenta
      { tipo: "vacaciones", estado: "rechazada", desde: "2026-07-01", hasta: "2026-07-10" },
    ];
    expect(resumenAño(s, 2026)).toEqual({ aprobados: 2, pendientes: 5 });
    expect(resumenAño(s, 2027)).toEqual({ aprobados: 2, pendientes: 0 });
  });

  it("cuántos compañeros trabajan esos días", () => {
    const grids = { "2026-11": { w1: { 2: "M", 3: "M" }, w2: { 2: "T", 3: "L" }, w3: { 2: "V", 3: "N" } } };
    expect(companerosTrabajando(grids, "w1", "2026-11-02", "2026-11-03")).toEqual({ minimo: 1, dia: "2026-11-02", porDia: { "2026-11-02": 1, "2026-11-03": 1 } });
  });

  it("pendientes primero", () => {
    const o = ordenarSolicitudes([{ id: 1, estado: "aprobada", desde: "2026-01-01" }, { id: 2, estado: "pendiente", creadaAt: 5 }, { id: 3, estado: "pendiente", creadaAt: 1 }]);
    expect(o.map(x => x.id)).toEqual([3, 2, 1]);
  });
});
