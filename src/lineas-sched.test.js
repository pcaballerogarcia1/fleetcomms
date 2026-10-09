import { describe, it, expect } from "vitest";
import { TIPOS_TURNO_DEFECTO, tipoDeTurno, encajaTipo, generarServicio, salidasDe, duracionViaje, perfilVehiculos, optimizarServicio, optimizarVehiculos, optimizarTurnos, generarVehiculos, generarTurnos, costeDia, resumenServicio, moverViaje, moverPieza, claveViaje, clavePieza, aplicarCambios } from "./lineas-sched.js";

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
    const r = generarServicio(red, {}, { dia: "laborable", tiposTurno: [] }); // sin tipos: límites generales
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
    const r = generarServicio(red, {}, { dia: "laborable", maxPartidos: 0, tiposTurno: [] });
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

  it("paso 2: con los vehículos fijos prueba turnos, los ordena y la mejor no empeora la de por defecto", () => {
    const normal = generarServicio(red, {}, { dia: "laborable" });
    let avance = 0;
    const { probadas } = optimizarTurnos(red, {}, { dia: "laborable" }, { objetivo: "conductores", onProgreso: k => { avance = k; } });
    expect(probadas.length).toBeGreaterThanOrEqual(8);
    expect(avance).toBe(probadas.length);
    expect(probadas[0].turnos).toBeLessThanOrEqual(normal.kpis.turnos);
    for (let i = 1; i < probadas.length; i++) expect(probadas[i].avisos * 1e6 + probadas[i].turnos).toBeGreaterThanOrEqual(probadas[0].avisos * 1e6 + probadas[0].turnos);
    // los turnos no tocan los vehículos y aplicar la ganadora da lo mismo
    const veh = generarVehiculos(red, {}, { dia: "laborable" });
    expect(veh.turnos).toBe(null);
    expect(veh.kpis.turnos).toBe(null);
    const aplicada = generarTurnos(veh, probadas[0].estrategia);
    expect(aplicada.kpis.turnos).toBe(probadas[0].turnos);
    expect(aplicada.kpis.autobuses).toBe(veh.kpis.autobuses);
  });

  it("todas las estrategias de turnos respetan las restricciones", () => {
    const { probadas } = optimizarTurnos(red, {}, { dia: "laborable", piezaMax: 200, tiposTurno: [] });
    for (const pr of probadas) {
      const r = generarServicio(red, {}, { dia: "laborable", piezaMax: 200, tiposTurno: [], ...pr.estrategia });
      for (const t of r.turnos) {
        for (const pz of t.piezas) expect(pz.fin - pz.inicio).toBeLessThanOrEqual(200);
        expect(t.trabajo).toBeLessThanOrEqual(480);
        expect(t.duracion).toBeLessThanOrEqual(540);
        expect(t.avisos).toEqual([]);
      }
      expect(r.turnos.flatMap(t => t.piezas.flatMap(pz => pz.viajes)).length).toBe(r.kpis.viajes);
    }
  });

  it("paso 1: marca las que pasan de la flota disponible; los dos pasos seguidos", () => {
    const { probadas } = optimizarVehiculos(red, {}, { dia: "laborable", flotaMax: 1 });
    expect(probadas.length).toBeGreaterThan(1);
    expect(probadas.every(p => !p.cumple)).toBe(true);
    const ambos = optimizarServicio(red, {}, { dia: "laborable" });
    expect(Object.keys(ambos.estrategia)).toEqual(expect.arrayContaining(["eleccion", "corte", "emparejar"]));
    expect(costeDia({ horasPagadas: 10, km: 100, autobuses: 2 }, { costeHora: 20, costeKm: 1, costeVehiculoDia: 50 })).toBe(400);
    expect(costeDia({ horasPagadas: 10, km: 100, autobuses: 2 }, {})).toBe(null);
  });
});

describe("scheduling de líneas: resumen por calendario", () => {
  it("resume los indicadores en pocos campos", () => {
    const r = generarServicio(RED, {}, { dia: "laborable", tiposTurno: [] });
    const x = resumenServicio(r);
    expect(x).toMatchObject({ viajes: r.kpis.viajes, autobuses: r.kpis.autobuses, turnos: r.kpis.turnos, avisos: 0 });
    expect(Object.keys(x).length).toBeLessThan(15);
    expect(costeDia(x, { costeVehiculoDia: 100 })).toBe(100 * r.kpis.autobuses);
  });
});

