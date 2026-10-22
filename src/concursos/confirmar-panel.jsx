// Concursos → el aviso de «hay cosas leídas del pliego sin confirmar», con el
// botón para confirmarlas de una vez. Va arriba de Cálculo, Alternativas y
// Resumen: mientras falten, los números no salen de lo que dice el pliego.
import { CheckCheck, Loader2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { C } from "../tema.js";
import { confirmarLoLeido, pendientes } from "./confirmar.js";

export function AvisoLeido({ concursoId, docs, ficha, irA }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  if (!docs?.length || !ficha) return null;
  const p = pendientes(docs, ficha);
  if (!p.total) return null;
  const que = [p.datos.length ? `${p.datos.length} dato${p.datos.length === 1 ? "" : "s"} del contrato` : null, p.criterios ? "los criterios de adjudicación" : null, p.estudio ? "el estudio de costes del Ayuntamiento" : null].filter(Boolean).join(", ");
  async function confirmar() {
    setOcupado(true); setError(null);
    try { await confirmarLoLeido(concursoId, docs, ficha); } catch (e) { setError(e.message || String(e)); }
    setOcupado(false);
  }
  return (
    <div style={{ background: "rgba(245,184,74,0.08)", border: "1px solid rgba(245,184,74,0.35)", borderRadius: 12, padding: "10px 14px", margin: "14px 0 4px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <TriangleAlert size={16} color={C.amber} />
      <div style={{ flex: "1 1 320px", fontSize: 13, color: C.text, lineHeight: 1.5 }}>
        <b>Hay cosas leídas del pliego sin confirmar</b> ({que}). Mientras tanto, estos números usan valores por defecto.
        {error && <div style={{ color: C.red, fontSize: 12 }}>{error}</div>}
      </div>
      <button className="op-btn op-primario" disabled={ocupado} onClick={confirmar}>{ocupado ? <Loader2 size={14} className="op-girando" /> : <CheckCheck size={14} />} Confirmar todo lo leído</button>
      {irA && <button className="op-btn op-fantasma" onClick={() => irA("/documentos")}>Revisarlo uno a uno</button>}
    </div>
  );
}
