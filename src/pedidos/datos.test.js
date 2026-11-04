import { describe, expect, it } from "vitest";
import { aplicaFijo, buscarClientes, clientesDe, diaSemana, hora, idDeFijo, leerPegado, masDias, nuevoPedido, numero, pedidosDeFijos, resumenDia } from "./datos.js";

const capa = { visible: true, markers: [
  { lat: 40.9652, lng: -5.6641, Cliente: "Bar El Puente", Dirección: "Calle Mayor", Número: "12", Población: "Salamanca", Teléfono: "923 000 111" },
  { lat: 40.9648, lng: -5.6637, Cliente: "Farmacia Sol", Dirección: "Plaza Mayor 5", Población: "Salamanca" },
  { lat: 40.9711, lng: -5.6565, Cliente: "Restaurante La Ría", Dirección: "Avenida de Portugal 40", Población: "Salamanca" },
  { lat: 40.9652, lng: -5.6641, Cliente: "Bar El Puente", Dirección: "Calle Mayor", Número: "12", Población: "Salamanca" }, // repetido
] };

describe("pedidos", () => {
  it("los clientes salen de los puntos de Planificación, sin repetir", () => {
    const cs = clientesDe([capa]);
    expect(cs).toHaveLength(3);
    expect(cs[0]).toMatchObject({ nombre: "Bar El Puente", direccion: "Calle Mayor 12, Salamanca", telefono: "923 000 111" });
  });

  it("encuentra al cliente por lo que se escribe", () => {
    const cs = clientesDe([capa]);
    expect(buscarClientes(cs, "bar").map(c => c.nombre)).toEqual(["Bar El Puente"]);
    expect(buscarClientes(cs, "portugal").map(c => c.nombre)).toEqual(["Restaurante La Ría"]);
    expect(buscarClientes(cs, "ria").map(c => c.nombre)).toEqual(["Restaurante La Ría"]);
    expect(buscarClientes(cs, "")).toEqual([]);
  });

  it("fechas, horas y números", () => {
    expect(masDias("2026-11-30", 1)).toBe("2026-12-01");
    expect(diaSemana("2026-11-02")).toBe(1); // lunes
    expect(diaSemana("2026-11-08")).toBe(7); // domingo
    expect(hora("9")).toBe("09:00");
    expect(hora("9.30")).toBe("09:30");
    expect(hora("25")).toBe("");
    expect(numero("1.200")).toBe(1200); // a la española: punto de miles
    expect(numero("1.200,5")).toBe(1200.5);
    expect(numero("")).toBe(null);
  });

  it("los fijos salen los días que tocan, una vez", () => {
    const fijo = { id: "f1", org_id: "o", projectId: "p", cliente: { nombre: "Bar", lat: 1, lng: 2 }, dias: [1, 4], bultos: 2, activo: true };
    expect(aplicaFijo(fijo, "2026-11-02")).toBe(true);  // lunes
    expect(aplicaFijo(fijo, "2026-11-03")).toBe(false); // martes
    const nuevos = pedidosDeFijos([fijo], "2026-11-02", []);
    expect(nuevos).toHaveLength(1);
    expect(nuevos[0]).toMatchObject({ id: "fijo_f1_2026-11-02", datos: { fecha: "2026-11-02", origen: "fijo", fijoId: "f1", bultos: 2, estado: "pendiente" } });
    // ya creado (o anulado): no vuelve a salir
    expect(pedidosDeFijos([fijo], "2026-11-02", [{ id: idDeFijo("f1", "2026-11-02"), estado: "anulado" }])).toEqual([]);
  });

  it("totales del día sin los anulados", () => {
    const c = { nombre: "x", lat: 1, lng: 1 };
    const ps = [nuevoPedido({ cliente: c, bultos: "3", kg: "45" }), nuevoPedido({ cliente: c, bultos: "1", kg: "6,5", origen: "fijo" }), { ...nuevoPedido({ cliente: c, bultos: 9 }), estado: "anulado" }];
    expect(resumenDia(ps)).toEqual({ pedidos: 2, bultos: 4, kg: 51.5, fijos: 1 });
  });

  it("lee lo pegado desde Excel: clientes conocidos por su nombre y nuevos por su dirección", () => {
    const cs = clientesDe([capa]);
    const t = ["Cliente\tDirección\tPoblación\tPedido\tBultos\tKg\tDesde\tHasta",
      "bar el puente\t\t\tP-1\t3\t45\t9:00\t11:00",
      "Kiosco Nuevo\tCalle Toro 23\tSalamanca\tP-2\t1\t2\t\t",
      "\t\t\t\t\t\t\t"].join("\n");
    const r = leerPegado(t, cs);
    expect(r.error).toBe(null);
    expect(r.filas).toHaveLength(2);
    expect(r.filas[0]).toMatchObject({ cliente: { nombre: "Bar El Puente" }, ref: "P-1", bultos: "3", desde: "9:00" });
    expect(r.filas[1]).toMatchObject({ cliente: null, texto: "Calle Toro 23, Salamanca", nombre: "Kiosco Nuevo" });
    expect(leerPegado("solo una línea", cs).error).toMatch(/títulos/);
  });
});

