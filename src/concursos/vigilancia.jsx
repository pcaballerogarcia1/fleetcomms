// Concursos → vigilar licitaciones por CPV.
// La empresa elige sus CPV; Operanzia busca en la Plataforma de Contratación
// las licitaciones nuevas en plazo con esos CPV (al abrir Concursos, si hace
// más de una hora de la última vez, o con «Buscar ahora») y las enseña para
// crear su concurso con un clic. Con «Crear el concurso solo», se crean sin
// esperar (con sus datos oficiales y sus pliegos ya leídos).
import { ExternalLink, Loader2, Plus, Radar, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { C } from "../tema.js";
import { eur } from "./formato.js";
import { buscarLicitaciones, crearConcursoDesdePlataforma, licitacionDeEnlace } from "./plataforma.js";
import { escucharVigilancia, guardarVigilancia } from "./store.js";

const CPV_SUGERIDOS = [
  ["9051", "Recogida de residuos"], ["9061", "Limpieza viaria"], ["9068", "Limpieza de playas"], ["9091", "Limpieza de edificios"],
  ["6011", "Transporte por carretera (autobús)"], ["6013", "Transporte especial (escolar)"], ["9052", "Tratamiento de residuos"],
];
const UNA_HORA = 3600e3;
const enPlazo = l => (!l.estado || l.estado === "PUB") && (!l.fechaLimite || String(l.fechaLimite).slice(0, 10) >= new Date().toISOString().slice(0, 10));
const resumen = l => ({ id: l.id, enlace: l.enlace, titulo: l.titulo, organo: l.organo, cpvs: l.cpvs, presupuestoSinIva: l.presupuesto?.sinIva ?? null, valorEstimado: l.valorEstimado ?? null, fechaLimite: l.fechaLimite ? String(l.fechaLimite).slice(0, 10) : null, lugar: l.lugar || null, estado: l.estado || null, vista: Date.now() });

export function Vigilancia({ orgId, onAbrir }) {
  const [v, setV] = useState(null);
  const [abierta, setAbierta] = useState(false);
  const [nuevo, setNuevo] = useState("");
  const [buscando, setBuscando] = useState(null);
  const [error, setError] = useState(null);
  const [creando, setCreando] = useState(null); // { id, progreso }
  const lanzada = useRef(false);
  useEffect(() => escucharVigilancia(orgId, setV), [orgId]);
  const cpvs = v?.cpvs || [];

  async function buscar() {
    if (!cpvs.length || buscando) return;
    setError(null); setBuscando("Buscando en la Plataforma de Contratación… (puede tardar un minuto)");
    try {
      const desde = v?.ultima || new Date(Date.now() - 3 * 864e5).toISOString();
      const ahora = new Date().toISOString();
      const r = await buscarLicitaciones(cpvs, desde, 15);
      const previas = v?.encontradas || [];
      const nuevas = r.licitaciones.filter(enPlazo).map(resumen).filter(l => !previas.some(p => p.id === l.id));
      const encontradas = [...nuevas, ...previas.filter(enPlazo)].slice(0, 60);
      await guardarVigilancia(orgId, { ultima: ahora, encontradas });
      setBuscando(null);
      if (v?.autoCrear) for (const l of nuevas.filter(l => !(v?.descartadas || []).includes(l.id)).slice(0, 3)) await crear(l);
    } catch (e) { setBuscando(null); setError(`No se pudo buscar: ${e.message || e}`); }
  }
  // al abrir, si hace más de una hora de la última búsqueda
  useEffect(() => {
    if (!v || lanzada.current || !cpvs.length) return;
    lanzada.current = true;
    if (!v.ultima || Date.now() - new Date(v.ultima).getTime() > UNA_HORA) setTimeout(buscar, 0);
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps

  async function crear(l) {
    setCreando({ id: l.id, progreso: "Trayendo los datos oficiales…" });
    try {
      const lic = await licitacionDeEnlace(l.enlace);
      const r = await crearConcursoDesdePlataforma({ orgId, licitacion: lic, onProgreso: t => setCreando({ id: l.id, progreso: t }) });
      await guardarVigilancia(orgId, { creadas: { [l.id.replace(/[^\w-]/g, "_")]: r.concurso._id } });
    } catch (e) { setError(`No se pudo crear el concurso de «${l.titulo}»: ${e.message || e}`); }
    setCreando(null);
  }
  const cambiarCpvs = lista => guardarVigilancia(orgId, { cpvs: [...new Set(lista)] });
  const anadir = c => { const x = String(c).replace(/\D/g, "").slice(0, 8); if (x.length >= 2) cambiarCpvs([...cpvs, x]); setNuevo(""); };
  const creadas = v?.creadas || {};
  const lista = (v?.encontradas || []).filter(l => !(v?.descartadas || []).includes(l.id));

  return (
    <div className="op-tarjeta" style={{ padding: "12px 16px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => setAbierta(a => !a)}>
        <Radar size={17} color={C.blue} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 650, color: C.text }}>Vigilar licitaciones por CPV</div>
          <div style={{ fontSize: 12, color: C.muted }}>{cpvs.length ? `${cpvs.length} CPV · ${lista.length} licitaciones en plazo${v?.ultima ? ` · última búsqueda ${new Date(v.ultima).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}` : ""}` : "Elige tus CPV y Operanzia te avisa de cada licitación nueva en la Plataforma de Contratación."}</div>
        </div>
        {buscando && <Loader2 size={15} className="op-girando" color={C.muted} />}
        <span style={{ fontSize: 12, color: C.dim }}>{abierta ? "Ocultar" : "Ver"}</span>
      </div>
      {abierta && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {cpvs.map(c => (
              <span key={c} className="op-pastilla" style={{ background: "rgba(91,124,250,0.12)", color: C.text, display: "inline-flex", gap: 4, alignItems: "center" }}>
                {c}{CPV_SUGERIDOS.find(s => s[0] === c) ? ` · ${CPV_SUGERIDOS.find(s => s[0] === c)[1]}` : ""}
                <button className="op-btn op-fantasma op-icono" style={{ height: 18, width: 18 }} title="Quitar" onClick={() => cambiarCpvs(cpvs.filter(x => x !== c))}><X size={12} /></button>
              </span>
            ))}
            <input className="op-input" value={nuevo} onChange={e => setNuevo(e.target.value)} onKeyDown={e => e.key === "Enter" && anadir(nuevo)} placeholder="CPV (p. ej. 9051)" style={{ width: 140, height: 30 }} aria-label="Añadir CPV" />
            <button className="op-btn" style={{ height: 30 }} onClick={() => anadir(nuevo)} disabled={!nuevo.trim()}><Plus size={14} /> Añadir</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {CPV_SUGERIDOS.filter(s => !cpvs.includes(s[0])).map(([c, n]) => <button key={c} className="op-btn op-fantasma" style={{ height: 26, fontSize: 12 }} onClick={() => anadir(c)}>+ {c} {n}</button>)}
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <button className="op-btn op-primario" disabled={!cpvs.length || !!buscando} onClick={buscar}>{buscando ? <Loader2 size={14} className="op-girando" /> : <Radar size={14} />} Buscar ahora</button>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, color: C.text }}>
              <input type="checkbox" checked={!!v?.autoCrear} onChange={e => guardarVigilancia(orgId, { autoCrear: e.target.checked })} style={{ accentColor: C.blue }} /> Crear el concurso solo (con sus datos oficiales y sus pliegos leídos)
            </label>
          </div>
          {buscando && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8 }}>{buscando}</div>}
          {error && <div style={{ fontSize: 12.5, color: C.red, marginTop: 8 }}>{error}</div>}
          {lista.length > 0 && (
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {lista.map(l => {
                const hecho = creadas[l.id.replace(/[^\w-]/g, "_")];
                return (
                  <div key={l.id} style={{ display: "flex", gap: 10, alignItems: "center", background: C.surface2, borderRadius: 10, padding: "8px 12px", flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 320px", minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: C.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.titulo}>{l.titulo}</div>
                      <div style={{ fontSize: 11.5, color: C.muted }}>{l.organo || "—"}{l.lugar ? ` · ${l.lugar}` : ""} · CPV {(l.cpvs || []).slice(0, 3).join(", ")} · {l.presupuestoSinIva != null ? `${eur(l.presupuestoSinIva)} sin IVA` : "sin presupuesto"} · {l.fechaLimite ? `hasta el ${new Date(`${l.fechaLimite}T12:00:00`).toLocaleDateString("es-ES")}` : "sin fecha límite"}</div>
                      {creando?.id === l.id && <div style={{ fontSize: 11.5, color: C.blue }}>{creando.progreso}</div>}
                    </div>
                    {l.enlace && <a className="op-btn op-fantasma" style={{ height: 28, fontSize: 12 }} href={l.enlace} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Plataforma</a>}
                    {hecho ? <button className="op-btn" style={{ height: 28, fontSize: 12 }} onClick={() => onAbrir?.({ _id: hecho })}>Abrir concurso</button>
                      : <button className="op-btn op-primario" style={{ height: 28, fontSize: 12 }} disabled={!!creando} onClick={() => crear(l)}>{creando?.id === l.id ? <Loader2 size={13} className="op-girando" /> : null} Crear concurso</button>}
                    {!hecho && <button className="op-btn op-fantasma op-icono" title="Descartar" onClick={() => guardarVigilancia(orgId, { descartadas: [...(v?.descartadas || []), l.id] })}><X size={14} /></button>}
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: C.dim, marginTop: 10, lineHeight: 1.5 }}>Por ahora busca cuando alguien abre Concursos (si hace más de una hora) o al pulsar «Buscar ahora». Para que busque solo aunque nadie entre, hace falta configurar la cuenta de servicio en Vercel.</div>
        </div>
      )}
    </div>
  );
}
