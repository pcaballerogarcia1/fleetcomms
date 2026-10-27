import { describe, it, expect } from "vitest";
import { posiciones, urlPermitida, GpsError, campo } from "./proveedores.js";

const resp = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

describe("GPS: cada proveedor al mismo formato", () => {
  it("Webfleet: millonésimas de grado y cuentakilómetros en 100 m", async () => {
    let url = "";
    const fetchFn = async u => { url = u; return resp([{ objectno: "001", objectname: "Camión 1", latitude_mdeg: 40416775, longitude_mdeg: -3703790, speed: 42, course: 90, pos_time: "2026-10-27T08:00:00+01:00", odometer: 1234567 }]); };
    const [v] = await posiciones("webfleet", { cuenta: "a", usuario: "u", clave: "c", apikey: "k" }, fetchFn);
    expect(url).toContain("action=showObjectReportExtern");
    expect(v).toMatchObject({ id: "001", nombre: "Camión 1", lat: 40.416775, lng: -3.70379, velocidad: 42, odometroKm: 123456.7 });
    expect(v.hora).toBe(Date.parse("2026-10-27T08:00:00+01:00"));
  });

  it("Webfleet: error de usuario o clave", async () => {
    await expect(posiciones("webfleet", { cuenta: "a", usuario: "u", clave: "mal" }, async () => resp({ errorCode: 8011, errorMsg: "authentication failed" })))
      .rejects.toMatchObject({ status: 401 });
  });

  it("Geotab: entra, va a su servidor y junta posición y nombre", async () => {
    const llamadas = [];
    const fetchFn = async (u, o) => {
      const b = JSON.parse(o.body); llamadas.push([u, b.method]);
      if (b.method === "Authenticate") return resp({ result: { credentials: { sessionId: "s" }, path: "my3.geotab.com" } });
      return resp({ result: [[{ device: { id: "b1" }, latitude: 41.38, longitude: 2.17, speed: 30, bearing: 10, dateTime: "2026-10-27T07:00:00Z" }], [{ id: "b1", name: "Bus 7", licensePlate: "1234ABC" }]] });
    };
    const [v] = await posiciones("geotab", { base: "empresa", usuario: "u", clave: "c" }, fetchFn);
    expect(llamadas).toEqual([["https://my.geotab.com/apiv1", "Authenticate"], ["https://my3.geotab.com/apiv1", "ExecuteMultiCall"]]);
    expect(v).toMatchObject({ id: "b1", nombre: "Bus 7", matricula: "1234ABC", lat: 41.38, lng: 2.17, velocidad: 30 });
  });

  it("Samsara: millas a km y varias páginas", async () => {
    let n = 0;
    const fetchFn = async (u, o) => {
      expect(o.headers.Authorization).toBe("Bearer t");
      n++;
      return n === 1
        ? resp({ data: [{ id: "1", name: "V1", gps: { latitude: 39.5, longitude: 2.6, speedMilesPerHour: 10, time: "2026-10-27T07:00:00Z" }, obdOdometerMeters: { value: 150000 } }], pagination: { hasNextPage: true, endCursor: "x" } })
        : resp({ data: [{ id: "2", name: "V2", gps: { latitude: 39.6, longitude: 2.7 } }], pagination: { hasNextPage: false } });
    };
    const vs = await posiciones("samsara", { token: "t" }, fetchFn);
    expect(vs.map(v => v.id)).toEqual(["1", "2"]);
    expect(vs[0]).toMatchObject({ velocidad: 16, odometroKm: 150 });
  });

  it("genérico: dónde está cada dato", async () => {
    const fetchFn = async (u, o) => { expect(o.headers["X-Api-Key"]).toBe("abc"); return resp({ data: { flota: [{ cod: "M-1", pos: { la: "39.1", lo: "2.2" }, t: 1761552000 }, { cod: "sin-posicion" }] } }); };
    const vs = await posiciones("generico", { url: "https://api.ejemplo.es/flota", cabecera: "X-Api-Key: abc", lista: "data.flota", campos: { id: "cod", lat: "pos.la", lng: "pos.lo", hora: "t" } }, fetchFn);
    expect(vs).toEqual([{ id: "M-1", nombre: "M-1", matricula: "", lat: 39.1, lng: 2.2, velocidad: null, rumbo: null, hora: 1761552000000, odometroKm: null }]);
  });

  it("no deja llamar a la red interna ni sin https", () => {
    for (const u of ["http://api.x.es", "https://localhost/a", "https://10.0.0.1/a", "https://192.168.1.2/", "https://169.254.169.254/latest", "https://intranet/x", "https://[::1]/"]) expect(urlPermitida(u)).toBe(false);
    expect(urlPermitida("https://api.movildata.com/v1/posiciones")).toBe(true);
  });

  it("pide lo que falta y no conoce otros proveedores", async () => {
    await expect(posiciones("geotab", { usuario: "u" })).rejects.toThrow(/Falta: base, clave/);
    await expect(posiciones("otro", {})).rejects.toBeInstanceOf(GpsError);
    expect(campo({ a: [{ b: 1 }] }, "a.0.b")).toBe(1);
  });
});
