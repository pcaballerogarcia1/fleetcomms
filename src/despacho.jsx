// Despacho del día: lo que el jefe de tráfico mira cada mañana antes de
// empezar. Turnos de hoy (o mañana), problemas arriba (turnos sin conductor,
// vehículos que no están disponibles) y en un clic: marcar quién no viene,
// ver quién puede cubrir (con las reglas del cuadrante) y cubrir — el turno,
// la ruta del día, «Mi cuadrante» y el aviso al móvil van solos.
// Con los fichajes (Control → Fichajes): en cada turno, si ya ha fichado o si
// aún no y llega tarde. Y un reloj, que esta pantalla se mira con la hora en la cabeza.
// La lógica está en despacho.js y lo que se guarda en despacho-store.js.
import { AlertTriangle, ArrowRightLeft, CalendarDays, Check, Clock, Loader2, LogIn, LogOut, UserMinus, UserPlus, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MOTIVOS, NIVEL_TEXTO, candidatos, diaDeDespacho, estadoFichaje, nombre, vehiculosLibres } from "./despacho.js";
import { cambiarVehiculo, cubrir, deshacerAusencia, escucharFichajesDia, escucharGridVehiculos, escucharMes, escucharPlanes, escucharReglas, estadoVehiculo, noViene } from "./despacho-store.js";
import { C, font } from "./tema.js";
import { tono } from "./tema.js";

const hora = min => `${String(Math.floor((((min % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((min % 60) + 60) % 60).padStart(2, "0")}`;
const TURNO = { M: { t: "Mañana", c: C.blue }, T: { t: "Tarde", c: C.orange }, N: { t: "Noche", c: C.violet } };
const ESTADO_VEH = { T: "en el taller", A: "averiado", I: "en la ITV" };
const ymd = f => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;

