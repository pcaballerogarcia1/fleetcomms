import { describe, it, expect, vi } from "vitest";
vi.mock("./firebase.js", () => ({ db: {} }));
import { crearCola, camposCambiados, aplicarCambios } from "./conductor/cola.js";

const almacen = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };
const esperar = () => new Promise(r => setTimeout(r, 10));

describe("cola de cambios sin cobertura", () => {
  it("solo guarda lo que cambia y lo aplica en orden", () => {
    expect(camposCambiados({ id: 1, realizado: false, nota: "" }, { id: 1, realizado: true, nota: "" })).toEqual({ realizado: true });
    const l = aplicarCambios([{ id: 1, realizado: false }, { id: 2, realizado: false }], [{ ubicId: 1, campos: { realizado: true } }, { ubicId: "2", campos: { nota: "x" } }, { ubicId: 1, campos: { realizado: false } }]);
    expect(l).toEqual([{ id: 1, realizado: false }, { id: 2, realizado: false, nota: "x" }]);
  });

  it("sin red los cambios esperan en el móvil (y sobreviven a cerrar la app); con red se envían en orden", async () => {
    const al = almacen();
    let red = false;
    const enviados = [];
    const enviar = vi.fn(async op => { if (!red) throw new Error("offline"); enviados.push(op.ubicId); });
    const cola = crearCola("u1", { almacen: al, enviar, enLinea: () => red });
    cola.encolar("p1", 1, { realizado: true });
    cola.encolar("p1", 2, { realizado: true });
    cola.encolar("p2", 9, { realizado: true });
    await esperar();
    expect(cola.estado()).toMatchObject({ pendientes: 3, enLinea: false });
    expect(cola.pendientesDe("p1").map(o => o.ubicId)).toEqual([1, 2]);
    // «se cierra la app»: otra cola con el mismo almacén los recupera
    const otra = crearCola("u1", { almacen: al, enviar, enLinea: () => red });
    expect(otra.estado().pendientes).toBe(3);
    red = true;
    await otra.intentar();
    expect(enviados).toEqual([1, 2, 9]);
    expect(otra.estado().pendientes).toBe(0);
    // lo recién enviado se sigue pintando un momento (hasta que llega del servidor)
    expect(otra.pendientesDe("p1")).toHaveLength(2);
    expect(JSON.parse(al.getItem("operanzia_cola_paradas_u1"))).toEqual([]);
  });

  it("si falla a medias, se para y no se salta ninguno; uno imposible (plan borrado) se descarta con aviso", async () => {
    let fallar = true;
    const enviados = [];
    const enviar = async op => {
      if (op.ubicId === 2 && fallar) throw new Error("se fue la cobertura");
      if (op.ubicId === 3) throw Object.assign(new Error("no"), { code: "not-found" });
      enviados.push(op.ubicId);
    };
    const cola = crearCola("u2", { almacen: almacen(), enviar, enLinea: () => true });
    ["1", "2", "3", "4"].forEach(i => cola.encolar("p", +i, { realizado: true }));
    await esperar();
    expect(enviados).toEqual([1]);
    expect(cola.estado().pendientes).toBe(3);
    fallar = false;
    await cola.intentar();
    expect(enviados).toEqual([1, 2, 4]);
    expect(cola.estado()).toMatchObject({ pendientes: 0 });
    expect(cola.estado().ultimoError).toMatch(/ya no existe/);
  });
});
