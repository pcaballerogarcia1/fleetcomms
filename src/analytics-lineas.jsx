// Analytics de un proyecto de líneas regulares: análisis de tiempos reales.
// Con lo que Control ha anotado de cada expedición (salidas y llegadas
// reales), el tiempo de verdad por línea, sentido y franja frente al
// previsto, la puntualidad de salida y, con un clic, usar el tiempo real en
// Planning (tiempos de recorrido por franja).
import { useEffect, useMemo, useState } from "react";
import { leerRealPeriodo } from "./lineas-servicio-store.js";
import { analizarTiempos, PUNTUAL } from "./lineas-runtime.js";
import { watchRed, watchCfg, guardarCfgLinea, tiempoEfectivo } from "./lineas-store.js";
import { logAudit } from "./audit.js";

const C = {
  bg: "#0b0d12", card: "#12151c", surface2: "#181c25", border: "rgba(255,255,255,0.08)", border2: "rgba(255,255,255,0.14)",
  blue: "#5b7cfa", blueText: "#b4c3ff", green: "#3fcf8e", amber: "#f5b84a", red: "#f26d6d", text: "#e6e8ee", muted: "#9aa3b2", dim: "#5d6574",
};
const font = "var(--font)";
const mono = "var(--mono)";
const MIN_VIAJES = 5; // para «usar todos»: franjas con al menos estos viajes medidos
const fechaLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const pct = x => (x == null ? "—" : `${Math.round(x * 100)} %`);

