// El espacio de trabajo de la oficina: cabecera, rutas (/projects, /planning,
// /scheduling, /rostering, /control, /analytics) y la sesión.
import { Marca } from "./ui/marca.jsx";
import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { LoginScheduling } from "./login-scheduling.jsx";
import { db, auth, getUserProfileSafe } from "./firebase.js";
import { collection, onSnapshot, doc, updateDoc, serverTimestamp, where, query } from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useLang, setLang, t } from "./i18n.js";
import { puedeUsarWorkspace, roleLabel } from "./roles.js";
import { OnlineUsers } from "./presence-bar.jsx";
import { AuditButton } from "./audit-panel.jsx";
import { HelpButton } from "./help-panel.jsx";
import { ProjectMenu } from "./project-menu.jsx";
import { startPresence, markOffline, updatePresencePage } from "./presence.js";
import { setAuditUser, setAuditProject, flushAllAudit } from "./audit.js";
import { setErrorUser } from "./error-report.js";
import { repararPlanesSinConductor } from "./reparar-planes.js";
import { sincronizarDepotsFichaje } from "./fichaje-depots.js";
import { AvatarPerfil } from "./foto-perfil.jsx";
import { RUTAS_CONCURSO } from "./concursos/store.js";
import { C, font } from "./raiz-estilo.js";

// Lazy: cada uno de estos es su propio chunk grande (App = app de
// conductores, SuperAdminApp, y los 4 módulos del workspace) que solo se
// descarga si el usuario realmente lo visita, en vez de forzar a todo el
// mundo a bajar los ~1.7MB de todos los módulos juntos.
const PlanningPageLazy   = lazy(() => import("./planning.jsx").then(m => ({ default: m.PlanningPage })));
const TabProyectosLazy   = lazy(() => import("./scheduling.jsx").then(m => ({ default: m.TabProyectos })));
const SchedulingModuleWrapperLazy = lazy(() => import("./scheduling.jsx").then(m => ({ default: m.SchedulingModuleWrapper })));
const RosteringPageLazy  = lazy(() => import("./rostering.jsx").then(m => ({ default: m.RosteringPage })));
const ControlPageLazy    = lazy(() => import("./control.jsx").then(m => ({ default: m.ControlPage })));
const DespachoPageLazy   = lazy(() => import("./despacho.jsx").then(m => ({ default: m.DespachoPage })));
const AnalyticsPageLazy  = lazy(() => import("./analytics.jsx").then(m => ({ default: m.AnalyticsPage })));
const AnalyticsLineasLazy = lazy(() => import("./analytics-lineas.jsx").then(m => ({ default: m.AnalyticsLineasPage })));
// Proyectos de "Líneas regulares" (autobuses): su propio Planning y Scheduling
const PlanningLineasLazy   = lazy(() => import("./lineas-planning.jsx").then(m => ({ default: m.PlanningLineasPage })));
const SchedulingLineasLazy = lazy(() => import("./lineas-scheduling.jsx").then(m => ({ default: m.SchedulingLineasPage })));
const ControlLineasLazy    = lazy(() => import("./lineas-control.jsx").then(m => ({ default: m.ControlLineasPage })));
// Concursos (licitaciones): su lista y sus módulos propios
const ConcursosPageLazy    = lazy(() => import("./concursos/lista.jsx").then(m => ({ default: m.ConcursosPage })));
const ResumenConcursoLazy  = lazy(() => import("./concursos/modulos.jsx").then(m => ({ default: m.ResumenConcurso })));
const CalculoConcursoLazy  = lazy(() => import("./concursos/calculo.jsx").then(m => ({ default: m.CalculoConcurso })));
const AlternativasConcursoLazy = lazy(() => import("./concursos/alternativas.jsx").then(m => ({ default: m.AlternativasConcurso })));
const DocumentosConcursoLazy = lazy(() => import("./concursos/documentos.jsx").then(m => ({ default: m.DocumentosConcurso })));
const PlanningConcursoLazy  = lazy(() => import("./concursos/planning.jsx").then(m => ({ default: m.PlanningConcurso })));

