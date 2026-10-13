import { describe, it, expect } from "vitest";
import { seguirConductores } from "./lineas-sched/seguir.js";
import { PARAMS_DEFECTO } from "./lineas-sched/base.js";

const P = { ...PARAMS_DEFECTO, tiposTurno: [] };
const viaje = (dep, arr, o, d) => ({ dep, arr, o, d, vacio: false, nombre: "1" });
const pieza = (vehiculo, autobus, dep, arr, o, d) => ({ vehiculo, autobus, inicio: dep, fin: arr, conduccion: arr - dep, o, d, viajes: [viaje(dep, arr, o, d)] });

describe("los autobuses siguen al conductor", () => {
  // Bus 1 y bus 2 se cruzan en la cabecera L. El conductor A hace a (bus 1) y luego b (bus 2);
  // el B, y (bus 2) y luego x (bus 1). Intercambiando las colas, cada uno sigue en su autobús.
  const crear = () => {
    const a = pieza(1, 1, 360, 480, "L", "L"), x = pieza(1, 1, 500, 620, "L", "L");
    const y = pieza(2, 2, 370, 485, "L", "L"), b = pieza(2, 2, 495, 610, "L", "L");
    const vehiculos = [{ id: 1, autobus: 1, inicio: 360, fin: 620, viajes: [...a.viajes, ...x.viajes] }, { id: 2, autobus: 2, inicio: 370, fin: 610, viajes: [...y.viajes, ...b.viajes] }];
    const turnos = [{ id: 1, piezas: [a, b] }, { id: 2, piezas: [y, x] }];
    return { a, b, x, y, vehiculos, turnos, autobuses: [{ id: 1, bloques: [1] }, { id: 2, bloques: [2] }] };
  };
  it("intercambia las colas y nadie cambia de autobús", () => {
    const c = crear();
    const r = seguirConductores(c.vehiculos, c.autobuses, c.turnos, P);
    expect(r.intercambios).toBe(1);
    expect(r.turnos.map(t => t.cambiosBus)).toEqual([0, 0]);
    expect(c.b.autobus).toBe(1);
    expect(c.x.autobus).toBe(2);
    // cada autobús sigue haciendo viajes seguidos, y todos los viajes siguen hechos una vez
    const todos = r.vehiculos.flatMap(v => v.viajes);
    expect(todos.length).toBe(4);
    expect(r.vehiculos.find(v => v.id === 1).viajes.map(v => v.dep)).toEqual([360, 495]);
    expect(r.vehiculos.find(v => v.id === 2).viajes.map(v => v.dep)).toEqual([370, 500]);
  });
  it("apagado, no toca nada", () => {
    const c = crear();
    const r = seguirConductores(c.vehiculos, c.autobuses, c.turnos, { ...P, busSigueConductor: false });
    expect(r.intercambios).toBe(0);
    expect(c.b.autobus).toBe(2);
  });
  it("si un autobús no llegaría a tiempo, no se intercambia", () => {
    const c = crear();
    // la cola del bus 1 sale a las 8:08 y el bus 2 llega a L a las 8:05: 3 min, menos de los 5 de regulación
    c.x.inicio = 488; c.x.viajes[0].dep = 488;
    const r = seguirConductores(c.vehiculos, c.autobuses, c.turnos, P);
    expect(r.intercambios).toBe(0);
  });
});
