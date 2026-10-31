// Los trozos de ruta (tramos.js) dicen lo mismo que rehacer la ruta parada a
// parada (simular): si llega a tiempo, lo que conduce y a qué hora acaba.
import { afterEach, describe, expect, it } from "vitest";
import { fijarCarretera, kmRuta, tiempoRuta } from "../vrp-engine.js";
import { simular } from "./mejora-rutas.js";
import { optimizarSISR } from "./sisr.js";
import { crearTramos } from "./tramos.js";

afterEach(() => fijarCarretera(null));

function azar(semilla) {
  let s = semilla >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const cons = { breakAfter: 0, breakDur: 0, maxShiftMin: 0, maxStops: 0, carretera: { vecinosCompleta: true } };

describe("trozos de ruta", () => {
  it("juntar trozos da lo mismo que rehacer la ruta", () => {
    fijarCarretera({ factor: 1.3, kmh: 25, vecinosCompleta: true });
    const rnd = azar(7);
    const depot = { lat: 40.4, lng: -3.7 };
    const sitios = [depot, ...Array.from({ length: 12 }, () => ({ lat: 40.4 + (rnd() - 0.5) * 0.08, lng: -3.7 + (rnd() - 0.5) * 0.1 }))];
    const tt = (a, b) => { if (a < 0 || b < 0 || a === b) return 0; const km = kmRuta(sitios[a].lat, sitios[a].lng, sitios[b].lat, sitios[b].lng); return km >= 0.05 ? tiempoRuta(sitios[a].lat, sitios[a].lng, sitios[b].lat, sitios[b].lng) : 0; };
    const tk = (a, b) => (a < 0 || b < 0 || a === b ? 0 : kmRuta(sitios[a].lat, sitios[a].lng, sitios[b].lat, sitios[b].lng));
    const { unir, parada, salida, llegada, aTiempo } = crearTramos(tt, tk);
    let iguales = 0;
    for (let prueba = 0; prueba < 400; prueba++) {
      const sh = { start: 360, end: 360 + 120 + Math.floor(rnd() * 300), breaks: [] };
      const n = 1 + Math.floor(rnd() * 10);
      const orden = Array.from({ length: 12 }, (_, i) => i + 1).sort(() => rnd() - 0.5).slice(0, n);
      const paradas = orden.map(s => {
        const conFranja = rnd() < 0.6, desde = 360 + Math.floor(rnd() * 300);
        return { id: `p${s}`, ...sitios[s], duracion: 1 + Math.floor(rnd() * 20), ...(conFranja ? { windowStart: desde, windowEnd: desde + 10 + Math.floor(rnd() * 90) } : {}) };
      });
      const s = simular({ off: 0, sh, depot, circular: false, paradas }, cons);
      let x = salida(0, sh.start);
      orden.forEach((st, k) => { const t = paradas[k]; x = unir(x, parada(st, t.duracion, t.windowStart ?? null, t.windowEnd ?? null, 0, 1)); });
      const tot = unir(x, llegada(0, sh.end));
      // los trozos quedan del lado seguro (1/1000 de minuto de holgura): nunca aceptan lo que simular no acepta
      if (aTiempo(tot)) expect(s.ok).toBe(true);
      if (s.ok && aTiempo(tot)) {
        expect(tot.tr).toBeCloseTo(s.conduccion, 6);
        expect(sh.start + tot.D).toBeCloseTo(s.fin, 6);
        expect(tot.km).toBeCloseTo(s.km, 6);
      }
      if (s.ok === aTiempo(tot)) iguales++;
    }
    expect(iguales).toBeGreaterThan(395);
  });

  it("el optimizador con franjas nunca deja una ruta que llegue tarde", async () => {
    fijarCarretera({ factor: 1, kmh: 30, vecinosCompleta: true });
    const rnd = azar(3);
    const tareas = Array.from({ length: 40 }, (_, i) => {
      const desde = 360 + Math.floor(rnd() * 360);
      return { id: `t${i}`, nombre: `t${i}`, lat: 40.4 + (rnd() - 0.5) * 0.06, lng: -3.7 + (rnd() - 0.5) * 0.08, duracion: 5, windowStart: desde, windowEnd: desde + 60 };
    });
    const { generateScenario } = await import("../vrp-engine.js");
    const vehs = Array.from({ length: 6 }, (_, i) => ({ _id: `v${i}`, nombre: `V${i}`, turno: "Jornada completa", depotLat: 40.4, depotLng: -3.7 }));
    const c = { maxShiftMin: 0, maxStops: 0, breakAfter: 0, breakDur: 0, startMin: 360, endMin: 840, maxDays: 1, circular: false, optimizeWeight: 0, virtualShiftMin: 0, carretera: { vecinosCompleta: true } };
    const r0 = await generateScenario(tareas, vehs, c);
    const r = await optimizarSISR(r0, c, { tiempoMs: 1500 });
    const paradas = r.schedule.flatMap(f => f.assignments.filter(a => !a._travel && !a._break && !a._wait));
    expect(paradas.length + r.unassigned.length).toBe(40);
    for (const p of paradas) expect(p._start).toBeLessThanOrEqual(p.windowEnd + 0.5);
    expect(r.unassigned.length).toBeLessThanOrEqual(r0.unassigned.length);
  });
});
