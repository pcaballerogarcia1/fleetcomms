// Botón "Ayuda" de la cabecera: preguntas frecuentes del módulo abierto
// con buscador (contenido en help-content.js). Sin IA ni llamadas a
// servidores: funciona siempre y no envía nada.
import { useState, useEffect, useRef, useMemo } from "react";
import { TITULO, buscarAyuda } from "./help-content.js";

const C = {
  bg: "#0f1623", card: "#172035", surface2: "#1e2d48", border: "rgba(88,130,225,0.22)",
  text: "#e2eeff", muted: "#8aa5cc", dim: "#4a5f82", blue: "#5c9bff",
};
const font = '"Inter","Segoe UI",system-ui,sans-serif';
const RUTAS = { "/planning": "planning", "/scheduling": "scheduling", "/rostering": "rostering", "/control": "control", "/analytics": "analytics" };

export function HelpButton({ sesion, path, tipo }) {
  // En proyectos de "Líneas regulares", Planning y Scheduling tienen su propia ayuda
  const base = RUTAS[path];
  const modulo = tipo === "lineas" && (base === "planning" || base === "scheduling") ? `${base}_lineas` : base;
  const [open, setOpen] = useState(false);
  if (!sesion?.uid || !modulo) return null;
  return (
    <>
      <button onClick={() => setOpen(o => !o)} title={`Ayuda de ${TITULO[modulo]}`} style={{
        height: 30, padding: "0 10px", borderRadius: 7, background: open ? `${C.blue}22` : C.surface2,
        border: `1px solid ${open ? C.blue : C.border}`, color: open ? C.blue : C.muted, cursor: "pointer",
        display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontFamily: font, fontWeight: 600,
      }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blue; }}
        onMouseLeave={e => { if (!open) { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; } }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" />
        </svg>
        Ayuda
      </button>
      {open && <HelpPanel key={modulo} modulo={modulo} onClose={() => setOpen(false)} />}
    </>
  );
}

function HelpPanel({ modulo, onClose }) {
  const [texto, setTexto] = useState("");
  const [abierta, setAbierta] = useState(null);
  const inputRef = useRef(null);
  const resultados = useMemo(() => buscarAyuda(modulo, texto), [modulo, texto]);
  const deOtros = resultados.length > 0 && resultados[0].modulo !== modulo;

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-label={`Ayuda de ${TITULO[modulo]}`} style={{
      position: "fixed", top: 52, right: 12, bottom: 12, width: 400, maxWidth: "calc(100vw - 24px)", zIndex: 2000,
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
      display: "flex", flexDirection: "column", fontFamily: font, overflow: "hidden",
    }}>
      <div style={{ padding: "12px 14px 10px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.text }}>Ayuda · {TITULO[modulo]}</div>
          <button onClick={onClose} title="Cerrar (Esc)" style={{ background: "none", border: "none", color: C.muted, fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 2 }}>×</button>
        </div>
        <div style={{ position: "relative" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.dim} strokeWidth="2" style={{ position: "absolute", left: 10, top: 10 }}>
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            value={texto}
            onChange={e => { setTexto(e.target.value); setAbierta(null); }}
            placeholder="Busca: importar, sin asignar, fichajes…"
            style={{
              width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.border}`, color: C.text,
              borderRadius: 8, padding: "8px 10px 8px 30px", fontSize: 12.5, fontFamily: font, outline: "none",
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px 14px" }}>
        {resultados.length === 0 && (
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, padding: "14px 6px" }}>
            No hay nada en la ayuda sobre «{texto.trim()}». Prueba con otras palabras (por ejemplo, el nombre del botón).
          </div>
        )}
        {deOtros && (
          <div style={{ fontSize: 11, color: C.dim, padding: "6px 6px 4px" }}>No está en {TITULO[modulo]}; esto es de otros módulos:</div>
        )}
        {resultados.map(({ modulo: m, item }, i) => {
          const k = `${m}-${item.q}`;
          const open = abierta === k || (resultados.length === 1 && abierta === null);
          return (
            <div key={k} style={{ borderBottom: i < resultados.length - 1 ? `1px solid ${C.border}` : "none" }}>
              <button onClick={() => setAbierta(open ? "" : k)} aria-expanded={open} style={{
                width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer",
                padding: "10px 6px", display: "flex", gap: 8, alignItems: "flex-start", fontFamily: font,
              }}>
                <span style={{ color: C.blue, fontSize: 10, marginTop: 3, transform: open ? "rotate(90deg)" : "none", transition: "transform .12s" }}>▶</span>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: open ? C.text : "#c9d8f0", lineHeight: 1.4 }}>
                  {item.q}
                  {m !== modulo && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: C.dim }}>· {TITULO[m]}</span>}
                </span>
              </button>
              {open && (
                <div style={{ padding: "0 8px 12px 24px", fontSize: 12.5, color: C.muted, lineHeight: 1.55 }}>
                  <div>{item.a}</div>
                  {item.pasos?.length > 0 && (
                    <ol style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                      {item.pasos.map(p => <li key={p} style={{ margin: "3px 0" }}>{p}</li>)}
                    </ol>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
