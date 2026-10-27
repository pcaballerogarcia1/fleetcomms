// Un «?» pequeño junto a un título: la explicación larga se ve al pasar el
// ratón o al tocarlo, en vez de ocupar la pantalla debajo de cada ajuste.
import { CircleHelp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { C, SOMBRA } from "../tema.js";

export function Ayuda({ texto, ancho = 300 }) {
  const [abierta, setAbierta] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!abierta) return;
    const fuera = e => { if (ref.current && !ref.current.contains(e.target)) setAbierta(false); };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [abierta]);
  if (!texto) return null;
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex", verticalAlign: "-2px", marginLeft: 5 }}
      onMouseEnter={() => setAbierta(true)} onMouseLeave={() => setAbierta(false)}>
      <button type="button" aria-label="Ayuda" onClick={e => { e.stopPropagation(); setAbierta(a => !a); }}
        style={{ background: "none", border: "none", padding: 0, cursor: "help", color: abierta ? C.blue : C.dim, display: "inline-flex" }}>
        <CircleHelp size={13} />
      </button>
      {abierta && (
        <span role="tooltip" style={{
          position: "absolute", top: 20, left: -8, zIndex: 50, width: ancho, padding: "9px 11px",
          background: C.card, border: `1px solid ${C.border2}`, borderRadius: 8, boxShadow: SOMBRA.m,
          fontSize: 12, lineHeight: 1.5, color: C.muted, fontWeight: 400, whiteSpace: "normal", textTransform: "none", letterSpacing: 0,
        }}>{texto}</span>
      )}
    </span>
  );
}
