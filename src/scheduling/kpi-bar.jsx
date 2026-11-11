// Scheduling: la barra de indicadores del escenario y el reloj de jornada.



import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { C, mono } from "./estilo.js";
import { KPI_AYUDA } from "./gantt-comun.js";
import { margen } from "./facturacion.js";

// Barra de indicadores del escenario, con el cambio respecto a la generación anterior.
// `cambios` adapta indicadores sin tocar los de aquí (lo usa el Scheduling de
// líneas regulares): { "Paradas": { l: "Viajes", sub, ayuda }, "Eficiencia vehículo": { ocultar: true } }
// Arriba solo los principales (como Optibus); «Todos los indicadores» despliega
// el resto y los de `detalle` ([{ l, v, sub, ayuda }] o gráficas [{ l, barras: [{ n, v }] }]).
const PRINCIPALES = ["Turnos", "Vehículos", "Eficiencia vehículo", "Eficiencia personal", "Coste estimado", "Margen"];
// solo los indicadores en alerta van en color; el resto, en el color del texto
const alerta = c => c === C.red || c === C.amber || c === C.orange;

// facturacion: { total, conPrecio, sinPrecio } de lo asignado, { sinPermiso } o null (cargando); sin ella no hay «Margen» (p. ej. líneas)
export function KpiBar({ k, base, onConfigCostes, cambios = {}, detalle = [], facturacion }) {
  const [abierto, setAbierto] = useState(false);
  const pct = v => v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")} %`;
  const num = v => v == null ? "—" : Math.round(v).toLocaleString("es-ES");
  const eur = v => v == null ? "—" : v.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  // mejor: "up" = subir es bueno, "down" = bajar es bueno
  const delta = (cur, prev, mejor, fmt) => {
    if (cur == null || prev == null) return null;
    const d = cur - prev;
    if (Math.abs(d) < 1e-9) return null;
    const bueno = mejor === "up" ? d > 0 : d < 0;
    return <span style={{ fontSize: 11, fontWeight: 700, color: bueno ? C.green : C.red, marginLeft: 6 }}>{d > 0 ? "▲" : "▼"} {fmt(Math.abs(d))}</span>;
  };
  const pp = d => `${(d * 100).toFixed(1).replace(".", ",")} pp`;
  const h = min => `${Math.round(min / 60).toLocaleString("es-ES")} h`;
  const items = [
    { l: "Vehículos", v: num(k.vehiculos), d: delta(k.vehiculos, base?.vehicleCount, "down", num), sub: `PVR ${k.pvr} (a la vez en punta)` },
    { l: "Turnos", v: num(k.turnos), d: delta(k.turnos, base?.turnos, "down", num), sub: "conductor × día" },
    { l: "Eficiencia vehículo", v: pct(k.eficVehiculo), d: delta(k.eficVehiculo, base?.eficVehiculo, "up", pp), sub: `${num(k.km - k.kmVacio)} de ${num(k.km)} km con servicio` },
    { l: "Eficiencia personal", v: pct(k.eficPersonal), d: delta(k.eficPersonal, base?.eficPersonal, "up", pp), sub: `${h(k.conduccion + k.trabajo)} productivas de ${h(k.pagado)}` },
    { l: "Km", v: num(k.km), d: delta(k.km, base?.totalKm, "down", num), sub: `${num(k.kmVacio)} en vacío (cochera)` },
    { l: "Paradas", v: num(k.paradas), d: delta(k.paradas, base?.totalStops, "up", num), sub: k.sinAsignar ? `${num(k.sinAsignar)} sin asignar` : "todas asignadas", subColor: k.sinAsignar ? C.red : C.green },
    k.coste != null
      ? { l: "Coste estimado", v: eur(k.coste), d: delta(k.coste, base?.coste, "down", eur), sub: "personal + km (Restricciones)" }
      : { l: "Coste estimado", v: <button onClick={onConfigCostes} className="op-btn" style={{ height: 28, padding: "0 10px", fontSize: 12 }}>Configurar €/h y €/km</button>, sub: "en Restricciones" },
    ...(facturacion === undefined ? [] : [margenItem(facturacion, k.coste, { pct, eur })]),
    { l: "Avisos", v: num(k.filasConAviso), d: delta(k.filasConAviso, base?.avisos, "down", num), sub: k.avisos ? `${k.avisos} incumplimientos de reglas` : "sin incumplimientos", color: k.filasConAviso ? C.red : C.green },
  ];
  const todos = items
    .filter(it => !cambios[it.l]?.ocultar)
    .map(it => ({ ...it, clave: it.l, ...(cambios[it.l] || {}), ayuda: cambios[it.l]?.ayuda || KPI_AYUDA[it.l] }));
  const vistos = PRINCIPALES.map(l => todos.find(it => it.clave === l)).filter(Boolean);
  const resto = [...todos.filter(it => !PRINCIPALES.includes(it.clave)), ...detalle.filter(x => !x.barras)];
  const graficas = detalle.filter(x => x.barras?.length);
  const avisos = k.filasConAviso || 0;
  return (
    <div style={{ flexShrink: 0, background: C.bg, borderBottom: `1px solid ${C.border}` }}>
    <div style={{ display: "flex", overflowX: "auto" }}>
      {vistos.map(it => (
        <div key={it.l} title={[it.ayuda, typeof it.sub === "string" ? it.sub : null].filter(Boolean).join("\n")} style={{ padding: "10px 14px", borderRight: `1px solid ${C.border}`, minWidth: 150, flex: "1 1 0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, textAlign: "center", cursor: "help", overflow: "hidden" }}>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 500, whiteSpace: "nowrap" }}>{it.l}</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 30, maxWidth: "100%" }}>
            <span style={{ fontSize: 22, fontWeight: 650, color: it.colorFijo || (alerta(it.color) ? it.color : C.text), letterSpacing: "-0.02em", lineHeight: 1, whiteSpace: "nowrap" }}>{it.v}</span>
            {it.d}
          </div>
          <div style={{ fontSize: 12, color: it.subColor || C.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{it.sub}</div>
        </div>
      ))}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 16px", flexShrink: 0 }}>
        <button onClick={() => setAbierto(a => !a)} className={`op-btn${abierto ? " op-activo" : ""}`} title="Todos los indicadores" aria-label={`Todos los indicadores${avisos > 0 ? ` (${avisos} avisos)` : ""}`} style={{ height: 30, padding: "0 10px", fontSize: 12 }}>
          Todos {abierto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {avisos > 0 && <span style={{ background: "rgba(242,109,109,0.18)", color: C.red, borderRadius: 12, padding: "1px 7px", fontSize: 11, fontWeight: 700 }}>{num(avisos)} aviso{avisos === 1 ? "" : "s"}</span>}
        </button>
        {base && <span title="Las flechas comparan con la generación anterior" style={{ fontSize: 10, color: C.dim, whiteSpace: "nowrap" }}>▲▼ vs. anterior</span>}
      </div>
    </div>
    {abierto && (
      <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px 16px 16px", maxHeight: "48vh", overflowY: "auto", background: C.bg }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 }}>
          {resto.map(it => (
            <div key={it.l} title={it.ayuda} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", cursor: it.ayuda ? "help" : "default" }}>
              <div style={{ display: "flex", alignItems: "baseline" }}>
                <span style={{ fontSize: 20, fontWeight: 700, color: alerta(it.color) ? it.color : C.text, fontFamily: mono, lineHeight: 1.1 }}>{it.v}</span>
                {it.d}
              </div>
              <div style={{ fontSize: 12, color: C.muted, fontWeight: 500, marginTop: 4 }}>{it.l}</div>
              {it.sub && <div style={{ fontSize: 10, color: it.subColor || C.dim, marginTop: 2, lineHeight: 1.35 }}>{it.sub}</div>}
            </div>
          ))}
          {graficas.map(g => {
            const max = Math.max(1, ...g.barras.map(b => b.v));
            return (
              <div key={g.l} title={g.ayuda} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 62 }}>
                  {g.barras.map(b => (
                    <div key={b.n} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", minWidth: 0 }}>
                      <span style={{ fontSize: 10, color: C.muted, fontFamily: mono }}>{b.v}</span>
                      <div style={{ width: "100%", maxWidth: 34, height: `${Math.max(3, (b.v / max) * 44)}px`, background: C.blue, borderRadius: "3px 3px 0 0" }} />
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
                  {g.barras.map(b => <span key={b.n} title={b.n} style={{ flex: 1, fontSize: 10, color: C.dim, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{b.n}</span>)}
                </div>
                <div style={{ fontSize: 12, color: C.muted, fontWeight: 500, marginTop: 6 }}>{g.l}</div>
              </div>
            );
          })}
        </div>
      </div>
    )}
    </div>
  );
}

// Distintivo de "tiene franja horaria / hora fija" — antes era solo un
// borde más oscuro en el bloque, pero con bloques de 15px de ancho entre
// miles de paradas (aquí solo el 1-2% suele tener franja) era casi
// imposible verlo a simple vista. Un reloj en la esquina destaca mucho
// más aunque el bloque sea diminuto.
// «Margen»: facturación máxima de lo asignado frente al coste estimado
function margenItem(f, coste, { pct, eur }) {
  const l = "Margen";
  if (f?.sinPermiso) return { l, v: "—", sub: "solo administradores" };
  if (!f) return { l, v: "…", sub: "calculando" };
  if (!f.conPrecio) return { l, v: "—", sub: "sin precios (Planificación)" };
  const m = margen(f.total, coste);
  const faltan = f.sinPrecio ? ` · ${f.sinPrecio} sin precio` : "";
  if (m == null) return { l, v: eur(f.total), sub: `facturación · configura costes${faltan}` };
  // verde si se gana dinero, rojo si se pierde
  return { l, v: pct(m), colorFijo: m > 0 ? C.green : m < 0 ? C.red : undefined, sub: `${eur(f.total)} − ${eur(coste)} coste${faltan}` };
}

export function ClockBadge({ size = 11 }) {
  return (
    <div title="Tiene franja horaria / hora fija" style={{
      position: "absolute", top: -4, right: -4, width: size, height: size, borderRadius: "50%",
      background: C.amber, border: "1.5px solid #000", zIndex: 6,
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 1px 3px rgba(0,0,0,.7)", pointerEvents: "none",
    }}>
      <svg width={size - 4} height={size - 4} viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.2 2" />
      </svg>
    </div>
  );
}
