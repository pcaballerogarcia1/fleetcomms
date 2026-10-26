import { describe, expect, it } from "vitest";
import { dosOptRapido, generateScenario, ordenarPorBloques } from "./vrp-engine.js";

let semilla = 11;
const azar = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
const puntos = (n, lat = 40.42, lng = -3.70, ancho = 0.08) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, lat: lat + (azar() - 0.5) * ancho, lng: lng + (azar() - 0.5) * ancho, duracion: 10 }));
const largo = r => r.slice(1).reduce((s, p, i) => s + Math.hypot(p.lat - r[i].lat, p.lng - r[i].lng), 0);
const radio = ps => { const c = { lat: ps.reduce((s, p) => s + p.lat, 0) / ps.length, lng: ps.reduce((s, p) => s + p.lng, 0) / ps.length }; return ps.reduce((s, p) => s + Math.hypot(p.lat - c.lat, p.lng - c.lng), 0) / ps.length; };

describe("calidad de las rutas", () => {
  it("el 2-opt rápido acorta un camino desordenado y no pierde paradas", () => {
    const ps = puntos(200);
    const r = dosOptRapido(ps, { lat: 40.42, lng: -3.70 });
    expect(r).toHaveLength(200);
    expect(new Set(r.map(p => p.id)).size).toBe(200);
    expect(largo(r)).toBeLessThan(largo(ps) * 0.3);
  });
  it("una zona de varios días se ordena en barrios: cada tramo de un día es compacto", async () => {
    const ps = puntos(1200);
    const orden = await ordenarPorBloques(ps, { lat: 40.42, lng: -3.70 }, 100);
    expect(new Set(orden.map(p => p.id)).size).toBe(1200);
    const tramos = Array.from({ length: 12 }, (_, d) => orden.slice(d * 100, d * 100 + 100));
    const medio = tramos.reduce((s, t) => s + radio(t), 0) / tramos.length;
    expect(medio).toBeLessThan(radio(ps) * 0.45); // cada día, un barrio (no la zona entera)
  });
  it("con varios días, un vehículo de pocas horas recibe una zona más pequeña", async () => {
    const ps = puntos(900, 40.42, -3.70, 0.1);
    const corto = { _id: "c", nombre: "Corto", depotLat: 40.42, depotLng: -3.70, _effectiveStart: 360, _effectiveEnd: 600 }; // 4 h
    const largoV = { _id: "l", nombre: "Largo", depotLat: 40.42, depotLng: -3.70, _effectiveStart: 360, _effectiveEnd: 1320 }; // 16 h
    const r = await generateScenario(ps, [corto, largoV], { startMin: 360, endMin: 1320, maxDays: 12, circular: false, maxShiftMin: 0, maxStops: 0, breakAfter: 0, breakDur: 0, optimizeWeight: 0 });
    const n = f => f.assignments.filter(a => !a._travel && !a._wait && !a._break).length;
    expect(r.unassigned).toHaveLength(0);
    expect(n(r.schedule[0])).toBeLessThan(n(r.schedule[1]) * 0.5);
  });
});
