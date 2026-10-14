import { describe, it, expect } from "vitest";
import { turnoDe, diaDeDespacho, candidatos, vehiculosLibres } from "./despacho.js";

const w = (id, extra = {}) => ({ _id: id, nombre: id, uid: `u-${id}`, ...extra });
const workers = [w("ana", { vehiculoId: "v1" }), w("bea", { vehiculoId: "v2" }), w("carlos"), w("dani"), w("eva"), w("fede")];
const vehiculos = [{ _id: "v1", nombre: "Camión 1" }, { _id: "v2", nombre: "Camión 2" }, { _id: "v3", nombre: "Camión 3" }];
const porTrabajador = {
  ana: { grid: { 10: "M", 9: "M" } },
  bea: { grid: { 10: "B" }, despacho: { 10: { hueco: { code: "T", s: 840, e: 1320, v: "v2", vn: "Camión 2" }, motivo: "Baja médica" } } },
  carlos: { grid: { 10: "G" } },
  dani: { grid: { 10: "L", 9: "N" } },         // ayer de noche: no descansa para la tarde de hoy
  eva: { grid: { 10: "" } },
  fede: { grid: { 10: "D", 4: "M", 5: "M", 6: "M", 7: "M", 8: "M", 9: "M" } }, // 6 días seguidos antes
};

describe("despacho del día", () => {
  it("lee el turno del cuadrante o el horario de Optimizar", () => {
    expect(turnoDe({ grid: { 3: "T" } }, 3)).toMatchObject({ code: "T", s: 840, e: 1320 });
    expect(turnoDe({ grid: { 3: "M" }, asign: { 3: { s: 300, e: 780, v: "v9", vn: "Bus 9" } } }, 3)).toMatchObject({ s: 300, v: "v9", vn: "Bus 9" });
    expect(turnoDe({ grid: { 3: "B" } }, 3)).toBe(null);
    expect(turnoDe({ grid: { 3: "G" } }, 3)).toBe(null);
  });

  it("lista los turnos, los huecos sin cubrir y los vehículos que no están disponibles", () => {
    const planes = [{ diaNum: 10, workerId: "ana", ubicaciones: [{ realizado: true }, { realizado: false }] }];
    const r = diaDeDespacho({ workers, vehiculos, porTrabajador, gridVehiculos: { v1: { 10: "T" } }, d: 10, planes });
    expect(r.filas.map(f => f.worker._id)).toEqual(["ana"]);
    expect(r.filas[0]).toMatchObject({ vehiculo: { id: "v1", nombre: "Camión 1" }, problemaVeh: true, paradas: 2, hechas: 1 });
    expect(r.sinCubrir).toHaveLength(1);
    expect(r.sinCubrir[0]).toMatchObject({ workerId: "bea", code: "T", motivo: "Baja médica" });
    expect(r.vehiculosMal).toHaveLength(1);
  });

  it("propone quién cubre: guardia, disponible, sin turno, libre; y explica por qué alguien no vale", () => {
    const hueco = { workerId: "bea", code: "T", s: 840, e: 1320 };
    const r = candidatos({ hueco, workers, porTrabajador, rules: { descansoMinH: 12, maxDiasSeguidos: 6 }, d: 10, daysInMonth: 31 });
    const orden = r.map(c => c.worker._id);
    expect(orden).not.toContain("ana");   // ya trabaja
    expect(orden).not.toContain("bea");   // es la del hueco
    expect(r.filter(c => c.valido).map(c => c.worker._id)).toEqual(["carlos", "eva"]);
    const dani = r.find(c => c.worker._id === "dani");
    expect(dani.valido).toBe(false);
    expect(dani.motivo).toMatch(/descansaría/);
    const fede = r.find(c => c.worker._id === "fede");
    expect(fede.motivo).toMatch(/7 días seguidos/);
  });

  it("vehículos libres: disponibles y sin conductor ese día", () => {
    const { filas } = diaDeDespacho({ workers, vehiculos, porTrabajador, d: 10 });
    expect(vehiculosLibres({ vehiculos, filas, gridVehiculos: { v3: { 10: "A" } }, d: 10 }).map(v => v._id)).toEqual(["v2"]);
  });
});