export function AnalyticsLineasPage({ projectId, orgId }) {
  const [periodo, setPeriodo] = useState(7);
  const [estado, setEstado] = useState({ cargando: false, dias: null, error: null });
  const [red, setRed] = useState(null);
  const [cfg, setCfg] = useState({});
  const [soloDesvio, setSoloDesvio] = useState(false);
  const [nota, setNota] = useState(null);
  useEffect(() => watchRed(projectId, e => setRed(e.red)), [projectId]);
  useEffect(() => watchCfg(projectId, setCfg), [projectId]);

  async function analizar() {
    const hasta = new Date(), desde = new Date(); desde.setDate(desde.getDate() - (periodo - 1));
    setEstado({ cargando: true, dias: null, error: null }); setNota(null);
    try {
      const dias = await leerRealPeriodo(projectId, orgId, fechaLocal(desde), fechaLocal(hasta));
      setEstado({ cargando: false, dias, error: null });
    } catch (e) { setEstado({ cargando: false, dias: null, error: e.message || String(e) }); }
  }

  const analisis = useMemo(() => (estado.dias ? analizarTiempos(estado.dias.flatMap(d => d.turnos)) : null), [estado.dias]);
  const sentidoDe = (lid, dir) => red?.lineas.find(l => l.id === lid)?.sentidos.find(s => s.dir === dir);
  const enPlanning = f => { const s = sentidoDe(f.lid, f.dir); return s ? tiempoEfectivo(s, f.franja, cfg[f.lid]) : null; };
  const filas = (analisis?.filas || []).filter(f => !soloDesvio || (f.diferencia != null && Math.abs(f.diferencia) >= 2));
  const aplicables = filas.filter(f => f.n >= MIN_VIAJES && f.real != null && enPlanning(f) !== f.real);

  const usar = async lista => {
    let n = 0;
    for (const f of lista) {
      const linea = red?.lineas.find(l => l.id === f.lid);
      if (!linea) continue;
      await guardarCfgLinea(projectId, f.lid, { tiempos: { [`${f.dir}|${f.franja}`]: f.real } }, { nombreLinea: linea.nombre, detalle: `tiempos de recorrido de la línea ${linea.nombre} (del análisis de tiempos reales)` });
      n++;
    }
    setNota(`${n} tiempo${n === 1 ? "" : "s"} de recorrido actualizado${n === 1 ? "" : "s"} en Planning. El Scheduling avisará de que hay que recalcular.`);
    logAudit({ modulo: "Analytics", accion: "Aplicó tiempos reales a Planning", detalle: `${n} franjas` });
  };

  const th = { fontSize: 10.5, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 700, textAlign: "right", padding: "7px 10px", position: "sticky", top: 0, background: C.card, zIndex: 1, whiteSpace: "nowrap" };
  const td = { padding: "6px 10px", fontSize: 12, borderTop: `1px solid ${C.border}`, whiteSpace: "nowrap", textAlign: "right", fontFamily: mono, color: C.text };
  const tarjeta = (v, l, sub, color) => (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", minWidth: 170 }}>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: mono, color: color || C.blueText }}>{v}</div>
      <div style={{ fontSize: 9.5, color: C.text, textTransform: "uppercase", letterSpacing: .8, fontWeight: 700, marginTop: 3 }}>{l}</div>
      {sub && <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{sub}</div>}
    </div>
  );
  return (
    <div style={{ padding: "18px 22px", overflow: "auto", height: "100%", boxSizing: "border-box", fontFamily: font }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Análisis de tiempos reales</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.55, maxWidth: 900 }}>
        Con lo que Control ha anotado de cada expedición publicada (salida y llegada reales): lo que tarda de verdad cada línea por franja frente a lo previsto, y si sale a su hora
        (puntual = entre {PUNTUAL.antes} min antes y {PUNTUAL.despues} min después). Puedes usar el tiempo real como tiempo de recorrido en Planning.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, color: C.muted }}>Periodo</span>
        <div style={{ display: "flex", gap: 2, background: C.bg, borderRadius: 6, padding: 2 }}>
          {[7, 14, 30].map(d => <button key={d} onClick={() => setPeriodo(d)} style={{ padding: "4px 10px", borderRadius: 4, border: "none", cursor: "pointer", background: periodo === d ? "rgba(255,255,255,0.1)" : "none", color: periodo === d ? "#fff" : C.muted, fontSize: 11.5, fontFamily: font }}>últimos {d} días</button>)}
        </div>
        <button onClick={analizar} disabled={estado.cargando} style={{ padding: "7px 16px", borderRadius: 7, border: "none", background: C.blue, color: "#fff", fontSize: 12, fontWeight: 600, cursor: estado.cargando ? "wait" : "pointer", fontFamily: font }}>{estado.cargando ? "Leyendo los días publicados…" : "Analizar"}</button>
        <span style={{ fontSize: 10.5, color: C.dim }}>Lee los turnos de los días publicados del periodo (una lectura por turno).</span>
      </div>
      {estado.error && <div style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>No se pudo leer: {estado.error}</div>}
      {nota && <div style={{ fontSize: 12, color: C.green, marginBottom: 10 }}>{nota}</div>}
      {estado.dias && !estado.dias.length && <div style={{ fontSize: 12.5, color: C.muted }}>No hay días publicados en Control en este periodo.</div>}
      {analisis && estado.dias?.length > 0 && <>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          {tarjeta(estado.dias.length, "Días publicados", `${estado.dias[0].fecha} a ${estado.dias.at(-1).fecha}`)}
          {tarjeta(analisis.totales.viajesMedidos.toLocaleString("es-ES"), "Viajes medidos", "con salida y llegada reales")}
          {tarjeta(pct(analisis.totales.puntualidad), "Puntualidad de salida", `${analisis.totales.salidasMedidas.toLocaleString("es-ES")} salidas`, analisis.totales.puntualidad == null ? undefined : analisis.totales.puntualidad >= 0.85 ? C.green : analisis.totales.puntualidad >= 0.7 ? C.amber : C.red)}
          {tarjeta(filas.filter(f => f.diferencia != null && f.diferencia >= 3).length, "Franjas que tardan más", "3 min o más sobre lo previsto", C.amber)}
        </div>
        {!analisis.totales.viajesMedidos && <div style={{ fontSize: 12, color: C.amber, marginBottom: 10 }}>Aún no hay viajes con salida y llegada anotadas: las anota la app del conductor al hacer el turno (o Control).</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
          <label style={{ fontSize: 11.5, color: C.muted, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" checked={soloDesvio} onChange={e => setSoloDesvio(e.target.checked)} style={{ accentColor: C.blue }} />Solo las que se desvían 2 min o más</label>
          <button onClick={() => window.confirm(`¿Usar el tiempo real en ${aplicables.length} franjas (con ${MIN_VIAJES} viajes medidos o más)?`) && usar(aplicables)} disabled={!aplicables.length}
            style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${C.green}88`, background: "rgba(63,207,142,.1)", color: C.green, fontSize: 11.5, fontWeight: 600, cursor: aplicables.length ? "pointer" : "not-allowed", opacity: aplicables.length ? 1 : 0.5, fontFamily: font }}>
            Usar el tiempo real en todas ({aplicables.length})
          </button>
        </div>
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "auto", background: C.card, maxHeight: "calc(100vh - 380px)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={{ ...th, textAlign: "left" }}>Línea</th><th style={{ ...th, textAlign: "left" }}>Sentido</th><th style={{ ...th, textAlign: "left" }}>Franja</th>
              <th style={th}>Viajes</th><th style={th}>Previsto</th><th style={th}>Real</th><th style={th} title="El 85 % de los viajes tarda esto o menos">Real (días malos)</th><th style={th}>Diferencia</th><th style={th}>Puntualidad</th><th style={th}>En Planning</th><th style={th} />
            </tr></thead>
            <tbody>
              {filas.map(f => {
                const plan = enPlanning(f);
                const col = f.diferencia == null ? C.dim : f.diferencia >= 3 ? C.red : f.diferencia <= -3 ? C.amber : C.green;
                return (
                  <tr key={f.clave}>
                    <td style={{ ...td, textAlign: "left", fontFamily: font, fontWeight: 700 }}>{f.linea}</td>
                    <td style={{ ...td, textAlign: "left", fontFamily: font, color: C.muted }}>{f.sentido}</td>
                    <td style={{ ...td, textAlign: "left" }}>{f.franja.replace("-", "–")} h</td>
                    <td style={td}>{f.n}{f.salidas > f.n ? <span style={{ color: C.dim }}> / {f.salidas}</span> : ""}</td>
                    <td style={td}>{f.previsto ?? "—"}′</td>
                    <td style={{ ...td, fontWeight: 700 }}>{f.real ?? "—"}′</td>
                    <td style={{ ...td, color: C.muted }}>{f.p85 ?? "—"}′</td>
                    <td style={{ ...td, color: col }}>{f.diferencia == null ? "—" : `${f.diferencia > 0 ? "+" : ""}${f.diferencia}′`}</td>
                    <td style={{ ...td, color: f.puntualidad == null ? C.dim : f.puntualidad >= 0.85 ? C.green : f.puntualidad >= 0.7 ? C.amber : C.red }}>{pct(f.puntualidad)}</td>
                    <td style={{ ...td, color: C.muted }}>{plan ?? "—"}′</td>
                    <td style={{ ...td }}>
                      {f.real != null && plan !== f.real
                        ? <button onClick={() => usar([f])} title={f.n < MIN_VIAJES ? `Solo ${f.n} viaje(s) medido(s): poco para fiarse` : "Poner este tiempo como tiempo de recorrido de esta franja en Planning"} style={{ padding: "2px 9px", borderRadius: 5, border: `1px solid ${C.border2}`, background: "none", color: f.n < MIN_VIAJES ? C.dim : C.blueText, fontSize: 11, cursor: "pointer", fontFamily: font }}>Usar el real</button>
                        : f.real != null && <span style={{ fontSize: 11, color: C.green, fontFamily: font }}>ya está</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filas.length && <div style={{ padding: 14, fontSize: 12, color: C.dim }}>Nada que enseñar con este filtro.</div>}
        </div>
      </>}
    </div>
  );
}
