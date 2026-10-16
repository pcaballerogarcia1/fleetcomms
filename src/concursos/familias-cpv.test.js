import { describe, expect, it } from "vitest";
import { familiaDeCpv } from "./familias-cpv.js";

describe("familiaDeCpv", () => {
  it("el prefijo más largo manda: el lavado de contenedores no es limpieza de edificios", () => {
    expect(familiaDeCpv(["90918000"]).clave).toBe("90918");
    expect(familiaDeCpv(["90911200"]).clave).toBe("9091");
  });
  it("manda el CPV principal (el primero)", () => {
    expect(familiaDeCpv(["90511000", "90918000"]).clave).toBe("9051");
  });
  it("los CPV genéricos solo cuentan si el título habla de contenedores", () => {
    expect(familiaDeCpv(["50000000"], { titulo: "Reparación de contenedores de fibra", tipo: "2" }).clave).toBe("mant-contenedores");
    expect(familiaDeCpv(["50000000"], { titulo: "Mantenimiento de ascensores", tipo: "2" })).toBeNull();
    expect(familiaDeCpv(["50000000"])).toBeNull();
  });
  it("suministro de contenedores y camiones, pero no un suministro de servicios", () => {
    expect(familiaDeCpv(["34928480"], { titulo: "Suministro de contenedores de biorresiduos", tipo: "1" }).clave).toBe("sum-contenedores");
    expect(familiaDeCpv(["34144511"], { tipo: "1" }).clave).toBe("camiones-recogida");
    expect(familiaDeCpv(["90511000"], { tipo: "1" })).toBeNull();
  });
});
