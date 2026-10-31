// Carga máxima del vehículo (kg, palés…) y demanda de cada parada: ninguna
// jornada puede llevar más de lo que cabe, en ninguna fase del motor
// (reparto, relleno, restos, huérfanas, mejora y «quitar y recolocar»).
import { afterEach, describe, expect, it } from "vitest";
import { autoScaleFleet, cargaDelDia, computeCandidateSlots, fijarCarretera, fueraDeCapacidad, generateScenario } from "../vrp-engine.js";
import { mejorarRutas, simular } from "./mejora-rutas.js";
import { optimizarSISR } from "./sisr.js";

const esParada = a => !a._travel && !a._break && !a._wait;
const BASE = { maxShiftMin: 0, maxStops: 0, breakAfter: 0, breakDur: 0, startMin: 360, endMin: 840, maxDays: 1, circular: false, optimizeWeight: 0, virtualShiftMin: 0 };
// 40 entregas de 50 kg en un barrio, 8 min cada una
const entregas = (n = 40, kg = 50) => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, nombre: `e${i}`, lat: 40.41 + (i % 8) * 0.003, lng: -3.71 + Math.floor(i / 8) * 0.004, duracion: 8, demanda: kg }));
const furgonetas = (n, cargaMax = 500) => Array.from({ length: n }, (_, i) => ({ _id: `v${i}`, nombre: `F${i}`, turno: "Jornada completa", depotLat: 40.40, depotLng: -3.72, cargaMax }));
const cargas = r => r.schedule.map(f => f.assignments.filter(esParada).reduce((s, a) => s + (a.demanda || 0), 0));
const ids = r => [...r.schedule.flatMap(f => f.assignments.filter(esParada).map(a => a.id)), ...r.unassigned.map(t => t.id)];

afterEach(() => fijarCarretera(null));

describe("carga máxima del vehículo", () => {
  it("el reparto nunca pasa de la carga máxima y lo que no cabe se queda sin asignar", async () => {
    // 2.000 kg y 3 furgonetas de 500 kg: caben 1.500 (30 entregas), aunque tiempo hay de sobra
    const r = await generateScenario(entregas(), furgonetas(3), BASE);
    expect(Math.max(...cargas(r))).toBeLessThanOrEqual(500);
    expect(r.unassigned.length).toBe(10);
    expect(new Set(ids(r)).size).toBe(40);
  });

  it("sin carga máxima todo sigue como siempre", async () => {
    const r = await generateScenario(entregas(), furgonetas(3, null), BASE);
    expect(r.unassigned.length).toBe(0);
  });

  it("la mejora y «quitar y recolocar» tampoco se pasan", async () => {
    const r0 = await generateScenario(entregas(), furgonetas(5), BASE);
    const r1 = await mejorarRutas(r0, BASE, { tiempoMs: 800 });
    const r2 = await optimizarSISR(r1, BASE, { tiempoMs: 1200 });
    for (const r of [r0, r1, r2]) {
      expect(Math.max(...cargas(r))).toBeLessThanOrEqual(500);
      expect(new Set(ids(r)).size).toBe(40);
      expect(ids(r)).toHaveLength(40);
    }
    // 2.000 kg en furgonetas de 500: al menos 4
    expect(r2.schedule.filter(f => f.assignments.some(esParada)).length).toBeGreaterThanOrEqual(4);
  });

  it("el auto-escalado añade vehículos con la carga máxima de la flota", async () => {
    const r = await autoScaleFleet(entregas(), furgonetas(2), { ...BASE });
    expect(r.result.unassigned.length).toBe(0);
    expect(Math.max(...cargas(r.result))).toBeLessThanOrEqual(500);
    expect(r.resources.length).toBeGreaterThanOrEqual(4);
  });

  it("una entrega que no cabe en ningún vehículo no hace crecer la flota", async () => {
    const t = [...entregas(4), { id: "grande", nombre: "grande", lat: 40.41, lng: -3.71, duracion: 8, demanda: 900 }];
    expect(fueraDeCapacidad(t[4], furgonetas(2))).toBe(true);
    const r = await autoScaleFleet(t, furgonetas(1), { ...BASE });
    expect(r.result.unassigned.map(x => [x.id, x._fueraCapacidad])).toEqual([["grande", true]]);
  });

  it("los huecos para mover a mano o recolocar respetan la carga del día", async () => {
    const r = await generateScenario(entregas(10), furgonetas(1), BASE);
    const fila = r.schedule[0];
    expect(cargaDelDia(fila, 0)).toBe(500);
    expect(computeCandidateSlots({ id: "x", lat: 40.41, lng: -3.71, duracion: 5, demanda: 10 }, fila, 0)).toEqual([]);
    expect(computeCandidateSlots({ id: "y", lat: 40.41, lng: -3.71, duracion: 5 }, fila, 0).length).toBeGreaterThan(0);
  });

  it("simular rechaza una ruta que lleva de más", () => {
    const sh = { start: 360, end: 840, breaks: [] };
    const paradas = entregas(3, 200);
    expect(simular({ off: 0, sh, depot: { lat: 40.4, lng: -3.72 }, cap: 500, paradas }, BASE).ok).toBe(false);
    expect(simular({ off: 0, sh, depot: { lat: 40.4, lng: -3.72 }, cap: 600, paradas }, BASE).ok).toBe(true);
  });
});

describe("la demanda de cada parada, de su columna", async () => {
  const { demandaDeCampos } = await import("./datos.js");
  it("lee kg, palés o cajas, a la española", () => {
    expect(demandaDeCampos({ Calle: "Mayor", "Peso (kg)": "x", KG: "1.200" })).toBe(1200);
    expect(demandaDeCampos({ Palés: "2" })).toBe(2);
    expect(demandaDeCampos({ cajas: "12,5" })).toBe(12.5);
    expect(demandaDeCampos({ nombre: "sin demanda" })).toBe(0);
  });
});
