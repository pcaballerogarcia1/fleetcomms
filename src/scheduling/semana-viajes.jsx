// Rutas › Semana de reparto (proyectos de distribución): una sola
// planificación para toda la semana. El motor (viajes-largos.js) decide qué
// pedidos van en rutas de un día (salir y volver, la última milla) y cuáles en
// viajes de varios días durmiendo fuera, con cada camión en un solo sitio cada
// día. Se ve de lo general al detalle: la semana → un día (todos los camiones:
// rutas del día con sus paradas y los que están de viaje, con dónde duermen) →
// un camión (mapa y agenda). A mitad de semana se replanifica solo lo que
// falta, sin tocar los viajes ya en marcha. El plan se guarda por semana
// (semanas_reparto/{proyecto}_{lunes}) y se envía a los conductores (una ruta
// por día de cada viaje).
import { CalendarRange, Home, Loader2, Moon, Route, Send, Truck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "../firebase.js";
import { leerPedidosDelDia, marcarEnRuta } from "../pedidos/store.js";
import { masDias, ymd, fechaLarga } from "../pedidos/datos.js";
import { watchCocheras } from "../lineas-store.js";
import { useLeaflet } from "../use-leaflet.js";
import { capaFondo, opcionesMapa, sinPrefijo } from "../mapa-fondo.js";
import { logAudit } from "../audit.js";
import { BotonCerrar } from "../ui/cerrar.jsx";
import { C, font } from "./estilo.js";
import { PARAMS, planificarSemana } from "./viajes-largos.js";
import {
  DIAS_CORTOS, agenda, camionesDe, cuando, diasDeSemana, horas, lunesDe, minutoDeSemana, pedidosParaViajes,
  planParaGuardar, planesDeViaje, resumenDelDia, separarEnMarcha, unirPlanes, vistaDelDia,
} from "./semana-datos.js";

const VIOLETA = C.violet || "#8b5cf6";
const COLOR = () => ({ conduccion: C.blue, entrega: C.green, pausa: C.dim, descanso: VIOLETA, espera: C.amber });
const NOMBRE = { conduccion: "Conducción", entrega: "Entrega", pausa: "Pausa", descanso: "Noche (descanso)", espera: "Espera" };
const eur = v => v.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const num = v => Math.round(v).toLocaleString("es-ES");
const hhmm = t => cuando(t).slice(4);
const DIAS = PARAMS.diasSemana;
const refSemana = (pid, lunes) => doc(db, "semanas_reparto", `${pid}_${lunes}`);

/** La semana que toca: esta (de lunes a viernes) o, en fin de semana, la siguiente */
function semanaActual() {
  const hoy = ymd(), w = new Date().getDay();
  return lunesDe(w === 0 || w === 6 ? masDias(hoy, 3) : hoy);
}

function Cifra({ l, v, sub }) {
  return (
    <div style={{ padding: "8px 14px", borderRight: `1px solid ${C.border}`, minWidth: 116, flex: "1 1 0", textAlign: "center" }}>
      <div style={{ fontSize: 11, color: C.muted }}>{l}</div>
      <div style={{ fontSize: 18, fontWeight: 650, color: C.text }}>{v}</div>
      {sub && <div style={{ fontSize: 11, color: C.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
    </div>
  );
}

function Chip({ color, children }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color, border: `1px solid ${color}55`, background: `${color}14`, borderRadius: 10, padding: "1px 8px", whiteSpace: "nowrap" }}>{children}</span>;
}

function MapaViaje({ viaje, base }) {
  const L = useLeaflet();
  const div = useRef(null), mapa = useRef(null), capa = useRef(null);
  useEffect(() => {
    if (!L || !div.current || !viaje) return;
    if (!mapa.current) {
      mapa.current = sinPrefijo(L.map(div.current, opcionesMapa({ zoomControl: true })));
      capaFondo(L, "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { opacity: 0.7 }).addTo(mapa.current);
    }
    if (capa.current) mapa.current.removeLayer(capa.current);
    const linea = [[base.lat, base.lng], ...viaje.paradas.map(s => [s.lat, s.lng]), [base.lat, base.lng]];
    const capas = [L.polyline(linea, { color: C.blue, weight: 3, opacity: 0.85 })];
    capas.push(L.circleMarker([base.lat, base.lng], { radius: 7, color: C.text, fillColor: C.text, fillOpacity: 1 }).bindTooltip(base.nombre || "Base"));
    viaje.paradas.forEach((s, i) => capas.push(L.circleMarker([s.lat, s.lng], { radius: 6, color: C.green, fillColor: C.green, fillOpacity: 0.9 }).bindTooltip(`${i + 1}. ${String(s.nombre).replace(/[<>&]/g, "")} · ${s.palets}`)));
    for (const b of viaje.bloques.filter(x => x.tipo === "descanso")) capas.push(L.circleMarker([b.lat, b.lng], { radius: 6, color: VIOLETA, fillColor: VIOLETA, fillOpacity: 0.9 }).bindTooltip(`Noche · ${cuando(b.inicio)}`));
    capa.current = L.layerGroup(capas).addTo(mapa.current);
    mapa.current.fitBounds(linea, { padding: [20, 20] });
  }, [L, viaje, base]);
  useEffect(() => () => { if (mapa.current) { mapa.current.remove(); mapa.current = null; } }, []);
  return <div ref={div} aria-label="Mapa del viaje" style={{ height: 260, borderRadius: 8, border: `1px solid ${C.border}`, overflow: "hidden" }} />;
}

/** Los bloques de un tramo de tiempo [desde, hasta) como una barra */
function Barra({ bloques, desde, hasta }) {
  const color = COLOR(), largo = hasta - desde;
  return bloques.map((b, i) => {
    const a = Math.max(b.inicio, desde), z = Math.min(b.fin, hasta);
    if (z <= a) return null;
    return <span key={i} title={`${NOMBRE[b.tipo]} · ${cuando(b.inicio)}–${cuando(b.fin)}`}
      style={{ position: "absolute", top: 2, height: 18, left: `${((a - desde) / largo) * 100}%`, width: `${Math.max(0.3, ((z - a) / largo) * 100)}%`, background: color[b.tipo], opacity: b.tipo === "descanso" ? 0.55 : 0.9 }} />;
  });
}

export function SemanaViajes({ activeProject, orgId, vehicles, onCerrar }) {
  const [lunes, setLunes] = useState(semanaActual);
  const [unidad, setUnidad] = useState("bultos");
  const [cocheras, setCocheras] = useState([]);
  const [estado, setEstado] = useState(null); // null | "cargando" | "calculando" | "publicando" | { error } | { aviso }
  const [plan, setPlan] = useState(null); // { viajes, sinAsignar, resumen, enviados, unidad, actualizado }
  const [pedidos, setPedidos] = useState(null);
  const [dia, setDia] = useState(null); // null = la semana entera; 0…4 = ese día
  const [sel, setSel] = useState(null); // id del viaje elegido
  const pid = activeProject?._id;
  useEffect(() => (pid ? watchCocheras(pid, setCocheras) : undefined), [pid]);
  const c0 = cocheras[0];
  const base = useMemo(() => (c0 ? { lat: +c0.lat, lng: +c0.lng, nombre: c0.nombre || "la base" } : PARAMS.base), [c0]);
  const { camiones, sinCapacidad } = useMemo(() => camionesDe(vehicles), [vehicles]);
  const fechas = useMemo(() => diasDeSemana(lunes, DIAS), [lunes]);
  const ahora = minutoDeSemana(lunes);
  const terminada = ahora >= PARAMS.finSemana;
  const empezada = ahora > PARAMS.horaSalida;

  // el plan guardado de esa semana (al cambiar de semana, se vacía y se lee)
  const [clave, setClave] = useState(null);
  if (pid && clave !== `${pid}_${lunes}`) { setClave(`${pid}_${lunes}`); setEstado("cargando"); setPlan(null); setPedidos(null); setSel(null); }
  useEffect(() => {
    if (!pid) return undefined;
    let vivo = true;
    getDoc(refSemana(pid, lunes)).then(s => {
      if (!vivo) return;
      const p = s.exists() ? JSON.parse(s.data().plan || "null") : null;
      setPlan(p);
      if (p?.unidad) setUnidad(p.unidad);
      setEstado(null);
      const hoy = Math.floor(minutoDeSemana(lunes) / 1440);
      setDia(p && minutoDeSemana(lunes) > 0 && hoy < DIAS ? hoy : null);
    }).catch(e => vivo && setEstado({ error: `No se pudo leer el plan de la semana: ${e.message}` }));
    return () => { vivo = false; };
  }, [pid, lunes]);

  const leerPedidos = async () => (await Promise.all(fechas.map(f => leerPedidosDelDia(orgId, pid, f)))).flat();
  const guardar = p => setDoc(refSemana(pid, lunes), { org_id: orgId, projectId: pid, lunes, plan: planParaGuardar(p), actualizado: Date.now() });

  async function planificar() {
    if (terminada) return;
    const desde = minutoDeSemana(lunes);
    const { enMarcha, ocupados, pedidosFuera } = separarEnMarcha(plan, desde);
    if (plan?.viajes?.length && !window.confirm(enMarcha.length
      ? `Se replanifica lo que falta de la semana. ${enMarcha.length === 1 ? "El viaje que ya ha salido se queda" : `Los ${enMarcha.length} viajes que ya han salido se quedan`} como está${enMarcha.length === 1 ? "" : "n"}.`
      : "Se vuelve a planificar la semana entera (el plan anterior se sustituye).")) return;
    setEstado("calculando"); setSel(null);
    try {
      const todos = await leerPedidos();
      const total = pedidosParaViajes(todos, unidad, lunes).reduce((s, x) => s + x.palets, 0);
      const resto = pedidosParaViajes(todos.filter(p => !pedidosFuera.has(p.id || p._id)), unidad, lunes);
      const res = planificarSemana(resto, camiones, { base, desde, ocupados });
      const nuevo = { ...unirPlanes(enMarcha, res, camiones, total), enviados: enMarcha.map(v => v.id), unidad, actualizado: Date.now() };
      await guardar(nuevo);
      setPlan(nuevo); setPedidos(todos);
      setEstado(!todos.length ? { aviso: `No hay pedidos del ${fechaLarga(lunes)} al ${fechaLarga(fechas.at(-1))}. Se apuntan en Planificación › Pedidos.` }
        : enMarcha.length ? { aviso: `Replanificado lo que falta. ${enMarcha.length === 1 ? "El viaje en marcha se ha dejado" : `${enMarcha.length} viajes en marcha se han dejado`} como estaba${enMarcha.length === 1 ? "" : "n"}.` } : null);
    } catch (e) { setEstado({ error: `No se pudo planificar: ${e.message}` }); }
  }

  async function publicar() {
    const yaEnviados = new Set(plan?.enviados || []);
    const aEnviar = (plan?.viajes || []).filter(v => !yaEnviados.has(v.id));
    if (!aEnviar.length) return;
    if (!window.confirm(`¿Enviar ${aEnviar.length} ${aEnviar.length === 1 ? "ruta o viaje" : "rutas y viajes"} a los conductores? Cada día de cada viaje aparecerá como una ruta en su móvil. Lo enviado antes que ha cambiado se sustituye; lo que ya está en marcha no se toca.`)) return;
    setEstado("publicando");
    try {
      // lo enviado antes en esta semana que ya no está en el plan (si nadie ha empezado): fuera
      const previos = (await getDocs(query(collection(db, "planes"), where("org_id", "==", orgId), where("mes", "in", [...new Set(fechas.map(f => f.slice(0, 7)))])))).docs
        .filter(d => d.data().origenViajes && d.data().projectId === pid && fechas.includes(d.data().fecha) && !yaEnviados.has(d.data().viajeId));
      let conservados = 0;
      for (const d of previos) {
        if ((d.data().ubicaciones || []).some(u => u.realizado)) { conservados++; continue; }
        await deleteDoc(d.ref);
      }
      const lista = pedidos || await leerPedidos();
      const pedidosPorId = new Map(lista.map(p => [p.id || p._id, p]));
      const enRuta = {};
      let rutas = 0;
      for (const v of aEnviar) {
        for (const pl of planesDeViaje(v, { lunes, orgId, projectId: pid, sector: activeProject?.sector, base, pedidosPorId })) {
          await addDoc(collection(db, "planes"), pl);
          rutas++;
          for (const u of pl.ubicaciones) if (u.pedidoId) enRuta[u.pedidoId] = v.camion;
        }
      }
      await marcarEnRuta(enRuta);
      const nuevo = { ...plan, enviados: plan.viajes.map(v => v.id), enviadoEn: Date.now() };
      await guardar(nuevo);
      setPlan(nuevo);
      logAudit({ modulo: "Rutas", accion: "Envió la semana de reparto", detalle: `${aEnviar.length} rutas y viajes, ${rutas} rutas de día (semana del ${fechaLarga(lunes)})` });
      setEstado({ aviso: `Enviados: ${aEnviar.length} rutas y viajes en ${rutas} rutas de día.${conservados ? ` ${conservados} ya empezadas se han dejado como estaban.` : ""}` });
    } catch (e) { setEstado({ error: `No se pudo enviar: ${e.message}` }); }
  }

  const res = plan;
  const enviados = useMemo(() => new Set(plan?.enviados || []), [plan]);
  const sinEnviar = (res?.viajes || []).filter(v => !enviados.has(v.id)).length;
  const viaje = res?.viajes.find(v => v.id === sel) || null;
  const porCamion = useMemo(() => {
    const m = new Map(camiones.map(c => [c.id, []]));
    for (const v of res?.viajes || []) (m.get(v.camionId) || m.set(v.camionId, []).get(v.camionId)).push(v);
    return m;
  }, [res, camiones]);
  const delDia = useMemo(() => (res && dia != null ? vistaDelDia(res, camiones, dia, base) : null), [res, camiones, dia, base]);
  const resumenes = useMemo(() => (res ? fechas.map((_, d) => resumenDelDia(res, camiones, d)) : null), [res, camiones, fechas]);
  const semanaMin = DIAS * 1440;
  const pos = t => `${Math.max(0, Math.min(100, (t / semanaMin) * 100))}%`;
  const ancho = (a, b) => `${Math.max(0.15, ((Math.min(b, semanaMin) - a) / semanaMin) * 100)}%`;
  const verDia = d => { setDia(d); setSel(null); };
  const pestana = activa => ({ height: "auto", padding: "6px 12px", flexDirection: "column", alignItems: "flex-start", border: `1px solid ${activa ? C.blue : C.border}`, background: activa ? `${C.blue}14` : "transparent" });

  return (
    <div role="dialog" aria-label="Semana de reparto" style={{ position: "fixed", inset: "52px 0 0 0", zIndex: 60, background: C.bg, display: "flex", flexDirection: "column", fontFamily: font, color: C.text }}>
      {/* barra */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
        <CalendarRange size={18} color={C.blue} />
        <div style={{ fontSize: 15, fontWeight: 650 }}>Semana de reparto</div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.muted, marginLeft: 8 }}>Semana del lunes
          <input type="date" className="op-input" aria-label="Lunes de la semana" value={lunes} onChange={e => e.target.value && setLunes(lunesDe(e.target.value))} style={{ height: 32, width: 150 }} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.muted }}>Carga en
          <select className="op-input" aria-label="Unidad de carga" value={unidad} onChange={e => setUnidad(e.target.value)} style={{ height: 32, width: 150 }}>
            <option value="bultos">Bultos (palés, cajas)</option>
            <option value="kg">Kilos</option>
          </select>
        </label>
        <span style={{ fontSize: 12, color: C.dim }} title="La primera cochera o depot del proyecto (Planificación)">Base: {base.nombre}</span>
        <div style={{ flex: 1 }} />
        <button className="op-btn op-primario" onClick={planificar} disabled={estado === "calculando" || estado === "cargando" || !camiones.length || terminada}
          title={terminada ? "Esta semana ya ha terminado" : res?.viajes?.length && empezada ? "Vuelve a planificar lo que falta de la semana, sin tocar los viajes que ya han salido" : "Reparte los pedidos de la semana entre los camiones: rutas de un día y viajes de varios días"}>
          {estado === "calculando" ? <><Loader2 size={14} className="op-girando" /> Planificando…</> : res?.viajes?.length && empezada ? "Replanificar lo que falta" : "Planificar la semana"}
        </button>
        <button className="op-btn" onClick={publicar} disabled={!sinEnviar || estado === "publicando"} title={sinEnviar ? `${sinEnviar} sin enviar` : res?.viajes?.length ? "Todo enviado" : ""}>
          {estado === "publicando" ? <><Loader2 size={14} className="op-girando" /> Enviando…</> : <><Send size={14} /> Enviar a conductores{sinEnviar && enviados.size ? ` (${sinEnviar})` : ""}</>}
        </button>
        <BotonCerrar onClick={onCerrar} />
      </div>

      {!camiones.length && <div role="alert" style={{ padding: 16, color: C.amber, fontSize: 13 }}>Ningún vehículo tiene «carga máxima». Ponla en Planificación › Recursos › ficha del vehículo (en la misma unidad que los pedidos: palés, cajas o kilos).</div>}
      {sinCapacidad.length > 0 && camiones.length > 0 && <div style={{ padding: "6px 16px", color: C.dim, fontSize: 12 }}>Sin carga máxima (no se usan): {sinCapacidad.join(", ")}</div>}
      {estado?.error && <div role="alert" style={{ padding: "8px 16px", color: C.red, fontSize: 13 }}>{estado.error}</div>}
      {estado?.aviso && <div role="status" style={{ padding: "8px 16px", color: C.green, fontSize: 13 }}>{estado.aviso}</div>}
      {res?.viajes?.length > 0 && enviados.size > 0 && sinEnviar > 0 && !estado?.aviso && (
        <div style={{ padding: "6px 16px", color: C.amber, fontSize: 12 }}>Hay {sinEnviar} {sinEnviar === 1 ? "ruta o viaje" : "rutas y viajes"} con cambios sin enviar a los conductores.</div>
      )}

      {res && (
        <>
          <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, overflowX: "auto" }}>
            <Cifra l="Rutas de un día" v={num(res.resumen.rutasDeUnDia ?? 0)} sub="salen y vuelven en la jornada" />
            <Cifra l="Viajes de varios días" v={num(res.resumen.viajes - (res.resumen.rutasDeUnDia ?? 0))} sub={`${res.resumen.camionesUsados} de ${res.resumen.camiones} camiones en total`} />
            <Cifra l="Carga servida" v={`${num(res.resumen.paletsServidos)} / ${num(res.resumen.paletsTotal)}`} sub={unidad === "kg" ? "kilos" : "bultos"} />
            <Cifra l="Ocupación media" v={`${Math.round(res.resumen.ocupacionMedia * 100)} %`} sub="de la capacidad de cada camión" />
            <Cifra l="Km" v={num(res.resumen.km)} sub="por carretera (estimados)" />
            <Cifra l="Noches fuera" v={num(res.resumen.noches)} sub="descansos de 11 h" />
            <Cifra l="Coste estimado" v={eur(res.resumen.coste)} sub="km + horas + dietas" />
            <Cifra l="Sin asignar" v={num(res.resumen.pedidosSinAsignar)} sub={res.resumen.pedidosSinAsignar ? "pedidos (ver abajo)" : "todo servido"} />
          </div>

          {/* la semana y sus días */}
          <div role="tablist" aria-label="Días" style={{ display: "flex", gap: 6, padding: "8px 16px", borderBottom: `1px solid ${C.border}`, overflowX: "auto" }}>
            <button role="tab" aria-selected={dia == null} onClick={() => verDia(null)} className="op-btn" style={pestana(dia == null)}>
              <span style={{ fontSize: 13, fontWeight: 650 }}>Semana</span>
              <span style={{ fontSize: 11, color: C.muted }}>todos los camiones</span>
            </button>
            {fechas.map((f, d) => {
              const r = resumenes[d], hoy = ahora > 0 && Math.floor(ahora / 1440) === d;
              return (
                <button key={f} role="tab" aria-selected={dia === d} aria-label={`${DIAS_CORTOS[d]} ${Number(f.slice(8))}`} onClick={() => verDia(d)} className="op-btn" style={{ ...pestana(dia === d), minWidth: 150 }}>
                  <span style={{ fontSize: 13, fontWeight: 650 }}>{DIAS_CORTOS[d]} {Number(f.slice(8))}{hoy && <span style={{ color: C.blue, fontWeight: 600 }}> · hoy</span>}</span>
                  <span style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap" }}>{r.rutas} {r.rutas === 1 ? "ruta" : "rutas"} · {r.deViaje} de viaje · {r.entregas} entregas</span>
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
            <div style={{ flex: 1, overflow: "auto", padding: "10px 16px" }}>
              {dia == null ? (
                /* la semana: un calendario por camión */
                <>
                  <div style={{ display: "flex", marginLeft: 150, marginBottom: 4 }}>
                    {fechas.map((f, i) => <button key={f} onClick={() => verDia(i)} style={{ flex: 1, fontSize: 11, color: C.muted, borderLeft: `1px solid ${C.border}`, paddingLeft: 4, textAlign: "left", background: "none", borderTop: "none", borderRight: "none", borderBottom: "none", cursor: "pointer", fontFamily: font }}>{DIAS_CORTOS[i]} {Number(f.slice(8))}</button>)}
                  </div>
                  {camiones.map(c => {
                    const vs = porCamion.get(c.id) || [];
                    return (
                      <div key={c.id} style={{ display: "flex", alignItems: "center", height: 34, borderTop: `1px solid ${C.border}` }}>
                        <div style={{ width: 150, flexShrink: 0, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                          <Truck size={13} color={C.muted} /><span style={{ fontWeight: 600 }}>{c.nombre}</span><span style={{ color: C.dim }}>{c.palets}</span>
                        </div>
                        <div style={{ position: "relative", flex: 1, height: 22, background: `repeating-linear-gradient(90deg, transparent 0, transparent calc(${100 / DIAS}% - 1px), ${C.border} calc(${100 / DIAS}% - 1px), ${C.border} ${100 / DIAS}%)` }}>
                          {!vs.length && <span style={{ position: "absolute", left: 6, top: 3, fontSize: 11, color: C.dim }}>en la base toda la semana</span>}
                          {vs.map(v => (
                            <button key={v.id} onClick={() => setSel(v.id)} aria-label={`${v.noches ? "Viaje" : "Ruta"} ${v.id} de ${v.camion}`} title={`${v.id}: ${v.paradas.map(s => s.nombre).join(" → ")}\n${v.palets}/${v.capacidad} · ${num(v.km)} km · ${v.noches} noches`}
                              style={{ position: "absolute", left: pos(v.inicio), width: ancho(v.inicio, v.fin), top: -2, height: 26, padding: 0, background: "none", cursor: "pointer", borderRadius: 4, border: `2px solid ${sel === v.id ? C.text : "transparent"}` }}>
                              <Barra bloques={v.bloques} desde={v.inicio} hasta={v.fin} />
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap", fontSize: 11, color: C.muted }}>
                    {Object.entries(NOMBRE).map(([k, l]) => <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 10, borderRadius: 2, background: COLOR()[k], opacity: k === "descanso" ? 0.55 : 0.9 }} />{l}</span>)}
                    <span>· Pulsa un día para ver qué hace cada camión ese día</span>
                  </div>
                </>
              ) : (
                /* un día: todos los camiones, con lo que hace cada uno */
                <div aria-label={`Camiones del ${DIAS_CORTOS[dia]} ${Number(fechas[dia].slice(8))}`}>
                  <div style={{ display: "flex", marginLeft: 250, marginBottom: 4, fontSize: 10, color: C.dim }}>
                    {[5, 8, 11, 14, 17, 20].map(h => <span key={h} style={{ flex: 1 }}>{String(h).padStart(2, "0")}:00</span>)}
                  </div>
                  {delDia.map(x => {
                    const elegido = x.viaje && sel === x.viaje.id;
                    return (
                      <div key={x.camion.id} role={x.viaje ? "button" : undefined} tabIndex={x.viaje ? 0 : undefined}
                        aria-label={x.viaje ? `${x.camion.nombre}: ${x.tipo === "ruta" ? "ruta del día" : `de viaje, día ${x.diaDelViaje} de ${x.totalDias}`}` : undefined}
                        onClick={() => x.viaje && setSel(x.viaje.id)} onKeyDown={e => e.key === "Enter" && x.viaje && setSel(x.viaje.id)}
                        style={{ display: "flex", gap: 10, padding: "8px 6px", borderTop: `1px solid ${C.border}`, cursor: x.viaje ? "pointer" : "default", background: elegido ? `${C.blue}10` : "transparent", borderRadius: 6 }}>
                        <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                          <div style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}><Truck size={13} color={C.muted} /><b>{x.camion.nombre}</b><span style={{ color: C.dim, fontSize: 11 }}>{x.camion.palets}</span></div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {x.tipo === "ruta" && <Chip color={C.green}><Route size={10} /> Ruta del día</Chip>}
                            {x.tipo === "viaje" && <Chip color={VIOLETA}>De viaje · día {x.diaDelViaje} de {x.totalDias}</Chip>}
                            {x.tipo === "libre" && <Chip color={C.dim}><Home size={10} /> En la base</Chip>}
                            {x.viaje?.enMarcha && <Chip color={C.blue}>en marcha</Chip>}
                          </div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {/* de 05:00 a 23:00 */}
                          {x.viaje && <div style={{ position: "relative", height: 22, background: C.surface2, borderRadius: 4 }}><Barra bloques={x.bloques} desde={dia * 1440 + 5 * 60} hasta={dia * 1440 + 23 * 60} /></div>}
                          <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.6 }}>
                            {x.sale != null && <span>Sale {hhmm(x.sale)} · </span>}
                            {x.entregas.length > 0
                              ? x.entregas.map((e, i) => <span key={i}>{i ? " · " : ""}<b style={{ color: C.text, fontWeight: 600 }}>{hhmm(e.t)}</b> {e.puerto ? "Puerto: " : ""}{e.nombre} ({e.palets})</span>)
                              : x.viaje ? <span>Sin entregas este día (en carretera)</span> : <span>No sale</span>}
                            {x.km > 0 && <span> · {num(x.km)} km</span>}
                            {x.vuelve != null && <span> · vuelve a {base.nombre} {hhmm(x.vuelve)}</span>}
                            {x.duerme && <div style={{ color: VIOLETA, display: "flex", alignItems: "center", gap: 5 }}><Moon size={12} /> Duerme: {x.duerme}</div>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {res.sinAsignar.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 650, color: C.amber, marginBottom: 6 }}>No caben esta semana ({res.resumen.pedidosSinAsignar} pedidos)</div>
                  {Object.entries(res.sinAsignar.reduce((m, x) => ((m[x.motivo] ||= []).push(x.pedidoId), m), {})).map(([motivo, ids]) => (
                    <div key={motivo} style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}><b style={{ color: C.text }}>{ids.length}</b> · {motivo}</div>
                  ))}
                </div>
              )}
            </div>

            {/* un camión: su ruta o su viaje */}
            {viaje && (
              <div aria-label={`Detalle del viaje ${viaje.id}`} style={{ width: 380, flexShrink: 0, borderLeft: `1px solid ${C.border}`, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 650, flex: 1 }}>{viaje.camion} · {viaje.noches ? "viaje" : "ruta"} {viaje.id}</div>
                  <BotonCerrar onClick={() => setSel(null)} />
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {viaje.noches ? <Chip color={VIOLETA}>{viaje.dias} días · {viaje.noches} {viaje.noches === 1 ? "noche" : "noches"} fuera</Chip> : <Chip color={C.green}>Ruta de un día</Chip>}
                  {viaje.enMarcha ? <Chip color={C.blue}>en marcha</Chip> : enviados.has(viaje.id) ? <Chip color={C.green}>enviado</Chip> : <Chip color={C.amber}>sin enviar</Chip>}
                </div>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
                  {viaje.palets} de {viaje.capacidad} ({Math.round(viaje.ocupacion * 100)} %) · {num(viaje.km)} km · {horas(viaje.conduccion)} de conducción<br />
                  {cuando(viaje.inicio)} → {cuando(viaje.fin)} · {eur(viaje.coste)}
                </div>
                <MapaViaje viaje={viaje} base={base} />
                <div>
                  {agenda(viaje, base).map((e, i) => {
                    const deEseDia = dia != null && Math.floor(e.t / 1440) === dia;
                    return (
                      <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, padding: "5px 0", borderTop: i ? `1px solid ${C.border}` : "none", fontWeight: deEseDia ? 600 : 400, opacity: dia != null && !deEseDia ? 0.6 : 1 }}>
                        <span style={{ color: C.dim, width: 70, flexShrink: 0 }}>{cuando(e.t)}</span>
                        <span style={{ color: e.tipo === "noche" ? VIOLETA : C.text, display: "inline-flex", gap: 5 }}>{e.tipo === "noche" && <Moon size={12} style={{ marginTop: 2 }} />}{e.texto}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}
      {!res && estado !== "calculando" && estado !== "cargando" && camiones.length > 0 && (
        <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 13, lineHeight: 1.6 }}>
          {terminada ? "Esta semana ya ha terminado y no tiene plan." : <>
            Pulsa «Planificar la semana». Se reparten los pedidos de lunes a viernes (Planificación › Pedidos) entre los {camiones.length} camiones con carga máxima:<br />
            lo cercano, en rutas de un día; lo lejano, en viajes de varios días durmiendo fuera. Cada camión, en un solo sitio cada día.<br />
            <span style={{ color: C.dim }}>Un pedido se puede entregar a partir de su día; si tiene que ser justo ese día, márcalo como «Solo este día» en Pedidos.</span>
          </>}
        </div>
      )}
      {estado === "cargando" && <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 13 }}><Loader2 size={14} className="op-girando" /> Cargando la semana…</div>}
    </div>
  );
}
