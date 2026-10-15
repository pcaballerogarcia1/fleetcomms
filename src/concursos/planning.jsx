// Concursos → Planning: dimensionar el servicio.
// En un concurso casi nunca hay inventario con direcciones: el pliego da
// cantidades. Por eso aquí se dimensiona por RENDIMIENTOS con los servicios de
// la Ficha de requisitos (Documentos): cuánto hay que hacer al año y cuánto
// rinde un equipo por turno → turnos al año, vehículos y personas. Los
// rendimientos vienen con valores orientativos que se cambian. Si hay mapa
// (listado de contenedores o zonas), está la otra pestaña: el Planning de siempre.
import { FileText, Map as IconoMapa, Calculator } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { C, font } from "../tema.js";
import { PARAMETROS_DEFECTO, dimensionar, rendimientoOrientativo } from "./ficha.js";
import { escucharDimension, escucharFicha, guardarDimension } from "./store.js";

const FMT = (() => { try { return new Intl.NumberFormat("es-ES", { useGrouping: "always", maximumFractionDigits: 1 }); } catch { return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }); } })();
const num = n => FMT.format(Math.round(n * 10) / 10);
const PARAMS = [
  ["jornadasAnio", "Días de servicio al año", "días"],
  ["horasTurno", "Horas de trabajo por turno", "h"],
  ["personasPorEquipo", "Personas por equipo", "pers."],
  ["horasAnualesConvenio", "Horas al año de un trabajador (convenio)", "h"],
  ["absentismoPct", "Absentismo (bajas y ausencias)", "%"],
];

