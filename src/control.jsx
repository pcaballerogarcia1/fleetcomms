import { useState, useEffect, useRef, useMemo } from "react";
import { db } from "./firebase.js";
import { collection, query, where, onSnapshot, getDocs } from "firebase/firestore";

const C = {
  bg: "#0f1623", card: "#172035", surface2: "#1e2d48",
  border: "rgba(88,130,225,0.22)", border2: "rgba(88,130,225,0.40)",
  text: "#e2eeff", muted: "#8aa5cc", dim: "#4a5f82",
  blue: "#5c9bff", green: "#34d399", orange: "#fb923c", red: "#f87171",
};
const font = '"Inter","Segoe UI",system-ui,sans-serif';
const mono = '"JetBrains Mono","Fira Mono",monospace';

const BARRIO_PALETTE = [
  "#4f8ef7","#34d399","#fb923c","#f87171",
  "#a78bfa","#fbbf24","#f472b6","#22d3ee","#818cf8","#4ade80",
];
const _bc = {};
function barrioColor(b) {
  if (!b) return "#8b95a5";
  if (_bc[b]) return _bc[b];
  let h = 0;
  for (let i = 0; i < b.length; i++) h = (h * 31 + b.charCodeAt(i)) >>> 0;
  return (_bc[b] = BARRIO_PALETTE[h % BARRIO_PALETTE.length]);
}

function timeAgo(ts) {
  if (!ts) return "";
  const ms = typeof ts === "number" ? ts : (ts?.toMillis?.() ?? 0);
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "Ahora mismo";
  if (d < 3600) return `Hace ${Math.floor(d / 60)}min`;
  if (d < 86400) return `Hace ${Math.floor(d / 3600)}h`;
  return `Hace ${Math.floor(d / 86400)}d`;
}

function fmtMes(k) {
  try { return new Date(k + "-01").toLocaleDateString("es-ES", { month: "long", year: "numeric" }); }
  catch { return k; }
}

function userName(uid, usuarios) {
  const u = usuarios.find(x => x._id === uid || x.id === uid);
  if (!u) return uid?.slice(0, 6) ?? "?";
  return `${u.nombre ?? ""} ${(u.apellidos ?? "")[0] ?? ""}`.trim() || uid?.slice(0, 6);
}

