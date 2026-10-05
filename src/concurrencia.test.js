import { describe, it, expect, vi } from "vitest";
vi.mock("./firebase.js", () => ({ db: {} }));
import { parcheDe, aplicarEnLista } from "./concurrencia.js";

const union = (...xs) => ({ union: xs });

describe("parcheDe: solo lo que ha cambiado", () => {
  it("no escribe los campos iguales ni el _id", () => {
    expect(parcheDe({ _id: "a", estado: "abierta", titulo: "T" }, { _id: "a", estado: "cerrada", titulo: "T" }, union)).toEqual({ estado: "cerrada" });
    expect(parcheDe({ a: 1 }, { a: 1 }, union)).toEqual({});
  });
  it("una lista a la que solo se añade al final se escribe como «añadir» (no pisa lo de otros)", () => {
    const c1 = { texto: "uno" }, c2 = { texto: "dos" };
    expect(parcheDe({ comentarios: [c1] }, { comentarios: [c1, c2] }, union)).toEqual({ comentarios: { union: [c2] } });
    expect(parcheDe({}, { comentarios: [c1] }, union)).toEqual({ comentarios: [c1] });
  });
  it("si la lista cambia por dentro se escribe entera", () => {
    expect(parcheDe({ l: [1, 2] }, { l: [1, 3] }, union)).toEqual({ l: [1, 3] });
    expect(parcheDe({ l: [1, 2] }, { l: [1] }, union)).toEqual({ l: [1] });
  });
});

describe("aplicarEnLista: cambiar una parada sobre la versión del servidor", () => {
  it("cambia solo la parada indicada y conserva lo que otro marcó en las demás", () => {
    // en el servidor, otra persona ya marcó la parada 2
    const servidor = [{ id: 1, realizado: false }, { id: 2, realizado: true }];
    const marcar1 = u => ({ ...u, realizado: true });
    expect(aplicarEnLista(servidor, 1, marcar1)).toEqual([{ id: 1, realizado: true }, { id: 2, realizado: true }]);
    expect(aplicarEnLista(servidor, 9, marcar1)).toEqual(servidor);
  });
});