export function PlanningConcurso({ concursoId, mapa, irADocumentos }) {
  const [vista, setVista] = useState("rendimientos");
  const [ficha, setFicha] = useState(null);
  const [dim, setDim] = useState(null);
  const [local, setLocal] = useState(null); // cambios aún sin guardar (se guardan solos)
  useEffect(() => (concursoId ? escucharFicha(concursoId, setFicha) : undefined), [concursoId]);
  useEffect(() => (concursoId ? escucharDimension(concursoId, setDim) : undefined), [concursoId]);

  // guardado automático, un momento después del último cambio
  const tmr = useRef();
  useEffect(() => {
    if (!local) return;
    clearTimeout(tmr.current);
    tmr.current = setTimeout(() => { guardarDimension(concursoId, local).then(() => setLocal(null)).catch(e => console.warn("[dimension]", e)); }, 700);
    return () => clearTimeout(tmr.current);
  }, [local, concursoId]);

  const servicios = useMemo(() => Object.entries(ficha?.servicios || {}).map(([id, s]) => ({ id, ...s })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)), [ficha]);
  const jornadasPliego = ficha?.datos?.jornadasAnio && ficha.datos.jornadasAnio.estado !== "descartado" ? Number(ficha.datos.jornadasAnio.valor) : null;
  const parametros = { ...PARAMETROS_DEFECTO, ...(jornadasPliego ? { jornadasAnio: jornadasPliego } : {}), ...(dim?.parametros || {}), ...(local?.parametros || {}) };
  const porServicio = { ...(dim?.porServicio || {}), ...(local?.porServicio || {}) };
  const entrada = servicios.map(s => ({ ...s, porTurno: porServicio[s.id]?.porTurno ?? null, equipo: porServicio[s.id]?.equipo || s.nombre }));
  const r = dimensionar(entrada, parametros);

  const cambiarParam = (k, v) => setLocal(l => ({ ...(l || {}), parametros: { ...(l?.parametros || {}), [k]: v } }));
  const cambiarServicio = (id, k, v) => setLocal(l => ({ ...(l || {}), porServicio: { ...(l?.porServicio || {}), [id]: { ...(porServicio[id] || {}), [k]: v } } }));

  const tarjeta = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14 };
  const th = { textAlign: "left", padding: "8px 10px", fontSize: 11, color: C.dim, fontWeight: 600, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  const td = { padding: "5px 10px", fontSize: 13, color: C.text, whiteSpace: "nowrap" };

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: C.bg, fontFamily: font }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 650, color: C.text }}>Planning del concurso</div>
        <div className="op-seg">
          <button className={vista === "rendimientos" ? "op-on" : ""} onClick={() => setVista("rendimientos")}><Calculator size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />Por rendimientos</button>
          <button className={vista === "mapa" ? "op-on" : ""} onClick={() => setVista("mapa")}><IconoMapa size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />Mapa (listado o zonas)</button>
        </div>
        <div style={{ fontSize: 12, color: C.dim }}>{vista === "rendimientos" ? "Sin inventario: con las cantidades de la ficha y lo que rinde cada equipo." : "Si tienes el listado de contenedores (o dibujas zonas), para calcular rutas en Scheduling."}</div>
      </div>

      {vista === "mapa" ? <div style={{ flex: 1, position: "relative", display: "flex" }}>{mapa}</div> : (
        <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
          {!ficha ? <div style={{ color: C.muted, fontSize: 13 }}>Cargando…</div> : !servicios.length ? (
            <div style={{ ...tarjeta, padding: 28, textAlign: "center", maxWidth: 620 }}>
              <FileText size={30} color={C.dim} />
              <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginTop: 10 }}>Aún no hay servicios en la Ficha de requisitos</div>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>Sube el pliego en Documentos y añade a la ficha los servicios con su cantidad al año (de sus tablas o a mano). Con eso se dimensiona aquí.</div>
              <button className="op-btn op-primario" style={{ marginTop: 14 }} onClick={irADocumentos}>Ir a Documentos</button>
            </div>
          ) : <>
            {/* resultado */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 18 }}>
              {[["Vehículos", r.resumen.vehiculos, "uno por equipo y turno al día"], ["Personas", r.resumen.personas, `${num(r.resumen.personasExactas)} a jornada completa`], ["Turnos al año", num(r.resumen.turnosAnio), "de todos los servicios"], ["Horas al año", num(r.resumen.horasAnio), "de trabajo de las personas"]].map(([l, v, n]) => (
                <div key={l} className="op-tarjeta" style={{ padding: "12px 16px" }}>
                  <div style={{ fontSize: 12.5, color: C.muted }}>{l}</div>
                  <div style={{ fontSize: 24, fontWeight: 650, color: C.text, marginTop: 2 }}>{v}</div>
                  <div style={{ fontSize: 11.5, color: C.dim }}>{n}</div>
                </div>
              ))}
            </div>

            {/* parámetros */}
            <div style={{ ...tarjeta, padding: "12px 16px", display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
              {PARAMS.map(([k, l, u]) => (
                <label key={k} style={{ display: "grid", gap: 4, fontSize: 12, color: C.muted }}>
                  {l}{k === "jornadasAnio" && jornadasPliego ? <span style={{ fontSize: 11, color: C.dim }}>(el pliego dice {jornadasPliego})</span> : null}
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input className="op-input" type="number" min={0} value={parametros[k]} onChange={e => cambiarParam(k, Number(e.target.value))} style={{ width: 90, height: 30 }} />
                    <span style={{ color: C.dim }}>{u}</span>
                  </span>
                </label>
              ))}
            </div>

            {/* servicios */}
            <div style={{ fontSize: 14, fontWeight: 650, color: C.text, marginBottom: 8 }}>Servicios de la ficha</div>
            <div style={{ ...tarjeta, overflow: "auto", marginBottom: 18 }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr>{["Servicio", "Fracción", "Ubicación", "Al año", "Rinde por turno", "Equipo que lo hace", "Turnos al año"].map(h => <th key={h} style={{ ...th, textAlign: ["Al año", "Turnos al año"].includes(h) ? "right" : "left" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {r.lineas.map(l => {
                    const ori = rendimientoOrientativo(l);
                    const propio = porServicio[l.id]?.porTurno != null;
                    return (
                      <tr key={l.id} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={td}>{l.nombre}</td><td style={{ ...td, color: C.muted }}>{l.fraccion || "—"}</td><td style={{ ...td, color: C.muted }}>{l.ubicacion || "—"}</td>
                        <td style={{ ...td, textAlign: "right" }}>{num(l.cantidadAnual)}</td>
                        <td style={td} title={ori.nota}>
                          <input className="op-input" type="number" min={1} value={porServicio[l.id]?.porTurno ?? ""} placeholder={String(ori.porTurno)} onChange={e => cambiarServicio(l.id, "porTurno", e.target.value === "" ? null : Number(e.target.value))} style={{ width: 80, height: 30 }} />
                          <span style={{ fontSize: 11, color: propio ? C.green : C.amber, marginLeft: 8 }}>{propio ? "tuyo" : "orientativo"}</span>
                        </td>
                        <td style={td}><input className="op-input" value={porServicio[l.id]?.equipo ?? l.nombre} onChange={e => cambiarServicio(l.id, "equipo", e.target.value)} style={{ width: 200, height: 30 }} /></td>
                        <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(l.turnosAnio)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* equipos */}
            <div style={{ fontSize: 14, fontWeight: 650, color: C.text, marginBottom: 4 }}>Equipos</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 8 }}>Los servicios con el mismo nombre de equipo los hace el mismo vehículo (p. ej. «Taller» para correctivo y achiques).</div>
            <div style={{ ...tarjeta, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr>{["Equipo", "Turnos al año", "Turnos cada día", "Vehículos", "Ocupación"].map(h => <th key={h} style={{ ...th, textAlign: h === "Equipo" ? "left" : "right" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {r.equipos.map(e => (
                    <tr key={e.equipo} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={td}>{e.equipo}</td>
                      <td style={{ ...td, textAlign: "right" }}>{num(e.turnosAnio)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{num(e.porDia)}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 650 }}>{e.unidades}</td>
                      <td style={{ ...td, textAlign: "right", color: e.ocupacion < 0.5 ? C.amber : C.text }}>{Math.round(e.ocupacion * 100)} %{e.ocupacion < 0.5 ? " · se podría juntar con otro" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11.5, color: C.dim, marginTop: 10, lineHeight: 1.5, maxWidth: 820 }}>
              Turnos al año = cantidad al año ÷ lo que rinde un equipo en un turno. Vehículos = turnos que hacen falta cada día de servicio, redondeado hacia arriba. Personas = horas al año ÷ horas de un trabajador (convenio, descontando el absentismo). Se guarda solo y lo usa Cálculo.
            </div>
          </>}
        </div>
      )}
    </div>
  );
}
