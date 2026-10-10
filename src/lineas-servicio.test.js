import { describe, it, expect } from "vitest";
import {
  simplificar, proyectar, puntoEn, distM, servicioDesdeEscenario, diaValeParaFecha, proximaFecha,
  avanzar, retrasoActual, viajeActual, cumplimiento, avisosControl, hhmm, minutosDesde, trazadoDe, estadoPuntualidad,
} from "./lineas-servicio.js";

// Recorrido recto de ~2,2 km (oeste → este) y el de vuelta
const A = [40.0, -3.70], B = [40.0, -3.674];
const ida = [A, [40.0, -3.687], B], vuelta = [B, [40.0, -3.687], A];
const turno = {
  id: "T1", inicio: 470, fin: 560,
  trazados: { "L1|0": ida.flat(), "L1|1": vuelta.flat() },
  coords: { a: A, b: B, c: [40.01, -3.70] },
  viajes: [
    { k: 0, v: 1, l: "Vacío", o: "c", d: "a", dep: 470, arr: 480, km: 1, t: null },
    { k: 1, v: 0, l: "1", o: "a", d: "b", dep: 480, arr: 500, km: 2.2, t: "L1|0", bus: 7 },
    { k: 2, v: 0, l: "1", o: "b", d: "a", dep: 510, arr: 530, km: 2.2, t: "L1|1", bus: 7 },
    { k: 3, v: 0, l: "1", o: "a", d: "b", dep: 535, arr: 555, km: 2.2, t: "L1|0", bus: 7 },
  ],
};

describe("geometría", () => {
  it("distancias y proyección sobre el recorrido", () => {
    expect(distM(A, B)).toBeGreaterThan(2100);
    expect(distM(A, B)).toBeLessThan(2300);
    const p = proyectar(ida, [40.0005, -3.687]);
    expect(p.frac).toBeCloseTo(0.5, 2);
    expect(p.dist).toBeGreaterThan(40);
    expect(p.dist).toBeLessThan(70);
    const q = puntoEn(ida, 0.25);
    expect(proyectar(ida, q).frac).toBeCloseTo(0.25, 2);
  });
  it("simplificar quita los puntos alineados y deja las curvas", () => {
    const recta = Array.from({ length: 50 }, (_, i) => [40, -3.7 + i * 0.0005]);
    expect(simplificar(recta).length).toBe(2);
    const codo = [[40, -3.7], [40, -3.69], [40.01, -3.69]];
    expect(simplificar(codo).length).toBe(3);
  });
  it("los trazados guardados planos vuelven a pares", () => {
    expect(trazadoDe(turno, "L1|0")).toEqual(ida);
    expect(trazadoDe(turno, "nada")).toBe(null);
  });
});

