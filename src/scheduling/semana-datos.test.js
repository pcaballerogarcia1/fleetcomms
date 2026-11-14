import { describe, expect, it } from "vitest";
import { agenda, camionesDe, cuando, diasDeSemana, lunesDe, minutoDeSemana, pedidosParaViajes, planParaGuardar, planesDeViaje, resumenDelDia, separarEnMarcha, unirPlanes, vistaDelDia } from "./semana-datos.js";
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

describe("la semana unificada: días, en marcha y replanificar", () => {
  it("el día de cada pedido respecto al lunes y su fecha fija", () => {
    const l = pedidosParaViajes([
      { id: "a", fecha: "2026-11-18", fechaFija: true, cliente: { lat: 40, lng: -3 }, bultos: 2 },
      { id: "b", fecha: "2026-11-16", cliente: { lat: 40, lng: -3 }, bultos: 2 },
    ], "bultos", "2026-11-16");
    expect(l.map(x => [x.dia, x.fechaFija])).toEqual([[2, true], [0, false]]);
    expect(minutoDeSemana("2026-11-16", new Date(2026, 10, 17, 9, 30))).toBe(1440 + 570);
    expect(minutoDeSemana("2026-11-16", new Date(2026, 10, 10))).toBe(0);
  });
  const camiones = [{ id: "c1", nombre: "Camión 1", palets: 32 }, { id: "c2", nombre: "Camión 2", palets: 12 }, { id: "c3", nombre: "Camión 3", palets: 8 }];
  const pedidos = [
    { id: "lejos", fecha: "2026-11-16", cliente: { nombre: "Coruña", lat: 43.3623, lng: -8.4115 }, bultos: 32 },
    { id: "cerca1", fecha: "2026-11-16", fechaFija: true, cliente: { nombre: "Molina", lat: 38.0546, lng: -1.2075 }, bultos: 4 },
    { id: "cerca2", fecha: "2026-11-18", fechaFija: true, cliente: { nombre: "Cartagena", lat: 37.6257, lng: -0.9966 }, bultos: 4 },
  ];
  const res = planificarSemana(pedidosParaViajes(pedidos, "bultos", "2026-11-16"), camiones, { segundosMejora: 0.2 });
  it("cada día, qué hace cada camión: ruta del día, de viaje (y dónde duerme) o en la base", () => {
    const lunes = vistaDelDia(res, camiones, 0, { nombre: "Murcia", lat: 37.99, lng: -1.13 });
    const viaje = lunes.find(x => x.tipo === "viaje");
    expect(viaje.duerme).toBeTruthy();
    expect(viaje.diaDelViaje).toBe(1);
    const ruta = lunes.find(x => x.tipo === "ruta");
    expect(ruta.entregas.map(e => e.nombre)).toEqual(["Molina"]);
    expect(ruta.vuelve).toBeGreaterThan(ruta.sale);
    expect(lunes.some(x => x.tipo === "libre")).toBe(true);
    const martes = vistaDelDia(res, camiones, 1, null).find(x => x.viaje?.id === viaje.viaje.id);
    expect(martes).toMatchObject({ tipo: "viaje", diaDelViaje: 2 });
    expect(resumenDelDia(res, camiones, 2)).toMatchObject({ rutas: 1, entregas: 1, palets: 4 });
  });
  it("a mitad de semana: lo enviado que ya salió se queda; lo demás se replanifica con nombres nuevos", () => {
    const plan = { ...res, enviados: res.viajes.map(v => v.id) };
    const largo = res.viajes.find(v => v.noches > 0);
    const desde = 1440 + 10 * 60; // martes 10:00
    const { enMarcha, ocupados, pedidosFuera } = separarEnMarcha(plan, desde);
    expect(enMarcha.map(v => v.id)).toContain(largo.id);
    expect(pedidosFuera.has("lejos")).toBe(true);
    const resto = pedidosParaViajes(pedidos.filter(p => !pedidosFuera.has(p.id)), "bultos", "2026-11-16");
    const nuevo = planificarSemana(resto, camiones, { segundosMejora: 0.2, desde, ocupados });
    const u = unirPlanes(enMarcha, nuevo, camiones, 40);
    expect(u.viajes.filter(v => v.enMarcha).map(v => v.id)).toEqual(enMarcha.map(v => v.id));
    expect(new Set(u.viajes.map(v => v.id)).size).toBe(u.viajes.length);
    expect(u.viajes.find(v => v.paradas.some(s => s.pedidos.includes("cerca2")))).toBeTruthy();
    expect(u.sinAsignar).toEqual([]); // el del lunes va en la ruta del lunes, que ya salió
    expect(JSON.parse(planParaGuardar(u)).viajes.length).toBe(u.viajes.length);
  });
});
