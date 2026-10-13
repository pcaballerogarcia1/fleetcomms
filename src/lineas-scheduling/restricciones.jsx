// Scheduling de líneas: el panel de Restricciones (vehículos, conductores y línea) y los tipos de turno.
import { useState } from "react";
import { PARAMS_DEFECTO, TIPOS_TURNO_DEFECTO, revisarRestricciones } from "../lineas-sched.js";
import { SelectorCalendario } from "../lineas-horarios.jsx";
import { C, MINIMOS, aHHMM, deHHMM, font, hm, mono } from "./comun.js";

function CampoNumero({ valor, defecto, min = 0, decimal = false, vacioEsNulo = false, textoVacio = "—", step, onCambiar }) {
  const [texto, setTexto] = useState(null); // null = no se está editando
  const guardar = () => {
    const t = String(texto ?? "").trim().replace(",", ".");
    setTexto(null);
    if (t === "") { onCambiar(vacioEsNulo ? null : defecto ?? null); return; }
    const n = decimal ? parseFloat(t) : parseInt(t, 10);
    if (Number.isFinite(n)) onCambiar(Math.max(min, n));
  };
  return (
    <input type="number" min={min} step={step} value={texto ?? (valor ?? "")} placeholder={vacioEsNulo ? textoVacio : defecto != null ? String(defecto) : ""}
      onFocus={() => setTexto(valor == null ? "" : String(valor))} onChange={e => setTexto(e.target.value)} onBlur={guardar}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setTexto(null); e.currentTarget.blur(); } }}
      style={{ width: 72, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: mono, outline: "none" }} />
  );
}

