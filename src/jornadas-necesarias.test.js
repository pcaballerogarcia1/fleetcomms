import { describe, expect, it } from "vitest";
import { autoScaleFleet, generateScenario, jornadasNecesarias } from "./vrp-engine.js";

describe("jornada del vehículo necesario y de su personal", () => {
  it("escenarios de antes: como siempre", () => {
    expect(jornadasNecesarias({ startMin: 360, endMin: 1320 })).toEqual({ start: 360, end: 1320, breaks: [], personalMin: 960 });
    expect(jornadasNecesarias({ startMin: 360, endMin: 1320, virtualShiftMin: 480 })).toEqual({ start: 360, end: 1320, breaks: [840], personalMin: 480 });
  });
  it("los dos ajustes: vehículo sin límite = 24 h, partido en turnos del personal", () => {
    expect(jornadasNecesarias({ startMin: 360, vehiculoNecesarioMaxMin: 0, personalNecesarioMaxMin: 480 })).toEqual({ start: 360, end: 1800, breaks: [840, 1320], personalMin: 480 });
    expect(jornadasNecesarias({ startMin: 360, vehiculoNecesarioMaxMin: 960, personalNecesarioMaxMin: 480 })).toEqual({ start: 360, end: 1320, breaks: [840], personalMin: 480 });
    expect(jornadasNecesarias({ startMin: 360, vehiculoNecesarioMaxMin: 600, personalNecesarioMaxMin: 0 })).toEqual({ start: 360, end: 960, breaks: [], personalMin: 600 });
  });
});

describe("duración máxima de turno: de cada conductor", () => {
  const tareas = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, lat: 40.42 + (i % 10) * 0.001, lng: -3.70 + Math.floor(i / 10) * 0.001, duracion: 20 }));
  const cons = { startMin: 360, endMin: 1320, maxDays: 1, circular: false, maxShiftMin: 480, maxStops: 0, breakAfter: 0, breakDur: 0, optimizeWeight: 0 };
  const veh = { _id: "v1", nombre: "Camión", turno: "Jornada completa", depotLat: 40.4168, depotLng: -3.7038, _effectiveStart: 360, _effectiveEnd: 1320, _shiftBreaks: [840] };

  it("un vehículo con relevo trabaja mañana y tarde, y ningún conductor pasa de 8 h", async () => {
    const r = await generateScenario(tareas, [veh], cons);
    const paradas = r.schedule[0].assignments.filter(a => !a._travel && !a._wait && !a._break);
    const manana = r.schedule[0].assignments.filter(a => a._start < 840), tarde = r.schedule[0].assignments.filter(a => a._start >= 840);
    expect(paradas.some(a => a._start >= 840)).toBe(true);
    expect(Math.max(...manana.map(a => a._end)) - 360).toBeLessThanOrEqual(480);
    expect(Math.max(...tarde.map(a => a._end)) - 840).toBeLessThanOrEqual(480);
    expect(paradas.some(a => a._start < 840 && a._end > 840)).toBe(false); // nada a caballo del relevo
  });
  it("los vehículos añadidos de 16 h con personal de 8 h llevan dos conductores", async () => {
    const r = await autoScaleFleet(tareas.concat(tareas.map(t => ({ ...t, id: t.id + "b" }))), [{ ...veh, _shiftBreaks: [] , _effectiveEnd: 840 }], { ...cons, vehiculoNecesarioMaxMin: 960, personalNecesarioMaxMin: 480 });
    const anadidos = r.resources.filter(v => v._virtual);
    expect(anadidos.length).toBeGreaterThan(0);
    expect(anadidos[0]).toMatchObject({ _effectiveStart: 360, _effectiveEnd: 1320, _shiftBreaks: [840] });
  });
});

describe("lo que sobra de un vehículo de turno corto lo hacen los que se quedan parados", () => {
  it("con días de sobra no deja paradas sin hacer (antes el repaso final solo miraba días nuevos)", async () => {
    const zona = (lat, n, p) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, lat: lat + (i % 10) * 0.001, lng: -3.70 + Math.floor(i / 10) * 0.001, duracion: 10 }));
    const tareas = [...zona(40.42, 100, "a"), ...zona(40.46, 100, "b")];
    const corto = { _id: "c", nombre: "Corto", depotLat: 40.42, depotLng: -3.70, _effectiveStart: 360, _effectiveEnd: 420 }; // 1 h al día
    const largo = { _id: "l", nombre: "Largo", depotLat: 40.46, depotLng: -3.70, _effectiveStart: 360, _effectiveEnd: 1800 }; // 24 h
    const r = await generateScenario(tareas, [corto, largo], { startMin: 360, endMin: 1320, maxDays: 3, circular: false, maxShiftMin: 0, maxStops: 0, breakAfter: 0, breakDur: 0, optimizeWeight: 0 });
    expect(r.unassigned).toHaveLength(0);
    // los días que dice el motor llegan hasta el último con paradas (si no, la pantalla no lo enseña)
    const ultimo = Math.max(...r.schedule.flatMap(f => f.assignments.filter(a => !a._travel).map(a => Math.floor((a._start - 360) / 1440) + 1)));
    expect(r.daysUsed).toBeGreaterThanOrEqual(ultimo);
    for (const f of r.schedule) {
      const a = [...f.assignments].sort((x, y) => x._start - y._start);
      for (let i = 1; i < a.length; i++) expect(a[i]._start).toBeGreaterThanOrEqual(a[i - 1]._end - 0.5); // nada encima de nada
    }
  });
});
