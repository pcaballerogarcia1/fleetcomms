// Círculos con las iniciales de quién está conectado (cabecera del
// workspace). Ver presence.js.
import { useState, useEffect, useRef } from "react";
import { watchPresence, onlineFrom, orgNames, initialsOf, haceCuanto } from "./presence.js";
import { roleLabel } from "./roles.js";

const GREEN = "#3fcf8e";
const C = {
  card: "#12151c", surface2: "#181c25", border: "rgba(255,255,255,0.08)",
  text: "#e6e8ee", muted: "#9aa3b2", dim: "#5d6574",
};
const font = "var(--font)";
const MAX_VISIBLE = 5;

const PAGINAS = {
  "/projects": "Proyectos", "/planning": "Planning", "/scheduling": "Scheduling",
  "/rostering": "Rostering", "/control": "Control", "/analytics": "Analytics",
  "/rutas": "App Rutas", "/incidencias": "App Rutas · Incidencias", "/inventario": "App Rutas · Inventario",
};
const donde = p => PAGINAS[p.pagina] || (p.app === "rutas" ? "App Rutas" : "Oficina");
const nombreCompleto = p => [p.nombre, p.apellidos].filter(Boolean).join(" ") || "Usuario";

function Avatar({ p, size = 28, ring = C.card, style }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: "rgba(63,207,142,0.16)", border: `1.5px solid ${GREEN}`,
      boxShadow: `0 0 0 2px ${ring}`, color: GREEN,
      fontSize: size <= 28 ? 10 : 11, fontWeight: 700, fontFamily: font,
      display: "flex", alignItems: "center", justifyContent: "center", ...style,
    }}>{initialsOf(p)}</div>
  );
}

export function OnlineUsers({ sesion }) {
  const [docs, setDocs] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState({});
  const boxRef = useRef(null);
  const isSA = sesion?.rol === "superadmin";

  useEffect(() => watchPresence(sesion, setDocs), [sesion]);
  // Recalcula cada 30 s quién ha dejado de latir
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  useEffect(() => { if (isSA) orgNames().then(setOrgs).catch(() => {}); }, [isSA]);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const list = onlineFrom(docs, now, sesion?.uid);
  if (!list.length) return null;
  const visible = list.slice(0, MAX_VISIBLE);
  const extra = list.length - visible.length;
  const tip = p => [nombreCompleto(p), roleLabel(p.rol), donde(p), isSA ? orgs[p.org_id] : null].filter(Boolean).join(" · ");

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={`${list.length} conectado${list.length === 1 ? "" : "s"} ahora`}
        style={{ display: "flex", alignItems: "center", background: "none", border: "none", padding: 0, cursor: "pointer" }}
      >
        {visible.map((p, i) => (
          <div key={p.uid} title={tip(p)} style={{ marginLeft: i ? -7 : 0, zIndex: MAX_VISIBLE - i }}>
            <Avatar p={p} />
          </div>
        ))}
        {extra > 0 && (
          <div style={{
            marginLeft: -7, width: 28, height: 28, borderRadius: "50%", background: C.surface2,
            border: `1.5px solid ${GREEN}`, boxShadow: `0 0 0 2px ${C.card}`, color: GREEN,
            fontSize: 10, fontWeight: 700, fontFamily: font, display: "flex", alignItems: "center", justifyContent: "center",
          }}>+{extra}</div>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: 36, right: 0, zIndex: 1000, width: 290, maxHeight: 380, overflowY: "auto",
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
          boxShadow: "0 12px 32px rgba(0,0,0,0.45)", fontFamily: font, padding: 6,
        }}>
          <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: .8, fontWeight: 700, padding: "6px 8px 8px" }}>
            Conectados ahora · {list.length}
          </div>
          {list.map(p => (
            <div key={p.uid} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", borderRadius: 7 }}>
              <Avatar p={p} size={30} ring="transparent" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, color: C.text, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {nombreCompleto(p)}
                </div>
                <div style={{ fontSize: 10.5, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {[roleLabel(p.rol), donde(p), isSA ? orgs[p.org_id] : null].filter(Boolean).join(" · ")}
                </div>
              </div>
              <span style={{ fontSize: 10, color: C.dim, flexShrink: 0 }}>{haceCuanto(p.lastSeen, now)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
