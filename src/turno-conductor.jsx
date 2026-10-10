// ── «Mi turno» en el móvil del conductor de autobús (proyectos de líneas) ──
// El conductor coge su turno del servicio publicado, lo empieza, y mientras
// conduce el móvil (con la pantalla encendida) va mirando el GPS: marca solo
// cuándo sale y llega cada expedición y calcula si va a su hora. Control lo
// ve en vivo. No hace falta tocar nada mientras se conduce.
import { useState, useEffect, useMemo, useRef } from "react";
import { watchMisTurnos, cogerTurno, dejarTurno, empezarTurno, terminarTurno, guardarReal, escribirPosicion } from "./lineas-servicio-store.js";
import { minutosDesde, hhmm, avanzar, retrasoActual, viajeActual, estadoPuntualidad, COLOR_PUNTUALIDAD, textoRetraso, servicioVigente } from "./lineas-servicio.js";

const C = {
  bg: "#0d1117", card: "#161b27", surface2: "#1c2333", border: "#252d3d", border2: "#2e3a50",
  text: "#e6edf3", muted: "#8b949e", dim: "#484f58", blue: "#58a6ff", blueDim: "#0d2044", blueText: "#79b8ff", green: "#3fb950", amber: "#d29922", red: "#f85149",
};
const font = '"Inter","Segoe UI",system-ui,sans-serif';
const mono = '"JetBrains Mono","Fira Mono",monospace';
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const ENVIO_MS = 30000; // la posición se manda como mucho cada 30 s (cuota de Firestore)
const fechaTxt = f => new Date(f + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });

function ListaTurnos({ servicio, sesion, onError }) {
  const [q, setQ] = useState("");
  const [cogiendo, setCogiendo] = useState(null);
  const lista = (servicio.lista || []).filter(t => !q.trim() || norm(`${t.id} ${t.num} ${(t.buses || []).join(" ")} ${(t.lineas || []).join(" ")}`).includes(norm(q.trim())));
  async function coger(t) {
    setCogiendo(t.id); onError(null);
    try { await cogerTurno(servicio._id, t.id, { uid: sesion.uid, nombre: [sesion.nombre, sesion.apellidos].filter(Boolean).join(" ") }); }
    catch (e) { onError(e.message || String(e)); }
    setCogiendo(null);
  }
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>¿Qué turno haces hoy?</div>
      <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>{servicio.proyecto ? `${servicio.proyecto} · ` : ""}{fechaTxt(servicio.fecha)} · {servicio.lista?.length || 0} turnos</div>
      <input value={q} onChange={e => setQ(e.target.value)} inputMode="search" placeholder="Número de turno, bus o línea…" style={{ width: "100%", boxSizing: "border-box", marginTop: 12, background: C.surface2, border: `1px solid ${C.border2}`, color: C.text, borderRadius: 10, padding: "12px 14px", fontSize: 15, fontFamily: font, outline: "none" }} />
      <div style={{ marginTop: 10 }}>
        {lista.slice(0, 80).map(t => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ width: 52, fontSize: 17, fontWeight: 800, color: C.text }}>{t.id}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, color: C.text, fontFamily: mono }}>{hhmm(t.inicio)} – {hhmm(t.fin)}</div>
              <div style={{ fontSize: 12, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.tipo ? `${t.tipo} · ` : ""}Bus {(t.buses || []).join(" + ")} · líneas {(t.lineas || []).join(", ")}</div>
            </div>
            <button onClick={() => coger(t)} disabled={!!cogiendo} style={{ padding: "10px 14px", borderRadius: 9, border: "none", background: C.blue, color: "#0b1220", fontWeight: 700, fontSize: 13.5, fontFamily: font, cursor: "pointer", opacity: cogiendo && cogiendo !== t.id ? 0.5 : 1 }}>{cogiendo === t.id ? "…" : "Coger"}</button>
          </div>
        ))}
        {!lista.length && <div style={{ padding: 20, fontSize: 13, color: C.muted, textAlign: "center" }}>Ningún turno con «{q}».</div>}
      </div>
    </div>
  );
}

