import { describe, it, expect } from "vitest";
import {
  timeToMin, minToTime, turnoWindow, windowWait, haversineKm, hasCoords,
  computeCandidateSlots, applyTaskMove, generateScenario, autoScaleFleet,
} from "./vrp-engine.js";

// ── timeToMin / minToTime ──────────────────────────────────────────
describe("timeToMin", () => {
  it("parsea HH:MM normal", () => {
    expect(timeToMin("10:30")).toBe(630);
    expect(timeToMin("06:00")).toBe(360);
    expect(timeToMin("00:00")).toBe(0);
  });

  it("regresión: convierte una fracción de serie de Excel sin formatear (0-1, sin ':')", () => {
    // 0.4375 del día = 10:30. Este es exactamente el bug que corrompió las
    // franjas horarias del Timetable de Planning: SheetJS sin raw:false
    // devuelve el número de serie crudo en vez de "10:30".
    expect(timeToMin("0.4375")).toBe(630);
    expect(timeToMin(".5")).toBe(720); // 12:00, sin el "0" inicial
  });

  it("no confunde un HH:MM real con una fracción (tiene ':')", () => {
    expect(timeToMin("0:30")).toBe(30);
  });

  it("devuelve null para vacío o inválido", () => {
    expect(timeToMin(null)).toBeNull();
    expect(timeToMin("")).toBeNull();
    expect(timeToMin("abc")).toBeNull();
  });
});

describe("minToTime", () => {
  it("formatea minutos a HH:MM", () => {
    expect(minToTime(630)).toBe("10:30");
    expect(minToTime(0)).toBe("00:00");
  });
  it("normaliza minutos de días siguientes al reloj de 24h", () => {
    expect(minToTime(1440 + 630)).toBe("10:30"); // día 2, mismo horario
  });
  it("devuelve --:-- para null", () => {
    expect(minToTime(null)).toBe("--:--");
  });
  it("hace round-trip con timeToMin", () => {
    expect(timeToMin(minToTime(725))).toBe(725);
  });
});

// ── turnoWindow ─────────────────────────────────────────────────────
describe("turnoWindow", () => {
  it("parsea un turno de mañana", () => {
    expect(turnoWindow("Mañana (06-14)", 0, 1440)).toEqual({ start: 360, end: 840 });
  });
  it("parsea un turno de noche cruzando medianoche", () => {
    expect(turnoWindow("Noche (22-06)", 0, 1440)).toEqual({ start: 1320, end: 1800 });
  });
  it("usa el fallback si no hay turno o no matchea el patrón", () => {
    expect(turnoWindow(null, 100, 200)).toEqual({ start: 100, end: 200 });
    expect(turnoWindow("Jornada completa", 100, 200)).toEqual({ start: 100, end: 200 });
  });
});

// ── windowWait ──────────────────────────────────────────────────────
describe("windowWait", () => {
  it("sin franja, libertad total (siempre 0)", () => {
    expect(windowWait({}, 999999, 0)).toBe(0);
  });
  it("llega pronto -> devuelve la espera exacta", () => {
    const task = { windowStart: 600, windowEnd: 630 };
    expect(windowWait(task, 500, 0)).toBe(100);
  });
  it("llega dentro de la franja -> 0", () => {
    const task = { windowStart: 600, windowEnd: 630 };
    expect(windowWait(task, 615, 0)).toBe(0);
  });
  it("llega después de que cierre -> null (inviable)", () => {
    const task = { windowStart: 600, windowEnd: 630 };
    expect(windowWait(task, 631, 0)).toBeNull();
  });
  it("respeta dayOffset (franja se repite cada día)", () => {
    const task = { windowStart: 600, windowEnd: 630 };
    expect(windowWait(task, 1440 + 615, 1440)).toBe(0);
    expect(windowWait(task, 1440 + 615, 0)).toBeNull(); // sin offset, 1440+615 es muy tarde para el día 0
  });
  it("windowEnd ausente usa windowStart como instante único", () => {
    const task = { windowStart: 600 };
    expect(windowWait(task, 600, 0)).toBe(0);
    expect(windowWait(task, 601, 0)).toBeNull();
  });
});

