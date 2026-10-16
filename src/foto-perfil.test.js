import { describe, expect, it, vi } from "vitest";
vi.mock("./firebase.js", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({ doc: () => ({}), updateDoc: async () => {} }));
const { recorteCuadrado } = await import("./foto-perfil.js");

describe("foto de perfil", () => {
  it("se recorta el cuadrado del centro", () => {
    expect(recorteCuadrado(400, 300)).toEqual({ sx: 50, sy: 0, lado: 300 });
    expect(recorteCuadrado(300, 500)).toEqual({ sx: 0, sy: 100, lado: 300 });
  });
});
