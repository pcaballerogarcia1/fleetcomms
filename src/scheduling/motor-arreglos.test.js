// Los fallos que encontraron los escenarios al azar (2026-10-31), uno a uno.
import { afterEach, describe, expect, it } from "vitest";
import { applyTaskMove, computeCandidateSlots, fijarCarretera, quitarPausasFinales } from "../vrp-engine.js";
import { simular } from "./mejora-rutas.js";

afterEach(() => fijarCarretera(null));
const base = { depotLat: 40.40, depotLng: -3.70 };
const p = (id, lat, lng, s, e) => ({ id, nombre: id, lat, lng, duracion: e - s, _start: s, _end: e });
const viaje = (s, e, km, extra = {}) => ({ _travel: true, _start: s, _end: e, duracion: e - s, km, ...extra });
const kmViajes = items => items.reduce((s, a) => s + (a._travel ? a.km : 0), 0);

describe("al quitar la primera o la última parada", () => {
  // base → A → B → C → base
  const A = p("A", 40.41, -3.70, 380, 390), B = p("B", 40.42, -3.70, 400, 410), C = p("C", 40.43, -3.70, 420, 430);
  const fila = { _id: "v", nombre: "V", turno: "Jornada completa", ...base, _tw: { start: 360, end: 840 },
    assignments: [viaje(360, 380, 1.1, { _depot_exit: true }), A, viaje(390, 400, 1.1), B, viaje(410, 420, 1.1), C, viaje(430, 460, 3.3, { _depot_return: true })] };
  const otra = { _id: "w", nombre: "W", turno: "Jornada completa", ...base, _tw: { start: 360, end: 840 }, assignments: [] };
  const hueco = (t) => computeCandidateSlots(t, otra, 0)[0];

  it("si era la primera, sale de la base hacia la nueva primera", () => {
    const { newFromAssignments } = applyTaskMove(A, fila, otra, hueco(A), 0);
    const salida = newFromAssignments.find(a => a._depot_exit);
    expect(salida).toBeTruthy();
    expect(salida._end).toBeLessThanOrEqual(B._start);
    expect(kmViajes(newFromAssignments)).toBeGreaterThan(3.3 + 1.1); // salida + B→C + vuelta
  });

  it("si era la última, vuelve a la base desde la nueva última", () => {
    const { newFromAssignments } = applyTaskMove(C, fila, otra, hueco(C), 0);
    const vuelta = newFromAssignments.find(a => a._depot_return);
    expect(vuelta?._start).toBe(B._end);
  });
});

describe("el tope de paradas", () => {
  it("un vehículo que ya hace las paradas máximas ese día no tiene hueco", () => {
    const fila = { _id: "v", nombre: "V", turno: "Jornada completa", ...base, _tw: { start: 360, end: 840 },
      assignments: [p("A", 40.41, -3.70, 380, 390), p("B", 40.42, -3.70, 400, 410)] };
    const t = { id: "x", lat: 40.415, lng: -3.70, duracion: 5 };
    expect(computeCandidateSlots(t, fila, 0, 0, 2)).toEqual([]);
    expect(computeCandidateSlots(t, fila, 0, 0, 3).length).toBeGreaterThan(0);
  });
});

describe("pausas al final de la jornada", () => {
  it("una pausa sin ninguna parada detrás se quita y la vuelta se adelanta", () => {
    const fila = { _id: "v", turno: "Jornada completa", _tw: { start: 360, end: 840 },
      assignments: [p("A", 40.41, -3.70, 800, 810), { _break: true, _start: 810, _end: 830, duracion: 20 }, viaje(830, 845, 2, { _depot_return: true })] };
    quitarPausasFinales(fila);
    expect(fila.assignments.some(a => a._break)).toBe(false);
    expect(fila.assignments.find(a => a._travel)._end).toBe(825);
  });

  it("una pausa con paradas detrás se queda", () => {
    const fila = { _id: "v", turno: "Jornada completa", _tw: { start: 360, end: 840 },
      assignments: [p("A", 40.41, -3.70, 500, 510), { _break: true, _start: 510, _end: 530, duracion: 20 }, viaje(530, 540, 1), p("B", 40.42, -3.70, 540, 550)] };
    quitarPausasFinales(fila);
    expect(fila.assignments.some(a => a._break)).toBe(true);
  });
});

describe("relevo de conductor en la mejora", () => {
  it("ninguna parada a caballo del relevo, aunque no haya duración máxima", () => {
    const sh = { start: 360, end: 840, breaks: [600] };
    const paradas = [{ id: "a", lat: 40.41, lng: -3.70, duracion: 260 }]; // de 360+viaje a pasadas las 600
    const cons = { breakAfter: 0, breakDur: 0, maxShiftMin: 0, maxStops: 0 };
    expect(simular({ off: 0, sh, depot: { lat: 40.40, lng: -3.70 }, paradas }, cons).ok).toBe(false);
    expect(simular({ off: 0, sh: { ...sh, breaks: [] }, depot: { lat: 40.40, lng: -3.70 }, paradas }, cons).ok).toBe(true);
  });
});
