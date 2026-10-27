// Concursos → Documentos (el primer módulo): se sube el pliego (técnico,
// administrativo o el anuncio de la Plataforma de Contratación) y Operanzia lo
// lee en el propio navegador (concursos/pliego.js, sin IA): datos del
// concurso, el servicio, requisitos e índice, cada uno con su página para
// comprobarlo. Lo que interesa se pasa a la ficha del concurso con un clic.
import { Check, ExternalLink, FileText, Loader2, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { C, font } from "../tema.js";
import { VERSION_LECTOR, buscarEnPliego, leerPliego } from "./pliego.js";
import { ACEPTA_PLIEGOS, documentosDeArchivo } from "./documento-texto.js";
import { contextoDelConcurso } from "./ficha.js";
import { prepararDimension, traerLoQueFalta } from "./plataforma.js";
import { PDF_MAX, borrarDocumento, escucharDocumentos, escucharFicha, guardarDocumento, pdfDocumento, releerDocumento, textoDocumento } from "./store.js";
import { FichaRequisitos } from "./ficha-requisitos.jsx";

const CLASE = { tecnico: "Pliego de prescripciones técnicas", administrativo: "Pliego de cláusulas administrativas", anuncio: "Anuncio de licitación", memoria: "Memoria justificativa" };
const TIPO = { residuos: "Residuos", limpieza: "Limpieza viaria", autobuses: "Autobuses" };
// con punto de miles también en las cifras de 4 (en español, el navegador no lo pone: «6037»)
const FMT = (() => { try { return new Intl.NumberFormat("es-ES", { useGrouping: "always", maximumFractionDigits: 2 }); } catch { return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }); } })();
const FMT2 = (() => { try { return new Intl.NumberFormat("es-ES", { useGrouping: "always", minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch { return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } })();
const num = n => FMT.format(n);
const euros = n => `${FMT2.format(n)} €`;
const fechaEs = iso => new Date(`${iso}T12:00:00`).toLocaleDateString("es-ES");
const DINERO = new Set(["presupuesto", "valorEstimado", "importeAnual", "importeSinIva", "importeConIva"]);
const valorTxt = d => (DINERO.has(d.id) ? euros(d.valor) : d.id === "fechaLimite" ? fechaEs(d.valor) : typeof d.valor === "number" ? num(d.valor) : String(d.valor));

export function DocumentosConcurso({ concurso }) {
  const [docs, setDocs] = useState(null);
  const [selId, setSelId] = useState(null);
  const [subiendo, setSubiendo] = useState(null);
  const [error, setError] = useState(null);
  const [nota, setNota] = useState(null);
  const [q, setQ] = useState("");
  const [texto, setTexto] = useState({ id: null, paginas: null });
  const [abierta, setAbierta] = useState(null); // frase desplegada
  const [pestana, setPestana] = useState("ficha"); // «ficha» de requisitos o «pliegos» (lo leído de cada uno)
  const [ficha, setFicha] = useState(null);
  const fileRef = useRef();
  const id = concurso?._id;
  useEffect(() => (id ? escucharDocumentos(id, setDocs) : undefined), [id]);
  useEffect(() => (id ? escucharFicha(id, setFicha) : undefined), [id]);
  useEffect(() => { if (!nota) return; const t = setTimeout(() => setNota(null), 6000); return () => clearTimeout(t); }, [nota]);

  const sel = docs?.find(d => d._id === selId) || docs?.[docs.length - 1] || null;
  const lectura = sel?.lectura;
  // leído con un lector más antiguo: se vuelve a leer solo (con el texto guardado)
  // todos los pliegos leídos con un lector más viejo se vuelven a leer (uno detrás de otro)
  const anticuados = (docs || []).filter(d => d.lectura && (d.lectura.version || 1) < VERSION_LECTOR).map(d => d._id).join(",");
  useEffect(() => {
    if (!anticuados) return;
    let vivo = true;
    (async () => {
      for (const d of (docs || []).filter(x => anticuados.split(",").includes(x._id))) {
        if (!vivo) return;
        try { const paginas = await textoDocumento(id, d); if (vivo) await releerDocumento(id, d, leerPliego(paginas)); }
        catch (e) { console.warn("[pliegos] releer:", e); }
      }
    })();
    return () => { vivo = false; };
  }, [id, anticuados]); // eslint-disable-line react-hooks/exhaustive-deps
  const resultados = useMemo(() => (texto.id === sel?._id && texto.paginas ? buscarEnPliego(texto.paginas, q) : []), [texto, sel?._id, q]);

  async function subir(files) {
    setError(null);
    for (const subido of files) {
      if (subido.size > PDF_MAX * 2) { setError(`«${subido.name}» pasa de 30 MB: sube una versión más ligera.`); continue; }
      let docsDe;
      try {
        setSubiendo(`Leyendo ${subido.name}…`);
        docsDe = await documentosDeArchivo(subido, { onProgreso: (i, n) => setSubiendo(`Leyendo ${subido.name}: página ${i} de ${n}…`) });
      } catch (e) { setError(`No se pudo leer «${subido.name}»: ${e.message || e}`); continue; }
      // un ZIP puede traer varios documentos: cada uno, por separado
      for (const { archivo, paginas } of docsDe) {
        if (archivo.size > PDF_MAX) { setError(`«${archivo.name}» pasa de 15 MB: sube una versión más ligera.`); continue; }
        try {
          const lect = leerPliego(paginas);
          setSubiendo(`Guardando ${archivo.name}…`);
          const nuevo = await guardarDocumento(id, { archivo, paginas, lectura: lect, onProgreso: (i, n) => setSubiendo(`Guardando ${archivo.name}… ${Math.round((100 * i) / n)} %`) });
          setSelId(nuevo); setTexto({ id: nuevo, paginas }); setPestana("pliegos");
          setNota(lect.conTexto ? `Leído: ${lect.datos.length} datos y ${lect.requisitos.length} requisitos encontrados${docsDe.length > 1 ? ` (${docsDe.length} documentos en «${subido.name}»)` : ""}.` : "Guardado, pero el documento parece escaneado (fotos de páginas): no tiene texto que leer.");
        } catch (e) { setError(`No se pudo subir «${archivo.name}»: ${e.message || e}`); }
      }
    }
    setSubiendo(null);
  }
  // concurso de la Plataforma: traer los documentos que faltan y, si la ficha
  // aún no tiene servicios, prepararlos con lo leído
  async function traerDePlataforma() {
    setError(null);
    try {
      const r = await traerLoQueFalta(id, concurso.plataforma.enlace, (docs || []).map(d => d.nombre), { onProgreso: setSubiendo });
      // con lo leído al día (los pliegos guardados con un lector viejo se leen otra vez aquí mismo)
      setSubiendo("Repasando los pliegos…");
      const aldia = await Promise.all((docs || []).map(async d => ((d.lectura?.version || 1) < VERSION_LECTOR ? { ...d, lectura: leerPliego(await textoDocumento(id, d)) } : d)));
      const sinServicios = !Object.keys(ficha?.servicios || {}).length;
      setSubiendo(sinServicios ? "Preparando los servicios para dimensionar…" : "Repasando los datos del pliego…");
      const p = await prepararDimension(id, [...aldia, ...r.leidos], contextoDelConcurso(ficha, concurso), { onProgreso: setSubiendo, conServicios: sinServicios, ficha });
      const extra = ` ${sinServicios ? `${p.servicios} servicios en la ficha` : "Servicios: los que ya tenías"}${p.estudio ? ", estudio de costes" : ""}${p.personal ? `, personal mínimo: ${p.personal}` : ""}${p.aDemanda ? ", a demanda" : ""}.`;
      if (r.fallos.length) setError(`No se pudieron traer: ${r.fallos.join(" · ")}`);
      setNota(`${r.nuevos ? `${r.leidos.length} documentos nuevos de la Plataforma.` : "Ya estaban todos los documentos de la Plataforma."}${extra}`);
    } catch (e) { setError(e.message || String(e)); }
    setSubiendo(null);
  }
  async function cargarTexto() {
    if (!sel || texto.id === sel._id) return;
    setTexto({ id: sel._id, paginas: null });
    try { setTexto({ id: sel._id, paginas: await textoDocumento(id, sel) }); } catch { setTexto({ id: null, paginas: null }); }
  }
  async function abrirPdf() {
    try { const url = URL.createObjectURL(await pdfDocumento(id, sel)); window.open(url, "_blank"); setTimeout(() => URL.revokeObjectURL(url), 60000); }
    catch (e) { setError(`No se pudo abrir el PDF: ${e.message || e}`); }
  }
  const tarjeta = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 };
  const titulo = t => <div style={{ fontSize: 15, fontWeight: 650, color: C.text, margin: "20px 0 10px" }}>{t}</div>;

  return (
    <div style={{ flex: 1, overflow: "auto", background: C.bg, fontFamily: font, padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 650, color: C.text, letterSpacing: "-0.02em" }}>Documentos</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 3, maxWidth: 620 }}>Sube el pliego de prescripciones técnicas (y, si quieres, el de cláusulas administrativas o el anuncio). Operanzia lo lee y te enseña lo importante con la página de donde sale.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {concurso?.plataforma?.enlace && <button className="op-btn" disabled={!!subiendo || docs === null} onClick={traerDePlataforma} title="Baja de la Plataforma de Contratación los pliegos y anexos que aún no están aquí"><ExternalLink size={15} /> Traer de la Plataforma lo que falta</button>}
          <button className="op-btn op-primario" disabled={!!subiendo} onClick={() => fileRef.current?.click()}>{subiendo ? <Loader2 size={15} className="op-girando" /> : <Upload size={15} />} Subir pliego (PDF)</button>
        </div>
        <input ref={fileRef} type="file" accept={ACEPTA_PLIEGOS} multiple style={{ display: "none" }} onChange={e => { const f = [...e.target.files]; e.target.value = ""; subir(f); }} />
      </div>

      {subiendo && <div style={{ ...tarjeta, padding: "10px 14px", color: C.muted, fontSize: 13, marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}><Loader2 size={15} className="op-girando" />{subiendo}</div>}
      {error && <div style={{ ...tarjeta, padding: "10px 14px", borderColor: "rgba(242,109,109,0.4)", color: C.red, fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {nota && <div style={{ ...tarjeta, padding: "10px 14px", borderColor: "rgba(63,207,142,0.35)", color: C.green, fontSize: 13, marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}><Check size={15} />{nota}</div>}

      {docs === null ? <div style={{ color: C.muted, fontSize: 13 }}>Cargando…</div>
        : !docs.length ? (
          <div onClick={() => !subiendo && fileRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); subir([...e.dataTransfer.files]); }}
            style={{ ...tarjeta, borderStyle: "dashed", padding: 40, textAlign: "center", cursor: "pointer" }}>
            <FileText size={34} color={C.dim} />
            <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginTop: 10 }}>Arrastra aquí el pliego en PDF</div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>o pulsa para elegirlo. Se lee en este ordenador: no se envía a ningún servicio externo.</div>
          </div>
        ) : (<>
          <div className="op-seg" style={{ marginBottom: 16 }}>
            <button className={pestana === "ficha" ? "op-on" : ""} onClick={() => setPestana("ficha")}>Ficha de requisitos</button>
            <button className={pestana === "pliegos" ? "op-on" : ""} onClick={() => setPestana("pliegos")}>Pliegos ({docs.length})</button>
          </div>
          {pestana === "ficha" ? (
            ficha ? <FichaRequisitos concursoId={id} concurso={concurso} docs={docs} ficha={ficha} onError={setError} onNota={setNota} /> : <div style={{ color: C.muted, fontSize: 13 }}>Cargando…</div>
          ) : (
          <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
            {/* documentos subidos */}
            <div style={{ flex: "0 0 260px", width: 260, minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
              {docs.map(d => (
                <div key={d._id} onClick={() => setSelId(d._id)} style={{ ...tarjeta, padding: "11px 13px", cursor: "pointer", minWidth: 0, overflow: "hidden", borderColor: sel?._id === d._id ? C.blue : C.border }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <FileText size={16} color={sel?._id === d._id ? C.blue : C.muted} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: C.text, fontWeight: 550, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.nombre}>{d.nombre}</div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{CLASE[d.clase] || "Documento"} · {d.paginas} pág.</div>
                    </div>
                    <button className="op-btn op-fantasma op-icono" title="Quitar este documento" onClick={async e => { e.stopPropagation(); if (window.confirm(`¿Quitar «${d.nombre}» del concurso?`)) await borrarDocumento(id, d).catch(err => setError(err.message)); }}><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
              <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); subir([...e.dataTransfer.files]); }} onClick={() => !subiendo && fileRef.current?.click()}
                style={{ border: `1px dashed ${C.border2}`, borderRadius: 12, padding: 12, textAlign: "center", fontSize: 12, color: C.dim, cursor: "pointer" }}>+ Añadir otro (o arrástralo aquí)</div>
            </div>

            {/* lo leído */}
            {sel && lectura && (
              <div style={{ flex: "1 1 520px", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 15, fontWeight: 650, color: C.text }}>{CLASE[lectura.clase] || sel.nombre}</div>
                    <div style={{ fontSize: 13, color: C.muted }}>{sel.nombre} · {sel.paginas} páginas{lectura.tipo ? ` · servicio de ${TIPO[lectura.tipo].toLowerCase()}` : ""}</div>
                  </div>
                  <button className="op-btn" onClick={abrirPdf}><ExternalLink size={14} /> Abrir PDF</button>
                </div>

                {!lectura.conTexto && <div style={{ ...tarjeta, marginTop: 14, color: C.amber, fontSize: 13 }}>Este PDF parece escaneado (son fotos de las páginas): no tiene texto que leer. Si lo tienes en otra versión, súbela.</div>}

                {lectura.datos.length > 0 && <>
                  {titulo("Lo que ha leído Operanzia")}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 }}>
                    {lectura.datos.map((d, i) => (
                      <div key={d.id + i} onClick={() => setAbierta(abierta === d.id + i ? null : d.id + i)} style={{ ...tarjeta, padding: "11px 14px", cursor: "pointer", gridColumn: abierta === d.id + i || String(d.valor).length > 60 ? "1 / -1" : undefined }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: 12, color: C.muted }}>{d.nombre}</span>
                          <span style={{ fontSize: 11, color: C.dim, whiteSpace: "nowrap" }}>pág. {d.pagina}</span>
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginTop: 3, lineHeight: 1.4 }}>{valorTxt(d)}</div>
                        {abierta === d.id + i && <div style={{ fontSize: 13, color: C.muted, marginTop: 8, fontStyle: "italic", lineHeight: 1.5, borderLeft: `2px solid ${C.border2}`, paddingLeft: 10 }}>«{d.frase}»</div>}
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>Pulsa un dato para ver la frase del pliego de donde sale.</div>
                </>}

                {(lectura.listas.fracciones.length > 0 || lectura.listas.limpieza.length > 0 || lectura.listas.ambiental.length > 0 || lectura.listas.frecuencias?.length > 0) && <>
                  {titulo("El servicio")}
                  {[["Fracciones", lectura.listas.fracciones], ["Limpieza", lectura.listas.limpieza], ["Exigencias ambientales", lectura.listas.ambiental]].filter(([, l]) => l.length).map(([t, l]) => (
                    <div key={t} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                      <span style={{ fontSize: 13, color: C.muted, width: 160 }}>{t}</span>
                      {l.map(x => <span key={x.nombre} className="op-pastilla" title={`pág. ${x.pagina}`} style={{ background: "rgba(91,124,250,0.12)", color: C.blueText || C.blue }}>{x.nombre}</span>)}
                    </div>
                  ))}
                  {lectura.listas.frecuencias?.length > 0 && (
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap", marginTop: 4 }}>
                      <span style={{ fontSize: 13, color: C.muted, width: 160 }}>Frecuencias</span>
                      <div style={{ flex: 1, minWidth: 240, display: "grid", gap: 4 }}>
                        {lectura.listas.frecuencias.map((f, i) => <div key={i} style={{ fontSize: 13, color: C.text, lineHeight: 1.45 }}>{f.texto} <span style={{ fontSize: 11, color: C.dim }}>· pág. {f.pagina}</span></div>)}
                      </div>
                    </div>
                  )}
                </>}

                {lectura.tablas?.length > 0 && <>
                  {titulo(`Cantidades que trae el pliego (${lectura.tablas.length} tablas)`)}
                  <div style={{ display: "grid", gap: 10 }}>
                    {lectura.tablas.map((t, k) => (
                      <div key={k} style={{ ...tarjeta, padding: 0, overflow: "auto" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "9px 14px", borderBottom: `1px solid ${C.border}` }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{t.titulo}</span>
                          <span style={{ fontSize: 11, color: C.dim, whiteSpace: "nowrap" }}>pág. {t.pagina}</span>
                        </div>
                        {t.cabecera && <div style={{ fontSize: 11, color: C.dim, padding: "6px 14px 0" }}>{t.cabecera}</div>}
                        <table style={{ borderCollapse: "collapse", fontSize: 13, margin: "4px 0 6px", minWidth: "100%" }}>
                          <tbody>
                            {t.filas.map((f, i) => (
                              <tr key={i}>
                                <td style={{ padding: "3px 14px", color: C.muted, whiteSpace: "nowrap" }}>{f.grupo ? <span style={{ color: C.dim }}>{f.grupo} · </span> : null}{f.concepto}</td>
                                {f.valores.map((v, j) => <td key={j} style={{ padding: "3px 10px", color: C.text, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(v)}</td>)}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                </>}

                {lectura.requisitos.length > 0 && <>
                  {titulo(`Requisitos importantes (${lectura.requisitos.length})`)}
                  <div style={{ ...tarjeta, padding: 0 }}>
                    {lectura.requisitos.map((r, i) => (
                      <div key={i} style={{ padding: "10px 14px", borderTop: i ? `1px solid ${C.border}` : "none", display: "flex", gap: 10, fontSize: 13, color: C.text, lineHeight: 1.5 }}>
                        <span style={{ fontSize: 11, color: C.dim, whiteSpace: "nowrap", paddingTop: 2 }}>pág. {r.pagina}</span><span>{r.texto}</span>
                      </div>
                    ))}
                  </div>
                </>}

                {titulo("Buscar en el pliego")}
                <div style={{ position: "relative", maxWidth: 420 }}>
                  <Search size={14} color={C.dim} style={{ position: "absolute", left: 10, top: 9 }} />
                  <input className="op-input" value={q} onFocus={cargarTexto} onChange={e => { setQ(e.target.value); cargarTexto(); }} placeholder="p. ej. subrogación, penalidades, horario…" style={{ paddingLeft: 30 }} />
                </div>
                {q.trim().length >= 3 && (
                  <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                    {texto.id === sel._id && !texto.paginas ? <div style={{ fontSize: 13, color: C.muted }}>Cargando el texto…</div>
                      : !resultados.length ? <div style={{ fontSize: 13, color: C.muted }}>No aparece «{q}».</div>
                      : resultados.map((r, i) => <div key={i} style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}><span style={{ color: C.dim, marginRight: 8 }}>pág. {r.pagina}</span>{r.frase}</div>)}
                  </div>
                )}

                {lectura.indice.length > 0 && <>
                  {titulo("Índice")}
                  <div style={{ ...tarjeta, padding: "8px 14px" }}>
                    {lectura.indice.map((x, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, color: C.muted, padding: "4px 0" }}><span>{x.titulo}</span><span style={{ color: C.dim }}>{x.pagina}</span></div>)}
                  </div>
                </>}
              </div>
            )}
          </div>
          )}
        </>)}
    </div>
  );
}
