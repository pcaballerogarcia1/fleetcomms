import { describe, it, expect } from "vitest";
import { disenoNuevo, fechasCalendario, salidasDeTramos, construirRed, revisarDiseno, vueltaDe, quitarParada, nuevoId } from "./red-diseno.js";
import { salidasDe, duracionViaje, generarVehiculos } from "./lineas-sched.js";
import { filtrarRed } from "./gtfs-red.js";

const PARADAS = [
  { id: "p1", nombre: "Plaza Mayor", lat: 40.40, lng: -3.70 },
  { id: "p2", nombre: "Mercado", lat: 40.41, lng: -3.70 },
  { id: "p3", nombre: "Hospital", lat: 40.42, lng: -3.70 },
];
function disenoEjemplo() {
  const d = disenoNuevo(new Date(2026, 9, 12)); // lunes 12 oct 2026
  d.operador = "Autobuses Demo";
  d.paradas = PARADAS;
  const ida = { dir: 0, paradas: ["p1", "p2", "p3"], trazado: null, tiempo: 20, tiempos: { "06-09": 25 }, horarios: { "cal:lab": [{ desde: 360, hasta: 600, cada: 30 }], "cal:sab": [{ desde: 480, hasta: 600, cada: 60 }] } };
  d.lineas = [{ id: "L1", nombre: "1", largo: "Plaza – Hospital", color: "#f00", sentidos: [ida, vueltaDe(ida)] }];
  return d;
}

describe("calendarios y frecuencias", () => {
  it("las fechas salen de los días de la semana, el rango y las excepciones", () => {
    const c = { dias: [1, 2, 3, 4, 5], desde: "2026-10-12", hasta: "2026-10-18", sin: ["2026-10-12"], con: ["2026-10-17"] };
    expect(fechasCalendario(c)).toEqual(["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
    expect(fechasCalendario({ dias: [1], desde: "2026-10-20", hasta: "2026-10-10" })).toEqual([]);
  });
  it("los tramos de frecuencia dan las horas de salida (también pasando de medianoche)", () => {
    expect(salidasDeTramos([{ desde: 360, hasta: 420, cada: 20 }])).toEqual([360, 380, 400, 420]);
    expect(salidasDeTramos([{ desde: 360, hasta: 400, cada: 20 }, { desde: 400, hasta: 460, cada: 30 }])).toEqual([360, 380, 400, 430, 460]);
    expect(salidasDeTramos([{ desde: 1410, hasta: 30, cada: 30 }])).toEqual([1410, 1440, 1470]);
    expect(salidasDeTramos([{ desde: 360, hasta: 420, cada: 0 }])).toEqual([]);
  });
  it("el diseño nuevo trae laborables, sábados y domingos para un año", () => {
    const d = disenoNuevo(new Date(2026, 9, 12));
    expect(d.calendarios.map(c => c.id)).toEqual(["cal:lab", "cal:sab", "cal:dom"]);
    expect(fechasCalendario(d.calendarios[0]).length).toBeGreaterThan(250);
  });
});

describe("construir la red", () => {
  it("tiene la misma forma que la de un GTFS y la entienden el Scheduling y la importación", () => {
    const red = construirRed(disenoEjemplo());
    expect(red.lineas).toHaveLength(1);
    const [ida, vuelta] = red.lineas[0].sentidos;
    expect(ida).toMatchObject({ dir: 0, nombre: "Ida", cabecera: "Hospital", paradas: ["p1", "p2", "p3"], primera: "06:00", ultima: "10:00" });
    expect(vuelta).toMatchObject({ dir: 1, nombre: "Vuelta", cabecera: "Plaza Mayor", paradas: ["p3", "p2", "p1"] });
    expect(ida.km).toBeGreaterThan(2);
    expect(ida.trazado).toHaveLength(3);
    expect(red.agencias).toEqual(["Autobuses Demo"]);
    // calendarios con viajes (el de domingos no tiene ninguno)
    expect(red.calendarios.map(c => c.id)).toEqual(["cal:lab", "cal:sab"]);
    expect(red.calendarios[0]).toMatchObject({ servicios: ["cal:lab"], viajes: 18 });
    // días de referencia y viajes por tipo de día
    expect(new Date(red.dias.laborable + "T12:00:00Z").getUTCDay()).toBeGreaterThanOrEqual(1);
    expect(red.dias.festivo).toBe(null);
    expect(ida.viajes).toEqual({ laborable: 9, sabado: 3, festivo: 0 });
    // Scheduling: salidas por calendario y por tipo de día, y tiempo por franja
    expect(salidasDe(ida, "cal:lab", red).lista).toEqual([360, 390, 420, 450, 480, 510, 540, 570, 600]);
    expect(salidasDe(ida, "sabado", red).lista).toEqual([480, 540, 600]);
    expect(duracionViaje(ida, 400, {})).toBe(25); // 06–09 corregido
    expect(duracionViaje(ida, 700, {})).toBe(20);
    const r = generarVehiculos(red, {}, { dia: "cal:lab" });
    expect(r.vehiculos.length).toBeGreaterThan(0);
    // la ventana de importar/filtrar también la entiende
    expect(filtrarRed(red, { lineas: ["L1"], calendarios: ["cal:sab"] }).calendarios[0].viajes).toBe(6);
    // y se guarda el diseño para seguir editando
    expect(red.diseno.lineas[0].id).toBe("L1");
  });
  it("sin tiempo puesto propone uno por la distancia; con recorrido dibujado lo usa", () => {
    const d = disenoEjemplo();
    d.lineas[0].sentidos[0].tiempo = null;
    d.lineas[0].sentidos[0].tiempos = {};
    d.lineas[0].sentidos[0].trazado = [[40.40, -3.70], [40.405, -3.69], [40.42, -3.70]];
    const ida = construirRed(d).lineas[0].sentidos[0];
    expect(ida.trazado).toHaveLength(3);
    expect(ida.tiempos.every(t => t.min >= 5)).toBe(true);
  });
  it("los sentidos con menos de 2 paradas no entran y se avisa", () => {
    const d = disenoEjemplo();
    d.lineas.push({ id: "L2", nombre: "2", color: "#0f0", sentidos: [{ dir: 0, paradas: ["p1"], horarios: {} }] });
    expect(construirRed(d).lineas.map(l => l.id)).toEqual(["L1"]);
    const av = revisarDiseno(d);
    expect(av.some(a => a.includes("2 (ida): necesita al menos 2 paradas"))).toBe(true);
    expect(av.some(a => a.includes("2 (ida): sin horarios"))).toBe(true);
    expect(revisarDiseno(disenoEjemplo())).toEqual([]);
  });
  it("quitar una parada la saca de los recorridos", () => {
    const d = quitarParada(disenoEjemplo(), "p2");
    expect(d.paradas.map(p => p.id)).toEqual(["p1", "p3"]);
    expect(d.lineas[0].sentidos[0].paradas).toEqual(["p1", "p3"]);
    expect(construirRed(d).paradas.map(p => p.id)).toEqual(["p1", "p3"]);
  });
  it("ids nuevos que no se repiten", () => {
    const id = nuevoId("p", ["pa"]);
    expect(id.startsWith("p")).toBe(true);
    expect(id).not.toBe("pa");
  });
});
