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
