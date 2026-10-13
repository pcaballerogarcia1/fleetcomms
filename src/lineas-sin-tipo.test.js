import { describe, it, expect } from "vitest";
import { porQueSinTipo } from "./lineas-sched/sin-tipo.js";

const tipo = (id, extra) => ({ id, nombre: id, activo: true, desde: 240, hasta: 840, trabajoMin: 480, trabajoMax: 540, amplitudMax: 540, partido: false, ...extra });
const turno = extra => ({ tipo: null, inicio: 360, fin: 600, trabajo: 240, partidos: 0, cambios: 0, ...extra });

describe("por qué hay turnos sin tipo", () => {
  it("agrupa por el tipo más parecido y lo que le falta, con el consejo", () => {
    const p = { tiposTurno: [tipo("Mañana"), tipo("Refuerzo", { desde: 0, hasta: 1439, trabajoMin: 180, trabajoMax: 360, amplitudMax: 420, maximo: 5 })], maxCambiosBusTotal: 15 };
    const d = porQueSinTipo([turno(), turno(), turno({ trabajo: 60, fin: 420 }), { tipo: "Mañana" }], p, { cambiosBus: 15 });
    expect(d.total).toBe(3);
    expect(d.cambiosAgotados).toBe(15);
    expect(d.grupos[0]).toMatchObject({ n: 2, tipo: "Refuerzo", motivos: ["lleno"] });
    expect(d.grupos[0].consejo).toMatch(/Máximo al día/);
    expect(d.grupos[1].texto).toMatch(/1h00 de trabajo/);
  });
  it("cambio de bus que el tipo no permite", () => {
    const d = porQueSinTipo([turno({ trabajo: 500, fin: 860, cambios: 1 })], { tiposTurno: [tipo("Mañana", { cambiosBus: 0 })] });
    expect(d.grupos[0].motivos).toEqual(["cambio"]);
    expect(d.grupos[0].consejo).toMatch(/Cambio de bus/);
  });
  it("sin turnos sin tipo, nada", () => {
    expect(porQueSinTipo([{ tipo: "Mañana" }], { tiposTurno: [tipo("Mañana")] })).toBeNull();
  });
});