describe("en la calle: salidas, llegadas y retraso", () => {
  it("detecta la salida al alejarse de la cabecera y la llegada al destino", () => {
    let real = {};
    // en la cabecera antes de la hora: nada
    let r = avanzar(turno, real, A, 478);
    expect(r.cambios).toEqual([]);
    expect(turno.viajes[r.actual].k).toBe(1);
    expect(retrasoActual(turno, r.real, r.actual, r.frac, 478)).toBe(0);
    // a las 482 sigue en la cabecera: 2 min tarde
    r = avanzar(turno, r.real, A, 482);
    expect(retrasoActual(turno, r.real, r.actual, r.frac, 482)).toBe(2);
    // sale: a un cuarto del recorrido a las 485
    r = avanzar(turno, r.real, puntoEn(ida, 0.1), 483);
    expect(r.cambios).toEqual([{ tipo: "salida", k: 1, min: 483 }]);
    r = avanzar(turno, r.real, puntoEn(ida, 0.5), 493);
    // a mitad a las 493: debía estar a mitad a las 490 → 3 min tarde
    expect(retrasoActual(turno, r.real, r.actual, r.frac, 493)).toBe(3);
    // llega
    r = avanzar(turno, r.real, B, 503);
    expect(r.cambios).toEqual([{ tipo: "llegada", k: 1, min: 503 }]);
    expect(turno.viajes[r.actual].k).toBe(2);
    real = r.real;
    expect(real.salidas[1]).toBe(483);
    expect(real.llegadas[1]).toBe(503);
    expect(viajeActual(turno, real)).toBe(2);
  });
  it("si se empieza a mirar a mitad de viaje, estima la salida", () => {
    const r = avanzar(turno, {}, puntoEn(ida, 0.5), 491);
    expect(r.cambios[0].tipo).toBe("salida");
    expect(r.cambios[0].min).toBe(481);
  });
  it("lejos del recorrido no cuenta como salida", () => {
    const r = avanzar(turno, {}, [40.02, -3.687], 485);
    expect(r.cambios).toEqual([]);
    expect(r.fuera).toBe(true);
  });
  it("un viaje que no se hizo se salta cuando el autobús ya está en el siguiente", () => {
    // nunca salió el k1; a las 515 está en la cabecera b haciendo el k2
    let r = avanzar(turno, {}, puntoEn(vuelta, 0.3), 515);
    expect(r.cambios.map(c => c.tipo)).toEqual(["saltado", "salida"]);
    expect(r.real.saltados).toEqual([1]);
    expect(turno.viajes[r.actual].k).toBe(2);
    r = avanzar(turno, r.real, A, 531);
    expect(r.cambios).toEqual([{ tipo: "llegada", k: 2, min: 531 }]);
  });
  it("adelantado da retraso negativo", () => {
    const real = { salidas: { 1: 478 } };
    expect(retrasoActual(turno, real, 1, 0.5, 486)).toBe(-4);
    expect(estadoPuntualidad(-4)).toBe("adelantado");
    expect(estadoPuntualidad(2)).toBe("ok");
    expect(estadoPuntualidad(6)).toBe("tarde");
    expect(estadoPuntualidad(15)).toBe("muy");
  });
});

describe("cumplimiento del día", () => {
  it("cuenta programadas, realizadas y puntuales (también por línea)", () => {
    const t = { ...turno, real: { salidas: { 1: 483, 2: 510 }, llegadas: { 1: 503, 2: 530 } } };
    const c = cumplimiento([t], 540);
    expect(c.totalDia).toBe(3);
    expect(c.programadas).toBe(3);
    expect(c.realizadas).toBe(2);
    expect(c.puntuales).toBe(2); // 483 sale 3 min tarde (aún puntual) y 510 en hora
    const tarde = cumplimiento([{ ...t, real: { salidas: { 1: 485 }, llegadas: {} } }], 540);
    expect(tarde).toMatchObject({ tarde: 1, puntuales: 0, enCurso: 1, sinHacer: 1 });
    expect(c.sinHacer).toBe(0); // el k3 aún no ha llegado su hora de llegada
    expect(c.kmReal).toBe(4);
    expect(c.porLinea[0].linea).toBe("1");
    const fin = cumplimiento([t], 600);
    expect(fin.sinHacer).toBe(1);
  });
});

describe("avisos de Control", () => {
  const ahoraMs = Date.UTC(2026, 9, 10, 10);
  it("turno sin empezar, retraso y sin señal", () => {
    const turnos = [
      { id: "T1", inicio: 470, fin: 560, inicioReal: null },
      { id: "T2", inicio: 470, fin: 560, inicioReal: 470 },
      { id: "T3", inicio: 470, fin: 560, inicioReal: 470 },
      { id: "T4", inicio: 470, fin: 560, inicioReal: 470 },
    ];
    const ubic = new Map([
      ["T2", { activo: true, updatedAt: ahoraMs - 10000, retraso: 12, bus: 7, linea: "1" }],
      ["T3", { activo: true, updatedAt: ahoraMs - 600000, retraso: 0 }],
      ["T4", { activo: true, updatedAt: ahoraMs - 10000, retraso: 1 }],
    ]);
    const a = avisosControl(turnos, ubic, 500, ahoraMs);
    expect(a.map(x => x.tipo)).toEqual(["sin_empezar", "retraso", "sin_senal"]);
    expect(a[1].texto).toContain("+12 min");
  });
});

