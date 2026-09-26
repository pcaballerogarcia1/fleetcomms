import { describe, it, expect, vi, beforeEach } from "vitest";

// Firestore simulado: se registran las escrituras de cada lote y las de
// la transacción (sobre un almacén en memoria)
const written = [];
let mainWrites = [];
const store = new Map();
const DEL = { __delete: true };
vi.mock("./firebase.js", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  doc: (_db, ...path) => path.join("/"),
  collection: (_db, ...path) => path.join("/"),
  writeBatch: () => ({
    set: (ref, data, opts) => written.push(["set", ref, data, opts]),
    update: (ref, ...fv) => written.push(["update", ref, fv]),
    commit: async () => {},
  }),
  runTransaction: async (_db, fn) => fn({
    get: async ref => ({ exists: () => store.has(ref), data: () => store.get(ref) }),
    set: (ref, data, opts) => store.set(ref, opts?.merge ? { ...(store.get(ref) || {}), ...data } : data),
    update: (ref, data) => store.set(ref, { ...(store.get(ref) || {}), ...data }),
  }),
  setDoc: async (ref, data) => { mainWrites.push([ref, data]); },
  serverTimestamp: () => "ts",
  deleteField: () => DEL,
  FieldPath: class { constructor(...p) { this.path = p.join("."); } },
  getDoc: vi.fn(), getDocs: vi.fn(), onSnapshot: vi.fn(), query: vi.fn(), deleteDoc: vi.fn(), where: vi.fn(),
}));
const { saveRosterMonth, savedSnapshotOf, saveVehicleCells, saveShiftMoves, mergeCells, changedKeys } = await import("./roster-store.js");
// update(ref, FieldPath, valor, FieldPath, valor…) → { "grid.3": "M", … }
const fields = fv => Object.fromEntries(Array.from({ length: fv.length / 2 }, (_, i) => [fv[2 * i].path, fv[2 * i + 1]]));

describe("cuadrante de trabajadores: solo las casillas que cambian", () => {
  beforeEach(() => { written.length = 0; mainWrites = []; });

  it("escribe solo las casillas cambiadas del trabajador cambiado (y borra las vaciadas)", async () => {
    const grid = { w1: { 1: "M" }, w2: { 1: "T", 2: "T" } };
    const savedRef = { current: savedSnapshotOf(grid, {}) };
    await saveRosterMonth("org", 2026, 10, { ...grid, w2: { 1: "L" } }, {}, savedRef);
    const ref = "rostering/org_2026_10/trabajadores/w2";
    expect(written.filter(w => w[1] !== ref)).toHaveLength(0); // w1 no se toca
    expect(written[0]).toEqual(["set", ref, { org_id: "org", year: 2026, month: 10 }, { merge: true }]);
    expect(fields(written[1][2])).toEqual({ "grid.1": "L", "grid.2": DEL });
    expect(mainWrites[0][1]).toEqual({ org_id: "org", year: 2026, month: 10, formato: 2, updatedAt: "ts" });
    written.length = 0;
    await saveRosterMonth("org", 2026, 10, { ...grid, w2: { 1: "L" } }, {}, savedRef);
    expect(written).toHaveLength(0); // sin cambios, nada
  });

  it("un mes en formato antiguo se migra entero al guardar", async () => {
    const grid = { w1: { 1: "M" }, w2: { 1: "T" }, w3: {} };
    await saveRosterMonth("org", 2026, 10, grid, { w1: { 1: { v: "A" } } }, { current: {} }, { legacy: true });
    expect(written.filter(w => w[0] === "set").map(w => w[1].split("/").pop()).sort()).toEqual(["w1", "w2", "w3"]);
    expect(written.every(w => w[0] === "set" && !w[3])).toBe(true);
  });
});

