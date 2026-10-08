import { useState } from "react";
import { auth, getUserProfileSafe } from "./firebase.js";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { limpiarEmail, mensajeAuth } from "./auth-mensajes.js";

// Extracted out of scheduling.jsx so the login screen doesn't have to
// download the Scheduling/Planning/Rostering bundle just to show a form —
// this is the only piece of that module needed before authentication.

const C = {
  bg:"#0f1623", card:"#172035",
  border:"rgba(88,130,225,0.22)",
  blue:"#5c9bff", blueDim:"#0d2550", blueText:"#b0ccff",
  red:"#f87171",
  text:"#e2eeff", muted:"#8aa5cc", dim:"#4a5f82",
};
const font = "'Inter',system-ui,sans-serif";

if (typeof document !== "undefined" && !document.getElementById("sched-styles")) {
  const s = document.createElement("style");
  s.id = "sched-styles";
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
    *,*::before,*::after{box-sizing:border-box;-webkit-font-smoothing:antialiased;}
    body{margin:0;background:#0f1117;color:#f0f4f8;font-family:'Inter',system-ui,sans-serif;}
    ::-webkit-scrollbar{width:5px;height:5px;}
    ::-webkit-scrollbar-track{background:#161b27;}
    ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:3px;}
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

  const iStyle = {
    width: "100%", background: "rgba(255,255,255,0.04)",
    border: `1px solid ${C.border}`, color: C.text,
    padding: "10px 13px", borderRadius: 7, fontSize: 13,
    boxSizing: "border-box", fontFamily: font, outline: "none",
  };

  const onEnter = e => e.key === "Enter" && login();

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font }}>
      <div style={{ width: 380, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "32px 28px", boxShadow: "0 16px 48px rgba(0,0,0,.5)", animation: "sched-fadein .3s ease both" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>Operanzia</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>
            Planning &amp; Scheduling
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
            Acceso para administradores
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6, fontWeight: 500 }}>Email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="admin@empresa.com" autoComplete="email" onKeyDown={onEnter}
            style={{ ...iStyle, borderColor: email ? `${C.blue}44` : C.border }}
            onFocus={e => e.target.style.borderColor = `${C.blue}66`}
            onBlur={e  => e.target.style.borderColor = email ? `${C.blue}44` : C.border}
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6, fontWeight: 500 }}>Contraseña</label>
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="••••••••"
            autoComplete="current-password" onKeyDown={onEnter}
            style={{ ...iStyle, borderColor: password ? `${C.blue}44` : C.border }}
            onFocus={e => e.target.style.borderColor = `${C.blue}66`}
            onBlur={e  => e.target.style.borderColor = password ? `${C.blue}44` : C.border}
          />
        </div>
        {err && (
          <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: C.red, borderRadius: 7, padding: "9px 13px", fontSize: 12, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {err}
          </div>
        )}
        <button onClick={login} disabled={loading} style={{
          width: "100%", padding: "11px", fontSize: 13, fontWeight: 600,
          background: loading ? C.blueDim : C.blue, border: "none",
          color: loading ? C.blueText : "#fff",
          borderRadius: 8, cursor: loading ? "wait" : "pointer", fontFamily: font, transition: "all .15s",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}
          onMouseEnter={e => { if (!loading) e.currentTarget.style.background = "#3a7ef5"; }}
          onMouseLeave={e => { if (!loading) e.currentTarget.style.background = C.blue; }}
        >
          {loading
            ? <><span style={{ display: "inline-block", width: 13, height: 13, border: "2px solid rgba(163,196,252,.3)", borderTopColor: C.blueText, borderRadius: "50%", animation: "sched-spin .6s linear infinite" }} /> Accediendo…</>
            : "Acceder"
          }
        </button>

      </div>
    </div>
  );
}
