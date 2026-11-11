// Pantalla para quien no puede usar Operanzia ahora: su empresa está
// suspendida o no tiene esa parte (p. ej. la app del conductor).
import { Ban, LogOut } from "lucide-react";
import { C } from "../tema.js";
import { Logo } from "./marca.jsx";

export const TEXTO_SUSPENDIDA = "El acceso de tu empresa a Operanzia está suspendido. Si crees que es un error, habla con el responsable de tu empresa o escribe a Operanzia.";

export function PantallaSinAcceso({ titulo = "Acceso suspendido", texto = TEXTO_SUSPENDIDA, onSalir }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "var(--font)" }}>
      <div role="alert" style={{ width: 420, maxWidth: "100%", textAlign: "center" }}>
        <Logo size={40} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 20, fontWeight: 650, color: C.text, margin: "16px 0 10px" }}><Ban size={18} color={C.red} /> {titulo}</div>
        <p style={{ fontSize: 15, color: C.muted, lineHeight: 1.55, margin: "0 0 22px" }}>{texto}</p>
        {onSalir && <button className="op-btn" onClick={onSalir}><LogOut size={15} /> Cerrar sesión</button>}
      </div>
    </div>
  );
}
