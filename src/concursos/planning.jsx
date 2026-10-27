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
import { dimensionar, entradaDimension, esTransporte, parqueDelPliego, rendimientoOrientativo } from "./ficha.js";
import { ponerKm } from "./plataforma.js";
import { origenDe } from "./tecnico.js";
import { DESPLAZAMIENTO_DEFECTO, UTIL_DEFECTO, minutosOrientativos, rendimientoConInventario, resumenInventario, vanJuntas } from "./inventario.js";
import { PanelInventario } from "./inventario-panel.jsx";
import { escucharDimension, escucharDocumentos, escucharFicha, escucharInventario, guardarDimension } from "./store.js";

const FMT = (() => { try { return new Intl.NumberFormat("es-ES", { useGrouping: "always", maximumFractionDigits: 1 }); } catch { return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }); } })();
const num = n => FMT.format(Math.round(n * 10) / 10);
const PARAMS = [
  ["jornadasAnio", "Días de servicio al año", "días"],
  ["horasTurno", "Horas de trabajo por turno", "h"],
  ["horasAnualesConvenio", "Horas al año de un trabajador (convenio)", "h"],
  ["absentismoPct", "Absentismo (bajas y ausencias)", "%"],
];
// con transportes: los viajes
const PARAMS_TRANSPORTE = [
  ["cargaViaje", "Carga de un viaje (si no se dice en el servicio)", "t"],
  ["horasCargaDescarga", "Carga, descarga y esperas por viaje", "h"],
];
// con inventario: para estimar lo que rinde un equipo con los puntos reales
const PARAMS_INVENTARIO = [
  ["desplazamiento", "Minutos de un punto al siguiente", "min"],
  ["utilPct", "Parte del turno trabajando", "%"],
];

