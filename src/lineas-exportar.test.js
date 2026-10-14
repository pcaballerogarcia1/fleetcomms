import { describe, it, expect } from "vitest";
import { generarServicio } from "./lineas-sched.js";
import { hojasExcel, hojasDeServicio, hojasDeAutobus, hojaPasos, cuadrosPorParada } from "./lineas-exportar.js";

const h = (hh, mm = 0) => hh * 60 + mm;
const sentido = (dir, paradas, salidas) => ({ dir, nombre: dir ? "Vuelta" : "Ida", cabecera: dir ? "Plaza" : "Estación", paradas, km: 10, viajes: { laborable: salidas.length }, salidas: { laborable: salidas, sabado: [], festivo: [] },
  tiempos: ["06-09", "09-13", "13-16", "16-20"].map(f => ({ franja: f, min: 40, viajes: 1 })) });
const RED = { paradas: [{ id: "P", nombre: "Plaza", lat: 40.4, lng: -3.7 }, { id: "E", nombre: "Estación", lat: 40.42, lng: -3.7 }],
  lineas: [{ id: "A", nombre: "A", color: "#f00", sentidos: [sentido(0, ["P", "E"], [h(7), h(8), h(9)]), sentido(1, ["E", "P"], [h(7, 45), h(8, 45), h(9, 45)])] }] };

describe("exportar", () => {
  const res = generarServicio(RED, {}, { dia: "laborable", tiposTurno: [], costeHora: 20 });
  const nombreParada = id => RED.paradas.find(p => p.id === id)?.nombre || id;
  it("Excel: autobuses, turnos, resumen y nómina", () => {
    const x = hojasExcel(res, { nombreParada, nombreTipo: t => t || "—" });
    expect(x.autobuses.length).toBeGreaterThanOrEqual(6);
    expect(x.resumen).toHaveLength(res.turnos.length);
    expect(x.nomina[0]).toHaveProperty("Total €");
    expect(x.nomina.reduce((s, f) => s + f["Total €"], 0)).toBeGreaterThan(0);
    expect(x.detalle[0]).toMatchObject({ Desde: expect.any(String), Hasta: expect.any(String) });
  });
  it("PDF: una hoja por turno, por autobús, y los horarios de parada", () => {
    const datos = { nombreParada, proyecto: "Prueba <S.A.>", dia: "Laborable" };
    const t = hojasDeServicio(res, datos);
    expect((t.match(/class="hoja"/g) || []).length).toBe(res.turnos.length);
    expect(t).toContain("Prueba &lt;S.A.&gt;"); // sin colar HTML
    expect(hojasDeAutobus(res, datos)).toContain("Autobús");
    const s = RED.lineas[0].sentidos[0];
    expect(hojaPasos(RED, RED.lineas[0], s, [h(7), h(8)], {}, datos)).toContain("07:40");
    expect(cuadrosPorParada(RED, RED.lineas[0], s, [h(7), h(8)], {}, datos)).toContain("Plaza");
  });
});
