import { describe, it, expect } from "vitest";
import { validar, cerrarTurno, entrePiezas } from "./lineas-sched/turnos.js";
import { PARAMS_DEFECTO } from "./lineas-sched/base.js";

// Sin tipos de turno: solo las reglas generales
const P = { ...PARAMS_DEFECTO, tiposTurno: [] };
// Cabecera A (Leganés) y B, a unos 11 km en línea recta (~15 km por carretera → 36 min a 25 km/h)
const A = [40.33, -3.76], B = [40.43, -3.76];
const pieza = (vehiculo, inicio, fin, o, d, oLL, dLL) => ({
  vehiculo, inicio, fin, conduccion: fin - inicio, o, d, oLL, dLL,
  viajes: [{ dep: inicio, arr: fin, o, d, vacio: false }],
});

describe("ir de una cabecera a otra entre piezas", () => {
  it("se tarda lo que dice la distancia (no 20 min fijos)", () => {
    const e = entrePiezas(pieza(1, 360, 480, "A", "A", A, A), pieza(2, 520, 640, "B", "B", B, B), P);
    expect(e.cambio).toBe(true);
    expect(e.km).toBeGreaterThan(14);
    expect(e.viaje).toBeGreaterThan(30);
  });
  it("si no da tiempo a llegar, la pieza no entra en el turno", () => {
    expect(validar([pieza(1, 360, 480, "A", "A", A, A), pieza(2, 505, 640, "B", "B", B, B)], P)).toBeNull(); // 25 min: no llega
    expect(validar([pieza(1, 360, 480, "A", "A", A, A), pieza(2, 530, 640, "B", "B", B, B)], P)).not.toBeNull();
  });
  it("el viaje es trabajo y no cuenta como pausa", () => {
    const t = cerrarTurno({ piezas: [pieza(1, 360, 480, "A", "A", A, A), pieza(2, 530, 640, "B", "B", B, B)] }, P);
    expect(t.desplazamientos).toHaveLength(1);
    const viaje = t.desplazamientos[0].fin - t.desplazamientos[0].inicio;
    expect(viaje).toBeGreaterThan(30);
    expect(t.trabajo).toBe(640 - 360); // hueco corto: se paga entero
    // partido: hueco de 2 h, de los que ~36 min son de viaje (pagados)
    const p2 = cerrarTurno({ piezas: [pieza(1, 360, 480, "A", "A", A, A), pieza(2, 600, 720, "B", "B", B, B)] }, P);
    expect(p2.partidos).toBe(1);
    expect(p2.trabajo).toBe(120 + 120 + viaje);
  });
  it("en la misma cabecera, solo el relevo", () => {
    const e = entrePiezas(pieza(1, 360, 480, "A", "A", A, A), pieza(2, 490, 600, "A", "A", A, A), P);
    expect(e).toMatchObject({ cambio: true, viaje: 0, hace: P.relevoMin });
  });
});

describe("cambios de autobús por turno", () => {
  const dos = [pieza(1, 360, 480, "A", "A", A, A), pieza(2, 490, 600, "A", "A", A, A)];
  const mismo = [pieza(1, 360, 480, "A", "A", A, A), pieza(1, 490, 600, "A", "A", A, A)];
  it("sin límite: puede cambiar de autobús", () => {
    expect(validar(dos, P)).not.toBeNull();
  });
  it("con 0: todo el turno en el mismo autobús", () => {
    const p0 = { ...P, maxCambiosBus: 0 };
    expect(validar(dos, p0)).toBeNull();
    expect(validar(mismo, p0)).not.toBeNull();
    expect(cerrarTurno({ piezas: dos }, p0).avisos.some(a => /cambios de autobús/.test(a))).toBe(true);
  });
});

describe("cambio de autobús según el tipo de turno", () => {
  const tipo = (id, partido, cambiosBus) => ({ id, nombre: id, activo: true, desde: 0, hasta: 1439, trabajoMin: 60, trabajoMax: 600, amplitudMax: 900, partido, cambiosBus });
  const partido = [pieza(1, 360, 600, "A", "A", A, A), pieza(2, 900, 1140, "A", "A", A, A)]; // 5 h de hueco, otro autobús
  const seguido = [pieza(1, 360, 480, "A", "A", A, A), pieza(2, 490, 600, "A", "A", A, A)];
  it("el partido que permite cambio de bus puede volver en otro autobús; el seguido que no, no", () => {
    const p = { ...P, tiposTurno: [tipo("continuo", false, 0), tipo("partido", true, null)] };
    const t = cerrarTurno({ piezas: partido }, p);
    expect(t.tipo).toBe("partido");
    expect(t.cambiosBus).toBe(1);
    // seguido con cambio de autobús: el único continuo no lo permite → sin tipo y con aviso
    const c = cerrarTurno({ piezas: seguido }, p);
    expect(c.tipo).toBeNull();
    expect(cerrarTurno({ piezas: [seguido[0], { ...seguido[1], vehiculo: 1 }] }, p).tipo).toBe("continuo"); // en el mismo autobús, sí
  });
  it("si ningún tipo permite cambiar, el partido tampoco puede", () => {
    const p = { ...P, tiposTurno: [tipo("partido", true, 0)] };
    expect(validar(partido, p)).toBeNull();
  });
});

