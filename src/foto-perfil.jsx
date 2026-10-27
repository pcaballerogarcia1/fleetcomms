// El círculo del usuario en la cabecera: su foto o, si no tiene, sus
// iniciales. Al tocarlo: poner o cambiar la foto (galería o cámara), quitarla
// cambiar la contraseña (le llega un correo) y cerrar sesión.
import { Camera, KeyRound, LogOut, Moon, Sun, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { C, CLARO, MARCA, cambiarTema } from "./tema.js";
import { guardarFoto, reducirFoto } from "./foto-perfil.js";
import { esCorreoReal, enviarCambioClave } from "./cambio-clave.js";
import { usuarioDeCorreo } from "./acceso-app.js";
import { alfa } from "./tema.js";

const iniciales = u => (((u?.nombre || "")[0] || "") + ((u?.apellidos || "")[0] || "")).toUpperCase() || "?";

/** Solo el círculo (para listas): foto o iniciales */
export function CirculoPerfil({ usuario, size = 30, style }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0, overflow: "hidden",
      background: MARCA.degradado, border: `1px solid ${alfa(0.18)}`, color: "#fff",
      fontSize: Math.round(size * 0.36), fontWeight: 650, display: "flex", alignItems: "center", justifyContent: "center", ...style,
    }}>
      {usuario?.foto ? <img src={usuario.foto} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : iniciales(usuario)}
    </div>
  );
}

/** El círculo de la cabecera con su menú */
export function AvatarPerfil({ sesion, size = 32, onCerrarSesion }) {
  const [foto, setFoto] = useState(sesion?.foto || null);
  const [abierto, setAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const caja = useRef(), archivo = useRef();
  useEffect(() => {
    if (!abierto) return;
    const fuera = e => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false); };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [abierto]);

  async function poner(f) {
    setError(null); setOcupado(true);
    try {
      const nueva = f ? await reducirFoto(f) : null;
      await guardarFoto(sesion.uid, nueva);
      setFoto(nueva);
      setAbierto(false);
    } catch (e) { setError(e.message || String(e)); }
    setOcupado(false);
  }

  async function cambiarClave() {
    setError(null); setAviso(null); setOcupado(true);
    try { const email = await enviarCambioClave(sesion.email); setAviso(`Te hemos enviado un correo a ${email} con un enlace para poner una contraseña nueva.`); }
    catch (e) { setError(e.message || String(e)); }
    setOcupado(false);
  }

  const opcion = { display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px", background: "none", border: "none", color: C.text, fontSize: 15, cursor: "pointer", textAlign: "left" };
  return (
    <div ref={caja} style={{ position: "relative" }}>
      <button onClick={() => setAbierto(a => !a)} title="Tu perfil" aria-label="Tu perfil" style={{ padding: 0, background: "none", border: "none", cursor: "pointer", borderRadius: "50%" }}>
        <CirculoPerfil usuario={{ ...sesion, foto }} size={size} />
      </button>
      <input ref={archivo} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) poner(f); }} />
      {abierto && (
        <div role="menu" style={{ position: "absolute", top: size + 8, right: 0, zIndex: 3000, minWidth: 220, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.45)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${C.border}` }}>
            <CirculoPerfil usuario={{ ...sesion, foto }} size={40} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[sesion?.nombre, sesion?.apellidos].filter(Boolean).join(" ") || "Tu perfil"}</div>
              {sesion?.email && <div style={{ fontSize: 12, color: C.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{usuarioDeCorreo(sesion.email)}</div>}
            </div>
          </div>
          <button role="menuitem" style={opcion} disabled={ocupado} onClick={() => archivo.current?.click()}><Camera size={16} color={C.blue} /> {ocupado ? "Guardando…" : foto ? "Cambiar foto" : "Poner foto"}</button>
          {foto && <button role="menuitem" style={opcion} disabled={ocupado} onClick={() => poner(null)}><Trash2 size={16} color={C.muted} /> Quitar foto</button>}
          {esCorreoReal(sesion?.email) && <button role="menuitem" style={opcion} disabled={ocupado} onClick={cambiarClave}><KeyRound size={16} color={C.blue} /> Cambiar mi contraseña</button>}
          {aviso && <div role="status" style={{ padding: "6px 14px 10px", fontSize: 12, color: C.green, lineHeight: 1.45, maxWidth: 260 }}>{aviso}</div>}
          {error && <div style={{ padding: "6px 14px", fontSize: 12, color: C.red }}>{error}</div>}
          <button role="menuitem" style={opcion} onClick={() => cambiarTema(CLARO ? "oscuro" : "claro")}>{CLARO ? <Moon size={16} color={C.muted} /> : <Sun size={16} color={C.muted} />} {CLARO ? "Aspecto oscuro" : "Aspecto claro"}</button>
          {onCerrarSesion && <button role="menuitem" style={{ ...opcion, borderTop: `1px solid ${C.border}` }} onClick={onCerrarSesion}><LogOut size={16} color={C.red} /> Cerrar sesión</button>}
        </div>
      )}
    </div>
  );
}
