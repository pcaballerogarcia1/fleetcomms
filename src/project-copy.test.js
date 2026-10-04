import { describe, it, expect, vi, beforeEach } from "vitest";

// Firestore en memoria: rutas "col/id/subcol/id" → datos
const store = new Map();
const denegar = new Set(); // colecciones que dan permission-denied
const path = parts => parts.join("/");
const err = () => Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
const check = p => { if (denegar.has(p.split("/")[0])) throw err(); };
vi.mock("./firebase.js", () => ({ db: {} }));
vi.mock("./layer-store.js", () => ({
  localGet: vi.fn(async key => (key === "src_viejo" ? [{ lat: 1, lng: 2 }] : undefined)),
  uploadLayerMarkers: vi.fn(async () => ({ v: "nv", n: 1, bytes: 10, count: 1 })),
}));
vi.mock("firebase/firestore", () => ({
  doc: (_db, ...p) => ({ path: path(p), id: p[p.length - 1] }),
  collection: (_db, ...p) => ({ path: path(p) }),
  query: (col, ...w) => ({ path: col.path, where: w }),
  where: (field, op, value) => ({ field, value }),
  serverTimestamp: () => "TS",
  getDoc: async ref => { check(ref.path); const d = store.get(ref.path); return { exists: () => !!d, data: () => d }; },
  getDocs: async q => {
    check(q.path);
    const depth = q.path.split("/").length + 1;
    const docs = [...store.entries()]
      .filter(([k]) => k.startsWith(q.path + "/") && k.split("/").length === depth)
      .filter(([, v]) => (q.where || []).every(w => v[w.field] === w.value))
      .map(([k, v]) => ({ id: k.split("/").pop(), data: () => v }));
    return { docs, size: docs.length };
  },
  setDoc: async (ref, data) => { check(ref.path); store.set(ref.path, data); },
  writeBatch: () => { const ops = []; return { set: (ref, data) => ops.push([ref, data]), commit: async () => { for (const [r, d] of ops) { check(r.path); store.set(r.path, d); } } }; },
}));

const { duplicarProyecto, nombreCopia, idCapaNuevo } = await import("./project-copy.js");

function proyectoDePrueba() {
  store.clear(); denegar.clear();
  store.set("scheduling_projects/src", { nombre: "ROMA", org_id: "org1", mes: "2026-10", status: "schedulado", planning: { tasksCount: 8302 } });
  store.set("scheduling_projects/src/timetable/40.1_-3.1", { franjaInicio: "08:00", duracion: 5 });
  store.set("scheduling_projects/src/timetable/40.2_-3.2", { duracion: 7 });
  store.set("scheduling_projects/src/scenario_history/h1", { km: 10 });
  store.set("planning_layers/src_1", { id: 1, name: "Pequeña", markers: [{ lat: 1, lng: 1 }], projectId: "src", orgId: "org1" });
  store.set("planning_layers/src_2", { id: 2, name: "Grande", markers: [], cloud: { v: "a", n: 2 }, projectId: "src", orgId: "org1" });
  store.set("planning_layers/src_2/trozos/a_0", { projectId: "src", v: "a", i: 0, data: "bytes0" });
  store.set("planning_layers/src_2/trozos/a_1", { projectId: "src", v: "a", i: 1, data: "bytes1" });
  store.set("planning_layers/src_3", { id: 3, chunked: true, projectId: "src" });
  store.set("planning_layers/src_3_c0", { layerId: 3, chunkIndex: 0, markers: [{ lat: 5 }], projectId: "src" });
  store.set("planning_layers/src_viejo", { id: 4, name: "Local", localOnly: true, projectId: "src" });
  store.set("planning_layers/otro_1", { id: 9, projectId: "otro" });
  store.set("planning_depots/src", { depots: [{ nombre: "COCHERA" }], projectId: "src" });
  store.set("planning_settings/src", { defaultDuracion: 6 });
  store.set("precios/src", { org_id: "org1", projectId: "src", defaultPrecio: 3 });
  store.set("precios/src/trozos/0", { org_id: "org1", projectId: "src", map: { k: 2 } });
  store.set("scheduling_scenarios/src", { org_id: "org1", projectId: "src", v: "s1", n: 1, puntos: [{ v: "s0", n: 1 }] });
  store.set("scheduling_scenarios/src/trozos/s1_0", { projectId: "src", v: "s1", i: 0, data: "esc" });
  store.set("scheduling_scenarios/src/trozos/s0_0", { projectId: "src", v: "s0", i: 0, data: "punto" });
  store.set("scheduling_roster/src", { parts: 1, generatedAt: "g" });
  store.set("scheduling_roster/src/partes/g_0", { stamp: "g", i: 0, shifts: [] });
}

