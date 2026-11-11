// Los campos de «contraseña nueva» + «repítela», con el medidor de seguridad
// y lo que le falta. Los usan la página del enlace del correo y la ventana
// «Cambiar mi contraseña».
import { Check, Eye, EyeOff, X } from "lucide-react";
import { useState } from "react";
import { C } from "../tema.js";
import { valorarClave } from "./clave.js";

const COLORES = () => [C.red, C.red, C.amber, C.green, C.green];

export function MedidorClave({ clave, datos }) {
  if (!clave) return null;
  const v = valorarClave(clave, datos);
  const color = COLORES()[v.puntos];
  return (
    <div aria-live="polite" style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {[1, 2, 3, 4].map(i => <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= Math.max(1, v.puntos) ? color : "rgba(127,127,127,0.25)" }} />)}
      </div>
      <div style={{ fontSize: 12, color, marginTop: 5, fontWeight: 600 }}>Seguridad: {v.nivel}</div>
      {v.falta.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", display: "grid", gap: 3 }}>
          {v.falta.map(f => <li key={f} style={{ display: "flex", gap: 6, fontSize: 12, color: C.muted }}><X size={13} color={C.red} style={{ flexShrink: 0, marginTop: 1 }} /> {f}</li>)}
        </ul>
      )}
    </div>
  );
}

/** Contraseña nueva y repetida. onCambio({ clave, valida }) */
export function CamposClaveNueva({ datos, onCambio, autoFocus = false }) {
  const [clave, setClave] = useState("");
  const [otra, setOtra] = useState("");
  const [ver, setVer] = useState(false);
  const avisar = (a, b) => onCambio({ clave: a, valida: valorarClave(a, datos).ok && a === b });
  const coinciden = otra && clave === otra;
  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <label className="op-label" htmlFor="clave-nueva">Contraseña nueva</label>
        <div style={{ position: "relative" }}>
          <input id="clave-nueva" className="op-input" type={ver ? "text" : "password"} autoComplete="new-password" autoFocus={autoFocus} value={clave}
            onChange={e => { setClave(e.target.value); avisar(e.target.value, otra); }} style={{ paddingRight: 40 }} />
          <button type="button" onClick={() => setVer(v => !v)} aria-label={ver ? "Ocultar contraseña" : "Ver contraseña"} title={ver ? "Ocultar" : "Ver"}
            style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 6, display: "flex" }}>
            {ver ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <MedidorClave clave={clave} datos={datos} />
      </div>
      <div style={{ marginBottom: 6 }}>
        <label className="op-label" htmlFor="clave-repetida">Repite la contraseña nueva</label>
        <input id="clave-repetida" className="op-input" type={ver ? "text" : "password"} autoComplete="new-password" value={otra}
          onChange={e => { setOtra(e.target.value); avisar(clave, e.target.value); }} />
        {otra && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginTop: 6, color: coinciden ? C.green : C.red }}>
            {coinciden ? <><Check size={13} /> Coinciden</> : <><X size={13} /> No coinciden</>}
          </div>
        )}
      </div>
    </>
  );
}
