// Conexión con el GPS de la empresa (gps_conexiones/{orgId}): la lee la
// oficina de esa empresa, solo un administrador la cambia, nadie de fuera.
//
//   npm run test:rules
import { readFileSync } from "node:fs";
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";

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
const conexion = { org_id: "orgA", proveedor: "webfleet", cred: { cuenta: "a", usuario: "u", clave: "c" }, activa: true };

describe("gps_conexiones", () => {
  it("el administrador la crea y la cambia; en su empresa, no en otra", async () => {
    await assertSucceeds(getDoc(doc(como("adminA"), "gps_conexiones/orgA"))); // aunque aún no exista
    await assertSucceeds(setDoc(doc(como("adminA"), "gps_conexiones/orgA"), conexion));
    await assertFails(setDoc(doc(como("adminA"), "gps_conexiones/orgB"), { ...conexion, org_id: "orgB" }));
    await assertFails(setDoc(doc(como("adminA"), "gps_conexiones/orgB"), conexion)); // id y org_id distintos
    await assertSucceeds(deleteDoc(doc(como("adminA"), "gps_conexiones/orgA")));
  });
  it("la oficina la lee pero no la cambia; ni conductores ni otras empresas la ven", async () => {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), "gps_conexiones/orgA"), conexion));
    await assertSucceeds(getDoc(doc(como("jefeA"), "gps_conexiones/orgA")));
    await assertFails(setDoc(doc(como("jefeA"), "gps_conexiones/orgA"), { ...conexion, activa: false }));
    await assertFails(getDoc(doc(como("condA"), "gps_conexiones/orgA")));
    await assertFails(getDoc(doc(como("adminB"), "gps_conexiones/orgA")));
    await assertFails(setDoc(doc(como("adminB"), "gps_conexiones/orgA"), conexion));
  });
});