const dos = n => String(n).padStart(2, "0");
// El reloj (hh:mm:ss): aparte, para que el segundero no repinte la pantalla entera
function Reloj() {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setAhora(new Date()), 1000); return () => clearInterval(t); }, []);
  return (
    <div className="op-tarjeta" style={{ padding: "6px 14px", display: "flex", alignItems: "center", gap: 8 }} title="Hora de este ordenador">
      <Clock size={16} color={C.muted} />
      <span style={{ fontSize: 22, fontWeight: 650, color: C.text, fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em" }}>{dos(ahora.getHours())}:{dos(ahora.getMinutes())}:{dos(ahora.getSeconds())}</span>
    </div>
  );
}
const minutosDeHoy = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
// Color e icono del estado del fichaje
const FICHAJE = {
  dentro: { c: C.green, I: LogIn }, salio: { c: "#8b95a5", I: LogOut }, tarde: { c: C.red, I: AlertTriangle },
  pendiente: { c: "#8b95a5", I: Clock }, noFicho: { c: C.red, I: AlertTriangle }, sinApp: { c: "#5f6b7d", I: Clock },
};

function Pastilla({ code }) {
  const t = TURNO[code] || { t: code, c: C.muted };
  return <span className="op-pastilla" style={{ background: `${t.c}22`, color: t.c }}>{t.t}</span>;
}

export function DespachoPage({ orgId, workers = [], vehicles = [] }) {
  // hoy y mañana, fijados al abrir la pantalla
  const [{ hoy, manana }] = useState(() => { const n = new Date(); return { hoy: ymd(n), manana: ymd(new Date(n.getTime() + 86400000)) }; });
  const [fecha, setFecha] = useState(hoy);
  const f = new Date(`${fecha}T12:00:00`);
  const y = f.getFullYear(), m = f.getMonth() + 1, d = f.getDate();
  const diasMes = new Date(y, m, 0).getDate();
  const clave = `${orgId}|${y}|${m}`;

  const [mes, setMes] = useState({ clave: null, datos: {} });
  const [planes, setPlanes] = useState({ clave: null, lista: [] });
  const [gridVeh, setGridVeh] = useState({ clave: null, grid: {} });
  const [reglas, setReglas] = useState({});
  const [error, setError] = useState(null);
  const [nota, setNota] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [ausencia, setAusencia] = useState(null);   // fila a la que se le marca la ausencia
  const [buscando, setBuscando] = useState(null);   // hueco para el que se buscan candidatos
  const [cambioVeh, setCambioVeh] = useState(null); // fila a la que se le cambia el vehículo
  const [fichajes, setFichajes] = useState({ fecha: null, lista: [] });
  const [ahoraMin, setAhoraMin] = useState(minutosDeHoy); // para saber quién llega tarde (cada 20 s)

  useEffect(() => { if (!orgId) return; return escucharMes(orgId, y, m, datos => setMes({ clave: `${orgId}|${y}|${m}`, datos }), e => setError(e.message)); }, [orgId, y, m]);
  useEffect(() => { if (!orgId) return; return escucharPlanes(orgId, y, m, lista => setPlanes({ clave: `${orgId}|${y}|${m}`, lista })); }, [orgId, y, m]);
  useEffect(() => { if (!orgId) return; return escucharGridVehiculos(orgId, y, m, grid => setGridVeh({ clave: `${orgId}|${y}|${m}`, grid })); }, [orgId, y, m]);
  useEffect(() => { if (!orgId) return; return escucharReglas(orgId, setReglas); }, [orgId]);
  useEffect(() => { if (!orgId) return; return escucharFichajesDia(orgId, fecha, lista => setFichajes({ fecha, lista })); }, [orgId, fecha]);
  useEffect(() => { const t = setInterval(() => setAhoraMin(minutosDeHoy()), 20000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!nota) return; const t = setTimeout(() => setNota(null), 6000); return () => clearTimeout(t); }, [nota]);

  const cargando = mes.clave !== clave;
  const porTrabajador = useMemo(() => (mes.clave === clave ? mes.datos : {}), [mes, clave]);
  const listaPlanes = useMemo(() => (planes.clave === clave ? planes.lista : []), [planes, clave]);
  const gridVehiculos = useMemo(() => (gridVeh.clave === clave ? gridVeh.grid : {}), [gridVeh, clave]);
  const activos = useMemo(() => workers.filter(w => w.activo !== false), [workers]);
  const dia = diaDeDespacho({ workers: activos, vehiculos: vehicles, porTrabajador, gridVehiculos, d, planes: listaPlanes });
  const libres = vehiculosLibres({ vehiculos: vehicles, filas: dia.filas, gridVehiculos, d });
  const cuando = fecha === hoy ? "hoy" : fecha < hoy ? "pasado" : "futuro";
  const listaFichajes = fichajes.fecha === fecha ? fichajes.lista : [];
  const fichajeDe = fl => estadoFichaje(fl, listaFichajes, cuando, ahoraMin);
  const sinFichar = dia.filas.filter(fl => ["tarde", "noFicho"].includes(fichajeDe(fl)?.tipo)).length;
  const cands = buscando ? candidatos({ hueco: buscando, workers: activos, porTrabajador, rules: reglas, d, daysInMonth: diasMes }) : [];

  const base = { orgId, y, m, d };
  async function hacer(etiqueta, fn, ok) {
    setOcupado(etiqueta); setError(null);
    try { const r = await fn(); setNota(typeof ok === "function" ? ok(r) : ok); }
    catch (e) { setError(`${etiqueta}: ${e.message || e}`); }
    finally { setOcupado(null); }
  }
  const avisoTxt = r => (r == null ? "No se ha podido avisar al móvil (no tiene usuario vinculado o no ha activado los avisos)." : r.enviados ? "Le ha llegado el aviso al móvil." : "No tiene los avisos activados en su móvil: avísale por teléfono.");
  const fechaTxt = f.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  const esHoy = fecha === hoy, esManana = fecha === manana;
  const tarjeta = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 };

  return (
    <div style={{ flex: 1, overflow: "auto", background: C.bg, fontFamily: font, padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 650, color: C.text, letterSpacing: "-0.02em" }}>Salida del día</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 3 }}>{esHoy ? `Hoy, ${fechaTxt}` : esManana ? `Mañana, ${fechaTxt}` : fechaTxt.charAt(0).toUpperCase() + fechaTxt.slice(1)}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Reloj />
          <div className="op-seg">
            <button className={esHoy ? "op-on" : ""} onClick={() => setFecha(hoy)}>Hoy</button>
            <button className={esManana ? "op-on" : ""} onClick={() => setFecha(manana)}>Mañana</button>
          </div>
          <input type="date" value={fecha} onChange={e => e.target.value && setFecha(e.target.value)} className="op-input" style={{ width: 150, height: 30, colorScheme: tono("dark", "light") }} />
        </div>
      </div>

      {error && <div style={{ ...tarjeta, borderColor: "rgba(242,109,109,0.4)", color: C.red, fontSize: 13, marginBottom: 12, padding: "10px 14px" }}>{error}</div>}
      {nota && <div style={{ ...tarjeta, borderColor: "rgba(63,207,142,0.35)", color: C.green, fontSize: 13, marginBottom: 12, padding: "10px 14px", display: "flex", gap: 8, alignItems: "center" }}><Check size={15} />{nota}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 20 }}>
        {[["Turnos", dia.filas.length, C.text], ["Sin cubrir", dia.sinCubrir.length, dia.sinCubrir.length ? C.red : C.text], ["Vehículos con problema", dia.vehiculosMal.length, dia.vehiculosMal.length ? C.amber : C.text], ["Cubiertos", dia.huecos.length - dia.sinCubrir.length, C.text], ...(cuando === "futuro" ? [] : [["Sin fichar", sinFichar, sinFichar ? C.red : C.text]])].map(([l, v, c]) => (
          <div key={l} className="op-tarjeta" style={{ padding: "12px 18px" }}>
            <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 500 }}>{l}</div>
            <div style={{ fontSize: 24, fontWeight: 650, color: c, letterSpacing: "-0.02em", marginTop: 3 }}>{cargando ? "…" : v}</div>
          </div>
        ))}
      </div>

      {/* ── Lo que hay que resolver ── */}
      {(dia.sinCubrir.length > 0 || dia.vehiculosMal.length > 0) && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 14, fontWeight: 650, color: C.text, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}><AlertTriangle size={16} color={C.amber} /> Pendiente de resolver</div>
          <div style={{ display: "grid", gap: 10 }}>
            {dia.sinCubrir.map(h => (
              <div key={`h${h.workerId}`} style={{ ...tarjeta, borderColor: "rgba(242,109,109,0.35)", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(242,109,109,0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: C.red, flexShrink: 0 }}><UserMinus size={18} /></div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Turno sin conductor · {hora(h.s)}–{hora(h.e)} <Pastilla code={h.code} /></div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>{nombre(h.worker)} no viene ({h.motivo}){h.vn ? ` · ${h.vn}` : ""}{h.planes?.length ? ` · su ruta del día pasará a quien cubra` : ""}</div>
                </div>
                <button className="op-btn op-primario" onClick={() => setBuscando(h)}><UserPlus size={15} /> Buscar quién cubre</button>
                <button className="op-btn op-fantasma" disabled={!!ocupado} onClick={() => hacer("Deshacer", () => deshacerAusencia({ ...base, hueco: h }), `Deshecho: ${nombre(h.worker)} vuelve a tener su turno.`)}>Deshacer</button>
              </div>
            ))}
            {dia.vehiculosMal.map(fl => (
              <div key={`v${fl.worker._id}`} style={{ ...tarjeta, borderColor: "rgba(245,184,74,0.35)", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(245,184,74,0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: C.amber, flexShrink: 0 }}><Wrench size={18} /></div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{fl.vehiculo.nombre} está {ESTADO_VEH[fl.estadoVeh]}</div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Lo lleva {nombre(fl.worker)} · {hora(fl.turno.s)}–{hora(fl.turno.e)}</div>
                </div>
                <button className="op-btn op-primario" onClick={() => setCambioVeh(fl)}><ArrowRightLeft size={15} /> Cambiar de vehículo</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Turnos del día ── */}
      <div style={{ fontSize: 14, fontWeight: 650, color: C.text, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}><CalendarDays size={16} color={C.muted} /> Turnos del día</div>
      <div style={{ ...tarjeta, padding: 0, overflow: "hidden" }}>
        {cargando ? <div style={{ padding: 18, color: C.muted, fontSize: 13 }}>Cargando el cuadrante…</div>
          : !dia.filas.length ? <div style={{ padding: 18, color: C.muted, fontSize: 13 }}>Nadie tiene turno este día en el cuadrante.</div>
          : dia.filas.map((fl, i) => (
            <div key={fl.worker._id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 16px", borderTop: i ? `1px solid ${C.border}` : "none", flexWrap: "wrap" }}>
              <div style={{ width: 92, fontSize: 13, color: C.text, fontWeight: 600 }}>{hora(fl.turno.s)}–{hora(fl.turno.e)}</div>
              <div style={{ flex: "1 1 180px", minWidth: 160 }}>
                <div style={{ fontSize: 13.5, color: C.text, fontWeight: 550 }}>{nombre(fl.worker)} {fl.cubreA && <span className="op-pastilla" style={{ background: "rgba(63,207,142,0.12)", color: C.green, marginLeft: 4 }}>cubre a {nombre(activos.find(x => x._id === fl.cubreA))}</span>}</div>
                <div style={{ marginTop: 3 }}><Pastilla code={fl.turno.code} /></div>
              </div>
              <div style={{ flex: "1 1 160px", minWidth: 140, fontSize: 13, color: fl.problemaVeh ? C.amber : fl.sinVehiculo ? C.dim : C.text }}>
                {fl.vehiculo ? fl.vehiculo.nombre : "Sin vehículo"}{fl.problemaVeh ? ` · ${ESTADO_VEH[fl.estadoVeh]}` : ""}
              </div>
              <div style={{ flex: "1 1 140px", minWidth: 120, fontSize: 12.5, color: C.muted }}>
                {fl.paradas ? <>{fl.hechas}/{fl.paradas} paradas{fl.hechas > 0 ? " · en marcha" : ""}</> : "Sin ruta publicada"}
              </div>
              {(() => {
                const fj = fichajeDe(fl);
                if (!fj) return null;
                const { c, I } = FICHAJE[fj.tipo];
                return <div style={{ flex: "1 1 190px", minWidth: 170, fontSize: 12.5, color: c, display: "flex", alignItems: "center", gap: 6, fontWeight: fj.tipo === "tarde" || fj.tipo === "noFicho" ? 600 : 400 }}><I size={14} />{fj.texto}</div>;
              })()}
              <div style={{ display: "flex", gap: 6 }}>
                <button className="op-btn op-fantasma" title="Cambiar de vehículo este día" onClick={() => setCambioVeh(fl)}><ArrowRightLeft size={14} /> Vehículo</button>
                <button className="op-btn op-fantasma op-btn-peligro" disabled={fl.hechas > 0} title={fl.hechas > 0 ? "Ya ha empezado su ruta" : "No viene: su turno queda por cubrir"} onClick={() => setAusencia({ fila: fl, motivo: MOTIVOS[0] })}><UserMinus size={14} /> No viene</button>
              </div>
            </div>
          ))}
      </div>

      {dia.huecos.some(h => h.cubiertoPor) && (
        <div style={{ marginTop: 16, fontSize: 12.5, color: C.muted }}>
          Cubiertos: {dia.huecos.filter(h => h.cubiertoPor).map(h => `${nombre(h.cubiertoPor)} por ${nombre(h.worker)} (${h.motivo})`).join(" · ")}
        </div>
      )}

      {/* ── Ventanas ── */}
      {ausencia && (
        <Ventana titulo={`${nombre(ausencia.fila.worker)} no viene`} onCerrar={() => setAusencia(null)}>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>Su turno {TURNO[ausencia.fila.turno.code]?.t.toLowerCase()} ({hora(ausencia.fila.turno.s)}–{hora(ausencia.fila.turno.e)}) queda por cubrir y en el cuadrante se le pone Baja ese día.</div>
          <label className="op-label">Motivo</label>
          <select className="op-input" value={ausencia.motivo} onChange={e => setAusencia(a => ({ ...a, motivo: e.target.value }))} style={{ marginBottom: 16 }}>
            {MOTIVOS.map(x => <option key={x}>{x}</option>)}
          </select>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="op-btn" onClick={() => setAusencia(null)}>Cancelar</button>
            <button className="op-btn op-primario" disabled={!!ocupado} onClick={async () => {
              const fl = ausencia.fila, motivo = ausencia.motivo;
              setAusencia(null);
              await hacer("Marcar la ausencia", () => noViene({ ...base, worker: fl.worker, turno: fl.turno, vehiculo: fl.vehiculo, planes: fl.planes, motivo }), `${nombre(fl.worker)}: ausencia marcada. Elige quién cubre su turno.`);
              setBuscando({ workerId: fl.worker._id, worker: fl.worker, code: fl.turno.code, s: fl.turno.s, e: fl.turno.e, v: fl.vehiculo?.id || null, vn: fl.vehiculo?.nombre || null, planes: fl.planes.map(p => p._id), motivo });
            }}>{ocupado ? <Loader2 size={14} className="op-girando" /> : null} Marcar y buscar quién cubre</button>
          </div>
        </Ventana>
      )}

      {buscando && (
        <Ventana titulo={`Quién cubre · ${hora(buscando.s)}–${hora(buscando.e)}`} ancho={560} onCerrar={() => setBuscando(null)}>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>Turno de {nombre(buscando.worker)}{buscando.vn ? ` con ${buscando.vn}` : ""}. Primero los de guardia y disponibles; se comprueban el descanso mínimo y los días seguidos de las reglas del cuadrante.</div>
          <div style={{ maxHeight: "50vh", overflow: "auto", display: "grid", gap: 6 }}>
            {!cands.length && <div style={{ fontSize: 13, color: C.muted }}>No hay nadie sin turno este día.</div>}
            {cands.map(c => (
              <div key={c.worker._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, background: C.surface2, opacity: c.valido ? 1 : 0.6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: C.text, fontWeight: 550 }}>{nombre(c.worker)}</div>
                  <div style={{ fontSize: 12, color: c.valido ? (c.aviso ? C.amber : C.muted) : C.red }}>{c.valido ? NIVEL_TEXTO[c.nivel] : `No: ${c.motivo}`}{c.aviso ? ` · ${c.aviso}` : ""} · {c.horasMes} h este mes</div>
                </div>
                <button className={`op-btn${c.valido ? " op-primario" : ""}`} disabled={!!ocupado}
                  onClick={async () => {
                    if (!c.valido && !window.confirm(`${nombre(c.worker)} no cumple las reglas (${c.motivo}). ¿Cubrir igualmente?`)) return;
                    const h = buscando; setBuscando(null);
                    await hacer("Cubrir el turno", () => cubrir({ ...base, hueco: h, cubre: c.worker, asignAusente: porTrabajador[h.workerId]?.asign?.[String(d)] }), r => `${nombre(c.worker)} cubre el turno. ${avisoTxt(r)}`);
                  }}>{c.valido ? "Cubrir" : "Cubrir igualmente"}</button>
              </div>
            ))}
          </div>
        </Ventana>
      )}

      {cambioVeh && (
        <Ventana titulo={`Vehículo de ${nombre(cambioVeh.worker)}`} onCerrar={() => setCambioVeh(null)}>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>Ahora: {cambioVeh.vehiculo?.nombre || "sin vehículo"}{cambioVeh.problemaVeh ? ` (${ESTADO_VEH[cambioVeh.estadoVeh]})` : ""}. Elige uno libre este día:</div>
          <div style={{ display: "grid", gap: 6, maxHeight: "40vh", overflow: "auto", marginBottom: 14 }}>
            {!libres.length && <div style={{ fontSize: 13, color: C.muted }}>No hay vehículos libres este día.</div>}
            {libres.map(v => (
              <button key={v._id || v.id} className="op-btn" style={{ justifyContent: "flex-start", height: 36 }} disabled={!!ocupado}
                onClick={async () => { const fl = cambioVeh; setCambioVeh(null); await hacer("Cambiar el vehículo", () => cambiarVehiculo({ ...base, fila: fl, nuevo: v }), r => `${nombre(fl.worker)} sale con ${v.nombre || v.matricula}. ${avisoTxt(r)}`); }}>
                {v.nombre || v.matricula}{v.matricula && v.nombre ? <span style={{ color: C.dim, marginLeft: 6 }}>{v.matricula}</span> : null}
              </button>
            ))}
          </div>
          {cambioVeh.vehiculo && !cambioVeh.problemaVeh && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
              <span style={{ fontSize: 12.5, color: C.muted }}>¿{cambioVeh.vehiculo.nombre} no puede salir?</span>
              {[["T", "Al taller"], ["A", "Averiado"], ["I", "ITV"]].map(([k, t]) => (
                <button key={k} className="op-btn op-fantasma" disabled={!!ocupado} onClick={async () => { const fl = cambioVeh; await hacer("Cambiar el estado del vehículo", () => estadoVehiculo({ ...base, vehiculoId: fl.vehiculo.id, estado: k }), `${fl.vehiculo.nombre}: ${t.toLowerCase()} este día.`); setCambioVeh({ ...fl, problemaVeh: true, estadoVeh: k }); }}>{t}</button>
              ))}
            </div>
          )}
        </Ventana>
      )}
    </div>
  );
}

function Ventana({ titulo, children, onCerrar, ancho = 440 }) {
  return (
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: ancho, maxWidth: "100%", background: C.card, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 20, boxShadow: "0 24px 64px rgba(0,0,0,.55)" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 650, color: C.text, flex: 1 }}>{titulo}</div>
          <button className="op-btn op-fantasma op-icono" onClick={onCerrar} title="Cerrar"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
