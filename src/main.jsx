import { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

import App from "./App.jsx";
import { PlanningPage } from "./planning.jsx";
import { LoginScheduling, TabProyectos, SchedulingModuleWrapper } from "./scheduling.jsx";
import { db } from "./firebase.js";
import { collection, onSnapshot, doc, updateDoc, serverTimestamp } from "firebase/firestore";

const C = {
  bg: "#0f1117", card: "#161b27", surface2: "#1c2333",
  border: "rgba(255,255,255,0.07)", border2: "rgba(255,255,255,0.13)",
  text: "#e2e8f0", muted: "#94a3b8", dim: "#475569",
  blue: "#4f8ef7",
};
const font = '"Inter","Segoe UI",system-ui,sans-serif';

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
function TopBar({ sesion, activeProject, path, onLogout }) {
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
        <span style={{ fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase", fontWeight: 700 }}>FleetComms</span>
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
        </>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{sesion?.nombre}</div>
          <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: .5 }}>{sesion?.rol}</div>
        </div>
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
  const [sesion,        setSesion]        = useState(() => readLS("fc_session"));
  const [activeProject, setActiveProject] = useState(() => readLS("fc_active_project"));
  const [vehicles,      setVehicles]      = useState([]);
  const [workers,       setWorkers]       = useState([]);
  const [loadingV,      setLoadingV]      = useState(true);
  const [loadingW,      setLoadingW]      = useState(true);
  // Track if planning was ever opened (lazy mount for Leaflet)
  const [planningMounted, setPlanningMounted] = useState(false);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Auth guard
  useEffect(() => {
    if (!sesion && path !== "/login")  { go("/login"); return; }
    if (sesion  && path === "/login")  { go("/projects"); return; }
    if (sesion  && path === "/")       { go("/projects"); return; }
    if (sesion  && !activeProject && (path === "/planning" || path === "/scheduling")) {
      go("/projects");
    }
  }, [sesion, activeProject, path]);

  // Mount planning lazily so Leaflet always sees a visible container
  useEffect(() => {
    if (path === "/planning") setPlanningMounted(true);
  }, [path]);

  // Clear planningMounted when project changes
  useEffect(() => { setPlanningMounted(false); }, [activeProject?._id]);

  // Firestore: vehicles + workers
  useEffect(() => {
    if (!sesion) return;
    const u1 = onSnapshot(collection(db, "scheduling_vehicles"), s => {
      setVehicles(s.docs.map(d => ({ _id: d.id, ...d.data() }))); setLoadingV(false);
    }, () => setLoadingV(false));
    const u2 = onSnapshot(collection(db, "scheduling_workers"), s => {
      setWorkers(s.docs.map(d => ({ _id: d.id, ...d.data() }))); setLoadingW(false);
    }, () => setLoadingW(false));
    return () => { u1(); u2(); };
  }, [!!sesion]);

  function login(u) {
    setSesion(u); writeLS("fc_session", u); go("/projects");
  }
  function logout() {
    setSesion(null); setActiveProject(null);
    clearLS("fc_session"); clearLS("fc_active_project"); go("/login");
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

  if (path === "/login" || !sesion) return <LoginScheduling onLogin={login} />;

  const Shell = ({ children, scroll = false }) => (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: C.bg, fontFamily: font }}>
      <TopBar sesion={sesion} activeProject={activeProject} path={path} onLogout={logout} />
      <div style={{ flex: 1, overflow: scroll ? "auto" : "hidden", position: "relative" }}>
        {children}
      </div>
    </div>
  );

  if (path === "/projects") return (
    <Shell scroll>
      <TabProyectos activeProject={activeProject} onOpenProject={openProject} />
    </Shell>
  );

  if (activeProject) {
    if (path === "/planning") return (
      <Shell>
        {planningMounted && (
          <div style={{ position: "absolute", inset: 0, display: "flex" }}>
            <PlanningPage sesion={sesion} onLogout={logout} projectId={activeProject._id} embedded />
          </div>
        )}
      </Shell>
    );

    if (path === "/scheduling") return (
      <Shell>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
          <SchedulingModuleWrapper
            vehicles={vehicles} workers={workers}
            loadingV={loadingV} loadingW={loadingW}
            activeProject={activeProject} onProjectUpdate={updateProject}
          />
        </div>
      </Shell>
    );
  }

  return null;
}

// ── Entry ─────────────────────────────────────────────────────────
const initPath = window.location.pathname;
const isFleetApp = initPath === "/" || initPath.startsWith("/incidencias") ||
                   initPath.startsWith("/rutas") || initPath.startsWith("/inventario");

createRoot(document.getElementById("root")).render(
  isFleetApp ? <App /> : <WorkspaceRouter />
);
