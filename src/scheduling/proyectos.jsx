// Lista de proyectos (crear, abrir, duplicar, borrar).
// (Separado de scheduling.jsx sin cambiar su comportamiento.)
import { ArrowRight, Bus, FolderOpen, Plus, Trash2 } from "lucide-react";
import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { logAudit } from "../audit.js";
import { db } from "../firebase.js";
import { C, barrioColor, font } from "./estilo.js";

// ── TAB PROYECTOS ─────────────────────────────────────────────────
const PROJECT_STATUS = {
  nuevo:        { label: "Nuevo",       color: C.muted },
  con_planning: { label: "Planning",    color: C.blue  },
  schedulado:   { label: "Schedulado",  color: C.green },
  publicado:    { label: "Publicado",   color: C.amber },
};

// Colores disponibles para etiquetar la tarjeta de cada proyecto (franja
// izquierda) — puramente visual, para distinguir proyectos de un vistazo
// cuando hay muchos en la misma organización.
// Tipo de operación de un proyecto (decide qué Planning y Scheduling se ven)
const TIPOS_PROYECTO = [
  { id: "puntos", nombre: "Rutas por puntos", detalle: "Residuos, reparto, servicios técnicos: paradas que se visitan" },
  { id: "lineas", nombre: "Líneas regulares", detalle: "Autobuses: líneas con ida y vuelta, horarios y tiempos de recorrido" },
];

const PROJECT_COLORS = ["#5b7cfa","#3fcf8e","#f59e5b","#f26d6d","#a78bfa","#f5b84a","#f472b6","#22d3ee"];

