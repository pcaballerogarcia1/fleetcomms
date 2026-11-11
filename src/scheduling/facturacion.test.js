import { describe, expect, it } from "vitest";
import { facturacionEscenario, margen, precioUnicoDeTrabajo } from "./facturacion.js";

const parada = (lat, lng) => ({ lat, lng });
const vehiculos = [
  { assignments: [parada(40, -3), { _travel: true, lat: 40, lng: -3 }, parada(41, -3), { _break: true }] },
  { assignments: [parada(42, -3)] },
];

describe("margen del escenario", () => {
  it("factura cada parada asignada con su precio, o el de por defecto; no cuenta trayectos ni pausas", () => {
    const precios = { defaultPrecio: 10, byKey: new Map([["40.00000_-3.00000", 25]]) };
    expect(facturacionEscenario(vehiculos, precios)).toEqual({ total: 45, conPrecio: 3, sinPrecio: 0 });
  });
  it("sin precio de punto ni por defecto: el del único trabajo con precio; si no, cuenta las que faltan", () => {
    const precios = { defaultPrecio: null, byKey: new Map(), porTrabajo: { t1: 12 } };
    expect(precioUnicoDeTrabajo([{ id: "t1" }, { id: "t2" }], precios)).toBe(12);
    expect(facturacionEscenario(vehiculos, precios, 12).total).toBe(36);
    expect(facturacionEscenario(vehiculos, precios, null)).toEqual({ total: 0, conPrecio: 0, sinPrecio: 3 });
    expect(precioUnicoDeTrabajo([{ id: "t1" }, { id: "t2" }], { porTrabajo: { t1: 1, t2: 2 } })).toBeNull();
  });
  it("margen = (facturación − coste) / facturación", () => {
    expect(margen(1000, 650)).toBeCloseTo(0.35);
    expect(margen(1000, 1200)).toBeCloseTo(-0.2);
    expect(margen(0, 10)).toBeNull();
    expect(margen(1000, null)).toBeNull();
  });
});