export function PlanningConcurso({ concursoId, mapa, irADocumentos }) {
  const [vista, setVista] = useState("rendimientos");
  const [ficha, setFicha] = useState(null);
  const [dim, setDim] = useState(null);
  const [local, setLocal] = useState(null); // cambios aún sin guardar (se guardan solos)
  useEffect(() => (concursoId ? escucharFicha(concursoId, setFicha) : undefined), [concursoId]);
  useEffect(() => (concursoId ? escucharDimension(concursoId, setDim) : undefined), [concursoId]);
  const [inventario, setInventario] = useState(null);
  const [docs, setDocs] = useState([]);
  useEffect(() => (concursoId ? escucharInventario(concursoId, setInventario) : undefined), [concursoId]);
  useEffect(() => (concursoId ? escucharDocumentos(concursoId, setDocs) : undefined), [concursoId]);
  const resumen = useMemo(() => (inventario?.contenedores?.length ? resumenInventario(inventario.contenedores) : null), [inventario]);
  const parque = useMemo(() => docs.flatMap(d => parqueDelPliego(d.lectura?.tablas || [])), [docs]);

  // guardado automático, un momento después del último cambio
  const tmr = useRef();
  useEffect(() => {
    if (!local) return;
    clearTimeout(tmr.current);
    tmr.current = setTimeout(() => { guardarDimension(concursoId, local).then(() => setLocal(null)).catch(e => console.warn("[dimension]", e)); }, 700);
    return () => clearTimeout(tmr.current);
  }, [local, concursoId]);

  // el municipio, para buscar las direcciones: «Ayuntamiento de Palma» → Palma
  const organismo = String(ficha?.datos?.organismo?.valor || "");
  const municipioSugerido = organismo.match(/(?:ayuntamiento|ajuntament|concello) (?:de |d'|del )?([A-ZÁÉÍÓÚÑ][\wáéíóúñ' -]{2,40})/i)?.[1]?.trim() || null;
  const jornadasPliego = ficha?.datos?.jornadasAnio && ficha.datos.jornadasAnio.estado !== "descartado" ? Number(ficha.datos.jornadasAnio.valor) : null;
  // lo guardado más lo que aún se está guardando
  const { servicios, parametros, porServicio, entrada } = useMemo(() => entradaDimension(ficha, {
    parametros: { ...(dim?.parametros || {}), ...(local?.parametros || {}) },
    porServicio: { ...(dim?.porServicio || {}), ...(local?.porServicio || {}) },
  }, { desplazamiento: DESPLAZAMIENTO_DEFECTO, utilPct: UTIL_DEFECTO * 100 }), [ficha, dim, local]);
  const r = dimensionar(entrada, parametros);
  // lo que rendiría cada servicio con los puntos del inventario
  const conInventario = id => {
    const s = servicios.find(x => x.id === id);
    if (!resumen || !s) return null;
    return rendimientoConInventario(s, resumen, { horasTurno: parametros.horasTurno, minPorContenedor: porServicio[id]?.minCont ?? undefined, desplazamiento: parametros.desplazamiento, util: parametros.utilPct / 100, todasEnElPunto: vanJuntas(s, servicios, resumen) });
  };
  const usarTodosInventario = () => setLocal(l => {
    const ps = { ...(l?.porServicio || {}) };
    for (const s of servicios) { const e = conInventario(s.id); if (e) ps[s.id] = { ...(porServicio[s.id] || {}), ...(ps[s.id] || {}), porTurno: e.porTurno, deInventario: true }; }
    return { ...(l || {}), porServicio: ps };
  });

  const cambiarParam = (k, v) => setLocal(l => ({ ...(l || {}), parametros: { ...(l?.parametros || {}), [k]: v } }));
  const cambiarServicio = (id, k, v) => setLocal(l => ({ ...(l || {}), porServicio: { ...(l?.porServicio || {}), [id]: { ...(porServicio[id] || {}), [k]: v } } }));
  const cambiarVarios = (id, o) => setLocal(l => ({ ...(l || {}), porServicio: { ...(l?.porServicio || {}), [id]: { ...(porServicio[id] || {}), ...(l?.porServicio?.[id] || {}), ...o } } }));

  // transporte: los km por carretera de cada origen a su destino (con los sitios y el destino que da el pliego)
  const transportes = r.lineas.filter(l => esTransporte(l));
  const [km, setKm] = useState(null); // { ocupado, error }
  async function calcularKm() {
    const lugares = docs.flatMap(d => d.lectura?.tecnico?.lugares || []);
    const destinoPliego = docs.map(d => d.lectura?.tecnico?.destino?.nombre).find(Boolean) || null;
    const lista = transportes.map(l => {
      const nombre = l.origen?.nombre || origenDe(l.ubicacion || "") || origenDe(l.nombre) || l.ubicacion;
      const lugar = lugares.find(x => x.nombre === nombre || origenDe(x.nombre) === nombre);
      return { id: l.id, origen: l.origen?.direccion ? l.origen : { nombre, direccion: lugar?.direccion || null, municipio: lugar?.municipio || null }, destino: l.destino || destinoPliego };
    }).filter(x => x.origen?.nombre && x.destino);
    if (!lista.length) { setKm({ error: "El pliego no dice de dónde a dónde: pon los km a mano." }); return; }
    setKm({ ocupado: true });
    try {
      const fallos = await ponerKm(lista);
      for (const x of lista) if (x.kmIda) cambiarVarios(x.id, { kmIda: x.kmIda, minutosIda: x.minutosIda, kmDesde: x.kmDesde, kmHasta: x.kmHasta });
      setKm(fallos.length ? { error: `${fallos.join(" · ")}. Ponlos a mano.` } : null);
    } catch (e) { setKm({ error: e.message || String(e) }); }
  }
  // la primera vez, solos
  const kmLanzado = useRef(false);
  useEffect(() => {
    if (kmLanzado.current || !ficha || !docs.length || !transportes.length || transportes.some(l => Number(l.kmIda) > 0)) return;
    kmLanzado.current = true;
    setTimeout(calcularKm, 0);
  });

  const tarjeta = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 };
  const th = { textAlign: "left", padding: "8px 10px", fontSize: 11, color: C.dim, fontWeight: 600, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  const td = { padding: "5px 10px", fontSize: 13, color: C.text, whiteSpace: "nowrap" };

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: C.bg, fontFamily: font }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 650, color: C.text }}>Planificación del concurso</div>
        <div className="op-seg">
          <button className={vista === "rendimientos" ? "op-on" : ""} onClick={() => setVista("rendimientos")}><Calculator size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />Por rendimientos</button>
          <button className={vista === "mapa" ? "op-on" : ""} onClick={() => setVista("mapa")}><IconoMapa size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />Mapa (con coordenadas)</button>
        </div>
        <div style={{ fontSize: 12, color: C.dim }}>{vista === "rendimientos" ? "Con las cantidades de la ficha y lo que rinde cada equipo. Aquí se sube el listado de contenedores, tenga o no coordenadas." : "Para calcular las rutas: listado con coordenadas o zonas dibujadas. ¿Tu listado no tiene coordenadas? Súbelo en «Por rendimientos»."}</div>
      </div>

      {vista === "mapa" ? <div style={{ flex: 1, position: "relative", display: "flex" }}>{mapa}</div> : (
        <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
          {!ficha ? <div style={{ color: C.muted, fontSize: 13 }}>Cargando…</div> : !servicios.length ? <>
            {/* el listado de contenedores se puede subir ya, aunque aún no haya servicios */}
            <PanelInventario concursoId={concursoId} inventario={inventario} resumen={resumen} parque={parque} municipioSugerido={municipioSugerido} onVerMapa={() => setVista("mapa")} />
            <div style={{ ...tarjeta, padding: 28, textAlign: "center", maxWidth: 620 }}>
              <FileText size={30} color={C.dim} />
              <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginTop: 10 }}>Aún no hay servicios en la Ficha de requisitos</div>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>Sube el pliego en Documentos y añade a la ficha los servicios con su cantidad al año (de sus tablas o a mano). Con eso se dimensiona aquí.</div>
              <button className="op-btn op-primario" style={{ marginTop: 14 }} onClick={irADocumentos}>Ir a Documentos</button>
            </div>
          </> : <>
            {/* resultado */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 18 }}>
              {[["Vehículos", r.resumen.vehiculos, "uno por equipo y turno al día"], ["Personas", r.resumen.personas, `${num(r.resumen.personasExactas)} a jornada completa`], ["Turnos al año", num(r.resumen.turnosAnio), "de todos los servicios"], ["Horas al año", num(r.resumen.horasAnio), "de trabajo de las personas"]].map(([l, v, n]) => (
                <div key={l} className="op-tarjeta" style={{ padding: "12px 16px" }}>
                  <div style={{ fontSize: 13, color: C.muted }}>{l}</div>
                  <div style={{ fontSize: 28, fontWeight: 650, color: C.text, marginTop: 2 }}>{v}</div>
                  <div style={{ fontSize: 12, color: C.dim }}>{n}</div>
                </div>
              ))}
            </div>

            <PanelInventario concursoId={concursoId} inventario={inventario} resumen={resumen} parque={parque} municipioSugerido={municipioSugerido} onVerMapa={() => setVista("mapa")} />

            {/* parámetros */}
            <div style={{ ...tarjeta, padding: "12px 16px", display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
              {[...PARAMS, ...(resumen ? PARAMS_INVENTARIO : []), ...(transportes.length ? PARAMS_TRANSPORTE : [])].map(([k, l, u]) => (
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
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 15, fontWeight: 650, color: C.text }}>Servicios de la ficha</div>
              {resumen && <button className="op-btn" onClick={usarTodosInventario} title="Pone en cada servicio lo que rinde con los puntos del inventario">Usar los rendimientos del inventario</button>}
              {transportes.length > 0 && <button className="op-btn" disabled={km?.ocupado} onClick={calcularKm} title="Busca cada origen y el destino que da el pliego y mide la ruta por carretera">{km?.ocupado ? "Midiendo…" : "Calcular km por carretera"}</button>}
              {km?.error && <span style={{ fontSize: 12, color: C.amber }}>{km.error}</span>}
            </div>
            <div style={{ ...tarjeta, overflow: "auto", marginBottom: 18 }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr>{["Servicio", "Fracción", "Ubicación", "Al año", ...(resumen ? ["Min. por contenedor", "Con el inventario"] : []), "Rinde por turno", "Vehículo", "Personas", "Turnos al año"].map(h => <th key={h} style={{ ...th, textAlign: ["Al año", "Turnos al año"].includes(h) ? "right" : "left" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {r.lineas.map(l => {
                    const ori = rendimientoOrientativo(l);
                    const propio = porServicio[l.id]?.porTurno != null;
                    return (
                      <tr key={l.id} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={td}>{l.nombre}</td><td style={{ ...td, color: C.muted }}>{l.fraccion || "—"}</td><td style={{ ...td, color: C.muted }}>{l.ubicacion || "—"}</td>
                        <td style={{ ...td, textAlign: "right" }} title={l.cantidadPresupuesto ? `${num(l.cantidadPresupuesto)} en el presupuesto de ${l.periodoMeses} meses` : ""}>{num(l.cantidadAnual)}{l.unidad ? ` ${l.unidad}` : ""}</td>
                        {resumen && (() => {
                          const e = conInventario(l.id);
                          return <>
                            <td style={td}><input className="op-input" type="number" min={0.5} step={0.5} value={porServicio[l.id]?.minCont ?? ""} placeholder={String(minutosOrientativos(l))} onChange={ev => cambiarServicio(l.id, "minCont", ev.target.value === "" ? null : Number(ev.target.value))} style={{ width: 70, height: 30 }} /></td>
                            <td style={td}>{e ? <span title={`${num(e.porPunto)} contenedores por punto en ${e.puntos} puntos; ${e.minPorContenedor} min por contenedor`}><b>{e.porTurno}</b> <span style={{ color: C.dim, fontSize: 12 }}>({num(e.porPunto)}/punto{vanJuntas(servicios.find(x => x.id === l.id), servicios, resumen) ? ", todas las fracciones" : ""})</span> <button className="op-btn op-fantasma" style={{ height: 24, padding: "0 6px", fontSize: 11 }} onClick={() => cambiarServicio(l.id, "porTurno", e.porTurno)}>Usar</button></span> : <span style={{ color: C.dim, fontSize: 12 }}>no va por puntos</span>}</td>
                          </>;
                        })()}
                        {esTransporte(l) ? (
                          <td style={td} title={l.kmDesde || porServicio[l.id]?.kmDesde ? `Ruta por carretera desde «${porServicio[l.id]?.kmDesde || l.kmDesde}» hasta «${porServicio[l.id]?.kmHasta || l.kmHasta}»` : "Km de ida y toneladas por viaje"}>
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <input className="op-input" type="number" min={0} value={l.kmIda ?? ""} placeholder="km" onChange={e => cambiarVarios(l.id, { kmIda: e.target.value === "" ? null : Number(e.target.value), minutosIda: null })} style={{ width: 70, height: 30 }} />
                              <span style={{ fontSize: 12, color: C.dim }}>km ida ·</span>
                              <input className="op-input" type="number" min={1} value={porServicio[l.id]?.cargaViaje ?? ""} placeholder={String(parametros.cargaViaje)} onChange={e => cambiarServicio(l.id, "cargaViaje", e.target.value === "" ? null : Number(e.target.value))} style={{ width: 60, height: 30 }} />
                              <span style={{ fontSize: 12, color: C.dim }}>{l.unidad || "t"}/viaje</span>
                            </div>
                            <div style={{ fontSize: 11, color: l.viajesAnio ? C.muted : C.amber, marginTop: 2 }}>{l.viajesAnio ? `${num(l.viajesAnio)} viajes al año · ${num(l.horasViaje)} h por viaje${l.minutosIda ? ` (${l.minutosIda} min de ida)` : ""}` : "sin km: pon los km de ida o pulsa «Calcular km»"}</div>
                          </td>
                        ) : (
                        <td style={td} title={ori.nota}>
                          <input className="op-input" type="number" min={1} value={porServicio[l.id]?.porTurno ?? ""} placeholder={String(ori.porTurno)} onChange={e => cambiarServicio(l.id, "porTurno", e.target.value === "" ? null : Number(e.target.value))} style={{ width: 80, height: 30 }} />
                          <span style={{ fontSize: 11, color: propio ? C.green : C.amber, marginLeft: 8 }}>{propio ? "tuyo" : "orientativo"}</span>
                        </td>
                        )}
                        <td style={td}>
                          <input className="op-input" value={porServicio[l.id]?.vehiculo ?? l.vehiculo} onChange={e => cambiarServicio(l.id, "vehiculo", e.target.value)} style={{ width: 220, height: 30 }} />
                          <span style={{ fontSize: 11, marginLeft: 8, color: servicios.find(x => x.id === l.id)?.vehiculo ? C.green : C.amber }} title={servicios.find(x => x.id === l.id)?.equipoPagina ? `pág. ${servicios.find(x => x.id === l.id).equipoPagina}` : "el pliego no lo fija"}>{servicios.find(x => x.id === l.id)?.vehiculo ? "pliego" : "orientativo"}</span>
                        </td>
                        <td style={td}><input className="op-input" type="number" min={1} value={porServicio[l.id]?.personas ?? l.personas} onChange={e => cambiarServicio(l.id, "personas", e.target.value === "" ? null : Number(e.target.value))} style={{ width: 60, height: 30 }} /></td>
                        <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(l.turnosAnio)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* equipos */}
            <div style={{ fontSize: 15, fontWeight: 650, color: C.text, marginBottom: 4 }}>Equipos por tipo de vehículo</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>Cada tipo de vehículo, con los servicios que hace, las personas que lleva y cuántos hacen falta. Los servicios con el mismo vehículo lo comparten.</div>
            <div style={{ ...tarjeta, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr>{["Vehículo", "Servicios", "Personas por equipo", "Turnos al año", "Turnos cada día", "Vehículos", "Ocupación"].map(h => <th key={h} style={{ ...th, textAlign: ["Vehículo", "Servicios"].includes(h) ? "left" : "right" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {r.equipos.map(e => (
                    <tr key={e.equipo} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ ...td, fontWeight: 600 }}>{e.equipo}</td>
                      <td style={{ ...td, color: C.muted, whiteSpace: "normal", minWidth: 180 }}>{e.servicios.join(", ")}</td>
                      <td style={{ ...td, textAlign: "right" }}>{e.personas}</td>
                      <td style={{ ...td, textAlign: "right" }}>{num(e.turnosAnio)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{num(e.porDia)}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 650 }}>{e.unidades}</td>
                      <td style={{ ...td, textAlign: "right", color: e.ocupacion < 0.5 ? C.amber : C.text }}>{Math.round(e.ocupacion * 100)} %{e.ocupacion < 0.5 ? " · se podría juntar con otro" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 10, lineHeight: 1.5, maxWidth: 820 }}>
              Turnos al año = cantidad al año ÷ lo que rinde un equipo en un turno (en los transportes: viajes × horas por viaje ÷ horas del turno; viajes = cantidad ÷ carga; horas = ida y vuelta por carretera, un 15 % más lento que un coche, más la carga y descarga). Vehículos = turnos que hacen falta cada día de servicio, por tipo de vehículo, redondeado hacia arriba. Personas = horas al año (cada turno con las personas de su equipo) ÷ horas de un trabajador (convenio, descontando el absentismo). El vehículo y las personas de cada servicio vienen del pliego cuando lo exige («pliego»); si no, orientativos. Se guarda solo y lo usa Cálculo.
            </div>
          </>}
        </div>
      )}
    </div>
  );
}