describe("dos personas editando el mismo mes", () => {
  it("trabajador sin ficha ese mes: tampoco se escribe entera (se fusiona)", async () => {
    written.length = 0;
    await saveRosterMonth("org", 2026, 12, { w9: { 1: "G" } }, {}, { current: {} });
    expect(written[0]).toEqual(["set", "rostering/org_2026_12/trabajadores/w9", { org_id: "org", year: 2026, month: 12 }, { merge: true }]);
    expect(fields(written[1][2])).toEqual({ "grid.1": "G" });
  });

  it("mergeCells: respeta lo que tocó esta persona y trae lo que cambió la otra", () => {
    const base   = { w1: { 1: "M", 2: "M" }, w2: { 1: "T" } };          // lo que ambos leyeron
    const local  = { w1: { 1: "L", 2: "M" }, w2: { 1: "T" } };          // A cambia w1-1 (sin guardar aún)
    const remote = { w1: { 1: "M", 2: "N" }, w2: { 1: "T", 3: "G" } };  // B cambió w1-2 y añadió w2-3
    expect(mergeCells(local, base, remote)).toEqual({ w1: { 1: "L", 2: "N" }, w2: { 1: "T", 3: "G" } });
  });

  it("mergeCells: lo que B borra desaparece; lo que A vació sigue vacío", () => {
    const base = { w1: { 1: "M", 2: "M" } };
    const local = { w1: { 1: "M" } };          // A vació el día 2
    const remote = { w1: { 2: "M" } };          // B vació el día 1
    expect(mergeCells(local, base, remote)).toEqual({ w1: {} });
  });

  it("changedKeys compara valores objeto (asignaciones)", () => {
    expect(changedKeys({ 1: { v: "A" }, 2: { v: "B" } }, { 1: { v: "A" }, 2: { v: "C" }, 3: { v: "D" } })).toEqual(["2", "3"]);
  });
});

describe("disponibilidad de vehículos", () => {
  beforeEach(() => { written.length = 0; });
  it("solo escribe las casillas vehículo+día cambiadas", async () => {
    const prev = { v1: { 1: "T" }, v2: { 5: "I" } };
    const next = { v1: { 1: "T", 2: "A" }, v2: {} };
    expect(await saveVehicleCells("org_2026_10", "org", 2026, 10, prev, next)).toBe(true);
    expect(fields(written.find(w => w[0] === "update")[2])).toEqual({ "grid.v1.2": "A", "grid.v2.5": DEL });
    written.length = 0;
    expect(await saveVehicleCells("org_2026_10", "org", 2026, 10, next, next)).toBe(false);
    expect(written).toHaveLength(0);
  });
});

describe("turnos movidos (Rostering → Scheduling)", () => {
  it("se añaden a la lista que hay AHORA en Firestore, no a la copia de la pantalla", async () => {
    store.clear();
    store.set("scheduling_roster/p1", { generatedAt: "g1", parts: 1, moves: [{ id: "x", toDay: 3 }] }); // lo guardó otra persona
    store.set("scheduling_roster/p1/partes/g1_0", { shifts: [{ id: "s1", d: 1 }, { id: "s2", d: 2 }] });
    const scenario = { generatedAt: "g1", parts: 1, moves: [], shifts: [{ id: "s1", d: 1, _p: "g1_0" }, { id: "s2", d: 2, _p: "g1_0" }] };
    await saveShiftMoves("p1", scenario, new Map([["s1", 4]]), [{ id: "s1", toDay: 4 }]);
    expect(store.get("scheduling_roster/p1").moves).toEqual([{ id: "x", toDay: 3 }, { id: "s1", toDay: 4 }]);
    expect(store.get("scheduling_roster/p1/partes/g1_0").shifts).toEqual([{ id: "s1", d: 4 }, { id: "s2", d: 2 }]);
  });

  it("si el escenario se regeneró entre medias, avisa en vez de mezclar", async () => {
    store.set("scheduling_roster/p1", { generatedAt: "g2", parts: 1, moves: [] });
    await expect(saveShiftMoves("p1", { generatedAt: "g1", parts: 1, shifts: [] }, new Map(), [])).rejects.toThrow(/vuelto a generar/);
  });
});
