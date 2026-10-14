import { describe, it, expect } from "vitest";
import { autonomiaPorTipo, limiteKm, asignarFlota } from "./lineas-sched/flota.js";
import { generarServicio } from "./lineas-sched.js";

describe("flota con autonomía", () => {
  it("límite por tipo: solo si todos los de ese tipo tienen autonomía", () => {
    const f = [{ id: 1, tipo: "electrico", autonomiaKm: 200 }, { id: 2, tipo: "electrico", autonomiaKm: 250 }, { id: 3, tipo: "estandar" }];
    const t = autonomiaPorTipo(f);
    expect(limiteKm(t, "electrico")).toBe(250);
    expect(limiteKm(t, "estandar")).toBe(Infinity);
    expect(limiteKm(t, null)).toBe(Infinity); // sin tipo: puede ir en el diésel
  });
  it("los recorridos más largos, a los de más autonomía; avisa si no llega o faltan", () => {
    const veh = [{ id: 1, viajes: [{ km: 180 }] }, { id: 2, viajes: [{ km: 90 }] }, { id: 3, viajes: [{ km: 300 }] }];
    const buses = [1, 2, 3].map(id => ({ id, bloques: [id] }));
    const r = asignarFlota(veh, buses, [{ id: "a", matricula: "1111AAA", autonomiaKm: 200 }, { id: "b", matricula: "2222BBB", autonomiaKm: 100 }]);
    expect(r.porAutobus[1]).toMatchObject({ matricula: "1111AAA", ok: true });
    expect(r.porAutobus[2]).toMatchObject({ matricula: "2222BBB", ok: true });
    expect(r.faltan).toBe(1); // el de 300 km se queda sin vehículo (el que más aguanta ya está cogido)
  });
  it("al hacer los autobuses, ninguna salida de cochera pasa de la autonomía", () => {
    const h = (hh, mm = 0) => hh * 60 + mm;
    const sal = Array.from({ length: 12 }, (_, k) => h(6) + k * 60);
    const s = (dir, paradas) => ({ dir, nombre: dir ? "Vuelta" : "Ida", paradas, km: 25, viajes: { laborable: 12 }, salidas: { laborable: dir ? sal.map(x => x + 30) : sal, sabado: [], festivo: [] }, tiempos: ["06-09", "09-13", "13-16", "16-20"].map(f => ({ franja: f, min: 25, viajes: 1 })) });
    const red = { lineas: [{ id: "E", nombre: "E", color: "#0f0", sentidos: [s(0, ["A", "B"]), s(1, ["B", "A"])] }] };
    const sin = generarServicio(red, {}, { dia: "laborable" });
    const cfg = { E: { tipos: ["electrico"] }, _flota: { lista: Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, matricula: `E${i}`, tipo: "electrico", autonomiaKm: 150 })) } };
    for (const eleccion of ["optimo", "ultimo"]) {
      const con = generarServicio(red, cfg, { dia: "laborable", eleccion });
      for (const v of con.vehiculos) expect(v.viajes.reduce((a, x) => a + (x.km || 0), 0)).toBeLessThanOrEqual(150);
      expect(con.kpis.autobuses).toBeGreaterThan(sin.kpis.autobuses); // 24 viajes × 25 km: un autobús no puede con todo
      expect(con.flota.porAutobus[1].matricula).toMatch(/^E\d$/);
    }
  });
});
