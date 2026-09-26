import { describe, it, expect, vi } from "vitest";
vi.mock("./firebase.js", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({}));
const { onlineFrom, initialsOf, haceCuanto, ONLINE_WINDOW_MS } = await import("./presence.js");

const NOW = 1_800_000_000_000;
const ts = msAgo => ({ toMillis: () => NOW - msAgo });
const p = (uid, extra) => ({ uid, nombre: "Ana", apellidos: "López", online: true, app: "oficina", lastSeen: ts(10_000), ...extra });

describe("quién está conectado", () => {
  it("cuenta solo a los que han latido hace poco y no a uno mismo", () => {
    const docs = [
      p("yo"),
      p("a"),
      p("b", { lastSeen: ts(ONLINE_WINDOW_MS + 1000) }), // cerró el navegador de golpe
      p("c", { online: false }),                         // cerró sesión
      p("d", { lastSeen: null }),                        // latido aún sin hora del servidor
    ];
    expect(onlineFrom(docs, NOW, "yo").map(d => d.uid)).toEqual(["a"]);
  });

  it("primero la oficina y luego la app de Rutas, por nombre", () => {
    const docs = [
      p("r1", { app: "rutas", nombre: "Bea" }),
      p("o2", { nombre: "Zoe" }),
      p("o1", { nombre: "Alba" }),
    ];
    expect(onlineFrom(docs, NOW).map(d => d.uid)).toEqual(["o1", "o2", "r1"]);
  });

  it("iniciales y hace cuánto", () => {
    expect(initialsOf({ nombre: "tania", apellidos: "roldán" })).toBe("TR");
    expect(initialsOf({})).toBe("?");
    expect(haceCuanto(ts(20_000), NOW)).toBe("ahora");
    expect(haceCuanto(ts(120_000), NOW)).toBe("hace 2 min");
  });
});
