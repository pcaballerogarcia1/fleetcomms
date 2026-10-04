// Proyectos de "Líneas regulares" contra el emulador y las reglas reales:
// guardar la red (lineas-store.js), seguirla aunque aún no exista, y la
// configuración por línea.
//
//   npm run test:rules

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

const h = vi.hoisted(() => ({ db: null }));
vi.mock("../src/firebase.js", () => ({ get db() { return h.db; } }));

let env;
const RED = {
  paradas: [{ id: "P1", nombre: "A", codigo: "1", lat: 40.4, lng: -3.7 }, { id: "P2", nombre: "B", codigo: "2", lat: 40.41, lng: -3.71 }],
  lineas: [{ id: "L1", nombre: "1", largo: "", color: "#fff", tipo: "Autobús", agencia: "X", sentidos: [{ dir: 0, nombre: "Ida", cabecera: "B", paradas: ["P1", "P2"], trazado: [[40.4, -3.7], [40.41, -3.71]], km: 1.4, viajes: { laborable: 10, sabado: 5, festivo: 0 }, primera: "06:00", ultima: "22:00", tiempos: [{ franja: "06-09", min: 20, viajes: 3 }] }] }],
  dias: { laborable: "2026-10-05", sabado: null, festivo: null }, agencias: ["X"], viajesPartidos: 0,
};

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-operanzia",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "usuarios/adminA"), { rol: "admin", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/adminB"), { rol: "admin", org_id: "orgB" });
    await setDoc(doc(db, "scheduling_projects/pL"), { org_id: "orgA", nombre: "Bus", tipo: "lineas" });
  });
});
async function sinReglas(fn) { let r; await env.withSecurityRulesDisabled(async ctx => { r = await fn(ctx.firestore()); }); return r; }
const leer = p => sinReglas(async db => (await getDoc(doc(db, p))).data());

describe("red de líneas con las reglas reales", () => {
  it("un administrador guarda la red y la configuración de una línea", async () => {
    h.db = env.authenticatedContext("adminA").firestore();
    const { guardarRed, guardarCfgLinea } = await import("../src/lineas-store.js");
    await guardarRed("pL", "orgA", RED, { archivo: "red.zip" });
    expect(await leer("planning_layers/pL_red")).toMatchObject({ type: "red_lineas", projectId: "pL", totalLineas: 1 });
    await guardarCfgLinea("pL", "L1", { tipos: ["articulado"], preferente: "articulado", tiempos: { "0|06-09": 25 } });
    expect((await leer("planning_settings/pL")).lineasCfg.L1).toMatchObject({ preferente: "articulado", tiempos: { "0|06-09": 25 } });
    await guardarCfgLinea("pL", "L1", { preferente: null, tiempos: { "0|06-09": null } });
    const cfg = (await leer("planning_settings/pL")).lineasCfg.L1;
    expect(cfg.preferente).toBeUndefined();
    expect(cfg.tiempos["0|06-09"]).toBeUndefined();
  });

  it("seguir la red de un proyecto que aún no la tiene no da error de permisos", async () => {
    h.db = env.authenticatedContext("adminA").firestore();
    const { watchRed } = await import("../src/lineas-store.js");
    const r = await new Promise(res => { const off = watchRed("pL", e => { off(); res(e); }); });
    expect(r).toMatchObject({ ficha: null, red: null, cargando: false });
    expect(r.error).toBeUndefined();
  });

  it("otra organización no puede escribir la red", async () => {
    h.db = env.authenticatedContext("adminB").firestore();
    const { guardarRed } = await import("../src/lineas-store.js");
    await expect(guardarRed("pL", "orgB", RED)).rejects.toThrow();
  });
});
