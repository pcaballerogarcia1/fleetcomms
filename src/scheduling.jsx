import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db, getUserProfileSafe } from "./firebase.js";
import { LoginScheduling } from "./login-scheduling.jsx";
import { PlanningPage } from "./planning.jsx";
import { C, font } from "./scheduling/estilo.js";
import { TabTrabajadores, TabVehiculos } from "./scheduling/flota.jsx";
import { TabPlanificacion } from "./scheduling/planificacion.jsx";
import { TabProyectos } from "./scheduling/proyectos.jsx";

// Lo que otros módulos importan de aquí (main.jsx, lineas-scheduling.jsx)
export { TabTrabajadores, TabVehiculos } from "./scheduling/flota.jsx";
export { KpiBar } from "./scheduling/gantt.jsx";
export { TabPlanificacion } from "./scheduling/planificacion.jsx";
export { TabProyectos } from "./scheduling/proyectos.jsx";

// ── SCHEDULING PAGE ───────────────────────────────────────────────
export function SchedulingModuleWrapper({ vehicles, workers, loadingV, loadingW, activeProject, onProjectUpdate, orgId, sesion = null }) {
  const [subTab, setSubTab] = useState("vrp");
  const SUB_TABS = [
    { key: "vrp",          label: "VRP / Gantt" },
    { key: "vehiculos",    label: `Vehículos${vehicles.length ? ` (${vehicles.length})` : ""}` },
    { key: "trabajadores", label: `Trabajadores${workers.length ? ` (${workers.length})` : ""}` },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <div style={{
        height: 38, flexShrink: 0,
        background: C.card, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "stretch", padding: "0 20px", gap: 2,
      }}>
        {SUB_TABS.map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "0 14px", fontFamily: font,
            fontSize: 12, fontWeight: subTab === t.key ? 600 : 400,
            color: subTab === t.key ? C.text : C.muted,
            borderBottom: `2px solid ${subTab === t.key ? C.blue : "transparent"}`,
            marginBottom: -1, transition: "color .12s",
          }}>{t.label}</button>
        ))}
      </div>
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, display: subTab === "vrp" ? "flex" : "none", overflow: "hidden" }}>
          <TabPlanificacion
            vehicles={vehicles} workers={workers}
            activeProject={activeProject}
            onProjectUpdate={onProjectUpdate}
            orgId={orgId} sesion={sesion}
          />
        </div>
        {subTab === "vehiculos"    && <TabVehiculos vehicles={vehicles} loading={loadingV} activeProject={activeProject} orgId={orgId} />}
        {subTab === "trabajadores" && <TabTrabajadores workers={workers} vehicles={vehicles} loading={loadingW} activeProject={activeProject} orgId={orgId} />}
      </div>
    </div>
  );
}