describe("pedidos → paradas del motor", async () => {
  const { tareasDePedidos, diaDelMes } = await import("./datos.js");
  it("con su carga, franja, duración y lo que verá el conductor; sin los anulados", () => {
    const c = { nombre: "Bar El Puente", direccion: "Rúa Mayor 12, Salamanca", lat: 40.96, lng: -5.66, telefono: "923" };
    const ts = tareasDePedidos([
      { id: "a", ...nuevoPedido({ cliente: c, ref: "P-1", bultos: 3, kg: 45, desde: "9", hasta: "11", notas: "puerta trasera" }) },
      { id: "b", ...nuevoPedido({ cliente: c, bultos: 2 }) },
      { id: "c", ...nuevoPedido({ cliente: c, bultos: 9 }), estado: "anulado" },
    ], 8);
    expect(ts).toHaveLength(2);
    expect(ts[0]).toMatchObject({ _id: "ped_a", _pedidoId: "a", lat: 40.96, nombre: "Bar El Puente", demanda: 45, duracion: 8, windowStart: 540, windowEnd: 660,
      campos: { Cliente: "Bar El Puente", Pedido: "P-1", Bultos: 3, Kg: 45, Notas: "puerta trasera", Teléfono: "923" } });
    expect(ts[1]).toMatchObject({ demanda: 2, duracion: 8 });
    expect(ts[1].windowStart).toBeUndefined();
    expect(diaDelMes("2026-11-09", "2026-11")).toBe(9);
    expect(diaDelMes("2026-12-01", "2026-11")).toBe(null);
  });
});

describe("el resultado de la entrega en la bandeja", async () => {
  const { resultadosPorPedido, resumenEntregas, reprogramado } = await import("./datos.js");
  it("cruza cada pedido con su parada de la ruta", () => {
    const planes = [{ id: "pl1", vehiculoNombre: "Camión 2", ubicaciones: [
      { id: "u0", pedidoId: "a", realizado: true, entrega: { estado: "entregada", recibe: "Ana" } },
      { id: "u1", pedidoId: "b", realizado: true, entrega: { estado: "no_entregada", motivo: "ausente" } },
      { id: "u2", pedidoId: "c", realizado: false },
      { id: "u3", realizado: true },
    ] }];
    const r = resultadosPorPedido(planes);
    expect([...r.keys()]).toEqual(["a", "b", "c"]);
    expect(r.get("b")).toMatchObject({ estado: "no_entregada", plan: { vehiculoNombre: "Camión 2" } });
    const ps = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e", estado: "anulado" }];
    expect(resumenEntregas(ps, r)).toEqual({ entregados: 1, noEntregados: 1, enRuta: 1 });
  });
  it("pasa un no entregado a otro día, con lo mismo", () => {
    const p = { ...nuevoPedido({ orgId: "o", projectId: "p", fecha: "2026-11-04", cliente: { nombre: "Bar", lat: 1, lng: 2 }, ref: "P-9", bultos: 2, desde: "9", hasta: "11", notas: "x" }), id: "b", ruta: "Camión 2" };
    const n = reprogramado(p, "2026-11-05");
    expect(n).toMatchObject({ fecha: "2026-11-05", ref: "P-9", bultos: 2, desde: "09:00", hasta: "11:00", notas: "x", origen: "reprogramado", desdePedido: "b", desdeFecha: "2026-11-04", estado: "pendiente", cliente: { nombre: "Bar" } });
    expect(n.ruta).toBeUndefined();
  });
});
