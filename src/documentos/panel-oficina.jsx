// Cuadrante → Documentos: subir ITs, DPTs y otros documentos para los
// trabajadores, ver quién los ha leído y subir versiones nuevas.
import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ChevronDown, ChevronRight, Eye, FileText, Image as IconoImagen, Loader2, RotateCcw, Trash2, Upload } from "lucide-react";
import { C, font } from "../tema.js";
import { ACEPTA, CATEGORIAS, MAX_BYTES, estadoLectura, nombreCategoria, problemaDocumento, tipoArchivo } from "./datos.js";
import { abrirArchivo, archivarDocumento, descargar, eliminarDocumento, escucharDocumentosOrg, escucharLecturasOrg, esWord, nuevaVersion, subirDocumento } from "./store.js";

const fecha = ms => (ms ? new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "—");
const nombreDe = u => [u.nombre, u.apellidos].filter(Boolean).join(" ") || u.email || "Sin nombre";
const VACIO = { titulo: "", categoria: "IT", descripcion: "", paraTodos: true, paraUids: [], archivo: null };

function FormularioDocumento({ usuarios, onSubir, onCancelar }) {
  const [f, setF] = useState(VACIO);
  const [error, setError] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const app = usuarios.filter(u => u.rol === "conductor" || u.rol === "intermedio");
  async function subir() {
    const p = problemaDocumento(f);
    if (p) { setError(p); return; }
    setSubiendo(true); setError(null);
    try { await onSubir(f); } catch (e) { setError(e.message || String(e)); setSubiendo(false); }
  }
  return (
    <div className="op-tarjeta" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: C.muted }}>Título
          <input className="op-input" value={f.titulo} onChange={e => setF({ ...f, titulo: e.target.value })} placeholder="p. ej. IT-04 Vaciado de contenedores soterrados" aria-label="Título del documento" style={{ height: 32 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: C.muted }}>Tipo
          <select className="op-input" value={f.categoria} onChange={e => setF({ ...f, categoria: e.target.value })} aria-label="Tipo de documento" style={{ height: 32 }}>
            {CATEGORIAS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: C.muted }}>Descripción (opcional)
        <input className="op-input" value={f.descripcion} onChange={e => setF({ ...f, descripcion: e.target.value })} aria-label="Descripción" style={{ height: 32 }} />
      </label>
      <div style={{ display: "flex", gap: 16, fontSize: 13, color: C.text }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}><input type="radio" checked={f.paraTodos} onChange={() => setF({ ...f, paraTodos: true })} style={{ accentColor: C.blue }} />Para todos los trabajadores</label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}><input type="radio" checked={!f.paraTodos} onChange={() => setF({ ...f, paraTodos: false })} style={{ accentColor: C.blue }} />Solo para algunos</label>
      </div>
      {!f.paraTodos && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", maxHeight: 150, overflowY: "auto", padding: "6px 2px" }}>
          {app.length ? app.map(u => (
            <label key={u._id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: C.text, cursor: "pointer" }}>
              <input type="checkbox" checked={f.paraUids.includes(u._id)} style={{ accentColor: C.blue }}
                onChange={e => setF({ ...f, paraUids: e.target.checked ? [...f.paraUids, u._id] : f.paraUids.filter(x => x !== u._id) })} />{nombreDe(u)}
            </label>
          )) : <span style={{ fontSize: 12, color: C.dim }}>Todavía no hay trabajadores con acceso a la app.</span>}
        </div>
      )}
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: C.muted }}>Archivo (PDF, foto o Word, hasta 10 MB)
        <input type="file" accept={ACEPTA} onChange={e => setF({ ...f, archivo: e.target.files?.[0] || null })} aria-label="Archivo" style={{ fontSize: 12, color: C.text }} />
      </label>
      {error && <div style={{ fontSize: 12, color: C.red }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="op-btn" onClick={onCancelar}>Cancelar</button>
        <button className="op-btn op-primario" onClick={subir} disabled={subiendo}>{subiendo ? <Loader2 size={14} className="op-girando" /> : <Upload size={14} />}Subir y avisar</button>
      </div>
    </div>
  );
}

