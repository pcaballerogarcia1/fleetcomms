// «¿Has olvidado tu contraseña?» de las pantallas de entrada: manda el enlace
// para cambiarla al correo escrito en el campo de arriba.
import { useState } from "react";
import { enviarCambioClave } from "./cambio-clave.js";

export function OlvideClave({ texto, color = "#8b93a7", colorOk = "#3fcf8e", colorError = "#f26d6d" }) {
  const [estado, setEstado] = useState(null); // { ok, texto }
  const [enviando, setEnviando] = useState(false);
  async function pedir() {
    setEnviando(true); setEstado(null);
    try {
      const email = await enviarCambioClave(texto);
      setEstado({ ok: true, texto: `Si ${email} tiene cuenta, le llegará un correo con un enlace para poner una contraseña nueva (mira también en spam).` });
    } catch (e) { setEstado({ ok: false, texto: e.message }); }
    setEnviando(false);
  }
  return (
    <div style={{ textAlign: "center", marginTop: 14 }}>
      <button type="button" onClick={pedir} disabled={enviando} style={{ background: "none", border: "none", color, fontSize: 13, cursor: "pointer", textDecoration: "underline", padding: 0, fontFamily: "inherit" }}>
        {enviando ? "Enviando…" : "¿Has olvidado tu contraseña?"}
      </button>
      {estado && <div role="status" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.5, color: estado.ok ? colorOk : colorError }}>{estado.texto}</div>}
    </div>
  );
}
