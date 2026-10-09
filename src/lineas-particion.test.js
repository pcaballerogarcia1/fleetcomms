import { describe, it, expect } from "vitest";
import { particionTurnos, ordenPorClave } from "./lineas-particion.js";
import { generarServicio, generarVehiculos, generarTurnos, gruposTurnos, clavePieza } from "./lineas-sched.js";

const h = (hh, mm = 0) => hh * 60 + mm;

describe("turnos por partición de conjuntos", () => {
  it("ordena por bits igual que sort (también negativos y decimales)", () => {
    const c = Float64Array.from([3, -1.5, 0, 2.25, -7, 2.25, 10, -0.01]);
    const o = Array.from(ordenPorClave(c)).map(j => c[j]);
    expect(o).toEqual([...c].sort((a, b) => a - b));
  });

  it("cubre cada pieza exactamente una vez y encuentra la combinación óptima en un caso pequeño", () => {
    // A (6–10) puede ir con C (11–14) o con D (10:30–14:30); B (7–11) solo con D.
    // Voraz «la primera que encaja» haría A+C y dejaría B y D sueltas (3 turnos);
    // la mejor combinación es A+C… no: A+C y B+D = 2 turnos.
    const piezas = [
      { id: "A", inicio: h(6), fin: h(10), o: "X", d: "X" },
      { id: "B", inicio: h(7), fin: h(11), o: "X", d: "X" },
      { id: "C", inicio: h(11), fin: h(14), o: "X", d: "X" },
      { id: "D", inicio: h(11, 30), fin: h(14, 30), o: "X", d: "X" },
    ];
    // B solo puede ir con D (con C no hay sitio para el relevo)
    const valida = l => {
      const ids = l.map(x => x.id).join("");
      const ok = l.length === 1 || ["AC", "AD", "BD"].includes(ids);
      return ok ? { trabajo: l.reduce((s, x) => s + x.fin - x.inicio, 0) } : null;
    };
    const grupos = particionTurnos(piezas, { valida, coste: (e, l) => 600 + e.trabajo + l.length, relevo: 5, desplazamiento: 20, amplitudMax: 540, huecoNoPagado: 60 });
    const cubiertas = grupos.flat().sort();
    expect(cubiertas).toEqual([0, 1, 2, 3]); // todas, una vez
    expect(grupos).toHaveLength(2);
    expect(grupos.map(g => g.map(i => piezas[i].id).sort().join("")).sort()).toEqual(["AC", "BD"]);
  });

  it("en una red de verdad: todo cubierto una vez, turnos válidos y no peor que pieza a pieza", () => {
    const salidas = Array.from({ length: 70 }, (_, k) => h(5) + k * 16);
    const sentido = (dir, paradas) => ({
      dir, nombre: dir ? "Vuelta" : "Ida", paradas, km: 10, viajes: { laborable: salidas.length },
      salidas: { laborable: dir ? salidas.map(x => x + 7) : salidas, sabado: [], festivo: [] },
      tiempos: ["00-06", "06-09", "09-13", "13-16", "16-20", "20-24"].map(f => ({ franja: f, min: 35, viajes: 1 })),
    });
    const red = { lineas: [{ id: "L", nombre: "L", color: "#0ff", sentidos: [sentido(0, ["A", "B"]), sentido(1, ["B2", "A2"])] }] };
    const part = generarServicio(red, {}, { dia: "laborable", metodo: "particion" });
    const voraz = generarServicio(red, {}, { dia: "laborable", metodo: "voraz" });
    const viajes = part.turnos.flatMap(t => t.piezas.flatMap(pz => pz.viajes));
    expect(viajes.length).toBe(part.vehiculos.reduce((s, v) => s + v.viajes.length, 0));
    expect(new Set(viajes).size).toBe(viajes.length); // ninguno dos veces
    for (const t of part.turnos) {
      expect(t.avisos.filter(a => !/No encaja en ningún tipo/.test(a))).toEqual([]); // las reglas se cumplen
      t.piezas.slice(1).forEach((pz, i) => expect(pz.inicio).toBeGreaterThanOrEqual(t.piezas[i].fin));
    }
    // no más conductores ni más turnos sin tipo; las horas, casi iguales (Optimizar se queda con el mejor de los dos)
    expect(part.turnos.length).toBeLessThanOrEqual(voraz.turnos.length);
    expect(part.turnos.filter(t => t.tipo === null).length).toBeLessThanOrEqual(voraz.turnos.filter(t => t.tipo === null).length);
    const horas = r => r.turnos.reduce((s, t) => s + t.trabajo, 0);
    expect(horas(part)).toBeLessThanOrEqual(horas(voraz) * 1.02);
  });

  it("la partición hecha aparte (en el worker) da los mismos turnos que hacerla directamente", () => {
    const salidas = Array.from({ length: 50 }, (_, k) => h(5, 30) + k * 20);
    const sentido = dir => ({ dir, nombre: dir ? "Vuelta" : "Ida", paradas: dir ? ["B", "A"] : ["A", "B"], km: 8, viajes: { laborable: salidas.length }, salidas: { laborable: salidas.map(x => x + dir * 9), sabado: [], festivo: [] }, tiempos: ["00-06", "06-09", "09-13", "13-16", "16-20", "20-24"].map(f => ({ franja: f, min: 40, viajes: 1 })) });
    const red = { lineas: [{ id: "M", nombre: "M", color: "#f0f", sentidos: [sentido(0), sentido(1)] }] };
    const veh = generarVehiculos(red, {}, { dia: "laborable", metodo: "particion" });
    const directo = generarTurnos(veh, {});
    const aparte = generarTurnos(veh, {}, { grupos: gruposTurnos(veh, {}) });
    const firma = r => r.turnos.map(t => t.piezas.map(clavePieza).join(",")).sort();
    expect(firma(aparte)).toEqual(firma(directo));
  });

  it("con un máximo por tipo, la partición no se pasa (y aun así lo cubre todo)", () => {
    // 6 piezas que se pueden juntar de dos en dos (tipo 0) o ir solas (tipo 1); como mucho 1 del tipo 0
    const piezas = [0, 1, 2].flatMap(k => [{ inicio: h(6 + k), fin: h(9 + k), o: "X", d: "X" }, { inicio: h(10 + k), fin: h(13 + k), o: "X", d: "X" }]);
    const valida = l => (l.length <= 2 ? { trabajo: l.reduce((s, x) => s + x.fin - x.inicio, 0), n: l.length } : null);
    const opciones = { valida, coste: (e, l) => 600 + e.trabajo + l.length, desplazamiento: 20, amplitudMax: 540, huecoNoPagado: 60 };
    const libre = particionTurnos(piezas, opciones);
    expect(libre).toHaveLength(3); // sin tope: tres turnos de dos piezas
    const conTope = particionTurnos(piezas, { ...opciones, tipoDe: e => (e.n === 2 ? 0 : 1), topes: [1, Infinity] });
    expect(conTope.filter(g => g.length === 2).length).toBeLessThanOrEqual(1);
    expect(conTope.flat().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
