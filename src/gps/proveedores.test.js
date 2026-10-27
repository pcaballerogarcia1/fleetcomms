import { describe, it, expect, vi } from "vitest";
vi.mock("../firebase.js", () => ({ auth: {}, db: {} }));
import { emparejarGps, proveedorGps } from "./proveedores.js";

describe("emparejar los vehículos del GPS con la flota", () => {
  const flota = [{ _id: "v1", nombre: "Camión 1", matricula: "1234 ABC" }, { _id: "v2", nombre: "Bus 7", matricula: "" }];
  it("por matrícula (sin espacios ni guiones), por nombre o a mano", () => {
    const m = emparejarGps([{ id: "a", matricula: "1234-abc" }, { id: "b", nombre: "BUS 7" }, { id: "c", nombre: "X" }, { id: "d", nombre: "Camión 1" }], flota, { c: "v2", d: "" });
    expect(m.get("a")._id).toBe("v1");
    expect(m.get("b")._id).toBe("v2");
    expect(m.get("c")._id).toBe("v2");
    expect(m.get("d")).toBeNull();
  });
  it("Movildata usa el traductor genérico", () => {
    expect(proveedorGps("movildata").tipo).toBe("generico");
  });
});
