// Concursos: la lista de licitaciones de la empresa, aparte de los proyectos
// de operativa. Cada uno se abre con sus propios módulos (Planning,
// Scheduling, Rostering, Cálculo, Alternativas, Documentos, Resumen) en su
// espacio aislado: nada de lo que se haga aquí toca la operativa.
import { Bus, ChevronRight, FileSearch, Loader2, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { collection, doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase.js";
import { C, font } from "../tema.js";
import { Vigilancia } from "./vigilancia.jsx";
import { crearConcursoDesdePlataforma, documentosUtiles, licitacionDeEnlace, tipoPorCpv } from "./plataforma.js";
import { ESTADOS, TIPOS_CONCURSO, cambiarConcurso, crearConcurso, escucharConcursos } from "./store.js";
import { tono } from "../tema.js";

const fechaTxt = f => (f ? new Date(`${f}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : null);

export function ConcursosPage({ orgId: orgPropia, isSuperAdmin, orgSugerida, onAbrir }) {
  // El superadmin no es de ninguna organización: elige para cuál trabaja (por defecto, la del proyecto abierto)
  const [orgs, setOrgs] = useState([]);
  const [orgElegida, setOrgElegida] = useState(null);
  useEffect(() => {
    if (!isSuperAdmin) return undefined;
    return onSnapshot(collection(db, "orgs"), s => setOrgs(s.docs.map(d => ({ org_id: d.id, ...d.data() })).sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""))), () => setOrgs([]));
  }, [isSuperAdmin]);
  const orgId = orgPropia || (isSuperAdmin ? orgElegida || orgSugerida || orgs[0]?.org_id || null : null);
  const [lista, setLista] = useState(null);
  const [error, setError] = useState(null);
  const [nuevo, setNuevo] = useState(null);
  const [abriendo, setAbriendo] = useState(null);
  useEffect(() => escucharConcursos(orgId, setLista, e => setError(e.message)), [orgId]);

  async function abrir(c) {
    setAbriendo(c._id);
    try {
      const s = await getDoc(doc(db, "scheduling_projects", c.projectId));
      if (!s.exists()) throw new Error("no se encuentra su proyecto");
      onAbrir({ _id: s.id, ...s.data(), concurso: c._id, concursoNombre: c.nombre });
    } catch (e) { setError(`No se pudo abrir: ${e.message}`); setAbriendo(null); }
  }
  async function crear() {
    if (!nuevo.nombre.trim()) return;
    if (!orgId) { setError("Elige primero la organización del concurso."); return; }
    setNuevo(n => ({ ...n, guardando: true }));
    try {
      if (nuevo.licitacion) {
        // desde la Plataforma: datos oficiales y pliegos leídos
        const r = await crearConcursoDesdePlataforma({ orgId, licitacion: nuevo.licitacion, nombre: nuevo.nombre.trim(), onProgreso: t => setNuevo(n => ({ ...n, progreso: t })) });
        setNuevo(null);
        if (r.fallos.length) window.alert(`Concurso creado con ${r.documentos} documentos leídos. No se pudieron traer: ${r.fallos.join(" · ")}. Súbelos a mano en Documentos.`);
        await abrir(r.concurso);
        return;
      }
      const { concurso } = await crearConcurso({ orgId, ...nuevo, nombre: nuevo.nombre.trim() });
      setNuevo(null);
      await abrir(concurso);
    } catch (e) { setError(`No se pudo crear: ${e.message}`); setNuevo(n => ({ ...n, guardando: false, progreso: null })); }
  }
  async function traer() {
    setNuevo(n => ({ ...n, trayendo: true, errorEnlace: null }));
    try {
      const l = await licitacionDeEnlace(nuevo.enlace);
      const meses = l.duracion?.meses;
      setNuevo(n => ({ ...n, trayendo: false, licitacion: l, nombre: (l.titulo || n.nombre).slice(0, 120), organismo: l.organo || n.organismo, tipo: tipoPorCpv(l.cpvs), duracionAnios: meses ? Math.round((meses / 12) * 10) / 10 : n.duracionAnios, fechaLimite: l.fechaLimite ? String(l.fechaLimite).slice(0, 10) : n.fechaLimite }));
    } catch (e) { setNuevo(n => ({ ...n, trayendo: false, errorEnlace: e.message || String(e) })); }
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "28px 24px", fontFamily: font }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 650, color: C.text, letterSpacing: "-0.02em" }}>Concursos</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 3, maxWidth: 560 }}>Estudios de licitación: flota, plantilla y coste de cada oferta. Cada concurso trabaja con sus propios datos, aparte de la operativa.</div>
        </div>
        <button className="op-btn op-primario" onClick={() => setNuevo({ nombre: "", organismo: "", tipo: "puntos", duracionAnios: 8, fechaLimite: "" })}><Plus size={15} /> Nuevo concurso</button>
      </div>

      {isSuperAdmin && !orgPropia && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: C.muted, whiteSpace: "nowrap" }}>Organización:</span>
          <select className="op-input" value={orgId || ""} onChange={e => setOrgElegida(e.target.value)} style={{ maxWidth: 320, height: 34 }} aria-label="Organización">
            {!orgId && <option value="">Elige una organización</option>}
            {orgs.map(o => <option key={o.org_id} value={o.org_id}>{o.nombre || o.org_id}</option>)}
          </select>
        </div>
      )}

      {orgId && <Vigilancia orgId={orgId} onAbrir={x => { const c = (lista || []).find(y => y._id === x._id); if (c) abrir(c); }} />}

      {error && <div className="op-tarjeta" style={{ padding: "10px 14px", color: C.red, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {lista === null ? <div style={{ color: C.muted, fontSize: 13 }}>Cargando…</div>
        : !lista.length ? (
          <div className="op-tarjeta" style={{ padding: 32, textAlign: "center" }}>
            <FileSearch size={32} color={C.dim} />
            <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginTop: 10 }}>Aún no hay concursos</div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>Crea uno para calcular la flota, la plantilla y el coste de una licitación.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {lista.map(c => {
              const est = ESTADOS.find(e => e.id === c.estado) || ESTADOS[0];
              return (
                <div key={c._id} className="op-tarjeta" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", cursor: "pointer" }} onClick={() => abrir(c)}>
                  <div style={{ width: 40, height: 40, borderRadius: 11, background: "rgba(91,124,250,0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: C.blue, flexShrink: 0 }}>
                    {c.tipo === "lineas" ? <Bus size={19} /> : <FileSearch size={19} />}
                  </div>
                  <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, color: C.text }}>{c.nombre}</div>
                    <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>
                      {[c.organismo, c.duracionAnios ? `${c.duracionAnios} años` : null, c.fechaLimite ? `presentar antes del ${fechaTxt(c.fechaLimite)}` : null].filter(Boolean).join(" · ") || TIPOS_CONCURSO.find(t => t.id === c.tipo)?.nombre}
                    </div>
                  </div>
                  <select className="op-input" value={c.estado} onClick={e => e.stopPropagation()} onChange={e => cambiarConcurso(c._id, { estado: e.target.value }, `Marcó un concurso como ${ESTADOS.find(x => x.id === e.target.value)?.nombre.toLowerCase()}`)}
                    style={{ width: 140, height: 30, color: est.color, fontWeight: 600 }}>
                    {ESTADOS.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                  </select>
                  {abriendo === c._id ? <Loader2 size={16} className="op-girando" color={C.muted} /> : <ChevronRight size={18} color={C.dim} />}
                </div>
              );
            })}
          </div>
        )}

      {nuevo && (
        <div onClick={() => !nuevo.guardando && setNuevo(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 480, maxWidth: "100%", background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 650, color: C.text, flex: 1 }}>Nuevo concurso</div>
              <button className="op-btn op-fantasma op-icono" onClick={() => setNuevo(null)}><X size={16} /></button>
            </div>
            <label className="op-label">Enlace de la licitación en la Plataforma de Contratación (opcional)</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input className="op-input" value={nuevo.enlace || ""} onChange={e => setNuevo(n => ({ ...n, enlace: e.target.value, licitacion: null }))} placeholder="https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&idEvl=…" aria-label="Enlace de la Plataforma" />
              <button className="op-btn" disabled={!nuevo.enlace?.trim() || nuevo.trayendo || nuevo.guardando} onClick={traer}>{nuevo.trayendo ? <Loader2 size={14} className="op-girando" /> : null} Traer datos</button>
            </div>
            {nuevo.errorEnlace && <div style={{ fontSize: 12.5, color: C.red, marginBottom: 8 }}>{nuevo.errorEnlace}</div>}
            {nuevo.licitacion && (
              <div style={{ background: C.surface2, borderRadius: 10, padding: "8px 12px", fontSize: 12.5, color: C.muted, marginBottom: 12, lineHeight: 1.6 }}>
                <b style={{ color: C.green }}>Datos oficiales:</b> presupuesto {nuevo.licitacion.presupuesto?.sinIva != null ? `${Math.round(nuevo.licitacion.presupuesto.sinIva).toLocaleString("es-ES")} € sin IVA` : "—"} · valor estimado {nuevo.licitacion.valorEstimado != null ? `${Math.round(nuevo.licitacion.valorEstimado).toLocaleString("es-ES")} €` : "—"} · {nuevo.licitacion.duracion?.meses ? `${nuevo.licitacion.duracion.meses} meses` : "duración sin dato"} · {nuevo.licitacion.criterios?.length || 0} criterios · CPV {(nuevo.licitacion.cpvs || []).join(", ")}
                <br />Se bajarán y leerán {documentosUtiles(nuevo.licitacion).length} documentos (pliegos y anexos útiles).{nuevo.licitacion.lotes > 1 ? ` Ojo: va por ${nuevo.licitacion.lotes} lotes y las cifras son del total.` : ""}
              </div>
            )}
            <label className="op-label">Nombre</label>
            <input className="op-input" autoFocus value={nuevo.nombre} onChange={e => setNuevo(n => ({ ...n, nombre: e.target.value }))} placeholder="Recogida de residuos de Salamanca" style={{ marginBottom: 12 }} />
            <label className="op-label">Organismo que licita</label>
            <input className="op-input" value={nuevo.organismo} onChange={e => setNuevo(n => ({ ...n, organismo: e.target.value }))} placeholder="Ayuntamiento de Salamanca" style={{ marginBottom: 12 }} />
            <label className="op-label">Tipo de servicio</label>
            <select className="op-input" value={nuevo.tipo} onChange={e => setNuevo(n => ({ ...n, tipo: e.target.value }))} style={{ marginBottom: 12 }}>
              {TIPOS_CONCURSO.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <label className="op-label">Duración del contrato (años)</label>
                <input className="op-input" type="number" min={1} max={30} value={nuevo.duracionAnios} onChange={e => setNuevo(n => ({ ...n, duracionAnios: e.target.value }))} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="op-label">Fecha límite de presentación</label>
                <input className="op-input" type="date" value={nuevo.fechaLimite} onChange={e => setNuevo(n => ({ ...n, fechaLimite: e.target.value }))} style={{ colorScheme: tono("dark", "light") }} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="op-btn" onClick={() => setNuevo(null)} disabled={nuevo.guardando}>Cancelar</button>
              {nuevo.progreso && <div style={{ flex: 1, fontSize: 12, color: C.muted, alignSelf: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nuevo.progreso}</div>}
              <button className="op-btn op-primario" onClick={crear} disabled={nuevo.guardando || !nuevo.nombre.trim()}>{nuevo.guardando ? <Loader2 size={14} className="op-girando" /> : null} Crear y abrir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
