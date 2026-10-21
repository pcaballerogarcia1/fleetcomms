import { afterEach, describe, expect, it } from "vitest";
import { claveCoord, fijarCarretera, haversineKm, kmRuta } from "../vrp-engine.js";
import { gruposCercanos, huellaPuntos, vecinosPorCarretera } from "./vecinos.js";

// OSRM de mentira: por carretera, el triple de la línea recta
const osrm = llamadas => async url => {
  llamadas.push(url);
  const pts = new URL(url).pathname.split("/").pop().split(";").map(p => p.split(",").map(Number));
  return { json: async () => ({ code: "Ok", distances: pts.map(a => pts.map(b => haversineKm(a[1], a[0], b[1], b[0]) * 3000)) }) };
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
    const r = await vecinosPorCarretera(rejilla, { fetchFn: osrm(llamadas), pausaMs: 0, k: 10 });
    expect(llamadas.length).toBe(gruposCercanos(rejilla, 90, true).length + gruposCercanos(rejilla, 90, false).length);
    expect(r.vecinos.size).toBe(400);
    const [a, m] = [...r.vecinos][0];
    expect(m.size).toBe(10);
    const [b, km] = [...m][0];
    expect(a).not.toBe(b);
    expect(km).toBeGreaterThan(0);
  });
  it("el motor usa la carretera real entre vecinas y, para lo demás, la medida de la zona", async () => {
    const r = await vecinosPorCarretera(rejilla, { fetchFn: osrm([]), pausaMs: 0, k: 10 });
    fijarCarretera({ factor: 1.5, vecinos: r.vecinos, vecinosMaxKm: r.maxKm });
    const [p, q] = [rejilla[0], rejilla[1]];
    expect(kmRuta(p.lat, p.lng, q.lat, q.lng)).toBeCloseTo(haversineKm(p.lat, p.lng, q.lat, q.lng) * 3, 3); // real (×3)
    const lejos = rejilla[399];
    expect(kmRuta(p.lat, p.lng, lejos.lat, lejos.lng)).toBeCloseTo(haversineKm(p.lat, p.lng, lejos.lat, lejos.lng) * 1.5, 6); // medida (×1,5)
  });
  it("la huella no depende del orden y la clave distingue puntos a un metro", () => {
    expect(huellaPuntos(rejilla)).toBe(huellaPuntos([...rejilla].reverse()));
    expect(claveCoord(39.55, 2.62)).not.toBe(claveCoord(39.55001, 2.62));
  });
});
