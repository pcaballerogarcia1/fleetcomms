// /cuenta/clave — la página a la que lleva el enlace de los correos de la
// cuenta (en Firebase › Authentication › Plantillas, «URL de acción»). Con el
// diseño de Operanzia y en español:
//  - resetPassword: poner una contraseña nueva (segura) y entrar directamente;
//  - verifyEmail / recoverEmail: confirmar el correo o deshacer un cambio de correo.
import { CircleAlert, KeyRound, Loader2, MailCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { applyActionCode, checkActionCode, confirmPasswordReset, signInWithEmailAndPassword, verifyPasswordResetCode } from "firebase/auth";
import { auth, getUserProfileSafe } from "../firebase.js";
import { usuarioDeCorreo } from "../acceso-app.js";
import { Logo } from "../ui/marca.jsx";
import { C, alfa, tono } from "../tema.js";
import { destinoTras, leerAccion } from "./clave.js";
import { CamposClaveNueva } from "./campos-clave.jsx";

const ERRORES = {
  "auth/expired-action-code": "Este enlace ha caducado. Pide otro desde «¿Has olvidado tu contraseña?».",
  "auth/invalid-action-code": "Este enlace ya se ha usado o no es válido. Pide otro desde «¿Has olvidado tu contraseña?».",
  "auth/user-disabled": "Esta cuenta está desactivada. Habla con tu empresa.",
  "auth/user-not-found": "Esta cuenta ya no existe. Habla con tu empresa.",
  "auth/weak-password": "La contraseña no es segura: prueba con otra más larga.",
  "auth/network-request-failed": "Sin conexión. Revisa internet y vuelve a probar.",
};
const mensaje = e => ERRORES[e?.code] || "Algo ha fallado. Vuelve a probar en un momento o pide otro enlace.";

function Caja({ titulo, Icono = KeyRound, children }) {
  return (
    <div style={{ minHeight: "100vh", background: `radial-gradient(900px 520px at 50% -10%, rgba(91,124,250,0.16), transparent 70%), ${C.bg}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font)", padding: 16 }}>
      <div style={{ width: 400, maxWidth: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 22 }}>
          <Logo size={40} />
          <h1 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 20, fontWeight: 650, color: C.text, margin: "14px 0 0" }}><Icono size={18} color={C.blue} /> {titulo}</h1>
        </div>
        <div style={{ background: tono("rgba(18,21,28,0.85)", "rgba(255,255,255,0.9)"), border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, boxShadow: `0 24px 64px rgba(0,0,0,.35), inset 0 1px 0 ${alfa(0.04)}` }}>{children}</div>
      </div>
    </div>
  );
}
const Error_ = ({ children }) => <div role="alert" style={{ display: "flex", gap: 8, color: C.red, fontSize: 14, lineHeight: 1.5 }}><CircleAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{children}</span></div>;
const Cargando = () => <div style={{ display: "flex", justifyContent: "center", padding: 16, color: C.muted }}><Loader2 size={20} className="op-girando" /></div>;
const IrAEntrar = () => (
  <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
    <a className="op-btn" style={{ flex: 1, justifyContent: "center", textDecoration: "none" }} href="/login">Entrar en la oficina</a>
    <a className="op-btn" style={{ flex: 1, justifyContent: "center", textDecoration: "none" }} href="/rutas">Entrar en la app</a>
  </div>
);

function NuevaClave({ codigo, continuar }) {
  const [email, setEmail] = useState(undefined); // undefined: comprobando el enlace
  const [error, setError] = useState(null);
  const [nueva, setNueva] = useState({ clave: "", valida: false });
  const [estado, setEstado] = useState(null); // null | "guardando" | "entrando"
  useEffect(() => { verifyPasswordResetCode(auth, codigo).then(setEmail, e => { setEmail(null); setError(mensaje(e)); }); }, [codigo]);

  async function guardar(e) {
    e.preventDefault();
    if (!nueva.valida) { setError("Revisa la contraseña: tiene que ser segura y coincidir las dos veces."); return; }
    setError(null); setEstado("guardando");
    try { await confirmPasswordReset(auth, codigo, nueva.clave); }
    catch (err) { setError(mensaje(err)); setEstado(null); return; }
    // y entra directamente, a la pantalla de su rol
    setEstado("entrando");
    try {
      const cred = await signInWithEmailAndPassword(auth, email, nueva.clave);
      const p = await getUserProfileSafe(cred.user.uid).catch(() => null);
      window.location.assign(destinoTras(continuar, p?.exists?.() ? p.data().rol : null, window.location.origin));
    } catch { setEstado("hecho"); }
  }

  if (email === undefined) return <Caja titulo="Contraseña nueva"><Cargando /></Caja>;
  if (!email) return <Caja titulo="Contraseña nueva"><Error_>{error}</Error_><IrAEntrar /></Caja>;
  if (estado === "hecho") return <Caja titulo="Contraseña cambiada"><p role="status" style={{ color: C.green, fontSize: 15, margin: 0 }}>Listo: ya puedes entrar con tu contraseña nueva.</p><IrAEntrar /></Caja>;
  return (
    <Caja titulo="Contraseña nueva">
      <form onSubmit={guardar}>
        <p style={{ margin: "0 0 18px", fontSize: 14, color: C.muted, lineHeight: 1.5 }}>Para <b style={{ color: C.text }}>{usuarioDeCorreo(email)}</b>. Elige una que no uses en otros sitios.</p>
        <input type="text" autoComplete="username" value={email} readOnly hidden />
        <CamposClaveNueva datos={{ email }} onCambio={setNueva} autoFocus />
        {error && <div style={{ marginTop: 12 }}><Error_>{error}</Error_></div>}
        <button type="submit" className="op-btn op-primario" style={{ width: "100%", height: 42, fontSize: 14, marginTop: 18 }} disabled={!!estado}>
          {estado === "guardando" ? <><Loader2 size={15} className="op-girando" /> Guardando…</> : estado === "entrando" ? <><Loader2 size={15} className="op-girando" /> Entrando…</> : "Guardar y entrar"}
        </button>
      </form>
    </Caja>
  );
}

function Correo({ modo, codigo }) {
  const [estado, setEstado] = useState(null); // null | { ok, texto }
  useEffect(() => {
    (async () => {
      try {
        if (modo === "recoverEmail") {
          const info = await checkActionCode(auth, codigo);
          await applyActionCode(auth, codigo);
          setEstado({ ok: true, texto: `Tu correo vuelve a ser ${info.data.email}. Si no hiciste tú el cambio, cambia tu contraseña ahora.` });
        } else {
          await applyActionCode(auth, codigo);
          setEstado({ ok: true, texto: "Tu correo está confirmado." });
        }
      } catch (e) { setEstado({ ok: false, texto: mensaje(e) }); }
    })();
  }, [modo, codigo]);
  return (
    <Caja titulo={modo === "recoverEmail" ? "Recuperar tu correo" : "Confirmar tu correo"} Icono={MailCheck}>
      {!estado ? <Cargando /> : estado.ok ? <p role="status" style={{ color: C.green, fontSize: 15, margin: 0, lineHeight: 1.5 }}>{estado.texto}</p> : <Error_>{estado.texto}</Error_>}
      {estado && <IrAEntrar />}
    </Caja>
  );
}

export default function PaginaClave() {
  const [{ modo, codigo, continuar }] = useState(() => leerAccion(window.location.search));
  if (!codigo) return <Caja titulo="Enlace no válido"><Error_>A este enlace le falta información. Ábrelo desde el correo, o pide otro desde «¿Has olvidado tu contraseña?».</Error_><IrAEntrar /></Caja>;
  if (modo === "resetPassword") return <NuevaClave codigo={codigo} continuar={continuar} />;
  if (modo === "verifyEmail" || modo === "recoverEmail") return <Correo modo={modo} codigo={codigo} />;
  return <Caja titulo="Enlace no válido"><Error_>No reconocemos este enlace. Pide otro desde «¿Has olvidado tu contraseña?».</Error_><IrAEntrar /></Caja>;
}
