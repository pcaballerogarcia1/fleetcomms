import { describe, it, expect, vi } from "vitest";
vi.mock("./firebase.js", () => ({ db: {} }));
import { workerStopsByDay, taskToUbicacion } from "./publicar-rutas.js";

const startMin = 360;
const blk = (day, t, extra = {}) => ({ _start: (day - 1) * 1440 + t, _end: (day - 1) * 1440 + t + 20, lat: 40, lng: -3, ...extra });

describe("workerStopsByDay", () => {
  const vehicles = [
    { _id: "A", nombre: "Camión A", assignments: [blk(3, 400), blk(3, 450, { _travel: true }), blk(3, 900), blk(4, 400)] },
    { _id: "B", nombre: "Camión B", assignments: [blk(3, 420)] },
  ];

  it("modo libre: paradas del vehículo y horario que le asignó Optimizar", () => {
    const r = workerStopsByDay({ scenario: { vehicles }, startMin, asignWorker: { 3: { v: "A", vn: "Camión A", s: 360, e: 840 } } });
    expect(Object.keys(r)).toEqual(["3"]);
    expect(r[3].stops).toHaveLength(1);           // sin el viaje ni la parada de la tarde
    expect(r[3].vehiculo).toBe("Camión A");
  });

  it("modo cuadrante: sus propias paradas del escenario, por día", () => {
    const workerRow = { _id: "w1", vehiculoId: "B", assignments: [blk(3, 420), blk(5, 420), blk(5, 500, { _break: true })] };
    const r = workerStopsByDay({ scenario: { vehicles }, startMin, asignWorker: {}, workerRow });
    expect(Object.keys(r).sort()).toEqual(["3", "5"]);
    expect(r[5].stops).toHaveLength(1);
    expect(r[3].vehiculo).toBe("Camión B");
  });

  it("taskToUbicacion saca los campos del Excel de Planning", () => {
    const u = taskToUbicacion({ nombre: "PA-9", lat: "40.1", lng: "-3.2", campos: { Calle: "Mayor", "Num.": "3" } }, 0);
    expect(u).toMatchObject({ pa: "PA-9", calle: "Mayor", num: "3", lat: 40.1, lng: -3.2, realizado: false });
  });
});
