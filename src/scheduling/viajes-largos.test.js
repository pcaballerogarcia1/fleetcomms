import { describe, expect, it } from "vitest";
import { NORMA, PARAMS, paradasDePedidos, planificarSemana, simularViaje, zonaPorMar } from "./viajes-largos.js";

const MURCIA = PARAMS.base;
const parada = (id, lat, lng, palets = 4, ventana = PARAMS.ventana) => ({ id, nombre: id, lat, lng, palets, pedidos: [id], ventana, servicio: 15 + 4 * palets });

/** Comprueba la UE 561/2006 en los bloques de un viaje */
function cumple561(bloques) {
  let dia = 0, seguido = 0;
  for (const b of bloques) {
    const dur = b.fin - b.inicio;
    if (b.tipo === "conduccion") { dia += dur; seguido += dur; }
    if (b.tipo === "pausa") { expect(dur).toBeGreaterThanOrEqual(NORMA.pausa); seguido = 0; }
    if (b.tipo === "descanso") { expect(dur).toBeGreaterThanOrEqual(NORMA.descansoDiario); dia = 0; seguido = 0; }
    expect(seguido).toBeLessThanOrEqual(NORMA.tramoSinPausa + 1e-6);
    expect(dia).toBeLessThanOrEqual(NORMA.conduccionDia + 1e-6);
  }
}

describe("un viaje, como lo haría un conductor", () => {
  it("Murcia → A Coruña: pausa a las 4 h 30, noche fuera tras 9 h de conducción y vuelta", () => {
    const v = simularViaje([parada("coruna", 43.3623, -8.4115, 20)], PARAMS.horaSalida);
    expect(v.factible).toBe(true);
    expect(v.km).toBeGreaterThan(1000 * 2 * 0.9); // ~1.000 km por carretera, ida y vuelta
    expect(v.noches).toBeGreaterThanOrEqual(2);
    expect(v.bloques.some(b => b.tipo === "pausa")).toBe(true);
    cumple561(v.bloques);
    // descarga dentro del horario de recepción
    const minDelDia = v.llegadas.coruna % 1440;
    expect(minDelDia).toBeGreaterThanOrEqual(PARAMS.ventana.desde);
    expect(minDelDia).toBeLessThanOrEqual(PARAMS.ventana.hasta);
  });
  it("si llega con el cliente cerrado, duerme allí y descarga al abrir", () => {
    const v = simularViaje([parada("bcn", 41.3874, 2.1686, 4, { desde: 9 * 60, hasta: 10 * 60 })], PARAMS.horaSalida);
    expect(v.factible).toBe(true);
    expect(v.llegadas.bcn % 1440).toBe(9 * 60);
    expect(Math.floor(v.llegadas.bcn / 1440)).toBe(1); // martes por la mañana
    cumple561(v.bloques);
  });
  it("un viaje que no vuelve antes del fin de semana no es factible", () => {
    const v = simularViaje([parada("coruna", 43.3623, -8.4115, 20)], 4 * 1440 + 6 * 60); // sale el viernes
    expect(v.factible).toBe(false);
  });
});

describe("islas, Ceuta y Melilla", () => {
  it("se reconocen y se entregan juntas en su puerto", () => {
    expect(zonaPorMar(39.5696, 2.6502)).toBe("baleares");
    expect(zonaPorMar(28.1235, -15.4363)).toBe("canarias");
    expect(zonaPorMar(35.8894, -5.3213)).toBe("ceuta");
    expect(zonaPorMar(35.2923, -2.9381)).toBe("melilla");
    expect(zonaPorMar(MURCIA.lat, MURCIA.lng)).toBeNull();
    const { paradas } = paradasDePedidos([
      { id: "palma", lat: 39.5696, lng: 2.6502, palets: 3 }, { id: "ibiza", lat: 38.9067, lng: 1.4206, palets: 2 },
      { id: "madrid", lat: 40.4168, lng: -3.7038, palets: 5 },
    ], [{ id: "c1", palets: 32 }]);
    const puerto = paradas.find(s => s.puerto === "baleares");
    expect(puerto).toMatchObject({ palets: 5, pedidos: ["palma", "ibiza"] });
    expect(paradas).toHaveLength(2);
  });
  it("un pedido más grande que el camión más grande se parte en cargas", () => {
    const { paradas } = paradasDePedidos([{ id: "grande", lat: 40.4168, lng: -3.7038, palets: 50 }], [{ id: "c1", palets: 20 }]);
    expect(paradas.map(s => s.palets)).toEqual([20, 20, 10]);
  });
});

