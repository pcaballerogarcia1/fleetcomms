// Recuadro para firmar con el dedo (o el ratón). Devuelve la firma como
// imagen JPEG con fondo blanco (pequeña: unos 15-30 KB).
import { useEffect, useRef, useState } from "react";
import { C, S } from "../conductor/comun.js";

export function PanelFirma({ onCambio, alto = 180 }) {
  const lienzo = useRef(null);
  const trazando = useRef(false);
  const [vacia, setVacia] = useState(true);

  // el lienzo, del ancho del recuadro y nítido en pantallas de alta densidad
  useEffect(() => {
    const c = lienzo.current;
    if (!c) return;
    const r = window.devicePixelRatio || 1;
    c.width = c.clientWidth * r; c.height = alto * r;
    const g = c.getContext("2d");
    g.scale(r, r);
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.lineWidth = 2.4; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#111";
  }, [alto]);

  const punto = e => { const b = lienzo.current.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  function empezar(e) {
    e.preventDefault();
    lienzo.current.setPointerCapture?.(e.pointerId);
    trazando.current = true;
    const g = lienzo.current.getContext("2d"), [x, y] = punto(e);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.1, y + 0.1); g.stroke();
  }
  function mover(e) {
    if (!trazando.current) return;
    e.preventDefault();
    const g = lienzo.current.getContext("2d"), [x, y] = punto(e);
    g.lineTo(x, y); g.stroke();
  }
  function acabar() {
    if (!trazando.current) return;
    trazando.current = false;
    setVacia(false);
    lienzo.current.toBlob(b => onCambio?.(b), "image/jpeg", 0.8);
  }
  function borrar() {
    const c = lienzo.current, g = c.getContext("2d");
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.restore();
    setVacia(true); onCambio?.(null);
  }

  return (
    <div>
      <div style={{ position: "relative", border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", background: "#fff" }}>
        <canvas ref={lienzo} aria-label="Firma" role="img" style={{ width: "100%", height: alto, display: "block", touchAction: "none", cursor: "crosshair" }}
          onPointerDown={empezar} onPointerMove={mover} onPointerUp={acabar} onPointerLeave={acabar} onPointerCancel={acabar} />
        {vacia && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#9aa4b2", fontSize: 13, pointerEvents: "none" }}>Firma aquí con el dedo</div>}
        <div style={{ position: "absolute", left: 16, right: 16, bottom: 34, borderBottom: "1px dashed #c4cad3", pointerEvents: "none" }} />
      </div>
      {!vacia && <button type="button" onClick={borrar} style={{ ...S.btnGhost, marginTop: 6, fontSize: 12 }}>Borrar y volver a firmar</button>}
    </div>
  );
}
