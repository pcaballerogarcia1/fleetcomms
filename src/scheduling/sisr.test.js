import { afterEach, describe, expect, it } from "vitest";
import { fijarCarretera, generateScenario } from "../vrp-engine.js";
import { simular } from "./mejora-rutas.js";
import { optimizarSISR } from "./sisr.js";

const esParada = a => !a._travel && !a._break && !a._wait;
const BASE = { maxShiftMin: 0, maxStops: 0, breakAfter: 0, breakDur: 0, startMin: 360, endMin: 780, maxDays: 1, circular: false, optimizeWeight: 0, virtualShiftMin: 0 };
// un barrio en cuadrícula, con varios contenedores por dirección
const barrio = (n = 240, porSitio = 3) => Array.from({ length: n }, (_, i) => {
  const s = Math.floor(i / porSitio);
  return { id: `t${i}`, nombre: `t${i}`, lat: 39.56 + (s % 9) * 0.0018, lng: 2.64 + Math.floor(s / 9) * 0.0021, duracion: 3 };
});
const vehiculos = n => Array.from({ length: n }, (_, i) => ({ _id: `v${i}`, nombre: `V${i}`, turno: "Jornada completa", depotLat: 39.555, depotLng: 2.635 }));
const paradas = r => r.schedule.flatMap(f => f.assignments.filter(esParada));
const conduccion = r => r.schedule.reduce((s, f) => s + f.assignments.filter(a => a._travel).reduce((m, a) => m + a.duracion, 0), 0);
const turnos = r => r.schedule.filter(f => f.assignments.some(esParada)).length;

afterEach(() => fijarCarretera(null));

describe("optimizador «quitar tramos y recolocar»", () => {
  it("no pierde ni repite ninguna parada y nunca empeora", async () => {
    const tareas = barrio();
    const r0 = await generateScenario(tareas, vehiculos(4), BASE);
    const r = await optimizarSISR(r0, BASE, { tiempoMs: 1500 });
    const ids = paradas(r).map(a => a.id).concat(r.unassigned.map(t => t.id));
    expect(new Set(ids).size).toBe(tareas.length);
    expect(ids).toHaveLength(tareas.length);
    expect(r.unassigned.length).toBeLessThanOrEqual(r0.unassigned.length);
    expect(turnos(r) * 100000 + conduccion(r)).toBeLessThanOrEqual(turnos(r0) * 100000 + conduccion(r0));
  });

  it("los contenedores de una misma dirección van seguidos", async () => {
    const r = await optimizarSISR(await generateScenario(barrio(), vehiculos(4), BASE), BASE, { tiempoMs: 1000 });
    for (const f of r.schedule) {
      const ps = f.assignments.filter(esParada);
      const vistos = new Set();
      for (let k = 0; k < ps.length; k++) {
        const s = `${ps[k].lat},${ps[k].lng}`;
        if (k && `${ps[k - 1].lat},${ps[k - 1].lng}` === s) continue;
        expect(vistos.has(s)).toBe(false); // si vuelve a un sitio, es que lo partió
        vistos.add(s);
      }
    }
  });

  it("cada ruta cabe como la aceptaría el motor (turno, pausas, tope de paradas, franjas)", async () => {
    const tareas = barrio(180, 2);
    tareas[10] = { ...tareas[10], windowStart: 600, windowEnd: 660 };
    tareas[50] = { ...tareas[50], windowStart: 420, windowEnd: 480 };
    const cons = { ...BASE, breakAfter: 180, breakDur: 20, maxStops: 70 };
    const r = await optimizarSISR(await generateScenario(tareas, vehiculos(4), cons), cons, { tiempoMs: 1500 });
    for (const f of r.schedule) {
      const ps = f.assignments.filter(esParada).map(a => { const t = { ...a }; delete t._start; delete t._end; return t; });
      if (!ps.length) continue;
      expect(ps.length).toBeLessThanOrEqual(70);
      const s = simular({ off: 0, sh: { start: 360, end: 780 }, depot: { lat: 39.555, lng: 2.635 }, circular: false, paradas: ps }, cons);
      expect(s.ok).toBe(true);
      for (const a of f.assignments.filter(x => x.windowStart != null)) expect(a._start).toBeGreaterThanOrEqual(a.windowStart);
    }
  });

  it("recoge lo que el motor dejó sin recoger si cabe", async () => {
    const tareas = barrio(120, 2);
    const r0 = await generateScenario(tareas, vehiculos(3), BASE);
    const quitadas = paradas(r0).slice(0, 5).map(a => a.id);
    const sinEsas = { ...r0, schedule: r0.schedule.map(f => ({ ...f, assignments: f.assignments.filter(a => !quitadas.includes(a.id)) })), unassigned: tareas.filter(t => quitadas.includes(t.id)) };
    const r = await optimizarSISR(sinEsas, BASE, { tiempoMs: 800 });
    expect(r.unassigned).toHaveLength(0);
  });
});
