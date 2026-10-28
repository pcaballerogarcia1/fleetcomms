import { describe, it, expect } from "vitest";
import { capaDetalle, capaFondo, opcionesMapa } from "./mapa-fondo.js";

describe("fondo de los mapas", () => {
  const L = { tileLayer: (url, o) => ({ url, o }) };
  it("cada proveedor hasta su zoom real, ampliando después", () => {
    expect(capaFondo(L, "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}").o).toMatchObject({ maxZoom: 16, attribution: "© Esri" });
    expect(capaDetalle(L).o).toMatchObject({ minZoom: 17, maxNativeZoom: 19, maxZoom: 20, className: "op-fondo-oscuro" });
    expect(capaFondo(L, "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}").o.maxNativeZoom).toBe(18);
    expect(capaFondo(L, "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").o).toMatchObject({ maxNativeZoom: 19, attribution: expect.stringContaining("OpenStreetMap") });
    expect(capaFondo(L, "https://x/{z}", { opacity: 0.6 }).o.opacity).toBe(0.6);
  });
  it("el mapa deja zoom 20 y enseña la mención", () => {
    expect(opcionesMapa({ zoomControl: false })).toEqual({ maxZoom: 20, attributionControl: true, zoomControl: false });
  });
});
