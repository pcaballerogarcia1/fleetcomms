// Botón "Historial" de la cabecera y panel con quién cambió qué y cuándo
// (ver audit.js). Solo usuarios de oficina de la organización; el
// superadmin ve todas.
import { useState, useEffect, useMemo } from "react";
import { watchAudit } from "./audit.js";

const C = {
  bg: "#0f1623", card: "#172035", surface2: "#1e2d48", border: "rgba(88,130,225,0.22)",
  text: "#e2eeff", muted: "#8aa5cc", dim: "#4a5f82", blue: "#5c9bff",
};
const font = '"Inter","Segoe UI",system-ui,sans-serif';
const LIMIT = 300;
const MOD_COLOR = {
  Scheduling: "#5c9bff", Rostering: "#a78bfa", Planning: "#34d399", Proyectos: "#fbbf24",
  Flota: "#fb923c", Plantilla: "#f472b6",
};

function cuando(ms, now) {
  if (!ms) return "";
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  const d = new Date(ms), hoy = new Date(now);
  const hh = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === hoy.toDateString()) return `hoy ${hh}`;
  return `${d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" })} ${hh}`;
}

export function AuditButton({ sesion, activeProject }) {
  const [open, setOpen] = useState(false);
  if (!sesion?.uid) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} title="Historial de cambios: quién hizo qué y cuándo" style={{
        height: 30, padding: "0 10px", borderRadius: 7, background: C.surface2,
        border: `1px solid ${C.border}`, color: C.muted, cursor: "pointer",
        display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontFamily: font, fontWeight: 600,
      }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blue; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" />
        </svg>
        Historial
      </button>
      {open && <AuditPanel sesion={sesion} activeProject={activeProject} onClose={() => setOpen(false)} />}
    </>
  );
}

function AuditPanel({ sesion, activeProject, onClose }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [modulo, setModulo] = useState("");
  const [soloProyecto, setSoloProyecto] = useState(false);
  const [texto, setTexto] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => watchAudit(sesion, LIMIT, (list, err) => { if (err) setError(err); else setRows(list); }), [sesion]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const modulos = useMemo(() => [...new Set((rows || []).map(r => r.modulo).filter(Boolean))].sort(), [rows]);
  const visibles = useMemo(() => {
    const q = texto.trim().toLowerCase();
    return (rows || []).filter(r =>
      (!modulo || r.modulo === modulo) &&
      (!soloProyecto || r.projectId === activeProject?._id) &&
      (!q || `${r.nombre} ${r.accion} ${r.detalle} ${r.proyecto || ""}`.toLowerCase().includes(q)));
  }, [rows, modulo, soloProyecto, texto, activeProject?._id]);

  const input = { background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: "6px 9px", fontSize: 12, fontFamily: font, outline: "none" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.45)" }}>
      <div onClick={e => e.stopPropagation()} style={{
        position: "absolute", top: 0, right: 0, bottom: 0, width: "min(520px, 100vw)",
        background: C.card, borderLeft: `1px solid ${C.border}`, boxShadow: "-12px 0 40px rgba(0,0,0,0.4)",
        display: "flex", flexDirection: "column", fontFamily: font,
      }}>
        <div style={{ padding: "16px 18px 10px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Historial de cambios</div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: C.dim, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
          </div>
          <div style={{ fontSize: 11, color: C.muted, margin: "4px 0 10px" }}>
            Quién hizo qué y cuándo{sesion.rol === "superadmin" ? " (todas las organizaciones)" : " en tu organización"}. Últimos {LIMIT} cambios; las ediciones seguidas se agrupan por minuto.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Buscar persona, acción…" style={{ ...input, flex: 1, minWidth: 150 }} />
            <select value={modulo} onChange={e => setModulo(e.target.value)} style={input}>
              <option value="">Todos los módulos</option>
              {modulos.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {activeProject && (
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: C.muted, cursor: "pointer" }}>
                <input type="checkbox" checked={soloProyecto} onChange={e => setSoloProyecto(e.target.checked)} />
                Solo «{activeProject.nombre}»
              </label>
            )}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 10px 16px" }}>
          {error ? (
            <div style={{ padding: 20, fontSize: 12, color: "#f87171" }}>No se pudo cargar el historial ({error.code || String(error)}).</div>
          ) : rows === null ? (
            <div style={{ padding: 20, fontSize: 12, color: C.dim }}>Cargando…</div>
          ) : visibles.length === 0 ? (
            <div style={{ padding: 20, fontSize: 12, color: C.dim }}>
              {rows.length ? "Ningún cambio con estos filtros." : "Todavía no hay cambios registrados. A partir de ahora aparecerá aquí cada acción importante."}
            </div>
          ) : visibles.map(r => (
            <div key={r._id} style={{ display: "flex", gap: 10, padding: "9px 8px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ width: 4, borderRadius: 2, background: MOD_COLOR[r.modulo] || C.dim, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: C.text }}>
                  <b style={{ fontWeight: 600 }}>{r.nombre}</b> <span style={{ color: C.muted }}>{r.accion?.charAt(0).toLowerCase() + r.accion?.slice(1)}</span>
                </div>
                {r.detalle && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2, wordBreak: "break-word" }}>{r.detalle}</div>}
                <div style={{ fontSize: 10.5, color: C.dim, marginTop: 3 }}>
                  {[r.modulo, r.proyecto, cuando(r.atMs, now)].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
