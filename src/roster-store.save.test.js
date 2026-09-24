import { describe, it, expect, vi, beforeEach } from "vitest";

const written = [];
let mainWrites = [];
vi.mock("./firebase.js", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  doc: (_db, ...path) => path.join("/"),
  collection: (_db, ...path) => path.join("/"),
  writeBatch: () => ({ set: (ref, data) => written.push([ref, data]), commit: async () => {} }),
  setDoc: async (ref, data) => { mainWrites.push([ref, data]); },
  serverTimestamp: () => "ts",
  getDoc: vi.fn(), getDocs: vi.fn(), onSnapshot: vi.fn(), query: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), where: vi.fn(),
}));
const { saveRosterMonth, savedSnapshotOf } = await import("./roster-store.js");

describe("saveRosterMonth", () => {
  beforeEach(() => { written.length = 0; mainWrites = []; });

  it("solo escribe los trabajadores que han cambiado", async () => {
    const grid = { w1: { 1: "M" }, w2: { 1: "T" } };
    const savedRef = { current: savedSnapshotOf(grid, {}) };
    await saveRosterMonth("org", 2026, 10, { ...grid, w2: { 1: "L" } }, {}, savedRef);
    expect(written.map(([ref]) => ref)).toEqual(["rostering/org_2026_10/trabajadores/w2"]);
    expect(written[0][1]).toMatchObject({ org_id: "org", grid: { 1: "L" }, asign: {} });
    // la ficha del mes queda sin grid (formato nuevo)
    expect(mainWrites[0][1]).toEqual({ org_id: "org", year: 2026, month: 10, formato: 2, updatedAt: "ts" });
    // y un segundo guardado sin cambios no escribe nada
    written.length = 0;
    await saveRosterMonth("org", 2026, 10, { ...grid, w2: { 1: "L" } }, {}, savedRef);
    expect(written).toHaveLength(0);
  });

  it("un mes en formato antiguo se migra entero al guardar", async () => {
    const grid = { w1: { 1: "M" }, w2: { 1: "T" }, w3: {} };
    await saveRosterMonth("org", 2026, 10, grid, { w1: { 1: { v: "A" } } }, { current: {} }, { legacy: true });
    expect(written.map(([ref]) => ref.split("/").pop()).sort()).toEqual(["w1", "w2", "w3"]);
  });
});