export function TabProyectos({ activeProject, onOpenProject, orgId, isSuperAdmin }) {
  const [projects,    setProjects]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [newModal,    setNewModal]    = useState(null);
  const [creating, setCreating] = useState(false);
  const [orgs,        setOrgs]        = useState([]);
  const [filterOrg,   setFilterOrg]   = useState("__all__");

  // Load orgs list for superadmin filter
  useEffect(() => {
    if (!isSuperAdmin) return;
    const unsub = onSnapshot(collection(db, "orgs"), snap => {
      setOrgs(snap.docs.map(d => ({ org_id: d.id, ...d.data() })).sort((a, b) => a.nombre?.localeCompare(b.nombre)));
    });
    return () => unsub();
  }, [isSuperAdmin]);

  const effectiveOrgId = isSuperAdmin
    ? (filterOrg === "__all__" ? null : filterOrg)
    : orgId;

  useEffect(() => {
    const constraints = effectiveOrgId ? [where("org_id", "==", effectiveOrgId)] : [];
    const unsub = onSnapshot(
      query(collection(db, "scheduling_projects"), ...constraints),
      snap => {
        const docs = snap.docs
          .map(d => {
            const data = d.data();
            // Strip tasks from memory — list view doesn't need them
            // (tasks remain in Firestore until user re-imports, which saves without them)
            const planning = data.planning
              ? { tasksCount: data.planning.tasksCount, importedAt: data.planning.importedAt, uniqueBarrios: data.planning.uniqueBarrios }
              : null;
            return { _id: d.id, ...data, planning };
          })
          .filter(p => !p.concurso) // los proyectos de los concursos van en Concursos
          .sort((a, b) => {
            const am = a.updatedAt?.toMillis?.() ?? 0;
            const bm = b.updatedAt?.toMillis?.() ?? 0;
            return bm - am;
          });
        setProjects(docs); setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [effectiveOrgId]);

  async function createProject() {
    if (!newModal?.nombre?.trim() || creating) return;
    const docId  = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const nombre = newModal.nombre.trim();
    const desc   = newModal.descripcion?.trim() || "";
    const mes    = newModal.mes || new Date().toISOString().slice(0, 7);
    const projectOrgId = newModal.orgId || effectiveOrgId;
    const tipo = newModal.tipo === "lineas" ? "lineas" : "puntos";
    // Nunca caer en `docId` como org_id: un proyecto "huérfano" con su propio
    // id de documento como org_id parece crearse bien (no da ningún error),
    // pero todo lo que cuelga de él (vehículos, planes publicados en Rutas...)
    // queda invisible para siempre — ninguna consulta real filtra por ese
    // valor. El botón ya se desactiva en este caso, pero esto es la última
    // barrera por si algo lo evita (Enter en el formulario, etc.).
    if (!projectOrgId) { alert("No se puede crear el proyecto sin organización. Selecciona una."); return; }

    // Se abre cuando el servidor ya lo tiene guardado: las reglas de sus capas,
    // cocheras y ajustes miran de qué empresa es el proyecto, y si se abría
    // antes (como antes, «optimista»), esas escuchas se cortaban con «sin
    // permisos» y el proyecto recién creado no se actualizaba hasta recargar.
    setCreating(true);
    try {
      await setDoc(doc(db, "scheduling_projects", docId), {
        nombre, descripcion: desc, mes, status: "nuevo", tipo,
        org_id: projectOrgId,
        planning: null, scheduling: null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("createProject:", e);
      alert("Error al guardar el proyecto en la nube: " + e.message);
      setCreating(false);
      return;
    }
    logAudit({ modulo: "Proyectos", accion: "Creó un proyecto", detalle: `${nombre} (${mes})`, projectId: docId, proyecto: nombre, orgId: projectOrgId });
    setCreating(false);
    setNewModal(null);
    onOpenProject({ _id: docId, nombre, status: "nuevo", org_id: projectOrgId, tipo });
  }

  async function removeProject(id) {
    if (!window.confirm("¿Eliminar este proyecto y todos sus datos?")) return;
    const p = projects.find(x => x._id === id);
    await deleteDoc(doc(db, "scheduling_projects", id));
    logAudit({ modulo: "Proyectos", accion: "Eliminó un proyecto", detalle: p?.nombre || id, projectId: id, proyecto: p?.nombre || null, orgId: p?.org_id });
  }

  const [colorPickerFor, setColorPickerFor] = useState(null);
  function setProjectColor(id, color) {
    setColorPickerFor(null);
    updateDoc(doc(db, "scheduling_projects", id), { color }).catch(e => console.error("setProjectColor:", e));
  }

  const inpStyle = { width: "100%", background: C.surface2, border: `1px solid ${C.border2}`, color: C.text, borderRadius: 8, padding: "9px 12px", fontSize: 13, fontFamily: font, outline: "none", marginBottom: 10 };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "32px 36px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isSuperAdmin ? 12 : 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 650, color: C.text, letterSpacing: "-0.02em" }}>Proyectos</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
            Cada proyecto tiene sus puntos o líneas, su escenario y sus turnos.
          </div>
        </div>
        <button onClick={() => setNewModal({ nombre: "", descripcion: "", mes: new Date().toISOString().slice(0, 7), tipo: "puntos" })} className="op-btn op-primario" style={{ height: 36, padding: "0 16px", fontSize: 13 }}>
          <Plus size={16} /> Nuevo proyecto
        </button>
      </div>

      {/* Superadmin org filter */}
      {isSuperAdmin && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <span style={{ fontSize: 12, color: C.muted, whiteSpace: "nowrap" }}>Organización:</span>
          <select
            value={filterOrg}
            onChange={e => setFilterOrg(e.target.value)}
            style={{ background: C.surface2, border: `1px solid ${C.border2}`, color: C.text, borderRadius: 8, padding: "7px 12px", fontSize: 13, fontFamily: font, outline: "none", cursor: "pointer", flex: 1, maxWidth: 320 }}
          >
            <option value="__all__">Todas las organizaciones ({projects.length})</option>
            {orgs.map(o => (
              <option key={o.org_id} value={o.org_id}>{o.nombre}</option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: C.dim }}>Cargando…</div>
      ) : projects.length === 0 ? (
        <div style={{ textAlign: "center", padding: 80, color: C.dim }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: C.surface2, border: `1px solid ${C.border}`, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 14, color: C.muted }}><FolderOpen size={24} /></div>
          <div style={{ fontSize: 14, color: C.muted, fontWeight: 600, marginBottom: 6 }}>Sin proyectos todavía</div>
          <div style={{ fontSize: 12 }}>Crea tu primer proyecto para empezar.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 14 }}>
          {projects.map(p => {
            const st = PROJECT_STATUS[p.status] || PROJECT_STATUS.nuevo;
            const isActive = activeProject?._id === p._id;
            const dateStr = p.updatedAt?.toDate?.().toLocaleDateString("es-ES", { day:"2-digit", month:"short", year:"numeric" }) || "—";
            return (
              <div key={p._id} className={`op-tarjeta${isActive ? " op-activa" : ""}`} style={{
                padding: 20,
                display: "flex", flexDirection: "column", gap: 14,
                animation: "sched-fadein .15s ease both",
                position: "relative",
              }}>
                {/* Title row */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: p.color || C.dim, flexShrink: 0 }} />
                      <span style={{ fontSize: 15, fontWeight: 650, color: C.text, letterSpacing: "-0.01em" }}>{p.nombre}</span>
                      {isActive && <span className="op-pastilla" style={{ background: "rgba(91,124,250,0.14)", color: C.blueText }}>Abierto</span>}
                      {p.tipo === "lineas" && <span className="op-pastilla" title="Proyecto de líneas regulares (autobuses)" style={{ background: "rgba(63,207,142,0.1)", color: C.green }}><Bus size={11} /> Líneas</span>}
                    </div>
                    <div style={{ fontSize: 12, color: C.dim, marginLeft: 17 }}>{p.mes} · {dateStr}</div>
                    {p.descripcion && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{p.descripcion}</div>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => setColorPickerFor(cur => cur === p._id ? null : p._id)}
                      title="Color del proyecto"
                      style={{
                        width: 20, height: 20, borderRadius: "50%",
                        background: p.color || C.surface2,
                        border: `1px solid ${p.color ? "rgba(255,255,255,0.5)" : C.border2}`,
                        cursor: "pointer", padding: 0,
                      }}
                    />
                    <span style={{ fontSize: 10, fontWeight: 600, color: st.color, background: st.color + "22", borderRadius: 5, padding: "3px 8px", border: `1px solid ${st.color}44` }}>
                      {st.label}
                    </span>
                  </div>
                  {colorPickerFor === p._id && (
                    <>
                    <div onClick={() => setColorPickerFor(null)} style={{ position: "fixed", inset: 0, zIndex: 19 }} />
                    <div
                      style={{
                        position: "absolute", top: 44, right: 20, zIndex: 20,
                        background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 8,
                        padding: 8, display: "flex", gap: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                      }}
                    >
                      {p.color && (
                        <button onClick={() => setProjectColor(p._id, null)} title="Quitar color"
                          style={{ width: 18, height: 18, borderRadius: "50%", background: "none", border: `1px solid ${C.dim}`, color: C.dim, fontSize: 10, lineHeight: 1, cursor: "pointer", padding: 0 }}>×</button>
                      )}
                      {PROJECT_COLORS.map(c => (
                        <button key={c} onClick={() => setProjectColor(p._id, c)} title={c}
                          style={{
                            width: 18, height: 18, borderRadius: "50%", background: c, cursor: "pointer", padding: 0,
                            border: p.color === c ? "2px solid #fff" : "1px solid rgba(255,255,255,0.3)",
                          }} />
                      ))}
                    </div>
                    </>
                  )}
                </div>

                {/* Planning section */}
                <div style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${C.border}`, borderRadius: 10, padding: "11px 13px" }}>
                  <div style={{ fontSize: 10.5, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>Planning</div>
                  {p.tipo === "lineas" ? (
                    p.redResumen ? (
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>
                          {p.redResumen.lineas.toLocaleString("es-ES")} línea{p.redResumen.lineas === 1 ? "" : "s"} · {p.redResumen.paradas.toLocaleString("es-ES")} paradas
                        </div>
                        <div style={{ fontSize: 10.5, color: C.muted }}>
                          {p.redResumen.calendarios ? `${p.redResumen.calendarios} calendario${p.redResumen.calendarios === 1 ? "" : "s"} · ` : ""}{p.redResumen.archivo || "GTFS"}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: C.dim, fontStyle: "italic" }}>Sin red — importa el GTFS en Planning</div>
                    )
                  ) : p.planning ? (
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>
                        {p.planning.tasksCount} paradas
                      </div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {(p.planning.uniqueBarrios || []).slice(0, 8).map(b => (
                          <span key={b} style={{ fontSize: 9, background: barrioColor(b) + "28", border: `1px solid ${barrioColor(b)}55`, color: barrioColor(b), borderRadius: 4, padding: "1px 6px" }}>{b}</span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: C.dim, fontStyle: "italic" }}>Sin planning — importa desde Planning</div>
                  )}
                </div>

                {/* Scheduling section */}
                <div style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${C.border}`, borderRadius: 10, padding: "11px 13px" }}>
                  <div style={{ fontSize: 10.5, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>Scheduling</div>
                  {p.scheduling ? (
                    <div>
                      <div style={{ display: "flex", gap: 20 }}>
                        {[
                          [p.scheduling.daysUsed || 1, "días"],
                          [p.scheduling.totalStops || 0, "paradas"],
                          [`${(p.scheduling.totalKm || 0).toFixed(0)} km`, ""],
                          [p.scheduling.vehicleCount ?? p.scheduling.vehicles?.length ?? 0, "vehículos"],
                        ].map(([v, l]) => (
                          <div key={l}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: C.green }}>{v}</div>
                            <div style={{ fontSize: 9, color: C.dim }}>{l}</div>
                          </div>
                        ))}
                      </div>
                      {!!p.scheduling.turnos?.length && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 10.5, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>Turnos</div>
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                            {p.scheduling.turnos.map(tu => (
                              <span key={tu} style={{ fontSize: 9, background: C.blueDim, border: `1px solid ${C.border2}`, color: C.blueText, borderRadius: 4, padding: "1px 6px" }}>{tu}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {!!p.scheduling.vehicles?.length && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 10.5, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>Vehículos</div>
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                            {p.scheduling.vehicles.slice(0, 8).map((v, i) => (
                              <span key={v.nombre + i} title={v.turno || ""} style={{ fontSize: 9, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border2}`, color: C.muted, borderRadius: 4, padding: "1px 6px" }}>{v.nombre}</span>
                            ))}
                            {p.scheduling.vehicles.length > 8 && (
                              <span style={{ fontSize: 9, color: C.dim, padding: "1px 6px" }}>+{p.scheduling.vehicles.length - 8} más</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: C.dim, fontStyle: "italic" }}>{p.tipo === "lineas" ? "Genera vehículos y turnos en Scheduling" : "Sin schedule — genera el VRP"}</div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => onOpenProject(p)} className={`op-btn${isActive ? "" : " op-primario"}`} style={{ flex: 1, height: 34 }}>
                    {isActive ? "Ya abierto" : <>Abrir proyecto <ArrowRight size={14} /></>}
                  </button>
                  <button onClick={() => removeProject(p._id)} title="Borrar proyecto" className="op-btn op-fantasma op-icono op-btn-peligro" style={{ height: 34, width: 34 }}><Trash2 size={15} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New project modal */}
      {newModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}
          onClick={() => setNewModal(null)}>
          <div style={{ background: C.card, borderRadius: 14, padding: "28px 28px 22px", width: 400, boxShadow: "0 24px 64px rgba(0,0,0,0.5)", border: `1px solid ${C.border}` }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 18 }}>Nuevo proyecto</div>
            {isSuperAdmin && (
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 4 }}>Organización *</label>
                <select
                  value={newModal.orgId || effectiveOrgId || ""}
                  onChange={e => setNewModal(p => ({ ...p, orgId: e.target.value }))}
                  style={{ ...inpStyle, marginBottom: 0, cursor: "pointer", colorScheme: "dark" }}
                >
                  <option value="">— Selecciona una organización —</option>
                  {orgs.map(o => <option key={o.org_id} value={o.org_id}>{o.nombre}</option>)}
                </select>
              </div>
            )}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 6 }}>Tipo de operación</label>
              <div style={{ display: "flex", gap: 8 }}>
                {TIPOS_PROYECTO.map(t => {
                  const on = (newModal.tipo || "puntos") === t.id;
                  return (
                    <button key={t.id} type="button" onClick={() => setNewModal(p => ({ ...p, tipo: t.id }))} style={{
                      flex: 1, textAlign: "left", padding: "9px 10px", borderRadius: 8, cursor: "pointer", fontFamily: font,
                      background: on ? C.blueDim : C.surface2, border: `1px solid ${on ? C.blue : C.border}`,
                    }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: on ? C.blueText : C.text }}>{t.nombre}</div>
                      <div style={{ fontSize: 10.5, color: C.dim, marginTop: 2, lineHeight: 1.35 }}>{t.detalle}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            <input autoFocus placeholder="Nombre del proyecto *" value={newModal.nombre}
              onChange={e => setNewModal(p => ({ ...p, nombre: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && createProject()}
              style={inpStyle} />
            <input placeholder="Descripción (opcional)" value={newModal.descripcion}
              onChange={e => setNewModal(p => ({ ...p, descripcion: e.target.value }))}
              style={inpStyle} />
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 4 }}>Mes de servicio</label>
              <input type="month" value={newModal.mes}
                onChange={e => setNewModal(p => ({ ...p, mes: e.target.value }))}
                style={{ ...inpStyle, marginBottom: 0, width: "auto", colorScheme: "dark" }} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button onClick={() => setNewModal(null)} style={{ flex: 1, padding: "9px 0", background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: font }}>Cancelar</button>
              <button onClick={createProject} disabled={creating || !newModal.nombre.trim() || (isSuperAdmin && !newModal.orgId && !effectiveOrgId)} style={{
                flex: 2, padding: "9px 0", background: C.blue, border: "none", color: "#fff",
                borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: creating ? "wait" : "pointer",
                fontFamily: font, opacity: !newModal.nombre.trim() ? .5 : 1,
              }}>{creating ? "Creando…" : "Crear proyecto"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
