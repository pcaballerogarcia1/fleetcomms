// Tests de las reglas de Firestore contra el emulador.
// Las reglas son lo que separa una organización de otra y los permisos de
// cada rol: estos tests comprueban que nadie lee ni escribe lo que no debe.
//
//   npm run test:rules   (arranca el emulador de Firestore, necesita Java 21)

import { readFileSync } from "node:fs";
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, getDocs,
} from "firebase/firestore";

let env;
const PROJECT = "demo-operanzia";

// Usuarios de prueba: dos organizaciones (A y B) y un superadmin
const USERS = {
  adminA:  { rol: "admin",      org_id: "orgA", nombre: "Ana" },
  interA:  { rol: "intermedio", org_id: "orgA", nombre: "Iván" },
  condA:   { rol: "conductor",  org_id: "orgA", nombre: "Carlos" },
  condA2:  { rol: "conductor",  org_id: "orgA", nombre: "Clara" },
  adminB:  { rol: "admin",      org_id: "orgB", nombre: "Bea" },
  sa:      { rol: "superadmin", org_id: null,   nombre: "Super" },
};
const as = uid => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
});
afterAll(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "orgs/orgA"), { nombre: "Org A" });
    await setDoc(doc(db, "orgs/orgB"), { nombre: "Org B" });
    for (const [uid, u] of Object.entries(USERS)) await setDoc(doc(db, "usuarios", uid), u);
    await setDoc(doc(db, "scheduling_projects/pA"), { org_id: "orgA", nombre: "Proyecto A" });
    await setDoc(doc(db, "scheduling_projects/pB"), { org_id: "orgB", nombre: "Proyecto B" });
    await setDoc(doc(db, "planes/planA"), { org_id: "orgA" });
    await setDoc(doc(db, "planes/planB"), { org_id: "orgB" });
    await setDoc(doc(db, "scheduling_vehicles/vA"), { org_id: "orgA", nombre: "Camión" });
    await setDoc(doc(db, "scheduling_scenarios/pA"), { org_id: "orgA", projectId: "pA", v: "v1", n: 1 });
    await setDoc(doc(db, "precios/pA"), { org_id: "orgA", projectId: "pA", defaultPrecio: 5 });
    await setDoc(doc(db, "auditoria/lineaA"), { org_id: "orgA", uid: "adminA", accion: "Generó un escenario" });
    await setDoc(doc(db, "presencia/adminB"), { uid: "adminB", org_id: "orgB", online: true });
    await setDoc(doc(db, "cuadrantes/cA"), { org_id: "orgA", uid: "condA", mes: "2026-10" });
    await setDoc(doc(db, "fichajes/fA"), { org_id: "orgA", uid: "condA" });
  });
});

describe("aislamiento entre organizaciones", () => {
  it("cada uno lee lo de su organización y nada de la otra", async () => {
    await assertSucceeds(getDoc(doc(as("adminA"), "planes/planA")));
    await assertFails(getDoc(doc(as("adminA"), "planes/planB")));
    await assertFails(getDoc(doc(as("adminB"), "scheduling_vehicles/vA")));
    await assertFails(getDoc(doc(as("adminB"), "scheduling_scenarios/pA")));
  });
  it("una consulta por la organización de otro se rechaza entera", async () => {
    await assertSucceeds(getDocs(query(collection(as("adminA"), "planes"), where("org_id", "==", "orgA"))));
    await assertFails(getDocs(query(collection(as("adminA"), "planes"), where("org_id", "==", "orgB"))));
    await assertFails(getDocs(collection(as("adminA"), "planes"))); // sin filtro = también la otra org
  });
  it("no se puede crear nada a nombre de otra organización", async () => {
    await assertFails(setDoc(doc(as("adminA"), "planes/nuevo"), { org_id: "orgB" }));
    await assertSucceeds(setDoc(doc(as("adminA"), "planes/nuevo"), { org_id: "orgA" }));
  });
  it("sin sesión no se lee nada", async () => {
    await assertFails(getDoc(doc(anon(), "planes/planA")));
    await assertFails(getDoc(doc(anon(), "usuarios/adminA")));
  });
  it("el superadmin ve todas las organizaciones", async () => {
    await assertSucceeds(getDoc(doc(as("sa"), "planes/planB")));
    await assertSucceeds(getDoc(doc(as("sa"), "scheduling_scenarios/pA")));
  });
});

describe("roles y perfiles", () => {
  it("nadie puede subirse de rol a sí mismo", async () => {
    await assertFails(updateDoc(doc(as("condA"), "usuarios/condA"), { rol: "admin" }));
    await assertSucceeds(updateDoc(doc(as("condA"), "usuarios/condA"), { nombre: "Carlos M." }));
  });
  it("un admin cambia roles en su organización, pero nunca a superadmin ni en otra", async () => {
    await assertSucceeds(updateDoc(doc(as("adminA"), "usuarios/condA"), { rol: "intermedio" }));
    await assertFails(updateDoc(doc(as("adminA"), "usuarios/condA"), { rol: "superadmin" }));
    await assertFails(updateDoc(doc(as("adminB"), "usuarios/condA"), { rol: "admin" }));
  });
  it("nadie puede cambiarse de organización", async () => {
    await assertFails(updateDoc(doc(as("adminA"), "usuarios/adminA"), { org_id: "orgB" }));
  });
  it("no se puede crear un perfil en una organización que no existe", async () => {
    await assertFails(setDoc(doc(as("nuevo"), "usuarios/nuevo"), { rol: "admin", org_id: "orgInventada" }));
    await assertSucceeds(setDoc(doc(as("nuevo"), "usuarios/nuevo"), { rol: "conductor", org_id: "orgA" }));
  });
});

