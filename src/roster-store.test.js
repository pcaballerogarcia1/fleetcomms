import { describe, it, expect, vi } from "vitest";
vi.mock("./firebase.js", () => ({ db: {} }));
import { chunkScenario, assembleScenario, assembleMonth, savedSnapshotOf, PART_MAX_BYTES } from "./roster-store.js";

// Mismos tamaños que la medición real: ids de 20 caracteres, 31 días, mañana+tarde
const rid = i => `id${String(i).padStart(18, "0")}`;
function scenario(vehs, workers, days = 31) {
  const shifts = [];
  for (let d = 1; d <= days; d++) for (let v = 0; v < vehs; v++) for (const s of [360, 840]) {
    shifts.push({ id: `${rid(v)}_${d}_${s}`, d, v: rid(v), vn: "Camión 123", s, e: s + 470, st: 120, km: 85.3 });
  }
  const dailyDetail = {};
  for (let w = 0; w < workers; w++) {
    dailyDetail[rid(1e6 + w)] = {};
    for (let d = 1; d <= 22; d++) dailyDetail[rid(1e6 + w)][d] = { stops: 120, km: 85.3, start: 360 + d * 1440, end: 830 + d * 1440, vehiculo: "Camión 123" };
  }
  return { shifts, dailyDetail };
}
const MB = 1024 * 1024;

describe("chunkScenario / assembleScenario", () => {
  for (const [vehs, workers] of [[100, 200], [1000, 2000]]) {
    it(`${vehs} vehículos / ${workers} trabajadores: ninguna parte llega a 1 MB y no se pierde nada`, () => {
      const { shifts, dailyDetail } = scenario(vehs, workers);
      expect(JSON.stringify({ shifts, dailyDetail }).length).toBeGreaterThan(MB); // antes: un solo documento, inválido
      const parts = chunkScenario(shifts, dailyDetail);
      for (const p of parts) expect(JSON.stringify(p).length).toBeLessThan(PART_MAX_BYTES + 2000);

      const main = { generatedAt: "2026-09-24T10:00:00.000Z", parts: parts.length, mes: "2026-10" };
      const docs = parts.map((p, i) => ({ id: `x_${i}`, data: { stamp: main.generatedAt, i, ...p } }));
      const sc = assembleScenario(main, docs);
      expect(sc.shifts).toHaveLength(shifts.length);
      expect(Object.keys(sc.dailyDetail)).toHaveLength(workers);
      expect(sc.daysWorked[rid(1e6)]).toEqual(Array.from({ length: 22 }, (_, i) => i + 1));
      expect(sc._partsComplete).toBe(true);
      expect(sc.shifts[0]._p).toBe("x_0");
    });
  }

  it("ignora partes de otra generación (regenerando mientras se lee)", () => {
    const main = { generatedAt: "nueva", parts: 1 };
    const sc = assembleScenario(main, [
      { id: "a", data: { stamp: "vieja", i: 0, shifts: [{ id: "old" }], detail: {} } },
      { id: "b", data: { stamp: "nueva", i: 0, shifts: [{ id: "new" }], detail: {} } },
    ]);
    expect(sc.shifts.map(s => s.id)).toEqual(["new"]);
  });

  it("formato antiguo (todo en la ficha principal) se lee tal cual", () => {
    const legacy = { mes: "2026-09", shifts: [{ id: "s1" }], dailyDetail: {}, daysWorked: {} };
    expect(assembleScenario(legacy, [])).toBe(legacy);
  });
});

describe("assembleMonth / savedSnapshotOf", () => {
  it("las fichas por trabajador mandan sobre el formato antiguo", () => {
    const main = { grid: { w1: { 1: "M" }, w2: { 1: "T" } }, asignaciones: { w1: { 1: { v: "A" } } } };
    const m = assembleMonth(main, [{ id: "w1", data: { grid: { 1: "L" }, asign: {} } }]);
    expect(m.grid).toEqual({ w1: { 1: "L" }, w2: { 1: "T" } });
    expect(m.asignaciones).toEqual({});
    expect(m.legacy).toBe(true);
  });

  it("formato nuevo: legacy=false y snapshot por trabajador", () => {
    const m = assembleMonth({ org_id: "o", formato: 2 }, [{ id: "w1", data: { grid: { 2: "N" }, asign: { 2: { v: "B" } } } }]);
    expect(m.legacy).toBe(false);
    const snap = savedSnapshotOf(m.grid, m.asignaciones);
    expect(JSON.parse(snap.w1)).toEqual({ grid: { 2: "N" }, asign: { 2: { v: "B" } } });
  });
});
