import { useState, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

// Lazy: cada uno de estos es su propio chunk grande (App = app de
// conductores, SuperAdminApp, y los 4 módulos del workspace) que solo se
// descarga si el usuario realmente lo visita, en vez de forzar a todo el
// mundo a bajar los ~1.7MB de todos los módulos juntos.
const App            = lazy(() => import("./App.jsx"));
const SuperAdminApp  = lazy(() => import("./superadmin.jsx"));
const PlanningPageLazy   = lazy(() => import("./planning.jsx").then(m => ({ default: m.PlanningPage })));
const TabProyectosLazy   = lazy(() => import("./scheduling.jsx").then(m => ({ default: m.TabProyectos })));
const SchedulingModuleWrapperLazy = lazy(() => import("./scheduling.jsx").then(m => ({ default: m.SchedulingModuleWrapper })));
const RosteringPageLazy  = lazy(() => import("./rostering.jsx").then(m => ({ default: m.RosteringPage })));
const ControlPageLazy    = lazy(() => import("./control.jsx").then(m => ({ default: m.ControlPage })));
// LoginScheduling vive en su propio archivo diminuto (sin tirar de
// Scheduling/Planning/Rostering) — se importa normal porque hace falta
// de inmediato en /login.
import { LoginScheduling } from "./login-scheduling.jsx";
import { db, auth } from "./firebase.js";
import { collection, onSnapshot, doc, updateDoc, serverTimestamp, where, query, getDoc, getDocFromServer } from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";

const C = {
  bg: "#0f1623", card: "#172035", surface2: "#1e2d48",
  border: "rgba(88,130,225,0.22)", border2: "rgba(88,130,225,0.40)",
  text: "#e2eeff", muted: "#8aa5cc", dim: "#4a5f82",
  blue: "#5c9bff",
};
const font = '"Inter","Segoe UI",system-ui,sans-serif';

function LazyFallback() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, fontFamily: font }}>
      <div style={{ color: C.muted, fontSize: 13 }}>Cargando…</div>
    </div>
  );
}

