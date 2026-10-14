// App del conductor · activar los avisos en este móvil (rutas nuevas,
// mensajes de la oficina, incidencias). Ver src/avisos.js.
import { useEffect, useState } from "react";
import { activarAvisos, avisoDePrueba, esIphoneSinInstalar, estadoAvisos } from "../avisos.js";
import { C, S } from "./comun.js";

export function AvisosMovil({ sesion }) {
  const [estado, setEstado] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { estadoAvisos().then(setEstado, () => setEstado("no-soportado")); }, []);
  if (!estado) return null;
  const iphone = esIphoneSinInstalar();
  async function activar() {
    setOcupado(true); setMsg(null);
    try { setEstado(await activarAvisos(sesion)); await avisoDePrueba(sesion).catch(() => {}); setMsg({ ok: true, t: "Listo: te llegará un aviso de prueba." }); }
    catch (e) { setMsg({ ok: false, t: e.message || String(e) }); estadoAvisos().then(setEstado); }
    finally { setOcupado(false); }
  }
  async function probar() {
    setOcupado(true); setMsg(null);
    try { const r = await avisoDePrueba(sesion); setMsg(r.enviados ? { ok: true, t: "Aviso de prueba enviado." } : { ok: false, t: "No hay ningún móvil con avisos activados." }); }
    catch (e) { setMsg({ ok: false, t: e.message || String(e) }); }
    finally { setOcupado(false); }
  }
  const activos = estado === "activos";
  return (
    <div style={{ ...S.card, borderLeft: `4px solid ${activos ? C.green : C.orange}`, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 22 }}>{activos ? "🔔" : "🔕"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{activos ? "Avisos activados en este móvil" : "Avisos en el móvil"}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            {estado === "no-soportado" ? (iphone ? "En iPhone: pulsa Compartir → «Añadir a pantalla de inicio», abre Operanzia desde ahí y actívalos." : "Este navegador no admite avisos. Prueba con Chrome.")
              : estado === "bloqueados" ? "Los has bloqueado: actívalos en los ajustes del navegador (permisos del sitio → Notificaciones)."
              : activos ? "Te avisamos de rutas nuevas, mensajes de la oficina e incidencias, aunque la app esté cerrada."
              : "Para enterarte de rutas nuevas y mensajes de la oficina aunque la app esté cerrada."}
          </div>
        </div>
        {estado === "sin-activar" && <button disabled={ocupado} onClick={activar} style={{ ...S.btnOk, flexShrink: 0 }}>{ocupado ? "…" : "Activar"}</button>}
        {activos && <button disabled={ocupado} onClick={probar} style={{ ...S.btnGhost, fontSize: 11, padding: "6px 10px", flexShrink: 0 }}>Probar</button>}
      </div>
      {msg && <div style={{ fontSize: 11, marginTop: 8, color: msg.ok ? C.green : C.red }}>{msg.t}</div>}
    </div>
  );
}
