import { afterEach, describe, expect, it } from "vitest";
import { claveCoord, fijarCarretera, haversineKm, kmRuta, tiempoRuta } from "../vrp-engine.js";
import { gruposCercanos, huellaPuntos, vecinosPorCarretera } from "./vecinos.js";

// OSRM de mentira: por carretera, el triple de la línea recta
const osrm = llamadas => async url => {
  llamadas.push(url);
  const u = new URL(url);
  const pts = u.pathname.split("/").pop().split(";").map(p => p.split(",").map(Number));
  const src = u.searchParams.get("sources")?.split(";").map(Number) || pts.map((_, i) => i);
  const dst = u.searchParams.get("destinations")?.split(";").map(Number) || pts.map((_, i) => i);
  const km = (a, b) => haversineKm(pts[a][1], pts[a][0], pts[b][1], pts[b][0]) * 3;
  // por carretera el triple de la línea recta, a 24 km/h de coche
  return { json: async () => ({ code: "Ok", distances: src.map(a => dst.map(b => km(a, b) * 1000)), durations: src.map(a => dst.map(b => km(a, b) / 24 * 3600)) }) };
};
const rejilla = Array.from({ length: 400 }, (_, i) => ({ lat: 39.55 + Math.floor(i / 20) * 0.0009, lng: 2.62 + (i % 20) * 0.0012 }));

afterEach(() => fijarCarretera(null));

describe("carretera real entre paradas vecinas", () => {
  it("grupos de hasta 90 puntos cercanos", () => {
    const g = gruposCercanos(rejilla, 90);
    expect(g.flat()).toHaveLength(400);
    expect(Math.max(...g.map(x => x.length))).toBeLessThanOrEqual(90);
  });
  it("de cada punto, la carretera a sus vecinos; en dos pasadas (bordes cubiertos)", async () => {
    const llamadas = [];
    const r = await vecinosPorCarretera(rejilla, { fetchFn: osrm(llamadas), pausaMs: 0, k: 10, completaHasta: 0 });
    expect(llamadas.length).toBe(gruposCercanos(rejilla, 90, true).length + gruposCercanos(rejilla, 90, false).length);
    expect(r.vecinos.size).toBe(400);
    const [a, m] = [...r.vecinos][0];
    expect(m.size).toBe(10);
    const [b, km] = [...m][0];
    expect(a).not.toBe(b);
    expect(km).toBeGreaterThan(0);
  });
  it("el motor usa la carretera real entre vecinas y, para lo demás, la medida de la zona", async () => {
    const r = await vecinosPorCarretera(rejilla, { fetchFn: osrm([]), pausaMs: 0, k: 10, completaHasta: 0 });
    fijarCarretera({ factor: 1.5, vecinos: r.vecinos, tiempos: r.tiempos, vecinosMaxKm: r.maxKm });
    const [p, q] = [rejilla[0], rejilla[1]];
    expect(kmRuta(p.lat, p.lng, q.lat, q.lng)).toBeCloseTo(haversineKm(p.lat, p.lng, q.lat, q.lng) * 3, 3); // real (×3)
    const lejos = rejilla[399];
    expect(kmRuta(p.lat, p.lng, lejos.lat, lejos.lng)).toBeCloseTo(haversineKm(p.lat, p.lng, lejos.lat, lejos.lng) * 1.5, 6); // medida (×1,5)
  });
  it("con pocos sitios, la tabla completa: km y minutos reales de todos con todos", async () => {
    const pocos = rejilla.slice(0, 120);
    const llamadas = [];
    const r = await vecinosPorCarretera(pocos, { fetchFn: osrm(llamadas), pausaMs: 0 });
    expect(r.completa).toBe(true);
    expect(llamadas).toHaveLength(9); // bloques de 50: 3 × 3
    expect(r.pares).toBe(120 * 119);
    fijarCarretera({ factor: 1.5, vecinos: r.vecinos, tiempos: r.tiempos, vecinosMaxKm: r.maxKm });
    const [p, q] = [pocos[0], pocos[119]];
    const km = haversineKm(p.lat, p.lng, q.lat, q.lng) * 3;
    expect(kmRuta(p.lat, p.lng, q.lat, q.lng)).toBeCloseTo(km, 2);
    expect(tiempoRuta(p.lat, p.lng, q.lat, q.lng)).toBeCloseTo(km / 24 * 60 / 0.8, 2); // minutos de camión
  });
  it("la huella no depende del orden y la clave distingue puntos a un metro", () => {
    expect(huellaPuntos(rejilla)).toBe(huellaPuntos([...rejilla].reverse()));
    expect(claveCoord(39.55, 2.62)).not.toBe(claveCoord(39.55001, 2.62));
  });
});
