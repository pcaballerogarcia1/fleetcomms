import { describe, it, expect, vi } from "vitest";
vi.mock("./firebase.js", () => ({ db: {} }));
import { colorearRed } from "./lineas-store.js";

const linea = (id, nombre, color) => ({ id, nombre, color, sentidos: [] });

describe("color de las líneas", () => {
  it("si el GTFS pone a todas el mismo color, cada línea uno distinto (las variantes, el mismo)", () => {
    const red = { lineas: [linea("a", "480", "#8ebf42"), linea("b", "481", "#8ebf42"), linea("c", "482", "#8ebf42"), linea("d", "480", "#8ebf42")] };
    const r = colorearRed(red).lineas;
    expect(new Set(r.map(l => l.color)).size).toBe(3);
    expect(r[0].color).toBe(r[3].color);
  });
  it("si el GTFS trae colores distintos, se respetan", () => {
    const red = { lineas: [linea("a", "1", "#ff0000"), linea("b", "2", "#00ff00"), linea("c", "3", "#0000ff")] };
    expect(colorearRed(red).lineas.map(l => l.color)).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
  });
  it("el color elegido a mano manda", () => {
    const red = { lineas: [linea("a", "1", "#ff0000"), linea("b", "2", "#00ff00")] };
    expect(colorearRed(red, { b: "#123456" }).lineas.map(l => l.color)).toEqual(["#ff0000", "#123456"]);
  });
});

import { textoEstable } from "./lineas-scheduling/comun.js";
describe("configuración de líneas comparada sin importar el orden", () => {
  it("el mismo contenido con los campos en otro orden da el mismo texto (si no, el Scheduling recalculaba sin parar)", () => {
    const a = { "484": { color: "#f00", salidas: [1, 2] }, _flota: { lista: [{ id: 1, km: 200 }] } };
    const b = { _flota: { lista: [{ km: 200, id: 1 }] }, "484": { salidas: [1, 2], color: "#f00" } };
    expect(textoEstable(a)).toBe(textoEstable(b));
    expect(textoEstable({ x: 1 })).not.toBe(textoEstable({ x: 2 }));
    expect(textoEstable({ x: undefined, y: null })).toBe(textoEstable({ y: null }));
  });
});
