import { describe, it, expect } from "vitest";
import { generarServicio, salidasDe, duracionViaje, perfilVehiculos, optimizarServicio, costeDia, resumenServicio } from "./lineas-sched.js";

// Línea A (ida A1→A9, vuelta A9b→A1b: cabeceras con paradas distintas) y línea B que sale de A1
const h = (hh, mm = 0) => hh * 60 + mm;
const sentido = (dir, paradas, salidas, min, extra = {}) => ({
  dir, nombre: dir ? "Vuelta" : "Ida", paradas, km: 10, viajes: { laborable: salidas.length },
  salidas: { laborable: salidas, sabado: [], festivo: [] },
  tiempos: [{ franja: "06-09", min, viajes: 1 }, { franja: "09-13", min, viajes: 1 }, { franja: "13-16", min, viajes: 1 }, { franja: "16-20", min, viajes: 1 }],
  ...extra,
});
const RED = {
  lineas: [
    { id: "A", nombre: "A", color: "#f00", sentidos: [
      sentido(0, ["A1", "A5", "A9"], [h(7), h(8), h(9)], 40),
      sentido(1, ["A9b", "A5b", "A1b"], [h(7, 45), h(8, 45), h(9, 45)], 40),
    ] },
    { id: "B", nombre: "B", color: "#00f", sentidos: [sentido(0, ["A1", "B5"], [h(10, 30)], 20)] }, // sale de la cabecera donde acaban los de la A
  ],
};

describe("scheduling de líneas: vehículos", () => {
  it("encadena ida y vuelta en la misma línea respetando la regulación", () => {
    const r = generarServicio(RED, {}, { dia: "laborable", lineas: ["A"] });
    // 7:00→7:40 ida · 7:45 vuelta (5 min regulación) → 8:25 · 8:45 → … con 1 autobús
    expect(r.kpis.viajes).toBe(6);
    expect(r.vehiculos).toHaveLength(2); // ida de 8:00 sale mientras el 1º hace la vuelta
    expect(r.vehiculos[0].viajes.map(v => v.sentido)).toEqual(["Ida", "Vuelta", "Ida", "Vuelta"]);
  });

  it("con más regulación hacen falta más autobuses", () => {
    const r = generarServicio(RED, { A: { regulacion: 10 } }, { dia: "laborable", lineas: ["A"] });
    expect(r.vehiculos.length).toBeGreaterThan(2);
  });

  it("puede seguir con otra línea en la misma cabecera, salvo que no se permita o no admita su tipo", () => {
    const con = generarServicio(RED, {}, { dia: "laborable" });
    const conB = con.vehiculos.find(v => v.viajes.some(x => x.linea === "B"));
    expect(conB.viajes.some(x => x.linea === "A")).toBe(true);
    const sin = generarServicio(RED, {}, { dia: "laborable", entreLineas: false });
    expect(sin.vehiculos.find(v => v.viajes.some(x => x.linea === "B")).viajes.every(x => x.linea === "B")).toBe(true);
    const tipos = generarServicio(RED, { A: { tipos: ["articulado"] }, B: { tipos: ["midi"] } }, { dia: "laborable" });
    const bloqueB = tipos.vehiculos.find(v => v.viajes.some(x => x.linea === "B"));
    expect(bloqueB.tipo).toBe("midi");
    expect(bloqueB.viajes.every(x => x.linea === "B")).toBe(true);
  });

  it("un autobús físico puede hacer dos bloques si hay margen para el vacío", () => {
    const red = { lineas: [
      { id: "M", nombre: "M", color: "#0f0", sentidos: [sentido(0, ["X", "Y"], [h(7)], 30)] },
      { id: "T", nombre: "T", color: "#0f0", sentidos: [sentido(0, ["P", "Q"], [h(8, 30)], 30)] },
    ] };
    const r = generarServicio(red, {}, { dia: "laborable" });
    expect(r.kpis.bloques).toBe(2);
    expect(r.kpis.autobuses).toBe(1);
    expect(generarServicio(red, {}, { dia: "laborable", margenVacio: 90 }).kpis.autobuses).toBe(2);
  });

  it("tiempo corregido a mano y salidas aproximadas en redes sin horas", () => {
    const s = RED.lineas[0].sentidos[0];
    expect(duracionViaje(s, h(7), null)).toBe(40);
    expect(duracionViaje(s, h(7), { tiempos: { "0|06-09": 55 } })).toBe(55);
    expect(duracionViaje(s, h(2), null)).toBe(40); // franja sin datos: mediana del resto
    const viejo = { viajes: { laborable: 3 }, primera: "06:00", ultima: "00:00 (+1)" };
    expect(salidasDe(viejo, "laborable")).toEqual({ lista: [h(6), h(15), h(24)], aproximado: true });
  });
});

