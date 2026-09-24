import { describe, it, expect, vi } from "vitest";
import { Buffer } from "node:buffer";

// Firestore simulado en memoria (y sin IndexedDB, como en Node: la copia
// local falla en silencio y todo se descarga de "la nube")
const store = new Map();
vi.mock("./firebase.js", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  doc: (_db, ...path) => path.join("/"),
  setDoc: async (ref, data) => { store.set(ref, data); },
  getDoc: async ref => ({ exists: () => store.has(ref), data: () => store.get(ref) }),
  deleteDoc: async ref => { store.delete(ref); },
  Bytes: { fromUint8Array: u => ({ toUint8Array: () => u, length: u.length }) },
}));
const { gzip, gunzip, splitBytes, joinBytes, uploadLayerMarkers, loadLayerMarkers, deleteLayerPieces, PIECE_BYTES } =
  await import("./layer-store.js");

// Puntos tipo Excel de contenedores (campos reales de Planning)
const mkMarkers = n => Array.from({ length: n }, (_, i) => ({
  lat: (40.35 + (i % 900) * 0.0003).toFixed(6), lng: (-3.75 + Math.floor(i / 900) * 0.0004).toFixed(6),
  nombre: `PA-${100000 + i}`, barrio: ["REJAS", "TIMON", "AEROPUERTO", "ROSAS"][i % 4],
  calle: `CALLE EJEMPLO ${i % 300}`, num: String(i % 120), fraccion: ["RESTO", "ENVASES", "PAPEL"][i % 3],
  contenedor: "CARGA LATERAL 3200L", idsap: `SAP${7000000 + i}`,
}));

describe("gzip / trozos", () => {
  it("comprime y descomprime sin perder nada", async () => {
    const text = JSON.stringify(mkMarkers(500));
    expect(await gunzip(await gzip(text))).toBe(text);
  });

  it("split/join devuelve los mismos bytes", () => {
    const b = new Uint8Array(2_000_123).map((_, i) => i % 251);
    const parts = splitBytes(b);
    expect(parts.every(p => p.length <= PIECE_BYTES)).toBe(true);
    expect(Buffer.compare(Buffer.from(joinBytes(parts)), Buffer.from(b))).toBe(0);
  });
});

describe("capa de 44.000 puntos en la nube", () => {
  it("se sube troceada, cada trozo < 1 MB, y se recupera igual desde otro navegador", async () => {
    const markers = mkMarkers(44000);
    const raw = JSON.stringify(markers).length;
    const cloud = await uploadLayerMarkers("proj_capa1", "proj", markers);
    console.log(`44.000 puntos: ${(raw / 1e6).toFixed(1)} MB en JSON → ${(cloud.bytes / 1e6).toFixed(2)} MB comprimido en ${cloud.n} trozo(s)`);
    expect(cloud.count).toBe(44000);
    for (let i = 0; i < cloud.n; i++) {
      const piece = store.get(`planning_layers/proj_capa1/trozos/${cloud.v}_${i}`);
      expect(piece.projectId).toBe("proj");
      expect(piece.data.length).toBeLessThanOrEqual(PIECE_BYTES);
    }
    const loaded = await loadLayerMarkers("proj_capa1", cloud);
    expect(loaded).toEqual(markers);
  });

  it("si falta un trozo, avisa en vez de devolver un mapa incompleto", async () => {
    const cloud = await uploadLayerMarkers("proj_capa2", "proj", mkMarkers(3000));
    store.delete(`planning_layers/proj_capa2/trozos/${cloud.v}_0`);
    await expect(loadLayerMarkers("proj_capa2", cloud)).rejects.toThrow(/faltan trozos/);
  });

  it("borrar la capa borra sus trozos", async () => {
    const cloud = await uploadLayerMarkers("proj_capa3", "proj", mkMarkers(1000));
    await deleteLayerPieces("proj_capa3", cloud);
    expect([...store.keys()].some(k => k.startsWith("planning_layers/proj_capa3/"))).toBe(false);
  });
});
