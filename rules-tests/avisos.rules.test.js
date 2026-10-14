// Avisos al móvil, inventario de contenedores y pesadas: quién puede qué,
// contra el emulador y las reglas reales.
//
//   npm run test:rules
import { readFileSync } from "node:fs";
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, getDocs, collection, query, where, addDoc, deleteDoc } from "firebase/firestore";

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
    await setDoc(doc(db, "usuarios/adminA"), { rol: "admin", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/condA"), { rol: "conductor", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/condA2"), { rol: "conductor", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/adminB"), { rol: "admin", org_id: "orgB" });
    await setDoc(doc(db, "scheduling_projects/pA"), { org_id: "orgA", nombre: "Proyecto" });
    await setDoc(doc(db, "avisos_suscripciones/condA2"), { uid: "condA2", org_id: "orgA", subs: [{ endpoint: "https://x/1" }] });
  });
});
const como = uid => env.authenticatedContext(uid).firestore();
const sub = { uid: "condA", org_id: "orgA", subs: [{ endpoint: "https://x/2" }] };

describe("avisos_suscripciones", () => {
  it("cada uno da de alta la suya, no la de otro ni en otra org", async () => {
    await assertSucceeds(setDoc(doc(como("condA"), "avisos_suscripciones/condA"), sub));
    await assertFails(setDoc(doc(como("condA"), "avisos_suscripciones/condA3"), { ...sub, uid: "condA3" }));
    await assertFails(setDoc(doc(como("condA"), "avisos_suscripciones/condA"), { ...sub, org_id: "orgB" }));
    await assertSucceeds(getDoc(doc(como("condA"), "avisos_suscripciones/condA"))); // la propia, aunque no exista aún
  });
  it("la oficina de su org las lee (para enviar) y quita caducadas; otro conductor u otra org no", async () => {
    await assertSucceeds(getDoc(doc(como("adminA"), "avisos_suscripciones/condA2")));
    await assertSucceeds(getDocs(query(collection(como("adminA"), "avisos_suscripciones"), where("org_id", "==", "orgA"))));
    await assertSucceeds(updateDoc(doc(como("adminA"), "avisos_suscripciones/condA2"), { subs: [] }));
    await assertFails(updateDoc(doc(como("adminA"), "avisos_suscripciones/condA2"), { org_id: "orgB" }));
    await assertFails(getDoc(doc(como("condA"), "avisos_suscripciones/condA2")));
    await assertFails(getDoc(doc(como("adminB"), "avisos_suscripciones/condA2")));
    await assertFails(deleteDoc(doc(como("adminA"), "avisos_suscripciones/condA2")));
  });
});

describe("inventario de contenedores y pesadas", () => {
  it("el inventario es de la oficina de la org del proyecto", async () => {
    await assertSucceeds(setDoc(doc(como("adminA"), "planning_inventario/pA"), { org_id: "orgA", v: "1" }));
    await assertSucceeds(setDoc(doc(como("adminA"), "planning_inventario/pA/trozos/1_0"), { projectId: "pA" }));
    await assertFails(getDoc(doc(como("condA"), "planning_inventario/pA")));
    await assertFails(getDoc(doc(como("adminB"), "planning_inventario/pA")));
  });
  it("las pesadas las apunta cualquiera de la org; corregir o borrar, solo la oficina", async () => {
    const p = { org_id: "orgA", mes: "2026-10", fecha: "2026-10-14", kg: 8000 };
    const ref = await assertSucceeds(addDoc(collection(como("condA"), "pesadas"), p));
    await assertFails(addDoc(collection(como("condA"), "pesadas"), { ...p, org_id: "orgB" }));
    await assertFails(updateDoc(doc(como("condA"), "pesadas", ref.id), { kg: 1 }));
    await assertSucceeds(updateDoc(doc(como("adminA"), "pesadas", ref.id), { kg: 7900 }));
    await assertFails(getDoc(doc(como("adminB"), "pesadas", ref.id)));
  });
});
