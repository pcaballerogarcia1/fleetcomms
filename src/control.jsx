import { useState, useEffect, useMemo } from "react";
import { db } from "./firebase.js";
import { collection, query, where, onSnapshot, getCountFromServer, limit } from "firebase/firestore";
import { useLang, t } from "./i18n.js";
import { C, fmtMes, font, userName } from "./control/datos.js";
import { AvisoConductores } from "./control/aviso-conductores.jsx";
import { PanelFichajes } from "./control/fichajes.jsx";
import { MapaControl, MapaFlota } from "./control/mapas.jsx";
import { ActivityFeed, PlanCard } from "./control/planes.jsx";
import { alfa } from "./tema.js";

// ── MAIN PAGE ──────────────────────────────────────────────────────
export function ControlPage({ sesion, orgId: orgIdProp }) {
  const lang = useLang();
  const orgId = orgIdProp ?? sesion?.org_id ?? null;
  const isSuperAdmin = sesion?.rol === "superadmin";

  const [planes,      setPlanes]      = useState([]);
  const [usuarios,    setUsuarios]    = useState([]);
  const [selectedId,  setSelectedId]  = useState(null);
  const [mesesDisponibles, setMesesDisponibles] = useState([]);
  const [vista, setVista] = useState("planes"); // planes | flota
  const PAGE_SIZE = 60;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const now    = new Date();
  const curMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [mesFilter, setMesFilter] = useState(curMes);
  const PLANES_QUERY_LIMIT = 300;
  const [planesCapped, setPlanesCapped] = useState(false);

  // Real-time: planes — scoped to the selected month when one is chosen (the
  // common case) so we don't stream every plan ever created for the org on
  // every stop check-in. docChanges() keeps object refs stable for unchanged
  // plans, so the map/feed only re-render for the plan that actually changed.
  // limit() bounds how many full documents (each carrying an ubicaciones
  // array) Firestore has to fetch + the SDK has to decode every time this
  // listener (re)connects — without it, a month with 1000+ plans took ~11s
  // to show ANYTHING every single time you switched away from Control and
  // back, because the whole set was re-downloaded and re-decoded from
  // scratch on every mount.
  useEffect(() => {
    if (!orgId && !isSuperAdmin) return;
    const col = collection(db, "planes");
    const filters = [];
    if (orgId) filters.push(where("org_id", "==", orgId));
    if (mesFilter) filters.push(where("mes", "==", mesFilter));
    const q = query(col, ...filters, limit(PLANES_QUERY_LIMIT));
    const cache = new Map();
    return onSnapshot(q, snap => {
      snap.docChanges().forEach(change => {
        if (change.type === "removed") cache.delete(change.doc.id);
        else cache.set(change.doc.id, { _id: change.doc.id, ...change.doc.data() });
      });
      setPlanesCapped(snap.size >= PLANES_QUERY_LIMIT);
      setPlanes([...cache.values()]);
    });
  }, [orgId, isSuperAdmin, mesFilter]);

  // Meses con planes, para el selector. Antes se descargaban 500 planes
  // COMPLETOS (cada uno con todas sus paradas) solo para leer su campo
  // "mes": con proyectos grandes eran varios MB que el SDK tenía que
  // descodificar y guardar en caché en el hilo principal — medido: bloqueo
  // de 4,5 s al entrar en Control en un PC normal ("la página no
  // responde"). Ahora se cuenta cuántos planes hay en cada uno de los
  // últimos 24 meses y los 12 siguientes con getCountFromServer: devuelve solo
  // un número por mes, sin descargar ningún plan.
  useEffect(() => {
    if (!orgId && !isSuperAdmin) return;
    let cancelled = false;
    const col = collection(db, "planes");
    const base = orgId ? [where("org_id", "==", orgId)] : [];
    const now = new Date();
    const meses = [];
    for (let k = -24; k <= 12; k++) {
      const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
      meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    Promise.all(meses.map(m =>
      getCountFromServer(query(col, ...base, where("mes", "==", m)))
        .then(s => (s.data().count > 0 ? m : null))
        .catch(() => null)
    )).then(res => { if (!cancelled) setMesesDisponibles(res.filter(Boolean)); });
    return () => { cancelled = true; };
  }, [orgId, isSuperAdmin]);

  // Real-time: usuarios (for name resolution)
  useEffect(() => {
    if (!orgId && !isSuperAdmin) return;
    const col = collection(db, "usuarios");
    const q = orgId ? query(col, where("org_id", "==", orgId)) : col;
    return onSnapshot(q, snap => {
      setUsuarios(snap.docs.map(d => ({ _id: d.id, id: d.id, ...d.data() })));
    });
  }, [orgId, isSuperAdmin]);

  // Available months
  const meses = useMemo(() =>
    [...mesesDisponibles].sort((a, b) => b.localeCompare(a)),
    [mesesDisponibles]
  );

  // Planes filtered by month (exclude correctivos — they have no ubicaciones map)
  const filteredPlanes = useMemo(() =>
    planes.filter(p => p.tipo !== "corr" && (!mesFilter || p.mes === mesFilter))
      .sort((a, b) => (b.fechaSubida ?? 0) - (a.fechaSubida ?? 0)),
    [planes, mesFilter]
  );

  // Global stats
  const stats = useMemo(() => {
    const total = filteredPlanes.reduce((s, p) => s + (p.ubicaciones?.length || 0), 0);
    const done  = filteredPlanes.reduce((s, p) => s + (p.ubicaciones?.filter(u => u.realizado).length || 0), 0);
    return { planes: filteredPlanes.length, total, done, pct: total > 0 ? Math.round(done / total * 100) : 0 };
  }, [filteredPlanes]);

  // Selected plan
  const activePlan = selectedId ? filteredPlanes.find(p => p._id === selectedId) : null;

  // Activity feed: built from the selected plan, or all plans of the month.
  // Dependency is deliberately a single value that IS whichever source is
  // actually relevant (activePlan when one is selected, filteredPlanes
  // otherwise) — not both. Depending on both would recompute this on every
  // write to ANY plan in the month even while looking at one specific plan,
  // since filteredPlanes gets a new array reference on every such write.
  // That was rebuilding (and re-sorting) the whole events list — every stop
  // of the plan — on updates that had nothing to do with the open plan.
  const activityEvents = useMemo(() => {
    const source = activePlan ? [activePlan] : filteredPlanes;
    const events = [];
    source.forEach(plan => {
      (plan.ubicaciones || []).forEach(u => {
        if (u.realizado && u.realizadoEn) {
          events.push({ ...u, planNombre: plan.nombre || plan.archivo || "Plan" });
        }
      });
    });
    return events.sort((a, b) => b.realizadoEn - a.realizadoEn).slice(0, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlan ?? filteredPlanes]);

  const hasMapa = activePlan && (activePlan.ubicaciones || []).some(u => u.lat && u.lng);

  const pctColor = stats.pct === 100 ? C.green : stats.pct > 50 ? C.blue : stats.pct > 0 ? C.orange : C.dim;

  function exportCSV() {
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const fmtDate = ts => {
      if (!ts) return "";
      const d = new Date(typeof ts === "number" ? ts : ts.toMillis?.() ?? 0);
      return d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    };

    const header = ["Plan", "Mes", "Turno", "Orden", "Dirección", "Barrio", "Trabajador", "Fecha y hora", "Nota"];
    const rows = activityEvents.map(ev => [
      ev.planNombre,
      mesFilter || "",
      ev.turno ?? "",
      ev.orden ?? "",
      ev.calle ? `${ev.calle}${ev.num ? " " + ev.num : ""}` : (ev.pa ?? ""),
      ev.barri ?? "",
      userName(ev.realizadoPor, usuarios),
      fmtDate(ev.realizadoEn),
      ev.nota ?? "",
    ]);

    const csv = "﻿" + [header, ...rows].map(r => r.map(esc).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `control_actividad${mesFilter ? "_" + mesFilter : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: C.bg, fontFamily: font, overflow: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ padding: "14px 20px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 650, color: C.text, letterSpacing: "-0.02em" }}>Control</div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>Rutas del día, flota en el mapa y fichajes, en directo</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 2, background: C.surface2, borderRadius: 8, padding: 2 }}>
              {[["planes", t("planes", lang)], ["flota", t("mapaFlota", lang)], ["fichajes", t("fichajes", lang)]].map(([k, l]) => (
                <button key={k} onClick={() => setVista(k)} style={{
                  padding: "5px 11px", borderRadius: 4, border: "none", cursor: "pointer",
                  background: vista === k ? alfa(0.1) : "none",
                  color: vista === k ? C.text : C.muted,
                  fontSize: 11, fontWeight: vista === k ? 600 : 400, fontFamily: font,
                  transition: "all .12s",
                }}>{l}</button>
              ))}
            </div>
            {orgId && <AvisoConductores orgId={orgId} usuarios={usuarios} />}
            <select
              value={mesFilter}
              onChange={e => { setMesFilter(e.target.value); setSelectedId(null); setVisibleCount(PAGE_SIZE); }}
              style={{
                background: C.surface2, border: `1px solid ${C.border2}`,
                color: C.text, borderRadius: 8, padding: "5px 10px",
                fontSize: 12, fontFamily: font, cursor: "pointer", outline: "none",
              }}
            >
              <option value="">Todos los meses</option>
              {meses.map(m => <option key={m} value={m}>{fmtMes(m)}</option>)}
            </select>
            <button
              onClick={exportCSV}
              disabled={activityEvents.length === 0}
              title="Descargar actividad (.csv)"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "rgba(63,207,142,0.08)", border: "1px solid rgba(63,207,142,0.25)",
                color: C.green, borderRadius: 8, padding: "5px 12px",
                fontSize: 12, fontWeight: 600, cursor: activityEvents.length === 0 ? "not-allowed" : "pointer",
                opacity: activityEvents.length === 0 ? 0.4 : 1, fontFamily: font, transition: "all .15s",
              }}
              onMouseEnter={e => { if (activityEvents.length > 0) e.currentTarget.style.background = "rgba(63,207,142,0.16)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(63,207,142,0.08)"; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Excel
            </button>
          </div>
        </div>

        {/* Stat chips */}
        <div style={{ display: "flex", gap: 10 }}>
          {[
            { l: "Planes",           v: stats.planes, c: C.blue    },
            { l: "Paradas totales",  v: stats.total,  c: C.muted   },
            { l: "Completadas",      v: stats.done,   c: C.green   },
            { l: "Progreso global",  v: `${stats.pct}%`, c: pctColor },
          ].map(s => (
            <div key={s.l} className="op-tarjeta" style={{ padding: "12px 18px", flex: 1 }}>
              <div style={{ fontSize: 13, color: C.muted, fontWeight: 500 }}>{s.l}</div>
              <div style={{ fontSize: 20, fontWeight: 650, color: C.text, letterSpacing: "-0.02em", lineHeight: 1.15, marginTop: 3 }}>{s.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {vista === "flota" ? (
        <MapaFlota orgId={orgId} isSuperAdmin={isSuperAdmin} planes={planes} sesion={sesion} />
        ) : vista === "fichajes" ? (
        <PanelFichajes orgId={orgId} isSuperAdmin={isSuperAdmin} usuarios={usuarios} />
        ) : (
        <>
        {/* Left: plan list */}
        <div style={{
          width: 290, flexShrink: 0, borderRight: `1px solid ${C.border}`,
          overflowY: "auto", padding: "12px 12px",
        }}>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>
            {filteredPlanes.length}{planesCapped ? `+` : ""} planes
          </div>
          {planesCapped && (
            <div style={{ fontSize: 10, color: C.orange, background: "rgba(245,158,91,0.08)", border: "1px solid rgba(245,158,91,0.25)", borderRadius: 8, padding: "6px 8px", marginBottom: 10, lineHeight: 1.5 }}>
              Hay más de {PLANES_QUERY_LIMIT} planes este mes — se muestran los primeros {PLANES_QUERY_LIMIT}. Progreso global también es solo de estos.
            </div>
          )}
          {filteredPlanes.length === 0 && (
            <div style={{ color: C.dim, fontSize: 13, textAlign: "center", padding: "40px 0" }}>
              Sin planes para este mes
            </div>
          )}
          {filteredPlanes.slice(0, visibleCount).map(plan => (
            <PlanCard
              key={plan._id}
              plan={plan}
              selected={selectedId === plan._id}
              onSelect={setSelectedId}
            />
          ))}
          {filteredPlanes.length > visibleCount && (
            <button
              onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
              className="op-btn" style={{ width: "100%", marginTop: 4 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.text; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
            >
              Cargar {Math.min(PAGE_SIZE, filteredPlanes.length - visibleCount)} más ({filteredPlanes.length - visibleCount} restantes)
            </button>
          )}
        </div>

        {/* Right: map + feed */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Mini-map (only when selected plan has geo data) */}
          {hasMapa && (
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 600 }}>
                {activePlan.nombre || activePlan.archivo}
                <span style={{ fontWeight: 400, color: C.dim, marginLeft: 8 }}>
                  {(activePlan.ubicaciones || []).filter(u => u.realizado).length} / {(activePlan.ubicaciones || []).length} paradas
                </span>
              </div>
              <MapaControl
                ubicaciones={activePlan.ubicaciones}
                recorrido={activePlan.recorrido}
                height={260}
              />
            </div>
          )}

          {/* Activity feed */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
            <div style={{ fontSize: 10, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>
              {selectedId ? "Actividad del plan" : "Actividad global"} · {activityEvents.length} registros
            </div>
            <ActivityFeed events={activityEvents} usuarios={usuarios} />
          </div>

        </div>
        </>
        )}
      </div>
    </div>
  );
}
