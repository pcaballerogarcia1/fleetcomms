// «Cambiar mi contraseña» (menú de la foto, en la oficina y en la app del
// trabajador): la actual y la nueva, sin correo. Vale también para quien
// entra con un usuario sin correo. Si no recuerda la actual y tiene correo,
// se le manda el enlace.
import { CircleAlert, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { enviarCambioClave, esCorreoReal } from "../cambio-clave.js";
import { logAudit } from "../audit.js";
import { BotonCerrar } from "../ui/cerrar.jsx";
import { C } from "../tema.js";
import { CamposClaveNueva } from "./campos-clave.jsx";
import { cambiarMiClave, mensajeCambio } from "./cambiar.js";

export function CambiarClave({ sesion, onCerrar }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState({ clave: "", valida: false });
  const [estado, setEstado] = useState(null); // null | "guardando" | "ok" | { error } | { aviso }
  const datos = { email: sesion?.email, nombre: sesion?.nombre, apellidos: sesion?.apellidos };
  useEffect(() => {
    const esc = e => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCerrar]);

  async function guardar(e) {
    e.preventDefault();
    if (!actual) { setEstado({ error: "Escribe tu contraseña actual." }); return; }
    if (!nueva.valida) { setEstado({ error: "Revisa la contraseña nueva: tiene que ser segura y coincidir las dos veces." }); return; }
    if (nueva.clave === actual) { setEstado({ error: "La nueva tiene que ser distinta de la actual." }); return; }
    setEstado("guardando");
    try {
      await cambiarMiClave(actual, nueva.clave);
      logAudit({ modulo: "Cuenta", accion: "Cambió su contraseña", detalle: "" });
      setEstado("ok");
    } catch (err) { setEstado({ error: mensajeCambio(err) }); }
  }
  async function porCorreo() {
    try { const email = await enviarCambioClave(sesion.email); setEstado({ aviso: `Te hemos enviado un correo a ${email} con un enlace para poner una contraseña nueva (mira también en spam).` }); }
    catch (err) { setEstado({ error: err.message }); }
  }

  return (
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 16px 16px", overflowY: "auto" }}>
      <form role="dialog" aria-modal="true" aria-label="Cambiar mi contraseña" onClick={e => e.stopPropagation()} onSubmit={guardar}
        style={{ width: 400, maxWidth: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: "0 24px 64px rgba(0,0,0,0.45)", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <KeyRound size={18} color={C.blue} />
          <div style={{ flex: 1, fontSize: 17, fontWeight: 650, color: C.text }}>Cambiar mi contraseña</div>
          <BotonCerrar onClick={onCerrar} />
        </div>
        {estado === "ok" ? (
          <>
            <p role="status" style={{ fontSize: 15, color: C.green, lineHeight: 1.5, margin: "0 0 16px" }}>Listo: tu contraseña ha cambiado. La próxima vez entra con la nueva.</p>
            <button type="button" className="op-btn op-primario" style={{ width: "100%", height: 40 }} onClick={onCerrar}>Cerrar</button>
          </>
        ) : (
          <>
            <input type="text" autoComplete="username" value={sesion?.email || ""} readOnly hidden />
            <div style={{ marginBottom: 14 }}>
              <label className="op-label" htmlFor="clave-actual">Contraseña actual</label>
              <input id="clave-actual" className="op-input" type="password" autoComplete="current-password" autoFocus value={actual} onChange={e => setActual(e.target.value)} />
            </div>
            <CamposClaveNueva datos={datos} onCambio={setNueva} />
            {estado?.error && <div role="alert" style={{ display: "flex", gap: 8, color: C.red, fontSize: 13, margin: "12px 0 0", lineHeight: 1.45 }}><CircleAlert size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {estado.error}</div>}
            {estado?.aviso && <div role="status" style={{ color: C.green, fontSize: 13, margin: "12px 0 0", lineHeight: 1.45 }}>{estado.aviso}</div>}
            <button type="submit" className="op-btn op-primario" style={{ width: "100%", height: 40, marginTop: 16 }} disabled={estado === "guardando"}>
              {estado === "guardando" ? <><Loader2 size={15} className="op-girando" /> Cambiando…</> : "Cambiar contraseña"}
            </button>
            {esCorreoReal(sesion?.email) && (
              <button type="button" onClick={porCorreo} style={{ display: "block", margin: "12px auto 0", background: "none", border: "none", color: C.muted, fontSize: 13, textDecoration: "underline", cursor: "pointer" }}>
                ¿No recuerdas la actual? Te mandamos un enlace al correo
              </button>
            )}
          </>
        )}
      </form>
    </div>
  );
}