// una semana tipo: capitales de provincia y alguna isla
const CIUDADES = [
  ["Madrid", 40.4168, -3.7038], ["Barcelona", 41.3874, 2.1686], ["Valencia", 39.4699, -0.3763], ["Sevilla", 37.3891, -5.9845],
  ["Málaga", 36.7213, -4.4214], ["Zaragoza", 41.6488, -0.8891], ["Bilbao", 43.263, -2.935], ["Alicante", 38.3452, -0.481],
  ["Córdoba", 37.8882, -4.7794], ["Valladolid", 41.6523, -4.7245], ["Granada", 37.1773, -3.5986], ["Almería", 36.834, -2.4637],
  ["Albacete", 38.9943, -1.8585], ["Cartagena", 37.6257, -0.9966], ["Jaén", 37.7796, -3.7849], ["Toledo", 39.8628, -4.0273],
  ["A Coruña", 43.3623, -8.4115], ["Oviedo", 43.3603, -5.8448], ["Palma", 39.5696, 2.6502], ["Las Palmas", 28.1235, -15.4363],
];
function semana(n = 60, semilla = 7) {
  let x = semilla;
  const azar = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  return Array.from({ length: n }, (_, i) => {
    const [c, lat, lng] = CIUDADES[i % CIUDADES.length];
    return { id: `p${i + 1}`, cliente: `Cliente ${i + 1} (${c})`, lat: lat + (azar() - 0.5) * 0.08, lng: lng + (azar() - 0.5) * 0.08, palets: 1 + Math.floor(azar() * 10) };
  });
}
const FLOTA = [32, 32, 26, 26, 24, 20, 18, 16, 14, 12, 10, 8, 6, 3].map((palets, i) => ({ id: `c${i + 1}`, nombre: `Camión ${String(i + 1).padStart(2, "0")}`, palets }));

describe("la semana de una distribuidora (14 camiones de 3 a 32 palés)", () => {
  const r = planificarSemana(semana(), FLOTA, { segundosMejora: 1 });
  it("sirve todos los pedidos, sin pasarse de palés ni de la semana", () => {
    expect(r.sinAsignar).toEqual([]);
    expect(r.resumen.paletsServidos).toBe(r.resumen.paletsTotal);
    for (const v of r.viajes) {
      expect(v.palets).toBeLessThanOrEqual(v.capacidad);
      expect(v.fin).toBeLessThanOrEqual(PARAMS.finSemana);
      cumple561(v.bloques);
    }
  });
  it("cada pedido va en un único viaje (o su puerto) y un camión no hace dos viajes a la vez", () => {
    const vistos = r.viajes.flatMap(v => v.paradas.flatMap(s => s.pedidos));
    expect(new Set(vistos).size).toBe(vistos.length);
    const porCamion = {};
    for (const v of r.viajes) (porCamion[v.camionId] ||= []).push(v);
    for (const l of Object.values(porCamion)) {
      l.sort((a, b) => a.inicio - b.inicio);
      for (let i = 1; i < l.length; i++) expect(l[i].inicio).toBeGreaterThanOrEqual(l[i - 1].fin + NORMA.descansoDiario - 1);
    }
  });
  it("llena los camiones y da un resumen con km, noches y coste", () => {
    expect(r.resumen.ocupacionMedia).toBeGreaterThan(0.6);
    expect(r.resumen.km).toBeGreaterThan(0);
    expect(r.resumen.noches).toBeGreaterThan(0);
    expect(r.resumen.coste).toBeGreaterThan(0);
  });
  it("si no hay camiones de sobra, dice qué pedidos no caben", () => {
    const poca = planificarSemana(semana(120), FLOTA.slice(0, 2), { segundosMejora: 0.3 });
    expect(poca.sinAsignar.length).toBeGreaterThan(0);
    expect(poca.sinAsignar[0].motivo).toMatch(/camión/);
  });
});
