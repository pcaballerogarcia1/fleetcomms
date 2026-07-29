import { useState, useEffect, useMemo } from "react";
import { db } from "./firebase.js";
import { collection, query, where, onSnapshot, limit } from "firebase/firestore";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const C = {
  bg: "#0f1623", card: "#172035", surface2: "#1e2d48",
  border: "rgba(88,130,225,0.22)", border2: "rgba(88,130,225,0.40)",
  text: "#e2eeff", muted: "#8aa5cc", dim: "#4a5f82",
  blue: "#5c9bff", green: "#34d399", orange: "#fb923c", red: "#f87171", purple: "#a78bfa",
};
const font = '"Inter","Segoe UI",system-ui,sans-serif';
const mono = '"JetBrains Mono","Fira Mono",monospace';

const CATS_INCIDENCIA = [
  { label: "Avería mecánica", color: "#ef4444" },
  { label: "Accidente / Golpe", color: "#f97316" },
  { label: "Neumáticos", color: "#eab308" },
  { label: "Mantenimiento", color: "#3b82f6" },
  { label: "Comunicado general", color: "#8b5cf6" },
];
const PRIORIDAD_COLOR = { alta: C.red, media: C.orange, baja: C.green };

function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  return ts?.toMillis?.() ?? 0;
}
function fmtMes(k) {
  try { return new Date(k + "-01").toLocaleDateString("es-ES", { month: "long", year: "numeric" }); }
  catch { return k; }
}
function fmtDur(ms) {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${String(m).padStart(2, "0")}min`;
}

// ── UI building blocks ───────────────────────────────────────────
function KpiCard({ label, value, sub, color = C.blue }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: mono, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Panel({ title, height = 260, children, empty }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", flex: 1, minWidth: 320 }}>
      <div style={{ fontSize: 11, color: C.dim, letterSpacing: 1, textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>{title}</div>
      {empty ? (
        <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: C.dim, fontSize: 12 }}>
          Sin datos suficientes todavía
        </div>
      ) : (
        <div style={{ height }}>{children}</div>
      )}
    </div>
  );
}

const axisStyle = { fontSize: 10, fill: C.muted, fontFamily: font };
const tooltipStyle = { background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 8, fontSize: 12, fontFamily: font, color: C.text };

// ── MAIN PAGE ─────────────────────────────────────────────────────
export function AnalyticsPage({ sesion, orgId: orgIdProp }) {
  const orgId = orgIdProp ?? sesion?.org_id ?? null;
  const isSuperAdmin = sesion?.rol === "superadmin";

  const [vista, setVista] = useState("produccion"); // produccion | personal | varios
  const now = new Date();
  const curMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [mesFilter, setMesFilter] = useState(curMes);

  const [planes, setPlanes] = useState([]);
  const [fichajes, setFichajes] = useState([]);
  const [incidencias, setIncidencias] = useState([]);

  useEffect(() => {
    if (!orgId && !isSuperAdmin) return;
    const col = collection(db, "planes");
    const filters = [];
    if (orgId) filters.push(where("org_id", "==", orgId));
    filters.push(where("mes", "==", mesFilter));
    return onSnapshot(query(col, ...filters, limit(300)), snap => {
      setPlanes(snap.docs.map(d => ({ _id: d.id, ...d.data() })));
    }, () => {});
  }, [orgId, isSuperAdmin, mesFilter]);

  useEffect(() => {
    if (!orgId && !isSuperAdmin) return;
    const col = collection(db, "fichajes");
    const q = orgId ? query(col, where("org_id", "==", orgId), limit(1000)) : query(col, limit(1000));
    return onSnapshot(q, snap => setFichajes(snap.docs.map(d => ({ _id: d.id, ...d.data() }))), () => {});
  }, [orgId, isSuperAdmin]);

  useEffect(() => {
    if (!orgId && !isSuperAdmin) return;
    const col = collection(db, "incidencias");
    const q = orgId ? query(col, where("org_id", "==", orgId), limit(500)) : query(col, limit(500));
    return onSnapshot(q, snap => setIncidencias(snap.docs.map(d => ({ _id: d.id, ...d.data() }))), () => {});
  }, [orgId, isSuperAdmin]);

  const fichajesMes = useMemo(() => fichajes.filter(f => f.fecha?.startsWith(mesFilter)), [fichajes, mesFilter]);
  const incidenciasMes = useMemo(() =>
    incidencias.filter(i => { const d = new Date(toMillis(i.fecha)); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}` === mesFilter; }),
    [incidencias, mesFilter]
  );
  const planesReales = useMemo(() => planes.filter(p => p.tipo !== "corr"), [planes]);

  // ── PRODUCCIÓN ──
  const prod = useMemo(() => {
    const totalParadas = planesReales.reduce((s, p) => s + (p.ubicaciones?.length || 0), 0);
    const hechas = planesReales.reduce((s, p) => s + (p.ubicaciones?.filter(u => u.realizado).length || 0), 0);
    const pct = totalParadas > 0 ? Math.round(hechas / totalParadas * 100) : 0;
    const vehiculosActivos = new Set(planesReales.filter(p => (p.ubicaciones||[]).some(u=>u.realizado)).map(p => p.vehiculo || p.turno || p._id)).size;

    // Evolución diaria de paradas completadas
    const porDia = {};
    planesReales.forEach(p => (p.ubicaciones || []).forEach(u => {
      if (!u.realizado || !u.realizadoEn) return;
      const d = new Date(toMillis(u.realizadoEn));
      const k = `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
      porDia[k] = (porDia[k] || 0) + 1;
    }));
    const evolucionDiaria = Object.entries(porDia)
      .map(([dia, paradas]) => ({ dia, paradas, _sort: dia.split("/").reverse().join("") }))
      .sort((a, b) => a._sort.localeCompare(b._sort));

    // Top planes por % de progreso
    const topPlanes = planesReales
      .map(p => {
        const total = p.ubicaciones?.length || 0;
        const done = p.ubicaciones?.filter(u => u.realizado).length || 0;
        return { nombre: (p.nombre || p.archivo || "Plan").slice(0, 22), pct: total > 0 ? Math.round(done/total*100) : 0, total };
      })
      .filter(p => p.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    return { totalParadas, hechas, pct, vehiculosActivos, evolucionDiaria, topPlanes };
  }, [planesReales]);

  // ── PERSONAL ──
  const personal = useMemo(() => {
    const abiertosAhora = fichajes.filter(f => f.estado === "abierto").length;
    let horasMs = 0, kmTotal = 0;
    const porConductor = {};
    fichajesMes.forEach(f => {
      const nombre = f.nombre || f.matricula || "?";
      if (!porConductor[nombre]) porConductor[nombre] = { nombre, horasMs: 0, km: 0 };
      if (f.horaSalida) { const dur = f.horaSalida - f.horaEntrada; horasMs += dur; porConductor[nombre].horasMs += dur; }
      kmTotal += f.kmRecorridos || 0;
      porConductor[nombre].km += f.kmRecorridos || 0;
    });
    const ranking = Object.values(porConductor)
      .map(c => ({ nombre: c.nombre.length > 16 ? c.nombre.slice(0,16)+"…" : c.nombre, horas: +(c.horasMs/3600000).toFixed(1), km: +c.km.toFixed(0) }))
      .sort((a, b) => b.horas - a.horas)
      .slice(0, 10);

    // Evolución semanal de horas totales
    const porSemana = {};
    fichajesMes.forEach(f => {
      if (!f.horaSalida || !f.fecha) return;
      const d = new Date(f.fecha + "T00:00:00");
      const onejan = new Date(d.getFullYear(), 0, 1);
      const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
      const k = `Sem ${week}`;
      porSemana[k] = (porSemana[k] || 0) + (f.horaSalida - f.horaEntrada) / 3600000;
    });
    const evolucionSemanal = Object.entries(porSemana).map(([semana, horas]) => ({ semana, horas: +horas.toFixed(1) }));

    return {
      abiertosAhora, horas: fmtDur(horasMs), km: kmTotal.toFixed(0),
      mediaHoras: ranking.length ? (horasMs / 3600000 / ranking.length).toFixed(1) : "0",
      ranking, evolucionSemanal,
    };
  }, [fichajes, fichajesMes]);

  // ── VARIOS (incidencias) ──
  const varios = useMemo(() => {
    const abiertas = incidenciasMes.filter(i => i.estado === "abierta").length;
    const revision = incidenciasMes.filter(i => i.estado === "en revisión").length;
    const cerradas = incidenciasMes.filter(i => i.estado === "cerrada").length;
    const total = incidenciasMes.length;
    const pctResueltas = total > 0 ? Math.round(cerradas / total * 100) : 0;

    const porPrioridad = ["alta", "media", "baja"].map(p => ({
      name: p, value: incidenciasMes.filter(i => i.prioridad === p).length, color: PRIORIDAD_COLOR[p],
    })).filter(x => x.value > 0);

    const porCategoria = CATS_INCIDENCIA.map((c, i) => ({
      name: c.label, value: incidenciasMes.filter(i2 => i2.categoria === i).length, color: c.color,
    })).filter(x => x.value > 0);

    // Evolución semanal de incidencias abiertas
    const porSemana = {};
    incidenciasMes.forEach(i => {
      const d = new Date(toMillis(i.fecha));
      const onejan = new Date(d.getFullYear(), 0, 1);
      const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
      const k = `Sem ${week}`;
      porSemana[k] = (porSemana[k] || 0) + 1;
    });
    const evolucionSemanal = Object.entries(porSemana).map(([semana, incidencias2]) => ({ semana, incidencias: incidencias2 }));

    return { abiertas, revision, cerradas, total, pctResueltas, porPrioridad, porCategoria, evolucionSemanal };
  }, [incidenciasMes]);

  const meses = useMemo(() => {
    const set = new Set([curMes]);
    planes.forEach(p => p.mes && set.add(p.mes));
    fichajes.forEach(f => f.fecha && set.add(f.fecha.slice(0, 7)));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [planes, fichajes, curMes]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: C.bg, fontFamily: font, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase", fontWeight: 700 }}>
            Analytics · cuadros de mando
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 2, background: C.surface2, borderRadius: 7, padding: 2 }}>
              {[["produccion", "Producción"], ["personal", "Personal"], ["varios", "Varios"]].map(([k, l]) => (
                <button key={k} onClick={() => setVista(k)} style={{
                  padding: "5px 11px", borderRadius: 5, border: "none", cursor: "pointer",
                  background: vista === k ? C.blue : "none",
                  color: vista === k ? "#fff" : C.muted,
                  fontSize: 11, fontWeight: vista === k ? 600 : 400, fontFamily: font,
                  transition: "all .12s",
                }}>{l}</button>
              ))}
            </div>
            <select
              value={mesFilter}
              onChange={e => setMesFilter(e.target.value)}
              style={{
                background: C.surface2, border: `1px solid ${C.border2}`,
                color: C.text, borderRadius: 7, padding: "5px 10px",
                fontSize: 12, fontFamily: font, cursor: "pointer", outline: "none",
              }}
            >
              {meses.map(m => <option key={m} value={m}>{fmtMes(m)}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {vista === "produccion" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <KpiCard label="Paradas totales" value={prod.totalParadas} color={C.blue} />
              <KpiCard label="Completadas" value={prod.hechas} color={C.green} />
              <KpiCard label="% cumplimiento" value={`${prod.pct}%`} color={prod.pct === 100 ? C.green : prod.pct > 50 ? C.blue : C.orange} />
              <KpiCard label="Vehículos con actividad" value={prod.vehiculosActivos} color={C.purple} />
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Panel title="Paradas completadas por día" empty={prod.evolucionDiaria.length === 0}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={prod.evolucionDiaria}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="dia" tick={axisStyle} />
                    <YAxis tick={axisStyle} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="paradas" stroke={C.blue} strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </Panel>
              <Panel title="Progreso por plan (top 8 por tamaño)" empty={prod.topPlanes.length === 0}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={prod.topPlanes} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={axisStyle} unit="%" />
                    <YAxis type="category" dataKey="nombre" tick={axisStyle} width={120} />
                    <Tooltip contentStyle={tooltipStyle} formatter={v => `${v}%`} />
                    <Bar dataKey="pct" fill={C.green} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
            </div>
          </div>
        )}

        {vista === "personal" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <KpiCard label="Fichados ahora" value={personal.abiertosAhora} color={personal.abiertosAhora > 0 ? C.green : C.dim} />
              <KpiCard label="Horas del mes" value={personal.horas} color={C.blue} />
              <KpiCard label="Km del mes" value={personal.km} color={C.orange} />
              <KpiCard label="Media horas/conductor" value={`${personal.mediaHoras}h`} color={C.purple} />
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Panel title="Horas trabajadas por conductor (top 10)" empty={personal.ranking.length === 0}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={personal.ranking} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
                    <XAxis type="number" tick={axisStyle} unit="h" />
                    <YAxis type="category" dataKey="nombre" tick={axisStyle} width={110} />
                    <Tooltip contentStyle={tooltipStyle} formatter={v => `${v}h`} />
                    <Bar dataKey="horas" fill={C.blue} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
              <Panel title="Evolución de horas por semana" empty={personal.evolucionSemanal.length === 0}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={personal.evolucionSemanal}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="semana" tick={axisStyle} />
                    <YAxis tick={axisStyle} />
                    <Tooltip contentStyle={tooltipStyle} formatter={v => `${v}h`} />
                    <Line type="monotone" dataKey="horas" stroke={C.purple} strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </Panel>
            </div>
          </div>
        )}

        {vista === "varios" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <KpiCard label="Incidencias abiertas" value={varios.abiertas} color={C.red} />
              <KpiCard label="En revisión" value={varios.revision} color={C.orange} />
              <KpiCard label="Cerradas" value={varios.cerradas} color={C.green} />
              <KpiCard label="% resueltas" value={`${varios.pctResueltas}%`} color={C.blue} />
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Panel title="Incidencias por prioridad" height={240} empty={varios.porPrioridad.length === 0}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={varios.porPrioridad} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                      {varios.porPrioridad.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </Panel>
              <Panel title="Incidencias por categoría" height={240} empty={varios.porCategoria.length === 0}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={varios.porCategoria}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="name" tick={{ ...axisStyle, fontSize: 9 }} interval={0} angle={-20} textAnchor="end" height={50} />
                    <YAxis tick={axisStyle} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {varios.porCategoria.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
              <Panel title="Incidencias abiertas por semana" height={240} empty={varios.evolucionSemanal.length === 0}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={varios.evolucionSemanal}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="semana" tick={axisStyle} />
                    <YAxis tick={axisStyle} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="incidencias" stroke={C.red} strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </Panel>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
