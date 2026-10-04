// Sección "Líneas" del panel de Planning para capas GTFS: buscador de
// líneas; al elegir una, el mapa muestra solo sus paradas y su recorrido.
import { useState, useMemo } from "react";

const C = {
  bg: "#0f1623", surface2: "#1e2d48", border: "rgba(88,130,225,0.22)",
  text: "#e2eeff", muted: "#8aa5cc", dim: "#4a5f82", blue: "#5c9bff",
};
const font = '"Inter","Segoe UI",system-ui,sans-serif';
const MAX_LISTA = 150;
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** grupos: [{ docId, capa, lineas }] · sel: { docId, id } | null */
export function LineasPanel({ grupos, sel, onSel, verTodas, setVerTodas }) {
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState("");
  const total = grupos.reduce((s, g) => s + g.lineas.length, 0);
  const lista = useMemo(() => {
    const t = norm(q).trim();
    return grupos.flatMap(g => g.lineas
      .filter(l => !t || norm(`${l.nombre} ${l.largo} ${l.agencia} ${l.tipo}`).includes(t))
      .map(l => ({ ...l, docId: g.docId, capa: g.capa })));
  }, [grupos, q]);
  if (!total) return null;

  return (
    <div style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "none", border: "none", cursor: "pointer", padding: "8px 12px 6px", color: C.dim, fontFamily: font,
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            style={{ transition: "transform .2s", transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}><polyline points="6 9 12 15 18 9" /></svg>
          <span style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>Líneas GTFS ({total})</span>
        </span>
        {sel && <span onClick={e => { e.stopPropagation(); onSel(null); }} style={{ fontSize: 10, color: C.blue }}>quitar filtro</span>}
      </button>
      {open && (
        <div style={{ padding: "0 12px 10px" }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar línea: 64, Termini, tranvía…" style={{
            width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.border}`, color: C.text,
            borderRadius: 7, padding: "6px 9px", fontSize: 12, fontFamily: font, outline: "none", marginBottom: 6,
          }} />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.muted, marginBottom: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={verTodas} onChange={e => setVerTodas(e.target.checked)} />
            Ver el recorrido de todas las líneas
          </label>
          <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            {lista.slice(0, MAX_LISTA).map(l => {
              const activa = sel?.docId === l.docId && sel?.id === l.id;
              return (
                <button key={`${l.docId}|${l.id}`} onClick={() => onSel(activa ? null : { docId: l.docId, id: l.id })} title={l.largo || l.nombre} style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "5px 6px", borderRadius: 6,
                  background: activa ? `${l.color}26` : "none", border: `1px solid ${activa ? l.color : "transparent"}`,
                  cursor: "pointer", fontFamily: font,
                }}>
                  <span style={{
                    minWidth: 34, padding: "2px 5px", borderRadius: 5, background: l.color, color: "#0b1220",
                    fontSize: 11, fontWeight: 800, textAlign: "center", flexShrink: 0,
                  }}>{l.nombre}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 11.5, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {l.largo || `${l.tipo}${l.agencia ? " · " + l.agencia : ""}`}
                    </div>
                    <div style={{ fontSize: 10, color: C.dim }}>
                      {l.viajes.toLocaleString("es-ES")} viajes · {l.paradas} paradas{l.primera ? ` · ${l.primera}–${l.ultima}` : ""}
                    </div>
                  </span>
                </button>
              );
            })}
            {lista.length === 0 && <div style={{ fontSize: 11, color: C.dim, padding: 6 }}>Ninguna línea coincide</div>}
            {lista.length > MAX_LISTA && <div style={{ fontSize: 10.5, color: C.dim, padding: 6 }}>…y {lista.length - MAX_LISTA} más: escribe para buscar</div>}
          </div>
        </div>
      )}
    </div>
  );
}