describe("workspace de oficina", () => {
  it("los conductores no entran en Scheduling/Rostering/Planning", async () => {
    await assertFails(getDoc(doc(as("condA"), "scheduling_vehicles/vA")));
    await assertFails(getDoc(doc(as("condA"), "scheduling_scenarios/pA")));
    await assertSucceeds(getDoc(doc(as("interA"), "scheduling_vehicles/vA")));
  });
  it("precios: solo administradores", async () => {
    await assertSucceeds(getDoc(doc(as("adminA"), "precios/pA")));
    await assertFails(getDoc(doc(as("interA"), "precios/pA")));
    await assertFails(getDoc(doc(as("adminB"), "precios/pA")));
  });
  it("Rostering: se puede escuchar la ficha de un mes aún sin crear, solo de la propia org", async () => {
    await assertSucceeds(getDoc(doc(as("adminA"), "rostering_vehicles/orgA_2030_01")));
    await assertSucceeds(getDoc(doc(as("adminA"), "rostering/orgA_2030_01")));
    await assertFails(getDoc(doc(as("adminA"), "rostering_vehicles/orgB_2030_01")));
    await assertFails(getDoc(doc(as("condA"), "rostering_vehicles/orgA_2030_01")));
  });
});

describe("historial de cambios", () => {
  it("cada uno añade líneas propias de su organización", async () => {
    await assertSucceeds(addDoc(collection(as("adminA"), "auditoria"), { org_id: "orgA", uid: "adminA", accion: "x" }));
    await assertFails(addDoc(collection(as("adminA"), "auditoria"), { org_id: "orgA", uid: "interA", accion: "x" }));
    await assertFails(addDoc(collection(as("adminA"), "auditoria"), { org_id: "orgB", uid: "adminA", accion: "x" }));
  });
  it("nadie puede modificar ni borrar el historial (salvo superadmin)", async () => {
    await assertFails(updateDoc(doc(as("adminA"), "auditoria/lineaA"), { accion: "otra cosa" }));
    await assertFails(deleteDoc(doc(as("adminA"), "auditoria/lineaA")));
    await assertSucceeds(deleteDoc(doc(as("sa"), "auditoria/lineaA")));
  });
  it("solo lo leen los de oficina de la misma organización", async () => {
    await assertSucceeds(getDoc(doc(as("interA"), "auditoria/lineaA")));
    await assertFails(getDoc(doc(as("condA"), "auditoria/lineaA")));
    await assertFails(getDoc(doc(as("adminB"), "auditoria/lineaA")));
  });
});

describe("presencia, cuadrantes y fichajes", () => {
  it("presencia: solo la propia ficha; no se ve la de otra organización", async () => {
    await assertSucceeds(setDoc(doc(as("adminA"), "presencia/adminA"), { uid: "adminA", org_id: "orgA", online: true }));
    await assertFails(setDoc(doc(as("adminA"), "presencia/interA"), { uid: "interA", org_id: "orgA", online: true }));
    await assertFails(setDoc(doc(as("adminA"), "presencia/adminA"), { uid: "adminA", org_id: "orgB", online: true }));
    await assertFails(getDoc(doc(as("adminA"), "presencia/adminB")));
  });
  it("un conductor lee su cuadrante publicado, no el de otro", async () => {
    await assertSucceeds(getDoc(doc(as("condA"), "cuadrantes/cA")));
    await assertFails(getDoc(doc(as("condA2"), "cuadrantes/cA")));
    await assertFails(setDoc(doc(as("condA"), "cuadrantes/cA2"), { org_id: "orgA", uid: "condA" }));
  });
  it("fichajes: cada uno ficha por sí mismo y no se borran", async () => {
    await assertSucceeds(addDoc(collection(as("condA"), "fichajes"), { org_id: "orgA", uid: "condA" }));
    await assertFails(addDoc(collection(as("condA"), "fichajes"), { org_id: "orgA", uid: "condA2" }));
    await assertFails(updateDoc(doc(as("condA2"), "fichajes/fA"), { estado: "cerrado" }));
    await assertFails(deleteDoc(doc(as("condA"), "fichajes/fA")));
  });
});

describe("errores de los navegadores", () => {
  it("cualquiera con sesión registra errores suyos de su organización", async () => {
    await assertSucceeds(addDoc(collection(as("condA"), "errores"), { org_id: "orgA", uid: "condA", mensaje: "x" }));
    await assertFails(addDoc(collection(as("condA"), "errores"), { org_id: "orgB", uid: "condA", mensaje: "x" }));
    await assertFails(addDoc(collection(as("condA"), "errores"), { org_id: "orgA", uid: "adminA", mensaje: "x" }));
    await assertFails(addDoc(collection(anon(), "errores"), { org_id: "orgA", uid: "x", mensaje: "x" }));
  });
  it("solo el superadmin los lee", async () => {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), "errores/e1"), { org_id: "orgA", uid: "condA", mensaje: "x" }));
    await assertFails(getDoc(doc(as("adminA"), "errores/e1")));
    await assertSucceeds(getDoc(doc(as("sa"), "errores/e1")));
  });
});