function TiposTurno({ tipos, onChange }) {
  const lista = tipos || [];
  const cambiar = (i, cambio) => onChange(lista.map((x, k) => (k === i ? { ...x, ...cambio } : x)));
  const estiloCampo = { background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 5, padding: "3px 5px", fontSize: 12, fontFamily: mono, outline: "none", colorScheme: "dark" };
  // vacio = true: se puede dejar en blanco (null = sin límite)
  const hora = (i, k, vacio = false, deshabilitado = false) => (
    <input type="time" disabled={deshabilitado} value={vacio && !(lista[i][k] > 0) ? "" : aHHMM(lista[i][k])}
      onChange={e => cambiar(i, { [k]: vacio && !e.target.value ? null : deHHMM(e.target.value) })}
      style={{ ...estiloCampo, width: 84, opacity: deshabilitado ? 0.35 : 1 }} />
  );
  const th = { fontSize: 9.5, color: C.dim, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, textAlign: "left", padding: "4px 6px", whiteSpace: "nowrap" };
  const td = { padding: "4px 6px", borderTop: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr>
              <th style={th}>Usar</th><th style={th}>Nombre</th><th style={th}>Empieza entre</th>
              <th style={th}>Trabajo mínimo</th><th style={th}>Trabajo máximo</th><th style={th}>Amplitud máxima</th><th style={th}>Partido</th>
              <th style={th} title="El hueco sin pagar del partido no puede ser más largo (en blanco: sin límite)">Split máximo</th>
              <th style={th} title="Como mucho tantos turnos de este tipo al día (en blanco: sin límite)">Máximo al día</th><th style={th} />
            </tr>
          </thead>
          <tbody>
            {lista.map((x, i) => (
              <tr key={x.id || i} style={{ opacity: x.activo === false ? 0.5 : 1 }}>
                <td style={td}><input type="checkbox" checked={x.activo !== false} onChange={e => cambiar(i, { activo: e.target.checked })} style={{ width: 15, height: 15, accentColor: C.blue, cursor: "pointer" }} /></td>
                <td style={td}><input value={x.nombre} onChange={e => cambiar(i, { nombre: e.target.value })} style={{ width: 110, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 5, padding: "4px 7px", fontSize: 12, fontFamily: font, outline: "none" }} /></td>
                <td style={td}>{hora(i, "desde")} <span style={{ color: C.dim, fontSize: 11 }}>y</span> {hora(i, "hasta")}</td>
                <td style={td}>{hora(i, "trabajoMin")}</td>
                <td style={td}>{hora(i, "trabajoMax")}</td>
                <td style={td}>{hora(i, "amplitudMax")}</td>
                <td style={td}><input type="checkbox" checked={!!x.partido} onChange={e => cambiar(i, { partido: e.target.checked })} style={{ width: 15, height: 15, accentColor: C.blue, cursor: "pointer" }} /></td>
                <td style={td}>{hora(i, "splitMax", true, !x.partido)}</td>
                <td style={td}>
                  <input type="number" min="1" placeholder="sin límite" value={x.maximo > 0 ? x.maximo : ""}
                    onChange={e => cambiar(i, { maximo: e.target.value === "" ? null : Math.max(1, parseInt(e.target.value) || 1) })}
                    style={{ ...estiloCampo, width: 84 }} />
                </td>
                <td style={td}><button onClick={() => onChange(lista.filter((_, k) => k !== i))} title="Quitar este tipo" style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <button onClick={() => onChange([...lista, { id: `t${lista.length + 1}-${lista.length}`, nombre: `Tipo ${lista.length + 1}`, activo: true, desde: 360, hasta: 600, trabajoMin: 360, trabajoMax: 480, amplitudMax: 540, partido: false }])}
          style={{ background: "none", border: `1px solid ${C.border2}`, color: C.text, borderRadius: 6, padding: "4px 10px", fontSize: 11.5, cursor: "pointer", fontFamily: font }}>+ Añadir tipo</button>
        <button onClick={() => onChange(TIPOS_TURNO_DEFECTO)} style={{ background: "none", border: "none", color: C.muted, fontSize: 11, cursor: "pointer", fontFamily: font, textDecoration: "underline" }}>Volver a los de por defecto</button>
        <span style={{ fontSize: 10.5, color: C.dim, lineHeight: 1.5 }}>
          Cada turno tiene que encajar en uno de los marcados: es del primero de la lista en el que encaja y aún tiene sitio («Máximo al día»). Si «empieza entre» va de una hora a otra más temprana, cruza la medianoche (p. ej. 17:00 y 04:00). «Split máximo»: el hueco sin pagar más largo que se permite en el partido. Split máximo y máximo al día en blanco: sin límite. Los que no encajan en ninguno salen con aviso. Sin ningún tipo marcado se usan la amplitud, la jornada y los partidos generales.
        </span>
      </div>
    </div>
  );
}

// ── Restricciones (mismo formato que las del Scheduling de puntos) ──────
export function Restricciones({ p, onChange, red, onCambiarDia, onCerrar }) {
  // el radio de los vacíos de la estrategia también enciende o apaga los vacíos
  const set = (k, v) => onChange(k === "vacioKm" ? { vacioKm: v, vacios: v !== 0 } : { [k]: v });
  const titulo = t => <div style={{ fontSize: 12, color: C.blueText, fontWeight: 700, marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>{t}</div>;
  const sub = t => <div style={{ fontSize: 9.5, color: C.dim, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, margin: "12px 0 8px" }}>{t}</div>;
  const row = (label, children) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
      <label style={{ fontSize: 11, color: C.muted, width: 190, flexShrink: 0 }}>{label}</label>
      {children}
    </div>
  );
  const numInput = (k, suffix) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <CampoNumero valor={p[k]} defecto={PARAMS_DEFECTO[k]} min={MINIMOS[k] ?? 0} onCambiar={v => set(k, v)} />
      {suffix && <span style={{ fontSize: 11, color: C.dim }}>{suffix}</span>}
    </div>
  );
  const sel = (k, opciones) => (
    <select value={String(p[k])} onChange={e => { const o = opciones.find(x => String(x[0]) === e.target.value); set(k, o[0]); }}
      style={{ background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: font, outline: "none" }}>
      {opciones.map(([v, l]) => <option key={v} value={String(v)}>{l}</option>)}
    </select>
  );
  const decInput = (k, suffix, step = 0.01) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <CampoNumero valor={p[k]} defecto={PARAMS_DEFECTO[k]} min={MINIMOS[k] ?? 0} step={step} decimal vacioEsNulo={PARAMS_DEFECTO[k] == null} onCambiar={v => set(k, v)} />
      {suffix && <span style={{ fontSize: 11, color: C.dim }}>{suffix}</span>}
    </div>
  );
  const revision = revisarRestricciones(p);
  const conTipos = (p.tiposTurno || []).some(x => x.activo !== false);
  const check = (k, invertido = false) => (
    <input type="checkbox" checked={invertido ? !p[k] : !!p[k]} onChange={e => set(k, invertido ? !e.target.checked : e.target.checked)}
      style={{ width: 15, height: 15, accentColor: C.blue, cursor: "pointer" }} />
  );
  return (
    // Altura limitada con su propia barra: el panel no puede empujar fuera de
    // la pantalla la barra de botones ni el Gantt (antes se quedaba atascado)
    <div style={{ background: C.surface2, borderBottom: `1px solid ${C.border}`, padding: "0 20px 14px", flexShrink: 0, maxHeight: "min(58vh, 620px)", overflowY: "auto", animation: "sched-fadein .15s ease both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", marginBottom: 4, position: "sticky", top: 0, zIndex: 2, background: C.surface2, borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 10, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>Restricciones</span>
        {row("Calendario", <SelectorCalendario red={red} valor={p.dia} onCambiar={onCambiarDia} ancho={280} />)}
        <span style={{ flex: 1 }} />
        {onCerrar && <button onClick={onCerrar} style={{ background: "none", border: `1px solid ${C.border2}`, color: C.text, borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer", fontFamily: font, marginBottom: 9 }}>Cerrar ✕</button>}
      </div>
      {revision.length > 0 && (
        <div style={{ margin: "8px 0 12px", padding: "8px 12px", borderRadius: 8, border: `1px solid ${revision.some(x => x.grave) ? "rgba(248,113,113,0.5)" : "rgba(251,191,36,0.45)"}`, background: revision.some(x => x.grave) ? "rgba(248,113,113,0.08)" : "rgba(251,191,36,0.07)" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: revision.some(x => x.grave) ? C.red : C.amber, marginBottom: 4 }}>Revisa estas restricciones</div>
          {revision.map((x, i) => <div key={i} style={{ fontSize: 11.5, color: x.grave ? "#fecaca" : C.muted, lineHeight: 1.5 }}>{x.grave ? "⛔" : "⚠"} {x.texto}</div>)}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "4px 36px", marginBottom: 14 }}>
        <div>
          {titulo("Vehículos")}
          {row("Flota disponible", decInput("flotaMax", "autobuses (vacío = sin límite)", 1))}
          {row("Rato mínimo en cochera entre dos bloques", numInput("margenCochera", "min"))}
          {row("Amplitud máxima del autobús", decInput("amplitudBusMax", "min de la salida a la vuelta a cochera (vacío = sin límite)", 1))}
          {sub("Coste")}
          {row("Coste por autobús y día", decInput("costeVehiculoDia", "€/autobús·día"))}
          {row("Coste por km", decInput("costeKm", "€/km (con los vacíos)"))}
        </div>
        <div>
          {titulo("Conductores")}
          {sub("Jornada")}
          {conTipos ? (
            <div style={{ fontSize: 11, color: C.muted, margin: "0 0 9px", lineHeight: 1.5 }}>Amplitud, trabajo y partidos: los marca cada <b style={{ color: C.text }}>tipo de turno</b> (abajo).</div>
          ) : <>
            {row("Amplitud máxima del turno", numInput("amplitudMax", "min"))}
            {row("Jornada de trabajo máxima", numInput("jornadaMax", "min (piezas + huecos cortos)"))}
            {row("Jornadas partidas por turno", numInput("maxPartidos", "como mucho (0 = sin partidos)"))}
          </>}
          {row("Hueco que ya no se paga", numInput("huecoNoPagado", "min o más (jornada partida)"))}
          {sub("Piezas y relevos")}
          {row("Pieza máxima", numInput("piezaMax", "min de relevo a relevo"))}
          {row("Pieza mínima", numInput("piezaMin", "min (no se releva antes)"))}
          {row("Piezas por turno", numInput("maxPiezas", "como mucho"))}
          {row("Cambios de autobús por turno", <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <CampoNumero valor={p.maxCambiosBus} defecto={PARAMS_DEFECTO.maxCambiosBus} vacioEsNulo textoVacio="sin límite" onCambiar={v => set("maxCambiosBus", v)} />
            <span style={{ fontSize: 11, color: C.dim }}>como mucho (vacío = sin límite; 0 = todo el turno en el mismo autobús)</span></div>)}
          {row("Relevo en la misma cabecera", numInput("relevoMin", "min"))}
          {row("Ir a otra cabecera", numInput("desplazamiento", "min como mínimo; si está lejos, lo que se tarde (distancia a la velocidad de los vacíos)"))}
          {sub("Descanso en la jornada continuada")}
          {row("Exigir descanso si la jornada pasa de", <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <CampoNumero valor={p.jornadaSinPausaMax > 0 ? p.jornadaSinPausaMax : null} defecto={PARAMS_DEFECTO.jornadaSinPausaMax} vacioEsNulo textoVacio="no" onCambiar={v => set("jornadaSinPausaMax", v ?? 0)} />
            <span style={{ fontSize: 11, color: C.dim }}>min (vacío = sin descanso; Estatuto: 360)</span></div>)}
          {row("Descanso de", numInput("pausaJornadaMin", "min seguidos entre viajes"))}
          {sub("Conducción (UE 561/2006)")}
          {row("Conducción continua máxima", numInput("conduccionContinuaMax", "min"))}
          {row("Pausa de conducción", numInput("pausaConduccionMin", "min (se puede partir 15 + 30)"))}
          {row("Conducción diaria máxima", numInput("conduccionDiariaMax", "min"))}
          {row("No aplicar la UE 561/2006", check("aplicar561", true))}
          <div style={{ fontSize: 10.5, color: C.dim, margin: "-4px 0 8px", lineHeight: 1.5 }}>La UE 561/2006 no se aplica a líneas regulares de viajeros de hasta 50 km (la mayoría de las urbanas). Marcada: sin pausa de conducción ni corte de pieza a las 4 h 30.</div>
          {sub("Disponibles y coste")}
          {row("Conductores disponibles", decInput("conductoresMax", "turnos (vacío = sin límite)", 1))}
          {row("Coste por hora de conductor", decInput("costeHora", "€/h"))}
        </div>
        <div>
          {titulo("Línea")}
          {row("Regulación en cabecera", numInput("regulacion", "min (si la línea no tiene la suya)"))}
          {row("Cambiar de línea en la misma cabecera", check("entreLineas"))}
          {sub("Vacíos entre cabeceras")}
          {row("Distancia máxima", decInput("vacioMaxKm", "km (0 = no se hacen)", 0.5))}
          {row("Velocidad", numInput("velocidadVacio", "km/h"))}
          {row("Factor de rodeo", decInput("factorRodeo", "× la línea recta", 0.05))}
          <div style={{ fontSize: 10.5, color: C.dim, marginTop: 10, lineHeight: 1.5 }}>
            Lo propio de cada línea (tiempos de recorrido por franja, su regulación y los tipos de vehículo que admite) se configura en Planning, en la ficha de la línea.
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: C.blueText, fontWeight: 700, margin: "6px 0 10px", paddingTop: 12, borderTop: `1px solid ${C.border}` }}>Tipos de turno <span style={{ fontSize: 11, color: C.dim, fontWeight: 400 }}>· de conductor (mañana, tarde, partido, refuerzo…)</span></div>
      <TiposTurno tipos={p.tiposTurno} onChange={v => set("tiposTurno", v)} />
      <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600, margin: "6px 0 12px", paddingTop: 12, borderTop: `1px solid ${C.border}` }}>Estrategia del optimizador para este calendario <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>· la elige Optimizar; también puedes fijarla a mano</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 40px" }}>
        <div>
          {row("Qué autobús coge cada viaje", sel("eleccion", [["optimo", "El mínimo de autobuses (óptimo, como Optibus)"], ["ultimo", "El que menos espera en cabecera"], ["primero", "El que más espera (reparte la regulación)"]]))}
          {row("Vacíos entre cabeceras", sel("vacioKm", [[null, `Hasta el máximo (${String(p.vacioMaxKm).replace(".", ",")} km)`], ...[8, 3].filter(k => k < p.vacioMaxKm).map(k => [k, `Hasta ${k} km`]), [0, "No (cada autobús sigue en su cabecera)"]]))}
        </div>
        <div>
          {row("Dónde se corta la pieza (relevo)", sel("corte", [["max", "Piezas lo más largas posible"], ["equilibrado", "Piezas de largo parecido"], ...[225, 210, 180, 150, 120, 90, 60].filter(m => m < p.piezaMax).map(m => [m, `Piezas de hasta ${hm(m)}`])]))}
          {row("Cómo se forman los turnos", sel("metodo", [["particion", "La mejor combinación (como Optibus / GoalSystem)"], ["voraz", "Pieza a pieza (rápido)"]]))}
          {p.metodo === "voraz" && row("A qué conductor va cada pieza", sel("emparejar", [["primera", "Al que menos espera"], ["llena", "Al que lleva más horas (llenar turnos)"]]))}
        </div>
      </div>
    </div>
  );
}

// ── Selector de calendario: tipos de día y calendarios del GTFS ─────────