// ── LEAFLET MINI-MAP (read-only, updates on ubicaciones change) ────
// Stops are drawn on a single canvas overlay instead of one Leaflet DOM
// marker per stop — with hundreds of paradas, recreating a DOM divIcon for
// every point on every real-time update (one driver check-in = full rebuild)
// was the main source of lag. The map is read-only (no marker click/popup),
// so canvas has no functional downside here.
function MapaControl({ ubicaciones, recorrido, height = 280 }) {
  const divRef      = useRef(null);
  const mapRef      = useRef(null);
  const polyRef      = useRef(null);
  const canvasRef    = useRef(null); // { canvas, draw }

  function ensureLeaflet(cb) {
    if (!document.getElementById("leaflet-css")) {
      const css = document.createElement("link");
      css.id = "leaflet-css"; css.rel = "stylesheet";
      css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(css);
    }
    if (window.L) { cb(); return; }
    const js = document.createElement("script");
    js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    js.onload = cb;
    document.head.appendChild(js);
  }

  function drawLayers() {
    const L = window.L;
    if (!L || !mapRef.current) return;
    const map = mapRef.current;

    if (polyRef.current) { try { map.removeLayer(polyRef.current); } catch {} polyRef.current = null; }
    if (recorrido && recorrido.length > 1) {
      const ll = recorrido.map(p => Array.isArray(p) ? p : [p.lat, p.lng]);
      polyRef.current = L.polyline(ll, { color: "#1e3a5f", weight: 2, opacity: 0.6, dashArray: "6,4" }).addTo(map);
    }

    if (canvasRef.current) {
      const { canvas, draw } = canvasRef.current;
      try { map.off("moveend zoomend viewreset resize", draw); } catch {}
      try { canvas.remove(); } catch {}
      canvasRef.current = null;
    }

    const pts = (ubicaciones || []).filter(u => u.lat && u.lng);
    if (pts.length === 0) return;

    const showLabels = pts.length <= 300; // order number inside the dot — skip when it'd just be visual noise
    const packed = pts.map(u => ({
      lat: u.lat, lng: u.lng, orden: u.orden,
      done: !!u.realizado,
      color: u.realizado ? C.green : barrioColor(u.barri),
    }));

    const PAD = 60;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;pointer-events:none;";
    map.getPanes().overlayPane.appendChild(canvas);

    function draw() {
      if (!canvas.parentNode || !mapRef.current) return;
      const sz = map.getSize();
      const topLeft = map.containerPointToLayerPoint([-PAD, -PAD]);
      L.DomUtil.setPosition(canvas, topLeft);
      canvas.width  = sz.x + 2 * PAD;
      canvas.height = sz.y + 2 * PAD;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      packed.forEach(p => {
        const cp = map.latLngToContainerPoint([p.lat, p.lng]);
        const x = cp.x + PAD, y = cp.y + PAD;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = p.done ? "#ffffff88" : p.color + "55";
        ctx.stroke();
        if (showLabels) {
          ctx.fillStyle = "#fff";
          ctx.font = `800 8px ${mono}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(p.orden ?? ""), x, y + 0.5);
        }
      });
    }

    draw();
    map.on("moveend zoomend viewreset resize", draw);
    canvasRef.current = { canvas, draw };

    map.invalidateSize();
    map.fitBounds(pts.map(u => [u.lat, u.lng]), { padding: [16, 16] });
  }

  function initMap() {
    if (!divRef.current || mapRef.current) return;
    const L = window.L;
    const pts = (ubicaciones || []).filter(u => u.lat && u.lng);
    const center = pts.length > 0 ? [pts[0].lat, pts[0].lng] : [39.57, 2.65];
    const map = L.map(divRef.current, { zoomControl: false, attributionControl: false }).setView(center, 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
    mapRef.current = map;
    drawLayers();
  }

  useEffect(() => {
    ensureLeaflet(() => {
      if (!mapRef.current) initMap();
      else drawLayers();
    });
  }, [ubicaciones]);

  // Destroy map instance on unmount to avoid canvas leaks
  useEffect(() => () => {
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
  }, []);

  return (
    <div style={{ borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}` }}>
      <div ref={divRef} style={{ height, background: "#131e35" }} />
      <div style={{ background: C.card, padding: "6px 12px", display: "flex", gap: 14, borderTop: `1px solid ${C.border}` }}>
        {[[C.green, "Realizada"], ["#8b95a5", "Pendiente"]].map(([color, label]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
            <span style={{ fontSize: 10, color: C.muted }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PLAN CARD ─────────────────────────────────────────────────────
function PlanCard({ plan, selected, onSelect }) {
  const ubs   = plan.ubicaciones || [];
  const total = ubs.length;
  const done  = ubs.filter(u => u.realizado).length;
  const pct   = total > 0 ? Math.round(done / total * 100) : 0;
  const color = pct === 100 ? C.green : pct > 50 ? C.blue : pct > 0 ? C.orange : C.dim;

  return (
    <div
      onClick={() => onSelect(plan._id === selected ? null : plan._id)}
      style={{
        background: selected ? C.surface2 : C.card,
        border: `1px solid ${selected ? C.blue + "55" : C.border}`,
        borderRadius: 10, padding: "12px 14px", cursor: "pointer",
        transition: "all .15s", marginBottom: 8,
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.borderColor = C.border2; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = C.border; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {plan.nombre || plan.archivo || "Plan"}
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
            {[plan.turno, plan.diaServicio, plan.mes].filter(Boolean).join(" · ")}
          </div>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: mono, marginLeft: 8, flexShrink: 0 }}>
          {pct}%
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: C.surface2, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2, transition: "width .5s" }} />
      </div>

      <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
        {[
          { l: "Total",  v: total,        c: C.muted   },
          { l: "Hechas", v: done,          c: C.green   },
          { l: "Pend.",  v: total - done,  c: total - done > 0 ? C.orange : C.dim },
        ].map(s => (
          <div key={s.l} style={{ fontSize: 10, color: s.c, fontFamily: mono }}>
            <span style={{ fontWeight: 700 }}>{s.v}</span>
            <span style={{ color: C.dim, marginLeft: 3 }}>{s.l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ACTIVITY FEED ─────────────────────────────────────────────────
function ActivityFeed({ events, usuarios }) {
  if (events.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: C.dim, fontSize: 13 }}>
        Sin actividad registrada
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {events.map((ev, i) => (
        <div key={i} style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderLeft: `3px solid ${C.green}`, borderRadius: 8, padding: "9px 12px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                {ev.calle ? `${ev.calle}${ev.num ? " " + ev.num : ""}` : (ev.pa || `Parada ${ev.orden}`)}
              </div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                {ev.planNombre}{ev.barri ? ` · ${ev.barri}` : ""}
              </div>
              {ev.nota && (
                <div style={{ fontSize: 10, color: C.dim, marginTop: 3, fontStyle: "italic" }}>"{ev.nota}"</div>
              )}
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 10, color: C.green, fontWeight: 600 }}>{timeAgo(ev.realizadoEn)}</div>
              <div style={{ fontSize: 10, color: C.dim, marginTop: 1 }}>{userName(ev.realizadoPor, usuarios)}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── MAIN PAGE ──────────────────────────────────────────────────────
export function ControlPage({ sesion, orgId: orgIdProp, embedded = false }) {
  const orgId = orgIdProp ?? sesion?.org_id ?? null;
  const isSuperAdmin = sesion?.rol === "superadmin";

  const [planes,      setPlanes]      = useState([]);
  const [usuarios,    setUsuarios]    = useState([]);
  const [selectedId,  setSelectedId]  = useState(null);
  const [mesesDisponibles, setMesesDisponibles] = useState([]);

  const now    = new Date();
  const curMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [mesFilter, setMesFilter] = useState(curMes);

  // Real-time: planes — scoped to the selected month when one is chosen (the
  // common case) so we don't stream every plan ever created for the org on
  // every stop check-in. docChanges() keeps object refs stable for unchanged
  // plans, so the map/feed only re-render for the plan that actually changed.
  useEffect(() => {
    if (!orgId && !isSuperAdmin) return;
    const col = collection(db, "planes");
    const filters = [];
    if (orgId) filters.push(where("org_id", "==", orgId));
    if (mesFilter) filters.push(where("mes", "==", mesFilter));
    const q = filters.length ? query(col, ...filters) : col;
    const cache = new Map();
    return onSnapshot(q, snap => {
      snap.docChanges().forEach(change => {
        if (change.type === "removed") cache.delete(change.doc.id);
        else cache.set(change.doc.id, { _id: change.doc.id, ...change.doc.data() });
      });
      setPlanes([...cache.values()]);
    });
  }, [orgId, isSuperAdmin, mesFilter]);

  // One-time (not real-time) fetch of which months have plans, to populate the
  // month picker without keeping a permanent listener on the whole org's history.
  useEffect(() => {
    if (!orgId && !isSuperAdmin) return;
    const col = collection(db, "planes");
    const q = orgId ? query(col, where("org_id", "==", orgId)) : col;
    getDocs(q).then(snap => {
      const set = new Set();
      snap.docs.forEach(d => { const m = d.data().mes; if (m) set.add(m); });
      setMesesDisponibles([...set]);
    }).catch(() => {});
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

  // Activity feed source: selected plan or global
  const feedSource = activePlan ? [activePlan] : filteredPlanes;
  const activityEvents = useMemo(() => {
    const events = [];
    feedSource.forEach(plan => {
      (plan.ubicaciones || []).forEach(u => {
        if (u.realizado && u.realizadoEn) {
          events.push({ ...u, planNombre: plan.nombre || plan.archivo || "Plan" });
        }
      });
    });
    return events.sort((a, b) => b.realizadoEn - a.realizadoEn).slice(0, 80);
  }, [feedSource]);

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
          <span style={{ fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase", fontWeight: 700 }}>
            Control · tiempo real
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              value={mesFilter}
              onChange={e => { setMesFilter(e.target.value); setSelectedId(null); }}
              style={{
                background: C.surface2, border: `1px solid ${C.border2}`,
                color: C.text, borderRadius: 7, padding: "5px 10px",
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
                background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)",
                color: C.green, borderRadius: 7, padding: "5px 12px",
                fontSize: 12, fontWeight: 600, cursor: activityEvents.length === 0 ? "not-allowed" : "pointer",
                opacity: activityEvents.length === 0 ? 0.4 : 1, fontFamily: font, transition: "all .15s",
              }}
              onMouseEnter={e => { if (activityEvents.length > 0) e.currentTarget.style.background = "rgba(52,211,153,0.16)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(52,211,153,0.08)"; }}
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
            <div key={s.l} style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
              padding: "8px 14px", flex: 1,
            }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.c, fontFamily: mono, lineHeight: 1 }}>{s.v}</div>
              <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Left: plan list */}
        <div style={{
          width: 290, flexShrink: 0, borderRight: `1px solid ${C.border}`,
          overflowY: "auto", padding: "12px 12px",
        }}>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
            {filteredPlanes.length} planes
          </div>
          {filteredPlanes.length === 0 && (
            <div style={{ color: C.dim, fontSize: 13, textAlign: "center", padding: "40px 0" }}>
              Sin planes para este mes
            </div>
          )}
          {filteredPlanes.map(plan => (
            <PlanCard
              key={plan._id}
              plan={plan}
              selected={selectedId === plan._id}
              onSelect={setSelectedId}
            />
          ))}
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
            <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
              {selectedId ? "Actividad del plan" : "Actividad global"} · {activityEvents.length} registros
            </div>
            <ActivityFeed events={activityEvents} usuarios={usuarios} />
          </div>

        </div>
      </div>
    </div>
  );
}