describe("nombre de la copia", () => {
  it("añade (copia) y numera si ya existe", () => {
    expect(nombreCopia("ROMA")).toBe("ROMA (copia)");
    expect(nombreCopia("ROMA", ["ROMA (copia)"])).toBe("ROMA (copia 2)");
    expect(nombreCopia("ROMA (copia)", ["roma (copia)"])).toBe("ROMA (copia 2)");
  });
  it("id de capa nuevo conserva la capa y el trozo", () => {
    expect(idCapaNuevo("src_2", "src", "dst")).toBe("dst_2");
    expect(idCapaNuevo("src_3_c0", "src", "dst")).toBe("dst_3_c0");
  });
});

describe("duplicar proyecto", () => {
  beforeEach(proyectoDePrueba);

  it("copia ficha, capas, trozos, depósitos, horarios, precios, escenario y turnos", async () => {
    const pasos = [];
    const { proyecto, avisos } = await duplicarProyecto({ _id: "src", org_id: "org1" }, "ROMA (copia)", { newId: "dst", onPaso: p => pasos.push(p) });
    expect(proyecto).toMatchObject({ _id: "dst", nombre: "ROMA (copia)", org_id: "org1", duplicadoDe: "src" });
    expect(store.get("scheduling_projects/dst")).toMatchObject({ nombre: "ROMA (copia)", org_id: "org1", mes: "2026-10", planning: { tasksCount: 8302 }, duplicadoDe: "src" });
    expect(store.get("scheduling_projects/dst/timetable/40.1_-3.1")).toEqual({ franjaInicio: "08:00", duracion: 5 });
    expect(store.get("scheduling_projects/dst/timetable/40.2_-3.2")).toEqual({ duracion: 7 });
    expect(store.get("planning_layers/dst_1")).toMatchObject({ name: "Pequeña", projectId: "dst", markers: [{ lat: 1, lng: 1 }] });
    expect(store.get("planning_layers/dst_2")).toMatchObject({ cloud: { v: "a", n: 2 }, projectId: "dst" });
    expect(store.get("planning_layers/dst_2/trozos/a_1")).toEqual({ projectId: "dst", v: "a", i: 1, data: "bytes1" });
    expect(store.get("planning_layers/dst_3_c0")).toMatchObject({ layerId: 3, projectId: "dst" });
    expect(store.get("planning_layers/dst_viejo")).toMatchObject({ localOnly: false, cloud: { v: "nv" }, projectId: "dst" });
    expect(store.get("planning_depots/dst")).toMatchObject({ depots: [{ nombre: "COCHERA" }], projectId: "dst" });
    expect(store.get("planning_settings/dst")).toEqual({ defaultDuracion: 6 });
    expect(store.get("precios/dst")).toMatchObject({ defaultPrecio: 3, projectId: "dst" });
    expect(store.get("precios/dst/trozos/0")).toMatchObject({ map: { k: 2 }, projectId: "dst" });
    expect(store.get("scheduling_scenarios/dst")).toMatchObject({ v: "s1", projectId: "dst", puntos: [{ v: "s0" }] });
    expect(store.get("scheduling_scenarios/dst/trozos/s1_0")).toMatchObject({ data: "esc", projectId: "dst" });
    expect(store.get("scheduling_scenarios/dst/trozos/s0_0")).toMatchObject({ data: "punto" });
    expect(store.get("scheduling_roster/dst/partes/g_0")).toMatchObject({ stamp: "g" });
    expect(avisos).toEqual([]);
    expect(pasos.length).toBeGreaterThan(3);
  });

  it("no toca el original, ni otros proyectos, ni copia el historial", async () => {
    const antes = new Map(store);
    await duplicarProyecto({ _id: "src" }, "Copia", { newId: "dst" });
    for (const [k, v] of antes) expect(store.get(k)).toEqual(v);
    expect([...store.keys()].some(k => k.startsWith("planning_layers/dst_") && k.includes("otro"))).toBe(false);
    expect(store.has("scheduling_projects/dst/scenario_history/h1")).toBe(false);
  });

  it("sin permiso para precios avisa y copia el resto; capa solo local ausente → aviso", async () => {
    denegar.add("precios");
    const { localGet } = await import("./layer-store.js");
    localGet.mockImplementationOnce(async () => undefined);
    const { avisos } = await duplicarProyecto({ _id: "src" }, "Copia", { newId: "dst" });
    expect(avisos.join(" ")).toMatch(/precios no se han copiado/);
    expect(avisos.join(" ")).toMatch(/«Local».*súbela de nuevo/);
    expect(store.get("scheduling_scenarios/dst")).toBeTruthy();
  });

  it("si el original ya no existe, falla sin crear nada", async () => {
    store.delete("scheduling_projects/src");
    await expect(duplicarProyecto({ _id: "src" }, "Copia", { newId: "dst" })).rejects.toThrow(/ya no existe/);
    expect(store.has("scheduling_projects/dst")).toBe(false);
  });
});
