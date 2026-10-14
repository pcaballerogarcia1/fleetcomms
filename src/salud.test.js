import { describe, it, expect, vi } from "vitest";
vi.mock("./firebase.js", () => ({ db: {}, auth: {} }));
import { errorKey, textoCongelada, textoCargaLenta } from "./error-report.js";
import { resumenSalud } from "./salud.js";
import { claveError, decidir, mensajeAlerta, CADA_MS, MAX_DIA } from "../api/_salud/alertas.js";
import { aValor, desdeValor, desdeCampos, inicioDiaCuota, consumoHoy, firestore } from "../api/_salud/google.js";
import { generateKeyPairSync } from "node:crypto";

describe("alertas de errores al móvil del superadmin", () => {
  it("agrupa igual que el panel", () => {
    const st = "Error: x\n    at f (https://app/x.js:10:5)";
    expect(claveError("Fallo 123 en ruta 45", st)).toBe(errorKey("Fallo 123 en ruta 45", st));
    expect(claveError("Fallo 1", st)).toBe(claveError("Fallo 99", st));
  });
  it("avisa del primero; el mismo error no más de una vez cada 6 h; tope diario; las pantallas lentas no avisan", () => {
    const e = { tipo: "excepción", mensaje: "x" };
    const t = 1_000_000_000_000;
    expect(decidir(e, null, null, t).avisar).toBe(true);
    expect(decidir(e, { ultimo: t - 1000 }, null, t).avisar).toBe(false);
    expect(decidir(e, { ultimo: t - CADA_MS - 1 }, null, t).avisar).toBe(true);
    expect(decidir(e, null, { n: MAX_DIA }, t).avisar).toBe(false);
    expect(decidir({ ...e, tipo: "lentitud" }, null, null, t).avisar).toBe(false);
    expect(decidir(null, null, null, t).avisar).toBe(false);
  });
  it("el aviso dice quién, dónde y qué", () => {
    const m = mensajeAlerta({ nombre: "Ana", org_id: "fcc", pagina: "/scheduling", mensaje: "Cannot read x" }, "FCC Salamanca", 3);
    expect(m.titulo).toBe("⚠️ Error en Operanzia (/scheduling)");
    expect(m.cuerpo).toBe("Ana · FCC Salamanca: Cannot read x · ya había pasado 3 vez/veces");
    expect(m.url).toBe("/superadmin");
  });
});

describe("acceso del servidor a Google", () => {
  it("traduce los valores de Firestore REST", () => {
    const d = { a: "x", b: 3, c: 1.5, d: true, e: null, f: [1, "y"], g: { h: 2 } };
    expect(desdeCampos(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, aValor(v)])))).toEqual(d);
    expect(desdeValor({ timestampValue: "2026-10-14T10:00:00Z" })).toBe("2026-10-14T10:00:00Z");
  });
  it("el día de cuota empieza a medianoche de California", () => {
    expect(inicioDiaCuota(new Date("2026-10-14T10:00:00Z"))).toBe("2026-10-14T07:00:00.000Z"); // PDT (UTC-7)
    expect(inicioDiaCuota(new Date("2026-10-14T05:00:00Z"))).toBe("2026-10-13T07:00:00.000Z");
    expect(inicioDiaCuota(new Date("2026-12-14T10:00:00Z"))).toBe("2026-12-14T08:00:00.000Z"); // PST (UTC-8)
  });
  it("lee el consumo y los documentos con la cuenta de servicio", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const sa = { project_id: "p1", client_email: "sa@p1.iam", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) };
    const llamadas = [];
    const f = vi.fn(async (url, op = {}) => {
      llamadas.push(url);
      const json = d => ({ ok: true, status: 200, json: async () => d });
      if (url.startsWith("https://oauth2")) { expect(op.body).toMatch(/assertion=/); return json({ access_token: "tok", expires_in: 3600 }); }
      if (url.includes("monitoring")) {
        const n = url.includes("read_count") ? 1200 : url.includes("write_count") ? 300 : 7;
        return json({ timeSeries: [{ points: [{ value: { int64Value: String(n) } }] }] });
      }
      if (url.endsWith("/usuarios/u1")) return json({ fields: { rol: { stringValue: "superadmin" } } });
      if (url.endsWith("/no")) return { ok: false, status: 404, json: async () => ({}) };
      throw new Error("inesperado " + url);
    });
    const c = await consumoHoy(sa, f, new Date("2026-10-14T10:00:00Z"));
    expect(c).toMatchObject({ lecturas: 1200, escrituras: 300, borrados: 7, limites: { lecturas: 50000 } });
    const fs = firestore(sa, f);
    expect(await fs.leer("usuarios/u1")).toEqual({ rol: "superadmin" });
    expect(await fs.leer("no")).toBe(null);
    expect(llamadas.filter(u => u.startsWith("https://oauth2")).length).toBeLessThanOrEqual(2); // el token se reutiliza
  });
});

describe("panel Salud", () => {
  it("cuenta errores recientes por cliente y versión, y separa las pantallas lentas", () => {
    const ahora = 10 * 86400_000;
    const e = (h, extra) => ({ atMs: ahora - h * 3600_000, mensaje: "x", stack: "", tipo: "excepción", org_id: "a", version: "v1", ...extra });
    const r = resumenSalud([e(1), e(30, { org_id: "b" }), e(200), e(2, { tipo: "lentitud", mensaje: textoCongelada(2500, "/scheduling") })], ahora);
    expect(r).toMatchObject({ h24: 1, d7: 2, lentos7: 1 });
    expect(r.porOrg).toEqual([["a", 1], ["b", 1]]);
    expect(r.lentas[0].ejemplo.mensaje).toBe("Pantalla congelada 2,5 s en /scheduling");
    expect(textoCargaLenta(7200, "/planning")).toBe("Carga lenta: 7,2 s hasta ver /planning");
  });
});