// ── haversineKm ─────────────────────────────────────────────────────
describe("haversineKm", () => {
  it("calcula una distancia real conocida (Madrid-Barcelona, ~500km)", () => {
    const km = haversineKm(40.4168, -3.7038, 41.3874, 2.1686);
    expect(km).toBeGreaterThan(480);
    expect(km).toBeLessThan(520);
  });
  it("distancia de un punto a sí mismo es 0", () => {
    expect(haversineKm(43.46, -3.80, 43.46, -3.80)).toBe(0);
  });
  it("regresión: coordenadas null no calculan contra lat=0,lng=0 — devuelven 0", () => {
    // Bug real encontrado en producción: un vehículo virtual sin depósito
    // fijo (depotLat/depotLng null) hacía que +null se colara como 0 (finito)
    // en vez de "sin coordenadas", calculando ~4850km reales contra el golfo
    // de Guinea y rechazando huecos que en realidad eran perfectamente
    // válidos.
    expect(haversineKm(null, null, 43.4798498, -3.8359088)).toBe(0);
    expect(haversineKm(43.4798498, -3.8359088, null, null)).toBe(0);
  });
  it("undefined y NaN también devuelven 0", () => {
    expect(haversineKm(undefined, undefined, 43.46, -3.80)).toBe(0);
    expect(haversineKm(NaN, -3.80, 43.46, -3.80)).toBe(0);
  });
  it("es simétrica", () => {
    const a = haversineKm(40.4168, -3.7038, 41.3874, 2.1686);
    const b = haversineKm(41.3874, 2.1686, 40.4168, -3.7038);
    expect(a).toBeCloseTo(b, 9);
  });
});

describe("hasCoords", () => {
  it("acepta coordenadas válidas", () => {
    expect(hasCoords(43.46, -3.80)).toBe(true);
  });
  it("rechaza null, undefined, NaN y (0,0)", () => {
    expect(hasCoords(null, null)).toBe(false);
    expect(hasCoords(undefined, undefined)).toBe(false);
    expect(hasCoords(NaN, -3.80)).toBe(false);
    expect(hasCoords(0, 0)).toBe(false);
  });
});

// ── computeCandidateSlots / applyTaskMove ───────────────────────────
function mkStop(id, start, dur, lat, lng, window) {
  return {
    id, nombre: id, _start: start, _end: start + dur, duracion: dur, lat, lng,
    ...(window ? { windowStart: window[0], windowEnd: window[1] } : {}),
  };
}