describe("scheduling de líneas: cocheras y vacíos", () => {
  // A: X → Y (8:00–8:30). B sale de Z, a ~1 km de Y, a las 8:50. Cochera junto a X.
  const paradas = [
    { id: "X", nombre: "X", lat: 40.40, lng: -3.70 }, { id: "Y", nombre: "Y", lat: 40.43, lng: -3.70 },
    { id: "Z", nombre: "Z", lat: 40.439, lng: -3.70 }, { id: "W", nombre: "W", lat: 40.47, lng: -3.70 },
  ];
  const red = { paradas, lineas: [
    { id: "A", nombre: "A", color: "#f00", sentidos: [sentido(0, ["X", "Y"], [h(8)], 30)] },
    { id: "B", nombre: "B", color: "#00f", sentidos: [sentido(0, ["Z", "W"], [h(8, 50)], 30)] },
  ] };
  const cocheras = [{ id: "c1", nombre: "Norte", lat: 40.395, lng: -3.70 }];

  it("vacío entre cabeceras cercanas: un autobús en vez de dos; con 0 km, dos", () => {
    const con = generarServicio(red, {}, { dia: "laborable", vacioMaxKm: 5 });
    expect(con.kpis.bloques).toBe(1);
    const v = con.vehiculos[0].viajes.find(x => x.vacio);
    expect(v).toMatchObject({ o: "Y", d: "Z" });
    expect(v.km).toBeGreaterThan(1);
    expect(con.kpis.kmVacio).toBeCloseTo(v.km, 5);
    expect(con.kpis.km).toBeCloseTo(20 + v.km, 5);
    expect(generarServicio(red, {}, { dia: "laborable", vacioMaxKm: 0 }).kpis.bloques).toBe(2);
    expect(generarServicio(red, {}, { dia: "laborable", vacioMaxKm: 5, vacios: false }).kpis.bloques).toBe(2);
    expect(generarServicio(red, {}, { dia: "laborable", vacioMaxKm: 5, vacioKm: 0.5 }).kpis.bloques).toBe(2); // radio de la estrategia
    expect(v).toMatchObject({ tipo: "cabecera", hacia: "B", sentido: "Vacío a cabecera de la B" });
  });

  it("con cochera: salida y vuelta a cochera con sus km y su tiempo, y las conduce un turno", () => {
    const r = generarServicio(red, {}, { dia: "laborable", vacioMaxKm: 5 }, { cocheras });
    const bus = r.vehiculos[0];
    expect(bus.cochera).toBe("cochera:c1");
    expect(bus.viajes[0]).toMatchObject({ vacio: true, tipo: "salida", hacia: "A", o: "cochera:c1", d: "X", arr: h(8) });
    expect(bus.viajes.at(-1)).toMatchObject({ vacio: true, o: "W", d: "cochera:c1" });
    expect(bus.inicio).toBeLessThan(h(8));
    expect(r.conCocheras).toBe(true);
    expect(r.kpis.viajes).toBe(2); // los vacíos no son viajes con viajeros
    const conducidos = r.turnos.flatMap(t => t.piezas.flatMap(pz => pz.viajes));
    expect(conducidos.length).toBe(bus.viajes.length); // viajes y vacíos, todos con conductor
  });

  it("aplicar la mejor estrategia de vehículos da lo mismo que dijo el optimizador", () => {
    const { probadas } = optimizarVehiculos(red, {}, { dia: "laborable" }, { cocheras, objetivo: "kmVacio" });
    for (const pr of probadas.slice(0, 3)) {
      const g = generarVehiculos(red, {}, { dia: "laborable", ...pr.estrategia }, { cocheras });
      expect(g.kpis.autobuses).toBe(pr.autobuses);
      expect(g.kpis.kmVacio).toBeCloseTo(pr.kmVacio, 5);
    }
  });

  it("la cochera fijada en la línea manda sobre la más cercana", () => {
    const dos = [...cocheras, { id: "c2", nombre: "Sur", lat: 40.50, lng: -3.70 }];
    const r = generarServicio(red, { A: { cochera: "c2" } }, { dia: "laborable", vacioMaxKm: 5 }, { cocheras: dos });
    expect(r.vehiculos[0].cochera).toBe("cochera:c2");
  });
});

