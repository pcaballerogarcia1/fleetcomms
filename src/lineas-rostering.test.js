import { describe, it, expect } from "vitest";
import { diaDeFecha, diasDelMes, turnosCompactos, turnosDelMes } from "./lineas-rostering.js";

const RED = {
  calendarios: [
    { id: "cal:1", nombre: "Lunes a viernes", fechas: ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-12"] },
    { id: "cal:2", nombre: "Sábados", fechas: ["2026-10-03", "2026-10-10"] },
    { id: "cal:9", nombre: "Fiesta del Pilar", fechas: ["2026-10-12"] }, // más concreto que el de laborables
  ],
};

describe("qué calendario circula cada día", () => {
  it("el que incluye la fecha; si hay dos, el más concreto; si ninguno, sin servicio", () => {
    expect(diaDeFecha(RED, "2026-10-01")).toBe("cal:1");
    expect(diaDeFecha(RED, "2026-10-03")).toBe("cal:2");
    expect(diaDeFecha(RED, "2026-10-12")).toBe("cal:9");
    expect(diaDeFecha(RED, "2026-10-04")).toBe(null);
  });
  it("sin calendarios en la red, por el día de la semana", () => {
    expect(diaDeFecha({}, "2026-10-12")).toBe("laborable"); // lunes
    expect(diaDeFecha({}, "2026-10-10")).toBe("sabado");
    expect(diaDeFecha({}, "2026-10-11")).toBe("festivo");
  });
  it("todos los días del mes", () => {
    const m = diasDelMes(RED, 2026, 10);
    expect(m).toHaveLength(31);
    expect(m[0]).toEqual({ d: 1, fecha: "2026-10-01", dia: "cal:1" });
    expect(m[3].dia).toBe(null);
  });
});

describe("turnos a cubrir del mes", () => {
  const res = {
    vehiculos: [{ id: "V1", autobus: 7 }, { id: "V2", autobus: 9 }],
    turnos: [
      { id: 1, tipoNombre: "Mañana", piezas: [{ vehiculo: "V1", viajes: [{ vacio: true, dep: 350, arr: 360 }, { dep: 360, arr: 400 }, { dep: 410, arr: 450 }] }] },
      { id: 2, tipoNombre: null, piezas: [{ vehiculo: "V1", viajes: [{ dep: 900, arr: 960 }] }, { vehiculo: "V2", viajes: [{ dep: 1400, arr: 1480 }] }] },
    ],
  };
  it("lo pequeño de cada turno", () => {
    expect(turnosCompactos(res)).toEqual([
      { id: 1, tipo: "Mañana", inicio: 350, fin: 450, buses: [7], viajes: 2 },
      { id: 2, tipo: null, inicio: 900, fin: 1480, buses: [7, 9], viajes: 2 },
    ]);
  });
  it("cada día lleva los turnos de su calendario, con ids estables", () => {
    const tc = turnosCompactos(res);
    const m = diasDelMes(RED, 2026, 10);
    const { shifts, cals, calDia } = turnosDelMes(RED, m, { "cal:1": tc, "cal:2": [tc[0]], "cal:9": [] });
    // 4 días de laborables × 2 (el 12 es fiesta) → 3 × 2 + sábados 2 × 1
    expect(shifts).toHaveLength(3 * 2 + 2 * 1);
    expect(shifts[0]).toEqual({ id: "1|cal:1|T1", d: 1, v: "T1", vn: "T1 Mañana · Bus 7", s: 350, e: 450, st: 2 });
    expect(shifts.find(s => s.id === "1|cal:1|T2").e).toBe(1480); // de noche: pasa de medianoche
    expect(cals.map(c => [c.id, c.dias, c.turnos])).toEqual([["cal:1", 3, 2], ["cal:2", 2, 1], ["cal:9", 1, 0]]);
    expect(calDia[12]).toBe(2);
    expect(calDia[4]).toBeUndefined();
  });
});

describe("del cuadrante a los turnos publicados", () => {
  it("cada turno del día con su trabajador (y su usuario si está vinculado)", async () => {
    const { asignacionDelDia } = await import("./lineas-rostering.js");
    const asign = {
      w1: { 12: { id: "12|cal:1|T3", s: 360, e: 800 }, 13: { id: "13|cal:1|T4" } },
      w2: { 12: { id: "12|cal:1|T7" } },
      w3: { 12: { id: "12|cal:9|T1" } }, // otro calendario: no es de lo publicado
      w4: { 12: { p: "M" } }, // puesto a mano, sin turno
    };
    const trabajadores = [{ _id: "w1", nombre: "Ana", apellidos: "Ruiz", uid: "u1" }, { _id: "w2", nombre: "Luis" }];
    expect(asignacionDelDia(asign, trabajadores, 12, "cal:1")).toEqual({
      T3: { trabajadorId: "w1", nombre: "Ana Ruiz", uid: "u1" },
      T7: { trabajadorId: "w2", nombre: "Luis", uid: null },
    });
    expect(asignacionDelDia(asign, trabajadores, 12, "cal:9")).toEqual({ T1: { trabajadorId: "w3", nombre: "Trabajador", uid: null } });
  });
});
