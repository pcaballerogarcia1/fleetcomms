import { describe, expect, it } from "vitest";
import { kmDeTransportes } from "./distancias.js";

// CartoCiudad y OSRM de mentira: sitios con el mismo nombre en otra provincia, y una EDAR que solo sale por la dirección
const SITIOS = {
  "Salto del Negro": [{ id: "1", type: "poblacion", address: "Salto del Negro (Cútar)", lat: 36.84, lng: -4.21 }, { id: "2", type: "poblacion", address: "Salto del Negro (Las Palmas de Gran Canaria)", lat: 28.06, lng: -15.43 }],
  "EDAR Arguineguín": [{ id: "3", type: "toponimo", address: "EDAR Arguineguin (San Bartolomé de Tirajana)", lat: 27.77, lng: -15.66 }],
  "EDAR La Aldea": [{ id: "4", type: "toponimo", address: "EDAR Aldea del Fresno", lat: 40.3, lng: -4.23 }],
  "Calle Las Marciégas 2, San Nicolás de Tolentino": [{ id: "5", type: "portal", address: "CALLE LA MARCIEGA 1 (La Aldea de San Nicolás)", lat: 27.995, lng: -15.808 }],
};
const fetchFn = async url => {
  const u = new URL(url);
  if (u.hostname.includes("osrm")) return { json: async () => ({ routes: [{ distance: 61234, duration: 3000 }] }) };
  const q = u.searchParams.get("q");
  return { json: async () => SITIOS[q] || [], text: async () => "{}" };
};

describe("km de los transportes", () => {
  it("elige el destino de la isla, no el de otra provincia; la dirección cuando el nombre no sirve", async () => {
    const r = await kmDeTransportes([{ nombre: "EDAR Arguineguín" }, { nombre: "EDAR La Aldea", direccion: "C/ Las Marciégas no2", municipio: "San Nicolás de Tolentino" }], "Salto del Negro", { fetchFn });
    expect(r.destino.texto).toMatch(/Las Palmas/);
    expect(r.rutas[0]).toMatchObject({ km: 61.2, minutos: 50, metodo: "nombre" });
    expect(r.rutas[1]).toMatchObject({ metodo: "dirección", desde: expect.stringMatching(/MARCIEGA/) });
  });
  it("lo que no encuentra lo dice (para ponerlo a mano)", async () => {
    const r = await kmDeTransportes([{ nombre: "EDAR Inventada" }], "Salto del Negro", { fetchFn });
    expect(r.rutas[0].error).toMatch(/No encuentro/);
  });
});
