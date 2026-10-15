import { describe, expect, it, vi } from "vitest";
vi.mock("./firebase.js", () => ({ db: {} }));
import { comprobarLugarFichaje, depotMasCercano, listaLugares, lugaresDeProyecto } from "./fichaje-depots.js";

describe("fichar cerca de un depot", () => {
  const lugares = listaLugares({ p1: lugaresDeProyecto([{ id: "a", nombre: "Cochera Norte", lat: 40.45, lng: -3.69 }, { id: "pl", nombre: "Planta", lat: 40.40, lng: -3.70, planta: true }]), p2: { b: { nombre: "Cochera Sur", lat: 40.35, lng: -3.70 } } });
  const gps = (lat, lng) => { vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: ok => ok({ coords: { latitude: lat, longitude: lng, accuracy: 12 } }) } }); };

  it("las plantas de descarga no cuentan", () => {
    expect(lugares.map(l => l.nombre).sort()).toEqual(["Cochera Norte", "Cochera Sur"]);
  });
  it("elige el depot más cercano", () => {
    expect(depotMasCercano(lugares, 40.351, -3.70).lugar.nombre).toBe("Cochera Sur");
  });
  it("a menos de 1 km deja fichar y guarda dónde", async () => {
    gps(40.454, -3.695);
    const { lugar } = await comprobarLugarFichaje(lugares);
    expect(lugar).toMatchObject({ p: "p1", d: "a", nombre: "Cochera Norte", precision: 12 });
    expect(lugar.distanciaM).toBeLessThan(1000);
  });
  it("lejos no deja y dice a cuánto está", async () => {
    gps(40.40, -3.70); // en la planta: 5,6 km de Cochera Sur y Norte
    await expect(comprobarLugarFichaje(lugares)).rejects.toThrow(/Estás a 5,\d km de Cochera/);
  });
  it("sin depots en la empresa se ficha como siempre", async () => {
    expect(await comprobarLugarFichaje([])).toEqual({ lugar: null });
  });
  it("sin permiso de ubicación avisa", async () => {
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: (_, mal) => mal({ code: 1 }) } });
    await expect(comprobarLugarFichaje(lugares)).rejects.toThrow(/permiso de ubicación/);
  });
});
