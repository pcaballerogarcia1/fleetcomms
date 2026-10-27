// Scheduling de líneas: Optimizar, el resumen de calendarios y el selector de líneas.
import { useState } from "react";
import { TIPOS_DIA } from "../gtfs-red.js";
import { costeDia, OBJETIVOS_VEHICULOS, OBJETIVOS_TURNOS, nombreDia, nombreEstrategia, porQueSinTipo, hayPrecios as hayPreciosP } from "../lineas-sched.js";
import { COLORES_CAL, fechaLarga, agruparVariantes, textoVariante } from "../lineas-horarios-util.js";
import { C, font, mono, nombreObjetivo, norm, num } from "./comun.js";
import { alfa } from "../tema.js";
import { AlertTriangle } from "lucide-react";

import { BotonCerrar } from "../ui/cerrar.jsx";

export function PanelOptimizar({ fase, p, diaNombre, objetivo, setObjetivo, opt, onOptimizar, onAplicar, onRestricciones, bloqueado, optJunto, onOptimizarJunto, onAplicarJunto, aFondo, setAFondo }) {
  const veh = fase === "vehiculos";
  const objetivos = veh ? OBJETIVOS_VEHICULOS : OBJETIVOS_TURNOS;
  const hayPrecio = o => !o.precios || o.precios.some(k => p[k] > 0);
  const corriendo = opt.estado === "corriendo";
  const lim = veh ? (p.flotaMax > 0 ? `flota ${p.flotaMax} autobuses` : null) : (p.conductoresMax > 0 ? `${p.conductoresMax} conductores` : null);
  const th = { fontSize: 11, color: C.dim, letterSpacing: 0.5, fontWeight: 700, padding: "5px 8px", textAlign: "right", textTransform: "uppercase", whiteSpace: "nowrap" };
  const td = { padding: "5px 8px", fontFamily: mono, fontSize: 12, textAlign: "right", color: C.text };
  const mejor = opt.probadas?.[0];
  const conCoste = opt.probadas?.some(r => r.coste != null);
  const columnas = veh
    ? [["Autobuses", r => num(r.autobuses), r => r.autobuses === mejor.autobuses], ["Bloques", r => num(r.bloques)], ["Vacíos", r => num(r.vacios)], ["Km vacío", r => num(r.kmVacio), r => r.kmVacio === mejor.kmVacio], ...(conCoste ? [["Coste/día", r => (r.coste != null ? `${num(r.coste)} €` : "—")]] : [])]
    : [["Turnos", r => num(r.turnos), r => r.turnos === mejor.turnos], ["Piezas/turno", r => r.piezasMedias.toFixed(1).replace(".", ",")], ["Horas pagadas", r => num(r.horasPagadas), r => r.horasPagadas === mejor.horasPagadas], ["Avisos", r => r.avisos], ...(conCoste ? [["Coste personal", r => (r.coste != null ? `${num(r.coste)} €` : "—")]] : [])];
  return (
    <div style={{ background: C.surface2, borderBottom: `1px solid ${C.border}`, padding: "14px 20px", flexShrink: 0, animation: "sched-fadein .15s ease both", maxHeight: "45vh", overflowY: "auto" }}>
      <div style={{ fontSize: 10, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>
        Optimizar {veh ? "paso 1 · vehículos" : "paso 2 · turnos"} <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>· {diaNombre} · {veh ? "después se rehacen los turnos en el paso 2" : "sobre los vehículos del paso 1, sin cambiarlos"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: C.muted }}>Objetivo</span>
        <div style={{ display: "flex", gap: 2, background: C.bg, borderRadius: 8, padding: 2 }}>
          {objetivos.map(o => {
            const off = !hayPrecio(o);
            return (
              <button key={o.id} disabled={off} onClick={() => setObjetivo(o.id)} title={off ? "Pon los precios en Restricciones" : o.ayuda}
                style={{ padding: "4px 10px", borderRadius: 4, border: "none", cursor: off ? "not-allowed" : "pointer", background: objetivo === o.id ? alfa(0.1) : "none", color: objetivo === o.id ? "#fff" : off ? C.dim : C.muted, fontSize: 11, fontWeight: objetivo === o.id ? 600 : 400, fontFamily: font }}>{o.nombre}</button>
            );
          })}
        </div>
        <span style={{ fontSize: 11, color: C.dim }}>
          Límite: {lim || "ninguno"} ·{" "}
          <button onClick={onRestricciones} style={{ background: "none", border: "none", padding: 0, color: C.blue, cursor: "pointer", fontSize: 11, fontFamily: font }}>cambiar en Restricciones</button>
        </span>
        {!veh && setAFondo && (
          <label title="Las dos mejores estrategias por partición se rehacen probando muchas más combinaciones de piezas. Suele quitar algún conductor más; tarda bastante más (de segundos a un par de minutos en redes muy grandes)."
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: aFondo ? C.text : C.muted, cursor: corriendo ? "default" : "pointer" }}>
            <input type="checkbox" checked={!!aFondo} disabled={corriendo} onChange={e => setAFondo(e.target.checked)} style={{ accentColor: C.blue, margin: 0 }} />
            A fondo <span style={{ color: C.dim }}>(tarda más)</span>
          </label>
        )}
        <button onClick={onOptimizar} disabled={corriendo || !!bloqueado} title={bloqueado || undefined} className="op-btn op-primario" style={{ marginLeft: !veh && setAFondo ? 0 : "auto", opacity: bloqueado ? 0.5 : 1 }}>
          {corriendo ? `Probando ${opt.progreso[0]} de ${opt.progreso[1] || "…"}` : veh ? "Optimizar vehículos" : "Optimizar turnos"}
        </button>
      </div>
      {corriendo && (
        <div style={{ height: 3, background: C.bg, borderRadius: 4, marginTop: 10, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${opt.progreso[1] ? (100 * opt.progreso[0]) / opt.progreso[1] : 3}%`, background: C.blue, transition: "width .2s" }} />
        </div>
      )}
      <div style={{ fontSize: 11, color: C.dim, marginTop: 8 }}>
        {veh
          ? "Prueba distintas formas de encadenar los viajes en los autobuses: qué autobús coge cada viaje, hasta cuántos km se hacen vacíos entre cabeceras y si un autobús cambia de línea. Mandan la flota disponible y después el objetivo."
          : `Prueba distintos largos de pieza y formas de repartirlas entre los conductores, sin tocar los autobuses. Todas respetan las Restricciones. Mandan los conductores disponibles, que no haya avisos legales y después el objetivo.${aFondo ? " «A fondo»: las dos mejores se rehacen probando muchas más combinaciones." : ""}`}
      </div>
      {opt.error && <div style={{ fontSize: 12, color: C.red, marginTop: 8 }}>No se ha podido optimizar: {opt.error}</div>}
      {opt.estado === "hecho" && mejor && (
        <>
          {!mejor.cumple && <div style={{ fontSize: 12, color: C.red, marginTop: 10 }}>Ninguna combinación cabe en {veh ? "la flota disponible" : "los conductores disponibles"}: hay que quitar viajes, relajar restricciones o ampliar {veh ? "la flota" : "la plantilla"}.</div>}
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
            <thead><tr>
              <th style={{ ...th, textAlign: "left" }}>#</th><th style={{ ...th, textAlign: "left" }}>Estrategia</th>
              {columnas.map(([t]) => <th key={t} style={th}>{t}</th>)}<th style={th} />
            </tr></thead>
            <tbody>
              {opt.probadas.slice(0, 8).map((r, i) => (
                <tr key={r.nombre + i} style={{ borderTop: `1px solid ${C.border}`, background: i === 0 ? "rgba(63,207,142,0.07)" : "none" }}>
                  <td style={{ ...td, textAlign: "left", color: i === 0 ? C.green : C.dim }}>{i + 1}</td>
                  <td style={{ ...td, textAlign: "left", fontFamily: font, fontSize: 12, color: C.muted }}>{r.nombre}{!r.cumple && <span style={{ color: C.red }}> · pasa del límite</span>}</td>
                  {columnas.map(([t, f, igual]) => <td key={t} style={{ ...td, color: igual ? (igual(r) ? C.text : C.muted) : C.muted }}>{f(r)}</td>)}
                  <td style={{ ...td, width: 110, whiteSpace: "nowrap" }}>
                    {opt.aplicada === i
                      ? <span style={{ fontSize: 11, color: C.green, fontFamily: font }}>En el escenario</span>
                      : <button onClick={() => onAplicar(i)} className="op-btn">Usar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>{opt.probadas.length} combinaciones probadas. La primera ya está aplicada{veh ? "; los turnos se rehacen en el paso 2" : ""}.</div>
        </>
      )}
      {optJunto && <OptimizarJunto p={p} opt={optJunto} ocupado={corriendo} bloqueado={bloqueado} onOptimizar={onOptimizarJunto} onAplicar={onAplicarJunto} onRestricciones={onRestricciones} />}
    </div>
  );
}

// Optimizar los dos pasos a la vez: cada forma de hacer los autobuses con sus
// turnos, por el coste del día entero (autobuses, conductores, km y cambios de autobús)
function OptimizarJunto({ p, opt, ocupado, bloqueado, onOptimizar, onAplicar, onRestricciones }) {
  const corriendo = opt.estado === "corriendo";
  const mejor = opt.probadas?.[0];
  const th = { fontSize: 11, color: C.dim, letterSpacing: 0.5, fontWeight: 700, padding: "5px 8px", textAlign: "right", textTransform: "uppercase", whiteSpace: "nowrap" };
  const td = { padding: "5px 8px", fontFamily: mono, fontSize: 12, textAlign: "right", color: C.muted };
  const pr = opt.precios;
  const orientativos = pr && !(p.costeVehiculoDia > 0 && p.costeHora > 0);
  const cols = [
    ["Autobuses", r => num(r.autobuses)], ["Turnos", r => num(r.turnos)], ["Horas pagadas", r => num(r.horasPagadas)],
    ["Cambios de bus", r => num(r.cambiosBus)], ["Km vacío", r => num(r.kmVacio)], ["Coste/día", r => `${num(r.coste)} €`],
  ];
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 14, paddingTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 10, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600 }}>
          Optimizar todo junto <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>· vehículos y turnos a la vez, por el coste del día entero</span>
        </div>
        <button onClick={onOptimizar} disabled={corriendo || ocupado || !!bloqueado} title={bloqueado || undefined} style={{ marginLeft: "auto", opacity: bloqueado ? 0.5 : 1, padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.green}`, background: "rgba(63,207,142,0.12)", color: C.green, fontSize: 12, fontWeight: 600, cursor: corriendo ? "wait" : "pointer", fontFamily: font }}>
          {corriendo ? `Probando ${opt.progreso[0]} de ${opt.progreso[1] || "…"}` : "Optimizar todo junto"}
        </button>
      </div>
      {corriendo && (
        <div style={{ height: 3, background: C.bg, borderRadius: 4, marginTop: 10, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${opt.progreso[1] ? (100 * opt.progreso[0]) / opt.progreso[1] : 3}%`, background: C.green, transition: "width .2s" }} />
        </div>
      )}
      <div style={{ fontSize: 11, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>
        Por pasos, primero se eligen los autobuses (los menos posibles) y luego los turnos encima. Aquí, cada forma de hacer los autobuses
        se prueba con sus turnos y gana la que menos cuesta en total: a veces un autobús más ahorra conductores, horas o cambios de autobús.
        También prueba autobuses que vuelven a cochera al largo de un turno.
      </div>
      {opt.error && <div style={{ fontSize: 12, color: C.red, marginTop: 8 }}>No se ha podido optimizar: {opt.error}</div>}
      {opt.estado === "hecho" && mejor && (
        <>
          {!mejor.cumple && <div style={{ fontSize: 12, color: C.red, marginTop: 10 }}>Ninguna combinación cabe en la flota o los conductores disponibles.</div>}
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
            <thead><tr>
              <th style={{ ...th, textAlign: "left" }}>#</th><th style={{ ...th, textAlign: "left" }}>Estrategia</th>
              {cols.map(([t]) => <th key={t} style={th}>{t}</th>)}<th style={th} />
            </tr></thead>
            <tbody>
              {opt.probadas.slice(0, 8).map((r, i) => (
                <tr key={r.nombre + i} style={{ borderTop: `1px solid ${C.border}`, background: i === 0 ? "rgba(63,207,142,0.07)" : "none" }}>
                  <td style={{ ...td, textAlign: "left", color: i === 0 ? C.green : C.dim }}>{i + 1}</td>
                  <td style={{ ...td, textAlign: "left", fontFamily: font }}>{r.nombre}{!r.cumple && <span style={{ color: C.red }}> · pasa del límite</span>}{r.avisos > 0 && <span style={{ color: C.amber }}> · {r.avisos} turnos con aviso</span>}</td>
                  {cols.map(([t, f]) => <td key={t} style={{ ...td, color: i === 0 ? C.text : C.muted }}>{f(r)}</td>)}
                  <td style={{ ...td, width: 110, whiteSpace: "nowrap" }}>
                    {opt.aplicada === i
                      ? <span style={{ fontSize: 11, color: C.green, fontFamily: font }}>En el escenario</span>
                      : <button onClick={() => onAplicar(i)} className="op-btn">Usar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>
            {opt.probadas.length} combinaciones probadas; la primera ya está aplicada (vehículos y turnos).
            {orientativos && <> Con precios orientativos ({num(pr.costeVehiculoDia)} €/autobús·día, {String(pr.costeHora).replace(".", ",")} €/h, {String(pr.costeKm).replace(".", ",")} €/km, {num(pr.costeCambioBus)} € por cambio de autobús): <button onClick={onRestricciones} style={{ background: "none", border: "none", padding: 0, color: C.blue, cursor: "pointer", fontSize: 11, fontFamily: font }}>pon los tuyos en Restricciones</button>.</>}
          </div>
        </>
      )}
    </div>
  );
}

// ── Por qué hay turnos sin tipo ─────────────────────────────────────────
export function PorQueSinTipo({ res, p, onRestricciones }) {
  const [abierto, setAbierto] = useState(true);
  const d = res?.turnos ? porQueSinTipo(res.turnos, p, res.kpis) : null;
  if (!d) return null;
  return (
    <div style={{ padding: "7px 16px", fontSize: 12, color: C.text, background: "rgba(245,184,74,0.07)", borderBottom: "1px solid rgba(245,184,74,0.3)", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: C.amber, fontWeight: 700 }}><AlertTriangle size={12} style={{ verticalAlign: "-2px" }} /> {num(d.total)} turno{d.total > 1 ? "s" : ""} sin tipo</span>
        <button onClick={() => setAbierto(a => !a)} style={{ background: "none", border: "none", padding: 0, color: C.blue, cursor: "pointer", fontSize: 12, fontFamily: font }}>{abierto ? "ocultar por qué" : "ver por qué"}</button>
        <button onClick={onRestricciones} className="op-btn" style={{ marginLeft: "auto" }}>Cambiar en Restricciones</button>
      </div>
      {abierto && (
        <ul style={{ margin: "6px 0 2px", paddingLeft: 18, lineHeight: 1.6, maxHeight: 150, overflowY: "auto" }}>
          {d.cambiosAgotados != null && (
            <li><b>Se han gastado los {num(d.cambiosAgotados)} cambios de autobús del escenario</b>: los trozos sueltos de un autobús no se pueden juntar con los de otro. <span style={{ color: C.muted }}>→ Sube «Cambios de autobús en todo el escenario».</span></li>
          )}
          {d.grupos.slice(0, 6).map((g, i) => (
            <li key={i}><b>{num(g.n)}</b> {g.texto}. <span style={{ color: C.muted }}>→ {g.consejo.charAt(0).toUpperCase() + g.consejo.slice(1)}.</span></li>
          ))}
          {d.grupos.length > 6 && <li style={{ color: C.muted }}>…y {num(d.grupos.slice(6).reduce((s, g) => s + g.n, 0))} más por otros motivos.</li>}
        </ul>
      )}
    </div>
  );
}

// ── Resumen de todos los calendarios ────────────────────────────────────
export function ResumenCalendarios({ red, porCalendario, claveDe, claveVDe, precios, diaActual, objetivoV, setObjetivoV, objetivoT, setObjetivoT, lote, pendientes, ocupado, onVer, onLote, onParar, onRestricciones }) {
  const cals = red.calendarios || [];
  const filasTipo = TIPOS_DIA.map(t => ({ id: t.id, nombre: t.nombre, detalle: red.dias?.[t.id] ? `día de referencia ${fechaLarga(red.dias[t.id])}` : "sin servicio", dias: null }));
  const filasCal = cals.map((c, i) => ({ id: c.id, nombre: c.nombre, detalle: c.codigos?.join(", "), dias: c.fechas.length, color: COLORES_CAL[i % COLORES_CAL.length], viajesGtfs: c.viajes }));
  const estadoDe = id => {
    const r = porCalendario[id];
    if (!r?.resumen) return "nada";
    if (r.resumen.turnos == null) return r.claveV === claveVDe(id) ? "sinTurnos" : "viejo";
    return r.clave !== claveDe(id) ? "viejo" : "ok";
  };
  const hayPrecios = hayPreciosP(precios);
  const todas = [...filasTipo, ...filasCal];
  const pendientesCalc = todas.filter(f => estadoDe(f.id) !== "ok").map(f => f.id);
  const bloqueo = lote ? "Ya hay un cálculo en marcha" : ocupado ? "Hay una optimización en marcha" : pendientes ? "Genera primero el escenario con los cambios de Restricciones" : null;
  // totales del periodo (solo calendarios del GTFS, que no se solapan)
  const calc = filasCal.filter(f => porCalendario[f.id]?.resumen);
  const tot = calc.reduce((a, f) => {
    const r = porCalendario[f.id].resumen, c = r.turnos == null ? null : costeDia(r, { ...precios, dia: f.id }); // (el recargo de festivo, según el día)
    return { dias: a.dias + f.dias, viajes: a.viajes + r.viajes * f.dias, horas: a.horas + (r.horasPagadas || 0) * f.dias, km: a.km + r.km * f.dias, kmVacio: a.kmVacio + (r.kmVacio || 0) * f.dias, coste: c == null ? a.coste : (a.coste ?? 0) + c * f.dias, buses: Math.max(a.buses, r.autobuses), turnos: Math.max(a.turnos, r.turnos ?? 0) };
  }, { dias: 0, viajes: 0, horas: 0, km: 0, kmVacio: 0, coste: null, buses: 0, turnos: 0 });
  const th = { fontSize: 11, color: C.dim, letterSpacing: 0.5, fontWeight: 700, padding: "7px 10px", textAlign: "right", textTransform: "uppercase", whiteSpace: "nowrap", position: "sticky", top: 0, background: C.card, zIndex: 1 };
  const td = { padding: "6px 10px", fontFamily: mono, fontSize: 12, textAlign: "right", whiteSpace: "nowrap" };
  const boton = (texto, onClick, principal, titulo) => (
    <button onClick={onClick} disabled={!!bloqueo} title={bloqueo || titulo} style={{ padding: "6px 12px", borderRadius: 8, border: principal ? "none" : `1px solid ${C.border2}`, background: principal ? C.blue : "none", color: principal ? "#fff" : C.text, fontSize: 12, fontWeight: 600, cursor: bloqueo ? "not-allowed" : "pointer", opacity: bloqueo ? 0.5 : 1, fontFamily: font, flexShrink: 0 }}>{texto}</button>
  );
  const fila = f => {
    const r = porCalendario[f.id], est = estadoDe(f.id), x = r?.resumen;
    const viejo = est === "viejo";
    const c = x && x.turnos != null ? costeDia(x, { ...precios, dia: f.id }) : null;
    const enCurso = lote?.dia === f.id;
    const col = viejo ? C.dim : C.text;
    return (
      <tr key={f.id} style={{ borderTop: `1px solid ${C.border}`, background: f.id === diaActual ? "rgba(91,124,250,0.07)" : enCurso ? "rgba(245,184,74,0.06)" : "none" }}>
        <td style={{ ...td, textAlign: "left", fontFamily: font, maxWidth: 340 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 9, height: 9, borderRadius: 4, background: f.color || "transparent", border: f.color ? "none" : `1px solid ${C.dim}`, flexShrink: 0 }} />
            <span style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: C.text, overflow: "hidden", textOverflow: "ellipsis" }}>{f.nombre}{f.id === diaActual && <span style={{ color: C.blue, fontSize: 10 }}> · en pantalla</span>}</div>
              {f.detalle && <div style={{ fontSize: 10, color: C.dim, overflow: "hidden", textOverflow: "ellipsis" }}>{f.detalle}</div>}
            </span>
          </div>
        </td>
        <td style={{ ...td, color: C.muted }}>{f.dias ?? "—"}</td>
        <td style={{ ...td, color: col }}>{x ? num(x.viajes) : f.viajesGtfs != null ? <span style={{ color: C.dim }}>{num(f.viajesGtfs)}</span> : "—"}</td>
        <td style={{ ...td, color: col, fontWeight: 700 }}>{x ? num(x.autobuses) : "—"}</td>
        <td style={{ ...td, color: col, fontWeight: 700 }}>{x && x.turnos != null ? num(x.turnos) : "—"}</td>
        <td style={{ ...td, color: viejo ? C.dim : C.muted }}>{x ? num(x.kmVacio || 0) : "—"}</td>
        <td style={{ ...td, color: col }}>{x && x.horasPagadas != null ? num(x.horasPagadas) : "—"}</td>
        <td style={{ ...td, color: x?.avisos ? C.red : C.dim }}>{x && x.avisos != null ? x.avisos : "—"}</td>
        {hayPrecios && <td style={{ ...td, color: col }}>{c != null ? `${num(c)} €` : "—"}</td>}
        {hayPrecios && <td style={{ ...td, color: col }}>{c != null && f.dias ? `${num(c * f.dias)} €` : "—"}</td>}
        <td style={{ ...td, textAlign: "left", fontFamily: font, fontSize: 11 }}>
          {enCurso ? <span style={{ color: C.amber }}>{lote.optimizar ? "Optimizando…" : "Calculando…"}</span>
            : est === "nada" ? <span style={{ color: C.dim }}>Sin calcular</span>
            : viejo ? <span style={{ color: C.amber }} title="Han cambiado las restricciones, las líneas, las cocheras o su configuración desde que se calculó">Desactualizado</span>
            : est === "sinTurnos" ? <span style={{ color: C.amber }} title="Solo se ha hecho el paso 1 (vehículos)">Faltan los turnos</span>
            : r.objetivoV || r.objetivoT ? <span style={{ color: C.green }} title={nombreEstrategia(r.estrategia || {}, precios.piezaMax)}>Optimizado · {[r.objetivoV && nombreObjetivo(r.objetivoV), r.objetivoT && nombreObjetivo(r.objetivoT)].filter(Boolean).join(" · ")}</span>
            : <span style={{ color: C.muted }} title={nombreEstrategia(r.estrategia || {}, precios.piezaMax)}>Calculado</span>}
        </td>
        <td style={td}><div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button onClick={() => onVer(f.id)} className="op-btn">Ver</button>
          <button onClick={() => onLote([f.id], true)} disabled={!!bloqueo} title={bloqueo || `Optimizar solo este calendario: vehículos (${nombreObjetivo(objetivoV)}) y turnos (${nombreObjetivo(objetivoT)})`} className="op-btn" style={{ opacity: bloqueo ? 0.5 : 1 }}>Optimizar</button>
        </div></td>
      </tr>
    );
  };
  const cabeceraTabla = (
    <thead><tr>
      <th style={{ ...th, textAlign: "left" }}>Calendario</th><th style={th}>Días</th><th style={th}>Viajes/día</th><th style={th}>Autobuses</th><th style={th}>Turnos</th><th style={th}>Km vacío</th><th style={th}>Horas pagadas</th><th style={th}>Avisos</th>
      {hayPrecios && <th style={th}>Coste/día</th>}{hayPrecios && <th style={th}>Coste periodo</th>}<th style={{ ...th, textAlign: "left" }}>Estado</th><th style={th} />
    </tr></thead>
  );
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "0 16px", minHeight: 46, borderBottom: `1px solid ${C.border}`, background: C.card, flexShrink: 0, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {[["Paso 1 · Vehículos", OBJETIVOS_VEHICULOS, objetivoV, setObjetivoV], ["Paso 2 · Turnos", OBJETIVOS_TURNOS, objetivoT, setObjetivoT]].map(([t, lista, val, set]) => (
          <div key={t} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: C.muted }}>{t}</span>
            <div style={{ display: "flex", gap: 2, background: C.bg, borderRadius: 8, padding: 2 }}>
              {lista.map(o => {
                const off = o.precios && !o.precios.some(k => precios[k] > 0);
                return <button key={o.id} disabled={off} onClick={() => set(o.id)} title={off ? "Pon los precios en Restricciones" : o.ayuda} style={{ padding: "4px 9px", borderRadius: 4, border: "none", cursor: off ? "not-allowed" : "pointer", background: val === o.id ? alfa(0.1) : "none", color: val === o.id ? "#fff" : off ? C.dim : C.muted, fontSize: 11, fontWeight: val === o.id ? 600 : 400, fontFamily: font }}>{o.nombre}</button>;
              })}
            </div>
          </div>
        ))}
        {!hayPrecios && <button onClick={onRestricciones} style={{ background: "none", border: "none", padding: 0, color: C.blue, cursor: "pointer", fontSize: 11, fontFamily: font }}>poner precios para ver el coste</button>}
        <div style={{ flex: 1 }} />
        {lote ? (
          <>
            <div style={{ width: 180, height: 4, background: C.bg, borderRadius: 4, overflow: "hidden" }}><div style={{ height: "100%", width: `${(100 * (lote.progreso[0] + 0.5)) / lote.progreso[1]}%`, background: C.blue }} /></div>
            <span style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>{lote.progreso[0] + 1}/{lote.progreso[1]} · {nombreDia(lote.dia, red)}</span>
            <button onClick={onParar} style={{ padding: "5px 10px", borderRadius: 8, background: "none", border: `1px solid ${C.red}66`, color: C.red, fontSize: 11, cursor: "pointer", fontFamily: font }}>Parar</button>
          </>
        ) : (
          <>
            {boton(`Calcular pendientes (${pendientesCalc.length})`, () => onLote(pendientesCalc, false), false, "Calcula los dos pasos, con su estrategia, de los calendarios sin calcular, sin turnos o desactualizados")}
            {boton(`Optimizar todos (${todas.length})`, () => onLote(todas.map(f => f.id), true), true, "Optimiza cada calendario por separado: primero los vehículos y después los turnos, con los objetivos elegidos")}
          </>
        )}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "0 0 16px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          {cabeceraTabla}
          <tbody>
            <tr><td colSpan={12} style={{ padding: "12px 10px 4px", fontSize: 10, color: C.dim, letterSpacing: 1.5, fontWeight: 700 }}>TIPOS DE DÍA (DÍA DE REFERENCIA)</td></tr>
            {filasTipo.map(fila)}
            {filasCal.length > 0 && <tr><td colSpan={12} style={{ padding: "14px 10px 4px", fontSize: 10, color: C.dim, letterSpacing: 1.5, fontWeight: 700 }}>CALENDARIOS DEL GTFS ({filasCal.length})</td></tr>}
            {filasCal.map(fila)}
            {calc.length > 0 && (
              <tr style={{ borderTop: `1px solid ${C.border2}`, background: C.surface2 }}>
                <td style={{ ...td, textAlign: "left", fontFamily: font, fontSize: 12, fontWeight: 700, color: C.text }}>
                  Periodo del GTFS{calc.length < filasCal.length && <span style={{ color: C.amber, fontWeight: 400 }}> · faltan {filasCal.length - calc.length} calendarios</span>}
                </td>
                <td style={{ ...td, color: C.text }}>{tot.dias}</td>
                <td style={{ ...td, color: C.text }} title="Viajes de todo el periodo">{num(tot.viajes)}</td>
                <td style={{ ...td, color: C.text, fontWeight: 700 }} title="Flota necesaria: el máximo de un día">{num(tot.buses)} máx.</td>
                <td style={{ ...td, color: C.text, fontWeight: 700 }} title="Turnos del día con más">{num(tot.turnos)} máx.</td>
                <td style={{ ...td, color: C.text }} title="Km en vacío de todo el periodo">{num(tot.kmVacio)}</td>
                <td style={{ ...td, color: C.text }} title="Horas pagadas de todo el periodo">{num(tot.horas)}</td>
                <td style={td} />
                {hayPrecios && <td style={td} />}
                {hayPrecios && <td style={{ ...td, color: C.text, fontWeight: 700 }}>{tot.coste != null ? `${num(tot.coste)} €` : "—"}</td>}
                <td colSpan={2} style={{ ...td, textAlign: "left", fontFamily: font, fontSize: 11, color: C.dim }}>viajes, horas y coste: suma de los días del periodo</td>
              </tr>
            )}
          </tbody>
        </table>
        {!cals.length && <div style={{ padding: "10px 16px", fontSize: 11, color: C.dim }}>Esta red se importó antes de leer los calendarios. Vuelve a importar el GTFS en Planificación («Sustituir red») para tener todos los calendarios.</div>}
        <div style={{ padding: "10px 16px", fontSize: 11, color: C.dim, lineHeight: 1.6 }}>
          Cada calendario tiene su propio escenario y su propia estrategia: optimizar uno no cambia los demás. Las restricciones (jornada, pausas, flota…) son comunes a todos. Los costes usan los precios actuales de Restricciones.
        </div>
      </div>
    </div>
  );
}

export function SelectorLineas({ lineas, elegidas, onCambiar, onCerrar }) {
  const [q, setQ] = useState("");
  const set = new Set(elegidas || lineas.map(l => l.id));
  const vis = lineas.filter(l => !q.trim() || norm(`${l.nombre} ${l.sentidos.map(s => s.cabecera).join(" ")} ${l.tipo}`).includes(norm(q.trim())));
  const poner = ids => onCambiar(ids.length === lineas.length ? null : ids);
  const grupos = agruparVariantes(vis);
  const [abiertos, setAbiertos] = useState(() => new Set());
  return (
    <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50, width: 360, background: C.card, border: `1px solid ${C.border2}`, borderRadius: 12, boxShadow: "0 14px 40px rgba(0,0,0,0.45)", padding: 10 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar línea…" style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: "6px 9px", fontSize: 12, fontFamily: font, outline: "none" }} />
        <BotonCerrar onClick={onCerrar} />
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        {[["Marcar visibles", () => poner([...new Set([...set, ...vis.map(l => l.id)])])], ["Quitar visibles", () => poner([...set].filter(id => !vis.some(l => l.id === id)))], ["Todas", () => poner(lineas.map(l => l.id))]].map(([t, f]) => (
          <button key={t} onClick={f} className="op-btn">{t}</button>
        ))}
      </div>
      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {grupos.slice(0, 300).map(g => {
          const fila = (l, variante) => (
            <label key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: variante ? "3px 4px 3px 26px" : "4px 4px", cursor: "pointer" }}>
              <input type="checkbox" checked={set.has(l.id)} onChange={() => poner(set.has(l.id) ? [...set].filter(x => x !== l.id) : [...set, l.id])} />
              {!variante && <span style={{ minWidth: 34, padding: "1px 5px", borderRadius: 4, background: l.color, color: C.input, fontSize: 11, fontWeight: 800, textAlign: "center" }}>{l.nombre}</span>}
              <span style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{variante ? textoVariante(l) : l.sentidos.map(s => s.cabecera).join(" ↔ ")}</span>
            </label>
          );
          if (g.lineas.length === 1) return fila(g.lineas[0], false);
          const ids = g.lineas.map(l => l.id);
          const n = ids.filter(id => set.has(id)).length;
          const abierto = abiertos.has(g.clave) || !!q.trim();
          return (
            <div key={g.clave}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 4px" }}>
                <input type="checkbox" checked={n === ids.length} ref={el => { if (el) el.indeterminate = n > 0 && n < ids.length; }}
                  onChange={() => poner(n < ids.length ? [...new Set([...set, ...ids])] : [...set].filter(id => !ids.includes(id)))} />
                <span style={{ minWidth: 34, padding: "1px 5px", borderRadius: 4, background: g.lineas[0].color, color: C.input, fontSize: 11, fontWeight: 800, textAlign: "center" }}>{g.nombre}</span>
                <button onClick={() => setAbiertos(prev => { const x = new Set(prev); if (x.has(g.clave)) x.delete(g.clave); else x.add(g.clave); return x; })}
                  style={{ flex: 1, textAlign: "left", background: "none", border: "none", padding: 0, fontSize: 11, color: C.muted, cursor: "pointer", fontFamily: font }}>{abierto ? "▾" : "▸"} {n < ids.length ? `${n} de ` : ""}{ids.length} variantes</button>
              </div>
              {abierto && g.lineas.map(l => fila(l, true))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