function HojaTurno({ servicio, turno, sesion }) {
  const sid = servicio._id;
  const empezado = turno.inicioReal != null, terminado = turno.finReal != null;
  const enMarcha = empezado && !terminado;
  // Lo real: lo lleva este móvil (solo él lo escribe); al abrir, se parte de lo guardado
  // (el componente va con key = turno, así que esto se lee una vez por turno)
  const [real, setReal] = useState(() => turno.real || {});
  const realRef = useRef(real);
  const turnoRef = useRef(turno);
  useEffect(() => { turnoRef.current = turno; }, [turno]);
  const [vivo, setVivo] = useState({ actual: viajeActual(turno, turno.real || {}), frac: null, retraso: null, fuera: false, gps: null, error: null });
  const [ahoraMs, setAhoraMs] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAhoraMs(Date.now()), 20000); return () => clearInterval(t); }, []);
  const ahora = minutosDesde(servicio.fecha, ahoraMs);

  // GPS mientras el turno está en marcha
  useEffect(() => {
    if (!enMarcha) return;
    if (!navigator.geolocation) return; // se avisa abajo
    let ultimoEnvio = 0, ultimoRetraso = null, ultimoActual = null;
    let wake = null;
    navigator.wakeLock?.request?.("screen").then(w => { wake = w; }, () => {});
    const id = navigator.geolocation.watchPosition(pos => {
      const now = Date.now();
      const p = [pos.coords.latitude, pos.coords.longitude];
      const min = minutosDesde(servicio.fecha, now);
      const turno = turnoRef.current;
      const r = avanzar(turno, realRef.current, p, min);
      realRef.current = r.real;
      if (r.cambios.length) { setReal(r.real); guardarReal(sid, turno.id, r.real).catch(e => console.error("[turno] guardando lo real:", e)); }
      const retraso = r.actual >= 0 ? retrasoActual(turno, r.real, r.actual, r.frac, min) : 0;
      const v = turno.viajes[r.actual];
      setVivo({ actual: r.actual, frac: r.frac, retraso, fuera: r.fuera, gps: { precision: Math.round(pos.coords.accuracy || 0), en: now }, error: null });
      // se manda cada 30 s, o antes si cambia de viaje o el retraso cambia 2 min o más
      const cambio = r.actual !== ultimoActual || ultimoRetraso == null || Math.abs(retraso - ultimoRetraso) >= 2;
      if (now - ultimoEnvio >= ENVIO_MS || (cambio && now - ultimoEnvio >= 5000)) {
        ultimoEnvio = now; ultimoRetraso = retraso; ultimoActual = r.actual;
        escribirPosicion(sesion.uid, {
          org_id: sesion.org_id ?? null, nombre: [sesion.nombre, sesion.apellidos].filter(Boolean).join(" "),
          servicioId: sid, turnoId: turno.id, bus: v?.bus ?? null, linea: v && !v.v ? v.l : null,
          viaje: v ? `${v.v ? "Vacío" : `Línea ${v.l}`}: ${v.on} → ${v.dn} (${hhmm(v.dep)})` : "Fin de los viajes",
          lat: Math.round(p[0] * 1e5) / 1e5, lng: Math.round(p[1] * 1e5) / 1e5, retraso, activo: true,
        }).catch(e => console.error("[turno] posición:", e));
      }
    }, e => setVivo(v => ({ ...v, error: e.code === 1 ? "Sin permiso para el GPS: actívalo para este sitio en los ajustes del navegador." : `GPS: ${e.message}` })),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    return () => { navigator.geolocation.clearWatch(id); wake?.release?.().catch(() => {}); };
  }, [enMarcha, sid, servicio.fecha, sesion.uid, sesion.org_id, sesion.nombre, sesion.apellidos]);

  async function empezar() {
    if (ahora < turno.inicio - 60 && !window.confirm(`Tu turno empieza a las ${hhmm(turno.inicio)}. ¿Empezar ya?`)) return;
    await empezarTurno(sid, turno.id, ahora).catch(e => alert("No se pudo empezar: " + (e.message || e)));
  }
  async function terminar() {
    if (!window.confirm("¿Terminar el turno? Se deja de mandar tu posición.")) return;
    await terminarTurno(sid, turno.id, ahora).catch(e => alert("No se pudo terminar: " + (e.message || e)));
    escribirPosicion(sesion.uid, { org_id: sesion.org_id ?? null, servicioId: sid, turnoId: turno.id, activo: false }).catch(() => {});
  }
  async function dejar() {
    if (!window.confirm(`¿Dejar el ${turno.id}? Quedará libre para otro conductor.`)) return;
    await dejarTurno(sid, turno.id).catch(e => alert("No se pudo dejar: " + (e.message || e)));
  }

  const actual = enMarcha ? vivo.actual : viajeActual(turno, turno.real || {});
  const v = turno.viajes[actual];
  const retraso = enMarcha ? vivo.retraso : null;
  const est = estadoPuntualidad(retraso);
  const salt = new Set(real.saltados || []);
  const primero = turno.viajes[0];
  const btnGrande = color => ({ width: "100%", padding: "16px", borderRadius: 12, border: "none", background: color, color: "#0b1220", fontSize: 17, fontWeight: 800, fontFamily: font, cursor: "pointer" });
  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.text }}>{turno.id}</div>
        <div style={{ fontSize: 13, color: C.muted }}>{turno.tipo ? `${turno.tipo} · ` : ""}{hhmm(turno.inicio)} – {hhmm(turno.fin)}</div>
      </div>
      <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>{servicio.proyecto ? `${servicio.proyecto} · ` : ""}{fechaTxt(servicio.fecha)}</div>

      {!empezado && (
        <div style={{ marginTop: 14, padding: 16, borderRadius: 12, background: C.card, border: `1px solid ${C.border2}` }}>
          <div style={{ fontSize: 14, color: C.text, lineHeight: 1.5 }}>Empiezas a las <b>{hhmm(turno.inicio)}</b> en <b>{primero?.on || "cabecera"}</b> con el <b>Bus {primero?.bus}</b>.</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Al empezar, el móvil manda tu posición y marca solo cada expedición. Deja la pantalla encendida (en el soporte) y el GPS activado.</div>
          <button onClick={empezar} style={{ ...btnGrande(C.green), marginTop: 14 }}>Empezar turno</button>
          <button onClick={dejar} style={{ marginTop: 10, width: "100%", padding: 10, background: "none", border: `1px solid ${C.border2}`, borderRadius: 10, color: C.muted, fontSize: 13, fontFamily: font, cursor: "pointer" }}>No es mi turno: dejarlo</button>
        </div>
      )}

      {enMarcha && (
        <div style={{ marginTop: 14, padding: 16, borderRadius: 12, background: C.card, border: `2px solid ${COLOR_PUNTUALIDAD[est]}` }}>
          {v ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {!v.v && <span style={{ padding: "3px 9px", borderRadius: 7, background: v.color, color: "#0b1220", fontWeight: 800, fontSize: 16 }}>{v.l}</span>}
                <span style={{ fontSize: 13, color: C.muted }}>Bus {v.bus}</span>
                <span style={{ marginLeft: "auto", fontSize: 22, fontWeight: 800, color: COLOR_PUNTUALIDAD[est], fontFamily: mono }}>{retraso == null ? "…" : textoRetraso(retraso)}</span>
              </div>
              <div style={{ fontSize: 16, color: C.text, fontWeight: 600, marginTop: 10 }}>{v.on} → {v.dn}</div>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
                {real.salidas?.[v.k] != null ? `Salió ${hhmm(real.salidas[v.k])} · llega a las ${hhmm(v.arr)}` : `Sale a las ${hhmm(v.dep)}`}
              </div>
              {(() => {
                const sig = turno.viajes.slice(actual + 1).find(x => !x.v);
                if (!sig) return <div style={{ fontSize: 12, color: C.dim, marginTop: 8 }}>Último viaje del turno.</div>;
                const relevo = sig.bus !== v.bus;
                return <div style={{ fontSize: 12, color: relevo ? C.amber : C.dim, marginTop: 8 }}>{relevo ? `Después: cambias al Bus ${sig.bus} en ${sig.on} (${hhmm(sig.dep)})` : `Después: ${sig.on} → ${sig.dn} a las ${hhmm(sig.dep)}`}</div>;
              })()}
            </>
          ) : <div style={{ fontSize: 15, color: C.text }}>Has terminado los viajes del turno. Cuando dejes el autobús, pulsa «Terminar turno».</div>}
          <div style={{ fontSize: 11, color: vivo.error ? C.red : C.dim, marginTop: 10 }}>
            {(typeof navigator !== "undefined" && !navigator.geolocation ? "Este móvil no tiene GPS disponible en el navegador." : null) || vivo.error || (vivo.gps ? `GPS ±${vivo.gps.precision} m · ${new Date(vivo.gps.en).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}${vivo.fuera ? " · fuera del recorrido" : ""}` : "Buscando GPS…")}
          </div>
          <button onClick={terminar} style={{ ...btnGrande(C.surface2), color: C.text, border: `1px solid ${C.border2}`, marginTop: 14, fontSize: 14, padding: 12 }}>Terminar turno</button>
        </div>
      )}
      {terminado && <div style={{ marginTop: 14, padding: 14, borderRadius: 12, background: C.card, border: `1px solid ${C.border2}`, fontSize: 14, color: C.green }}>✓ Turno terminado a las {hhmm(turno.finReal)}.</div>}

      <div style={{ marginTop: 18, fontSize: 11, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700 }}>Hoja del turno</div>
      <div style={{ marginTop: 6 }}>
        {turno.viajes.map((x, i) => {
          const s = real.salidas?.[x.k], l = real.llegadas?.[x.k];
          const prev = turno.viajes[i - 1];
          const hueco = prev ? x.dep - prev.arr : 0;
          const esActual = enMarcha && i === actual;
          return (
            <div key={x.k}>
              {prev && prev.bus !== x.bus && <div style={{ padding: "6px 8px", fontSize: 12, color: C.amber }}>↔ Relevo en {x.on}: pasas al Bus {x.bus}</div>}
              {hueco >= 15 && <div style={{ padding: "6px 8px", fontSize: 12, color: C.muted }}>☕ Pausa de {hueco >= 60 ? `${Math.floor(hueco / 60)} h ${hueco % 60 ? `${hueco % 60} min` : ""}` : `${hueco} min`} ({hhmm(prev.arr)}–{hhmm(x.dep)})</div>}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 8px", borderRadius: 8, background: esActual ? C.blueDim : "none", opacity: l != null || salt.has(x.k) ? 0.5 : x.v ? 0.65 : 1 }}>
                <span style={{ width: 46, fontFamily: mono, fontSize: 14, color: C.text }}>{hhmm(x.dep)}</span>
                {!x.v ? <span style={{ minWidth: 26, padding: "2px 6px", borderRadius: 6, background: x.color, color: "#0b1220", fontWeight: 800, fontSize: 12, textAlign: "center" }}>{x.l}</span> : <span style={{ minWidth: 26, fontSize: 11, color: C.dim }}>vacío</span>}
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.on} → {x.dn}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: salt.has(x.k) ? C.red : l != null ? C.green : C.dim }}>{x.v ? "" : salt.has(x.k) ? "no hecha" : l != null ? "✓" : s != null ? "en curso" : ""}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MiTurno({ sesion, servicios }) {
  const vigentes = useMemo(() => servicioVigente(servicios), [servicios]);
  const [elegido, setElegido] = useState(null);
  const servicio = vigentes.find(s => s._id === elegido) || vigentes[0] || null;
  const sid = servicio?._id || null;
  const [mios, setMios] = useState({ sid: null, lista: null });
  const [error, setError] = useState(null);
  useEffect(() => watchMisTurnos(sid, sesion.org_id, sesion.uid, lista => setMios({ sid, lista })), [sid, sesion.org_id, sesion.uid]);
  const misTurnos = mios.sid === sid ? mios.lista : null;
  const [verTurno, setVerTurno] = useState(null);

  if (!servicio) return <div style={{ padding: 24, fontSize: 14, color: C.muted, fontFamily: font, textAlign: "center" }}>Hoy no hay ningún servicio de autobús publicado. Cuando la oficina lo publique, aquí podrás coger tu turno.</div>;
  const turno = misTurnos?.find(t => t.id === verTurno) || misTurnos?.find(t => t.inicioReal != null && t.finReal == null) || misTurnos?.find(t => t.finReal == null) || misTurnos?.[0];
  return (
    <div style={{ fontFamily: font, paddingBottom: 90 }}>
      {vigentes.length > 1 && (
        <div style={{ display: "flex", gap: 6, padding: "12px 16px 0", overflowX: "auto" }}>
          {vigentes.map(s => <button key={s._id} onClick={() => setElegido(s._id)} style={{ padding: "6px 12px", borderRadius: 16, border: `1px solid ${s._id === sid ? C.blue : C.border2}`, background: s._id === sid ? C.blueDim : "none", color: s._id === sid ? C.blueText : C.muted, fontSize: 12.5, fontFamily: font, whiteSpace: "nowrap" }}>{s.proyecto || "Servicio"} · {new Date(s.fecha + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric" })}</button>)}
        </div>
      )}
      {misTurnos && misTurnos.length > 1 && (
        <div style={{ display: "flex", gap: 6, padding: "12px 16px 0" }}>
          {misTurnos.map(t => <button key={t.id} onClick={() => setVerTurno(t.id)} style={{ padding: "6px 12px", borderRadius: 16, border: `1px solid ${t.id === turno?.id ? C.blue : C.border2}`, background: t.id === turno?.id ? C.blueDim : "none", color: t.id === turno?.id ? C.blueText : C.muted, fontSize: 12.5, fontFamily: font }}>{t.id}</button>)}
        </div>
      )}
      {error && <div style={{ margin: "12px 16px 0", padding: 12, borderRadius: 10, background: "rgba(248,81,73,.1)", border: `1px solid ${C.red}55`, color: C.red, fontSize: 13 }}>{error}</div>}
      {misTurnos === null ? <div style={{ padding: 24, color: C.muted, fontSize: 13 }}>Cargando…</div>
        : turno ? <HojaTurno key={turno.id} servicio={servicio} turno={turno} sesion={sesion} />
        : <ListaTurnos servicio={servicio} sesion={sesion} onError={setError} />}
    </div>
  );
}
