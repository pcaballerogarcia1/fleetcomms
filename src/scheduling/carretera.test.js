import { afterEach, describe, expect, it } from "vitest";
import { fijarCarretera, haversineKm, kmRuta, minutosRuta, TRAVEL_SPEED_KMH } from "../vrp-engine.js";
import { medirCarretera, puntosDeMuestra, rodeosCortos, textoCarretera } from "./carretera.js";

// OSRM de mentira: la carretera es 1,5 veces la línea recta (2 veces en lo corto) y va a 30 km/h
const osrm = async url => {
  const u = new URL(url);
  const pts = u.pathname.split("/").pop().split(";").map(p => p.split(",").map(Number));
  const src = u.searchParams.get("sources")?.split(";").map(Number) || pts.map((_, i) => i);
  const dst = u.searchParams.get("destinations")?.split(";").map(Number) || pts.map((_, i) => i);
  const km = (a, b) => { const d = haversineKm(pts[a][1], pts[a][0], pts[b][1], pts[b][0]); return d * (d < 0.3 ? 2 : 1.5); };
  return { json: async () => ({ code: "Ok", distances: src.map(a => dst.map(b => km(a, b) * 1000)), durations: src.map(a => dst.map(b => (km(a, b) / 30) * 3600)) }) };
};
// una cuadrícula de 30 × 30 puntos a unos 100 m
const rejilla = Array.from({ length: 900 }, (_, i) => ({ lat: 39.55 + Math.floor(i / 30) * 0.0009, lng: 2.62 + (i % 30) * 0.0012 }));

afterEach(() => fijarCarretera(null));

describe("la carretera de la zona", () => {
  it("muestra repartida por la zona, con vecinos", () => {
    const m = puntosDeMuestra(rejilla);
    expect(m).toHaveLength(40);
    expect(new Set(m.map(p => `${p.lat},${p.lng}`)).size).toBe(40);
  });
  it("mide el rodeo (corto y largo) y la velocidad de camión", async () => {
    const r = await medirCarretera(rejilla, { fetchFn: osrm });
    expect(r.medido).toBe(true);
    expect(r.factor).toBeCloseTo(1.5, 1);
    expect(r.rodeos[0].f).toBeCloseTo(2, 1); // lo corto rodea más
    expect(r.rodeos.every(x => !Array.isArray(x))).toBe(true); // se puede guardar en Firestore
    expect(r.kmh).toBeCloseTo(30 * 0.8, 0); // un camión, al 80 % de un coche
    expect(textoCarretera(r)).toMatch(/carretera de la zona/);
    expect((await rodeosCortos(rejilla, { fetchFn: osrm })).length).toBeGreaterThan(0);
  });
  it("si no hay servicio de rutas, sigue en línea recta y lo dice", async () => {
    const r = await medirCarretera(rejilla.slice(1), { fetchFn: async () => { throw new Error("sin red"); } });
    expect(r).toMatchObject({ medido: false });
    expect(textoCarretera(r)).toMatch(/línea recta a 30 km\/h/);
  });
});

describe("el motor con la carretera medida", () => {
  it("sin medir: como siempre (línea recta a 30 km/h)", () => {
    const d = haversineKm(39.55, 2.62, 39.56, 2.63);
    expect(kmRuta(39.55, 2.62, 39.56, 2.63)).toBe(d);
    expect(TRAVEL_SPEED_KMH).toBe(30);
    expect(minutosRuta(10)).toBeCloseTo(20, 6);
  });
  it("con el rodeo por tramos y dos velocidades", () => {
    fijarCarretera({ factor: 1.4, rodeos: [{ d: 0.1, f: 3 }, { d: 1, f: 2 }, [5, 1.4]], kmh: 20, kmhLargo: 40 });
    const corto = haversineKm(39.55, 2.62, 39.5505, 2.62); // ~55 m
    expect(kmRuta(39.55, 2.62, 39.5505, 2.62) / corto).toBeCloseTo(3, 6);
    expect(kmRuta(39.55, 2.62, 39.6, 2.62) / haversineKm(39.55, 2.62, 39.6, 2.62)).toBeCloseTo(1.4, 1); // ~5,6 km
    expect(TRAVEL_SPEED_KMH).toBe(20);
    expect(minutosRuta(1)).toBeCloseTo(3, 6); // entre paradas, a 20 km/h
    expect(minutosRuta(30)).toBeCloseTo(30 / 40 * 60, 6); // largo, a 40 km/h
    fijarCarretera({ factor: 9, kmh: 500 }); // valores imposibles: se ignoran
    expect(TRAVEL_SPEED_KMH).toBe(30);
    expect(kmRuta(39.55, 2.62, 39.56, 2.63)).toBe(haversineKm(39.55, 2.62, 39.56, 2.63));
  });
});