describe("publicar el escenario", () => {
  const red = {
    paradas: [{ id: "a", nombre: "Plaza", lat: A[0], lng: A[1] }, { id: "b", nombre: "Hospital", lat: B[0], lng: B[1] }],
    lineas: [{ id: "L1", nombre: "1", color: "#f00", sentidos: [{ dir: 0, nombre: "Ida", paradas: ["a", "b"], trazado: ida }, { dir: 1, nombre: "Vuelta", paradas: ["b", "a"], trazado: [] }] }],
    calendarios: [{ id: "cal:X", fechas: ["2026-10-12"] }],
  };
  const res = {
    vehiculos: [{ id: "V1", autobus: 3 }],
    turnos: [{ id: 1, tipoNombre: "Mañana", piezas: [{ vehiculo: "V1", viajes: [
      { vacio: true, linea: null, nombre: "Vacío", o: "cochera:9", d: "a", dep: 470, arr: 480, km: 1 },
      { linea: "L1", nombre: "1", color: "#f00", dir: 0, sentido: "Ida", o: "a", d: "b", dep: 480, arr: 500, km: 2.2 },
      { linea: "L1", nombre: "1", color: "#f00", dir: 1, sentido: "Vuelta", o: "b", d: "a", dep: 510, arr: 530, km: 2.2 },
    ] }] }],
  };
  it("cada turno lleva sus viajes, el autobús y los trazados planos (sin listas dentro de listas)", () => {
    const s = servicioDesdeEscenario(res, red, { cocheras: [{ id: 9, nombre: "Cochera Norte", lat: 40.01, lng: -3.7 }] });
    expect(s.resumen).toMatchObject({ turnos: 1, viajes: 2, autobuses: 1 });
    const t = s.turnos[0];
    expect(t).toMatchObject({ id: "T1", tipo: "Mañana", inicio: 470, fin: 530, buses: [3], lineas: ["1"] });
    expect(t.viajes[0]).toMatchObject({ v: 1, on: "Cochera Norte", dn: "Plaza", bus: 3 });
    expect(t.viajes[1]).toMatchObject({ k: 1, l: "1", on: "Plaza", dn: "Hospital", t: "L1|0" });
    expect(typeof t.trazados["L1|0"][0]).toBe("number");
    // la vuelta sin trazado usa las paradas
    expect(trazadoDe(t, "L1|1")).toEqual([B, A]);
    expect(Object.keys(t.coords).sort()).toEqual(["a", "b", "cochera:9"]);
    expect(s.lista[0]).toMatchObject({ id: "T1", num: 1, inicio: 470, fin: 530 });
    // Firestore: nada de arrays dentro de arrays
    const anidado = x => Array.isArray(x) ? x.some(y => Array.isArray(y) || anidado(y)) : x && typeof x === "object" ? Object.values(x).some(anidado) : false;
    expect(anidado({ turnos: s.turnos.map(x => ({ ...x, coords: {} })), lista: s.lista })).toBe(false);
  });
  it("qué fechas valen para cada tipo de día o calendario", () => {
    expect(diaValeParaFecha("laborable", red, "2026-10-12")).toBe(true); // lunes
    expect(diaValeParaFecha("sabado", red, "2026-10-12")).toBe(false);
    expect(diaValeParaFecha("cal:X", red, "2026-10-12")).toBe(true);
    expect(proximaFecha("domingo", red, "2026-10-12")).toBe("2026-10-18");
    expect(proximaFecha("cal:X", red, "2026-10-13")).toBe(null);
  });
  it("horas", () => {
    expect(hhmm(1510)).toBe("01:10");
    expect(hhmm(-20)).toBe("23:40");
    expect(Math.round(minutosDesde("2026-10-10", new Date("2026-10-10T08:30:00").getTime()))).toBe(510);
  });
});