function readLS(key) {
  try { return JSON.parse(localStorage.getItem(key)) ?? null; } catch { return null; }
}
function writeLS(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function clearLS(key) { localStorage.removeItem(key); }

function go(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

// ── Shared header ─────────────────────────────────────────────────
function TopBar({ sesion, activeProject, path, onLogout, onFullscreen }) {
  const initials = ((sesion?.nombre?.[0] ?? "") + (sesion?.apellidos?.[0] ?? "")).toUpperCase();
  const crumb = (label, href, active) => (
    <button onClick={() => go(href)} style={{
      background: active ? `${C.blue}18` : "none",
      border: `1px solid ${active ? `${C.blue}44` : "transparent"}`,
      cursor: "pointer", fontFamily: font, fontSize: 13,
      color: active ? C.blue : C.muted, fontWeight: active ? 600 : 400,
      padding: "3px 10px", borderRadius: 5, transition: "all .12s",
    }}
      onMouseEnter={e => { if (!active) { e.currentTarget.style.color = C.text; e.currentTarget.style.background = C.surface2; } }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.color = C.muted; e.currentTarget.style.background = "none"; } }}
    >{label}</button>
  );

  return (
    <div style={{
      height: 46, flexShrink: 0, background: C.card,
      borderBottom: `1px solid ${C.border}`,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 16px", fontFamily: font, gap: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase", fontWeight: 700 }}>Operanzia</span>
        <span style={{ color: C.dim, margin: "0 4px" }}>/</span>
        {crumb("Proyectos", "/projects", path === "/projects")}
        {activeProject && <>
          <span style={{ color: C.dim, fontSize: 12 }}>/</span>
          <span style={{ fontSize: 13, color: C.muted, fontWeight: 500, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0 4px" }}>
            {activeProject.nombre}
          </span>
          <span style={{ color: C.dim, fontSize: 12 }}>/</span>
          {crumb("Planning",    "/planning",    path === "/planning")}
          {crumb("Scheduling",  "/scheduling",  path === "/scheduling")}
          {crumb("Rostering",   "/rostering",   path === "/rostering")}
          {crumb("Control",     "/control",     path === "/control")}
        </>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{sesion?.nombre}</div>
          <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: .5 }}>{sesion?.rol}</div>
        </div>
        {(path === "/planning" || path === "/scheduling" || path === "/rostering" || path === "/control") && (
          <button onClick={onFullscreen} title="Pantalla completa" style={{
            width: 30, height: 30, borderRadius: 7, background: C.surface2,
            border: `1px solid ${C.border}`, color: C.dim, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blue; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
              <path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
            </svg>
          </button>
        )}
        <button onClick={onLogout} title="Cerrar sesión" style={{
          width: 30, height: 30, borderRadius: "50%", background: C.surface2,
          border: `1px solid ${C.border}`, color: C.muted, fontSize: 10, fontWeight: 700,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all .15s",
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
        >{initials}</button>
      </div>
    </div>
  );
}

// Recursively remove undefined values — Firestore rejects them
function stripUndef(v) {
  if (Array.isArray(v)) return v.map(stripUndef);
  if (v !== null && typeof v === "object" && !(v?.toDate)) {
    return Object.fromEntries(
      Object.entries(v)
        .filter(([, val]) => val !== undefined)
        .map(([k, val]) => [k, stripUndef(val)])
    );
  }
  return v;
}

// ── Router ────────────────────────────────────────────────────────
function WorkspaceRouter() {
  const [path,          setPath]          = useState(window.location.pathname);
  const [sesion,        setSesion]        = useState(undefined); // undefined=cargando
  const [activeProject, setActiveProject] = useState(() => readLS("fc_active_project"));
  const [vehicles,        setVehicles]        = useState([]);
  const [workers,         setWorkers]         = useState([]);
  const [loadingV,        setLoadingV]        = useState(true);
  const [loadingW,        setLoadingW]        = useState(true);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Firebase Auth — escuchar sesión.
  // getDocFromServer (no getDoc): justo después de iniciar sesión, la caché
  // local de Firestore puede no tener aún este documento — getDoc podría
  // devolver "no existe" desde una caché vacía/desactualizada antes de que
  // sincronice, cerrando la sesión que se acaba de abrir. Forzar servidor
  // evita esa carrera (se notaba como "solo funciona con las DevTools
  // abiertas", que ralentizan lo suficiente para que la caché ya sincronice).
  useEffect(() => {
    return onAuthStateChanged(auth, async user => {
      if (user) {
        try {
          const snap = await getDocFromServer(doc(db, "usuarios", user.uid));
          if (snap.exists()) {
            const profile = { uid: user.uid, ...snap.data() };
            setSesion(profile);
          } else {
            await signOut(auth); setSesion(null);
          }
        } catch { setSesion(null); }
      } else {
        setSesion(null);
      }
    });
  }, []);

  // Auth guard (solo cuando ya terminó de cargar)
  useEffect(() => {
    if (sesion === undefined) return; // aún cargando
    if (!sesion && path !== "/login")  { go("/login"); return; }
    if (sesion  && path === "/login")  { go("/projects"); return; }
    if (sesion  && path === "/")       { go("/projects"); return; }
    if (sesion  && !activeProject && (path === "/planning" || path === "/scheduling" || path === "/rostering" || path === "/control")) {
      go("/projects");
    }
  }, [sesion, activeProject, path]);

  // Superadmin may not have org_id — fall back to project's org, then project's _id
  const effectiveOrgId = sesion?.org_id || activeProject?.org_id || activeProject?._id || null;

  // Firestore: vehicles + workers filtrados por org_id
  useEffect(() => {
    if (!effectiveOrgId) {
      setLoadingV(false);
      setLoadingW(false);
      return;
    }
    setLoadingV(true);
    setLoadingW(true);
    const u1 = onSnapshot(
      query(collection(db, "scheduling_vehicles"), where("org_id", "==", effectiveOrgId)),
      s => { setVehicles(s.docs.map(d => ({ _id: d.id, ...d.data() }))); setLoadingV(false); },
      () => setLoadingV(false)
    );
    const u2 = onSnapshot(
      query(collection(db, "scheduling_workers"), where("org_id", "==", effectiveOrgId)),
      s => { setWorkers(s.docs.map(d => ({ _id: d.id, ...d.data() }))); setLoadingW(false); },
      () => setLoadingW(false)
    );
    return () => { u1(); u2(); };
  }, [effectiveOrgId]);

  function login(u) {
    setSesion(u); go("/projects");
  }
  async function logout() {
    await signOut(auth);
    setSesion(null); setActiveProject(null);
    clearLS("fc_active_project"); go("/login");
  }
  function openProject(p) {
    setActiveProject(p); writeLS("fc_active_project", p); go("/planning");
  }
  async function updateProject(updates) {
    if (!activeProject) return;
    await updateDoc(
      doc(db, "scheduling_projects", activeProject._id),
      { ...stripUndef(updates), updatedAt: serverTimestamp() }
    );
    const updated = { ...activeProject, ...updates };
    setActiveProject(updated); writeLS("fc_active_project", updated);
  }

  const [fullscreen, setFullscreen] = useState(false);

  // Mientras Firebase Auth inicializa
  if (sesion === undefined) return (
    <div style={{ display:"flex", height:"100vh", alignItems:"center", justifyContent:"center", background:C.bg, fontFamily:font }}>
      <div style={{ color:C.muted, fontSize:13 }}>Cargando…</div>
    </div>
  );

  if (path === "/login" || !sesion) return <LoginScheduling onLogin={login} />;

  // Single shell — all pages coexist so PlanningPage stays mounted (preserves
  // uploaded layers state across navigation within the same project)
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: C.bg, fontFamily: font }}>
      {!fullscreen && <TopBar sesion={sesion} activeProject={activeProject} path={path} onLogout={logout} onFullscreen={() => setFullscreen(true)} />}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>

        {/* /projects — unmounts when leaving (no heavy state to preserve) */}
        {path === "/projects" && (
          <div style={{ position: "absolute", inset: 0, overflowY: "auto" }}>
            <Suspense fallback={<LazyFallback />}>
              <TabProyectosLazy activeProject={activeProject} onOpenProject={openProject} orgId={sesion?.org_id} isSuperAdmin={sesion?.rol === "superadmin"} />
            </Suspense>
          </div>
        )}

        {/* /planning — always mounted while project is active.
            visibility:hidden (not display:none) keeps Leaflet dimensions
            correct and layers state alive regardless of navigation */}
        {activeProject && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            visibility: path === "/planning" ? "visible" : "hidden",
            pointerEvents: path === "/planning" ? "auto" : "none",
          }}>
            <Suspense fallback={<LazyFallback />}>
              <PlanningPageLazy
                sesion={sesion} onLogout={logout}
                projectId={activeProject._id} embedded
              />
            </Suspense>
          </div>
        )}

        {/* /scheduling — kept mounted to preserve generated scenario state */}
        {activeProject && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            visibility: path === "/scheduling" ? "visible" : "hidden",
            pointerEvents: path === "/scheduling" ? "auto" : "none",
          }}>
            <Suspense fallback={<LazyFallback />}>
              <SchedulingModuleWrapperLazy
                vehicles={vehicles} workers={workers}
                loadingV={loadingV} loadingW={loadingW}
                activeProject={activeProject} onProjectUpdate={updateProject}
                orgId={effectiveOrgId}
              />
            </Suspense>
          </div>
        )}

        {/* /rostering — kept mounted like Planning/Scheduling/Control so its
            listeners stay connected instead of reconnecting from scratch
            every time you navigate back here. */}
        {activeProject && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            visibility: path === "/rostering" ? "visible" : "hidden",
            pointerEvents: path === "/rostering" ? "auto" : "none",
          }}>
            <Suspense fallback={<LazyFallback />}>
              <RosteringPageLazy sesion={sesion} embedded activeProject={activeProject} orgId={effectiveOrgId} />
            </Suspense>
          </div>
        )}

        {/* /control — kept mounted like Planning/Scheduling so its Firestore
            listeners (planes, usuarios, ubicaciones_activas) stay connected
            in the background instead of tearing down and reconnecting from
            scratch — with hundreds of plans, that reconnect was the multi-
            second "blank screen" every time you navigated back here. */}
        {activeProject && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            visibility: path === "/control" ? "visible" : "hidden",
            pointerEvents: path === "/control" ? "auto" : "none",
          }}>
            <Suspense fallback={<LazyFallback />}>
              <ControlPageLazy sesion={sesion} orgId={effectiveOrgId} embedded />
            </Suspense>
          </div>
        )}

        {/* Fullscreen exit button */}
        {fullscreen && (
          <button
            onClick={() => setFullscreen(false)}
            title="Salir de pantalla completa"
            style={{
              position: "absolute", top: 10, right: 10, zIndex: 9999,
              background: "rgba(22,27,39,0.85)", border: `1px solid ${C.border2}`,
              color: C.muted, borderRadius: 8, cursor: "pointer",
              padding: "6px 12px", fontFamily: font, fontSize: 12, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 6,
              backdropFilter: "blur(4px)", boxShadow: "0 2px 12px rgba(0,0,0,.4)",
              transition: "all .15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = C.text; e.currentTarget.style.borderColor = C.blue; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.borderColor = C.border2; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/>
              <path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>
            </svg>
            Salir de pantalla completa
          </button>
        )}

      </div>
    </div>
  );
}

// ── Entry ─────────────────────────────────────────────────────────
const initPath = window.location.pathname;
const isFleetApp    = initPath.startsWith("/incidencias") ||
                      initPath.startsWith("/rutas") || initPath.startsWith("/inventario");
const isSuperAdmin  = initPath.startsWith("/superadmin");

function RootFallback() {
  return (
    <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: C.bg, fontFamily: font }}>
      <div style={{ color: C.muted, fontSize: 13 }}>Cargando…</div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <Suspense fallback={<RootFallback />}>
    {isSuperAdmin ? <SuperAdminApp /> : isFleetApp ? <App /> : <WorkspaceRouter />}
  </Suspense>
);