describe("scheduling de líneas: turnos de conductor", () => {
  // Línea circular cada 30 min de 5:00 a 23:00, 25 min de recorrido
  const salidas = Array.from({ length: 37 }, (_, k) => h(5) + k * 30);
  const red = { lineas: [{ id: "C", nombre: "C", color: "#ff0", sentidos: [{ ...sentido(0, ["Z", "W", "Z"], salidas, 25), tiempos: ["00-06", "06-09", "09-13", "13-16", "16-20", "20-24"].map(f => ({ franja: f, min: 25, viajes: 1 })) }] }] };

  it("turnos de varias piezas de distintos autobuses que cumplen todas las restricciones", () => {
    const r = generarServicio(red, {}, { dia: "laborable" });
    expect(r.turnos.length).toBeGreaterThan(1);
    expect(Math.max(...r.turnos.map(t => t.piezas.length))).toBeGreaterThanOrEqual(2);
    for (const t of r.turnos) {
      expect(t.piezas.length).toBeLessThanOrEqual(8);
      expect(t.trabajo).toBeLessThanOrEqual(480);
      expect(t.duracion).toBeLessThanOrEqual(540);
      expect(t.partidos).toBeLessThanOrEqual(1);
      t.piezas.slice(1).forEach((pz, i) => expect(pz.inicio).toBeGreaterThanOrEqual(t.piezas[i].fin)); // sin solaparse
      expect(t.avisos).toEqual([]);
    }
    // todos los viajes los hace algún turno, una sola vez
    expect(r.turnos.flatMap(t => t.piezas.flatMap(pz => pz.viajes)).length).toBe(r.kpis.viajes);
  });

  it("con piezas más cortas y más piezas por turno hacen falta menos o los mismos conductores; con 1 pieza, uno por pieza", () => {
    const largo = generarServicio(red, {}, { dia: "laborable", corte: "max", maxPiezas: 2 });
    const corto = generarServicio(red, {}, { dia: "laborable", corte: 120, maxPiezas: 8 });
    expect(corto.kpis.turnos).toBeLessThanOrEqual(largo.kpis.turnos);
    const una = generarServicio(red, {}, { dia: "laborable", maxPiezas: 1 });
    expect(una.turnos.every(t => t.piezas.length === 1)).toBe(true);
  });

  it("sin jornadas partidas no hay huecos largos", () => {
    const r = generarServicio(red, {}, { dia: "laborable", maxPartidos: 0 });
    for (const t of r.turnos) t.piezas.slice(1).forEach((pz, i) => expect(pz.inicio - t.piezas[i].fin).toBeLessThan(60));
  });

  it("perfil de vehículos a la vez", () => {
    const p = perfilVehiculos([{ inicio: 0, fin: 30 }, { inicio: 15, fin: 45 }]);
    expect(p.map(x => x.vehiculos)).toEqual([1, 2, 1]);
  });
});

describe("scheduling de líneas: optimizar", () => {
  const salidas = Array.from({ length: 37 }, (_, k) => h(5) + k * 30);
  const red = { lineas: [
    { id: "C", nombre: "C", color: "#ff0", sentidos: [{ ...sentido(0, ["Z", "W", "Z"], salidas, 25), tiempos: ["00-06", "06-09", "09-13", "13-16", "16-20", "20-24"].map(f => ({ franja: f, min: 25, viajes: 1 })) }] },
    RED.lineas[0], RED.lineas[1],
  ] };

  it("prueba estrategias, las ordena por el objetivo y la mejor no empeora la de por defecto", () => {
    const normal = generarServicio(red, {}, { dia: "laborable" });
    let avance = 0;
    const { probadas } = optimizarServicio(red, {}, { dia: "laborable" }, { objetivo: "conductores", onProgreso: k => { avance = k; } });
    expect(probadas.length).toBeGreaterThan(8);
    expect(avance).toBe(probadas.length);
    expect(probadas[0].turnos).toBeLessThanOrEqual(normal.kpis.turnos);
    for (let i = 1; i < probadas.length; i++) expect(probadas[i].avisos * 1e6 + probadas[i].turnos).toBeGreaterThanOrEqual(probadas[0].avisos * 1e6 + probadas[0].turnos);
    // aplicar la estrategia ganadora da lo mismo que dijo el optimizador
    const aplicada = generarServicio(red, {}, { dia: "laborable", ...probadas[0].estrategia });
    expect(aplicada.kpis.turnos).toBe(probadas[0].turnos);
    expect(aplicada.kpis.autobuses).toBe(probadas[0].autobuses);
  });

  it("todas las estrategias respetan las restricciones de los turnos", () => {
    const { probadas } = optimizarServicio(red, {}, { dia: "laborable", piezaMax: 200 });
    for (const pr of probadas) {
      const r = generarServicio(red, {}, { dia: "laborable", piezaMax: 200, ...pr.estrategia });
      for (const t of r.turnos) {
        for (const pz of t.piezas) expect(pz.fin - pz.inicio).toBeLessThanOrEqual(200);
        expect(t.trabajo).toBeLessThanOrEqual(480);
        expect(t.duracion).toBeLessThanOrEqual(540);
        expect(t.avisos).toEqual([]);
      }
      expect(r.turnos.flatMap(t => t.piezas.flatMap(pz => pz.viajes)).length).toBe(r.kpis.viajes);
    }
  });

  it("marca las que pasan de la flota disponible y el coste usa los precios", () => {
    const { probadas } = optimizarServicio(red, {}, { dia: "laborable", flotaMax: 1 });
    expect(probadas.every(p => !p.cumple)).toBe(true);
    expect(costeDia({ horasPagadas: 10, km: 100, autobuses: 2 }, { costeHora: 20, costeKm: 1, costeVehiculoDia: 50 })).toBe(400);
    expect(costeDia({ horasPagadas: 10, km: 100, autobuses: 2 }, {})).toBe(null);
  });
});

describe("scheduling de líneas: resumen por calendario", () => {
  it("resume los indicadores en pocos campos", () => {
    const r = generarServicio(RED, {}, { dia: "laborable" });
    const x = resumenServicio(r);
    expect(x).toMatchObject({ viajes: r.kpis.viajes, autobuses: r.kpis.autobuses, turnos: r.kpis.turnos, avisos: 0 });
    expect(Object.keys(x).length).toBeLessThan(15);
    expect(costeDia(x, { costeVehiculoDia: 100 })).toBe(100 * r.kpis.autobuses);
  });
});