function SchedulingPage({ sesion, onLogout }) {
  const [tab,              setTab]              = useState("proyectos");
  const [vehicles,         setVehicles]         = useState([]);
  const [workers,          setWorkers]          = useState([]);
  const [loadingV,         setLoadingV]         = useState(true);
  const [loadingW,         setLoadingW]         = useState(true);
  const [activeProject,    setActiveProject]    = useState(null);
  const [planningEverOpen, setPlanningEverOpen] = useState(false);

  useEffect(() => {
    if (!sesion?.org_id) return;
    const unsub = onSnapshot(
      query(collection(db, "scheduling_vehicles"), where("org_id", "==", sesion.org_id)),
      snap => { setVehicles(snap.docs.map(d => ({ _id: d.id, ...d.data() }))); setLoadingV(false); },
      () => setLoadingV(false)
    );
    return () => unsub();
  }, [sesion?.org_id]);

  useEffect(() => {
    if (!sesion?.org_id) return;
    const unsub = onSnapshot(
      query(collection(db, "scheduling_workers"), where("org_id", "==", sesion.org_id)),
      snap => { setWorkers(snap.docs.map(d => ({ _id: d.id, ...d.data() }))); setLoadingW(false); },
      () => setLoadingW(false)
    );
    return () => unsub();
  }, [sesion?.org_id]);

  const initials = ((sesion.nombre?.[0] ?? "") + (sesion.apellidos?.[0] ?? "")).toUpperCase();

  async function handleProjectUpdate(updates) {
    if (!activeProject) return;
    const ref = doc(db, "scheduling_projects", activeProject._id);
    await updateDoc(ref, { ...updates, updatedAt: serverTimestamp() });
    setActiveProject(prev => ({ ...prev, ...updates }));
  }

  function openProject(p) {
    setActiveProject(p);
    setPlanningEverOpen(false);
    setTab("planificacion");
  }

  function closeProject() {
    setActiveProject(null);
    setPlanningEverOpen(false);
    setTab("planificacion");
  }

  function goToTab(key) {
    if (key === "planning") setPlanningEverOpen(true);
    setTab(key);
  }

  const PROJECT_TABS = [
    { key: "planning",      label: "Planning" },
    { key: "planificacion", label: "Scheduling" },
    { key: "vehiculos",     label: `Vehículos${vehicles.length ? ` (${vehicles.length})` : ""}` },
    { key: "trabajadores",  label: `Trabajadores${workers.length ? ` (${workers.length})` : ""}` },
  ];

  const UserAvatar = (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{sesion.nombre}</div>
        <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: .5 }}>{sesion.rol}</div>
      </div>
      <button onClick={onLogout} title="Cerrar sesión" style={{
        width: 32, height: 32, borderRadius: "50%", background: C.surface2,
        border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, fontWeight: 600,
        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all .15s",
      }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.text; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
      >{initials}</button>
    </div>
  );

  /* ── PROJECTS LANDING (no active project) ─────────────────────── */
  if (!activeProject) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: C.bg, fontFamily: font }}>
        <div style={{
          height: 52, flexShrink: 0, background: C.card,
          borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 20px", zIndex: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <a href="/planning" style={{ fontSize: 11, color: C.dim, letterSpacing: 2, textTransform: "uppercase", fontWeight: 600, textDecoration: "none", transition: "color .12s" }}
              onMouseEnter={e => e.currentTarget.style.color = C.muted}
              onMouseLeave={e => e.currentTarget.style.color = C.dim}>
              Operanzia
            </a>
            <div style={{ width: 1, height: 16, background: C.border2 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Proyectos</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <a href="/planning" style={{
              fontSize: 12, color: C.muted, fontFamily: font, textDecoration: "none",
              padding: "5px 12px", borderRadius: 6, border: `1px solid ${C.border}`,
              transition: "all .15s", display: "flex", alignItems: "center", gap: 6,
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blue; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="9 3 9 21"/></svg>
              Planning
            </a>
            {UserAvatar}
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          <TabProyectos activeProject={null} onOpenProject={openProject} orgId={sesion?.org_id} isSuperAdmin={sesion?.rol === "superadmin"} />
        </div>
      </div>
    );
  }

  /* ── PROJECT WORKSPACE (active project) ────────────────────────── */
  const STATUS_COLORS = { nuevo: C.dim, con_planning: C.blue, schedulado: C.green, publicado: "#f59e0b" };
  const STATUS_LABELS = { nuevo: "Nuevo", con_planning: "Con planning", schedulado: "Schedulado", publicado: "Publicado" };

  const IconPlanning = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>;
  const IconSchedule = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;

  function RailBtn({ navKey, icon, label }) {
    const active = tab === navKey;
    return (
      <div style={{ position: "relative", display: "flex", justifyContent: "center" }} className="rail-item">
        <button onClick={() => goToTab(navKey)} title={label} style={{
          width: 44, height: 44, borderRadius: 10,
          background: active ? `${C.blue}22` : "none",
          border: `1px solid ${active ? `${C.blue}55` : "transparent"}`,
          color: active ? C.blue : C.dim,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all .15s",
        }}
          onMouseEnter={e => { if (!active) { e.currentTarget.style.background = C.surface2; e.currentTarget.style.color = C.muted; } }}
          onMouseLeave={e => { if (!active) { e.currentTarget.style.background = active ? `${C.blue}22` : "none"; e.currentTarget.style.color = active ? C.blue : C.dim; } }}
        >
          {icon}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", background: C.bg, fontFamily: font }}>

      {/* ── ICON RAIL (48px) ───────────────────────────────────────── */}
      <div style={{
        width: 56, flexShrink: 0,
        background: C.card, borderRight: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column", alignItems: "center",
        paddingTop: 10, paddingBottom: 10, gap: 4, zIndex: 20,
      }}>
        {/* Back to projects */}
        <button onClick={closeProject} title="Todos los proyectos" style={{
          width: 44, height: 36, borderRadius: 8, background: "none",
          border: "none", color: C.dim, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all .15s", marginBottom: 6,
        }}
          onMouseEnter={e => { e.currentTarget.style.background = C.surface2; e.currentTarget.style.color = C.muted; }}
          onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = C.dim; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>

        {/* Project initial */}
        <div title={activeProject.nombre} style={{
          width: 32, height: 32, borderRadius: 8,
          background: `${C.blue}22`, border: `1px solid ${C.blue}44`,
          color: C.blue, fontSize: 12, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 8, cursor: "default",
        }}>
          {(activeProject.nombre?.[0] ?? "P").toUpperCase()}
        </div>

        {/* Nav icons */}
        <RailBtn navKey="planning"      icon={IconPlanning} label="Planning"   />
        <RailBtn navKey="planificacion" icon={IconSchedule} label="Scheduling" />

        {/* User at bottom */}
        <div style={{ flex: 1 }} />
        <button onClick={onLogout} title={`${sesion.nombre} — Cerrar sesión`} style={{
          width: 32, height: 32, borderRadius: "50%", background: C.surface2,
          border: `1px solid ${C.border}`, color: C.muted, fontSize: 10, fontWeight: 700,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all .15s",
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
        >{initials}</button>
      </div>

      {/* ── CONTENT AREA — position:relative so tabs stack with absolute inset ── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* Planning: always mounted once opened, visibility:hidden preserves
            Leaflet dimensions so tiles render correctly when tab is inactive */}
        {planningEverOpen && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", overflow: "hidden",
            visibility: tab === "planning" ? "visible" : "hidden",
            pointerEvents: tab === "planning" ? "auto" : "none",
          }}>
            <PlanningPage sesion={sesion} onLogout={() => {}} projectId={activeProject._id} embedded />
          </div>
        )}
        {/* Scheduling — standard display toggle, no Leaflet inside */}
        <div style={{
          position: "absolute", inset: 0, display: tab === "planificacion" ? "flex" : "none",
          flexDirection: "column", overflow: "hidden",
        }}>
          <SchedulingModuleWrapper
            vehicles={vehicles} workers={workers} loadingV={loadingV} loadingW={loadingW}
            activeProject={activeProject} onProjectUpdate={handleProjectUpdate}
            orgId={sesion?.org_id}
          />
        </div>
      </div>
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────
// LoginScheduling vive en ./login-scheduling.jsx (sin depender de este
// archivo) para que la pantalla de login no tenga que descargar todo el
// bundle de Scheduling/Planning/Rostering solo para mostrar un formulario.
// Se re-exporta aquí porque otros módulos aún la importan desde ./scheduling.jsx.
export { LoginScheduling };

// ── ROOT ──────────────────────────────────────────────────────────
export default function SchedulingApp() {
  const [sesion, setSesion] = useState(undefined); // undefined=cargando

  useEffect(() => {
    return onAuthStateChanged(auth, async user => {
      if (user) {
        try {
          const snap = await getUserProfileSafe(user.uid);
          if (snap.exists() && snap.data().activo !== false) {
            setSesion({ uid: user.uid, ...snap.data() });
          } else { await signOut(auth); setSesion(null); }
        } catch { setSesion(null); }
      } else { setSesion(null); }
    });
  }, []);

  async function handleLogin(profile) { setSesion(profile); }
  async function handleLogout() { await signOut(auth); setSesion(null); }

  if (sesion === undefined) return (
    <div style={{ display:"flex", height:"100vh", alignItems:"center", justifyContent:"center", background:C.bg, fontFamily:font }}>
      <div style={{ color:C.muted, fontSize:13 }}>Cargando…</div>
    </div>
  );
  if (!sesion || sesion.rol !== "admin") return <LoginScheduling onLogin={handleLogin} />;
  return <SchedulingPage sesion={sesion} onLogout={handleLogout} />;
}
