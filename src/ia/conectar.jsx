// /conectar-ia — la página que abre ChatGPT, Claude, Gemini… al conectar
// Operanzia: el usuario entra con su cuenta, ve qué podrá hacer la IA y pulsa
// «Permitir». Entonces el servidor (api/oauth.js) da el código y volvemos a
// la IA. La IA verá solo lo que ve este usuario.
import { CircleAlert, Loader2, Sparkles, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db, getUserProfileSafe } from "../firebase.js";
import { limpiarEmail, mensajeAuth } from "../auth-mensajes.js";
import { usuarioDeCorreo } from "../acceso-app.js";
import { Logo } from "../ui/marca.jsx";
import { C, alfa, tono } from "../tema.js";
import { leerPeticion, loQuePodra, motivoSinAcceso, nivelDe, vueltaDenegada } from "./datos.js";

const caja = { background: tono("rgba(18,21,28,0.85)", "rgba(255,255,255,0.9)"), border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, boxShadow: `0 24px 64px rgba(0,0,0,.35), inset 0 1px 0 ${alfa(0.04)}` };

function Aviso({ children }) {
  return (
    <div role="alert" style={{ background: "rgba(242,109,109,0.08)", border: "1px solid rgba(242,109,109,0.25)", color: C.red, borderRadius: 8, padding: "10px 12px", fontSize: 14, lineHeight: 1.45, display: "flex", gap: 8 }}>
      <CircleAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{children}</span>
    </div>
  );
}

function Entrar() {
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [err, setErr] = useState("");
  const [cargando, setCargando] = useState(false);
  async function entrar() {
    if (!email || !clave) { setErr("Escribe tu usuario y tu contraseña."); return; }
    setCargando(true); setErr("");
    try { await signInWithEmailAndPassword(auth, limpiarEmail(email), clave); }
    catch (e) { setErr(mensajeAuth(e)); setCargando(false); }
  }
  const enter = e => e.key === "Enter" && entrar();
  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <label className="op-label" htmlFor="ia-email">Email o usuario</label>
        <input id="ia-email" className="op-input" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" autoCapitalize="none" placeholder="tu@empresa.com o tu usuario" onKeyDown={enter} />
      </div>
      <div style={{ marginBottom: 18 }}>
        <label className="op-label" htmlFor="ia-clave">Contraseña</label>
        <input id="ia-clave" className="op-input" type="password" value={clave} onChange={e => setClave(e.target.value)} autoComplete="current-password" placeholder="••••••••" onKeyDown={enter} />
      </div>
      {err && <div style={{ marginBottom: 14 }}><Aviso>{err}</Aviso></div>}
      <button className="op-btn op-primario" style={{ width: "100%", height: 42, fontSize: 14 }} onClick={entrar} disabled={cargando}>
        {cargando ? <><Loader2 size={15} className="op-girando" /> Entrando…</> : "Entrar"}
      </button>
    </>
  );
}

