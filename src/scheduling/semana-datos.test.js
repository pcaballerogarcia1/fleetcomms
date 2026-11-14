import { describe, expect, it } from "vitest";
import { agenda, camionesDe, cuando, diasDeSemana, lunesDe, pedidosParaViajes, planesDeViaje } from "./semana-datos.js";
import { planificarSemana } from "./viajes-largos.js";

describe("semana de viajes: datos", () => {
  it("el lunes de cualquier día y los días de trabajo", () => {
    expect(lunesDe("2026-11-19")).toBe("2026-11-16"); // jueves → lunes
    expect(lunesDe("2026-11-16")).toBe("2026-11-16");
    expect(lunesDe("2026-11-22")).toBe("2026-11-16"); // domingo → lunes anterior
    expect(diasDeSemana("2026-11-30", 5)).toEqual(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]);
  });
  it("los pedidos: sin anulados ni pasados a otra fecha; bultos o kilos; la franja en minutos", () => {
    const l = pedidosParaViajes([
      { id: "a", cliente: { nombre: "Bar", lat: 40.4, lng: -3.7 }, bultos: 6, kg: 900, desde: "09:00", hasta: "13:30" },
      { id: "b", cliente: { nombre: "X", lat: 40, lng: -3 }, bultos: 2, estado: "anulado" },
      { id: "c", cliente: { nombre: "Y", lat: 40, lng: -3 }, bultos: 2, reprogramadoA: "2026-12-01" },
    ]);
    expect(l).toEqual([{ id: "a", cliente: "Bar", ref: null, lat: 40.4, lng: -3.7, palets: 6, ventana: { desde: 540, hasta: 810 } }]);
    expect(pedidosParaViajes([{ id: "a", cliente: { lat: 1, lng: 1 }, bultos: 6, kg: 900 }], "kg")[0].palets).toBe(900);
  });
  it("los camiones: los que tienen carga máxima; los demás, para avisar", () => {
    expect(camionesDe([{ _id: "v1", nombre: "C1", cargaMax: 32 }, { _id: "v2", nombre: "C2" }, { _id: "v3", nombre: "C3", cargaMax: 8, activo: false }]))
      .toEqual({ camiones: [{ id: "v1", nombre: "C1", palets: 32 }], sinCapacidad: ["C2"] });
  });
  it("las horas de la semana", () => {
    expect(cuando(6 * 60)).toBe("lun 06:00");
    expect(cuando(1440 + 13 * 60 + 5)).toBe("mar 13:05");
  });
});

describe("del viaje al móvil del conductor", () => {
  const pedidos = [
    { id: "p1", cliente: { nombre: "Cliente Coruña", lat: 43.3623, lng: -8.4115 }, bultos: 12, ref: "A1" },
    { id: "p2", cliente: { nombre: "Cliente León", lat: 42.5987, lng: -5.5671 }, bultos: 10, ref: "A2" },
  ];
  const res = planificarSemana(pedidosParaViajes(pedidos), [{ id: "c1", nombre: "Camión 1", palets: 32 }], { segundosMejora: 0.2 });
  const v = res.viajes[0];
  it("una agenda con salida, entregas, noches y vuelta", () => {
    const a = agenda(v, { nombre: "Murcia" });
    expect(a[0].texto).toBe("Sale de Murcia");
    expect(a.at(-1).texto).toBe("Vuelve a Murcia");
    expect(a.filter(e => e.tipo === "entrega")).toHaveLength(2);
    expect(a.some(e => e.tipo === "noche")).toBe(true);
  });
  it("una ruta por día con entregas, con su fecha, la hora prevista y dónde duerme", () => {
    const planes = planesDeViaje(v, { lunes: "2026-11-16", orgId: "o1", projectId: "p", base: { nombre: "Murcia", lat: 37.99, lng: -1.13 }, pedidosPorId: new Map(pedidos.map(p => [p.id, p])) });
    expect(planes.length).toBeGreaterThanOrEqual(1);
    const ubs = planes.flatMap(p => p.ubicaciones);
    expect(ubs.map(u => u.pedidoId).sort()).toEqual(["p1", "p2"]);
    for (const pl of planes) {
      expect(pl).toMatchObject({ org_id: "o1", projectId: "p", origenViajes: true, tipo: "ruta", vehiculoNombre: "Camión 1" });
      expect(pl.fecha >= "2026-11-16" && pl.fecha <= "2026-11-20").toBe(true);
      expect(pl.nota).toMatch(/duermes|Vuelves/);
      for (const u of pl.ubicaciones) expect(u.horaPlan).toBeGreaterThanOrEqual(8 * 60);
    }
    expect(ubs.find(u => u.pedidoId === "p1")).toMatchObject({ pedido: "A1", bultos: 12, realizado: false });
  });
});
