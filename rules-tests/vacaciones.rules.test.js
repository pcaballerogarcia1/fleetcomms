// Vacaciones y permisos (solicitudes_ausencia): el trabajador pide y retira
// las suyas; la oficina aprueba o rechaza; nadie de fuera las ve.
//
//   npm run test:rules
import { readFileSync } from "node:fs";
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where } from "firebase/firestore";

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
    await setDoc(doc(db, "usuarios/condA2"), { rol: "conductor", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/adminB"), { rol: "admin", org_id: "orgB" });
  });
});
const como = uid => env.authenticatedContext(uid).firestore();
const nueva = { org_id: "orgA", uid: "condA", nombre: "Carlos", tipo: "vacaciones", desde: "2026-11-02", hasta: "2026-11-06", dias: 5, comentario: "", estado: "pendiente", creadaAt: 1 };
const sembrar = datos => env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), "solicitudes_ausencia/s1"), datos));

describe("solicitudes_ausencia", () => {
  it("el trabajador pide las suyas, pendientes y sin campos de más", async () => {
    await assertSucceeds(setDoc(doc(como("condA"), "solicitudes_ausencia/n1"), nueva));
    await assertFails(setDoc(doc(como("condA"), "solicitudes_ausencia/n2"), { ...nueva, uid: "condA2" }));
    await assertFails(setDoc(doc(como("condA"), "solicitudes_ausencia/n3"), { ...nueva, estado: "aprobada" }));
    await assertFails(setDoc(doc(como("condA"), "solicitudes_ausencia/n4"), { ...nueva, resueltaPor: { uid: "condA" } }));
    await assertFails(setDoc(doc(como("condA"), "solicitudes_ausencia/n5"), { ...nueva, org_id: "orgB" }));
  });
  it("ve las suyas; la oficina las de su empresa; nadie más", async () => {
    await sembrar(nueva);
    await assertSucceeds(getDocs(query(collection(como("condA"), "solicitudes_ausencia"), where("org_id", "==", "orgA"), where("uid", "==", "condA"))));
    await assertSucceeds(getDoc(doc(como("jefeA"), "solicitudes_ausencia/s1")));
    await assertFails(getDoc(doc(como("condA2"), "solicitudes_ausencia/s1")));
    await assertFails(getDoc(doc(como("adminB"), "solicitudes_ausencia/s1")));
  });
  it("la oficina aprueba o rechaza una pendiente; el trabajador no", async () => {
    await sembrar(nueva);
    await assertFails(updateDoc(doc(como("condA"), "solicitudes_ausencia/s1"), { estado: "aprobada" }));
    await assertFails(updateDoc(doc(como("jefeA"), "solicitudes_ausencia/s1"), { estado: "aprobada", desde: "2026-01-01" }));
    await assertSucceeds(updateDoc(doc(como("jefeA"), "solicitudes_ausencia/s1"), { estado: "aprobada", resueltaPor: { uid: "jefeA" }, resueltaAt: 2 }));
    await assertFails(updateDoc(doc(como("adminA"), "solicitudes_ausencia/s1"), { estado: "rechazada", motivo: "x" })); // ya contestada
    await assertFails(deleteDoc(doc(como("adminA"), "solicitudes_ausencia/s1")));
  });
  it("el trabajador retira la suya solo mientras está pendiente", async () => {
    await sembrar(nueva);
    await assertFails(updateDoc(doc(como("condA2"), "solicitudes_ausencia/s1"), { estado: "cancelada", canceladaAt: 3 }));
    await assertSucceeds(updateDoc(doc(como("condA"), "solicitudes_ausencia/s1"), { estado: "cancelada", canceladaAt: 3 }));
    await sembrar({ ...nueva, estado: "aprobada" });
    await assertFails(updateDoc(doc(como("condA"), "solicitudes_ausencia/s1"), { estado: "cancelada", canceladaAt: 4 }));
  });
});
