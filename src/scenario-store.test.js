import { describe, it, expect, vi } from "vitest";

// Firestore simulado en memoria
const store = new Map();
vi.mock("./firebase.js", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  doc: (_db, ...path) => path.join("/"),
  setDoc: async (ref, data) => { store.set(ref, data); },
  getDoc: async ref => ({ exists: () => store.has(ref), data: () => store.get(ref) }),
  deleteDoc: async ref => { store.delete(ref); },
  onSnapshot: () => () => {},
  serverTimestamp: () => "ts",
  runTransaction: async (_db, fn) => fn({
    get: async ref => ({ exists: () => store.has(ref), data: () => store.get(ref) }),
    set: (ref, data) => store.set(ref, data),
  }),
  Bytes: { fromUint8Array: u => ({ toUint8Array: () => u, length: u.length }) },
}));
const { saveScenarioCloud, loadScenarioCloud, getScenarioMeta, ScenarioConflictError } = await import("./scenario-store.js");
const { PIECE_BYTES } = await import("./layer-store.js");

// Escenario tipo Madrid: 120 vehículos × 30 días, ~44.000 paradas repartidas
function mkScenario(nVeh = 120, stopsPerVeh = 370) {
  const vehicles = Array.from({ length: nVeh }, (_, v) => ({
    _id: `veh${v}`, nombre: `CL-${v}`, matricula: `${1000 + v}ABC`, turno: "Mañana (06-14)", totalKm: 812.4,
    assignments: Array.from({ length: stopsPerVeh }, (_, i) => ({
      _start: 360 + i * 12, _end: 370 + i * 12, duracion: 10,
      nombre: `PA-${v * 1000 + i}`, direccion: `CALLE EJEMPLO ${i % 300}, ${i % 120}`, barrio: "REJAS",
      lat: 40.35 + (i % 900) * 0.0003, lng: -3.75 + v * 0.0004,
    })),
  }));
  const workers = vehicles.map(v => ({ _id: `w_${v._id}`, nombre: "Conductor", vehiculoId: v._id, assignments: v.assignments }));
  return { vehicles, workers, unassigned: { vehicles: [], workers: [] }, rosterMode: "cuadrante", stamp: "2026-09-25T10:00:00Z", appliedMoves: 0 };
}

describe("escenario de Scheduling en la nube", () => {
  it("un escenario grande se sube troceado (< 1 MB por trozo) y otro PC lo recupera igual", async () => {
    const sc = mkScenario();
    const v = await saveScenarioCloud("projA", "org1", sc);
    const meta = await getScenarioMeta("projA");
    console.log(`escenario: ${(JSON.stringify(sc).length / 1e6).toFixed(1)} MB en JSON → ${(meta.bytes / 1e6).toFixed(2)} MB comprimido en ${meta.n} trozo(s)`);
    expect(meta.v).toBe(v);
    expect(meta.org_id).toBe("org1");
    for (let i = 0; i < meta.n; i++) {
      expect(store.get(`scheduling_scenarios/projA/trozos/${v}_${i}`).data.length).toBeLessThanOrEqual(PIECE_BYTES);
    }
    const { data } = await loadScenarioCloud("projA", meta);
    expect(data).toEqual(sc);
  });

  it("al guardar otra versión borra los trozos de la anterior", async () => {
    const v1 = await saveScenarioCloud("projB", "org1", mkScenario(3, 5));
    const n1 = (await getScenarioMeta("projB")).n;
    const v2 = await saveScenarioCloud("projB", "org1", mkScenario(4, 5));
    await new Promise(r => setTimeout(r, 0));
    expect(v2).not.toBe(v1);
    expect(store.has(`scheduling_scenarios/projB/trozos/${v1}_0`)).toBe(false);
    expect(n1).toBeGreaterThan(0);
    const { data } = await loadScenarioCloud("projB", await getScenarioMeta("projB"));
    expect(data.vehicles).toHaveLength(4);
  });

  it("no pisa lo que guardó otra persona: si la nube ya no está en la versión de partida, avisa", async () => {
    const vA = await saveScenarioCloud("projD", "org1", mkScenario(2, 5), undefined, { savedBy: { nombre: "Ana" } });
    // B partía de vA y guarda bien
    const vB = await saveScenarioCloud("projD", "org1", mkScenario(3, 5), undefined, { baseV: vA, savedBy: { nombre: "Bea" } });
    // A sigue editando sobre vA (no ha visto lo de B) → conflicto, sin tocar la nube
    const err = await saveScenarioCloud("projD", "org1", mkScenario(9, 5), undefined, { baseV: vA }).catch(e => e);
    expect(err).toBeInstanceOf(ScenarioConflictError);
    expect(err.meta.v).toBe(vB);
    expect(err.meta.savedBy.nombre).toBe("Bea");
    await new Promise(r => setTimeout(r, 0));
    const meta = await getScenarioMeta("projD");
    expect(meta.v).toBe(vB);
    expect([...store.keys()].filter(k => k.startsWith("scheduling_scenarios/projD/trozos/")).every(k => k.includes(vB))).toBe(true);
    // "Guardar la mía encima" (sin baseV) sí sobrescribe
    const vA2 = await saveScenarioCloud("projD", "org1", mkScenario(9, 5));
    expect((await getScenarioMeta("projD")).v).toBe(vA2);
  });

  it("si la versión que se leía la sustituye otro PC a medias, carga la nueva", async () => {
    await saveScenarioCloud("projC", "org1", mkScenario(2, 5));
    const stale = await getScenarioMeta("projC");
    await saveScenarioCloud("projC", "org1", mkScenario(5, 5)); // otro PC guarda y borra la anterior
    await new Promise(r => setTimeout(r, 0));
    const { meta, data } = await loadScenarioCloud("projC", stale);
    expect(meta.v).not.toBe(stale.v);
    expect(data.vehicles).toHaveLength(5);
  });
});