// Las pantallas que necesitan un proyecto abierto
const RUTAS_OPERATIVA = ["/planning", "/scheduling", "/rostering", "/departure", "/control", "/analytics"];
const RUTAS_SOLO_OPERATIVA = ["/departure", "/control", "/analytics"];
const RUTAS_CON_PROYECTO = [...RUTAS_OPERATIVA, ...RUTAS_CONCURSO.map(r => r[0])];

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
function TopBar({ sesion, activeProject, path, onLogout, onFullscreen, onOpenProject }) {
  const lang = useLang();
  const crumb = (label, href, active) => (
    <button onClick={() => go(href)} style={{
      background: active ? "rgba(255,255,255,0.07)" : "none",
      border: "1px solid transparent",
      boxShadow: active ? "inset 0 0 0 1px rgba(255,255,255,0.06)" : "none",
      cursor: "pointer", fontFamily: font, fontSize: 13,
      color: active ? C.text : C.muted, fontWeight: active ? 550 : 450,
      padding: "5px 10px", borderRadius: 7, transition: "all .12s",
    }}
      onMouseEnter={e => { if (!active) { e.currentTarget.style.color = C.text; e.currentTarget.style.background = C.surface2; } }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.color = C.muted; e.currentTarget.style.background = "none"; } }}
    >{label}</button>
  );

  return (
    <div style={{
      height: 52, flexShrink: 0, background: C.bg,
      borderBottom: `1px solid ${C.border}`,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 16px", fontFamily: font, gap: 6,
    }}>
      <div className="op-sin-barra" style={{ display: "flex", alignItems: "center", gap: 4, flex: "1 1 auto", minWidth: 0, overflowX: "auto", whiteSpace: "nowrap" }}>
        <button onClick={() => go("/projects")} title="Proyectos" style={{ background: "none", border: "none", padding: "0 6px 0 0", cursor: "pointer", display: "flex" }}><Marca size={22} /></button>
        <span style={{ color: "rgba(255,255,255,0.12)", margin: "0 6px", fontSize: 18, fontWeight: 300 }}>/</span>
        {crumb(t("proyectos", lang), "/projects", path === "/projects")}
        {crumb("Concursos", "/concursos", path === "/concursos")}
        {activeProject?.concurso && <>
          <span style={{ color: "rgba(255,255,255,0.12)", margin: "0 2px", fontSize: 18, fontWeight: 300 }}>/</span>
          <span title="Concurso: trabaja con sus propios datos, aparte de la operativa" style={{ fontSize: 13, color: C.text, fontWeight: 550, padding: "5px 6px", display: "flex", alignItems: "center", gap: 6, maxWidth: 260, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
            <span className="op-pastilla" style={{ background: "rgba(245,184,74,0.14)", color: "#f5b84a" }}>Concurso</span>{activeProject.concursoNombre || activeProject.nombre}
          </span>
          <span style={{ width: 1, height: 18, background: C.border, margin: "0 8px" }} />
          {crumb("Documentos", "/documentos", path === "/documentos")}
          {crumb(t("planning", lang),   "/planning",    path === "/planning")}
          {crumb(t("scheduling", lang), "/scheduling",  path === "/scheduling")}
          {crumb(t("rostering", lang),  "/rostering",   path === "/rostering")}
          {RUTAS_CONCURSO.filter(([ruta]) => ruta !== "/documentos").map(([ruta, , nombre]) => <span key={ruta}>{crumb(nombre, ruta, path === ruta)}</span>)}
        </>}
        {activeProject && !activeProject.concurso && <>
          <span style={{ color: "rgba(255,255,255,0.12)", margin: "0 2px", fontSize: 18, fontWeight: 300 }}>/</span>
          {/* Nombre del proyecto: al pincharlo, menú con "Duplicar proyecto" */}
          <ProjectMenu activeProject={activeProject} onOpenProject={onOpenProject} />
          <span style={{ width: 1, height: 18, background: C.border, margin: "0 8px" }} />
          {crumb(t("planning", lang),   "/planning",    path === "/planning")}
          {crumb(t("scheduling", lang), "/scheduling",  path === "/scheduling")}
          {crumb(t("rostering", lang),  "/rostering",   path === "/rostering")}
          {activeProject?.tipo !== "lineas" && crumb("Departure", "/departure", path === "/departure")}
          {crumb(t("control", lang),    "/control",     path === "/control")}
          {crumb(t("analytics", lang),  "/analytics",   path === "/analytics")}
        </>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {/* Quién más está conectado (su organización; el superadmin, todas) */}
        <OnlineUsers sesion={sesion} />
        {/* Historial de cambios de la organización */}
        <AuditButton sesion={sesion} activeProject={activeProject} />
        {/* Ayuda del módulo abierto: preguntas frecuentes con buscador */}
        <HelpButton sesion={sesion} path={path} tipo={activeProject?.tipo} />
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{sesion?.nombre}</div>
          <div style={{ fontSize: 11, color: C.dim }}>{roleLabel(sesion?.rol)}</div>
        </div>
        <button
          onClick={() => setLang(lang === "es" ? "en" : "es")}
          title="ES / EN"
          style={{
            padding: "4px 9px", borderRadius: 7, background: C.surface2,
            border: `1px solid ${C.border}`, color: C.muted, cursor: "pointer",
            fontSize: 10, fontWeight: 700, fontFamily: font, letterSpacing: .5,
            transition: "all .15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blue; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
        >{lang.toUpperCase()}</button>
        {RUTAS_CON_PROYECTO.includes(path) && (
          <button onClick={onFullscreen} title={t("fullscreen", lang)} style={{
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
        <AvatarPerfil sesion={sesion} size={30} onCerrarSesion={onLogout} />
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
const SIN_LISTA = [];

export function WorkspaceRouter() {
  const lang = useLang();
  const [path,          setPath]          = useState(window.location.pathname);
  const [sesion,        setSesion]        = useState(undefined); // undefined=cargando
  const [activeProject, setActiveProject] = useState(() => readLS("fc_active_project"));
  // flota y plantilla de la empresa, junto con la empresa de la que vienen
  // (al cambiar de empresa no se enseñan las de la anterior)
  const [vehDe,  setVehDe]  = useState({ org: null, lista: [] });
  const [trabDe, setTrabDe] = useState({ org: null, lista: [] });

  // Cada módulo se queda montado (visibility:hidden, no unmount) una vez
  // visitado, para que cambiar de pestaña sea instantáneo y no se pierda
  // estado — pero eso significa que TODOS sus listeners de Firestore (y,
  // en el caso de Analytics, todo el bundle de recharts) se cargaban y
  // quedaban corriendo en cuanto se abría un proyecto, aunque esa pestaña
  // no se llegara a visitar nunca en la sesión. Con 5 módulos a la vez
  // (Planning/Scheduling/Rostering/Control/Analytics) eso se notaba como
  // lentitud general de toda la app. Ahora cada uno se monta la PRIMERA
  // vez que se visita de verdad, y a partir de ahí se queda montado igual
  // que antes — Planning cuenta como visitado desde el principio porque
  // openProject() navega directamente ahí.
  const [visitedTabs, setVisitedTabs] = useState({ planning: true });
  const pestanaActual = path.slice(1);
  if (!visitedTabs[pestanaActual]) setVisitedTabs(v => (v[pestanaActual] ? v : { ...v, [pestanaActual]: true }));

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Firebase Auth — escuchar sesión.
  // getUserProfileSafe: justo después de iniciar sesión, la caché local de
  // Firestore puede no tener aún este documento — getDoc podría devolver
  // "no existe" desde una caché vacía/desactualizada antes de que
  // sincronice, cerrando la sesión que se acaba de abrir. Forzar servidor
  // evita esa carrera, pero con timeout — sin él, en mala cobertura la
  // pantalla de login se queda cargando para siempre.
  useEffect(() => {
    return onAuthStateChanged(auth, async user => {
      if (user) {
        try {
          const snap = await getUserProfileSafe(user.uid);
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

  // Historial de cambios: quién registra (esta sesión) y en qué proyecto
  useEffect(() => { setAuditUser(sesion); setErrorUser(sesion); }, [sesion]);
  // Planes antiguos sin conductorUid: los arregla quien gestiona rutas al entrar
  useEffect(() => { repararPlanesSinConductor(sesion).catch(e => console.warn("[planes] arreglo de planes antiguos:", e)); }, [sesion]);
  useEffect(() => { setAuditProject(activeProject); }, [activeProject]);
  // Los depots del proyecto abierto, en la lista de la empresa para fichar (fichaje-depots.js)
  useEffect(() => {
    const pid = activeProject?._id, org = sesion?.org_id;
    if (!pid || !org || activeProject?.concurso || !puedeUsarWorkspace(sesion?.rol)) return; // los depots de un concurso no son para fichar
    return onSnapshot(doc(db, "planning_depots", pid),
      s => sincronizarDepotsFichaje(org, pid, s.exists() ? s.data().depots || [] : []).catch(e => console.warn("[fichaje] depots:", e)),
      () => {});
  }, [activeProject?._id, activeProject?.concurso, sesion?.org_id, sesion?.rol]);

  // Presencia: esta sesión aparece como conectada a los de su organización.
  // Solo usuarios de oficina (la ubicación de los conductores ya se ve en
  // Control, y así cada empresa cabe en la cuota gratuita de Firestore).
  const enPresencia = !!sesion?.uid && puedeUsarWorkspace(sesion.rol);
  useEffect(() => {
    if (!enPresencia) return;
    return startPresence(sesion, "oficina");
  }, [sesion, enPresencia]);
  useEffect(() => {
    if (enPresencia) updatePresencePage(sesion.uid, path);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enPresencia, path]);

  // Auth guard (solo cuando ya terminó de cargar)
  useEffect(() => {
    if (sesion === undefined) return; // aún cargando
    if (!sesion && path !== "/login")  { go("/login"); return; }
    if (sesion  && path === "/login")  { go("/projects"); return; }
    if (sesion  && path === "/")       { go("/projects"); return; }
    // Field (conductor) no tiene ningún caso de uso en este workspace — vive
    // entero en /rutas /incidencias /inventario (App.jsx.jsx, otro árbol de
    // componentes por completo). Redirección dura (no go()) porque main.jsx
    // decide qué árbol montar (WorkspaceRouter/App/SuperAdminApp) una sola
    // vez al cargar la página según la URL inicial — go() solo cambiaría el
    // path dentro de este mismo árbol, sin llegar a montar App.jsx.jsx.
    if (sesion && !puedeUsarWorkspace(sesion.rol) && path !== "/rutas") {
      window.location.href = "/rutas";
      return;
    }
    if (sesion  && !activeProject && RUTAS_CON_PROYECTO.includes(path)) {
      go("/projects");
    }
    // un concurso no tiene Departure/Control/Analytics, ni la operativa los módulos del concurso
    if (sesion && activeProject?.concurso && RUTAS_SOLO_OPERATIVA.includes(path)) go("/planning");
    if (sesion && activeProject && !activeProject.concurso && RUTAS_CONCURSO.some(r => r[0] === path)) go("/planning");
  }, [sesion, activeProject, path]);

  // Superadmin may not have org_id — fall back to project's org, then project's _id.
  // Dentro de un concurso, su espacio aislado: los módulos leen y escriben ahí
  // (vehículos, plantilla, cuadrante, convenio) y la operativa no se toca.
  const enConcurso = !!activeProject?.concurso;
  const effectiveOrgId = (enConcurso ? activeProject.org_id : null) || sesion?.org_id || activeProject?.org_id || activeProject?._id || null;
  const espacio = enConcurso ? activeProject.org_id : null;
  const sesionModulos = useMemo(() => (espacio && sesion ? { ...sesion, org_id: espacio } : sesion), [sesion, espacio]);

  // Firestore: vehicles + workers filtrados por org_id
  useEffect(() => {
    if (!effectiveOrgId) return;
    const org = effectiveOrgId;
    const u1 = onSnapshot(
      query(collection(db, "scheduling_vehicles"), where("org_id", "==", org)),
      s => setVehDe({ org, lista: s.docs.map(d => ({ _id: d.id, ...d.data() })) }),
      () => setVehDe(v => ({ org, lista: v.org === org ? v.lista : [] }))
    );
    const u2 = onSnapshot(
      query(collection(db, "scheduling_workers"), where("org_id", "==", org)),
      s => setTrabDe({ org, lista: s.docs.map(d => ({ _id: d.id, ...d.data() })) }),
      () => setTrabDe(v => ({ org, lista: v.org === org ? v.lista : [] }))
    );
    return () => { u1(); u2(); };
  }, [effectiveOrgId]);
  const vehicles = vehDe.org === effectiveOrgId ? vehDe.lista : SIN_LISTA;
  const workers = trabDe.org === effectiveOrgId ? trabDe.lista : SIN_LISTA;
  const loadingV = !!effectiveOrgId && vehDe.org !== effectiveOrgId;
  const loadingW = !!effectiveOrgId && trabDe.org !== effectiveOrgId;

  function login(u) {
    setSesion(u); go("/projects");
  }
  async function logout() {
    flushAllAudit();
    await markOffline(sesion?.uid);
    await signOut(auth);
    setSesion(null); setActiveProject(null);
    clearLS("fc_active_project"); go("/login");
  }
  function openProject(p) {
    // un concurso empieza por sus documentos (el pliego)
    setActiveProject(p); writeLS("fc_active_project", p); go(p?.concurso ? "/documentos" : "/planning");
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
  // Tipo de operación del proyecto: "puntos" (por defecto) o "lineas"
  const esLineas = activeProject?.tipo === "lineas";

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
      {!fullscreen && <TopBar sesion={sesion} activeProject={activeProject} path={path} onLogout={logout} onFullscreen={() => setFullscreen(true)} onOpenProject={openProject} />}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>

        {/* /projects — unmounts when leaving (no heavy state to preserve) */}
        {path === "/projects" && (
          <div style={{ position: "absolute", inset: 0, overflowY: "auto" }}>
            <Suspense fallback={<LazyFallback />}>
              <TabProyectosLazy activeProject={activeProject} onOpenProject={openProject} orgId={sesion?.org_id} isSuperAdmin={sesion?.rol === "superadmin"} />
            </Suspense>
          </div>
        )}

        {/* /concursos — la lista de licitaciones (cada una con su espacio aislado) */}
        {path === "/concursos" && (
          <div style={{ position: "absolute", inset: 0, overflowY: "auto" }}>
            <Suspense fallback={<LazyFallback />}>
              <ConcursosPageLazy orgId={sesion?.org_id} onAbrir={openProject} />
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
              {(() => {
                const mapa = esLineas
                  ? <PlanningLineasLazy key={activeProject._id} projectId={activeProject._id} orgId={activeProject.org_id || effectiveOrgId} />
                  : <PlanningPageLazy
                      sesion={sesionModulos} onLogout={logout}
                      projectId={activeProject._id} embedded
                    />;
                // en un concurso, primero dimensionar por rendimientos (sin inventario); el mapa, en su pestaña
                return enConcurso ? <PlanningConcursoLazy concursoId={activeProject.concurso} mapa={mapa} irADocumentos={() => go("/documentos")} /> : mapa;
              })()}
            </Suspense>
          </div>
        )}

        {/* /scheduling — mounted on first visit, then kept mounted to preserve generated scenario state */}
        {activeProject && visitedTabs.scheduling && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            visibility: path === "/scheduling" ? "visible" : "hidden",
            pointerEvents: path === "/scheduling" ? "auto" : "none",
          }}>
            <Suspense fallback={<LazyFallback />}>
              {esLineas ? <SchedulingLineasLazy key={activeProject._id} projectId={activeProject._id} orgId={activeProject.org_id || effectiveOrgId} proyecto={activeProject.nombre} sesion={sesionModulos} /> : <SchedulingModuleWrapperLazy
                vehicles={vehicles} workers={workers}
                loadingV={loadingV} loadingW={loadingW}
                activeProject={activeProject} onProjectUpdate={updateProject}
                orgId={effectiveOrgId} sesion={sesionModulos}
              />}
            </Suspense>
          </div>
        )}

        {/* /rostering — mounted on first visit, then kept mounted like the
            others so its listeners stay connected instead of reconnecting
            from scratch every time you navigate back here. */}
        {activeProject && visitedTabs.rostering && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            visibility: path === "/rostering" ? "visible" : "hidden",
            pointerEvents: path === "/rostering" ? "auto" : "none",
          }}>
            <Suspense fallback={<LazyFallback />}>
              <RosteringPageLazy sesion={sesionModulos} embedded activeProject={activeProject} orgId={effectiveOrgId} />
            </Suspense>
          </div>
        )}

        {/* /departure (Despacho) — el día de hoy: ausencias, quién cubre y vehículos (proyectos de puntos) */}
        {activeProject && !enConcurso && visitedTabs.departure && !esLineas && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            visibility: path === "/departure" ? "visible" : "hidden",
            pointerEvents: path === "/departure" ? "auto" : "none",
          }}>
            <Suspense fallback={<LazyFallback />}>
              <DespachoPageLazy orgId={effectiveOrgId} workers={workers} vehicles={vehicles} />
            </Suspense>
          </div>
        )}

        {/* /control — mounted on first visit, then kept mounted so its
            Firestore listeners (planes, usuarios, ubicaciones_activas) stay
            connected in the background instead of tearing down and
            reconnecting from scratch — with hundreds of plans, that
            reconnect was the multi-second "blank screen" every time you
            navigated back here. */}
        {activeProject && !enConcurso && visitedTabs.control && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            visibility: path === "/control" ? "visible" : "hidden",
            pointerEvents: path === "/control" ? "auto" : "none",
          }}>
            <Suspense fallback={<LazyFallback />}>
              {esLineas
                ? <ControlLineasLazy key={activeProject._id} projectId={activeProject._id} orgId={activeProject.org_id || effectiveOrgId} />
                : <ControlPageLazy sesion={sesion} orgId={effectiveOrgId} embedded />}
            </Suspense>
          </div>
        )}

        {/* /analytics — mounted on first visit (not eagerly like before):
            its own planes/fichajes/incidencias listeners plus the whole
            recharts bundle were loading for every project open even when
            nobody ever clicked into Analytics. */}
        {/* Módulos propios de un concurso (Cálculo, Alternativas, Documentos, Resumen) */}
        {enConcurso && RUTAS_CONCURSO.map(([ruta, id]) => visitedTabs[id] && (
          <div key={id} style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            visibility: path === ruta ? "visible" : "hidden",
            pointerEvents: path === ruta ? "auto" : "none",
          }}>
            <Suspense fallback={<LazyFallback />}>
              {id === "documentos" ? <DocumentosConcursoLazy concurso={{ _id: activeProject.concurso }} />
                : id === "calculo" ? <CalculoConcursoLazy concursoId={activeProject.concurso} irA={go} />
                : id === "alternativas" ? <AlternativasConcursoLazy concursoId={activeProject.concurso} irA={go} />
                : <ResumenConcursoLazy concursoId={activeProject.concurso} irA={go} />}
            </Suspense>
          </div>
        ))}

        {activeProject && !enConcurso && visitedTabs.analytics && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            visibility: path === "/analytics" ? "visible" : "hidden",
            pointerEvents: path === "/analytics" ? "auto" : "none",
          }}>
            <Suspense fallback={<LazyFallback />}>
              {esLineas
                ? <AnalyticsLineasLazy key={activeProject._id} projectId={activeProject._id} orgId={activeProject.org_id || effectiveOrgId} />
                : <AnalyticsPageLazy sesion={sesion} orgId={effectiveOrgId} activeProject={activeProject} embedded />}
            </Suspense>
          </div>
        )}

        {/* Fullscreen exit button */}
        {fullscreen && (
          <button
            onClick={() => setFullscreen(false)}
            title={t("exitFullscreen", lang)}
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
            {t("exitFullscreen", lang)}
          </button>
        )}

      </div>
    </div>
  );
}
