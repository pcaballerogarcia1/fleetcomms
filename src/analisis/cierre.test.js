import { describe, it, expect } from "vitest";
import { cierreDelMes, minutosNocturnos } from "./cierre.js";

const t = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime(); // octubre de 2026

describe("cierre del mes", () => {
  it("cuenta las horas nocturnas entre las 22:00 y las 06:00", () => {
    expect(minutosNocturnos(t(5, 20), t(6, 4))).toBe(360);   // 22→04
    expect(minutosNocturnos(t(5, 6), t(5, 14))).toBe(0);
    expect(minutosNocturnos(t(5, 5), t(5, 7))).toBe(60);     // 05→06
  });

  const workers = [{ _id: "w1", uid: "u1", nombre: "Ana", apellidos: "Ruiz" }, { _id: "w2", uid: "u2", nombre: "Luis" }];
  const fichajes = [
    { uid: "u1", fecha: "2026-10-05", horaEntrada: t(5, 6), horaSalida: t(5, 17), kmRecorridos: 50, estado: "cerrado" },   // 11 h: 2 extra
    { uid: "u1", fecha: "2026-10-04", horaEntrada: t(4, 6), horaSalida: t(4, 14), kmRecorridos: 30, estado: "cerrado" },   // domingo, 8 h
    { uid: "u1", fecha: "2026-10-07", horaEntrada: t(7, 6), horaSalida: null, estado: "abierto" },
  ];
  const grid = { w1: { 5: "M", 6: "M", 4: "L" }, w2: { 5: "T" } };

  it("reparte ordinarias, extra, festivo y saca lo que no cuadra con el cuadrante", () => {
    const r = cierreDelMes({ fichajes, workers, grid, rules: { maxHorasDia: 9, maxHorasMes: 0, festivos: [] }, year: 2026, month: 10,
      precios: { costeHora: 20, costeHoraExtra: 30, plusFestivoPct: 50 } });
    const ana = r.filas.find(f => f.uid === "u1");
    expect(ana).toMatchObject({ nombre: "Ana Ruiz", dias: 2, total: 19 * 60, extra: 120, ordinarias: 17 * 60, festivo: 480, km: 80, abiertos: 1, faltas: [6], enLibre: [4] });
    // 17 h × 20 + 2 h × 30 + 8 h × 20 × 50 %
    expect(ana.importe).toBe(340 + 60 + 80);
    const luis = r.filas.find(f => f.uid === "u2");
    expect(luis).toMatchObject({ total: 0, faltas: [5] });
    expect(r.totales).toMatchObject({ personas: 2, extra: 120, conAvisos: 2 });
  });

  it("el tope del mes también genera extra", () => {
    const r = cierreDelMes({ fichajes: fichajes.slice(0, 2), workers, grid: {}, rules: { maxHorasDia: 12, maxHorasMes: 10 }, year: 2026, month: 10 });
    expect(r.filas[0].extra).toBe(19 * 60 - 600);
    expect(r.filas[0].importe).toBeNull();
  });
});
