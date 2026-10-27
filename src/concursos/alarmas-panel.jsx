// Lo que no cuadra (alarmas.js), para enseñarlo arriba de Cálculo, Alternativas y Resumen
import { CircleAlert, TriangleAlert } from "lucide-react";
import { C } from "../tema.js";

export function PanelAlarmas({ alarmas = [], irA, titulo }) {
  if (!alarmas.length) return null;
  const bloquea = alarmas.some(a => a.nivel === "bloquea");
  return (
    <div className="op-tarjeta" style={{ padding: "10px 14px", marginTop: 16, borderColor: bloquea ? "rgba(240,82,82,0.45)" : "rgba(245,184,74,0.45)" }}>
      <div style={{ fontSize: 13, fontWeight: 650, color: bloquea ? C.red : C.amber, marginBottom: 4 }}>
        {titulo || (bloquea ? "Antes de fiarte de estos números, hay que resolver esto" : "Revisa esto")}
      </div>
      {alarmas.map((a, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "4px 0", fontSize: 13, color: C.text, lineHeight: 1.45 }}>
          {a.nivel === "bloquea" ? <CircleAlert size={15} color={C.red} style={{ flexShrink: 0, marginTop: 1 }} /> : <TriangleAlert size={15} color={C.amber} style={{ flexShrink: 0, marginTop: 1 }} />}
          <span style={{ flex: 1 }}>{a.texto}</span>
          {a.ruta && irA && <button className="op-btn op-fantasma" style={{ height: 24, fontSize: 12 }} onClick={() => irA(a.ruta)}>Ir</button>}
        </div>
      ))}
    </div>
  );
}
