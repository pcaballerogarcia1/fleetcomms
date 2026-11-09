// Conectar con IA: lo que deja la empresa (ia_ajustes) y las conexiones de
// cada usuario (ia_conexiones).
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
    await setDoc(doc(db, "usuarios/adminA"), { rol: "admin", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/jefeA"), { rol: "intermedio", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/condA"), { rol: "conductor", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/adminB"), { rol: "admin", org_id: "orgB" });
    await setDoc(doc(db, "usuarios/jefeB"), { rol: "intermedio", org_id: "orgB" });
    await setDoc(doc(db, "ia_ajustes/orgA"), ajustes());
    await setDoc(doc(db, "ia_conexiones/c1"), conexion());
  });
});
const como = uid => env.authenticatedContext(uid).firestore();
const ajustes = (x = {}) => ({ org_id: "orgA", activa: true, nivel: "leer", roles: ["admin", "intermedio"], ...x });
const conexion = (x = {}) => ({ org_id: "orgA", uid: "jefeA", nombre: "Jefe", cliente: "ChatGPT", nivel: "leer", activa: true, creado: "2026-11-09T10:00:00Z", ultimoUso: "2026-11-09T10:00:00Z", ...x });

describe("ia_ajustes", () => {
  it("los ve la empresa (también si aún no existen); solo su admin los cambia", async () => {
    await assertSucceeds(getDoc(doc(como("condA"), "ia_ajustes/orgA")));
    await assertSucceeds(getDoc(doc(como("jefeB"), "ia_ajustes/orgB"))); // no existe todavía
    await assertFails(getDoc(doc(como("adminB"), "ia_ajustes/orgA")));
    await assertSucceeds(setDoc(doc(como("adminA"), "ia_ajustes/orgA"), ajustes({ nivel: "actuar" })));
    await assertSucceeds(setDoc(doc(como("adminB"), "ia_ajustes/orgB"), ajustes({ org_id: "orgB" })));
    await assertFails(setDoc(doc(como("jefeA"), "ia_ajustes/orgA"), ajustes({ nivel: "actuar" })));
    await assertFails(setDoc(doc(como("adminB"), "ia_ajustes/orgA"), ajustes()));
    await assertFails(setDoc(doc(como("adminA"), "ia_ajustes/orgA"), ajustes({ nivel: "todo" })));
    await assertFails(deleteDoc(doc(como("adminA"), "ia_ajustes/orgA")));
  });
});

describe("ia_conexiones", () => {
  it("el usuario crea la suya si su empresa lo tiene activado; nunca a nombre de otro", async () => {
    await assertSucceeds(setDoc(doc(como("jefeA"), "ia_conexiones/n1"), conexion()));
    await assertFails(setDoc(doc(como("jefeA"), "ia_conexiones/n2"), conexion({ uid: "condA" })));
    await assertFails(setDoc(doc(como("jefeA"), "ia_conexiones/n3"), conexion({ org_id: "orgB" })));
    await assertFails(setDoc(doc(como("jefeB"), "ia_conexiones/n4"), conexion({ uid: "jefeB", org_id: "orgB" }))); // orgB sin activar
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), "ia_ajustes/orgA"), ajustes({ activa: false })));
    await assertFails(setDoc(doc(como("jefeA"), "ia_conexiones/n5"), conexion()));
  });
  it("las ve él o un admin de su empresa; nadie más", async () => {
    await assertSucceeds(getDoc(doc(como("jefeA"), "ia_conexiones/c1")));
    await assertSucceeds(getDoc(doc(como("adminA"), "ia_conexiones/c1")));
    await assertFails(getDoc(doc(como("condA"), "ia_conexiones/c1")));
    await assertFails(getDoc(doc(como("adminB"), "ia_conexiones/c1")));
    await assertSucceeds(getDocs(query(collection(como("adminA"), "ia_conexiones"), where("org_id", "==", "orgA"))));
    await assertSucceeds(getDocs(query(collection(como("jefeA"), "ia_conexiones"), where("uid", "==", "jefeA"))));
    await assertFails(getDocs(query(collection(como("condA"), "ia_conexiones"), where("org_id", "==", "orgA"))));
  });
  it("se desconectan (él o un admin) y apuntan su último uso; no se reactivan, ni se cambian, ni se borran", async () => {
    await assertSucceeds(updateDoc(doc(como("jefeA"), "ia_conexiones/c1"), { ultimoUso: "2026-11-09T11:00:00Z" }));
    await assertFails(updateDoc(doc(como("jefeA"), "ia_conexiones/c1"), { nivel: "actuar" }));
    await assertFails(updateDoc(doc(como("condA"), "ia_conexiones/c1"), { activa: false }));
    await assertFails(updateDoc(doc(como("adminB"), "ia_conexiones/c1"), { activa: false }));
    await assertSucceeds(updateDoc(doc(como("adminA"), "ia_conexiones/c1"), { activa: false, desconectadaEn: "2026-11-09T12:00:00Z", desconectadaPor: "adminA" }));
    await assertFails(updateDoc(doc(como("jefeA"), "ia_conexiones/c1"), { activa: true }));
    await assertFails(deleteDoc(doc(como("jefeA"), "ia_conexiones/c1")));
  });
});
