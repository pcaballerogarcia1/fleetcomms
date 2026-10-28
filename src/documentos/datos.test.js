import { describe, it, expect } from "vitest";
import { estadoLectura, juntar, leidoAlDia, misDocumentos, problemaDocumento, trocear } from "./datos.js";

describe("documentos para los trabajadores", () => {
  it("trocea y junta el archivo sin perder nada", () => {
    const b = new Uint8Array(2500).map((_, i) => i % 251);
    const t = trocear(b, 1000);
    expect(t.map(x => x.length)).toEqual([1000, 1000, 500]);
    expect(juntar(t)).toEqual(b);
  });

  it("una lectura de una versión anterior no vale", () => {
    expect(leidoAlDia({ version: 2 }, { version: 1 })).toBe(false);
    expect(leidoAlDia({ version: 2 }, { version: 2 })).toBe(true);
    expect(leidoAlDia({ version: 1 }, null)).toBe(false);
  });

  const usuarios = [
    { _id: "u1", nombre: "Ana", rol: "conductor" }, { _id: "u2", nombre: "Luis", rol: "conductor" },
    { _id: "u3", nombre: "Jefa", rol: "intermedio" }, { _id: "a", nombre: "Admin", rol: "admin" },
  ];

  it("quién lo ha leído y quién no", () => {
    const d = { id: "d1", activo: true, paraTodos: true, version: 2 };
    const r = estadoLectura(d, usuarios, [{ docId: "d1", uid: "u1", version: 2, leidoAt: 5 }, { docId: "d1", uid: "u2", version: 1 }]);
    expect(r.total).toBe(3); // la app: conductores e intermedios
    expect(r.leidos.map(u => u._id)).toEqual(["u1"]);
    expect(r.pendientes.map(u => u._id)).toEqual(["u2", "u3"]);
    const solo = estadoLectura({ id: "d2", activo: true, paraTodos: false, paraUids: ["u2"], version: 1 }, usuarios, []);
    expect(solo.pendientes.map(u => u._id)).toEqual(["u2"]);
  });

  it("cada trabajador ve los suyos, primero los que tiene sin leer", () => {
    const docs = [
      { id: "a", activo: true, paraTodos: true, version: 1, subidoAt: 1 },
      { id: "b", activo: true, paraTodos: false, paraUids: ["u1"], version: 1, subidoAt: 2 },
      { id: "c", activo: true, paraTodos: false, paraUids: ["u2"], version: 1, subidoAt: 3 },
      { id: "d", activo: false, paraTodos: true, version: 1, subidoAt: 4 },
    ];
    const m = misDocumentos(docs, [{ docId: "b", uid: "u1", version: 1 }], "u1");
    expect(m.map(d => [d.id, d.leido])).toEqual([["a", false], ["b", true]]);
  });

  it("comprueba lo que se sube", () => {
    const pdf = { name: "it.pdf", type: "application/pdf", size: 1000 };
    expect(problemaDocumento({ titulo: "IT-01", categoria: "IT", archivo: pdf, paraTodos: true })).toBeNull();
    expect(problemaDocumento({ titulo: "", categoria: "IT", archivo: pdf, paraTodos: true })).toMatch(/título/);
    expect(problemaDocumento({ titulo: "x", categoria: "IT", archivo: { ...pdf, size: 11e6 }, paraTodos: true })).toMatch(/10 MB/);
    expect(problemaDocumento({ titulo: "x", categoria: "IT", archivo: { name: "a.docx", type: "x" }, paraTodos: true })).toMatch(/PDF/);
    expect(problemaDocumento({ titulo: "x", categoria: "IT", archivo: pdf, paraTodos: false, paraUids: [] })).toMatch(/quién/);
  });
});
