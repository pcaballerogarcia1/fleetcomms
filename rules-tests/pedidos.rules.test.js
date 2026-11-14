// Pedidos con fecha y fijos: solo la oficina de la empresa (de un proyecto suyo).
//
//   npm run test:rules
import { readFileSync } from "node:fs";
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, collection, query, where } from "firebase/firestore";

let env;
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-operanzia", firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") } });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "usuarios/jefeA"), { rol: "intermedio", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/condA"), { rol: "conductor", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/jefeB"), { rol: "admin", org_id: "orgB" });
    await setDoc(doc(db, "scheduling_projects/pA"), { org_id: "orgA", nombre: "Reparto" });
    await setDoc(doc(db, "scheduling_projects/pB"), { org_id: "orgB", nombre: "Otro" });
    await setDoc(doc(db, "pedidos/x1"), pedido());
  });
});
const como = uid => env.authenticatedContext(uid).firestore();
const pedido = (x = {}) => ({ org_id: "orgA", projectId: "pA", fecha: "2026-11-04", cliente: { nombre: "Bar", lat: 1, lng: 2 }, estado: "pendiente", ...x });

describe("pedidos", () => {
  it("la oficina los apunta, cambia y borra; el conductor no", async () => {
    await assertSucceeds(setDoc(doc(como("jefeA"), "pedidos/n1"), pedido()));
    await assertSucceeds(updateDoc(doc(como("jefeA"), "pedidos/x1"), { estado: "anulado" }));
    await assertSucceeds(getDocs(query(collection(como("jefeA"), "pedidos"), where("org_id", "==", "orgA"), where("projectId", "==", "pA"), where("fecha", "==", "2026-11-04"))));
    await assertFails(setDoc(doc(como("condA"), "pedidos/n2"), pedido()));
    await assertFails(getDocs(query(collection(como("condA"), "pedidos"), where("org_id", "==", "orgA"))));
    await assertSucceeds(deleteDoc(doc(como("jefeA"), "pedidos/x1")));
  });
  it("ni en el proyecto de otra empresa, ni los de otra empresa", async () => {
    await assertFails(setDoc(doc(como("jefeA"), "pedidos/n3"), pedido({ projectId: "pB" })));
    await assertFails(getDocs(query(collection(como("jefeB"), "pedidos"), where("org_id", "==", "orgA"))));
    await assertFails(updateDoc(doc(como("jefeB"), "pedidos/x1"), { estado: "anulado" }));
  });
  it("los fijos, igual", async () => {
    const f = { org_id: "orgA", projectId: "pA", cliente: { nombre: "Bar", lat: 1, lng: 2 }, dias: [1, 4] };
    await assertSucceeds(setDoc(doc(como("jefeA"), "pedidos_fijos/f1"), f));
    await assertFails(setDoc(doc(como("condA"), "pedidos_fijos/f2"), f));
    await assertFails(setDoc(doc(como("jefeB"), "pedidos_fijos/f3"), { ...f, org_id: "orgB" }));
  });
  it("el plan de la semana: la oficina de la empresa, en sus proyectos", async () => {
    const sem = { org_id: "orgA", projectId: "pA", lunes: "2026-11-16", plan: "{}" };
    await assertSucceeds(getDoc(doc(como("jefeA"), "semanas_reparto/pA_2026-11-16"))); // aún no existe
    await assertSucceeds(setDoc(doc(como("jefeA"), "semanas_reparto/pA_2026-11-16"), sem));
    await assertSucceeds(updateDoc(doc(como("jefeA"), "semanas_reparto/pA_2026-11-16"), { plan: "{\"a\":1}" }));
    await assertFails(updateDoc(doc(como("jefeA"), "semanas_reparto/pA_2026-11-16"), { projectId: "pB" }));
    await assertFails(getDoc(doc(como("jefeB"), "semanas_reparto/pA_2026-11-16")));
    await assertFails(setDoc(doc(como("condA"), "semanas_reparto/pA_2026-11-23"), sem));
    await assertFails(setDoc(doc(como("jefeA"), "semanas_reparto/pB_2026-11-16"), { ...sem, projectId: "pB" }));
  });
});
