import { CircleAlert, Loader2 } from "lucide-react";
import { Logo } from "./ui/marca.jsx";
import { useState } from "react";
import { auth, getUserProfileSafe } from "./firebase.js";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { limpiarEmail, mensajeAuth } from "./auth-mensajes.js";

// Extracted out of scheduling.jsx so the login screen doesn't have to
// download the Scheduling/Planning/Rostering bundle just to show a form —
// this is the only piece of that module needed before authentication.

const C = {
  bg:"#0b0d12", card:"#12151c",
  border:"rgba(255,255,255,0.08)",
  blue:"#5b7cfa", blueDim:"#1a2142", blueText:"#b4c3ff",
  red:"#f26d6d",
  text:"#e6e8ee", muted:"#9aa3b2", dim:"#5d6574",
};
const font = "var(--font)";
if (typeof document !== "undefined" && !document.getElementById("sched-styles")) {
  const s = document.createElement("style");
  s.id = "sched-styles";
  s.textContent = `
    *,*::before,*::after{box-sizing:border-box;-webkit-font-smoothing:antialiased;}
    @keyframes sched-fadein{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
    @keyframes sched-spin{to{transform:rotate(360deg)}}
    @keyframes sched-shimmer{0%,100%{opacity:1}50%{opacity:.6}}
    .sched-block{transition:filter .1s,box-shadow .1s;}
    .sched-block:hover{filter:brightness(1.15);box-shadow:0 2px 8px rgba(0,0,0,.4);}
  `;
  document.head.appendChild(s);
}

export function LoginScheduling({ onLogin }) {
  const [email,     setEmail]     = useState("");
  const [password,  setPassword]  = useState("");
  const [err,       setErr]       = useState("");
  const [loading,   setLoading]   = useState(false);
  // Antes había un modo "Configuración inicial" que creaba un administrador
  // autoregistrándose. Ya no se puede (las reglas lo impiden): los
  // administradores de cada organización los da de alta el superadmin.

  async function login() {
    if (!email || !password) { setErr("Introduce email y contraseña."); return; }
    setLoading(true); setErr("");
    try {
      const cred = await signInWithEmailAndPassword(auth, limpiarEmail(email), password);
      // getUserProfileSafe: recién autenticado, la caché local puede no
      // tener aún este documento y devolver "no existe" antes de
      // sincronizar — pero con timeout, para no colgarse en mala cobertura.
      const snap = await getUserProfileSafe(cred.user.uid);
      if (!snap.exists() || snap.data().activo === false) {
        await signOut(auth); setErr("Usuario inactivo o sin perfil."); setLoading(false); return;
      }
      const profile = { uid: cred.user.uid, ...snap.data() };
      if (profile.rol !== "admin" && profile.rol !== "superadmin") {
        await signOut(auth); setErr("Acceso restringido a administradores."); setLoading(false); return;
      }
      onLogin(profile);
    } catch (e) {
      setErr(mensajeAuth(e));
    }
    setLoading(false);
  }

  const onEnter = e => e.key === "Enter" && login();

  return (
    <div style={{ minHeight: "100vh", background: `radial-gradient(900px 520px at 50% -10%, rgba(91,124,250,0.16), transparent 70%), radial-gradient(700px 420px at 85% 110%, rgba(109,40,217,0.12), transparent 70%), ${C.bg}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font, padding: 16 }}>
      <div style={{ width: 380, maxWidth: "100%", animation: "sched-fadein .3s ease both" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 26 }}>
          <Logo size={44} />
          <div style={{ fontSize: 22, fontWeight: 650, color: C.text, marginTop: 16, letterSpacing: "-0.02em" }}>Entra en Operanzia</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>Planificación y operaciones de flota</div>
        </div>
        <div style={{ background: "rgba(18,21,28,0.85)", border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, boxShadow: "0 24px 64px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,0.04)", backdropFilter: "blur(8px)" }}>
          <div style={{ marginBottom: 14 }}>
            <label className="op-label" htmlFor="login-email">Email</label>
            <input id="login-email" className="op-input" value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="tu@empresa.com" autoComplete="email" onKeyDown={onEnter} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label className="op-label" htmlFor="login-clave">Contraseña</label>
            <input id="login-clave" className="op-input" value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="••••••••" autoComplete="current-password" onKeyDown={onEnter} />
          </div>
          {err && (
            <div style={{ background: "rgba(242,109,109,0.08)", border: "1px solid rgba(242,109,109,0.25)", color: C.red, borderRadius: 9, padding: "9px 12px", fontSize: 12.5, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <CircleAlert size={15} style={{ flexShrink: 0 }} /> {err}
            </div>
          )}
          <button onClick={login} disabled={loading} className="op-btn op-primario" style={{ width: "100%", height: 40, fontSize: 13.5 }}>
            {loading ? <><Loader2 size={15} className="op-girando" /> Accediendo…</> : "Acceder"}
          </button>
        </div>
        <div style={{ textAlign: "center", fontSize: 11.5, color: C.dim, marginTop: 18 }}>Acceso para la oficina · los conductores entran por la app de Rutas</div>
      </div>
    </div>
  );
}