describe("scheduling de líneas: piezas con sentido operativo", () => {
  // Cochera a ~15 km de la cabecera X (salida de ~35 min en vacío) y una línea
  // larga X → Y de 90 min, ida y vuelta todo el día: como la captura del
  // cliente, donde salían «turnos» de solo un vacío, sin ningún viaje.
  const paradas = [{ id: "X", nombre: "X", lat: 40.40, lng: -3.70 }, { id: "Y", nombre: "Y", lat: 40.40, lng: -3.60 }, { id: "Yb", nombre: "Yb", lat: 40.40, lng: -3.60 }, { id: "Xb", nombre: "Xb", lat: 40.40, lng: -3.70 }];
  const ida = Array.from({ length: 16 }, (_, k) => h(6) + k * 60);
  const red = { paradas, lineas: [{ id: "L", nombre: "L", color: "#0ff", sentidos: [
    { ...sentido(0, ["X", "Y"], ida, 90), tiempos: ["00-06", "06-09", "09-13", "13-16", "16-20", "20-24"].map(f => ({ franja: f, min: 90, viajes: 1 })) },
    { ...sentido(1, ["Yb", "Xb"], ida.map(m => m + 100), 90), tiempos: ["00-06", "06-09", "09-13", "13-16", "16-20", "20-24"].map(f => ({ franja: f, min: 90, viajes: 1 })) },
  ] }] };
  const cocheras = [{ id: "lejos", nombre: "Lejos", lat: 40.30, lng: -3.70 }];
  const reales = pz => pz.viajes.filter(v => !v.vacio).length;

  it("ninguna pieza es solo un vacío: la salida de cochera va con el primer viaje y la vuelta con el último", () => {
    for (const corte of ["max", "equilibrado", 180, 150, 120, 90, 60]) {
      const r = generarServicio(red, {}, { dia: "laborable", corte }, { cocheras });
      const piezas = r.turnos.flatMap(t => t.piezas);
      expect(piezas.length).toBeGreaterThan(0);
      for (const pz of piezas) expect(reales(pz), `corte ${corte}: pieza de ${pz.inicio} sin viajes`).toBeGreaterThan(0);
      expect(r.turnos.every(t => t.piezas.some(pz => reales(pz) > 0))).toBe(true);
      // y nada se queda sin conductor
      expect(piezas.flatMap(pz => pz.viajes).length).toBe(r.vehiculos.reduce((s, v) => s + v.viajes.length, 0));
    }
  });

  it("no hay piezas más cortas que la pieza mínima (salvo que el autobús entero trabaje menos)", () => {
    for (const corte of ["max", 120, 90, 60]) {
      const r = generarServicio(red, {}, { dia: "laborable", corte, piezaMin: 90 }, { cocheras });
      for (const pz of r.turnos.flatMap(t => t.piezas)) {
        const bloque = r.vehiculos.find(v => v.id === pz.vehiculo);
        expect(pz.fin - pz.inicio >= 90 || bloque.fin - bloque.inicio < 90, `corte ${corte}: pieza de ${pz.fin - pz.inicio} min`).toBe(true);
      }
    }
  });
});

