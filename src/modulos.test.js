import { describe, expect, it } from "vitest";
import { TODAS, empresaSuspendida, moduloActivo, moduloDeRuta, modulosParaGuardar, primeraRuta } from "./modulos.js";
import { aJson } from "./superadmin/borrar-empresa.js";
import { haceCuanto } from "./superadmin/uso.js";
import { Bytes, Timestamp } from "firebase/firestore";

describe("módulos de cada empresa", () => {
  it("lo que no está apuntado está encendido (las empresas de antes siguen igual)", () => {
    expect(moduloActivo({}, "ia")).toBe(true);
    expect(moduloActivo(null, "control")).toBe(true);
    expect(moduloActivo({ modulos: { ia: false } }, "ia")).toBe(false);
    expect(moduloActivo({ modulos: { ia: false } }, null)).toBe(true); // pantallas que no son de un módulo
  });
  it("suspendida solo si se marcó así", () => {
    expect(empresaSuspendida({ activo: false })).toBe(true);
    expect(empresaSuspendida({})).toBe(false);
    expect(empresaSuspendida(null)).toBe(false);
  });
  it("cada pantalla con su módulo, y la primera que tenga", () => {
    expect(moduloDeRuta("/control")).toBe("control");
    expect(moduloDeRuta("/projects")).toBeNull();
    expect(primeraRuta({ modulos: { planning: false } })).toBe("/scheduling");
    expect(primeraRuta({})).toBe("/planning");
    expect(primeraRuta({ modulos: Object.fromEntries(TODAS.map(m => [m.clave, false])) })).toBe("/projects");
  });
  it("se guardan todas las claves", () => {
    const g = modulosParaGuardar({ ia: false });
    expect(Object.keys(g)).toHaveLength(TODAS.length);
    expect(g.ia).toBe(false);
    expect(g.control).toBe(true);
  });
});

describe("copia antes de borrar una empresa", () => {
  it("fechas y datos binarios se guardan en JSON y se pueden recuperar", () => {
    const t = Timestamp.fromDate(new Date("2026-11-11T10:00:00Z"));
    expect(aJson({ a: t, b: [Bytes.fromUint8Array(new Uint8Array([1, 2, 3]))], c: { d: 1 } })).toEqual({ a: { __fecha: "2026-11-11T10:00:00.000Z" }, b: [{ __bytes: "AQID" }], c: { d: 1 } });
  });
  it("hace cuánto", () => {
    const ahora = Date.parse("2026-11-11T12:00:00Z");
    expect(haceCuanto(null, ahora)).toBe("nunca");
    expect(haceCuanto(ahora - 30 * 60000, ahora)).toBe("hace 30 min");
    expect(haceCuanto(ahora - 26 * 3600000, ahora)).toBe("ayer");
  });
});
