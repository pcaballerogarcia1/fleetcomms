// Análisis → Realizado: cada ruta publicada, lo previsto frente a lo hecho
import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileDown } from "lucide-react";
import { C, font } from "../tema.js";
import { filasRealizado, totalesRealizado } from "./realizado.js";
import { Cifra, Diferencia } from "./ui.jsx";
import { hora, horas, num, td, th } from "./formato.js";

const fechaCorta = f => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : "—");

export function PanelRealizado({ planes, fichajes, mes }) {
  const todas = useMemo(() => filasRealizado(planes, fichajes), [planes, fichajes]);
  const dias = useMemo(() => [...new Set(todas.map(f => f.fecha).filter(Boolean))].sort(), [todas]);
  const [dia, setDia] = useState("");
  const [soloIncompletas, setSoloIncompletas] = useState(false);
  const [abierta, setAbierta] = useState(null);
  const filas = todas.filter(f => (!dia || f.fecha === dia) && (!soloIncompletas || f.hechas < f.paradas));
  const t = totalesRealizado(filas);

  async function excel() {
    const XLSX = await import("xlsx");
    const rows = [["Fecha", "Ruta", "Conductor", "Paradas", "Hechas", "% hecho", "Inicio previsto", "Fin previsto", "Inicio real", "Fin real", "Horas previstas", "Horas reales", "Km previstos", "Km reales", "Retraso medio (min)", "Paradas sin hacer"]];
    for (const f of filas) rows.push([f.fecha, f.ruta, f.conductor, f.paradas, f.hechas, f.pct, hora(f.plan?.inicio), hora(f.plan?.fin), hora(f.real?.inicio), hora(f.real?.fin),
      f.plan?.minutos != null ? +(f.plan.minutos / 60).toFixed(2) : "", f.real?.minutos != null ? +(f.real.minutos / 60).toFixed(2) : "",
      f.plan?.km ?? "", f.real?.km ?? "", f.retrasoMedio ?? "", f.pendientes.join("; ")]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Realizado");
    XLSX.writeFile(wb, `realizado_${dia || mes}.xlsx`);
  }

  if (!todas.length) return <div style={{ color: C.dim, fontSize: 13, padding: "40px 0", textAlign: "center" }}>No hay rutas publicadas este mes. Se publican desde Rutas con «Enviar a conductores».</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontFamily: font }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Cifra label="Paradas hechas" value={`${t.pct} %`} sub={`${num(t.hechas)} de ${num(t.paradas)} · ${t.incompletas} rutas sin terminar`} color={t.pct >= 95 ? C.green : t.pct >= 80 ? C.amber : C.red}
          ayuda="Paradas marcadas como hechas en la app del conductor, de todas las de las rutas publicadas." />
        <Cifra label="Km reales / previstos" value={t.conKm ? `${num(t.kmReal)} / ${num(t.kmPlan)}` : "—"} sub={t.conKm ? <Diferencia plan={t.kmPlan} real={t.kmReal} fmt={v => `${num(v)} km`} /> : "Faltan fichajes con km o rutas con km previstos"}
          ayuda="Km de los fichajes (al entrar y salir) frente a los km de la ruta calculada. Solo las rutas que tienen las dos cosas." />
        <Cifra label="Horas reales / previstas" value={t.conHoras ? `${horas(t.minReal)} / ${horas(t.minPlan)}` : "—"} sub={t.conHoras ? <Diferencia plan={t.minPlan} real={t.minReal} fmt={horas} /> : "Faltan fichajes cerrados"}
          ayuda="De la entrada a la salida del fichaje, frente a la jornada calculada de la ruta." />
        <Cifra label="Rutas sin fichaje" value={t.sinFichaje} sub="no se puede comparar horas ni km" color={t.sinFichaje ? C.amber : undefined}
          ayuda="Rutas cuyo conductor no fichó ese día (o la ruta es del vehículo y nadie marcó paradas)." />
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <select value={dia} onChange={e => setDia(e.target.value)} className="op-input" style={{ width: 170, height: 30 }} aria-label="Día">
          <option value="">Todo el mes</option>
          {dias.map(d => <option key={d} value={d}>{new Date(d + "T12:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.muted, cursor: "pointer" }}>
          <input type="checkbox" checked={soloIncompletas} onChange={e => setSoloIncompletas(e.target.checked)} style={{ accentColor: C.blue }} />Solo las que no se terminaron
        </label>
        <div style={{ flex: 1 }} />
        <button className="op-btn" onClick={excel}><FileDown size={14} />Descargar Excel</button>
      </div>

      <div className="op-tarjeta" style={{ overflow: "auto", maxHeight: "60vh", padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            {["", "Fecha", "Ruta", "Conductor", "Paradas", "Jornada prevista", "Jornada real", "Km previstos", "Km reales", "Diferencia km", "Retraso medio"].map(h => <th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {filas.map(f => (
              <Fragment key={f.id}>
                <tr onClick={() => setAbierta(a => (a === f.id ? null : f.id))} style={{ cursor: f.pendientes.length ? "pointer" : "default" }}>
                  <td style={{ ...td, width: 20, color: C.dim }}>{f.pendientes.length ? (abierta === f.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}</td>
                  <td style={td}>{fechaCorta(f.fecha)}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{f.ruta}</td>
                  <td style={{ ...td, color: C.muted, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{f.conductor}</td>
                  <td style={td}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 60, height: 6, borderRadius: 4, background: C.surface2, overflow: "hidden" }}>
                        <span style={{ display: "block", width: `${f.pct}%`, height: "100%", background: f.pct === 100 ? C.green : f.pct >= 80 ? C.amber : C.red }} />
                      </span>
                      {f.hechas}/{f.paradas}
                    </span>
                  </td>
                  <td style={td}>{f.plan?.inicio != null ? `${hora(f.plan.inicio)}–${hora(f.plan.fin)}` : "—"}</td>
                  <td style={td}>{f.real ? `${hora(f.real.inicio)}–${f.real.abierto ? "abierta" : hora(f.real.fin)}` : <span style={{ color: C.amber }}>sin fichaje</span>}</td>
                  <td style={td}>{f.plan?.km != null ? num(f.plan.km, 1) : "—"}</td>
                  <td style={td}>{f.real?.km != null ? num(f.real.km, 1) : "—"}</td>
                  <td style={td}><Diferencia plan={f.plan?.km} real={f.real?.km} fmt={v => num(v, 1)} /></td>
                  <td style={{ ...td, color: f.retrasoMedio == null ? C.dim : Math.abs(f.retrasoMedio) <= 15 ? C.text : f.retrasoMedio > 0 ? C.red : C.green }}>
                    {f.retrasoMedio == null ? "—" : f.retrasoMedio === 0 ? "en hora" : `${f.retrasoMedio > 0 ? "+" : "−"}${horas(Math.abs(f.retrasoMedio))}`}
                  </td>
                </tr>
                {abierta === f.id && f.pendientes.length > 0 && (
                  <tr><td colSpan={11} style={{ ...td, whiteSpace: "normal", background: C.surface2, color: C.muted }}>
                    <b style={{ color: C.text }}>Sin hacer ({f.pendientes.length}):</b> {f.pendientes.join(" · ")}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: C.dim }}>
        Las horas y km previstos se guardan al publicar las rutas desde Rutas; las publicadas antes de este cambio salen sin ellos. El retraso medio compara la hora en que se marcó cada parada con la prevista.
      </div>
    </div>
  );
}
