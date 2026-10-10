// ── Publicar los turnos de un día a Control (desde el Scheduling de líneas) ──
// Se publica exactamente lo que se ve en el escenario (con los cambios a
// mano): a partir de ahí los conductores cogen su turno en el móvil y la
// oficina lo sigue en Control.
import { useState, useEffect, useMemo } from "react";
import { servicioDesdeEscenario, diaValeParaFecha, proximaFecha, fechaLocal, hhmm, servicioId } from "./lineas-servicio.js";
import { publicarServicio, hayAlgoHecho, watchServiciosProyecto, borrarServicio } from "./lineas-servicio-store.js";
import { nombreDia } from "./lineas-sched.js";
import { logAudit } from "./audit.js";

const C = {
  bg: "#0f1623", card: "#172035", surface2: "#1e2d48", border: "rgba(88,130,225,0.22)", border2: "rgba(88,130,225,0.40)",
  text: "#e2eeff", muted: "#8aa5cc", dim: "#4a5f82", blue: "#5c9bff", green: "#34d399", amber: "#fbbf24", red: "#f87171",
};
const font = '"Inter","Segoe UI",system-ui,sans-serif';
const fechaTxt = f => new Date(f + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
const irAControl = () => { window.history.pushState({}, "", "/control"); window.dispatchEvent(new PopStateEvent("popstate")); };

export function PublicarServicio({ red, res, dia, cocheras, projectId, orgId, proyecto, sesion, avisoManual, onCerrar }) {
  const [fecha, setFecha] = useState(() => proximaFecha(dia, red, fechaLocal()) || fechaLocal());
  const [estado, setEstado] = useState(null); // { trabajando } | { ok } | { error }
  const [publicados, setPublicados] = useState([]);
  useEffect(() => watchServiciosProyecto(projectId, orgId, setPublicados), [projectId, orgId]);
  const servicio = useMemo(() => servicioDesdeEscenario(res, red, { cocheras }), [res, red, cocheras]);
  const vale = diaValeParaFecha(dia, red, fecha);
  const yaHay = publicados.find(p => p.fecha === fecha);
  const hoy = fechaLocal();

  async function publicar() {
    setEstado({ trabajando: true });
    try {
      const sid = servicioId(projectId, fecha);
      if (yaHay && (await hayAlgoHecho(sid, orgId)) && !window.confirm(`El ${fechaTxt(fecha)} ya está publicado y hay conductores con turno cogido o empezado. Si lo vuelves a publicar, eso se pierde. ¿Seguir?`)) { setEstado(null); return; }
      await publicarServicio({ projectId, orgId, fecha, dia, nombreDia: nombreDia(dia, red), proyecto, servicio, por: sesion?.uid || null });
      logAudit({ modulo: "Scheduling", accion: "Publicó el servicio de líneas a Control", detalle: `${fechaTxt(fecha)} · ${nombreDia(dia, red)} · ${servicio.resumen.turnos} turnos` });
      setEstado({ ok: true });
    } catch (e) {
      setEstado({ error: e.message || String(e) });
    }
  }
  async function quitar(p) {
    if (!window.confirm(`¿Quitar de Control el servicio del ${fechaTxt(p.fecha)}? Los conductores dejarán de verlo.`)) return;
    try {
      await borrarServicio(p._id, orgId);
      logAudit({ modulo: "Scheduling", accion: "Quitó un servicio de líneas de Control", detalle: fechaTxt(p.fecha) });
    } catch (e) { alert("No se pudo quitar: " + (e.message || e)); }
  }

  const btn = (fuerte, deshabilitado) => ({ padding: fuerte ? "9px 18px" : "6px 12px", borderRadius: 7, border: `1px solid ${fuerte ? C.blue : C.border2}`, background: fuerte ? (deshabilitado ? C.surface2 : "#16306a") : "transparent", color: fuerte ? "#cfe0ff" : C.muted, fontSize: 12.5, fontWeight: fuerte ? 700 : 500, cursor: deshabilitado ? "not-allowed" : "pointer", fontFamily: font });
  const r = servicio.resumen;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onCerrar}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "100%", overflowY: "auto", background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 12, fontFamily: font, boxShadow: "0 20px 60px rgba(0,0,0,.5)", padding: "18px 20px" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Publicar a Control</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.55 }}>
          Los turnos de <b style={{ color: C.text }}>{nombreDia(dia, red)}</b> tal y como están ahora ({r.turnos} turnos · {r.viajes.toLocaleString("es-ES")} expediciones · {r.autobuses} autobuses, de {hhmm(r.inicio)} a {hhmm(r.fin)}) pasan a ser el servicio de un día concreto. Cada conductor coge su turno en el móvil y Control sigue en vivo dónde va cada autobús y si va a su hora.
        </div>
        {avisoManual && <div style={{ fontSize: 11.5, color: C.amber, marginTop: 8 }}>{avisoManual}</div>}
        {estado?.ok ? (
          <div style={{ marginTop: 16, padding: 14, borderRadius: 9, background: "rgba(52,211,153,.08)", border: `1px solid ${C.green}55` }}>
            <div style={{ fontSize: 13, color: C.green, fontWeight: 700 }}>✓ Publicado el {fechaTxt(fecha)}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Los conductores ya lo ven en el móvil, en «Mi turno».</div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => { onCerrar(); irAControl(); }} style={btn(true)}>Ver en Control</button>
              <button onClick={onCerrar} style={btn(false)}>Cerrar</button>
            </div>
          </div>
        ) : (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, fontSize: 12.5, color: C.text }}>
              Día del servicio
              <input type="date" value={fecha} onChange={e => e.target.value && setFecha(e.target.value)} style={{ background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "6px 9px", fontSize: 12.5, fontFamily: font, colorScheme: "dark" }} />
              {fecha !== hoy && <button onClick={() => setFecha(hoy)} style={{ ...btn(false), padding: "4px 9px", fontSize: 11 }}>Hoy</button>}
            </label>
            <div style={{ fontSize: 11.5, marginTop: 6, color: vale ? C.dim : C.amber }}>
              {fechaTxt(fecha)}{vale ? "" : ` · ojo: «${nombreDia(dia, red)}» no circula ese día según el GTFS (se puede publicar igual, por ejemplo para una prueba)`}
              {yaHay ? " · ya publicado: se sustituye" : ""}
            </div>
            {estado?.error && <div style={{ fontSize: 12, color: C.red, marginTop: 10 }}>No se pudo publicar: {estado.error}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button onClick={onCerrar} style={btn(false)}>Cancelar</button>
              <button onClick={publicar} disabled={!!estado?.trabajando || !r.turnos} style={btn(true, !!estado?.trabajando || !r.turnos)}>{estado?.trabajando ? "Publicando…" : "Publicar"}</button>
            </div>
          </>
        )}
        {publicados.length > 0 && (
          <div style={{ marginTop: 18, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
            <div style={{ fontSize: 11, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Días publicados</div>
            {publicados.slice(-12).reverse().map(p => (
              <div key={p._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", fontSize: 12, color: p.fecha < hoy ? C.dim : C.text }}>
                <span style={{ flex: 1 }}>{fechaTxt(p.fecha)}{p.fecha === hoy ? " · hoy" : ""} <span style={{ color: C.dim }}>· {p.nombreDia} · {p.resumen?.turnos} turnos</span></span>
                <button onClick={() => quitar(p)} style={{ background: "none", border: "none", color: C.dim, fontSize: 11, cursor: "pointer", fontFamily: font, textDecoration: "underline" }}>quitar</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
