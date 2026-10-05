// Dos personas escribiendo A LA VEZ, contra el emulador y las reglas reales:
// nadie pierde lo suyo (concurrencia.js y los sitios que lo usan).
//
//   npm run test:rules

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, arrayUnion, deleteField, FieldPath, serverTimestamp } from "firebase/firestore";

const h = vi.hoisted(() => ({ db: null }));
vi.mock("../src/firebase.js", () => ({ get db() { return h.db; } }));

let env;
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
    await setDoc(doc(db, "orgs/orgA"), { nombre: "A" });
    await setDoc(doc(db, "usuarios/adminA"), { rol: "admin", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/interA"), { rol: "intermedio", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/condA"), { rol: "conductor", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/condA2"), { rol: "conductor", org_id: "orgA" });
    await setDoc(doc(db, "scheduling_projects/pA"), { org_id: "orgA", nombre: "Proyecto" });
    await setDoc(doc(db, "planes/plan1"), {
      org_id: "orgA", nombre: "Ruta", ubicaciones: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, realizado: false })),
    });
    await setDoc(doc(db, "incidencias/inc1"), { org_id: "orgA", titulo: "Pinchazo", comentarios: [] });
  });
});
async function leer(p) { let r; await env.withSecurityRulesDisabled(async ctx => { r = (await getDoc(doc(ctx.firestore(), p))).data(); }); return r; }
const como = uid => env.authenticatedContext(uid).firestore();
// arranca una operación del módulo con la sesión de `uid` (el módulo lee db al empezar)
function con(uid, fn) { h.db = como(uid); return fn(); }

describe("dos personas a la vez no se pisan", () => {
  it("marcar paradas distintas del mismo plan: se conservan todas", async () => {
    const { cambiarEnLista } = await import("../src/concurrencia.js");
    const marcar = u => ({ ...u, realizado: true });
    // seis marcados a la vez, alternando dos conductores y la oficina
    const quien = ["condA", "condA2", "adminA", "condA", "condA2", "adminA"];
    await Promise.all(quien.map((uid, i) => con(uid, () => cambiarEnLista(doc(h.db, "planes/plan1"), "ubicaciones", i + 1, marcar, []))));
    const plan = await leer("planes/plan1");
    expect(plan.ubicaciones.every(u => u.realizado)).toBe(true);
  });

  it("comentarios de una incidencia a la vez: están todos", async () => {
    await Promise.all(["condA", "condA2", "adminA", "interA"].map(uid =>
      updateDoc(doc(como(uid), "incidencias/inc1"), { comentarios: arrayUnion({ usuarioId: uid, texto: `de ${uid}`, fecha: 1 }) })));
    expect((await leer("incidencias/inc1")).comentarios.map(c => c.usuarioId).sort()).toEqual(["adminA", "condA", "condA2", "interA"]);
  });

  it("añadir depots o cocheras a la vez: están todas", async () => {
    const { cambiarCocheras } = await import("../src/lineas-store.js");
    await Promise.all(Array.from({ length: 5 }, (_, i) =>
      con(i % 2 ? "adminA" : "interA", () => cambiarCocheras("pA", "orgA", l => [...l, { id: `c${i}`, nombre: `Cochera ${i}`, lat: 40, lng: -3 }]))));
    expect((await leer("planning_depots/pA")).depots.map(c => c.id).sort()).toEqual(["c0", "c1", "c2", "c3", "c4"]);
  });

  it("cambios a mano del Scheduling de líneas a la vez: no se pierde ninguno", async () => {
    const { cambiarManuales } = await import("../src/lineas-store.js");
    await Promise.all(Array.from({ length: 4 }, (_, i) =>
      con(i % 2 ? "adminA" : "interA", () => cambiarManuales("pA", "laborable", l => [...l, { tipo: "pieza", clave: `p${i}`, destino: i }]))));
    const ops = (await leer("planning_settings/pA")).lineasSched.porCalendario.laborable.manuales;
    expect(ops.map(o => o.clave).sort()).toEqual(["p0", "p1", "p2", "p3"]);
  });

  it("reglas de Rostering: cada uno escribe solo lo suyo (regla, horas de un trabajador)", async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), "rostering/orgA_reglas"), { org_id: "orgA", rules: { a: 1, b: 1 }, horasPorTrabajador: { w1: 10, w2: 20 } });
    });
    // lo mismo que hace saveRules: mergeFields con solo los campos cambiados
    await Promise.all([
      setDoc(doc(como("adminA"), "rostering/orgA_reglas"), { org_id: "orgA", updatedAt: serverTimestamp(), rules: { a: 2 } },
        { mergeFields: ["org_id", "updatedAt", new FieldPath("rules", "a")] }),
      setDoc(doc(como("interA"), "rostering/orgA_reglas"), { org_id: "orgA", updatedAt: serverTimestamp(), horasPorTrabajador: { w2: deleteField(), w3: 30 } },
        { mergeFields: ["org_id", "updatedAt", new FieldPath("horasPorTrabajador", "w2"), new FieldPath("horasPorTrabajador", "w3")] }),
    ]);
    const r = await leer("rostering/orgA_reglas");
    expect(r.rules).toEqual({ a: 2, b: 1 });
    expect(r.horasPorTrabajador).toEqual({ w1: 10, w3: 30 });
  });
});