describe("no mezclar líneas en un turno", () => {
  const conLinea = (pz, nombre) => ({ ...pz, lineas: [nombre], viajes: pz.viajes.map(v => ({ ...v, nombre })) });
  const a = conLinea(pieza(1, 360, 480, "A", "A", A, A), "481"), b = conLinea(pieza(2, 490, 600, "A", "A", A, A), "482");
  const b481 = conLinea(pieza(2, 490, 600, "A", "A", A, A), "481");
  it("sin la restricción se pueden juntar piezas de dos líneas", () => {
    expect(validar([a, b], P)).not.toBeNull();
  });
  it("con la restricción, solo de la misma línea", () => {
    const p1 = { ...P, turnoUnaLinea: true };
    expect(validar([a, b], p1)).toBeNull();
    expect(validar([a, b481], p1)).not.toBeNull();
    expect(cerrarTurno({ piezas: [a, b] }, p1).avisos.some(x => /Mezcla líneas: 481, 482/.test(x))).toBe(true);
  });
});

describe("el mismo autobús después de pasar por cochera", () => {
  it("no cuenta como cambio de autobús (otra salida de cochera, mismo autobús físico)", () => {
    const manana = { ...pieza(1, 360, 600, "K", "K", A, A), autobus: 7 }, tarde = { ...pieza(2, 900, 1140, "K", "K", A, A), autobus: 7 };
    expect(entrePiezas(manana, tarde, P).cambio).toBe(false);
    expect(entrePiezas(manana, { ...tarde, autobus: 8 }, P).cambio).toBe(true);
  });
});

describe("grupos de líneas", async () => {
  const { autobusPuedeSeguir, claveMezclaTurno } = await import("./lineas-sched/base.js");
  const grupos = [{ id: "leg", nombre: "Leganés", lineas: ["481", "484"] }, { id: "fue", nombre: "Fuenlabrada", lineas: ["491"] }];
  it("un autobús: cualquier línea, solo su grupo, o la misma", () => {
    expect(autobusPuedeSeguir({ entreLineas: true, mezclaBuses: "libre", gruposLineas: grupos })("481", "491")).toBe(true);
    const g = autobusPuedeSeguir({ entreLineas: true, mezclaBuses: "grupo", gruposLineas: grupos });
    expect(g("481", "484")).toBe(true);
    expect(g("481", "491")).toBe(false);
    expect(g("482", "483")).toBe(false); // sin grupo: cada una el suyo
    expect(autobusPuedeSeguir({ entreLineas: false, gruposLineas: grupos })("481", "484")).toBe(false);
  });
  it("un conductor: solo líneas de un grupo", () => {
    const p = { ...P, mezclaTurnos: "grupo", gruposLineas: grupos };
    expect(claveMezclaTurno(p)("484")).toBe(claveMezclaTurno(p)("481"));
    const conLinea = (pz, nombre) => ({ ...pz, lineas: [nombre], viajes: pz.viajes.map(v => ({ ...v, nombre })) });
    const a = conLinea(pieza(1, 360, 480, "A", "A", A, A), "481");
    expect(validar([a, conLinea(pieza(2, 490, 600, "A", "A", A, A), "484")], p)).not.toBeNull();
    expect(validar([a, conLinea(pieza(2, 490, 600, "A", "A", A, A), "491")], p)).toBeNull();
    expect(cerrarTurno({ piezas: [a, conLinea(pieza(2, 490, 600, "A", "A", A, A), "491")] }, p).avisos.some(x => /distintos grupos/.test(x))).toBe(true);
  });
});

describe("toma y deje de servicio", () => {
  const K = [40.30, -3.76]; // cochera a ~3,3 km de A (≈ 11 min a 25 km/h)
  const conCochera = pz => ({ ...pz, cocheraLL: K });
  it("los minutos de toma y deje son trabajo y amplitud", () => {
    const p = { ...P, tomaServicio: 10, dejeServicio: 15 };
    const t = cerrarTurno({ piezas: [pieza(1, 360, 600, "A", "A", A, A)] }, p);
    expect(t.trabajo).toBe(240 + 25);
    expect(t.duracion).toBe(240 + 25);
    expect(t.toma).toMatchObject({ inicio: 350, fin: 360 });
    expect(t.deje).toMatchObject({ inicio: 600, fin: 615 });
  });
  it("presentándose en cochera, el viaje hasta la cabecera también cuenta", () => {
    const p = { ...P, presentacionEnCochera: true };
    const t = cerrarTurno({ piezas: [conCochera(pieza(1, 360, 600, "A", "A", A, A))] }, p);
    expect(t.toma.viaje).toBeGreaterThan(5);
    expect(t.trabajo).toBe(240 + t.toma.viaje + t.deje.viaje);
    // si la pieza ya sale de cochera, no hay viaje
    const sale = { ...conCochera(pieza(1, 360, 600, "A", "A", A, A)), saleDeCochera: true, vuelveACochera: true };
    expect(cerrarTurno({ piezas: [sale] }, p).trabajo).toBe(240);
  });
  it("si con la toma y el deje pasa de la jornada máxima, no cabe", () => {
    const p = { ...P, tiposTurno: [], aplicar561: false, jornadaMax: 480, tomaServicio: 15, dejeServicio: 15 };
    expect(validar([pieza(1, 360, 820, "A", "A", A, A)], p)).toBeNull(); // 460 + 30 > 480
    expect(validar([pieza(1, 360, 800, "A", "A", A, A)], p)).not.toBeNull();
  });
});
