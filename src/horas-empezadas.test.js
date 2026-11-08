// Volver a publicar: a una ruta ya empezada solo se le añade la hora prevista de sus paradas.
import { describe, expect, it } from "vitest";
import { conHorasPrevistas } from "./publicar-rutas.js";

describe("hora prevista en rutas ya empezadas", () => {
  it("rellena solo la hora que falta, sin tocar lo hecho ni el orden", () => {
    const viejas = [
      { id: "u0", pa: "PA1", lat: 39.5, lng: 2.7, realizado: true, realizadoEn: 5, nota: "ok" },
      { id: "u1", pa: "PA2", lat: 39.51, lng: 2.71, realizado: false },
      { id: "u2", pa: "PA3", lat: 39.52, lng: 2.72, realizado: false, horaPlan: 700 }, // ya la tenía
      { id: "u3", pa: "PA9", lat: 39.6, lng: 2.8, realizado: false }, // ya no está en la ruta nueva
    ];
    const nuevas = [
      { pa: "PA2", lat: 39.51, lng: 2.71, horaPlan: 610 },
      { pa: "PA1", lat: 39.5, lng: 2.7, horaPlan: 600 },
      { pa: "PA3", lat: 39.52, lng: 2.72, horaPlan: 620 },
    ];
    const r = conHorasPrevistas(viejas, nuevas);
    expect(r.puestas).toBe(2);
    expect(r.ubicaciones.map(u => [u.id, u.horaPlan])).toEqual([["u0", 600], ["u1", 610], ["u2", 700], ["u3", undefined]]);
    expect(r.ubicaciones[0]).toMatchObject({ realizado: true, realizadoEn: 5, nota: "ok" });
  });
  it("varias paradas en el mismo punto (contenedores): por orden", () => {
    const p = { pa: "PA1", lat: 39.5, lng: 2.7 };
    const r = conHorasPrevistas([{ ...p, id: "a" }, { ...p, id: "b" }], [{ ...p, horaPlan: 600 }, { ...p, horaPlan: 602 }]);
    expect(r.ubicaciones.map(u => u.horaPlan)).toEqual([600, 602]);
  });
});
