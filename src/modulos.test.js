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

describe("tiempo de uso", async () => {
  const { cuentaMinuto, sumaDeUso, INACTIVO_MS } = await import("./uso-tiempo.js");
  const { horas } = await import("./superadmin/uso.js");
  it("cuenta solo con la pantalla a la vista; en la oficina, además, con uso reciente", () => {
    const ahora = 1_000_000_000;
    expect(cuentaMinuto({ visible: false, app: "app", ahora, ultimaActividad: ahora })).toBe(false);
    expect(cuentaMinuto({ visible: true, app: "app", ahora, ultimaActividad: 0 })).toBe(true);
    expect(cuentaMinuto({ visible: true, app: "oficina", ahora, ultimaActividad: ahora - 60_000 })).toBe(true);
    expect(cuentaMinuto({ visible: true, app: "oficina", ahora, ultimaActividad: ahora - INACTIVO_MS - 1 })).toBe(false);
  });
  it("una ficha por persona y mes, con el día y dónde", () => {
    const { id, datos } = sumaDeUso({ uid: "u1", org_id: "o1", nombre: "Ana", apellidos: "Gil", rol: "admin" }, "oficina", 5, new Date(2026, 10, 11, 10));
    expect(id).toBe("o1_u1_2026-11");
    expect(datos).toMatchObject({ org_id: "o1", uid: "u1", mes: "2026-11", nombre: "Ana Gil", rol: "admin" });
    expect(Object.keys(datos.dias)).toEqual(["11"]);
    expect(datos).toHaveProperty("oficina");
  });
  it("horas en palabras", () => {
    expect(horas(0)).toBe("—");
    expect(horas(45)).toBe("45 min");
    expect(horas(135)).toBe("2 h 15 min");
    expect(horas(120)).toBe("2 h");
  });
});

describe("logo de la empresa", async () => {
  const { medidaLogo } = await import("./logo-empresa.js");
  it("se reduce sin deformarse y sin agrandarse", () => {
    expect(medidaLogo(2000, 500)).toEqual({ ancho: 480, alto: 120 });
    expect(medidaLogo(600, 600)).toEqual({ ancho: 120, alto: 120 });
    expect(medidaLogo(200, 50)).toEqual({ ancho: 200, alto: 50 });
    expect(() => medidaLogo(0, 10)).toThrow();
  });
});

describe("la empresa de un org_id", async () => {
  const { empresaDe } = await import("./modulos.js");
  it("el espacio de un concurso es de su empresa", () => {
    expect(empresaDe("demo--c-abc123")).toBe("demo");
    expect(empresaDe("demo")).toBe("demo");
    expect(empresaDe(null)).toBeNull();
  });
});
