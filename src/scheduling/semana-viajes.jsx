// Rutas › Semana (viajes de varios días): planifica la semana de pedidos de
// un proyecto de reparto con viajes que duran días (viajes-largos.js), la
// enseña como un calendario por camión (conducción, entregas, pausas,
// noches), el detalle de cada viaje con su agenda y su mapa, y la envía a
// los conductores (una ruta por día del viaje).
import { CalendarRange, Loader2, Moon, Send, Truck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, getDocs, query, where } from "firebase/firestore";
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
import { DIAS_CORTOS, agenda, camionesDe, cuando, diasDeSemana, horas, lunesDe, pedidosParaViajes, planesDeViaje } from "./semana-datos.js";

const COLOR = () => ({ conduccion: C.blue, entrega: C.green, pausa: C.dim, descanso: C.violet || "#8b5cf6", espera: C.amber });
const NOMBRE = { conduccion: "Conducción", entrega: "Entrega", pausa: "Pausa", descanso: "Noche (descanso)", espera: "Espera" };
const eur = v => v.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const num = v => Math.round(v).toLocaleString("es-ES");
const DIAS = PARAMS.diasSemana;

function Cifra({ l, v, sub }) {
  return (
    <div style={{ padding: "8px 14px", borderRight: `1px solid ${C.border}`, minWidth: 120, flex: "1 1 0", textAlign: "center" }}>
      <div style={{ fontSize: 11, color: C.muted }}>{l}</div>
      <div style={{ fontSize: 18, fontWeight: 650, color: C.text }}>{v}</div>
      {sub && <div style={{ fontSize: 11, color: C.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
    </div>
  );
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
    viaje.paradas.forEach((s, i) => capas.push(L.circleMarker([s.lat, s.lng], { radius: 6, color: C.green, fillColor: C.green, fillOpacity: 0.9 }).bindTooltip(`${i + 1}. ${String(s.nombre).replace(/[<>&]/g, "")} · ${s.palets} palés`)));
    for (const b of viaje.bloques.filter(x => x.tipo === "descanso")) capas.push(L.circleMarker([b.lat, b.lng], { radius: 6, color: C.violet || "#8b5cf6", fillColor: C.violet || "#8b5cf6", fillOpacity: 0.9 }).bindTooltip(`Noche · ${cuando(b.inicio)}`));
    capa.current = L.layerGroup(capas).addTo(mapa.current);
    mapa.current.fitBounds(linea, { padding: [20, 20] });
  }, [L, viaje, base]);
  useEffect(() => () => { if (mapa.current) { mapa.current.remove(); mapa.current = null; } }, []);
  return <div ref={div} aria-label="Mapa del viaje" style={{ height: 260, borderRadius: 8, border: `1px solid ${C.border}`, overflow: "hidden" }} />;
}

export function SemanaViajes({ activeProject, orgId, vehicles, onCerrar }) {
  const [lunes, setLunes] = useState(() => lunesDe(masDias(ymd(), 7)));
  const [unidad, setUnidad] = useState("bultos");
  const [cocheras, setCocheras] = useState([]);
  const [estado, setEstado] = useState(null); // null | "calculando" | "publicando" | { error } | { aviso }
  const [plan, setPlan] = useState(null); // { res, pedidos }
  const [sel, setSel] = useState(null);
  const pid = activeProject?._id;
  useEffect(() => (pid ? watchCocheras(pid, setCocheras) : undefined), [pid]);
  const c0 = cocheras[0];
  const base = useMemo(() => (c0 ? { lat: +c0.lat, lng: +c0.lng, nombre: c0.nombre || "la base" } : PARAMS.base), [c0]);
  const { camiones, sinCapacidad } = useMemo(() => camionesDe(vehicles), [vehicles]);
  const color = COLOR();

  async function planificar() {
    setEstado("calculando"); setSel(null);
    try {
      const dias = diasDeSemana(lunes, DIAS);
      const pedidos = (await Promise.all(dias.map(f => leerPedidosDelDia(orgId, pid, f)))).flat();
      const res = planificarSemana(pedidosParaViajes(pedidos, unidad), camiones, { base });
      setPlan({ res, pedidos });
      setSel(res.viajes[0]?.id || null);
      setEstado(pedidos.length ? null : { aviso: `No hay pedidos del ${fechaLarga(lunes)} al ${fechaLarga(dias.at(-1))}. Se apuntan en Planificación › Pedidos.` });
    } catch (e) { setEstado({ error: `No se pudo planificar: ${e.message}` }); }
  }

  async function publicar() {
    if (!plan?.res.viajes.length) return;
    if (!window.confirm(`¿Enviar ${plan.res.viajes.length} viajes a los conductores? Cada día de cada viaje aparecerá como una ruta en su móvil. Se sustituyen los viajes de esta semana enviados antes (los que aún no han empezado).`)) return;
    setEstado("publicando");
    try {
      const dias = diasDeSemana(lunes, DIAS);
      // los de esta semana enviados antes, si nadie ha empezado aún: fuera
      const previos = (await getDocs(query(collection(db, "planes"), where("org_id", "==", orgId), where("mes", "in", [...new Set(dias.map(f => f.slice(0, 7)))])))).docs
        .filter(d => d.data().origenViajes && d.data().projectId === pid && dias.includes(d.data().fecha));
      let conservados = 0;
      for (const d of previos) {
        if ((d.data().ubicaciones || []).some(u => u.realizado)) { conservados++; continue; }
        await deleteDoc(d.ref);
      }
      const pedidosPorId = new Map(plan.pedidos.map(p => [p.id || p._id, p]));
      const enRuta = {};
      let rutas = 0;
      for (const v of plan.res.viajes) {
        for (const pl of planesDeViaje(v, { lunes, orgId, projectId: pid, sector: activeProject?.sector, base, pedidosPorId })) {
          await addDoc(collection(db, "planes"), pl);
          rutas++;
          for (const u of pl.ubicaciones) if (u.pedidoId) enRuta[u.pedidoId] = v.camion;
        }
      }
      await marcarEnRuta(enRuta);
      logAudit({ modulo: "Rutas", accion: "Envió los viajes de la semana", detalle: `${plan.res.viajes.length} viajes, ${rutas} rutas (semana del ${fechaLarga(lunes)})` });
      setEstado({ aviso: `Enviados: ${plan.res.viajes.length} viajes en ${rutas} rutas de día.${conservados ? ` ${conservados} ya empezadas se han dejado como estaban.` : ""}` });
    } catch (e) { setEstado({ error: `No se pudo enviar: ${e.message}` }); }
  }

  const res = plan?.res;
  const viaje = res?.viajes.find(v => v.id === sel) || null;
  const porCamion = useMemo(() => {
    const m = new Map(camiones.map(c => [c.id, []]));
    for (const v of res?.viajes || []) (m.get(v.camionId) || m.set(v.camionId, []).get(v.camionId)).push(v);
    return m;
  }, [res, camiones]);
  const pos = t => `${Math.max(0, Math.min(100, (t / (DIAS * 1440)) * 100))}%`;
  const ancho = (a, b) => `${Math.max(0.15, ((Math.min(b, DIAS * 1440) - a) / (DIAS * 1440)) * 100)}%`;

  return (
    <div role="dialog" aria-label="Semana: viajes de varios días" style={{ position: "fixed", inset: "52px 0 0 0", zIndex: 60, background: C.bg, display: "flex", flexDirection: "column", fontFamily: font, color: C.text }}>
      {/* barra */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
        <CalendarRange size={18} color={C.blue} />
        <div style={{ fontSize: 15, fontWeight: 650 }}>Semana · viajes de varios días</div>
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
        <button className="op-btn op-primario" onClick={planificar} disabled={estado === "calculando" || !camiones.length}>
          {estado === "calculando" ? <><Loader2 size={14} className="op-girando" /> Planificando…</> : "Planificar la semana"}
        </button>
        <button className="op-btn" onClick={publicar} disabled={!res?.viajes.length || estado === "publicando"}>
          {estado === "publicando" ? <><Loader2 size={14} className="op-girando" /> Enviando…</> : <><Send size={14} /> Enviar a conductores</>}
        </button>
        <BotonCerrar onClick={onCerrar} />
      </div>

      {!camiones.length && <div role="alert" style={{ padding: 16, color: C.amber, fontSize: 13 }}>Ningún vehículo tiene «carga máxima». Ponla en Planificación › Recursos › ficha del vehículo (en la misma unidad que los pedidos: palés, cajas o kilos).</div>}
      {sinCapacidad.length > 0 && camiones.length > 0 && <div style={{ padding: "6px 16px", color: C.dim, fontSize: 12 }}>Sin carga máxima (no se usan): {sinCapacidad.join(", ")}</div>}
      {estado?.error && <div role="alert" style={{ padding: "8px 16px", color: C.red, fontSize: 13 }}>{estado.error}</div>}
      {estado?.aviso && <div role="status" style={{ padding: "8px 16px", color: C.green, fontSize: 13 }}>{estado.aviso}</div>}

      {res && (
        <>
          <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, overflowX: "auto" }}>
            <Cifra l="Viajes" v={num(res.resumen.viajes)} sub={`${res.resumen.camionesUsados} de ${res.resumen.camiones} camiones`} />
            <Cifra l="Carga servida" v={`${num(res.resumen.paletsServidos)} / ${num(res.resumen.paletsTotal)}`} sub={unidad === "kg" ? "kilos" : "bultos"} />
            <Cifra l="Ocupación media" v={`${Math.round(res.resumen.ocupacionMedia * 100)} %`} sub="de la capacidad de cada camión" />
            <Cifra l="Km" v={num(res.resumen.km)} sub="por carretera (estimados)" />
            <Cifra l="Noches fuera" v={num(res.resumen.noches)} sub="descansos de 11 h" />
            <Cifra l="Coste estimado" v={eur(res.resumen.coste)} sub="km + horas + dietas" />
            <Cifra l="Sin asignar" v={num(res.resumen.pedidosSinAsignar)} sub={res.resumen.pedidosSinAsignar ? "pedidos (ver abajo)" : "todo servido"} />
          </div>

          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
            {/* calendario de la semana por camión */}
            <div style={{ flex: 1, overflow: "auto", padding: "10px 16px" }}>
              <div style={{ display: "flex", marginLeft: 150, marginBottom: 4 }}>
                {diasDeSemana(lunes, DIAS).map((f, i) => <div key={f} style={{ flex: 1, fontSize: 11, color: C.muted, borderLeft: `1px solid ${C.border}`, paddingLeft: 4 }}>{DIAS_CORTOS[i]} {Number(f.slice(8))}</div>)}
              </div>
              {camiones.map(c => {
                const vs = porCamion.get(c.id) || [];
                return (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", height: 34, borderTop: `1px solid ${C.border}` }}>
                    <div style={{ width: 150, flexShrink: 0, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                      <Truck size={13} color={C.muted} /><span style={{ fontWeight: 600 }}>{c.nombre}</span><span style={{ color: C.dim }}>{c.palets}</span>
                    </div>
                    <div style={{ position: "relative", flex: 1, height: 22, background: `repeating-linear-gradient(90deg, transparent 0, transparent calc(${100 / DIAS}% - 1px), ${C.border} calc(${100 / DIAS}% - 1px), ${C.border} ${100 / DIAS}%)` }}>
                      {!vs.length && <span style={{ position: "absolute", left: 6, top: 3, fontSize: 11, color: C.dim }}>sin viajes</span>}
                      {vs.map(v => (
                        <button key={v.id} onClick={() => setSel(v.id)} aria-label={`Viaje ${v.id} de ${v.camion}`} title={`${v.id}: ${v.paradas.map(s => s.nombre).join(" → ")}\n${v.palets}/${v.capacidad} · ${num(v.km)} km · ${v.noches} noches`}
                          style={{ position: "absolute", left: pos(v.inicio), width: ancho(v.inicio, v.fin), top: -2, height: 26, padding: 0, background: "none", cursor: "pointer", borderRadius: 4, border: `2px solid ${sel === v.id ? C.text : "transparent"}` }}>
                          {v.bloques.map((b, i) => (
                            <span key={i} title={`${NOMBRE[b.tipo]} · ${cuando(b.inicio)}–${cuando(b.fin)}`}
                              style={{ position: "absolute", top: 2, height: 18, left: `${((b.inicio - v.inicio) / (v.fin - v.inicio)) * 100}%`, width: `${Math.max(0.3, ((b.fin - b.inicio) / (v.fin - v.inicio)) * 100)}%`, background: color[b.tipo], opacity: b.tipo === "descanso" ? 0.55 : 0.9 }} />
                          ))}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap", fontSize: 11, color: C.muted }}>
                {Object.entries(NOMBRE).map(([k, l]) => <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 10, borderRadius: 2, background: color[k], opacity: k === "descanso" ? 0.55 : 0.9 }} />{l}</span>)}
              </div>
              {res.sinAsignar.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 650, color: C.amber, marginBottom: 6 }}>No caben esta semana ({res.resumen.pedidosSinAsignar} pedidos)</div>
                  {Object.entries(res.sinAsignar.reduce((m, x) => ((m[x.motivo] ||= []).push(x.pedidoId), m), {})).map(([motivo, ids]) => (
                    <div key={motivo} style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}><b style={{ color: C.text }}>{ids.length}</b> · {motivo}</div>
                  ))}
                </div>
              )}
            </div>

            {/* detalle del viaje elegido */}
            {viaje && (
              <div aria-label={`Detalle del viaje ${viaje.id}`} style={{ width: 380, flexShrink: 0, borderLeft: `1px solid ${C.border}`, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 650 }}>{viaje.camion} · viaje {viaje.id}</div>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
                  {viaje.palets} de {viaje.capacidad} ({Math.round(viaje.ocupacion * 100)} %) · {num(viaje.km)} km · {horas(viaje.conduccion)} de conducción<br />
                  {cuando(viaje.inicio)} → {cuando(viaje.fin)} · {viaje.noches} {viaje.noches === 1 ? "noche" : "noches"} fuera · {eur(viaje.coste)}
                </div>
                <MapaViaje viaje={viaje} base={base} />
                <div>
                  {agenda(viaje, base).map((e, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, padding: "5px 0", borderTop: i ? `1px solid ${C.border}` : "none" }}>
                      <span style={{ color: C.dim, width: 70, flexShrink: 0 }}>{cuando(e.t)}</span>
                      <span style={{ color: e.tipo === "noche" ? (C.violet || "#8b5cf6") : C.text, display: "inline-flex", gap: 5 }}>{e.tipo === "noche" && <Moon size={12} style={{ marginTop: 2 }} />}{e.texto}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
      {!res && estado !== "calculando" && camiones.length > 0 && (
        <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 13, lineHeight: 1.6 }}>
          Elige la semana y pulsa «Planificar la semana».<br />Se usan los pedidos de lunes a viernes (Planificación › Pedidos) y los {camiones.length} vehículos con carga máxima.
        </div>
      )}
    </div>
  );
}
