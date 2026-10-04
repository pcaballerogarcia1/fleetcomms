// Duplicar un proyecto (src/project-copy.js) contra el emulador y las reglas
// reales: un administrador puede copiar todo; un usuario intermedio copia
// todo menos los precios; nadie puede duplicar un proyecto de otra org.
//
//   npm run test:rules

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, getDocs, collection, Bytes } from "firebase/firestore";

const h = vi.hoisted(() => ({ db: null }));
// La sesión cambia en cada test: el módulo simulado lee siempre la actual
vi.mock("../src/firebase.js", () => ({ get db() { return h.db; } }));

let env;
const USERS = {
  adminA: { rol: "admin", org_id: "orgA", nombre: "Ana" },
  interA: { rol: "intermedio", org_id: "orgA", nombre: "Iván" },
  adminB: { rol: "admin", org_id: "orgB", nombre: "Bea" },
};
const bytes = n => Bytes.fromUint8Array(new Uint8Array(n).fill(7));

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
    for (const [uid, u] of Object.entries(USERS)) await setDoc(doc(db, "usuarios", uid), u);
    await setDoc(doc(db, "scheduling_projects/pA"), { org_id: "orgA", nombre: "ROMA", mes: "2026-10" });
    // 450 entradas de timetable: más de un lote
    for (let i = 0; i < 450; i++) await setDoc(doc(db, "scheduling_projects/pA/timetable", `p${i}`), { duracion: i % 9 });
    await setDoc(doc(db, "planning_layers/pA_1"), { id: 1, name: "Pequeña", markers: [{ lat: 1, lng: 2 }], projectId: "pA", orgId: "orgA" });
    await setDoc(doc(db, "planning_layers/pA_2"), { id: 2, name: "Grande", markers: [], cloud: { v: "a", n: 2 }, projectId: "pA", orgId: "orgA" });
    await setDoc(doc(db, "planning_layers/pA_2/trozos/a_0"), { projectId: "pA", v: "a", i: 0, data: bytes(800_000) });
    await setDoc(doc(db, "planning_layers/pA_2/trozos/a_1"), { projectId: "pA", v: "a", i: 1, data: bytes(1000) });
    await setDoc(doc(db, "planning_depots/pA"), { depots: [{ nombre: "COCHERA" }], projectId: "pA", orgId: "orgA" });
    await setDoc(doc(db, "planning_settings/pA"), { defaultDuracion: 6 });
    await setDoc(doc(db, "precios/pA"), { org_id: "orgA", projectId: "pA", defaultPrecio: 5 });
    await setDoc(doc(db, "precios/pA/trozos/0"), { org_id: "orgA", projectId: "pA", map: { k: 2 } });
    await setDoc(doc(db, "scheduling_scenarios/pA"), { org_id: "orgA", projectId: "pA", v: "s1", n: 1 });
    await setDoc(doc(db, "scheduling_scenarios/pA/trozos/s1_0"), { projectId: "pA", v: "s1", i: 0, data: bytes(900_000) });
    await setDoc(doc(db, "scheduling_roster/pA"), { parts: 1 });
    await setDoc(doc(db, "scheduling_roster/pA/partes/g_0"), { stamp: "g", i: 0 });
  });
});

async function duplicarComo(uid, newId) {
  h.db = env.authenticatedContext(uid).firestore();
  const { duplicarProyecto } = await import("../src/project-copy.js");
  return duplicarProyecto({ _id: "pA", org_id: "orgA" }, "ROMA (copia)", { newId });
}
// withSecurityRulesDisabled no devuelve el resultado de la función: se saca por fuera
async function sinReglas(fn) { let r; await env.withSecurityRulesDisabled(async ctx => { r = await fn(ctx.firestore()); }); return r; }
const leer = p => sinReglas(async db => (await getDoc(doc(db, p))).data());
const contar = p => sinReglas(async db => (await getDocs(collection(db, p))).size);

describe("duplicar proyecto con las reglas reales", () => {
  it("un administrador copia todo", async () => {
    const { avisos } = await duplicarComo("adminA", "pCopia");
    expect(avisos).toEqual([]);
    expect(await leer("scheduling_projects/pCopia")).toMatchObject({ nombre: "ROMA (copia)", org_id: "orgA", duplicadoDe: "pA" });
    expect(await contar("scheduling_projects/pCopia/timetable")).toBe(450);
    expect(await leer("planning_layers/pCopia_2")).toMatchObject({ projectId: "pCopia", cloud: { v: "a", n: 2 } });
    expect((await leer("planning_layers/pCopia_2/trozos/a_0")).data.toUint8Array().length).toBe(800_000);
    expect(await leer("planning_depots/pCopia")).toMatchObject({ projectId: "pCopia" });
    expect(await leer("precios/pCopia/trozos/0")).toMatchObject({ map: { k: 2 }, projectId: "pCopia" });
    expect(await leer("scheduling_scenarios/pCopia")).toMatchObject({ v: "s1", projectId: "pCopia" });
    expect(await contar("scheduling_scenarios/pCopia/trozos")).toBe(1);
    expect(await contar("scheduling_roster/pCopia/partes")).toBe(1);
  });

  it("un intermedio copia todo menos los precios (con aviso)", async () => {
    const { avisos } = await duplicarComo("interA", "pCopia2");
    expect(avisos.join(" ")).toMatch(/precios no se han copiado/);
    expect(await leer("precios/pCopia2")).toBeUndefined();
    expect(await leer("scheduling_scenarios/pCopia2")).toMatchObject({ v: "s1" });
  });

  it("otra organización no puede duplicarlo", async () => {
    await expect(duplicarComo("adminB", "pRobo")).rejects.toThrow();
    expect(await leer("scheduling_projects/pRobo")).toBeUndefined();
  });
});