describe("computeCandidateSlots", () => {
  it("encuentra el hueco libre entre dos paradas", () => {
    const task = mkStop("T1", 600, 15, 40.10, -3.70);
    const row = {
      _id: "v2", depotLat: 40.00, depotLng: -3.80, shiftStart: 360, shiftEnd: 1320,
      assignments: [
        mkStop("A", 400, 15, 40.05, -3.75),
        { _travel: true, _start: 415, _end: 420, duracion: 5, km: 2 },
        mkStop("B", 800, 15, 40.20, -3.60),
      ],
    };
    const slots = computeCandidateSlots(task, row, 0);
    const gap = slots.find(s => s.prevStop?.id === "A" && s.nextStop?.id === "B");
    expect(gap).toBeTruthy();
    expect(gap.arrival).toBeGreaterThanOrEqual(415);
    expect(gap.taskEnd + gap.outMin).toBeLessThanOrEqual(800);
  });

  it("descarta un hueco donde la tarea solaparía la siguiente parada", () => {
    const task = mkStop("T2", 600, 60, 40.10, -3.70); // 60 min, muy larga
    const row = {
      _id: "v2", depotLat: 40.00, depotLng: -3.80, shiftStart: 360, shiftEnd: 1320,
      assignments: [
        mkStop("A", 400, 15, 40.05, -3.75),
        mkStop("B", 420, 15, 40.06, -3.74), // hueco de solo unos minutos
      ],
    };
    const slots = computeCandidateSlots(task, row, 0);
    expect(slots.find(s => s.prevStop?.id === "A" && s.nextStop?.id === "B")).toBeUndefined();
  });

  it("calcula la espera si la tarea tiene franja horaria, y descarta si ya no se puede cumplir", () => {
    const task = mkStop("T3", 0, 15, 40.10, -3.70, [600, 630]);
    const rowOnTime = { _id: "v1", depotLat: 40.10, depotLng: -3.70, shiftStart: 360, shiftEnd: 1320, assignments: [] };
    const slots = computeCandidateSlots(task, rowOnTime, 0);
    expect(slots).toHaveLength(1);
    expect(slots[0].wait).toBe(600 - 360);
    expect(slots[0].arrival).toBe(600);

    const rowTooLate = { _id: "v2", depotLat: 40.10, depotLng: -3.70, shiftStart: 660, shiftEnd: 1320, assignments: [] };
    expect(computeCandidateSlots(task, rowTooLate, 0)).toHaveLength(0);
  });

  it("regresión: un vehículo virtual sin depósito (null) sí ofrece el hueco al principio/final del turno", () => {
    // Reproduce el caso real de SANTANDER (vehículo 6): antes del fix de
    // haversineKm, un vehículo sin depotLat/depotLng SIEMPRE rechazaba el
    // primer y último hueco del día por una distancia fantasma de miles de
    // km contra lat=0,lng=0.
    const task = mkStop("T4", 0, 15, 43.4798498, -3.8359088);
    const row = {
      _id: "v6", depotLat: null, depotLng: null, shiftStart: 360, shiftEnd: 1320,
      assignments: [
        mkStop("primera", 660, 15, 43.47, -3.81, [660, 750]),
      ],
    };
    const slots = computeCandidateSlots(task, row, 0);
    const startGap = slots.find(s => s.prevStop === null);
    expect(startGap).toBeTruthy();
    expect(startGap.kmDelta).toBeLessThan(20); // distancia real Santander, no miles de km
  });

  it("no ofrece un hueco que contiene una pausa programada", () => {
    const task = mkStop("T5", 600, 15, 40.10, -3.70);
    const row = {
      _id: "v1", depotLat: 40.00, depotLng: -3.80, shiftStart: 360, shiftEnd: 1320,
      assignments: [
        mkStop("A", 400, 15, 40.05, -3.75),
        { _break: true, _start: 420, _end: 450, duracion: 30 },
        mkStop("B", 800, 15, 40.20, -3.60),
      ],
    };
    const slots = computeCandidateSlots(task, row, 0);
    expect(slots.find(s => s.prevStop?.id === "A" && s.nextStop?.id === "B")).toBeUndefined();
  });

  it("regresión: no ofrece un hueco que cruza un relevo de conductor (turno partido)", () => {
    // Vehículo circular con relevo a las 840 (14:00, mañana/tarde). Un
    // hueco entre una parada que acaba en 820 (mañana) y otra que empieza
    // a las 860 (tarde) NO debe ofrecerse: el viaje que rellenaría ese
    // hueco quedaría a caballo entre los dos turnos — parte antes del
    // relevo, parte después — y al repartir las paradas por conductor ese
    // tramo de viaje se atribuiría mal o inflaría la jornada de uno de los
    // dos más allá de su propio horario (turnos "de más de 8h" reales).
    const task = mkStop("T6", 600, 15, 40.12, -3.72);
    const row = {
      _id: "v1", depotLat: null, depotLng: null, shiftStart: 360, shiftEnd: 1320,
      _shiftBreaks: [840],
      assignments: [
        mkStop("manana", 800, 15, 40.10, -3.70), // acaba a las 815, antes del relevo
        mkStop("tarde", 860, 15, 40.14, -3.74),   // empieza a las 860, después del relevo
      ],
    };
    const slots = computeCandidateSlots(task, row, 0);
    expect(slots.find(s => s.prevStop?.id === "manana" && s.nextStop?.id === "tarde")).toBeUndefined();
    // Pero sí debe seguir ofreciendo huecos que NO cruzan el relevo (antes
    // del todo, o al principio de la tarde tras la última parada).
    expect(slots.length).toBeGreaterThan(0);
  });
});

