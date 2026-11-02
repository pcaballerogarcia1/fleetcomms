// Prueba de entrega: el conductor sube las fotos y la firma de una parada a
// su nombre; las ve su empresa (no otra); solo la oficina las borra.
//
//   npm run test:rules
import { readFileSync } from "node:fs";
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { Bytes, doc, getDoc, setDoc, deleteDoc, getDocs, collection, query, where } from "firebase/firestore";

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
    await setDoc(doc(db, "usuarios/condB"), { rol: "conductor", org_id: "orgB" });
    await setDoc(doc(db, "entregas_pruebas/p1_u3_firma0"), prueba());
  });
});
const como = uid => env.authenticatedContext(uid).firestore();
const prueba = (x = {}) => ({ org_id: "orgA", planId: "p1", ubicId: "u3", tipo: "firma", k: 0, mime: "image/jpeg", data: Bytes.fromUint8Array(new Uint8Array([1, 2, 3])), uid: "condA", en: 1, ...x });

describe("entregas_pruebas", () => {
  it("el conductor sube las suyas (y puede reenviarlas)", async () => {
    await assertSucceeds(setDoc(doc(como("condA"), "entregas_pruebas/p1_u3_foto0"), prueba({ tipo: "foto" })));
    await assertSucceeds(setDoc(doc(como("condA"), "entregas_pruebas/p1_u3_foto0"), prueba({ tipo: "foto" })));
  });
  it("no a nombre de otro, ni de otro tipo, ni con otro id, ni de otra empresa", async () => {
    await assertFails(setDoc(doc(como("condA"), "entregas_pruebas/p1_u3_foto1"), prueba({ tipo: "foto", k: 1, uid: "otro" })));
    await assertFails(setDoc(doc(como("condA"), "entregas_pruebas/p1_u3_video0"), prueba({ tipo: "video" })));
    await assertFails(setDoc(doc(como("condA"), "entregas_pruebas/cualquiera"), prueba({ tipo: "foto" })));
    await assertFails(setDoc(doc(como("condB"), "entregas_pruebas/p1_u3_foto0"), prueba({ tipo: "foto", uid: "condB" })));
    await assertFails(setDoc(doc(como("condA"), "entregas_pruebas/p1_u3_foto2"), prueba({ tipo: "foto", k: 2, data: "texto" })));
  });
  it("la ve su empresa; otra no; solo la oficina la borra", async () => {
    await assertSucceeds(getDocs(query(collection(como("jefeA"), "entregas_pruebas"), where("org_id", "==", "orgA"), where("planId", "==", "p1"), where("ubicId", "==", "u3"))));
    await assertSucceeds(getDoc(doc(como("condA"), "entregas_pruebas/p1_u3_firma0")));
    await assertFails(getDoc(doc(como("condB"), "entregas_pruebas/p1_u3_firma0")));
    await assertFails(deleteDoc(doc(como("condA"), "entregas_pruebas/p1_u3_firma0")));
    await assertSucceeds(deleteDoc(doc(como("jefeA"), "entregas_pruebas/p1_u3_firma0")));
  });
});
