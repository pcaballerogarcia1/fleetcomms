import { describe, it, expect, vi } from "vitest";
vi.mock("./firebase.js", () => ({ db: {}, auth: {}, getUserProfileSafe: vi.fn() }));
const { coordQuality, isJunkCoord } = await import("./planning.jsx");

describe("calidad de coordenadas de una capa", () => {
  // 5.000 puntos por Madrid + filas problemáticas del Excel
  const madrid = Array.from({ length: 5000 }, (_, i) => ({ lat: String(40.35 + (i % 100) * 0.002), lng: String(-3.80 + Math.floor(i / 100) * 0.004) }));
  const markers = [
    ...madrid,
    { lat: "0", lng: "0" },            // fila sin coordenadas
    { lat: "0.0003", lng: "-0.0001" }, // "casi" 0,0
    { lat: "", lng: "" },              // vacía
    { lat: "abc", lng: "-3.7" },       // basura
    { lat: "42.88", lng: "-8.54" },    // Santiago de Compostela: mal puesta, muy lejos
  ];

  it("cuenta las no válidas y las muy lejanas", () => {
    const q = coordQuality(markers);
    expect(q.invalid).toBe(4);
    expect(q.far).toBe(1);
    expect(q.isFar(42.88, -8.54)).toBe(true);
    expect(q.isFar(40.42, -3.70)).toBe(false);   // centro de Madrid
    expect(q.isFar(40.48, -3.36)).toBe(false);   // Alcalá de Henares (~30 km): dentro
  });

  it("se calcula una sola vez por capa (misma lista de puntos)", () => {
    expect(coordQuality(markers)).toBe(coordQuality(markers));
  });

  it("isJunkCoord: 0,0 y alrededores, NaN y fuera de rango", () => {
    expect(isJunkCoord(0, 0)).toBe(true);
    expect(isJunkCoord(0.2, -0.3)).toBe(true);
    expect(isJunkCoord(NaN, 1)).toBe(true);
    expect(isJunkCoord(95, 1)).toBe(true);
    expect(isJunkCoord(40.4, -3.7)).toBe(false);
    expect(isJunkCoord(0.2, 36.8)).toBe(false);  // Nairobi-ish: latitud ~0 pero lejos de 0,0
  });

  it("capa sin problemas: sin avisos", () => {
    const q = coordQuality(madrid);
    expect(q.invalid).toBe(0);
    expect(q.far).toBe(0);
  });
});