describe("applyTaskMove", () => {
  it("mueve la tarea al hueco elegido y cierra el hueco de origen con un viaje directo", () => {
    const task = mkStop("T1", 600, 15, 40.10, -3.70);
    const fromRow = { _id: "v1", depotLat: 40.10, depotLng: -3.70, shiftStart: 360, shiftEnd: 1320, assignments: [task] };
    const toRow = {
      _id: "v2", depotLat: 40.00, depotLng: -3.80, shiftStart: 360, shiftEnd: 1320,
      assignments: [
        mkStop("A", 400, 15, 40.05, -3.75),
        { _travel: true, _start: 415, _end: 420, duracion: 5, km: 2 },
        mkStop("B", 800, 15, 40.20, -3.60),
      ],
    };
    const slot = computeCandidateSlots(task, toRow, 0)
      .find(s => s.prevStop?.id === "A" && s.nextStop?.id === "B");
    const { newFromAssignments, newToAssignments, movedTask } = applyTaskMove(task, fromRow, toRow, slot, 0);

    expect(newFromAssignments).toHaveLength(0); // origen se queda vacío
    expect(movedTask._start).toBe(slot.arrival);
    const stops = newToAssignments.filter(a => !a._travel && !a._break && !a._wait).map(a => a.id);
    expect(stops).toEqual(["A", "T1", "B"]);
    const sorted = newToAssignments.every((a, i, arr) => i === 0 || arr[i - 1]._start <= a._start);
    expect(sorted).toBe(true);
  });

  it("reconecta los vecinos de origen con un único viaje directo tras quitar la tarea del medio", () => {
    const task = mkStop("T4", 500, 15, 50.0, 50.0);
    const fromRow = {
      _id: "v1", depotLat: 40.00, depotLng: -3.80, shiftStart: 360, shiftEnd: 1320,
      assignments: [
        mkStop("A", 400, 15, 40.05, -3.75),
        { _travel: true, _start: 415, _end: 480, duracion: 65, km: 900 },
        task,
        { _travel: true, _start: 515, _end: 580, duracion: 65, km: 900 },
        mkStop("B", 700, 15, 40.06, -3.74),
      ],
    };
    const toRow = { _id: "v2", depotLat: 50.0, depotLng: 50.0, shiftStart: 360, shiftEnd: 1320, assignments: [
      mkStop("C", 900, 15, 50.01, 50.01),
    ] };
    const slot = computeCandidateSlots(task, toRow, 0)[0];
    const { newFromAssignments } = applyTaskMove(task, fromRow, toRow, slot, 0);

    const stopsLeft = newFromAssignments.filter(a => !a._travel && !a._break && !a._wait).map(a => a.id);
    expect(stopsLeft).toEqual(["A", "B"]);
    const travelBlocks = newFromAssignments.filter(a => a._travel);
    expect(travelBlocks).toHaveLength(1);
    expect(travelBlocks[0]._start).toBe(415); // arranca justo al terminar A
  });
});

// ── generateScenario / autoScaleFleet (nivel integración) ───────────
function mkTask(id, lat, lng, windowStart, windowEnd) {
  return {
    id, nombre: id, lat, lng, duracion: 15,
    ...(windowStart != null ? { windowStart, windowEnd: windowEnd ?? windowStart + 60 } : {}),
  };
}
function mkVehicle(n, depotLat, depotLng) {
  return { _id: `v${n}`, nombre: `Vehículo ${n}`, turno: "Jornada completa", depotLat, depotLng };
}
const BASE_CONSTRAINTS = {
  maxShiftMin: 0, maxStops: 0, breakAfter: 0, breakDur: 0,
  startMin: 360, endMin: 1320, maxDays: 1, circular: false,
  optimizeWeight: 0, virtualShiftMin: 0,
};

