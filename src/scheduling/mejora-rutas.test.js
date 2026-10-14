import { describe, expect, it } from "vitest";
import { generateScenario } from "../vrp-engine.js";
import { RESTRICCIONES_DEFECTO } from "./restricciones-defecto.js";
import { conMejora, mejorarRutas, simular } from "./mejora-rutas.js";

function azar(semilla) { let s = semilla >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
// barrios de tamaños muy distintos: el motor deja un vehículo con mucho más trabajo
function ciudad(n, semilla = 3) {
  const r = azar(semilla);
  const barrios = [[40.43, -3.70, 0.6], [40.41, -3.69, 0.25], [40.42, -3.72, 0.15]];
  return Array.from({ length: n }, (_, i) => {
    const x = r(); let b = 0, acc = barrios[0][2];
    while (x > acc && b < barrios.length - 1) acc += barrios[++b][2];
    return { _id: `p${i}`, nombre: `P${i}`, lat: barrios[b][0] + (r() - 0.5) * 0.01, lng: barrios[b][1] + (r() - 0.5) * 0.012, duracion: 3 + Math.floor(r() * 3) };
  });
}
const flota = k => Array.from({ length: k }, (_, i) => ({ _id: `v${i}`, nombre: `Camión ${i + 1}`, turno: "Mañana (06-14)", depotLat: 40.40, depotLng: -3.71 }));
const paradas = r => r.schedule.flatMap(f => f.assignments.filter(a => !a._travel && !a._break && !a._wait));
const dias = r => new Set(paradas(r).map(a => Math.floor(a._start / 1440))).size;

function comprobar(r, tareas, cons) {
  const ps = paradas(r);
  expect(new Set(ps.map(a => a._id)).size).toBe(ps.length);
  expect(ps.length + r.unassigned.length).toBe(tareas.length);
  for (const f of r.schedule) {
    const as = [...f.assignments].sort((a, b) => a._start - b._start);
    for (let i = 1; i < as.length; i++) expect(as[i]._start).toBeGreaterThanOrEqual(as[i - 1]._end);
    const porDia = new Map();
    for (const a of as) { const d = Math.floor(a._start / 1440); porDia.set(d, [...(porDia.get(d) || []), a]); }
    for (const [d, items] of porDia) {
      expect(Math.min(...items.map(a => a._start))).toBeGreaterThanOrEqual(d * 1440 + 360);
      expect(Math.max(...items.map(a => a._end))).toBeLessThanOrEqual(d * 1440 + 840);
      if (cons.maxShiftMin) expect(Math.max(...items.map(a => a._end)) - Math.min(...items.map(a => a._start))).toBeLessThanOrEqual(cons.maxShiftMin);
      for (const a of items) {
        if (a.windowStart == null || a._travel || a._wait || a._break) continue;
        expect(a._start).toBeGreaterThanOrEqual(d * 1440 + a.windowStart);
        expect(a._start).toBeLessThanOrEqual(d * 1440 + a.windowEnd);
      }
    }
  }
}

describe("mejora de rutas de puntos", () => {
  it("acaba en menos días y con menos km, sin perder ni repetir paradas", async () => {
    const tareas = ciudad(400), cons = { ...RESTRICCIONES_DEFECTO };
    const base = await generateScenario(tareas, flota(3), cons);
    const r = await mejorarRutas(base, cons, { tiempoMs: 3000 });
    comprobar(r, tareas, cons);
    expect(dias(r)).toBeLessThan(dias(base));
    expect(r.mejora.despues.km).toBeLessThanOrEqual(r.mejora.antes.km);
    expect(r.mejora.despues.turnos).toBeLessThanOrEqual(r.mejora.antes.turnos);
  });

  it("respeta las franjas horarias y la duración máxima del turno", async () => {
    const tareas = ciudad(300, 9).map((t, i) => (i % 5 === 0 ? { ...t, windowStart: 480 + (i % 3) * 60, windowEnd: 540 + (i % 3) * 60 } : t));
    const cons = { ...RESTRICCIONES_DEFECTO, maxShiftMin: 420 };
    const base = await generateScenario(tareas, flota(3), cons);
    const r = await mejorarRutas(base, cons, { tiempoMs: 3000 });
    comprobar(r, tareas, cons);
  });

  it("no toca los días con relevo y vuelta obligatoria (circular + turno partido)", async () => {
    const tareas = ciudad(200, 5), cons = { ...RESTRICCIONES_DEFECTO, circular: true };
    const vehs = flota(2).map(v => ({ ...v, turno: "Jornada completa", _effectiveStart: 360, _effectiveEnd: 1320, _shiftBreaks: [840] }));
    const base = await generateScenario(tareas, vehs, cons);
    const r = await mejorarRutas(base, cons, { tiempoMs: 2000 });
    expect(r.schedule.map(f => f.assignments)).toEqual(base.schedule.map(f => f.assignments));
  });

  it("una ruta que no cabe en el turno se rechaza", () => {
    const sh = { start: 360, end: 420, breaks: [] };
    const lejos = { lat: 41.0, lng: -3.7, duracion: 5 };
    expect(simular({ off: 0, sh, depot: { lat: 40.4, lng: -3.7 }, circular: false, paradas: [lejos] }, {}).ok).toBe(false);
    expect(simular({ off: 0, sh, depot: { lat: 40.4, lng: -3.7 }, circular: false, paradas: [{ lat: 40.401, lng: -3.7, duracion: 5 }] }, {}).ok).toBe(true);
  });

  it("con flota añadida, quita los vehículos añadidos que se quedan vacíos", async () => {
    const vacio = { _id: "x", _virtual: true, assignments: [] };
    const salida = { result: { schedule: [{ _id: "v0", assignments: [] }, vacio], unassigned: [], daysUsed: 1 }, resources: [{ _id: "v0" }, { _id: "x", _virtual: true }], addedCount: 1 };
    const r = await conMejora("autoscale", salida, { ...RESTRICCIONES_DEFECTO });
    expect(r.resources.map(v => v._id)).toEqual(["v0"]);
    expect(r.result.schedule).toHaveLength(1);
    expect(r.addedCount).toBe(0);
  });
});
