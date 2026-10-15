// Concursos (licitaciones): la ficha es de la empresa y su trabajo vive en un
// espacio aislado «{org}--c-{id}» que solo ve la oficina de esa empresa.
//
//   npm run test:rules
import { readFileSync } from "node:fs";
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, getDocs, collection, query, where, addDoc, updateDoc } from "firebase/firestore";

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
    await setDoc(doc(db, "usuarios/interA"), { rol: "intermedio", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/condA"), { rol: "conductor", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/adminB"), { rol: "admin", org_id: "orgB" });
    await setDoc(doc(db, "concursos/c1"), { org_id: "orgA", nombre: "RSU Salamanca", espacio: "orgA--c-c1" });
    await setDoc(doc(db, "scheduling_vehicles/vc"), { org_id: "orgA--c-c1", nombre: "Camión del concurso" });
  });
});
const como = uid => env.authenticatedContext(uid).firestore();
const ESP = "orgA--c-c1";

describe("concursos", () => {
  it("la ficha: la oficina de la empresa sí; conductores y otras empresas no", async () => {
    await assertSucceeds(getDoc(doc(como("adminA"), "concursos/c1")));
    await assertSucceeds(getDoc(doc(como("interA"), "concursos/c1")));
    await assertFails(getDoc(doc(como("condA"), "concursos/c1")));
    await assertFails(getDoc(doc(como("adminB"), "concursos/c1")));
    await assertSucceeds(addDoc(collection(como("adminA"), "concursos"), { org_id: "orgA", nombre: "Bus Getafe" }));
    await assertFails(addDoc(collection(como("adminA"), "concursos"), { org_id: "orgB", nombre: "x" }));
    await assertFails(updateDoc(doc(como("adminA"), "concursos/c1"), { org_id: "orgB" }));
  });
  it("su espacio aislado: vehículos, proyecto y cuadrante solo para la oficina de la empresa", async () => {
    await assertSucceeds(getDoc(doc(como("adminA"), "scheduling_vehicles/vc")));
    await assertSucceeds(getDocs(query(collection(como("adminA"), "scheduling_vehicles"), where("org_id", "==", ESP))));
    await assertSucceeds(addDoc(collection(como("adminA"), "scheduling_workers"), { org_id: ESP, nombre: "Conductor 1" }));
    await assertSucceeds(setDoc(doc(como("adminA"), "scheduling_projects/pc"), { org_id: ESP, nombre: "RSU Salamanca", concurso: "c1" }));
    await assertSucceeds(setDoc(doc(como("adminA"), `rostering/${ESP}_2026_10`), { org_id: ESP, year: 2026, month: 10 }));
    await assertSucceeds(getDoc(doc(como("adminA"), `rostering_vehicles/${ESP}_2026_11`))); // aún sin crear
    await assertFails(getDoc(doc(como("adminB"), `rostering_vehicles/${ESP}_2026_11`)));
    await assertFails(getDoc(doc(como("condA"), "scheduling_vehicles/vc")));
    await assertFails(getDoc(doc(como("adminB"), "scheduling_vehicles/vc")));
    await assertFails(getDocs(query(collection(como("adminB"), "scheduling_vehicles"), where("org_id", "==", ESP))));
  });
  it("nadie se cuela con un espacio de otra empresa o mal formado", async () => {
    await assertFails(addDoc(collection(como("adminB"), "scheduling_vehicles"), { org_id: ESP, nombre: "x" }));
    await assertFails(addDoc(collection(como("adminA"), "scheduling_vehicles"), { org_id: "orgB--c-c9", nombre: "x" }));
    await assertFails(addDoc(collection(como("adminA"), "scheduling_vehicles"), { org_id: "orgA--c-c1_x", nombre: "x" }));
    await assertFails(addDoc(collection(como("adminA"), "scheduling_vehicles"), { org_id: "orgAx--c-c1", nombre: "x" }));
  });
  it("sus documentos (pliegos): solo la oficina de la empresa", async () => {
    await assertSucceeds(setDoc(doc(como("adminA"), "concursos/c1/documentos/d1"), { nombre: "pliego.pdf", lectura: { datos: [] } }));
    await assertSucceeds(setDoc(doc(como("adminA"), "concursos/c1/documentos/d1/texto/0"), { i: 0, t: "[]" }));
    await assertSucceeds(getDoc(doc(como("interA"), "concursos/c1/documentos/d1/texto/0")));
    await assertFails(getDoc(doc(como("condA"), "concursos/c1/documentos/d1")));
    await assertFails(getDoc(doc(como("adminB"), "concursos/c1/documentos/d1/texto/0")));
    await assertFails(setDoc(doc(como("adminB"), "concursos/c1/documentos/d2"), { nombre: "x" }));
  });
});
