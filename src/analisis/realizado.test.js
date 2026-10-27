import { describe, it, expect } from "vitest";
import { filasRealizado, totalesRealizado, fechaDelPlan } from "./realizado.js";

const hora = (h, m = 0) => new Date(2026, 9, 5, h, m).getTime();

describe("planificado frente a realizado", () => {
  const plan = {
    _id: "p1", tipo: "prev", mes: "2026-10", diaNum: 5, vehiculoNombre: "Camión 1", conductorNombre: "Ana",
    conductorUid: null, plan: { inicio: 360, fin: 840, minutos: 480, km: 40 },
    ubicaciones: [
      { pa: "P1", calle: "Mayor", num: "1", horaPlan: 400, realizado: true, realizadoPor: "u1", realizadoEn: hora(6, 50) },
      { pa: "P2", calle: "Sol", horaPlan: 420, realizado: true, realizadoPor: "u1", realizadoEn: hora(7, 20) },
      { pa: "P3", calle: "Luna", horaPlan: 450, realizado: false },
    ],
  };
  const fich = [{ uid: "u1", fecha: "2026-10-05", horaEntrada: hora(6), horaSalida: hora(14, 30), kmRecorridos: 46, estado: "cerrado" }];

  it("junta las paradas hechas y el fichaje del conductor que las hizo", () => {
    const [f] = filasRealizado([plan], fich);
    expect(fechaDelPlan(plan)).toBe("2026-10-05");
    expect(f).toMatchObject({ paradas: 3, hechas: 2, pct: 67, primera: 410, ultima: 440, retrasoMedio: 15 });
    expect(f.pendientes).toEqual(["P3 · Luna"]);
    expect(f.real).toMatchObject({ inicio: 360, fin: 870, minutos: 510, km: 46, abierto: false });
  });

  it("los totales comparan km y horas solo donde hay las dos cosas", () => {
    const filas = filasRealizado([plan, { ...plan, _id: "p2", ubicaciones: [{ pa: "X", realizado: false }] }], fich);
    const t = totalesRealizado(filas);
    expect(t).toMatchObject({ rutas: 2, paradas: 4, hechas: 2, pct: 50, kmPlan: 40, kmReal: 46, conKm: 1, sinFichaje: 1, incompletas: 2 });
  });

  it("los partes de correctivo no cuentan", () => {
    expect(filasRealizado([{ ...plan, tipo: "corr" }], fich)).toEqual([]);
  });
});
