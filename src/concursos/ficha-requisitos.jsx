// Concursos → Documentos → Ficha de requisitos: lo que vale del pliego.
// El lector propone (con su página); aquí cada dato se confirma, se corrige o
// se descarta, y los servicios con su cantidad al año se eligen de las tablas
// del pliego (o se añaden a mano). De esta ficha leen los demás módulos.
import { Check, Pencil, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { C } from "../tema.js";
import { serviciosDeDatos, tablasParaServicios } from "./ficha.js";
import { cambiarConcurso, fijarDato, fijarServicio } from "./store.js";

const GRUPOS = [
  ["Contrato", ["expediente", "organismo", "objeto", "procedimiento", "cpv", "lotes", "duracion", "prorroga", "fechaLimite", "presupuesto", "importeSinIva", "importeConIva", "valorEstimado", "importeAnual", "puntosPrecio"]],
  ["Servicio", ["contenedores", "vecesAnio", "operacionesAnio", "jornadasAnio", "dias", "nocturno", "inicio", "habitantes", "lineas", "expediciones", "kmAnuales", "horasAnuales"]],
  ["Medios y personal", ["vehiculos", "antiguedad", "subrogacion", "plantilla", "convenio"]],
];
const FMT = (() => { try { return new Intl.NumberFormat("es-ES", { useGrouping: "always", maximumFractionDigits: 2 }); } catch { return new Intl.NumberFormat("es-ES"); } })();
const DINERO = new Set(["presupuesto", "valorEstimado", "importeAnual", "importeSinIva", "importeConIva"]);
const txt = (clave, v) => (v == null ? "—" : DINERO.has(clave) ? `${FMT.format(v)} €` : clave === "fechaLimite" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`).toLocaleDateString("es-ES") : typeof v === "number" ? FMT.format(v) : String(v));
// de texto a valor (cifras con punto de miles y coma decimal)
const aValor = (clave, s) => { const t = String(s).trim(); if (DINERO.has(clave) || /^[\d.\s]+(,\d+)?$/.test(t)) { const n = Number(t.replace(/\s|€/g, "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : t; } return t; };

// La ficha del concurso (organismo, plazos, presupuesto) se rellena sola con lo confirmado
function alConcurso(clave, valor) {
  if (clave === "organismo") return { organismo: valor };
  if (clave === "fechaLimite" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return { fechaLimite: valor };
  if (clave === "expediente") return { expediente: valor };
  if (clave === "duracion") { const n = parseInt(valor, 10); return /mes/.test(valor) ? { duracionMeses: n, duracionAnios: Math.round((n / 12) * 10) / 10 } : n ? { duracionAnios: n, duracionMeses: n * 12 } : {}; }
  if ((clave === "presupuesto" || clave === "importeSinIva") && typeof valor === "number") return { presupuestoSinIva: valor };
  if (clave === "valorEstimado" && typeof valor === "number") return { valorEstimado: valor };
  return {};
}

/** Lo propuesto por los pliegos subidos, juntos: { [clave]: [{ valor, pagina, frase, doc, docNombre, nombre }] } */
function propuestasDe(docs) {
  const out = {};
  for (const d of docs || []) {
    for (const x of d.lectura?.datos || []) {
      if (x.id.startsWith("horario") || x.id.startsWith("lote") || x.id.startsWith("frecuencia")) continue;
      (out[x.id] ||= []).push({ valor: x.valor, pagina: x.pagina, frase: x.frase, doc: d._id, docNombre: d.nombre, nombre: x.nombre });
    }
  }
  return out;
}

export function FichaRequisitos({ concursoId, docs, ficha, onError, onNota }) {
  const [editando, setEditando] = useState(null); // { clave, texto }
  const [elegidas, setElegidas] = useState(null);  // tablas marcadas para añadir
  const [manual, setManual] = useState(null);
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
  const propuestas = (docs || []).flatMap(d => [...serviciosDeDatos(d.lectura?.datos || [], d._id), ...tablasParaServicios(d.lectura?.tablas || [], d._id)].map(t => ({ ...t, clave: `${d._id}|${t.indice}`, docNombre: d.nombre })))
    .map(t => ({ ...t, lineas: t.lineas.filter(l => !yaEn.has(l.id)) })).filter(t => t.lineas.length);
  const marcadas = elegidas ?? new Set(propuestas.filter(t => t.usar).map(t => t.clave));
  async function anadirMarcadas() {
    let orden = servicios.length;
    try {
      for (const t of propuestas.filter(x => marcadas.has(x.clave))) {
        for (const l of t.lineas) await fijarServicio(concursoId, l.id, { nombre: l.nombre, fraccion: l.fraccion, ubicacion: l.ubicacion || null, cantidadAnual: l.cantidadAnual, unidades: l.unidades ?? null, concepto: l.concepto, pagina: l.pagina, doc: l.doc, orden: orden++ });
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
                        {d?.estado === "corregido" ? `Corregido (el pliego decía ${txt(k, d.propuesto)})` : p ? `pág. ${p.pagina} · ${p.docNombre}` : "añadido a mano"}
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

      {/* ── Servicios y cantidades al año ── */}
      {titulo(`Servicios y cantidades al año (${servicios.length})`)}
      <div style={{ ...tarjeta, overflow: "auto" }}>
        {!servicios.length ? <div style={{ padding: 16, fontSize: 13, color: C.muted }}>Aún no hay servicios en la ficha. Añádelos desde las tablas del pliego (abajo) o a mano.</div> : (
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead><tr>{["Servicio", "Fracción", "Ubicación", "Al año", "De dónde sale", ""].map(h => <th key={h} style={{ textAlign: h === "Al año" ? "right" : "left", padding: "8px 12px", fontSize: 11, color: C.dim, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>{h}</th>)}</tr></thead>
            <tbody>
              {servicios.map(s => (
                <tr key={s.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  {[["nombre", 180], ["fraccion", 140], ["ubicacion", 120]].map(([campo, w]) => (
                    <td key={campo} style={{ padding: "4px 8px" }}><input className="op-input" defaultValue={s[campo] || ""} onBlur={e => e.target.value !== (s[campo] || "") && cambiarServicio(s, campo, e.target.value || null)} style={{ width: w, height: 30 }} /></td>
                  ))}
                  <td style={{ padding: "4px 8px", textAlign: "right" }}><input className="op-input" defaultValue={FMT.format(s.cantidadAnual || 0)} onBlur={e => { const n = aValor("x", e.target.value); if (typeof n === "number" && n !== s.cantidadAnual) cambiarServicio(s, "cantidadAnual", n); }} style={{ width: 100, height: 30, textAlign: "right" }} /></td>
                  <td style={{ padding: "4px 12px", fontSize: 11.5, color: C.dim }}>{s.pagina ? `pág. ${s.pagina}` : "a mano"}{s.concepto ? ` · ${s.concepto}` : ""}</td>
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
                <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.6 }}>{t.lineas.map(l => `${[l.fraccion, l.ubicacion].filter(Boolean).join(" ")}: ${FMT.format(l.cantidadAnual)}`).join(" · ")}</div>
              </div>
            </label>
          ))}
        </div>
        <button className="op-btn op-primario" style={{ marginTop: 10 }} disabled={!marcadas.size} onClick={anadirMarcadas}><Plus size={14} /> Añadir a la ficha las marcadas ({propuestas.filter(t => marcadas.has(t.clave)).reduce((a, t) => a + t.lineas.length, 0)} servicios)</button>
      </>}
    </div>
  );
}
