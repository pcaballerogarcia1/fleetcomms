import { describe, it, expect, vi, beforeEach } from "vitest";

const added = [];
vi.mock("./firebase.js", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: (_db, n) => n,
  addDoc: async (col, data) => { added.push([col, data]); return {}; },
  serverTimestamp: () => "ts",
  onSnapshot: vi.fn(), query: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
}));
const { reportError, setErrorUser, errorKey, groupErrors, MAX_POR_SESION } = await import("./error-report.js");

describe("aviso de errores", () => {
  beforeEach(() => { added.length = 0; });

  it("sin sesión no se envía nada (las reglas lo rechazarían)", () => {
    setErrorUser(null);
    expect(reportError({ mensaje: "boom" })).toBe(false);
    expect(added).toHaveLength(0);
  });

  it("un mismo error se envía una sola vez por sesión, aunque cambien números y horas", () => {
    setErrorUser({ uid: "u1", org_id: "orgA", nombre: "Ana", rol: "admin" });
    expect(reportError({ mensaje: "Fallo al cargar el plan 1234 2026-09-26T10:00:00.000Z" })).toBe(true);
    expect(reportError({ mensaje: "Fallo al cargar el plan 5678 2026-09-26T11:22:33.000Z" })).toBe(false);
    expect(added).toHaveLength(1);
    expect(added[0][0]).toBe("errores");
    expect(added[0][1]).toMatchObject({ org_id: "orgA", uid: "u1", nombre: "Ana", mensaje: expect.stringContaining("Fallo al cargar") });
  });

  it(`como mucho ${MAX_POR_SESION} errores por pestaña`, () => {
    setErrorUser({ uid: "u2", org_id: "orgA", nombre: "Bea" });
    for (let i = 0; i < MAX_POR_SESION + 10; i++) reportError({ mensaje: `error distinto ${String.fromCharCode(65 + (i % 26))}${"x".repeat(i)}` });
    expect(added.length).toBeLessThanOrEqual(MAX_POR_SESION);
  });

  it("agrupa los iguales de varios usuarios para el superadmin", () => {
    const g = groupErrors([
      { mensaje: "permission-denied en 3", nombre: "Ana", pagina: "/rostering", atMs: 10 },
      { mensaje: "permission-denied en 7", nombre: "Bea", pagina: "/scheduling", atMs: 20 },
      { mensaje: "otro", nombre: "Ana", atMs: 5 },
    ]);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ veces: 2, ultimo: 20 });
    expect(g[0].usuarios.size).toBe(2);
    expect(errorKey("a 1", "at f (x.js:1:2)")).toBe(errorKey("a 2", "at f (x.js:9:9)"));
  });
});
