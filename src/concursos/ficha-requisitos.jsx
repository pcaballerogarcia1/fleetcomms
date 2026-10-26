// Concursos → Documentos → Ficha de requisitos: lo que vale del pliego.
// El lector propone (con su página); aquí cada dato se confirma, se corrige o
// se descarta, y los servicios con su cantidad al año se eligen de las tablas
// del pliego (o se añaden a mano). De esta ficha leen los demás módulos.
import { Check, Pencil, Plus, Trash2, TriangleAlert, Truck, X } from "lucide-react";
import { useState } from "react";
import { C } from "../tema.js";
import { CriteriosFicha } from "./criterios-ficha.jsx";
import { contextoDelConcurso, equipoDe, preciosDelPliego, propuestasDeServicios, revisarPeriodo, servicioParaGuardar } from "./ficha.js";
import { cambiarConcurso, fijarDato, fijarEstudio, fijarServicio } from "./store.js";
import { alConcurso, confirmarLoLeido, pendientes, propuestasDe } from "./confirmar.js";

const GRUPOS = [
  ["Contrato", ["expediente", "organismo", "objeto", "procedimiento", "cpv", "lotes", "duracion", "prorroga", "fechaLimite", "presupuesto", "importeSinIva", "importeConIva", "valorEstimado", "precioPrimerAnio", "ivaPct", "importeAnual", "puntosPrecio", "garantia", "solvencia"]],
  ["Servicio", ["contenedores", "vecesAnio", "operacionesAnio", "jornadasAnio", "dias", "temporadaAlta", "nocturno", "inicio", "habitantes", "lineas", "expediciones", "kmAnuales", "horasAnuales"]],
  ["Medios y personal", ["vehiculos", "antiguedad", "revierte", "subrogacion", "maquinariaMinima", "personalMinimo", "plantilla", "convenio"]],
  ["Quién paga qué", ["agua", "vertido"]],
];
const FMT = (() => { try { return new Intl.NumberFormat("es-ES", { useGrouping: "always", maximumFractionDigits: 2 }); } catch { return new Intl.NumberFormat("es-ES"); } })();
const DINERO = new Set(["presupuesto", "valorEstimado", "importeAnual", "importeSinIva", "importeConIva", "precioPrimerAnio"]);
const txt = (clave, v) => (v == null ? "—" : DINERO.has(clave) ? `${FMT.format(v)} €` : clave === "fechaLimite" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`).toLocaleDateString("es-ES") : typeof v === "number" ? FMT.format(v) : String(v));
// de texto a valor (cifras con punto de miles y coma decimal)
const aValor = (clave, s) => { const t = String(s).trim(); if (DINERO.has(clave) || /^[\d.\s]+(,\d+)?$/.test(t)) { const n = Number(t.replace(/\s|€/g, "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : t; } return t; };

export function FichaRequisitos({ concursoId, docs, ficha, onError, onNota, concurso }) {
  const [editando, setEditando] = useState(null); // { clave, texto }
  const [elegidas, setElegidas] = useState(null);  // tablas marcadas para añadir
  const [manual, setManual] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const props = propuestasDe(docs);
  const datos = ficha?.datos || {};
  const claves = [...new Set([...Object.keys(props), ...Object.keys(datos)])];
  const revisados = claves.filter(k => datos[k]).length;

  async function decidir(clave, estado, valor) {
    const p = props[clave]?.[0];
    try {
      await fijarDato(concursoId, clave, estado ? { valor, estado, propuesto: p?.valor ?? null, pagina: p?.pagina ?? null, frase: p?.frase ?? null, doc: p?.doc ?? null, nombre: p?.nombre || clave } : null);
      if (estado && estado !== "descartado") { const c = alConcurso(clave, valor); if (Object.keys(c).length) await cambiarConcurso(concursoId, c); }
    } catch (e) { onError(e.message || String(e)); }
  }

  // ── servicios ──
  const servicios = Object.entries(ficha?.servicios || {}).map(([id, s]) => ({ id, ...s })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre));
  const yaEn = new Set(servicios.map(s => s.id));
  const contexto = contextoDelConcurso(ficha, concurso);
  const periodo = revisarPeriodo(servicios, contexto);
  async function corregirPeriodo() {
    try {
      for (const s of servicios.filter(x => periodo.ids.includes(x.id))) {
        const { id, ...resto } = s;
        await fijarServicio(concursoId, id, { ...resto, cantidadPresupuesto: s.cantidadAnual, periodoMeses: periodo.meses, cantidadAnual: Math.round(s.cantidadAnual * periodo.factor * 1000) / 1000 });
      }
      onNota("Cantidades pasadas al año.");
    } catch (e) { onError(e.message || String(e)); }
  }
  const propuestas = propuestasDeServicios(docs, contexto)
    .map(t => ({ ...t, lineas: t.lineas.filter(l => !yaEn.has(l.id)) })).filter(t => t.lineas.length);
  const marcadas = elegidas ?? new Set(propuestas.filter(t => t.usar).map(t => t.clave));
  // equipos y precios del pliego (de todos los documentos subidos)
  const equipos = (docs || []).flatMap(d => (d.lectura?.equipos || []).map(e => ({ ...e, docNombre: d.nombre })));
  const precios = (docs || []).flatMap(d => preciosDelPliego(d.lectura?.tablas || []));
  async function anadirMarcadas() {
    let orden = servicios.length;
    try {
      for (const t of propuestas.filter(x => marcadas.has(x.clave))) {
        for (const l of t.lineas) await fijarServicio(concursoId, l.id, servicioParaGuardar(l, { equipos, precios, orden: orden++ }));
      }
      setElegidas(null); onNota("Servicios añadidos a la ficha. Revísalos y corrige lo que haga falta.");
    } catch (e) { onError(e.message || String(e)); }
  }
  const cambiarServicio = ({ id, ...s }, campo, valor) => fijarServicio(concursoId, id, { ...s, [campo]: valor }).catch(e => onError(e.message));

  const tarjeta = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14 };
  const titulo = t => <div style={{ fontSize: 14, fontWeight: 650, color: C.text, margin: "22px 0 10px" }}>{t}</div>;
  const btn = { padding: "4px 9px", height: 28 };

  return (
    <div>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.55, maxWidth: 760 }}>
        Lo que vale del pliego. Operanzia propone cada dato con su página; tú lo <b style={{ color: C.text }}>confirmas</b>, lo <b style={{ color: C.text }}>corriges</b> o lo <b style={{ color: C.text }}>descartas</b>. Solo lo revisado pasa a Planning, Cálculo y Resumen.
        <span style={{ marginLeft: 8, color: revisados === claves.length && claves.length ? C.green : C.amber, fontWeight: 600 }}>{revisados} de {claves.length} datos revisados</span>
      </div>
      {(() => {
        const p = pendientes(docs, ficha);
        if (!p.total) return null;
        return (
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <button className="op-btn op-primario" disabled={confirmando} onClick={async () => { setConfirmando(true); try { const n = await confirmarLoLeido(concursoId, docs, ficha); onNota(`Confirmado lo leído (${n}). Revisa lo que tenga aviso naranja: dos documentos no dicen lo mismo.`); } catch (e) { onError(e.message || String(e)); } setConfirmando(false); }}>
              <Check size={14} /> Confirmar todo lo leído ({p.total})
            </button>
            <span style={{ fontSize: 12, color: C.dim }}>Confirma de una vez los datos, los criterios y el estudio de costes que ha leído; luego puedes corregir lo que quieras.</span>
          </div>
        );
      })()}

      {GRUPOS.concat([["Otros", claves.filter(k => !GRUPOS.some(([, ks]) => ks.includes(k)))]]).map(([grupo, ks]) => {
        const lista = ks.filter(k => claves.includes(k));
        if (!lista.length) return null;
        return (
          <div key={grupo}>
            {titulo(grupo)}
            <div style={{ ...tarjeta, overflow: "hidden" }}>
              {lista.map((k, i) => {
                const ps = props[k] || [], p = ps[0], d = datos[k];
                const distintos = [...new Set(ps.map(x => JSON.stringify(x.valor)))].length > 1;
                const valor = d ? d.valor : p?.valor;
                return (
                  <div key={k} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 14px", borderTop: i ? `1px solid ${C.border}` : "none", flexWrap: "wrap", opacity: d?.estado === "descartado" ? 0.5 : 1 }}>
                    <div style={{ width: 190, fontSize: 12.5, color: C.muted }}>{p?.nombre || d?.nombre || k}</div>
                    <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                      {editando?.clave === k ? (
                        <input className="op-input" autoFocus value={editando.texto} onChange={e => setEditando({ clave: k, texto: e.target.value })}
                          onKeyDown={e => { if (e.key === "Enter") { decidir(k, "corregido", aValor(k, editando.texto)); setEditando(null); } if (e.key === "Escape") setEditando(null); }} />
                      ) : (
                        <div style={{ fontSize: 13.5, color: C.text, fontWeight: 550, textDecoration: d?.estado === "descartado" ? "line-through" : "none" }}>{txt(k, valor)}</div>
                      )}
                      <div style={{ fontSize: 11.5, color: C.dim, marginTop: 2 }} title={p?.frase || ""}>
                        {d?.doc === "plataforma" ? <span style={{ color: C.green }}>dato oficial de la Plataforma de Contratación</span> : d?.estado === "corregido" ? `Corregido (el pliego decía ${txt(k, d.propuesto)})` : p ? `pág. ${p.pagina} · ${p.docNombre}` : "añadido a mano"}
                        {d && d.estado === "confirmado" && p && JSON.stringify(p.valor) !== JSON.stringify(d.valor) && (
                          <span style={{ color: C.amber, marginLeft: 6 }}><TriangleAlert size={11} style={{ verticalAlign: "-1px" }} /> la lectura nueva dice {txt(k, p.valor)} <button className="op-btn op-fantasma" style={{ height: 22, fontSize: 11.5, padding: "0 6px" }} onClick={() => decidir(k, "confirmado", p.valor)}>Usar</button></span>
                        )}
                        {distintos && <span style={{ color: C.amber, marginLeft: 6 }}><TriangleAlert size={11} style={{ verticalAlign: "-1px" }} /> otro documento dice {ps.slice(1).map(x => `${txt(k, x.valor)} (pág. ${x.pagina})`).join(", ")}</span>}
                      </div>
                    </div>
                    {editando?.clave === k ? (
                      <>
                        <button className="op-btn op-primario" style={btn} onClick={() => { decidir(k, "corregido", aValor(k, editando.texto)); setEditando(null); }}>Guardar</button>
                        <button className="op-btn op-fantasma" style={btn} onClick={() => setEditando(null)}>Cancelar</button>
                      </>
                    ) : d ? (
                      <>
                        <span className="op-pastilla" style={{ background: d.estado === "descartado" ? "rgba(139,149,165,0.15)" : "rgba(63,207,142,0.12)", color: d.estado === "descartado" ? C.muted : C.green }}>{d.estado === "confirmado" ? "Confirmado" : d.estado === "corregido" ? "Corregido" : "Descartado"}</span>
                        <button className="op-btn op-fantasma" style={btn} title="Volver a revisar" onClick={() => decidir(k, null)}>Deshacer</button>
                      </>
                    ) : (
                      <>
                        <button className="op-btn" style={{ ...btn, color: C.green }} title="El dato es correcto" onClick={() => decidir(k, "confirmado", p.valor)}><Check size={14} /> Correcto</button>
                        <button className="op-btn" style={btn} title="Corregir el valor" onClick={() => setEditando({ clave: k, texto: typeof p?.valor === "number" ? FMT.format(p.valor) : String(p?.valor ?? "") })}><Pencil size={13} /> Corregir</button>
                        <button className="op-btn op-fantasma" style={btn} title="No vale (no se usa)" onClick={() => decidir(k, "descartado", p?.valor ?? null)}><X size={14} /></button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <EstudioFicha concursoId={concursoId} docs={docs} ficha={ficha} onError={onError} titulo={titulo} tarjeta={tarjeta} />

      <CriteriosFicha concursoId={concursoId} docs={docs} ficha={ficha} onError={onError} />

      {/* ── Servicios y cantidades al año ── */}
      {titulo(`Servicios y cantidades al año (${servicios.length})`)}
      {periodo && (
        <div style={{ ...tarjeta, padding: "10px 14px", marginBottom: 10, borderColor: "rgba(242,109,109,0.45)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <TriangleAlert size={16} color={C.red} />
          <div style={{ flex: "1 1 320px", fontSize: 13, color: C.text }}><b>Estas cantidades no son de un año.</b> {periodo.motivo}.</div>
          <button className="op-btn op-primario" style={btn} onClick={corregirPeriodo}>Pasar al año (× {FMT.format(Math.round(periodo.factor * 100) / 100)})</button>
        </div>
      )}
      <div style={{ ...tarjeta, overflow: "auto" }}>
        {!servicios.length ? <div style={{ padding: 16, fontSize: 13, color: C.muted }}>Aún no hay servicios en la ficha. Añádelos desde las tablas del pliego (abajo) o a mano.</div> : (
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead><tr>{["Servicio", "Fracción", "Ubicación", "Al año", "Precio ud.", "Vehículo (pliego)", "Personas", "De dónde sale", ""].map(h => <th key={h} style={{ textAlign: ["Al año", "Precio ud.", "Personas"].includes(h) ? "right" : "left", padding: "8px 10px", fontSize: 11, color: C.dim, fontWeight: 600, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>
              {servicios.map(s => (
                <tr key={s.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  {[["nombre", 170], ["fraccion", 100], ["ubicacion", 230]].map(([campo, w]) => (
                    <td key={campo} style={{ padding: "4px 6px" }}><input className="op-input" defaultValue={s[campo] || ""} title={s[campo] || ""} onBlur={e => e.target.value !== (s[campo] || "") && cambiarServicio(s, campo, e.target.value || null)} style={{ width: w, height: 30 }} /></td>
                  ))}
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>
                    <input className="op-input" defaultValue={FMT.format(s.cantidadAnual || 0)} onBlur={e => { const n = aValor("x", e.target.value); if (typeof n === "number" && n !== s.cantidadAnual) cambiarServicio(s, "cantidadAnual", n); }} style={{ width: 90, height: 30, textAlign: "right" }} />
                    {s.cuenta && <div style={{ fontSize: 10.5, color: s.cuadra === false ? C.red : C.green, marginTop: 2, whiteSpace: "nowrap" }} title="Comprobación con las unidades y la frecuencia del pliego">{s.cuadra === false ? "✗" : "✓"} {s.cuenta}</div>}
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}><input className="op-input" defaultValue={s.precioUnitario != null ? FMT.format(s.precioUnitario) : ""} placeholder="—" title={s.precioPagina ? `Precio del pliego (pág. ${s.precioPagina})` : "Sin precio en el pliego"} onBlur={e => { const n = e.target.value.trim() === "" ? null : aValor("x", e.target.value); if (n !== s.precioUnitario && (n === null || typeof n === "number")) cambiarServicio(s, "precioUnitario", n); }} style={{ width: 80, height: 30, textAlign: "right" }} /></td>
                  <td style={{ padding: "4px 6px" }}><input className="op-input" defaultValue={s.vehiculo || ""} placeholder="el pliego no lo dice" title={s.equipoPagina ? `Lo exige el pliego (pág. ${s.equipoPagina})` : ""} onBlur={e => e.target.value !== (s.vehiculo || "") && cambiarServicio(s, "vehiculo", e.target.value || null)} style={{ width: 210, height: 30 }} /></td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}><input className="op-input" type="number" min={0} defaultValue={s.personas ?? ""} placeholder="—" onBlur={e => { const n = e.target.value === "" ? null : Number(e.target.value); if (n !== s.personas) cambiarServicio(s, "personas", n); }} style={{ width: 60, height: 30, textAlign: "right" }} /></td>
                  <td style={{ padding: "4px 10px", fontSize: 11.5, color: C.dim, whiteSpace: "nowrap" }}>{s.pagina ? `pág. ${s.pagina}` : "a mano"}{s.temporada ? ` · ${s.temporada}` : ""}</td>
                  <td style={{ padding: "4px 8px" }}><button className="op-btn op-fantasma op-icono" title="Quitar" onClick={() => fijarServicio(concursoId, s.id, null).catch(e => onError(e.message))}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ padding: "8px 12px", borderTop: `1px solid ${C.border}` }}>
          {manual ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {[["nombre", "Servicio (p. ej. Lavado interior)", 200], ["fraccion", "Fracción", 130], ["ubicacion", "Ubicación", 120], ["cantidadAnual", "Al año", 90]].map(([k, ph, w]) => (
                <input key={k} className="op-input" placeholder={ph} value={manual[k]} onChange={e => setManual(m => ({ ...m, [k]: e.target.value }))} style={{ width: w, height: 30 }} />
              ))}
              <button className="op-btn op-primario" style={btn} disabled={!manual.nombre.trim() || !(aValor("x", manual.cantidadAnual) > 0)}
                onClick={() => { fijarServicio(concursoId, `m${Date.now().toString(36)}`, { nombre: manual.nombre.trim(), fraccion: manual.fraccion || null, ubicacion: manual.ubicacion || null, cantidadAnual: aValor("x", manual.cantidadAnual), orden: servicios.length }).catch(e => onError(e.message)); setManual(null); }}>Añadir</button>
              <button className="op-btn op-fantasma" style={btn} onClick={() => setManual(null)}>Cancelar</button>
            </div>
          ) : <button className="op-btn op-fantasma" style={btn} onClick={() => setManual({ nombre: "", fraccion: "", ubicacion: "", cantidadAnual: "" })}><Plus size={14} /> Añadir servicio a mano</button>}
        </div>
      </div>

      {equipos.length > 0 && <>
        {titulo("Equipos que exige el pliego")}
        <div style={{ ...tarjeta, overflow: "hidden" }}>
          {equipos.map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 14px", borderTop: i ? `1px solid ${C.border}` : "none", flexWrap: "wrap" }} title={e.frase}>
              <Truck size={16} color={C.blue} />
              <div style={{ flex: "1 1 240px", fontSize: 13, color: C.text }}>{e.apartado || "Servicio"}</div>
              <div style={{ flex: "1 1 240px", fontSize: 13, color: C.text, fontWeight: 600 }}>{e.vehiculo || "—"}{e.personas ? ` + ${e.quien || `${e.personas} personas`}` : ""}</div>
              <div style={{ fontSize: 11.5, color: C.dim }}>pág. {e.pagina} · {e.docNombre}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: C.dim, marginTop: 6 }}>Cada servicio de la ficha lleva el equipo de su apartado; Planificación cuenta un vehículo de cada tipo y las personas de cada equipo. Lo que el pliego no fija (p. ej. el mantenimiento) lo eliges tú.</div>
      </>}

      {propuestas.length > 0 && <>
        {titulo("Propuestas de las tablas del pliego")}
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 10 }}>Marca las tablas que son cantidades al año y añádelas. Las que repiten un servicio o no son anuales vienen sin marcar: decide tú.</div>
        <div style={{ display: "grid", gap: 8 }}>
          {propuestas.map(t => (
            <label key={t.clave} style={{ ...tarjeta, padding: "10px 14px", display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", borderColor: marcadas.has(t.clave) ? C.blue : C.border }}>
              <input type="checkbox" checked={marcadas.has(t.clave)} onChange={e => { const n = new Set(marcadas); if (e.target.checked) n.add(t.clave); else n.delete(t.clave); setElegidas(n); }} style={{ marginTop: 3, accentColor: C.blue }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{t.servicio || t.lineas[0].nombre} <span style={{ color: C.dim, fontWeight: 400, fontSize: 11.5 }}>· {t.titulo} · pág. {t.pagina} · {t.docNombre}</span></div>
                {t.motivo && <div style={{ fontSize: 12, color: C.amber, marginTop: 2 }}><TriangleAlert size={12} style={{ verticalAlign: "-2px" }} /> {t.motivo}</div>}
                <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.6 }}>
                  {t.lineas.map((l, i) => <span key={i}>{i ? " · " : ""}{[t.indice === "frecuencias" || t.indice === "mediciones" ? l.nombre : null, l.temporada || l.fraccion, l.ubicacion].filter(Boolean).join(" ")}: <b style={{ color: C.text }}>{FMT.format(l.cantidadAnual)}{l.unidad ? ` ${l.unidad}` : ""}</b>{l.cuenta ? <span style={{ color: l.cuadra === false ? C.red : C.green }}> ({l.cuenta} {l.cuadra === false ? "✗" : "✓"})</span> : null}</span>)}
                </div>
                {(() => { const e = equipoDe(t.lineas[0], equipos); return e ? <div style={{ fontSize: 12, color: C.text, marginTop: 4 }}><Truck size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />El pliego exige: {e.vehiculo}{e.personas ? ` + ${e.personas} persona${e.personas > 1 ? "s" : ""}` : ""} <span style={{ color: C.dim }}>(pág. {e.pagina})</span></div> : null; })()}
              </div>
            </label>
          ))}
        </div>
        <button className="op-btn op-primario" style={{ marginTop: 10 }} disabled={!marcadas.size} onClick={anadirMarcadas}><Plus size={14} /> Añadir a la ficha las marcadas ({propuestas.filter(t => marcadas.has(t.clave)).reduce((a, t) => a + t.lineas.length, 0)} servicios)</button>
      </>}
    </div>
  );
}

const EUR = n => (n == null ? "—" : `${FMT.format(Math.round(n))} €`);

/** El estudio de costes del Ayuntamiento (si algún pliego lo trae) y los medios mínimos */
function EstudioFicha({ concursoId, docs, ficha, onError, titulo, tarjeta }) {
  const conEstudio = (docs || []).find(d => d.lectura?.estudio);
  const enUso = ficha?.estudio || null;
  const e = enUso || conEstudio?.lectura?.estudio || null;
  const medios = (docs || []).flatMap(d => (d.lectura?.mediosMinimos || []).map(m => ({ ...m, docNombre: d.nombre })));
  if (!e && !medios.length) return null;
  const th = { textAlign: "right", padding: "6px 10px", fontSize: 11, color: C.dim, fontWeight: 600, borderBottom: `1px solid ${C.border}` };
  const td = { padding: "5px 10px", fontSize: 13, color: C.text, textAlign: "right" };
  return (
    <div>
      {e && <>
        {titulo("Estudio de costes del Ayuntamiento")}
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
          Cómo ha calculado el Ayuntamiento el presupuesto (pág. {e.pagina}{conEstudio ? ` · ${conEstudio.nombre}` : ""}). Es la mejor referencia del coste: Cálculo parte de aquí y tú ajustas.
          {" "}{e.cuadra ? <span style={{ color: C.green }}>✓ las partidas cuadran con el total</span> : <span style={{ color: C.amber }}><TriangleAlert size={12} style={{ verticalAlign: "-2px" }} /> las partidas no cuadran con el total: revísalo</span>}
        </div>
        <div style={{ ...tarjeta, overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr><th style={{ ...th, textAlign: "left" }}>Partida</th><th style={th}>Al año (año 1)</th><th style={th}>Líneas</th></tr></thead>
            <tbody>
              {e.partidas.map(p => <tr key={p.id} style={{ borderTop: `1px solid ${C.border}` }}><td style={{ ...td, textAlign: "left" }}>{p.nombre}</td><td style={td}>{EUR(p.total)}</td><td style={{ ...td, color: C.dim }}>{p.lineas?.length || 0}</td></tr>)}
              <tr style={{ borderTop: `1px solid ${C.border}` }}><td style={{ ...td, textAlign: "left", fontWeight: 600 }}>Coste del servicio</td><td style={{ ...td, fontWeight: 600 }}>{EUR(e.costeEjecucion)}</td><td /></tr>
              {e.ggbi != null && <tr><td style={{ ...td, textAlign: "left", color: C.muted }}>Gastos generales y beneficio ({FMT.format(e.ggbiPct)} %)</td><td style={td}>{EUR(e.ggbi)}</td><td /></tr>}
              <tr><td style={{ ...td, textAlign: "left", fontWeight: 650 }}>Presupuesto del primer año, sin IVA</td><td style={{ ...td, fontWeight: 650 }}>{EUR(e.baseImponible)}</td><td /></tr>
              {e.ivaPct != null && <tr><td style={{ ...td, textAlign: "left", color: C.muted }}>Con IVA ({FMT.format(e.ivaPct)} %)</td><td style={td}>{EUR(e.totalConIva)}</td><td /></tr>}
              {e.anios?.base?.length > 1 && <tr><td style={{ ...td, textAlign: "left", color: C.muted }}>{e.anios.base.length} años, sin IVA (sube cada año{e.incrementos?.manoObra?.length ? `: mano de obra ${e.incrementos.manoObra[0]} %…, resto ${e.incrementos.resto[0]} %…` : ""})</td><td style={td}>{EUR(e.anios.base.reduce((a, b) => a + b, 0))}</td><td /></tr>}
              {e.valorEstimado != null && <tr><td style={{ ...td, textAlign: "left", color: C.muted }}>Valor estimado</td><td style={td}>{EUR(e.valorEstimado)}</td><td /></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          {enUso ? <>
            <span className="op-pastilla" style={{ background: "rgba(63,207,142,0.12)", color: C.green }}>En uso en Cálculo</span>
            <button className="op-btn op-fantasma" style={{ height: 28 }} onClick={() => fijarEstudio(concursoId, null).catch(err => onError(err.message))}>No usarlo</button>
          </> : <button className="op-btn op-primario" onClick={() => fijarEstudio(concursoId, conEstudio.lectura.estudio, conEstudio.nombre).catch(err => onError(err.message))}>Usar en Cálculo</button>}
        </div>
      </>}
      {medios.length > 0 && <>
        {titulo(`Medios mínimos que exige el pliego (${medios.length})`)}
        <div style={{ ...tarjeta, padding: "10px 14px", columns: "2 300px", fontSize: 12.5, color: C.muted, lineHeight: 1.7 }}>
          {medios.map((m, i) => <div key={i} style={{ breakInside: "avoid" }}><b style={{ color: C.text }}>{m.uds ?? "·"}</b> {m.concepto}</div>)}
        </div>
        <div style={{ fontSize: 11.5, color: C.dim, marginTop: 6 }}>pág. {medios[0].pagina} · {medios[0].docNombre}. Lo que se oferte no puede quedarse por debajo.</div>
      </>}
    </div>
  );
}
