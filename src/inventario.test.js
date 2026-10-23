import { describe, it, expect } from "vitest";
import { completarConPuntos, importarFilas, conInventario, resumenInventario, fichaDePunto } from "./inventario.js";
import { buscarEtiqueta, normalizarEtiqueta } from "./conductor/rfid.js";
import { leerKg, resumenPesadas } from "./pesadas.js";
import { taskToUbicacion } from "./publicar-rutas.js";
import { litrosDe } from "./scheduling/capacidad.js";

const m = (lat, lng, campos) => ({ lat, lng, campos });

describe("inventario de contenedores", () => {
  it("lee la ficha de un punto del Excel", () => {
    const f = fichaDePunto(m(40.1, -3.2, { Código: "C-001", RFID: "E200 3412", Contenedor: "Carga lateral 3200L", Fracción: "Resto" }));
    expect(f).toMatchObject({ id: "C-001", codigo: "C-001", rfid: "E200 3412", litros: 3200, fraccion: "Resto", estado: "En servicio", punto: "40.10000_-3.20000" });
  });
  it("crea con los puntos y después solo añade los nuevos (sin pisar lo editado)", () => {
    const pts = [m(40.1, -3.2, { Código: "A" }), m(40.2, -3.2, {}), m(40.2, -3.2, {})];
    const r1 = completarConPuntos([], pts);
    expect(r1.nuevos).toBe(3);
    const editada = r1.lista.map(c => (c.id === "A" ? { ...c, estado: "Dañado" } : c));
    const r2 = completarConPuntos(editada, [...pts, m(40.3, -3.2, { Código: "B" })]);
    expect(r2.nuevos).toBe(1);
    expect(r2.lista.find(c => c.id === "A").estado).toBe("Dañado");
  });
  it("actualiza con un Excel por código o RFID y añade los que traen coordenadas", () => {
    const base = completarConPuntos([], [m(40.1, -3.2, { Código: "A", RFID: "111" })]).lista;
    const r = importarFilas(base, [
      { Código: "A", Estado: "taller", Lavado: "2026-10-01" },
      { RFID: "111", Notas: "golpe lateral" },
      { Código: "Z", Lat: "40,5", Lng: "-3,5", Litros: "1100" },
      { Código: "Y" },
    ]);
    expect(r).toMatchObject({ actualizados: 2, nuevos: 1, ignorados: 1 });
    expect(r.lista.find(c => c.id === "A")).toMatchObject({ estado: "En taller", lavado: "2026-10-01", notas: "golpe lateral" });
    expect(r.lista.find(c => c.id === "Z")).toMatchObject({ lat: 40.5, lng: -3.5, litros: 1100 });
    expect(base[0].estado).toBe("En servicio"); // no toca la lista de partida
  });
  it("da a cada parada sus contenedores y litros; quita los puntos con todo retirado", () => {
    const lista = [
      { id: "a1", punto: "1_1", codigo: "a1", rfid: "R1", litros: 3200, estado: "En servicio" },
      { id: "a2", punto: "1_1", codigo: "a2", rfid: "R2", litros: 1100, estado: "En servicio" },
      { id: "b1", punto: "2_2", codigo: "b1", litros: 800, estado: "Retirado" },
    ];
    const tasks = [{ _id: "1_1", lat: 1, lng: 1 }, { _id: "2_2", lat: 2, lng: 2 }, { _id: "3_3", lat: 3, lng: 3 }];
    const r = conInventario(tasks, lista);
    expect(r.map(t => t._id)).toEqual(["1_1", "3_3"]);
    expect(r[0].litros).toBe(4300);
    expect(litrosDe(r[0])).toBe(4300);
    expect(r[0].contenedores.map(c => c.rfid)).toEqual(["R1", "R2"]);
    // dos paradas en el mismo punto se reparten los contenedores
    const dos = conInventario([{ _id: "1_1" }, { _id: "1_1" }], lista);
    expect(dos.map(t => t.litros)).toEqual([3200, 1100]);
    expect(resumenInventario(lista)).toMatchObject({ total: 3, conRfid: 2, litros: 4300 });
  });
});

