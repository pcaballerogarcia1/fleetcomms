// Documentos (ITs, DPTs…): la oficina los gestiona; cada trabajador lee los
// activos que van a todos o a él (también su archivo) y confirma su lectura.
//
//   npm run test:rules
import { readFileSync } from "node:fs";
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, getDocs, collection, query, where } from "firebase/firestore";

let env;
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-operanzia", firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") } });
});
afterAll(async () => { await env?.cleanup(); });
const base = { org_id: "orgA", titulo: "IT-01", categoria: "IT", version: 1, activo: true, archivo: { n: 1, v: "x" } };
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "usuarios/adminA"), { rol: "admin", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/jefeA"), { rol: "intermedio", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/condA"), { rol: "conductor", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/condA2"), { rol: "conductor", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/condB"), { rol: "conductor", org_id: "orgB" });
    await setDoc(doc(db, "documentos/todos"), { ...base, paraTodos: true, paraUids: [] });
    await setDoc(doc(db, "documentos/todos/trozos/x_0"), { org_id: "orgA", v: "x", i: 0, data: "…" });
    await setDoc(doc(db, "documentos/solo2"), { ...base, paraTodos: false, paraUids: ["condA2"] });
    await setDoc(doc(db, "documentos/solo2/trozos/x_0"), { org_id: "orgA", v: "x", i: 0, data: "…" });
    await setDoc(doc(db, "documentos/archivado"), { ...base, activo: false, paraTodos: true, paraUids: [] });
  });
});
const como = uid => env.authenticatedContext(uid).firestore();

describe("documentos", () => {
  it("la oficina sube y borra; el trabajador no", async () => {
    await assertSucceeds(setDoc(doc(como("jefeA"), "documentos/nuevo"), { ...base, paraTodos: true, paraUids: [] }));
    await assertSucceeds(setDoc(doc(como("jefeA"), "documentos/nuevo/trozos/x_0"), { org_id: "orgA", v: "x", i: 0, data: "…" }));
    await assertFails(setDoc(doc(como("condA"), "documentos/otro"), { ...base, paraTodos: true, paraUids: [] }));
    await assertFails(setDoc(doc(como("jefeA"), "documentos/sinLista"), { ...base, paraTodos: true }));
    await assertSucceeds(deleteDoc(doc(como("adminA"), "documentos/archivado")));
  });
  it("el trabajador ve los de todos y los suyos, con su archivo; no los de otros ni los archivados", async () => {
    await assertSucceeds(getDocs(query(collection(como("condA"), "documentos"), where("org_id", "==", "orgA"), where("activo", "==", true), where("paraTodos", "==", true))));
    await assertSucceeds(getDocs(query(collection(como("condA2"), "documentos"), where("org_id", "==", "orgA"), where("activo", "==", true), where("paraUids", "array-contains", "condA2"))));
    await assertSucceeds(getDoc(doc(como("condA"), "documentos/todos/trozos/x_0")));
    await assertFails(getDoc(doc(como("condA"), "documentos/solo2")));
    await assertFails(getDoc(doc(como("condA"), "documentos/solo2/trozos/x_0")));
    await assertSucceeds(getDoc(doc(como("condA2"), "documentos/solo2/trozos/x_0")));
    await assertFails(getDoc(doc(como("condA"), "documentos/archivado")));
    await assertFails(getDoc(doc(como("condB"), "documentos/todos")));
  });
  it("cada uno confirma su lectura de un documento que es para él", async () => {
    const l = { org_id: "orgA", docId: "todos", uid: "condA", nombre: "Carlos", version: 1, leidoAt: 1 };
    await assertSucceeds(setDoc(doc(como("condA"), "documentos_lecturas/todos_condA"), l));
    await assertFails(setDoc(doc(como("condA"), "documentos_lecturas/todos_condA2"), { ...l, uid: "condA2" }));
    await assertFails(setDoc(doc(como("condA"), "documentos_lecturas/solo2_condA"), { ...l, docId: "solo2" }));
    await assertSucceeds(getDoc(doc(como("jefeA"), "documentos_lecturas/todos_condA")));
    await assertFails(getDoc(doc(como("condA2"), "documentos_lecturas/todos_condA")));
    await assertFails(deleteDoc(doc(como("condA"), "documentos_lecturas/todos_condA")));
  });
});
