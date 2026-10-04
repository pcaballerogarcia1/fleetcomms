// Nombre del proyecto en la cabecera: al pincharlo, menú con "Duplicar
// proyecto" (ver project-copy.js).
import { useState, useEffect, useRef } from "react";
import { duplicarProyecto, nombreCopia } from "./project-copy.js";
import { logAudit } from "./audit.js";

const C = {
  bg: "#0f1623", card: "#172035", surface2: "#1e2d48", border: "rgba(88,130,225,0.22)",
  text: "#e2eeff", muted: "#8aa5cc", dim: "#4a5f82", blue: "#5c9bff", red: "#f87171",
};
const font = '"Inter","Segoe UI",system-ui,sans-serif';

export function ProjectMenu({ activeProject, onOpenProject }) {
  const [open, setOpen] = useState(false);
  const [modo, setModo] = useState("menu"); // menu | duplicar
  const [nombre, setNombre] = useState("");
  const [paso, setPaso] = useState(null);   // texto del avance mientras copia
  const [error, setError] = useState(null);
  const ref = useRef(null);
  const copiando = paso != null;

  useEffect(() => {
    if (!open) return;
    const fuera = e => { if (!copiando && ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === "Escape" && !copiando) setOpen(false); };
    document.addEventListener("mousedown", fuera);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fuera); window.removeEventListener("keydown", esc); };
  }, [open, copiando]);

  function abrir() {
    if (copiando) return;
    setModo("menu"); setError(null); setOpen(o => !o);
  }

  async function duplicar() {
    const n = nombre.trim();
    if (!n || copiando) return;
    setError(null); setPaso("Empezando…");
    try {
      const { proyecto, avisos } = await duplicarProyecto(activeProject, n, { onPaso: setPaso });
      logAudit({ modulo: "Proyectos", accion: "Duplicó un proyecto", detalle: `${activeProject.nombre} → ${n}`, projectId: proyecto._id, proyecto: n, orgId: proyecto.org_id });
      setPaso(null); setOpen(false);
      onOpenProject(proyecto);
      if (avisos.length) setTimeout(() => window.alert(`Proyecto duplicado como «${n}», con avisos:\n\n• ${avisos.join("\n• ")}`), 300);
    } catch (e) {
      console.error("duplicarProyecto:", e);
      setPaso(null);
      setError(`No se ha podido terminar la copia (${e?.message || e}). Si en Proyectos aparece «${n}» a medias, puedes eliminarlo y volver a intentarlo.`);
    }
  }

  if (!activeProject) return null;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={abrir} title="Opciones del proyecto" aria-expanded={open} style={{
        display: "flex", alignItems: "center", gap: 5, maxWidth: 220, padding: "3px 6px", borderRadius: 5,
        background: open ? C.surface2 : "none", border: `1px solid ${open ? C.border : "transparent"}`,
        color: C.muted, fontSize: 13, fontWeight: 500, fontFamily: font, cursor: "pointer",
      }}
        onMouseEnter={e => { e.currentTarget.style.color = C.text; e.currentTarget.style.background = C.surface2; }}
        onMouseLeave={e => { if (!open) { e.currentTarget.style.color = C.muted; e.currentTarget.style.background = "none"; } }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeProject.nombre}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {open && (
        <div role="menu" style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 2100, width: 300,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 14px 40px rgba(0,0,0,0.45)",
          padding: 8, fontFamily: font,
        }}>
          {modo === "menu" ? (
            <button role="menuitem" onClick={() => { setNombre(nombreCopia(activeProject.nombre)); setModo("duplicar"); }} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 7,
              background: "none", border: "none", color: C.text, fontSize: 12.5, fontFamily: font, cursor: "pointer", textAlign: "left",
            }}
              onMouseEnter={e => { e.currentTarget.style.background = C.surface2; }}
              onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
              </svg>
              <span>
                <div style={{ fontWeight: 600 }}>Duplicar proyecto</div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>Copia puntos, depósitos, horarios, precios y escenario</div>
              </span>
            </button>
          ) : (
            <form onSubmit={e => { e.preventDefault(); duplicar(); }} style={{ padding: 6 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, marginBottom: 8 }}>Duplicar «{activeProject.nombre}»</div>
              <label style={{ fontSize: 11, color: C.muted }}>Nombre de la copia</label>
              <input autoFocus value={nombre} disabled={copiando} onChange={e => setNombre(e.target.value)} style={{
                width: "100%", boxSizing: "border-box", marginTop: 4, background: C.bg, border: `1px solid ${C.border}`, color: C.text,
                borderRadius: 7, padding: "7px 9px", fontSize: 12.5, fontFamily: font, outline: "none",
              }} />
              <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.45, margin: "8px 0 10px" }}>
                No se copian los planes publicados en Rutas, los fichajes ni el historial de generaciones. Vehículos, trabajadores y cuadrantes son de toda la organización y la copia los usa igual.
              </div>
              {copiando && <div style={{ fontSize: 11.5, color: C.blue, marginBottom: 8 }}>{paso}</div>}
              {error && <div style={{ fontSize: 11.5, color: C.red, lineHeight: 1.4, marginBottom: 8 }}>{error}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" disabled={copiando} onClick={() => setModo("menu")} style={{
                  padding: "6px 12px", borderRadius: 7, background: "none", border: `1px solid ${C.border}`, color: C.muted,
                  fontSize: 12, fontFamily: font, cursor: copiando ? "default" : "pointer",
                }}>Cancelar</button>
                <button type="submit" disabled={copiando || !nombre.trim()} style={{
                  padding: "6px 14px", borderRadius: 7, border: "none", fontSize: 12, fontWeight: 700, fontFamily: font,
                  background: copiando || !nombre.trim() ? C.surface2 : C.blue, color: copiando || !nombre.trim() ? C.dim : "#fff",
                  cursor: copiando || !nombre.trim() ? "default" : "pointer",
                }}>{copiando ? "Duplicando…" : "Duplicar"}</button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