describe("generateScenario", () => {
  it("asigna todas las tareas cuando hay margen de sobra (1 vehículo, pocas tareas cercanas)", async () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      mkTask(`t${i}`, 43.46 + i * 0.001, -3.80 + i * 0.001));
    const vehicles = [mkVehicle(1, 43.46, -3.80)];
    const r = await generateScenario(tasks, vehicles, BASE_CONSTRAINTS);
    expect(r.unassigned).toHaveLength(0);
    const stops = r.schedule[0].assignments.filter(a => !a._travel && !a._break && !a._wait);
    expect(stops).toHaveLength(10);
  });

  it("reparte tareas entre varios vehículos sin perder ninguna", async () => {
    const tasks = [
      ...Array.from({ length: 15 }, (_, i) => mkTask(`w${i}`, 43.30 + i * 0.001, -3.80)), // cluster oeste
      ...Array.from({ length: 15 }, (_, i) => mkTask(`e${i}`, 43.30 + i * 0.001, -3.60)), // cluster este
    ];
    const vehicles = [mkVehicle(1, 43.30, -3.80), mkVehicle(2, 43.30, -3.60)];
    const r = await generateScenario(tasks, vehicles, BASE_CONSTRAINTS);
    expect(r.unassigned).toHaveLength(0);
    const totalStops = r.schedule.reduce((s, v) =>
      s + v.assignments.filter(a => !a._travel && !a._break && !a._wait).length, 0);
    expect(totalStops).toBe(30);
  });

  it("respeta las franjas horarias: ninguna parada asignada llega antes de que abra ni después de que cierre", async () => {
    const tasks = [
      mkTask("morning", 43.46, -3.80, 400, 430),
      mkTask("noon",    43.461, -3.801, 700, 730),
      mkTask("evening", 43.462, -3.802, 1000, 1030),
    ];
    const vehicles = [mkVehicle(1, 43.46, -3.80)];
    const r = await generateScenario(tasks, vehicles, BASE_CONSTRAINTS);
    expect(r.unassigned).toHaveLength(0);
    const real = r.schedule[0].assignments.filter(a => !a._travel && !a._break && !a._wait);
    for (const a of real) {
      if (a.windowStart == null) continue;
      expect(a._start).toBeGreaterThanOrEqual(a.windowStart);
      expect(a._start).toBeLessThanOrEqual(a.windowEnd);
    }
  });

  it("una franja imposible de cumplir (cierra antes de que el turno empiece) queda sin asignar, no rompe nada", async () => {
    const tasks = [mkTask("impossible", 43.46, -3.80, 0, 10)]; // cierra a las 00:10, turno empieza a las 06:00
    const vehicles = [mkVehicle(1, 43.46, -3.80)];
    const r = await generateScenario(tasks, vehicles, BASE_CONSTRAINTS);
    expect(r.unassigned).toHaveLength(1);
    expect(r.unassigned[0].id).toBe("impossible");
  });

  it("sin vehículos, todas las tareas quedan sin asignar (no crashea)", async () => {
    const tasks = [mkTask("t0", 43.46, -3.80)];
    const r = await generateScenario(tasks, [], BASE_CONSTRAINTS);
    expect(r.unassigned).toHaveLength(1);
    expect(r.schedule).toHaveLength(0);
  });

  it("es determinista: misma entrada -> mismo resultado (sin aleatoriedad)", async () => {
    const tasks = Array.from({ length: 12 }, (_, i) =>
      mkTask(`t${i}`, 43.30 + (i % 4) * 0.01, -3.80 + Math.floor(i / 4) * 0.01));
    const vehicles = [mkVehicle(1, 43.30, -3.80), mkVehicle(2, 43.32, -3.78)];
    const r1 = await generateScenario(tasks, vehicles, BASE_CONSTRAINTS);
    const r2 = await generateScenario(tasks, vehicles, BASE_CONSTRAINTS);
    const ids = r => r.schedule.map(v => v.assignments.filter(a => !a._travel && !a._break && !a._wait).map(a => a.id));
    expect(ids(r1)).toEqual(ids(r2));
  });
});

