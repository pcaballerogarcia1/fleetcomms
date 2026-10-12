// Scheduling: la barra de indicadores del escenario y el reloj de jornada.



import { C, font, mono } from "./estilo.js";
import { KPI_AYUDA } from "./gantt-comun.js";

// Barra de indicadores del escenario, con el cambio respecto a la generación anterior.
// `cambios` adapta indicadores sin tocar los de aquí (lo usa el Scheduling de
// líneas regulares): { "Paradas": { l: "Viajes", sub, ayuda }, "Eficiencia vehículo": { ocultar: true } }
export function KpiBar({ k, base, onConfigCostes, cambios = {} }) {
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
    { l: "Eficiencia vehículo", v: pct(k.eficVehiculo), d: delta(k.eficVehiculo, base?.eficVehiculo, "up", pp), sub: `km en ruta / km totales · ${num(k.km - k.kmVacio)} / ${num(k.km)}` },
    { l: "Eficiencia personal", v: pct(k.eficPersonal), d: delta(k.eficPersonal, base?.eficPersonal, "up", pp), sub: `tiempo productivo / pagado · ${h(k.conduccion + k.trabajo)} / ${h(k.pagado)}` },
    { l: "Km", v: num(k.km), d: delta(k.km, base?.totalKm, "down", num), sub: `${num(k.kmVacio)} en vacío (cochera)` },
    { l: "Paradas", v: num(k.paradas), d: delta(k.paradas, base?.totalStops, "up", num), sub: k.sinAsignar ? `${num(k.sinAsignar)} sin asignar` : "todas asignadas", subColor: k.sinAsignar ? C.red : C.green },
    k.coste != null
      ? { l: "Coste estimado", v: eur(k.coste), d: delta(k.coste, base?.coste, "down", eur), sub: "personal + km (Restricciones)" }
      : { l: "Coste estimado", v: <button onClick={onConfigCostes} style={{ background: "none", border: `1px dashed ${C.border2}`, color: C.muted, borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", fontFamily: font }}>Configurar €/h y €/km</button>, sub: "en Restricciones" },
    { l: "Avisos", v: num(k.filasConAviso), d: delta(k.filasConAviso, base?.avisos, "down", num), sub: k.avisos ? `${k.avisos} incumplimientos de reglas` : "sin incumplimientos", color: k.filasConAviso ? C.red : C.green },
  ];
  const vistos = items
    .filter(it => !cambios[it.l]?.ocultar)
    .map(it => ({ ...it, ...(cambios[it.l] || {}), ayuda: cambios[it.l]?.ayuda || KPI_AYUDA[it.l] }));
  return (
    <div style={{ flexShrink: 0, background: C.card, borderBottom: `1px solid ${C.border}`, display: "flex", overflowX: "auto" }}>
      {vistos.map((it, i) => (
        <div key={it.l} title={it.ayuda} style={{ padding: "10px 18px", borderRight: i < vistos.length - 1 ? `1px solid ${C.border}` : "none", minWidth: 150, flexShrink: 0, cursor: "help" }}>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: it.color || C.blueText, fontFamily: mono, lineHeight: 1.1 }}>{it.v}</span>
            {it.d}
          </div>
          <div style={{ fontSize: 9.5, color: C.text, textTransform: "uppercase", letterSpacing: .8, fontWeight: 700, marginTop: 3 }}>{it.l}</div>
          <div style={{ fontSize: 10, color: it.subColor || C.dim, marginTop: 1, whiteSpace: "nowrap" }}>{it.sub}</div>
        </div>
      ))}
      {base && <div style={{ padding: "10px 14px", fontSize: 10, color: C.dim, alignSelf: "center", whiteSpace: "nowrap" }}>▲▼ respecto a la generación anterior</div>}
    </div>
  );
}

// Distintivo de "tiene franja horaria / hora fija" — antes era solo un
// borde más oscuro en el bloque, pero con bloques de 15px de ancho entre
// miles de paradas (aquí solo el 1-2% suele tener franja) era casi
// imposible verlo a simple vista. Un reloj en la esquina destaca mucho
// más aunque el bloque sea diminuto.
export function ClockBadge({ size = 11 }) {
  return (
    <div title="Tiene franja horaria / hora fija" style={{
      position: "absolute", top: -4, right: -4, width: size, height: size, borderRadius: "50%",
      background: "#fbbf24", border: "1.5px solid #000", zIndex: 6,
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
