import { describe, it, expect } from "vitest";
import { lineaDe, consultaCalles, distanciaM, minutosBarrido, partir, puntoMedio, tramosDeOsm, descargarCallejero } from "./callejero.js";

// una calle recta de ~600 m hacia el este en Madrid (0,0071º de longitud ≈ 600 m)
const recta = Array.from({ length: 7 }, (_, i) => ({ lat: 40.4168, lon: -3.7038 + i * 0.00118 }));
const osm = { elements: [
  { type: "way", id: 1, tags: { highway: "residential", name: "Calle Mayor" }, geometry: recta },
  { type: "way", id: 2, tags: { highway: "pedestrian", name: "Plaza" }, geometry: [{ lat: 40.41, lon: -3.70 }, { lat: 40.4105, lon: -3.70 }] },
  { type: "way", id: 3, tags: { highway: "motorway", name: "M-30" }, geometry: recta },          // no se barre
  { type: "way", id: 4, tags: { highway: "residential" }, geometry: [{ lat: 40.41, lon: -3.70 }, { lat: 40.41001, lon: -3.70 }] }, // 1 m: fuera
] };

describe("callejero de limpieza viaria", () => {
  it("parte las calles en tramos de como mucho 250 m, con su punto medio, forma y tiempo", () => {
    const t = tramosDeOsm(osm);
    const mayor = t.filter(x => x.id.startsWith("osm-1-"));
    expect(mayor.length).toBe(3);
    expect(mayor.every(x => x.longitudM <= 260)).toBe(true);
    expect(mayor.reduce((a, x) => a + x.longitudM, 0)).toBeGreaterThan(580);
    expect(mayor[0]).toMatchObject({ nombre: "Calle Mayor (1)", tipoVia: "residential", frecuencia: "L-X-V" });
    expect(mayor[0].geom.slice(0, 2)).toEqual([40.4168, -3.7038]);
    expect(lineaDe(mayor[0].geom)[0]).toEqual([40.4168, -3.7038]);
    expect(lineaDe([1, 2])).toBeNull();
    expect(t.find(x => x.id === "osm-2-0")).toMatchObject({ nombre: "Plaza", frecuencia: "diaria" });
    expect(t.some(x => x.id.startsWith("osm-3"))).toBe(false);
    expect(t.some(x => x.id.startsWith("osm-4"))).toBe(false);
  });

  it("el tiempo de barrido sale de los metros de acera por hora", () => {
    expect(minutosBarrido(300, { mPorHora: 1200, aceras: 2 })).toBe(30);
    expect(minutosBarrido(300, { mPorHora: 1200, aceras: 1 })).toBe(15);
  });

  it("geometría: distancia, punto medio y partir", () => {
    const a = { lat: 40.4168, lng: -3.7038 }, b = { lat: 40.4168, lng: -3.6967 };
    expect(Math.round(distanciaM(a, b))).toBeGreaterThan(590);
    expect(puntoMedio([a, b]).lng).toBeCloseTo(-3.70025, 4);
    expect(partir([a, b], 100)).toEqual([[a, b]]); // sin vértices intermedios no se puede partir
  });

  it("la consulta pide solo los tipos de vía elegidos dentro del rectángulo", () => {
    const q = consultaCalles([40.4, -3.71, 40.42, -3.69], ["residential", "pedestrian"]);
    expect(q).toContain('way["highway"~"^(residential|pedestrian)$"](40.4,-3.71,40.42,-3.69)');
    expect(q).toContain("out tags geom");
  });

  it("descarga y avisa si el servidor está ocupado", async () => {
    const ok = await descargarCallejero([40.4, -3.71, 40.42, -3.69], {}, async () => ({ ok: true, status: 200, json: async () => osm }));
    expect(ok.length).toBeGreaterThan(3);
    await expect(descargarCallejero([0, 0, 1, 1], {}, async () => ({ ok: false, status: 429 }))).rejects.toThrow(/ocupado/);
  });
});

describe("callejero desde el servidor", () => {
  it("valida el rectángulo, prueba otro servidor si uno falla y quita lo que sobra", async () => {
    const { rectanguloValido, descargarConEspejos, compactarTramos, marcadoresDeTramos } = await import("./callejero.js");
    expect(rectanguloValido([40.4, -3.71, 40.42, -3.69])).toBe(true);
    expect(rectanguloValido([40.4, -3.71, 40.6, -3.69])).toBe(false); // 22 km de alto
    expect(rectanguloValido([40.42, -3.71, 40.4, -3.69])).toBe(false);
    expect(rectanguloValido(["x", 1, 2, 3])).toBe(false);
    const llamadas = [];
    const fetchFn = async u => { llamadas.push(u); if (u.includes("a.test")) throw new TypeError("Failed to fetch"); return { ok: true, status: 200, json: async () => osm }; };
    const t = await descargarConEspejos([40.4, -3.71, 40.42, -3.69], {}, fetchFn, ["https://a.test/i", "https://b.test/i"]);
    expect(llamadas).toEqual(["https://a.test/i", "https://b.test/i"]);
    const c = compactarTramos(t);
    expect(c[0].campos).toBeUndefined();
    expect(marcadoresDeTramos(c)[0]).toMatchObject({ calle: "Calle Mayor", tipo: "Calle", servicio: "Barrido manual", frecuencia: "L-X-V" });
  });
});