describe("autoScaleFleet", () => {
  it("añade vehículos virtuales hasta cubrir tareas que un único vehículo no llega a hacer en el día", async () => {
    // Muchas más tareas de las que un solo vehículo puede hacer en su turno.
    const tasks = Array.from({ length: 120 }, (_, i) =>
      mkTask(`t${i}`, 43.30 + (i % 12) * 0.01, -3.80 + Math.floor(i / 12) * 0.01));
    const vehicles = [mkVehicle(1, 43.30, -3.80)];
    const { result, addedCount } = await autoScaleFleet(tasks, vehicles, BASE_CONSTRAINTS);
    expect(addedCount).toBeGreaterThan(0);
    expect(result.unassigned.length).toBeLessThan(tasks.length);
  }, 20000);

  it("no añade vehículos si la flota base ya cubre todo", async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => mkTask(`t${i}`, 43.46 + i * 0.001, -3.80));
    const vehicles = [mkVehicle(1, 43.46, -3.80)];
    const { result, addedCount } = await autoScaleFleet(tasks, vehicles, BASE_CONSTRAINTS);
    expect(addedCount).toBe(0);
    expect(result.unassigned).toHaveLength(0);
  });

  // Regresión del caso real de PALMA DE MALLORCA: el shrink pass exigía
  // sin-asignar <= mejor histórico EXACTO, así que si unas pocas tareas
  // quedaban sin poder encajar sin importar el tamaño de flota (franjas
  // horarias irreconciliables entre sí, no falta de capacidad), el bucle de
  // crecimiento seguía añadiendo vehículos persiguiéndolas y el shrink no
  // los podía quitar aunque no rescataran nada — la flota final quedaba muy
  // por encima de lo que las tareas SÍ asignables necesitaban de verdad.
  it("no infla la flota por unas pocas tareas que no van a encajar nunca, tenga los vehículos que tenga", async () => {
    // Núcleo: encaja exactamente en 4 vehículos (0 km de viaje, mismo punto),
    // sin margen de sobra — capacidad 960min/turno ÷ 15min/tarea = 64 tareas
    // por vehículo, 4×64 = 256.
    const core = Array.from({ length: 256 }, (_, i) => mkTask(`core${i}`, 43.46, -3.80));
    // Imposibles de verdad: la franja cierra antes de que empiece cualquier
    // turno (0-5, turno arranca a las 06:00) — ningún tamaño de flota las
    // arregla, es la misma dinámica que las franjas 09:00-10:00 de Palma
    // repartidas en barrios a los que ningún vehículo llega a tiempo.
    const impossible = Array.from({ length: 6 }, (_, i) => mkTask(`imposs${i}`, 43.50, -3.90, 0, 5));
    const vehicles = [mkVehicle(1, 43.46, -3.80)];
    const { result, resources } = await autoScaleFleet([...core, ...impossible], vehicles, BASE_CONSTRAINTS);
    expect(result.unassigned).toHaveLength(6); // solo las imposibles
    expect(result.unassigned.every(t => t.id.startsWith("imposs"))).toBe(true);
    // El núcleo exige exactamente 4 vehículos — la flota final no debería
    // quedarse muy por encima intentando en vano rescatar las 6 imposibles.
    expect(resources.length).toBeLessThanOrEqual(6);
  }, 20000);
});

// ── Reparto proporcional entre tramos de un mismo vehículo (turnos) ──
// Regresión del caso real de PALMA DE MALLORCA: con circular=true y
// virtualShiftMin fijo, un vehículo con relevo de turno (mañana + tarde)
// rellenaba el primer tramo vorazmente hasta el límite y el segundo se
// quedaba con las migajas, aunque el trabajo total ni de lejos llenara los
// dos — en datos reales, 25 de 32 turnos de tarde con menos de 15 paradas
// mientras la mañana iba casi llena al 90%. Tras el reparto proporcional
// por estimación de carga, bajó a 1 de 32.
describe("generateScenario — reparto entre tramos (turnos)", () => {
  it("reparte el trabajo entre mañana y tarde en vez de vaciar el primer tramo y dejar el segundo casi vacío", async () => {
    // 1 vehículo, turno partido en 2 tramos de 4h (240min) vía
    // virtualShiftMin — 20 tareas de 15min (300min de servicio) caben de
    // sobra en las 8h totales, pero NO en un único tramo de 4h (240min
    // solo da para ~16). Sin el reparto proporcional, casi todas caerían
    // en el primer tramo.
    const tasks = Array.from({ length: 20 }, (_, i) =>
      mkTask(`t${i}`, 43.30 + i * 0.001, -3.80 + i * 0.001));
    const vehicle = {
      _id: "v1", nombre: "V1", turno: "Jornada completa",
      depotLat: null, depotLng: null,
      _effectiveStart: 360, _effectiveEnd: 840, _shiftBreaks: [600], // 06-10 / 10-14
    };
    const constraints = {
      ...BASE_CONSTRAINTS, circular: true, endMin: 840, virtualShiftMin: 240,
    };
    const r = await generateScenario(tasks, [vehicle], constraints);
    expect(r.unassigned).toHaveLength(0);

    const stops = r.schedule[0].assignments.filter(a => !a._travel && !a._break && !a._wait);
    const tramo1 = stops.filter(a => a._start < 600).length;
    const tramo2 = stops.filter(a => a._start >= 600).length;
    expect(tramo1).toBeGreaterThan(0);
    expect(tramo2).toBeGreaterThan(0);
    // Ningún tramo debería quedarse con menos de un tercio del total
    // (20/3 ≈ 6.7) — antes del reparto proporcional, el segundo tramo se
    // quedaba con muchas menos.
    expect(Math.min(tramo1, tramo2)).toBeGreaterThanOrEqual(6);
  });

  it("el reparto proporcional no afecta a un vehículo con un único tramo (sin relevo)", async () => {
    // Sin _shiftBreaks (segEnds.length === 1), segTargets no debe entrar
    // en juego — mismo comportamiento de siempre.
    const tasks = Array.from({ length: 10 }, (_, i) => mkTask(`t${i}`, 43.30 + i * 0.001, -3.80));
    const vehicle = mkVehicle(1, 43.30, -3.80);
    const r = await generateScenario(tasks, [vehicle], BASE_CONSTRAINTS);
    expect(r.unassigned).toHaveLength(0);
    expect(r.schedule[0].assignments.filter(a => !a._travel && !a._break && !a._wait)).toHaveLength(10);
  });
});

