import { describe, expect, it } from "vitest";
import { compararConPliego, entenderHoja, leerInventario, porPuntoDe, rendimientoConInventario, resumenInventario } from "./inventario.js";

const csv = (t, sep = ";") => t.trim().split("\n").map(l => l.split(sep));
const nombres = e => Object.fromEntries(Object.entries(e.columnas).map(([k, i]) => [k, e.nombres[i]]));

describe("entender cualquier listado de contenedores", () => {
  it("cabecera en catalán con filas de título encima; «Tipus» y «Model»: la del contenido bueno", () => {
    const m = csv(`Llistat de contenidors 2025\n\nNº;Equip;Ubicació Tècnica;Carrer;Num.;Barri;Districte;Tipus;Fracció;Model;Capacitat
1;9000217;PA001751;GABRIEL MAURA;15;MARQUES DE FONTSANTA;LEVANTE;Contenedor;RSU;Soterrado;5000 L
2;9000218;PA001751;GABRIEL MAURA;15;MARQUES DE FONTSANTA;LEVANTE;Contenedor;PAPEL;Soterrado;5000 L
3;9000300;PA001900;OLMOS;3;CENTRO;CENTRO;Contenedor;ORGANICO;Superficie;2250 L`);
    const e = entenderHoja(m);
    expect(e.cabecera).toBe(2);
    expect(nombres(e)).toMatchObject({ punto: "Ubicació Tècnica", calle: "Carrer", numero: "Num.", fraccion: "Fracció", modelo: "Model", capacidad: "Capacitat", codigo: "Equip" });
    const { contenedores } = leerInventario(m, e);
    expect(contenedores.map(c => [c.fraccionPliego, c.ubicacion, c.punto])).toEqual([["Resto", "Soterrado", "PA001751"], ["Papel y cartón", "Soterrado", "PA001751"], ["Orgánica", "Superficie", "PA001900"]]);
  });

  it("sin cabecera: por el contenido", () => {
    const m = csv(`PA0001,GABRIEL MAURA,15,RSU,Soterrado,5000 L\nPA0001,GABRIEL MAURA,15,PAPEL,Soterrado,5000 L\nPA0002,OLMOS,3,VIDRIO,Superficie,3000 L\nPA0002,OLMOS,3,RSU,Superficie,3000 L\nPA0003,SOL,7,ENVASES,Superficie,3000 L`, ",");
    const e = entenderHoja(m);
    expect(e.cabecera).toBe(-1);
    expect(e.columnas).toMatchObject({ punto: 0, calle: 1, numero: 2, fraccion: 3, modelo: 4, capacidad: 5 });
    expect(leerInventario(m, e).contenedores).toHaveLength(5);
  });

  it("listado por punto: una columna por fracción con cuántos hay", () => {
    const m = csv(`Dirección;RSU;Papel;Vidrio;Envases\nAvda. Argentina 5;2;1;1;1\nCalle Sol 7;1;0;1;1`);
    const e = entenderHoja(m);
    expect(e.porFraccion.map(p => p.fraccion)).toEqual(["Resto", "Papel y cartón", "Vidrio", "Envases"]);
    const r = resumenInventario(leerInventario(m, e).contenedores);
    expect(r.total).toBe(8);
    expect(r.puntos).toBe(2);
  });

  it("en inglés y con coordenadas", () => {
    const m = csv(`street,number,waste,type,latitude,longitude\nMain St,1,Glass,Underground,39.5701,2.6502`, ",");
    const [c] = leerInventario(m).contenedores;
    expect(c).toMatchObject({ fraccionPliego: "Vidrio", ubicacion: "Soterrado", lat: 39.5701, lng: 2.6502 });
  });

  it("sin fracción no se inventa nada: pide que se le diga", () => {
    expect(leerInventario(csv(`Calle;Número\nMayor;1`)).error).toMatch(/fracción/);
  });
});

describe("con el inventario", () => {
  const conts = [
    ...[1, 2, 3].flatMap(p => [{ punto: `P${p}`, ubicacion: "Soterrado", fraccionPliego: "Resto" }, { punto: `P${p}`, ubicacion: "Soterrado", fraccionPliego: "Papel y cartón" }]),
    { punto: "P1", ubicacion: "Soterrado", fraccionPliego: "Resto" },
  ];
  const r = resumenInventario(conts);
  it("contenedores por punto: de esa fracción, o todos", () => {
    expect(porPuntoDe(r, { ubicacion: "Soterrado", fraccion: "Resto" })).toEqual({ puntos: 3, porPunto: 4 / 3 });
    expect(porPuntoDe(r, { ubicacion: "Soterrado", fraccion: "Todas" })).toEqual({ puntos: 3, porPunto: 7 / 3 });
  });
  it("rendimiento por turno = minutos útiles ÷ (min por contenedor + desplazamiento ÷ por punto)", () => {
    const e = rendimientoConInventario({ nombre: "Lavado interior", ubicacion: "Soterrado", fraccion: "Todas" }, r, { horasTurno: 7, minPorContenedor: 8, desplazamiento: 7, util: 1 });
    expect(e.porTurno).toBe(Math.floor(420 / (8 + 7 / (7 / 3)))); // 420 / 11 = 38
  });
  it("comparado con el parque del pliego", () => {
    const c = compararConPliego(r, [{ ubicacion: "Soterrado", fraccion: "Resto", unidades: 5 }, { ubicacion: "Soterrado", fraccion: "Vidrio", unidades: 2 }]);
    expect(c).toEqual([
      { ubicacion: "Soterrado", fraccion: "Papel y cartón", pliego: null, listado: 3, diferencia: null },
      { ubicacion: "Soterrado", fraccion: "Resto", pliego: 5, listado: 4, diferencia: -1 },
      { ubicacion: "Soterrado", fraccion: "Vidrio", pliego: 2, listado: 0, diferencia: -2 },
    ]);
  });
});

describe("¿todas las fracciones en la misma visita?", () => {
  const conts = [1, 2].flatMap(p => [{ punto: `P${p}`, ubicacion: "Soterrado", fraccionPliego: "Resto" }, { punto: `P${p}`, ubicacion: "Soterrado", fraccionPliego: "Papel y cartón" }]);
  const r = resumenInventario(conts);
  it("preventivo trimestral para todas: juntas; lavado mensual/semestral: por fracción", async () => {
    const { vanJuntas } = await import("./inventario.js");
    const prev = [{ nombre: "Mantenimiento preventivo", ubicacion: "Soterrado", fraccion: "Resto", cantidadAnual: 8 }, { nombre: "Mantenimiento preventivo", ubicacion: "Soterrado", fraccion: "Papel y cartón", cantidadAnual: 8 }];
    const lav = [{ nombre: "Lavado interior", ubicacion: "Soterrado", fraccion: "Resto", cantidadAnual: 24 }, { nombre: "Lavado interior", ubicacion: "Soterrado", fraccion: "Papel y cartón", cantidadAnual: 4 }];
    expect(vanJuntas(prev[0], prev, r)).toBe(true);
    expect(vanJuntas(lav[0], lav, r)).toBe(false);
    expect(rendimientoConInventario({ nombre: "Achiques" }, r)).toBeNull();
  });
});
