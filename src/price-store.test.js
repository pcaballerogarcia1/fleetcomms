import { describe, it, expect, vi } from "vitest";

const writes = [];
vi.mock("./firebase.js", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  doc: (_db, ...path) => path.join("/"),
  setDoc: async (ref, data, opts) => { writes.push([ref, data, opts]); },
  onSnapshot: vi.fn(),
  deleteField: () => "__DELETE__",
  serverTimestamp: () => "ts",
}));
const { partOf, puntoKeyOf, effectivePrice, savePointPrices, PRICE_PARTS, fmtEur } = await import("./price-store.js");

describe("precios por punto", () => {
  it("la clave del punto coincide con la de Timetable y Rutas", () => {
    expect(puntoKeyOf("40.4165512", "-3.7048")).toBe("40.41655_-3.70480");
    expect(puntoKeyOf(40.4165512, -3.7048)).toBe("40.41655_-3.70480");
  });

  it("reparte los puntos en 8 trozos de forma estable y equilibrada", () => {
    const counts = new Array(PRICE_PARTS).fill(0);
    for (let i = 0; i < 44000; i++) counts[partOf(puntoKeyOf(40.3 + (i % 300) * 0.001, -3.8 + Math.floor(i / 300) * 0.002))]++;
    expect(Math.min(...counts)).toBeGreaterThan(4000);   // ~5.500 cada uno
    expect(Math.max(...counts)).toBeLessThan(7000);      // → < 1 MB por trozo
    expect(partOf("40.41655_-3.70480")).toBe(partOf("40.41655_-3.70480"));
  });

  it("precio propio > precio por defecto > sin precio", () => {
    const prices = { defaultPrecio: 2.5, byKey: new Map([["a", 4]]) };
    expect(effectivePrice(prices, "a")).toBe(4);
    expect(effectivePrice(prices, "b")).toBe(2.5);
    expect(effectivePrice({ defaultPrecio: null, byKey: new Map() }, "b")).toBe(null);
  });

  it("guardar varios puntos escribe solo en sus trozos, y null borra el precio", async () => {
    writes.length = 0;
    await savePointPrices("p1", "org", { "40.00000_-3.00000": 3, "40.00001_-3.00000": null });
    const touched = new Set(writes.map(w => w[0]));
    expect(touched.size).toBeLessThanOrEqual(2);
    for (const [ref, data, opts] of writes) {
      expect(ref.startsWith("precios/p1/trozos/")).toBe(true);
      expect(opts).toEqual({ merge: true });
      expect(data.org_id).toBe("org");
    }
    const all = Object.assign({}, ...writes.map(w => w[1].map));
    expect(all["40.00000_-3.00000"]).toBe(3);
    expect(all["40.00001_-3.00000"]).toBe("__DELETE__");
  });

  it("formato en euros", () => {
    expect(fmtEur(1234.5).replace(/\s/g, " ")).toMatch(/1\.?234,50/);
  });
});