// ── Reequilibrado de carga entre vehículos (post-generación) ────────
// Regresión del caso real de PALMA DE MALLORCA: incluso con el reparto
// proporcional por tramo, la geografía real deja algunos turnos con mucho
// menos trabajo que otros (algunos vehículos caen en zonas más dispersas).
// rebalanceLoad mueve paradas de los turnos por encima de la media a los
// que están muy por debajo, usando el mismo mecanismo que el movimiento
// manual del Gantt — verificado contra datos reales: 32→24 vehículos
// necesarios y la utilización media de cada turno subió de 83% a 97.6%.
describe("generateScenario — reequilibrado de carga entre vehículos", () => {
  it("mueve paradas de un vehículo sobrecargado a uno infra-cargado cuando compensa geográficamente", async () => {
    // 2 vehículos circulares con turno partido (2 tramos de 4h). Zona A:
    // 40 tareas muy juntas (un vehículo la satura fácil). Zona B: solo 6
    // tareas, cerca de A — sin reequilibrado, el vehículo de B se queda
    // con un turno casi vacío aunque A tenga de sobra para compartir.
    const zoneA = Array.from({ length: 40 }, (_, i) => mkTask(`a${i}`, 43.300 + (i % 8) * 0.001, -3.800 + Math.floor(i / 8) * 0.001));
    const zoneB = Array.from({ length: 6 }, (_, i) => mkTask(`b${i}`, 43.330 + i * 0.001, -3.770 + i * 0.001));
    const tasks = [...zoneA, ...zoneB];
    const vehicles = [
      { _id: "vA", nombre: "A", turno: "Jornada completa", depotLat: null, depotLng: null, _effectiveStart: 360, _effectiveEnd: 840, _shiftBreaks: [600] },
      { _id: "vB", nombre: "B", turno: "Jornada completa", depotLat: null, depotLng: null, _effectiveStart: 360, _effectiveEnd: 840, _shiftBreaks: [600] },
    ];
    const constraints = { ...BASE_CONSTRAINTS, circular: true, endMin: 840, virtualShiftMin: 240, optimizeWeight: 0 };
    const r = await generateScenario(tasks, vehicles, constraints);
    expect(r.unassigned.length).toBeLessThan(tasks.length * 0.1); // casi todo asignado

    const segSpans = [];
    for (const res of r.schedule) {
      for (const [lo, hi] of [[360, 600], [600, 840]]) {
        const seg = res.assignments.filter(a => a._start >= lo && a._start < hi);
        const stops = seg.filter(a => !a._travel && !a._break && !a._wait);
        if (!stops.length) continue;
        segSpans.push(Math.max(...seg.map(a => a._end)) - Math.min(...seg.map(a => a._start)));
      }
    }
    // Ningún turno con trabajo debería quedar por debajo de un tercio del
    // más cargado — sin el reequilibrado, un turno casi vacío (varios
    // minutos) frente a otro casi lleno (~240min) rompía esta proporción.
    const minSpan = Math.min(...segSpans), maxSpan = Math.max(...segSpans);
    expect(minSpan).toBeGreaterThan(maxSpan / 3);
  });
});
