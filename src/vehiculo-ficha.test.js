import { describe, expect, it } from "vitest";
import { CAMPOS_FICHA_VEHICULO, decimal, diasHasta, valorFichaVehiculo } from "./vehiculo-ficha.js";
import { leerVehiculos } from "./recursos-importar.js";
import { autoScaleFleet, fueraDeAutonomia, generateScenario, kmDelDia, computeCandidateSlots } from "./vrp-engine.js";
import { simular } from "./scheduling/mejora-rutas.js";

const campo = k => CAMPOS_FICHA_VEHICULO.find(c => c.k === k);

describe("ficha del vehículo", () => {
  it("lee números, fechas y combustibles como se escriben", () => {
    expect(decimal("12.000")).toBe(12000);
    expect(decimal("18,5")).toBe(18.5);
    expect(decimal("300 km")).toBe(300);
    expect(decimal("")).toBe("");
    expect(valorFichaVehiculo(campo("combustible"), "gasoil")).toBe("Diésel");
    expect(valorFichaVehiculo(campo("combustible"), "100% eléctrico")).toBe("Eléctrico");
    expect(valorFichaVehiculo(campo("combustible"), "PHEV")).toBe("Híbrido enchufable");
    expect(valorFichaVehiculo(campo("fechaMatriculacion"), "2019")).toBe("2019-01-01");
    expect(valorFichaVehiculo(campo("proximaITV"), "15/03/2026")).toBe("2026-03-15");
  });
  it("avisa de lo que caduca", () => {
    const hoy = new Date(2026, 9, 24);
    expect(diasHasta("2026-10-30", hoy)).toBe(6);
    expect(diasHasta("2026-10-20", hoy)).toBe(-4);
    expect(diasHasta("", hoy)).toBe(null);
  });
  it("se sube desde un Excel con la ficha", () => {
    const { vehiculos } = leerVehiculos([{ Nombre: "Furgo", "Matrícula": "5678 def", Modelo: "Kangoo", Combustible: "Eléctrico", "Autonomía (km)": "180", "Consumo (l/100 km)": "18,5", "Próxima ITV": "10/09/2027", "Nº de bastidor": "VF1234" }]);
    expect(vehiculos[0]).toMatchObject({ nombre: "Furgo", matricula: "5678DEF", tipo: "Otro", modelo: "Kangoo", combustible: "Eléctrico", autonomiaKm: 180, consumo: 18.5, proximaITV: "2027-09-10", bastidor: "VF1234" });
    expect(vehiculos[0].marca).toBeUndefined(); // lo que no viene no se toca
  });
});

describe("autonomía en el Scheduling", () => {
  const depot = { lat: 40.4168, lng: -3.7038 };
  // 12 paradas en dos grupos: 6 cerca de la base y 6 a unos 15 km
  const tareas = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, lat: 40.42 + i * 0.002, lng: -3.70, duracion: 10 })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, lat: 40.55 + i * 0.002, lng: -3.70, duracion: 10 })),
  ];
  const cons = { startMin: 360, endMin: 1320, maxDays: 5, circular: false, maxShiftMin: 0, maxStops: 0, breakAfter: 0, breakDur: 0 };
  const veh = aut => ({ _id: "v1", nombre: "Furgo", turno: "Jornada completa", depotLat: depot.lat, depotLng: depot.lng, autonomiaKm: aut });
  const kmPorDia = fila => {
    const dias = new Set(fila.assignments.map(a => Math.floor(a._start / 1440)));
    return [...dias].map(d => kmDelDia(fila, d * 1440));
  };

  it("sin autonomía lo hace todo en un día", async () => {
    const r = await generateScenario(tareas, [veh(null)], cons);
    expect(r.unassigned).toHaveLength(0);
    expect(kmPorDia(r.schedule[0])).toHaveLength(1);
    expect(Math.max(...kmPorDia(r.schedule[0]))).toBeGreaterThan(30);
  });
  it("con poca autonomía reparte en más días y ningún día se pasa", async () => {
    // dos grupos, uno al norte y otro al sur, a unos 9 km de la base: ir a uno y volver cabe; a los dos, no
    const dos = [
      ...Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, lat: 40.4968 + i * 0.001, lng: -3.7038, duracion: 10 })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, lat: 40.3368 - i * 0.001, lng: -3.7038, duracion: 10 })),
    ];
    const sin = await generateScenario(dos, [veh(null)], cons);
    const kmSin = Math.max(...kmPorDia(sin.schedule[0]));
    const aut = Math.ceil(kmSin * 0.7);
    const r = await generateScenario(dos, [veh(aut)], cons);
    const km = kmPorDia(r.schedule[0]);
    expect(r.unassigned).toHaveLength(0);
    expect(Math.max(...km)).toBeLessThanOrEqual(aut);
    expect(km.length).toBe(2);
  });
  it("lo que no se alcanza ni yendo solo se queda sin asignar", async () => {
    const r = await generateScenario(tareas, [veh(25)], cons);
    expect(Math.max(...kmPorDia(r.schedule[0]))).toBeLessThanOrEqual(25);
    expect(r.unassigned.map(t => t.id).sort()).toEqual(["l0", "l1", "l2", "l3", "l4", "l5"]);
  });
  it("mover una parada a mano tampoco se pasa", () => {
    const fila = { ...veh(5), assignments: [] };
    expect(computeCandidateSlots(tareas[6], fila, 0)).toHaveLength(0); // ir y volver son ~30 km
    expect(computeCandidateSlots(tareas[0], fila, 0).length).toBeGreaterThan(0);
  });
  it("la mejora de rutas no acepta una ruta más larga que la autonomía", () => {
    const ruta = { off: 0, sh: { start: 360, end: 1320, breaks: [] }, depot, circular: false, paradas: [tareas[6]] };
    expect(simular(ruta, {}).ok).toBe(true);
    expect(simular({ ...ruta, aut: 5 }, {}).ok).toBe(false);
  });
  it("las que no alcanza nadie se quedan fuera sin añadir vehículos por ellas", async () => {
    expect(fueraDeAutonomia(tareas[6], [veh(25)])).toBe(true);
    expect(fueraDeAutonomia(tareas[6], [veh(25), veh(null)])).toBe(false);
    const r = await autoScaleFleet(tareas, [veh(25)], { ...cons, maxDays: 1 });
    expect(r.result.unassigned.filter(t => t._fueraAutonomia).map(t => t.id).sort()).toEqual(["l0", "l1", "l2", "l3", "l4", "l5"]);
    expect(r.addedCount).toBe(0);
  });
});
