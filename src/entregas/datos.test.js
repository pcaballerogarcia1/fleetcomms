import { describe, expect, it } from "vitest";
import { cuentaEntregas, estadoEntrega, faltaParaConfirmar, franjaTexto, idPrueba, queSeEntrega, registroEntrega } from "./datos.js";
import { taskToUbicacion } from "../publicar-rutas.js";
import { sectorDe } from "../sector.js";
import { conEntrega } from "./datos.js";

describe("prueba de entrega", () => {
  it("pide quién lo recibe y su firma, o dónde se deja y una foto, o el motivo", () => {
    expect(faltaParaConfirmar({})).toMatch(/Elige si/);
    expect(faltaParaConfirmar({ estado: "entregada", recibe: "" })).toMatch(/quién lo recibe/);
    expect(faltaParaConfirmar({ estado: "entregada", recibe: "Ana" })).toMatch(/firma/);
    expect(faltaParaConfirmar({ estado: "entregada", recibe: "Ana", firma: true })).toBe("");
    expect(faltaParaConfirmar({ estado: "entregada", sinFirma: true, recibe: "Portería" })).toMatch(/foto/);
    expect(faltaParaConfirmar({ estado: "entregada", sinFirma: true, recibe: "Portería", fotos: 1 })).toBe("");
    expect(faltaParaConfirmar({ estado: "no_entregada" })).toMatch(/motivo/);
    expect(faltaParaConfirmar({ estado: "no_entregada", motivo: "ausente" })).toBe("");
  });

  it("guarda lo justo, con la posición si la hay", () => {
    const r = registroEntrega({ estado: "entregada", recibe: "  Ana Pérez ", firma: true, fotos: 5, nota: " ok " }, { lat: 40.4167754, lng: -3.7037902, precision: 12.4 }, 1000);
    expect(r).toMatchObject({ estado: "entregada", motivo: null, recibe: "Ana Pérez", firma: true, sinFirma: false, fotos: 3, nota: "ok", lat: 40.416775, lng: -3.70379, precision: 12, en: 1000 });
    const n = registroEntrega({ estado: "no_entregada", motivo: "ausente", recibe: "x", firma: true }, null, 5);
    expect(n).toMatchObject({ estado: "no_entregada", motivo: "ausente", recibe: "", firma: false, lat: null });
  });

  it("cuenta y enseña", () => {
    const ubs = [{ realizado: true, entrega: { estado: "entregada" } }, { realizado: true, entrega: { estado: "no_entregada" } }, { realizado: false }];
    expect(ubs.map(estadoEntrega)).toEqual(["entregada", "no_entregada", "pendiente"]);
    expect(cuentaEntregas(ubs)).toEqual({ entregadas: 1, noEntregadas: 1, pendientes: 1 });
    expect(franjaTexto({ desde: 540, hasta: 660 })).toBe("09:00–11:00");
    expect(franjaTexto(null)).toBe("");
    expect(queSeEntrega({ pedido: "4471", bultos: "3", kg: "120" })).toBe("Pedido 4471 · 3 bultos · 120 kg");
    expect(idPrueba("p1", "u3", "foto", 2)).toBe("p1_u3_foto2");
  });

  it("solo el sector de reparto la usa", () => {
    expect(conEntrega(sectorDe("distribucion"))).toBe(true);
    expect(conEntrega(sectorDe("residuos"))).toBe(false);
    expect(conEntrega(sectorDe("otros"))).toBe(false);
  });

  it("al publicar, cada parada lleva su pedido, bultos, kilos y franja", () => {
    const u = taskToUbicacion({ nombre: "Bar Pepe", lat: 40.4, lng: -3.7, windowStart: 540, windowEnd: 600, campos: { "Nº pedido": "PE-4471", Bultos: "3", "Peso (kg)": "120,5" } }, 0);
    expect(u).toMatchObject({ pedido: "PE-4471", bultos: "3", kg: "120,5", franja: { desde: 540, hasta: 600 } });
    expect(taskToUbicacion({ nombre: "X", lat: 1, lng: 1 }, 1).franja).toBe(null);
  });
});
