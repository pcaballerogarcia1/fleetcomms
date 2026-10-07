import { describe, it, expect, vi, beforeEach } from "vitest";

const actualizados = [];
let docs = [];
vi.mock("./firebase.js", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(), query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: docs.map(([id, data]) => ({ id, ref: id, data: () => data })) })),
  writeBatch: () => ({ update: (ref, cambio) => actualizados.push([ref, cambio]), commit: async () => {} }),
}));
const almacen = {};
globalThis.localStorage = { getItem: k => almacen[k] ?? null, setItem: (k, v) => { almacen[k] = v; } };
const { repararPlanesSinConductor, CLAVE_HECHO } = await import("./reparar-planes.js");

describe("arreglo automático de planes antiguos", () => {
  beforeEach(() => { actualizados.length = 0; for (const k in almacen) delete almacen[k]; });

  it("pone conductorUid: null solo a los planes que no tienen el campo", async () => {
    docs = [["viejo", { org_id: "a" }], ["suyo", { org_id: "a", conductorUid: "u1" }], ["compartido", { org_id: "a", conductorUid: null }]];
    expect(await repararPlanesSinConductor({ org_id: "a", rol: "admin" })).toBe(1);
    expect(actualizados).toEqual([["viejo", { conductorUid: null }]]);
    expect(almacen[CLAVE_HECHO + "a"]).toBe("1");
  });

  it("una vez hecho en esta organización no vuelve a leer", async () => {
    docs = [["viejo", { org_id: "a" }]];
    await repararPlanesSinConductor({ org_id: "a", rol: "admin" });
    actualizados.length = 0;
    expect(await repararPlanesSinConductor({ org_id: "a", rol: "admin" })).toBe(0);
    expect(actualizados).toEqual([]);
  });

  it("los conductores no lo hacen (lo hace quien gestiona rutas)", async () => {
    docs = [["viejo", { org_id: "a" }]];
    expect(await repararPlanesSinConductor({ org_id: "a", rol: "conductor" })).toBe(0);
    expect(await repararPlanesSinConductor(null)).toBe(0);
    expect(actualizados).toEqual([]);
  });
});
