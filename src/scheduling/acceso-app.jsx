// Recursos → Trabajadores → ficha: el acceso a la app del trabajador (su
// usuario y su contraseña). Se crea igual que en «Gestión de usuarios» (con
// la sesión secundaria, sin cerrar la del admin) y queda unido a la ficha
// (scheduling_workers.uid). Bloquear = el perfil pasa a inactivo y ya no
// entra. Cambiar la contraseña pasa por /api/usuario-clave.
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { createUserWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { useEffect, useState } from "react";
import { logAudit } from "../audit.js";
import { auth, db, secondaryAuth } from "../firebase.js";
import { DOMINIO_USUARIOS, correoDeUsuario, generarClave, mensajeAlta, rolAppDe, sugerirUsuario, usuarioDeCorreo, usuarioValido } from "../acceso-app.js";
import { roleLabel } from "../roles.js";
import { C, font, mono } from "./estilo.js";

async function pedirServidor(cuerpo) {
  const token = await auth.currentUser?.getIdToken();
  const r = await fetch("/api/usuario-clave", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `error ${r.status}`);
  return j;
}

export function AccesoApp({ worker, orgId, selStyle }) {
  const [perfil, setPerfil] = useState(null); // usuarios/{uid} del trabajador (o null)
  const [yo, setYo] = useState(null);
  const [existente, setExistente] = useState(null); // un usuario de la empresa con su mismo correo, aún sin unir
  const [usuario, setUsuario] = useState(() => worker.email || sugerirUsuario(worker));
  const [clave, setClave] = useState(() => generarClave());
  const [nuevaClave, setNuevaClave] = useState("");
  const [estado, setEstado] = useState(null); // { ok, texto }
  const [hecho, setHecho] = useState(null); // { usuario, clave } recién creado o cambiado, para dárselo al trabajador
  const [trabajando, setTrabajando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const u = auth.currentUser;
        const [p, mio] = await Promise.all([
          worker.uid ? getDoc(doc(db, "usuarios", worker.uid)) : null,
          u ? getDoc(doc(db, "usuarios", u.uid)) : null,
        ]);
        if (!vivo) return;
        setPerfil(p?.exists() ? { _id: p.id, ...p.data() } : null);
        setYo(mio?.exists() ? mio.data() : null);
        if (!worker.uid && worker.email && orgId) {
          const q = await getDocs(query(collection(db, "usuarios"), where("org_id", "==", orgId), where("email", "==", String(worker.email).toLowerCase())));
          if (vivo) setExistente(q.docs[0] ? { _id: q.docs[0].id, ...q.docs[0].data() } : null);
        }
      } catch (e) { if (vivo) setEstado({ ok: false, texto: `No se pudo leer el acceso: ${e.message || e}` }); }
    })();
    return () => { vivo = false; };
  }, [worker.uid, worker.email, orgId, recarga]);

  const nombreCompleto = [worker.nombre, worker.apellidos].filter(Boolean).join(" ");
  const rolApp = rolAppDe(worker, yo?.rol);

  async function crear() {
    const u = usuario.trim().toLowerCase();
    if (!usuarioValido(u)) { setEstado({ ok: false, texto: "Ese usuario no vale: de 3 a 40 letras, números o puntos, sin espacios ni tildes (o un correo)." }); return; }
    if (clave.length < 6) { setEstado({ ok: false, texto: "La contraseña tiene que tener al menos 6 caracteres." }); return; }
    if (!orgId) { setEstado({ ok: false, texto: "Falta la empresa: abre un proyecto de una empresa." }); return; }
    setTrabajando(true); setEstado(null);
    try {
      // el límite de usuarios del plan de la empresa
      const org = await getDoc(doc(db, "orgs", orgId));
      const max = org.exists() ? org.data().max_usuarios || 0 : 0;
      if (org.exists() && max) {
        const activos = (await getDocs(query(collection(db, "usuarios"), where("org_id", "==", orgId)))).docs.filter(d => d.data().activo !== false).length;
        if (activos >= max) throw new Error(`Habéis llegado al límite de ${max} usuarios de vuestro plan. Bloquea a alguien que ya no lo use o pide a Operanzia que lo amplíe.`);
      }
      const correo = correoDeUsuario(u);
      const cred = await createUserWithEmailAndPassword(secondaryAuth, correo, clave);
      await setDoc(doc(db, "usuarios", cred.user.uid), {
        nombre: (worker.nombre || "").trim(), apellidos: (worker.apellidos || "").trim(),
        email: correo, rol: rolApp, org_id: orgId, activo: true, trabajadorId: worker._id, createdAt: serverTimestamp(),
      });
      await secondaryAuth.signOut();
      await updateDoc(doc(db, "scheduling_workers", worker._id), { uid: cred.user.uid, usuario: usuarioDeCorreo(correo) });
      logAudit({ modulo: "Plantilla", accion: "Dio acceso a la app a un trabajador", detalle: `${nombreCompleto} (${usuarioDeCorreo(correo)})`, projectId: null });
      setHecho({ usuario: usuarioDeCorreo(correo), clave });
      setRecarga(x => x + 1);
    } catch (e) {
      await secondaryAuth.signOut().catch(() => {});
      setEstado({ ok: false, texto: e.code ? mensajeAlta(e) : (e.message || String(e)) });
    }
    setTrabajando(false);
  }

  async function unirExistente() {
    setTrabajando(true); setEstado(null);
    try {
      await updateDoc(doc(db, "scheduling_workers", worker._id), { uid: existente._id, usuario: usuarioDeCorreo(existente.email) });
      setEstado({ ok: true, texto: "Unido a su usuario de la app." });
      setRecarga(x => x + 1);
    } catch (e) { setEstado({ ok: false, texto: `No se pudo unir: ${e.message || e}` }); }
    setTrabajando(false);
  }

  async function cambiarActivo() {
    const activo = perfil.activo === false;
    setTrabajando(true); setEstado(null);
    try {
      await updateDoc(doc(db, "usuarios", perfil._id), { activo });
      pedirServidor({ uid: perfil._id, bloquear: !activo }).catch(() => {}); // si el servidor está preparado, también cierra la cuenta en Firebase
      logAudit({ modulo: "Plantilla", accion: activo ? "Desbloqueó el acceso a la app" : "Bloqueó el acceso a la app", detalle: nombreCompleto, projectId: null });
      setPerfil({ ...perfil, activo });
      setEstado({ ok: true, texto: activo ? "Ya puede volver a entrar." : "Bloqueado: ya no puede entrar en la app." });
    } catch (e) { setEstado({ ok: false, texto: `No se pudo cambiar: ${e.message || e}` }); }
    setTrabajando(false);
  }

  async function cambiarClave() {
    if (nuevaClave.length < 6) { setEstado({ ok: false, texto: "La contraseña tiene que tener al menos 6 caracteres." }); return; }
    setTrabajando(true); setEstado(null);
    try {
      const r = await pedirServidor({ uid: perfil._id, clave: nuevaClave });
      if (!r.configurado) {
        setEstado({ ok: false, texto: realEmail ? "Desde aquí aún no se puede poner la contraseña de otra persona (falta un ajuste del servidor). Usa «Enviarle un correo para cambiarla»." : "Desde aquí aún no se puede poner la contraseña de otra persona: falta un ajuste del servidor (la cuenta de servicio de Firebase en Vercel)." });
      } else {
        logAudit({ modulo: "Plantilla", accion: "Cambió la contraseña de la app de un trabajador", detalle: nombreCompleto, projectId: null });
        setHecho({ usuario: usuarioDeCorreo(perfil.email), clave: nuevaClave });
        setNuevaClave("");
      }
    } catch (e) { setEstado({ ok: false, texto: `No se pudo cambiar: ${e.message || e}` }); }
    setTrabajando(false);
  }

  async function correoCambio() {
    setTrabajando(true); setEstado(null);
    try { await sendPasswordResetEmail(auth, perfil.email); setEstado({ ok: true, texto: `Enviado a ${perfil.email}: le llegará un enlace para poner su contraseña.` }); }
    catch (e) { setEstado({ ok: false, texto: `No se pudo enviar: ${e.message || e}` }); }
    setTrabajando(false);
  }

  const realEmail = perfil?.email && !perfil.email.endsWith(`@${DOMINIO_USUARIOS}`);
  const btn = { padding: "7px 12px", borderRadius: 7, fontSize: 12, fontFamily: font, cursor: "pointer", border: `1px solid ${C.border}`, background: "none", color: C.text };
  const btnAzul = { ...btn, background: C.blue, border: "none", color: "#fff", fontWeight: 600 };
  const etiqueta = { display: "flex", flexDirection: "column", gap: 3, fontSize: 10.5, color: C.muted, flex: "1 1 160px" };

  return (
    <div data-testid="acceso-app" style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>Acceso a la app</div>

      {hecho && (
        <div style={{ background: C.greenDim, border: `1px solid ${C.green}55`, borderRadius: 8, padding: "10px 12px", marginBottom: 10, fontSize: 12.5, color: C.text, lineHeight: 1.6 }}>
          Dáselo a {worker.nombre || "el trabajador"} (la contraseña no se vuelve a enseñar):
          <div>Usuario: <b style={{ fontFamily: mono }}>{hecho.usuario}</b></div>
          <div>Contraseña: <b style={{ fontFamily: mono }}>{hecho.clave}</b></div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button style={btn} onClick={() => navigator.clipboard?.writeText(`Usuario: ${hecho.usuario}\nContraseña: ${hecho.clave}\nEntra en app.operanzia.com`).then(() => setEstado({ ok: true, texto: "Copiado." }), () => {})}>Copiar</button>
            <button style={btn} onClick={() => setHecho(null)}>Ya se lo he dado</button>
          </div>
        </div>
      )}

      {perfil ? (
        <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.7 }}>
          <div>Usuario: <b style={{ fontFamily: mono }}>{usuarioDeCorreo(perfil.email)}</b> · {roleLabel(perfil.rol)} · {perfil.activo === false
            ? <span style={{ color: C.red, fontWeight: 600 }}>bloqueado</span>
            : <span style={{ color: C.green, fontWeight: 600 }}>puede entrar</span>}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
            <label style={etiqueta}>Nueva contraseña
              <input value={nuevaClave} onChange={e => setNuevaClave(e.target.value)} autoComplete="new-password" style={{ ...selStyle, flex: "none", fontFamily: mono }} />
            </label>
            <button style={btn} onClick={() => setNuevaClave(generarClave())}>Inventar una</button>
            <button style={btnAzul} disabled={trabajando || !nuevaClave} onClick={cambiarClave}>Cambiar contraseña</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {realEmail && <button style={btn} disabled={trabajando} onClick={correoCambio}>Enviarle un correo para cambiarla</button>}
            <button style={{ ...btn, color: perfil.activo === false ? C.green : C.red, borderColor: (perfil.activo === false ? C.green : C.red) + "55" }} disabled={trabajando} onClick={cambiarActivo}>
              {perfil.activo === false ? "Desbloquear el acceso" : "Bloquear el acceso"}
            </button>
          </div>
        </div>
      ) : existente ? (
        <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.6 }}>
          Ya tiene un usuario en la app con su correo (<b>{existente.email}</b>, {roleLabel(existente.rol)}).
          <div style={{ marginTop: 8 }}><button style={btnAzul} disabled={trabajando} onClick={unirExistente}>Unir esta ficha a ese usuario</button></div>
        </div>
      ) : worker.uid ? (
        <div style={{ fontSize: 12.5, color: C.dim }}>Su usuario de la app ya no existe.</div>
      ) : (
        <div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Aún no puede entrar en la app. Elige su usuario y su contraseña; entrará como {roleLabel(rolApp)}.</div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label style={etiqueta}>Usuario
              <input value={usuario} onChange={e => setUsuario(e.target.value)} autoComplete="off" autoCapitalize="none" style={{ ...selStyle, flex: "none", fontFamily: mono }} />
            </label>
            <label style={etiqueta}>Contraseña
              <input value={clave} onChange={e => setClave(e.target.value)} autoComplete="new-password" style={{ ...selStyle, flex: "none", fontFamily: mono }} />
            </label>
            <button style={btn} onClick={() => setClave(generarClave())}>Otra</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button style={btnAzul} disabled={trabajando} onClick={crear}>{trabajando ? "Creando…" : "Crear su acceso"}</button>
          </div>
        </div>
      )}
      {estado && <div style={{ fontSize: 12, color: estado.ok ? C.green : C.red, marginTop: 8 }}>{estado.texto}</div>}
    </div>
  );
}
