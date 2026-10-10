// Servicio de líneas publicado (Scheduling → Control → móvil del conductor)
// contra el emulador y las reglas reales.
//
//   npm run test:rules

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const h = vi.hoisted(() => ({ db: null }));
vi.mock("../src/firebase.js", () => ({ get db() { return h.db; } }));

let env;
const SERVICIO = {
  turnos: [
    { id: "T1", num: 1, tipo: "Mañana", inicio: 470, fin: 530, buses: [3], lineas: ["1"], trazados: { "L1|0": [40, -3.7, 40, -3.69] }, coords: { a: [40, -3.7] }, viajes: [{ k: 0, l: "1", v: 0, dep: 480, arr: 500, o: "a", d: "b", t: "L1|0", bus: 3 }] },
    { id: "T2", num: 2, tipo: "Tarde", inicio: 900, fin: 1300, buses: [4], lineas: ["1"], trazados: {}, coords: {}, viajes: [] },
  ],
  lista: [{ id: "T1", num: 1, inicio: 470, fin: 530, buses: [3], lineas: ["1"] }, { id: "T2", num: 2, inicio: 900, fin: 1300, buses: [4], lineas: ["1"] }],
  resumen: { turnos: 2, viajes: 1, autobuses: 2 },
};

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
    await setDoc(doc(db, "usuarios/cond1"), { rol: "field", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/cond2"), { rol: "field", org_id: "orgA" });
    await setDoc(doc(db, "usuarios/adminB"), { rol: "admin", org_id: "orgB" });
    await setDoc(doc(db, "scheduling_projects/pL"), { org_id: "orgA", nombre: "Bus", tipo: "lineas" });
  });
});
async function sinReglas(fn) { let r; await env.withSecurityRulesDisabled(async ctx => { r = await fn(ctx.firestore()); }); return r; }
const leer = p => sinReglas(async db => (await getDoc(doc(db, p))).data());
const como = uid => { h.db = env.authenticatedContext(uid).firestore(); };
async function publicar() {
  como("adminA");
  const { publicarServicio } = await import("../src/lineas-servicio-store.js");
  return publicarServicio({ projectId: "pL", orgId: "orgA", fecha: "2026-10-12", dia: "laborable", nombreDia: "Laborable", proyecto: "Bus", servicio: SERVICIO, por: "adminA" });
}

describe("servicio de líneas con las reglas reales", () => {
  it("la oficina publica el día; volver a publicar quita los turnos que ya no están", async () => {
    const sid = await publicar();
    expect(sid).toBe("pL_2026-10-12");
    expect(await leer(`servicio_lineas/${sid}`)).toMatchObject({ org_id: "orgA", fecha: "2026-10-12", resumen: { turnos: 2 } });
    expect(await leer(`servicio_lineas/${sid}/turnos/T1`)).toMatchObject({ conductorUid: null, real: { salidas: {}, llegadas: {} } });
    const { publicarServicio } = await import("../src/lineas-servicio-store.js");
    await publicarServicio({ projectId: "pL", orgId: "orgA", fecha: "2026-10-12", dia: "laborable", servicio: { ...SERVICIO, turnos: [SERVICIO.turnos[0]], lista: [SERVICIO.lista[0]] } });
    expect(await leer(`servicio_lineas/${sid}/turnos/T2`)).toBeUndefined();
  });

  it("un conductor no puede publicar", async () => {
    como("cond1");
    const { publicarServicio } = await import("../src/lineas-servicio-store.js");
    await expect(publicarServicio({ projectId: "pL", orgId: "orgA", fecha: "2026-10-12", dia: "laborable", servicio: SERVICIO })).rejects.toThrow();
  });

  it("el conductor ve el día, coge un turno libre, anota lo real y lo suelta", async () => {
    const sid = await publicar();
    como("cond1");
    const s = await import("../src/lineas-servicio-store.js");
    const dias = await new Promise(r => { const off = s.watchServiciosFechas("orgA", ["2026-10-12", "2026-10-11"], l => { off(); r(l); }); });
    expect(dias.map(d => d._id)).toEqual([sid]);
    await s.cogerTurno(sid, "T1", { uid: "cond1", nombre: "Ana" });
    await s.empezarTurno(sid, "T1", 470);
    await s.guardarReal(sid, "T1", { salidas: { 0: 481 }, llegadas: {}, saltados: [] });
    expect(await leer(`servicio_lineas/${sid}/turnos/T1`)).toMatchObject({ conductorUid: "cond1", inicioReal: 470, real: { salidas: { 0: 481 } } });
    const mios = await new Promise(r => { const off = s.watchMisTurnos(sid, "orgA", "cond1", l => { off(); r(l); }); });
    expect(mios.map(t => t._id)).toEqual(["T1"]);
    await s.dejarTurno(sid, "T1");
    expect((await leer(`servicio_lineas/${sid}/turnos/T1`)).conductorUid).toBe(null);
  });

  it("el turno de otro no se puede coger ni tocar, ni los viajes del propio", async () => {
    const sid = await publicar();
    como("cond1");
    const s = await import("../src/lineas-servicio-store.js");
    await s.cogerTurno(sid, "T1", { uid: "cond1", nombre: "Ana" });
    como("cond2");
    await expect(s.cogerTurno(sid, "T1", { uid: "cond2", nombre: "Luis" })).rejects.toThrow(/ya lo tiene Ana/);
    await expect(updateDoc(doc(h.db, `servicio_lineas/${sid}/turnos/T1`), { conductorUid: "cond2" })).rejects.toThrow();
    await expect(s.guardarReal(sid, "T1", { salidas: { 0: 1 }, llegadas: {} })).rejects.toThrow();
    // en uno libre tampoco se anota nada sin cogerlo
    await expect(s.guardarReal(sid, "T2", { salidas: { 0: 1 }, llegadas: {} })).rejects.toThrow();
    como("cond1");
    await expect(updateDoc(doc(h.db, `servicio_lineas/${sid}/turnos/T1`), { viajes: [] })).rejects.toThrow();
  });

  it("posiciones: cada uno la suya; la oficina de otra empresa no las ve", async () => {
    const sid = await publicar();
    como("cond1");
    const s = await import("../src/lineas-servicio-store.js");
    await s.escribirPosicion("cond1", { org_id: "orgA", servicioId: sid, turnoId: "T1", lat: 40, lng: -3.7, retraso: 2, activo: true });
    await expect(setDoc(doc(h.db, "ubicaciones_lineas/cond2"), { org_id: "orgA", lat: 1, lng: 1 })).rejects.toThrow();
    como("adminA");
    const pos = await new Promise(r => { const off = s.watchPosiciones("orgA", sid, l => { off(); r(l); }); });
    expect(pos).toHaveLength(1);
    expect(pos[0]).toMatchObject({ turnoId: "T1", retraso: 2 });
    como("adminB");
    await expect(new Promise((ok, mal) => { const off = s.watchTurnos(sid, "orgA", ok); setTimeout(() => { off(); mal(new Error("sin respuesta")); }, 3000); }).then(l => { if (!l.length) throw new Error("vacío"); })).rejects.toThrow();
  });
});
