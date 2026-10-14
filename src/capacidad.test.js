import { describe, it, expect } from "vitest";
import { litrosDe, cargaDe, reservarDescargas, aplicarDescargas, capacidadDe, sinReserva, CAPACIDAD_DEFECTO } from "./scheduling/capacidad.js";
import { generateScenario } from "./vrp-engine.js";

const opc = { ...CAPACIDAD_DEFECTO, usarCapacidad: true, llenadoPct: 100, compactacion: 1, tiempoDescarga: 20 };
// 10 paradas en línea hacia el este, 3200 L cada una (3,2 m³ con llenado 100 % y sin compactar)
const paradas = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, nombre: `P${i}`, lat: 40.40, lng: -3.70 + i * 0.002, duracion: 5, campos: { Litros: "3200" } }));
const planta = { nombre: "Vertedero", lat: 40.45, lng: -3.70 };

describe("capacidad: volumen de cada parada", () => {
  it("lee los litros de una columna, del tipo de contenedor o usa el de por defecto", () => {
    expect(litrosDe({ campos: { Litros: "3200" } })).toBe(3200);
    expect(litrosDe({ campos: { "Volumen (m3)": "2,4" } })).toBe(2400);
    expect(litrosDe({ campos: { contenedor: "Carga lateral 3.200 L" } })).toBe(3200);
    expect(litrosDe({ campos: { contenedor: "Iglú" } })).toBe(null);
    expect(cargaDe({ campos: {} }, { ...CAPACIDAD_DEFECTO })).toBeCloseTo(1 * 0.7 / 3);
  });
  it("las opciones salen de las restricciones o de los valores por defecto", () => {
    expect(capacidadDe({ usarCapacidad: true, llenadoPct: 50 })).toEqual({ ...CAPACIDAD_DEFECTO, usarCapacidad: true, llenadoPct: 50 });
  });
});

describe("capacidad: reservar tiempo antes de optimizar", () => {
  it("apagado no toca nada; encendido alarga cada parada según lo que llena", () => {
    const veh = [{ capacidad: 10 }];
    expect(reservarDescargas(paradas, veh, [planta], { ...opc, usarCapacidad: false })).toBe(paradas);
    const r = reservarDescargas(paradas, veh, [planta], opc);
    expect(r[0].duracion).toBeGreaterThan(5);
    expect(r[0]._durOrig).toBe(5);
    expect(sinReserva(r[0]).duracion).toBe(5);
    expect(sinReserva(r[0])._durOrig).toBeUndefined();
  });
});

describe("capacidad: viajes a descargar", () => {
  const ruta = async () => {
    const veh = [{ _id: "v1", nombre: "C1", capacidad: 10, depotLat: 40.40, depotLng: -3.71, turno: "Jornada completa" }];
    const tasks = reservarDescargas(paradas, veh, [planta], opc);
    const vr = await generateScenario(tasks, veh, { startMin: 360, endMin: 1320, breakAfter: 0, breakDur: 0, days: 1 });
    return [{ ...veh[0], ...vr.schedule[0] }];
  };
  it("con 10 m³ y 3,2 m³ por parada descarga cada 3 paradas y al final", async () => {
    const { schedule, resumen } = aplicarDescargas(await ruta(), [planta], opc);
    const a = schedule[0].assignments;
    const stops = a.filter(x => !x._travel && !x._wait && !x._break);
    expect(stops).toHaveLength(10);
    expect(stops.every(s => s.duracion === 5)).toBe(true); // sin la reserva
    expect(resumen.descargas).toBe(4); // 3+3+3 y la última
    expect(a.filter(x => x._descarga).every(d => d.planta === "Vertedero" && d.carga <= 10)).toBe(true);
    // nunca lleva más de lo que cabe
    expect(Math.max(...stops.map(s => s._carga))).toBeLessThanOrEqual(10);
    // la última descarga va antes de volver al depósito
    const iUlt = a.map(x => !!x._descarga).lastIndexOf(true);
    const iVuelta = a.findIndex(x => x._depot_return);
    if (iVuelta >= 0) expect(iVuelta).toBeGreaterThan(iUlt);
    // las horas encadenan sin solaparse
    for (let i = 1; i < a.length; i++) expect(a[i]._start).toBeGreaterThanOrEqual(a[i - 1]._end - 1e-9);
    // los viajes a la planta suman km
    expect(resumen.kmDescarga).toBeGreaterThan(0);
  });
  it("sin plantas descarga en el depósito; apagado deja la ruta como estaba", async () => {
    const { resumen } = aplicarDescargas(await ruta(), [], opc);
    expect(resumen.descargas).toBe(4);
    const r = await ruta();
    const { schedule } = aplicarDescargas(r, [planta], { ...opc, usarCapacidad: false });
    expect(schedule[0].assignments.filter(x => x._descarga)).toHaveLength(0);
    expect(schedule[0].assignments.filter(x => !x._travel && !x._wait && !x._break).every(s => s.duracion === 5)).toBe(true);
  });
});
