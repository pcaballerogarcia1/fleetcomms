import { describe, expect, it } from "vitest";
import { leerTrabajadores, leerVehiculos, planTrabajadores, planVehiculos, turnoDe } from "./recursos-importar.js";

describe("subir vehículos y trabajadores", () => {
  it("turnos escritos de cualquier forma", () => {
    expect(["M", "mañana", "Tarde", "noche", "Jornada partida", "", "raro"].map(x => turnoDe(x))).toEqual(["Mañana (06-14)", "Mañana (06-14)", "Tarde (14-22)", "Noche (22-06)", "Jornada completa", "Jornada completa", "Jornada completa"]);
  });
  it("vehículos: columnas con otros nombres, matrícula normalizada y base solo si trae las dos coordenadas", () => {
    const { vehiculos, ignorados } = leerVehiculos([
      { "Matrícula": "1234 abc", "Tipo de vehículo": "Camión lateral", Capacidad: "12.000", Turno: "M", Latitud: "39,57", Longitud: "2,65" },
      { Nombre: "Furgo", Latitud: "39.5" },
      { Notas: "fila vacía" },
    ]);
    expect(vehiculos[0]).toMatchObject({ nombre: "1234ABC", matricula: "1234ABC", tipo: "Camión lateral", capacidad: 12000, turno: "Mañana (06-14)", depotLat: 39.57, depotLng: 2.65 });
    expect(vehiculos[1]).toMatchObject({ nombre: "Furgo", tipo: "Otro", depotLat: null });
    expect(ignorados).toEqual([{ fila: 4, motivo: "sin nombre ni matrícula" }]);
  });
  it("lo que ya existe se actualiza, lo repetido en el archivo se cuenta una vez", () => {
    const existentes = [{ _id: "v1", nombre: "Camión 1", matricula: "1234ABC" }, { _id: "v2", nombre: "Furgo", matricula: "" }];
    const plan = planVehiculos([{ nombre: "Camión uno", matricula: "1234ABC" }, { nombre: "Furgo", matricula: "" }, { nombre: "Nuevo", matricula: "9999ZZZ" }, { nombre: "Nuevo", matricula: "9999ZZZ" }], existentes);
    expect(plan.cambios.map(c => c.id)).toEqual(["v1", "v2"]);
    expect(plan.nuevos.map(v => v.nombre)).toEqual(["Nuevo"]);
  });
  it("trabajadores: nombre completo partido, vehículo por matrícula o nombre, y los que no se encuentran", () => {
    const { trabajadores } = leerTrabajadores([
      { "Nombre completo": "Ana García López", Turno: "tarde", "Vehículo": "1234 abc" },
      { Nombre: "Luis", Apellidos: "Martín", "Vehículo": "Furgo" },
      { Nombre: "Eva", "Vehículo": "No existe" },
    ]);
    expect(trabajadores[0]).toMatchObject({ nombre: "Ana", apellidos: "García López", turno: "Tarde (14-22)" });
    const vehiculos = [{ _id: "v1", nombre: "Camión 1", matricula: "1234ABC" }, { _id: "v2", nombre: "Furgo" }];
    const plan = planTrabajadores(trabajadores, [{ _id: "t9", nombre: "Luis", apellidos: "Martín", vehiculoId: "" }], vehiculos);
    expect(plan.nuevos.map(t => [t.nombre, t.vehiculoId])).toEqual([["Ana", "v1"], ["Eva", ""]]);
    expect(plan.cambios).toEqual([{ id: "t9", datos: expect.objectContaining({ vehiculoId: "v2" }) }]);
    expect(plan.sinVehiculo).toEqual(["No existe"]);
  });
});

describe("ficha del trabajador desde el Excel", () => {
  it("lee DNI, nacimiento (texto o número de Excel), nacionalidad, categoría, correo… y el rol de la app", () => {
    const { trabajadores } = leerTrabajadores([
      { Nombre: "Ana", "D.N.I.": "12345678Z", "Fecha de nacimiento": "14/03/1985", Nacionalidad: "Española", "Categoría": "Conductor 1ª", Email: "Ana@Empresa.es", "Móvil": "600111222", Domicilio: "C/ Mayor 1", Carnet: "C", "Fecha de alta": 43862, Puesto: "Encargado" },
      { Nombre: "Luis", Edad: "34 años" },
    ]);
    expect(trabajadores[0]).toMatchObject({ dni: "12345678Z", fechaNacimiento: "1985-03-14", nacionalidad: "Española", categoria: "Conductor 1ª", email: "ana@empresa.es", telefono: "600111222", direccion: "C/ Mayor 1", carnet: "C", fechaAlta: "2020-02-01", rol: "supervisor" });
    expect(trabajadores[1]).toMatchObject({ edad: 34, rol: "conductor" });
    expect(trabajadores[1].dni).toBeUndefined(); // lo que no viene no se toca
  });
});
