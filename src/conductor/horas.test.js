import { describe, expect, it } from "vitest";
import { frenteAPrevista, horaPrevista, textoDesfase } from "./horas.js";

const a = (h, m) => new Date(2026, 10, 5, h, m).getTime();
describe("hora prevista de cada parada", () => {
  it("la enseña si la trae", () => {
    expect(horaPrevista({ horaPlan: 575 })).toBe("09:35");
    expect(horaPrevista({ horaPlan: null })).toBe("");
    expect(horaPrevista({})).toBe("");
  });
  it("lo hecho frente a lo previsto", () => {
    expect(frenteAPrevista({ horaPlan: 575, realizadoEn: a(9, 42) })).toEqual({ hecha: "09:42", min: 7, como: "enHora" });
    expect(frenteAPrevista({ horaPlan: 575, realizadoEn: a(10, 20) })).toMatchObject({ min: 45, como: "tarde" });
    expect(frenteAPrevista({ horaPlan: 575, realizadoEn: a(9, 0) })).toMatchObject({ min: -35, como: "antes" });
    expect(frenteAPrevista({ horaPlan: 1430, realizadoEn: a(0, 10) })).toMatchObject({ min: 20, como: "tarde" }); // pasada la medianoche
    expect(frenteAPrevista({ horaPlan: 575 })).toBe(null);
    expect(textoDesfase(7)).toBe("+7 min");
    expect(textoDesfase(-35)).toBe("−35 min");
    expect(textoDesfase(75)).toBe("+1 h 15 min");
  });
});