describe("scheduling de líneas: tipos de turno", () => {
  // Línea circular cada 15 min de 5:00 a 24:00, 25 min de recorrido
  const salidas = Array.from({ length: 77 }, (_, k) => h(5) + k * 15);
  const red = { lineas: [{ id: "C", nombre: "C", color: "#ff0", sentidos: [{ ...sentido(0, ["Z", "W", "Z"], salidas, 25), tiempos: ["00-06", "06-09", "09-13", "13-16", "16-20", "20-24"].map(f => ({ franja: f, min: 25, viajes: 1 })) }] }] };
  const tipos = TIPOS_TURNO_DEFECTO;

  it("cada turno es del primer tipo en el que encaja, y cumple sus límites", () => {
    const r = generarServicio(red, {}, { dia: "laborable" });
    for (const t of r.turnos) {
      const tipo = tipos.find(x => x.id === t.tipo);
      if (!tipo) { expect(t.avisos.some(a => /No encaja/.test(a))).toBe(true); continue; }
      expect(t.trabajo).toBeGreaterThanOrEqual(tipo.trabajoMin);
      expect(t.trabajo).toBeLessThanOrEqual(tipo.trabajoMax);
      expect(t.duracion).toBeLessThanOrEqual(tipo.amplitudMax);
      if (!tipo.partido) expect(t.partidos).toBe(0);
      expect(t.tipoNombre).toBe(tipo.nombre);
    }
    expect(Object.values(r.kpis.turnosPorTipo).reduce((a, b) => a + b, 0)).toBe(r.turnos.length);
  });

  it("con tipos de turno salen menos turnos cortos que sin ellos (el partido junta las puntas)", () => {
    const cortos = r => r.turnos.filter(t => t.trabajo < 240).length;
    const con = generarServicio(red, {}, { dia: "laborable" });
    const sin = generarServicio(red, {}, { dia: "laborable", tiposTurno: [] });
    expect(cortos(con)).toBeLessThanOrEqual(cortos(sin));
    expect(con.turnos.flatMap(t => t.piezas.flatMap(pz => pz.viajes)).length).toBe(con.kpis.viajes); // todo cubierto
  });

  it("si se desactiva un tipo no sale ninguno de ese tipo; sin partido no hay partidos", () => {
    const sinPartido = tipos.map(x => (x.id === "partido" ? { ...x, activo: false } : x));
    const r = generarServicio(red, {}, { dia: "laborable", tiposTurno: sinPartido });
    expect(r.turnos.every(t => t.tipo !== "partido" && t.partidos === 0)).toBe(true);
    const sinRefuerzo = tipos.map(x => (x.id === "refuerzo" ? { ...x, activo: false } : x));
    expect(generarServicio(red, {}, { dia: "laborable", tiposTurno: sinRefuerzo }).turnos.every(t => t.tipo !== "refuerzo")).toBe(true);
  });

  it("franjas de inicio que cruzan la medianoche y trabajo mínimo", () => {
    const noche = tipos.find(x => x.id === "noche"); // 17:00 – 04:00
    expect(encajaTipo({ inicio: h(22), fin: h(29), trabajo: 400, partidos: 0 }, noche, true)).toBe(true);
    expect(encajaTipo({ inicio: h(26), fin: h(30), trabajo: 400, partidos: 0 }, noche, true)).toBe(true); // 02:00
    expect(encajaTipo({ inicio: h(12), fin: h(19), trabajo: 400, partidos: 0 }, noche)).toBe(false);
    expect(encajaTipo({ inicio: h(22), fin: h(25), trabajo: 180, partidos: 0 }, noche, true)).toBe(false); // no llega al mínimo
    expect(tipoDeTurno({ inicio: h(7), fin: h(10), trabajo: 180, partidos: 0 }, { tiposTurno: tipos })?.id).toBe("refuerzo");
    expect(tipoDeTurno({ inicio: h(7), fin: h(15), trabajo: 470, partidos: 0 }, { tiposTurno: tipos })?.id).toBe("manana");
  });
});