export default function ConectarIA() {
  const [{ peticion, error: errPeticion }] = useState(() => leerPeticion(window.location.search));
  const [ia, setIa] = useState(null); // nombre de la IA, comprobada en el servidor
  const [errIa, setErrIa] = useState(null);
  const [usuario, setUsuario] = useState(undefined); // undefined: mirando; null: sin entrar
  const [perfil, setPerfil] = useState(null);
  const [ajustes, setAjustes] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!peticion) return;
    const q = new URLSearchParams({ accion: "cliente", client_id: peticion.client_id, redirect_uri: peticion.redirect_uri });
    fetch(`/api/oauth?${q}`).then(async r => {
      const j = await r.json().catch(() => ({}));
      if (r.ok) setIa(j.nombre || "Tu IA"); else setErrIa(j.error_description || "No se reconoce esta IA. Vuelve a añadir el conector desde tu IA.");
    }).catch(() => setErrIa("Sin conexión con Operanzia. Revisa internet y vuelve a probar."));
  }, [peticion]);

  useEffect(() => onAuthStateChanged(auth, async u => {
    setPerfil(null); setAjustes(null);
    if (!u) { setUsuario(null); return; }
    try {
      const s = await getUserProfileSafe(u.uid);
      const p = s.exists() ? { uid: u.uid, ...s.data() } : null;
      const a = p?.org_id ? await getDoc(doc(db, "ia_ajustes", p.org_id)).then(d => (d.exists() ? d.data() : null)) : null;
      setPerfil(p); setAjustes(a);
    } catch (e) { setErr(`No se pudo leer tu perfil: ${e.message}`); }
    setUsuario(u);
  }), []);

  async function permitir() {
    setEnviando(true); setErr(null);
    try {
      const r = await fetch("/api/oauth?accion=codigo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...peticion, sesion: auth.currentUser.refreshToken }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.redirect) throw new Error(j.error_description || "No se pudo completar la conexión.");
      window.location.assign(j.redirect);
    } catch (e) { setErr(e.message); setEnviando(false); }
  }

  const motivo = usuario ? motivoSinAcceso(perfil, ajustes) : null;
  const nivel = nivelDe(ajustes);
  const nombre = [perfil?.nombre, perfil?.apellidos].filter(Boolean).join(" ") || usuarioDeCorreo(usuario?.email || "");

  let cuerpo;
  if (errPeticion || errIa) cuerpo = <Aviso>{errPeticion || errIa}</Aviso>;
  else if (!ia || usuario === undefined) cuerpo = <div style={{ display: "flex", justifyContent: "center", padding: 20, color: C.muted }}><Loader2 size={20} className="op-girando" /></div>;
  else if (!usuario) cuerpo = <><p style={{ margin: "0 0 18px", fontSize: 14, color: C.muted, lineHeight: 1.5 }}>Entra con tu cuenta de Operanzia para conectar <b style={{ color: C.text }}>{ia}</b>.</p><Entrar /></>;
  else cuerpo = (
    <>
      <p style={{ margin: "0 0 14px", fontSize: 15, color: C.text, lineHeight: 1.5 }}>
        <b>{ia}</b> quiere conectarse a Operanzia con tu cuenta{nombre ? <> (<b>{nombre}</b>)</> : null}.
      </p>
      {motivo ? <Aviso>{motivo}</Aviso> : (
        <>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>Podrá:</div>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 14px", display: "grid", gap: 8 }}>
            {loQuePodra(nivel).map(t => <li key={t} style={{ display: "flex", gap: 8, fontSize: 14, color: C.text, lineHeight: 1.4 }}><Check size={16} color={C.green} style={{ flexShrink: 0, marginTop: 2 }} /> {t}</li>)}
          </ul>
          <p style={{ margin: "0 0 18px", fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
            Verá solo lo que tú puedes ver en Operanzia. Puedes desconectarla cuando quieras desde el menú de tu foto › «Conectar con IA».
          </p>
          {err && <div style={{ marginBottom: 14 }}><Aviso>{err}</Aviso></div>}
          <button className="op-btn op-primario" style={{ width: "100%", height: 42, fontSize: 14 }} onClick={permitir} disabled={enviando}>
            {enviando ? <><Loader2 size={15} className="op-girando" /> Conectando…</> : "Permitir"}
          </button>
        </>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, gap: 10 }}>
        <button className="op-btn op-fantasma" onClick={() => window.location.assign(vueltaDenegada(peticion))} disabled={enviando}>{motivo ? "Volver a la IA" : "Cancelar"}</button>
        <button className="op-btn op-fantasma" onClick={() => signOut(auth)} disabled={enviando}>No soy yo</button>
      </div>
    </>
  );

  return (
    <div style={{ minHeight: "100vh", background: `radial-gradient(900px 520px at 50% -10%, rgba(91,124,250,0.16), transparent 70%), ${C.bg}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font)", padding: 16 }}>
      <div style={{ width: 420, maxWidth: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 22 }}>
          <Logo size={40} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 20, fontWeight: 650, color: C.text, marginTop: 14 }}><Sparkles size={18} color={C.blue} /> Conectar con IA</div>
        </div>
        <div style={caja}>{cuerpo}</div>
      </div>
    </div>
  );
}