export function PanelDocumentos({ orgId, sesion, usuarios = [] }) {
  const [docs, setDocs] = useState(null);
  const [lecturas, setLecturas] = useState([]);
  const [nuevo, setNuevo] = useState(false);
  const [abierto, setAbierto] = useState(null);
  const [verArchivados, setVerArchivados] = useState(false);
  const [ocupado, setOcupado] = useState(null);
  const [error, setError] = useState(null);
  const versionRef = useRef(null);
  const [paraVersion, setParaVersion] = useState(null);

  useEffect(() => { if (!orgId) return; return escucharDocumentosOrg(orgId, setDocs); }, [orgId]);
  useEffect(() => { if (!orgId) return; return escucharLecturasOrg(orgId, setLecturas); }, [orgId]);

  const visibles = useMemo(() => (docs || []).filter(d => (verArchivados ? !d.activo : d.activo)).sort((a, b) => (b.subidoAt || 0) - (a.subidoAt || 0)), [docs, verArchivados]);
  async function hacer(id, fn) { setOcupado(id); setError(null); try { await fn(); } catch (e) { setError(e.message || String(e)); } finally { setOcupado(null); } }
  async function ver(d) { await hacer(d.id, async () => { const url = await abrirArchivo(d); if (esWord(d)) descargar(url, d.archivo?.nombre); else window.open(url, "_blank", "noopener"); }); }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", fontFamily: font, background: C.bg }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 650, color: C.text }}>Documentos</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>Instrucciones técnicas, fichas de puesto y riesgos y otros documentos. Cada trabajador los lee en la app y confirma que los ha leído.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={`op-btn${verArchivados ? " op-activo" : ""}`} onClick={() => setVerArchivados(v => !v)}><Archive size={14} />{verArchivados ? "Ver activos" : "Archivados"}</button>
          {!nuevo && <button className="op-btn op-primario" onClick={() => setNuevo(true)}><Upload size={14} />Subir documento</button>}
        </div>
      </div>
      <input ref={versionRef} type="file" accept={ACEPTA} style={{ display: "none" }}
        onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (!file || !paraVersion) return; if (!tipoArchivo(file)) { setError("Tiene que ser un PDF, una foto o un Word"); return; } if (file.size > MAX_BYTES) { setError("El archivo pasa de 10 MB"); return; } hacer(paraVersion.id, () => nuevaVersion(paraVersion, file, sesion)); }} />

      {nuevo && <div style={{ marginBottom: 14 }}><FormularioDocumento usuarios={usuarios} onCancelar={() => setNuevo(false)}
        onSubir={async f => { await subirDocumento({ orgId, sesion, ...f }); setNuevo(false); }} /></div>}
      {error && <div style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{error}</div>}

      {docs === null ? <div style={{ color: C.dim, fontSize: 13 }}>Cargando…</div>
        : !visibles.length ? <div style={{ color: C.dim, fontSize: 13, padding: "30px 0", textAlign: "center" }}>{verArchivados ? "No hay documentos archivados." : "Todavía no hay documentos. Sube el primero con «Subir documento»."}</div>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visibles.map(d => {
              const est = estadoLectura(d, usuarios, lecturas);
              const pct = est.total ? Math.round((est.leidos.length / est.total) * 100) : 0;
              const ab = abierto === d.id;
              return (
                <div key={d.id} className="op-tarjeta" style={{ padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <button onClick={() => setAbierto(ab ? null : d.id)} aria-label={`Ver quién ha leído ${d.titulo}`} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", display: "inline-flex", padding: 0 }}>{ab ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
                    {tipoArchivo(d.archivo) === "imagen" ? <IconoImagen size={18} color={d.categoria === "DPT" ? C.amber : d.categoria === "IT" ? C.blue : C.muted} /> : <FileText size={18} color={d.categoria === "DPT" ? C.amber : d.categoria === "IT" ? C.blue : C.muted} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 650, color: C.text }}>{d.titulo} <span style={{ fontWeight: 400, color: C.dim }}>· v{d.version || 1}</span></div>
                      <div style={{ fontSize: 12, color: C.muted }}>{nombreCategoria(d.categoria)} · {({ pdf: "PDF", imagen: "Foto", word: "Word" })[tipoArchivo(d.archivo)] || "Archivo"} · {d.paraTodos ? "para todos" : `para ${d.paraUids.length} ${d.paraUids.length === 1 ? "trabajador" : "trabajadores"}`} · {fecha(d.subidoAt)}{d.descripcion ? ` · ${d.descripcion}` : ""}</div>
                    </div>
                    <div style={{ width: 170, flexShrink: 0 }}>
                      <div style={{ fontSize: 12, color: est.total && est.leidos.length === est.total ? C.green : C.text, marginBottom: 4 }}>Leído por {est.leidos.length} de {est.total}</div>
                      <div style={{ height: 6, borderRadius: 4, background: C.surface2, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? C.green : C.blue }} /></div>
                    </div>
                    <button className="op-btn" onClick={() => ver(d)} disabled={ocupado === d.id} title={esWord(d) ? "Descargar el Word" : "Abrir"}>{ocupado === d.id ? <Loader2 size={14} className="op-girando" /> : <Eye size={14} />}Ver</button>
                    {d.activo && <button className="op-btn" onClick={() => { setParaVersion(d); versionRef.current?.click(); }} disabled={!!ocupado} title="Sustituir el archivo: todos tendrán que volver a confirmar la lectura"><Upload size={14} />Nueva versión</button>}
                    <button className="op-btn" onClick={() => hacer(d.id, () => archivarDocumento(d, !d.activo))} disabled={!!ocupado} title={d.activo ? "Deja de verse en la app" : "Vuelve a verse en la app"}>{d.activo ? <Archive size={14} /> : <RotateCcw size={14} />}{d.activo ? "Archivar" : "Recuperar"}</button>
                    {!d.activo && <button aria-label="Eliminar documento" title="Eliminar del todo" onClick={() => window.confirm(`¿Eliminar «${d.titulo}» del todo? Se perderá también el registro de quién lo leyó.`) && hacer(d.id, () => eliminarDocumento(d))} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", display: "inline-flex", padding: 4 }}><Trash2 size={15} /></button>}
                  </div>
                  {ab && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 650, color: C.red, marginBottom: 6 }}>Sin leer ({est.pendientes.length})</div>
                        {est.pendientes.length ? est.pendientes.map(u => <div key={u._id} style={{ fontSize: 12, color: C.text, padding: "2px 0" }}>{nombreDe(u)}</div>) : <div style={{ fontSize: 12, color: C.dim }}>Nadie</div>}
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 650, color: C.green, marginBottom: 6 }}>Leído ({est.leidos.length})</div>
                        {est.leidos.length ? est.leidos.map(u => <div key={u._id} style={{ fontSize: 12, color: C.text, padding: "2px 0" }}>{nombreDe(u)} <span style={{ color: C.dim }}>· {fecha(u.leidoAt)}</span></div>) : <div style={{ fontSize: 12, color: C.dim }}>Nadie todavía</div>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
