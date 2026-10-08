// Lista de proyectos (crear, abrir, duplicar, borrar).
// (Separado de scheduling.jsx sin cambiar su comportamiento.)
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

const PROJECT_COLORS = ["#5c9bff","#34d399","#fb923c","#f87171","#a78bfa","#fbbf24","#f472b6","#22d3ee"];

export function TabProyectos({ activeProject, onOpenProject, orgId, isSuperAdmin }) {
  const [projects,    setProjects]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [newModal,    setNewModal]    = useState(null);
  const [creating,    setCreating]    = useState(false);
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

  function createProject() {
    if (!newModal?.nombre?.trim()) return;
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
    logAudit({ modulo: "Proyectos", accion: "Creó un proyecto", detalle: `${nombre} (${mes})`, projectId: docId, proyecto: nombre, orgId: projectOrgId });

    // Close modal and navigate immediately (optimistic)
    setNewModal(null);
    onOpenProject({ _id: docId, nombre, status: "nuevo", org_id: projectOrgId, tipo });

    // Save in background — alert only on failure
    setDoc(doc(db, "scheduling_projects", docId), {
      nombre, descripcion: desc, mes, status: "nuevo", tipo,
      org_id: projectOrgId,
      planning: null, scheduling: null,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }).catch(e => {
      console.error("createProject:", e);
      alert("Error al guardar el proyecto en la nube: " + e.message);
    });
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
    <div style={{ flex: 1, overflow: "auto", padding: 28 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isSuperAdmin ? 12 : 24 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Proyectos</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            Cada proyecto contiene su propio planning (paradas) y scheduling (asignación VRP).
          </div>
        </div>
        <button onClick={() => setNewModal({ nombre: "", descripcion: "", mes: new Date().toISOString().slice(0, 7), tipo: "puntos" })} style={{
          padding: "8px 16px", background: C.blue, border: "none", color: "#fff",
          borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font,
          display: "flex", alignItems: "center", gap: 7,
        }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Nuevo proyecto
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
          <div style={{ fontSize: 36, marginBottom: 12 }}>📁</div>
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
              <div key={p._id} style={{
                background: C.card,
                border: `1px solid ${isActive ? C.blue : C.border}`,
                borderLeft: `4px solid ${p.color || C.border}`,
                borderRadius: 12, padding: 20,
                boxShadow: isActive ? `0 0 0 1px ${C.blue}` : "none",
                display: "flex", flexDirection: "column", gap: 14,
                animation: "sched-fadein .15s ease both",
                position: "relative",
              }}>
                {/* Title row */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{p.nombre}</span>
                      {isActive && <span style={{ fontSize: 9, background: C.blueDim, color: C.blueText, borderRadius: 4, padding: "2px 6px", fontWeight: 600 }}>ABIERTO</span>}
                      {p.tipo === "lineas" && <span title="Proyecto de líneas regulares (autobuses)" style={{ fontSize: 9, background: "rgba(52,211,153,0.12)", color: C.green, border: "1px solid rgba(52,211,153,0.35)", borderRadius: 4, padding: "2px 6px", fontWeight: 700 }}>LÍNEAS REGULARES</span>}
                    </div>
                    <div style={{ fontSize: 10, color: C.dim }}>{p.mes} · {dateStr}</div>
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
                <div style={{ background: C.surface2, borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 9, color: C.dim, letterSpacing: 1.3, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>Planning</div>
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
                <div style={{ background: C.surface2, borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 9, color: C.dim, letterSpacing: 1.3, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>Scheduling</div>
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
                          <div style={{ fontSize: 9, color: C.dim, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Turnos</div>
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                            {p.scheduling.turnos.map(tu => (
                              <span key={tu} style={{ fontSize: 9, background: C.blueDim, border: `1px solid ${C.border2}`, color: C.blueText, borderRadius: 4, padding: "1px 6px" }}>{tu}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {!!p.scheduling.vehicles?.length && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 9, color: C.dim, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Vehículos</div>
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
                  <button
                    onClick={() => onOpenProject(p)}
                    style={{
                      flex: 1, padding: "8px 0",
                      background: isActive ? C.blueDim : C.blue,
                      border: `1px solid ${C.blue}`,
                      color: isActive ? C.blueText : "#fff",
                      borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font,
                      transition: "all .12s",
                    }}
                    onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = "#3a7de0"; } }}
                    onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = C.blue; } }}
                  >{isActive ? "Ya abierto" : "Abrir proyecto"}</button>
                  <button
                    onClick={() => removeProject(p._id)}
                    style={{ width: 34, height: 34, background: "none", border: `1px solid ${C.border}`, color: C.dim, borderRadius: 7, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
                  >×</button>
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
