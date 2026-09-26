import { describe, it, expect, vi, beforeEach } from "vitest";

const added = [];
vi.mock("./firebase.js", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: (_db, name) => name,
  addDoc: async (col, data) => { added.push([col, data]); return { id: "x" }; },
  serverTimestamp: () => "ts",
  onSnapshot: vi.fn(), query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
}));
const { setAuditUser, setAuditProject, logAudit, logAuditGrouped, flushAuditGroup, addCells } = await import("./audit.js");

describe("historial de cambios", () => {
  beforeEach(() => { added.length = 0; setAuditUser(null); setAuditProject(null); });

  it("registra quién, qué y en qué proyecto", async () => {
    setAuditUser({ uid: "u1", org_id: "org1", nombre: "Tania", apellidos: "Roldán", rol: "admin" });
    setAuditProject({ _id: "p1", nombre: "Madrid", org_id: "org1" });
    await logAudit({ modulo: "Scheduling", accion: "Generó un escenario", detalle: "3 vehículos" });
    expect(added).toHaveLength(1);
    expect(added[0][0]).toBe("auditoria");
    expect(added[0][1]).toMatchObject({
      org_id: "org1", uid: "u1", nombre: "Tania Roldán", rol: "admin",
      modulo: "Scheduling", accion: "Generó un escenario", detalle: "3 vehículos",
      projectId: "p1", proyecto: "Madrid", at: "ts",
    });
    expect(typeof added[0][1].atMs).toBe("number");
  });

  it("sin sesión no registra; projectId:null = acción de toda la organización", async () => {
    await logAudit({ modulo: "Flota", accion: "Eliminó un vehículo" });
    expect(added).toHaveLength(0);
    setAuditUser({ uid: "u1", org_id: "org1", nombre: "Ana" });
    setAuditProject({ _id: "p1", nombre: "Madrid" });
    await logAudit({ modulo: "Flota", accion: "Eliminó un vehículo", projectId: null });
    expect(added[0][1]).toMatchObject({ projectId: null, proyecto: null });
  });

  it("superadmin sin organización: usa la del proyecto abierto", async () => {
    setAuditUser({ uid: "sa", org_id: null, nombre: "Super", rol: "superadmin" });
    setAuditProject({ _id: "p9", nombre: "Palma", org_id: "orgP" });
    await logAudit({ modulo: "Scheduling", accion: "Generó un escenario" });
    expect(added[0][1].org_id).toBe("orgP");
  });

  it("las ediciones seguidas se agrupan en una sola línea", async () => {
    setAuditUser({ uid: "u1", org_id: "org1", nombre: "Ana" });
    const entry = { modulo: "Rostering", accion: "Editó el cuadrante", projectId: null };
    const describe = acc => `${acc.cells.size} casilla(s) de ${acc.rows.size} trabajador(es)`;
    logAuditGrouped("k", entry, addCells([["w1", 1], ["w1", 2]]), describe);
    logAuditGrouped("k", entry, addCells([["w1", 2], ["w2", 5]]), describe);
    expect(added).toHaveLength(0); // aún no (espera 60 s sin cambios)
    flushAuditGroup("k");
    await Promise.resolve();
    expect(added).toHaveLength(1);
    expect(added[0][1].detalle).toBe("3 casilla(s) de 2 trabajador(es)");
  });
});
