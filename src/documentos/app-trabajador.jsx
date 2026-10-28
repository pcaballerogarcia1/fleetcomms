// App del trabajador → «Documentos»: los que le han mandado (ITs, DPTs…),
// los pendientes de leer primero; los abre y confirma «He leído y entendido».
import { useState } from "react";
import { Check, ChevronLeft, FileText, Loader2 } from "lucide-react";
import { C, S } from "../conductor/comun.js";
import { nombreCategoria } from "./datos.js";
import { abrirArchivo, marcarLeido } from "./store.js";

/** La tarjeta de la portada de la app (con los pendientes de leer) */
export function TarjetaDocumentos({ docs, onAbrir }) {
  if (!docs?.length) return null;
  const pendientes = docs.filter(d => !d.leido).length;
  return (
    <div onClick={onAbrir} role="button" style={{ ...S.card, cursor: "pointer", marginBottom: 18, borderColor: pendientes ? `${C.amber}66` : C.border }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: `${C.amber}18`, border: `1px solid ${C.amber}33`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: C.amber }}><FileText size={22} strokeWidth={1.8} /></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>Documentos</div>
          <div style={{ fontSize: 11, color: pendientes ? C.amber : C.muted }}>{pendientes ? `${pendientes} sin leer` : "Instrucciones y fichas de tu puesto"}</div>
        </div>
        <div style={{ fontSize: 20, color: C.border }}>›</div>
      </div>
    </div>
  );
}

export function PantallaDocumentos({ docs, sesion, onBack }) {
  const [abriendo, setAbriendo] = useState(null);
  const [vistos, setVistos] = useState(() => new Set());
  const [error, setError] = useState(null);
  async function abrir(d) {
    setAbriendo(d.id); setError(null);
    // la ventana se abre ya (si no, el móvil la bloquea) y luego se le pone el PDF
    const w = window.open("", "_blank");
    try {
      const url = await abrirArchivo(d);
      if (w) w.location.assign(url); else window.location.assign(url);
      setVistos(v => new Set(v).add(d.id));
    } catch (e) { if (w) w.close(); setError(e.message || String(e)); } finally { setAbriendo(null); }
  }
  return (
    <div style={{ paddingBottom: 80 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
        <button onClick={onBack} style={{ ...S.btnGhost, padding: "7px 10px" }} title="Volver"><ChevronLeft size={18} style={{ verticalAlign: "-4px" }} /></button>
        <div style={{ fontSize: 15, fontWeight: 650 }}>Documentos</div>
      </div>
      <div style={{ padding: "0 14px" }}>
        {error && <div style={{ fontSize: 13, color: C.red, marginBottom: 10 }}>{error}</div>}
        {docs === null ? <div style={{ color: C.dim, fontSize: 13 }}>Cargando…</div>
          : !docs.length ? <div style={{ color: C.dim, fontSize: 13 }}>No tienes documentos.</div>
          : docs.map(d => (
            <div key={d.id} style={{ ...S.card, borderColor: d.leido ? C.border : `${C.amber}66` }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{d.titulo}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{nombreCategoria(d.categoria)}{d.version > 1 ? ` · versión ${d.version}` : ""}</div>
              {d.descripcion && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{d.descripcion}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                <button style={{ ...S.btnGhost, flex: 1 }} onClick={() => abrir(d)} disabled={abriendo === d.id}>
                  {abriendo === d.id ? <Loader2 size={15} className="op-girando" style={{ verticalAlign: "-3px" }} /> : <FileText size={15} style={{ verticalAlign: "-3px", marginRight: 6 }} />}Abrir
                </button>
                {d.leido
                  ? <span style={{ flex: 1, fontSize: 13, color: C.green, display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}><Check size={16} />Leído</span>
                  : <button style={{ ...S.btnOk, flex: 1.4, opacity: vistos.has(d.id) ? 1 : 0.5 }} disabled={!vistos.has(d.id)} title={vistos.has(d.id) ? undefined : "Ábrelo primero"}
                      onClick={() => marcarLeido(d, sesion).catch(e => setError(e.message))}>He leído y entendido</button>}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