describe("RFID en la app del conductor", () => {
  it("al publicar, los contenedores de la parada van como elementos con su RFID", () => {
    const u = taskToUbicacion({ lat: 1, lng: 1, nombre: "P", contenedores: [{ codigo: "a1", rfid: "04:A2:FF", tipo: "Lateral", fraccion: "Resto" }] }, 0);
    expect(u.elementos).toEqual([{ codiQR: "a1", rfid: "04:A2:FF", model: "Lateral · Resto", realizado: false }]);
    expect(taskToUbicacion({ lat: 1, lng: 1, campos: { RFID: "777" } }, 0).elementos).toEqual([{ codiQR: "777", rfid: "777", model: "", realizado: false }]);
    expect(taskToUbicacion({ lat: 1, lng: 1 }, 0).elementos).toEqual([]);
  });
  it("encuentra la etiqueta leída aunque venga con otro formato", () => {
    expect(normalizarEtiqueta(" 04:a2:ff ")).toBe("04A2FF");
    const ubic = [{ id: "u0", elementos: [{ codiQR: "a1", rfid: "04:A2:FF", realizado: false }] }, { id: "u1", elementos: [{ codiQR: "b1", rfid: "", realizado: true }] }];
    expect(buscarEtiqueta(ubic, "04a2ff")).toEqual({ ubicId: "u0", codiQR: "a1", yaHecho: false });
    expect(buscarEtiqueta(ubic, "B1")).toEqual({ ubicId: "u1", codiQR: "b1", yaHecho: true });
    expect(buscarEtiqueta(ubic, "zzz")).toBe(null);
  });
});

describe("pesadas de báscula", () => {
  it("lee los kg como los escribe la gente", () => {
    expect(leerKg("8450")).toBe(8450);
    expect(leerKg("8.450")).toBe(8450);
    expect(leerKg("8.450,5 kg")).toBe(8450.5);
    expect(leerKg("8,45 t")).toBe(8450);
    expect(leerKg("1,234.5")).toBe(1234.5);
    expect(leerKg("")).toBe(null);
  });
  it("resume por día, fracción y camión, y kg por parada", () => {
    const p = [
      { fecha: "2026-10-01", vehiculo: "C1", planta: "P", fraccion: "Resto", kg: 8000 },
      { fecha: "2026-10-01", vehiculo: "C2", planta: "P", fraccion: "Envases", kg: 2000 },
      { fecha: "2026-10-02", vehiculo: "C1", planta: "P", fraccion: "Resto", kg: 6000 },
    ];
    const planes = [{ ubicaciones: [{ realizado: true }, { realizado: true }, { realizado: false }] }];
    const r = resumenPesadas(p, planes);
    expect(r).toMatchObject({ total: 16000, n: 3, paradasHechas: 2, kgPorParada: 8000 });
    expect(r.porDia).toEqual([{ fecha: "01/10", kg: 10000 }, { fecha: "02/10", kg: 6000 }]);
    expect(r.porFraccion[0]).toEqual({ name: "Resto", kg: 14000 });
    expect(r.porVehiculo[0]).toEqual({ name: "C1", kg: 14000 });
  });
});

describe("puntos de un CSV y columnas de otros sectores", () => {
  it("lee las columnas sueltas del punto (capas subidas) y las de contadores", () => {
    const f = fichaDePunto({ lat: 39.57, lng: 2.65, id: "interno-1", "Nº de serie": "A123", "Tipo de contador": "Volumétrico", Calibre: "DN15", Nombre: "Calle Mayor 1" });
    expect(f).toMatchObject({ codigo: "A123", tipo: "Volumétrico", fraccion: "DN15", nombre: "Calle Mayor 1" });
  });
});
