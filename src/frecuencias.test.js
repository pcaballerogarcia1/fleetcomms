import { describe, it, expect } from "vitest";
import { leerFrecuencia, frecuenciaDe, diasDeServicio, patronesSeparados, repartirDias, generarRutaMaestra, nombreDiaEscenario } from "./scheduling/frecuencias.js";
import { generateScenario } from "./vrp-engine.js";

const LS = [0, 1, 2, 3, 4, 5];

describe("frecuencias: leer lo que pone el Excel", () => {
  it("días concretos, rangos y veces por semana", () => {
    expect(leerFrecuencia("Diaria", LS)).toEqual({ dias: LS });
    expect(leerFrecuencia("L-V", LS)).toEqual({ dias: [0, 1, 2, 3, 4] });
    expect(leerFrecuencia("L,X,V", LS)).toEqual({ dias: [0, 2, 4] });
    expect(leerFrecuencia("LXV", LS)).toEqual({ dias: [0, 2, 4] });
    expect(leerFrecuencia("Lunes y jueves", LS)).toEqual({ dias: [0, 3] });
    expect(leerFrecuencia("Miércoles", LS)).toEqual({ dias: [2] });
    expect(leerFrecuencia("3", LS)).toEqual({ veces: 3 });
    expect(leerFrecuencia("2/semana", LS)).toEqual({ veces: 2 });
    expect(leerFrecuencia("2 veces", LS)).toEqual({ veces: 2 });
    expect(leerFrecuencia("Semanal", LS)).toEqual({ veces: 1 });
    expect(leerFrecuencia("", LS)).toBe(null);
    expect(leerFrecuencia("cuando se pueda", LS)).toBe(null);
  });
  it("la columna del Excel manda; si no hay, la de por defecto", () => {
    expect(frecuenciaDe({ campos: { Frecuencia: "L,J" } }, LS, "diaria")).toEqual({ dias: [0, 3] });
    expect(frecuenciaDe({ campos: { "Días recogida": "M" } }, LS, "diaria")).toEqual({ dias: [1] });
    expect(frecuenciaDe({ campos: {} }, LS, "2")).toEqual({ veces: 2 });
  });
  it("días de servicio y nombres de los días", () => {
    expect(diasDeServicio("LMXJVS")).toEqual(LS);
    expect(diasDeServicio("")).toEqual([0, 1, 2, 3, 4]);
    expect(nombreDiaEscenario({ usarFrecuencias: true, diasServicio: "LXV" }, 1)).toBe("Miércoles");
    expect(nombreDiaEscenario({}, 1)).toBe("Día 2");
  });
});

describe("frecuencias: repartir los días", () => {
  it("las de N veces van en días separados", () => {
    const p3 = patronesSeparados(3, LS);
    expect(p3).toContainEqual([0, 2, 4]);
    expect(p3.every(p => p.length === 3 && p.every((d, i) => i === 0 || d - p[i - 1] >= 2))).toBe(true);
    expect(patronesSeparados(6, LS)).toEqual([LS]);
  });
  it("equilibra los días de la zona", () => {
    const stops = Array.from({ length: 12 }, (_, i) => ({ id: i, duracion: 10, campos: { Frecuencia: "3" } }));
    const dias = repartirDias(stops, LS, "diaria");
    const porDia = LS.map(d => stops.filter(s => dias.get(s).includes(d)).length);
    expect(porDia.reduce((a, b) => a + b, 0)).toBe(36);
    expect(Math.max(...porDia) - Math.min(...porDia)).toBeLessThanOrEqual(1);
  });
});

describe("ruta maestra", () => {
  it("cada parada sale sus días y cada vehículo se queda en su zona", async () => {
    // dos barrios separados, 8 paradas cada uno; la mitad L-X-V y la otra mitad diaria
    const barrio = (lat, pre) => Array.from({ length: 8 }, (_, i) => ({ id: `${pre}${i}`, nombre: `${pre}${i}`, lat: lat + i * 0.001, lng: -3.70, duracion: 5, campos: { Frecuencia: i % 2 ? "L,X,V" : "Diaria" } }));
    const tasks = [...barrio(40.40, "a"), ...barrio(40.50, "b")];
    const veh = [{ _id: "v1", nombre: "C1", turno: "Jornada completa" }, { _id: "v2", nombre: "C2", turno: "Jornada completa" }];
    const cons = { startMin: 360, endMin: 1320, breakAfter: 0, breakDur: 0, days: 1, usarFrecuencias: true, diasServicio: "LMXJVS" };
    const r = await generarRutaMaestra(tasks, veh, cons, generateScenario);
    expect(r.daysUsed).toBe(6);
    expect(r.unassigned).toHaveLength(0);
    expect(r.resumen.visitas).toBe(8 * 6 + 8 * 3);
    const paradas = fila => fila.assignments.filter(a => !a._travel && !a._break && !a._wait);
    // zona fija: cada vehículo solo un barrio
    for (const fila of r.schedule) expect(new Set(paradas(fila).map(a => a.id[0])).size).toBe(1);
    // una L,X,V sale lunes (día 0), miércoles (2) y viernes (4)
    const a1 = r.schedule.flatMap(paradas).filter(a => a.id === "a1").map(a => Math.floor(a._start / 1440));
    expect(a1).toEqual([0, 2, 4]);
  });
});
