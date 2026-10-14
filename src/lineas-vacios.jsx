// Planning de líneas → Vacíos: km y minutos por carretera entre cabeceras
// cercanas, y entre cada cochera y cada cabecera. El Scheduling los usa para
// los vacíos de los autobuses, los desplazamientos de los conductores y la
// toma desde la cochera (sin la tabla: línea recta × rodeo a la velocidad de
// los vacíos). Se calculan por carretera (OSRM) y se pueden corregir a mano.
// Se guardan en planning_settings.lineasCfg._vacios.pares: { "a|b": [km, min, "c" | "m"] }.
import { useMemo, useState } from "react";
import { cabecerasDeRed, ID_COCHERA, PARAMS_DEFECTO } from "./lineas-sched.js";

const C = {
  bg: "#0b0d12", card: "#12151c", surface2: "#181c25", border: "rgba(255,255,255,0.08)", border2: "rgba(255,255,255,0.14)",
  blue: "#5b7cfa", blueText: "#b4c3ff", green: "#3fcf8e", amber: "#f5b84a", red: "#f26d6d", text: "#e6e8ee", muted: "#9aa3b2", dim: "#5d6574",
};
const font = "var(--font)";
const mono = "var(--mono)";
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const VECINAS = 12;       // cabeceras más cercanas de cada una
const RADIO_KM = 25;      // en línea recta
const FACTOR_BUS = 1.15;  // un autobús tarda algo más que un coche
const kmRecta = ([a, b], [c, d]) => {
  const dLat = (c - a) * Math.PI / 180, dLng = (d - b) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

export function VaciosRed({ red, cfg, cocheras, onGuardar }) {
  const pares = cfg?._vacios?.pares || {};
  const [q, setQ] = useState("");
  const [calculando, setCalculando] = useState(null); // texto del avance
  const [error, setError] = useState(null);
  const [editando, setEditando] = useState(null); // { clave, km, min }

  // los puntos (cabeceras y cocheras) y los pares que hacen falta
  const { puntos, lista } = useMemo(() => {
    const coord = new Map((red.paradas || []).map(x => [x.id, [x.lat, x.lng]]));
    const cabs = cabecerasDeRed(red).map(c => ({ id: c.id, nombre: c.nombre, ll: coord.get(c.id) || c.paradas.map(x => coord.get(x)).find(Boolean), cochera: false })).filter(c => c.ll);
    const cochs = (cocheras || []).filter(c => isFinite(c.lat) && isFinite(c.lng)).map(c => ({ id: ID_COCHERA(c.id), nombre: c.nombre || "Cochera", ll: [c.lat, c.lng], cochera: true }));
    const out = [], visto = new Set();
    const poner = (a, b) => { const k = `${a.id}|${b.id}`; if (a.id === b.id || visto.has(k)) return; visto.add(k); out.push({ clave: k, a, b, recta: kmRecta(a.ll, b.ll) }); };
    for (const a of cabs) {
      const cerca = cabs.filter(b => b.id !== a.id).map(b => [b, kmRecta(a.ll, b.ll)]).filter(([, d]) => d <= RADIO_KM).sort((x, y) => x[1] - y[1]).slice(0, VECINAS);
      for (const [b] of cerca) { poner(a, b); poner(b, a); }
    }
    for (const k of cochs) for (const a of cabs) { poner(k, a); poner(a, k); }
    out.sort((x, y) => x.a.nombre.localeCompare(y.a.nombre, "es") || x.recta - y.recta);
    return { puntos: [...cochs, ...cabs], lista: out };
  }, [red, cocheras]);

  const estimado = r => {
    const km = Math.round(r.recta * PARAMS_DEFECTO.factorRodeo * 10) / 10;
    return [km, Math.max(1, Math.round((km / PARAMS_DEFECTO.velocidadVacio) * 60))];
  };
  const hechos = lista.filter(r => pares[r.clave]).length;
  const aMano = lista.filter(r => pares[r.clave]?.[2] === "m").length;
  const vis = lista.filter(r => !q.trim() || norm(`${r.a.nombre} ${r.b.nombre}`).includes(norm(q.trim())));

  // Por carretera (OSRM, tabla de distancias): por bloques de 40 × 40 puntos
  async function calcular() {
    setError(null);
    const necesarios = new Set(lista.map(r => r.clave));
    const B = 40, nuevos = {};
    const bloques = [];
    for (let i = 0; i < puntos.length; i += B) for (let j = 0; j < puntos.length; j += B) {
      const src = puntos.slice(i, i + B), dst = puntos.slice(j, j + B);
      if (src.some(a => dst.some(b => necesarios.has(`${a.id}|${b.id}`)))) bloques.push([src, dst]);
    }
    try {
      for (let n = 0; n < bloques.length; n++) {
        setCalculando(`Calculando por carretera… ${n + 1} de ${bloques.length}`);
        const [src, dst] = bloques[n];
        const todos = [...src, ...dst];
        const coords = todos.map(x => `${x.ll[1].toFixed(5)},${x.ll[0].toFixed(5)}`).join(";");
        const sources = src.map((_, i) => i).join(";"), destinations = dst.map((_, i) => src.length + i).join(";");
        const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 30000);
        const resp = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?sources=${sources}&destinations=${destinations}&annotations=duration,distance`, { signal: ctrl.signal });
        clearTimeout(t);
        const data = await resp.json();
        if (data.code !== "Ok") throw new Error(data.message || data.code || `respuesta ${resp.status}`);
        src.forEach((a, i) => dst.forEach((b, j) => {
          const k = `${a.id}|${b.id}`;
          if (!necesarios.has(k) || pares[k]?.[2] === "m") return; // lo puesto a mano no se pisa
          const dist = data.distances?.[i]?.[j], dur = data.durations?.[i]?.[j];
          if (dist == null || dur == null) return;
          nuevos[k] = [Math.round(dist / 100) / 10, Math.max(1, Math.ceil((dur / 60) * FACTOR_BUS)), "c"];
        }));
        if (n < bloques.length - 1) await new Promise(r => setTimeout(r, 800)); // el servidor es público: sin prisas
      }
      await onGuardar(nuevos);
    } catch (e) {
      setError(`No se ha podido calcular por carretera: ${e.name === "AbortError" ? "el servicio de rutas no responde" : e.message || e}. Prueba más tarde o pon los tiempos a mano.`);
    } finally { setCalculando(null); }
  }

  const guardarFila = async r => {
    const km = parseFloat(String(editando.km).replace(",", ".")), min = parseInt(editando.min, 10);
    if (!(km >= 0) || !(min >= 0)) { setError("Escribe los km y los minutos (por ejemplo 4,2 y 9)."); return; }
    setEditando(null);
    await onGuardar({ [r.clave]: [Math.round(km * 10) / 10, min, "m"] });
  };

  const th = { fontSize: 10.5, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 700, textAlign: "left", padding: "7px 10px", position: "sticky", top: 0, background: C.card, zIndex: 1 };
  const td = { padding: "6px 10px", fontSize: 12, borderTop: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 22px" }}>
      <div style={{ maxWidth: 980 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Tiempos de vacío</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.55 }}>
          Km y minutos de un autobús en vacío entre cabeceras cercanas y entre cada cochera y cada cabecera. El Scheduling los usa para los vacíos, para lo que tarda el conductor en ir a otra cabecera y para la toma desde la cochera. Los pares sin calcular usan la estimación (línea recta × {String(PARAMS_DEFECTO.factorRodeo).replace(".", ",")} a {PARAMS_DEFECTO.velocidadVacio} km/h).
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 10px", flexWrap: "wrap" }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar cabecera o cochera…" style={{ width: 260, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "6px 9px", fontSize: 12, fontFamily: font, outline: "none" }} />
          <button onClick={calcular} disabled={!!calculando || !lista.length} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: C.blue, color: "#fff", fontSize: 12, fontWeight: 600, cursor: calculando ? "wait" : "pointer", fontFamily: font }}>
            {calculando || `Calcular por carretera (${lista.length} pares)`}
          </button>
          <span style={{ fontSize: 11.5, color: hechos === lista.length && lista.length ? C.green : C.muted }}>{hechos} de {lista.length} con tiempo por carretera o a mano{aMano ? ` · ${aMano} a mano` : ""}</span>
        </div>
        {!(cocheras || []).length && <div style={{ fontSize: 11.5, color: C.amber, marginBottom: 8 }}>Sin cocheras: solo salen los pares entre cabeceras. Añádelas en «Red y mapa».</div>}
        {error && <div style={{ fontSize: 12, color: C.red, marginBottom: 8 }}>{error}</div>}
        <div style={{ fontSize: 10.5, color: C.dim, marginBottom: 8 }}>Por carretera con el servicio público OSRM; los minutos de coche × {String(FACTOR_BUS).replace(".", ",")} (autobús). Lo que corrijas a mano no lo pisa el cálculo.</div>
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "auto", maxHeight: "calc(100vh - 330px)", background: C.card }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Desde</th><th style={th}>Hasta</th>
              <th style={{ ...th, textAlign: "right" }}>Estimado</th><th style={{ ...th, textAlign: "right" }}>Km</th><th style={{ ...th, textAlign: "right" }}>Min</th><th style={th}>Origen</th><th style={th} />
            </tr></thead>
            <tbody>
              {vis.slice(0, 600).map(r => {
                const v = pares[r.clave], est = estimado(r), ed = editando?.clave === r.clave;
                const pinta = x => <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{x.cochera && <span title="Cochera" style={{ fontSize: 9.5, fontWeight: 700, color: "#f59e5b", border: "1px solid #f59e5b88", borderRadius: 4, padding: "0 4px" }}>COCHERA</span>}<span style={{ color: C.text }}>{x.nombre}</span></span>;
                return (
                  <tr key={r.clave}>
                    <td style={td}>{pinta(r.a)}</td>
                    <td style={td}>{pinta(r.b)}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, color: C.dim }}>{String(est[0]).replace(".", ",")} km · {est[1]}′</td>
                    {ed ? <>
                      <td style={{ ...td, textAlign: "right" }}><input autoFocus value={editando.km} onChange={e => setEditando({ ...editando, km: e.target.value })} onKeyDown={e => e.key === "Enter" && guardarFila(r)} style={{ width: 60, background: C.bg, border: `1px solid ${C.blue}`, color: C.text, borderRadius: 4, padding: "2px 5px", fontSize: 12, fontFamily: mono, textAlign: "right", outline: "none" }} /></td>
                      <td style={{ ...td, textAlign: "right" }}><input value={editando.min} onChange={e => setEditando({ ...editando, min: e.target.value })} onKeyDown={e => e.key === "Enter" && guardarFila(r)} style={{ width: 50, background: C.bg, border: `1px solid ${C.blue}`, color: C.text, borderRadius: 4, padding: "2px 5px", fontSize: 12, fontFamily: mono, textAlign: "right", outline: "none" }} /></td>
                    </> : <>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono, color: v ? C.text : C.dim }}>{v ? String(v[0]).replace(".", ",") : "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono, color: v ? C.text : C.dim }}>{v ? v[1] : "—"}</td>
                    </>}
                    <td style={{ ...td, fontSize: 11, color: v?.[2] === "m" ? C.amber : v ? C.green : C.dim }}>{v?.[2] === "m" ? "a mano" : v ? "por carretera" : "estimado"}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {ed
                        ? <><button onClick={() => guardarFila(r)} style={{ background: C.blue, border: "none", color: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer", marginRight: 4 }}>✓</button><button onClick={() => setEditando(null)} style={{ background: "none", border: `1px solid ${C.border2}`, color: C.muted, borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>✕</button></>
                        : <button onClick={() => setEditando({ clave: r.clave, km: String((v || est)[0]).replace(".", ","), min: String((v || est)[1]) })} style={{ background: "none", border: `1px solid ${C.border2}`, color: C.blueText, borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer", fontFamily: font }}>Cambiar</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {vis.length > 600 && <div style={{ padding: 10, fontSize: 11, color: C.dim }}>…y {vis.length - 600} pares más: busca una cabecera para verlos.</div>}
          {!lista.length && <div style={{ padding: 16, fontSize: 12, color: C.dim }}>La red no tiene cabeceras con coordenadas.</div>}
        </div>
      </div>
    </div>
  );
}
