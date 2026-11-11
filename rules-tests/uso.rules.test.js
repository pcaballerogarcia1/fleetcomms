// Tiempo de uso por persona y mes (src/uso-tiempo.js): cada uno suma a su
// propia ficha; la ven el admin de su empresa y el superadmin.
//
//   npm run test:rules
import { readFileSync } from "node:fs";
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, collection, query, where, increment } from "firebase/firestore";

let env;
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-operanzia", firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") } });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "usuarios/adminA"), { rol: "admin", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/jefeA"), { rol: "intermedio", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/condA"), { rol: "conductor", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/adminB"), { rol: "admin", org_id: "orgB" });
  });
});
const como = uid => env.authenticatedContext(uid).firestore();
const suma = (uid, x = {}) => ({ org_id: "orgA", uid, mes: "2026-11", nombre: "X", rol: "", minutos: increment(5), dias: { 11: increment(5) }, ...x });

describe("uso_mes", () => {
  it("cada uno suma a la suya (también el conductor); nunca a la de otro ni en otra empresa", async () => {
    await assertSucceeds(setDoc(doc(como("condA"), "uso_mes/orgA_condA_2026-11"), suma("condA"), { merge: true }));
    await assertSucceeds(setDoc(doc(como("condA"), "uso_mes/orgA_condA_2026-11"), suma("condA"), { merge: true }));
    await assertFails(setDoc(doc(como("condA"), "uso_mes/orgA_jefeA_2026-11"), suma("jefeA"), { merge: true }));
    await assertFails(setDoc(doc(como("condA"), "uso_mes/orgB_condA_2026-11"), suma("condA", { org_id: "orgB" }), { merge: true }));
    await assertFails(setDoc(doc(como("condA"), "uso_mes/otro-id"), suma("condA"), { merge: true }));
  });
  it("la ve el admin de su empresa; ni el jefe, ni el conductor, ni otra empresa", async () => {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), "uso_mes/orgA_condA_2026-11"), { org_id: "orgA", uid: "condA", mes: "2026-11", minutos: 10 }));
    await assertSucceeds(getDocs(query(collection(como("adminA"), "uso_mes"), where("org_id", "==", "orgA"), where("mes", "in", ["2026-11", "2026-10"]))));
    await assertFails(getDoc(doc(como("jefeA"), "uso_mes/orgA_condA_2026-11")));
    await assertFails(getDoc(doc(como("condA"), "uso_mes/orgA_condA_2026-11")));
    await assertFails(getDoc(doc(como("adminB"), "uso_mes/orgA_condA_2026-11")));
  });
});