describe("scheduling de líneas: cambios a mano", () => {
  const paradas = [
    { id: "X", nombre: "X", lat: 40.40, lng: -3.70 }, { id: "Y", nombre: "Y", lat: 40.43, lng: -3.70 },
    { id: "Z", nombre: "Z", lat: 40.439, lng: -3.70 }, { id: "W", nombre: "W", lat: 40.47, lng: -3.70 },
  ];
  // A: X→Y a las 7 y a las 12; B: Z→W a las 8 (sin vacíos: tres autobuses). Si la
  // expedición cae a menos de 1 h de un bloque se une a él; si no, otro bloque del autobús.
  const red = { paradas, lineas: [
    { id: "A", nombre: "A", color: "#f00", sentidos: [sentido(0, ["X", "Y"], [h(7), h(12)], 30)] },
    { id: "B", nombre: "B", color: "#00f", sentidos: [sentido(0, ["Z", "W"], [h(8)], 30)] },
  ] };
  const cocheras = [{ id: "c1", nombre: "Norte", lat: 40.395, lng: -3.70 }];
  const base = () => generarVehiculos(red, {}, { dia: "laborable", vacioMaxKm: 0, margenCochera: 600 }, { cocheras }); // un autobús por bloque

  it("mover una expedición a otro autobús rehace los vacíos y deja los turnos por hacer", () => {
    const v = base();
    const conB = v.vehiculos.find(b => b.viajes.some(x => x.linea === "B"));
    const conA = v.vehiculos.find(b => b.viajes.some(x => x.linea === "A" && x.dep === h(7)));
    expect(conB.autobus).not.toBe(conA.autobus);
    const viajeB = conB.viajes.find(x => !x.vacio);
    const m = moverViaje(v, claveViaje(viajeB), conA.autobus);
    expect(m.error).toBeUndefined();
    const bloque = m.vehiculos.find(b => b.viajes.includes(viajeB));
    expect(bloque.autobus).toBe(conA.autobus);
    // vacío de Y (fin de la A) a Z (inicio de la B) con su línea de destino
    expect(bloque.viajes.find(x => x.tipo === "cabecera")).toMatchObject({ o: "Y", d: "Z", hacia: "B" });
    expect(m.kpis.autobuses).toBeLessThan(v.kpis.autobuses);
    expect(m.turnos).toBe(null);
    expect(v.vehiculos.find(b => b.id === conB.id).viajes).toContain(viajeB); // el de entrada no se toca
    // solaparse no se puede; a un autobús nuevo, sí
    const otraA = v.vehiculos.flatMap(b => b.viajes).find(x => x.linea === "A" && x.dep === h(7));
    expect(moverViaje(m, claveViaje({ ...otraA, dep: h(7) }), bloque.autobus).error).toBeTruthy();
    expect(moverViaje(v, claveViaje(viajeB), null).kpis.autobuses).toBe(v.kpis.autobuses);
  });

  it("si no llega a tiempo queda un aviso en el bloque", () => {
    const red2 = { paradas, lineas: [
      { id: "A", nombre: "A", color: "#f00", sentidos: [sentido(0, ["X", "Y"], [h(7)], 30)] },
      { id: "B", nombre: "B", color: "#00f", sentidos: [sentido(0, ["Z", "W"], [h(7, 32)], 30)] },
    ] };
    const v = generarVehiculos(red2, {}, { dia: "laborable", vacioMaxKm: 0 }, { cocheras });
    const viajeB = v.vehiculos.flatMap(b => b.viajes).find(x => x.linea === "B");
    const busA = v.vehiculos.find(b => b.viajes.some(x => x.linea === "A")).autobus;
    const m = moverViaje(v, claveViaje(viajeB), busA);
    expect(m.vehiculos.find(b => b.viajes.includes(viajeB)).avisos[0]).toMatch(/No llega a tiempo a la B/);
  });

  it("mover una pieza a otro turno: se recalcula con sus avisos; solaparse no se puede", () => {
    const salidas = Array.from({ length: 37 }, (_, k) => h(5) + k * 30);
    const red3 = { lineas: [{ id: "C", nombre: "C", color: "#ff0", sentidos: [{ ...sentido(0, ["Z", "W", "Z"], salidas, 25), tiempos: ["00-06", "06-09", "09-13", "13-16", "16-20", "20-24"].map(f => ({ franja: f, min: 25, viajes: 1 })) }] }] };
    const r = generarServicio(red3, {}, { dia: "laborable" });
    const [t1] = r.turnos;
    const ultimo = r.turnos.at(-1);
    const pz = t1.piezas[0];
    const m = moverPieza(r, clavePieza(pz), ultimo.id);
    expect(m.error).toBeUndefined();
    const nuevo = m.turnos.find(t => t.id === ultimo.id);
    expect(nuevo.piezas.map(clavePieza)).toContain(clavePieza(pz));
    expect(nuevo.avisos.some(a => /No encaja en ningún tipo de turno/.test(a))).toBe(true); // con tipos de turno
    expect(m.turnos.flatMap(t => t.piezas).length).toBe(r.turnos.flatMap(t => t.piezas).length);
    // la misma pieza al turno con el que se solapa: no
    const solapado = r.turnos.find(t => t !== t1 && t.piezas.some(x => x.inicio < pz.fin && pz.inicio < x.fin));
    if (solapado) expect(moverPieza(r, clavePieza(pz), solapado.id).error).toMatch(/solapa/);
    // a un turno nuevo
    expect(moverPieza(r, clavePieza(pz), null).kpis.turnos).toBeGreaterThanOrEqual(r.kpis.turnos);
    // guardar y volver a aplicar da lo mismo
    const otra = aplicarCambios(generarServicio(red3, {}, { dia: "laborable" }), [{ tipo: "pieza", clave: clavePieza(pz), destino: ultimo.id }]);
    expect(otra.fallidos).toEqual([]);
    expect(otra.res.kpis.turnos).toBe(m.kpis.turnos);
  });
});
