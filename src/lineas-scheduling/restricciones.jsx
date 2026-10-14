// Scheduling de líneas: el panel de Restricciones (categorías y apartados, con buscador) y los tipos de turno.
import { useState } from "react";
import { PARAMS_DEFECTO, TIPOS_TURNO_DEFECTO, revisarRestricciones } from "../lineas-sched.js";
import { SelectorCalendario } from "../lineas-horarios.jsx";
import { PanelRestricciones, Interruptor, IconoCategoria } from "../panel-restricciones.jsx";
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
              <th style={th} title="Como mucho tantos turnos de este tipo al día (en blanco: sin límite)">Máximo al día</th>
              <th style={th} title="Si un conductor de este tipo de turno puede cambiar de autobús durante la jornada (sin marcar: hace todo el turno en el mismo autobús)">Cambio de bus</th><th style={th} />
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
                <td style={td}>
                  <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, color: C.muted }}>
                    <input type="checkbox" checked={x.cambiosBus !== 0} onChange={e => cambiar(i, { cambiosBus: e.target.checked ? null : 0 })} style={{ width: 15, height: 15, accentColor: C.blue, cursor: "pointer" }} />
                    {x.cambiosBus !== 0 ? "permite" : "no"}
                  </label>
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
          Cada turno tiene que encajar en uno de los marcados: es del primero de la lista en el que encaja y aún tiene sitio («Máximo al día»). Si «empieza entre» va de una hora a otra más temprana, cruza la medianoche (p. ej. 17:00 y 04:00). «Split máximo»: el hueco sin pagar más largo que se permite en el partido. «Cambio de bus» sin marcar: el conductor hace todo el turno en el mismo autobús. Split máximo y máximo al día en blanco: sin límite. Los que no encajan en ninguno salen con aviso. Sin ningún tipo marcado se usan la amplitud, la jornada y los partidos generales.
        </span>
      </div>
    </div>
  );
}

// ── Grupos de líneas ─────────────────────────────────────────────────────
const COLORES_GRUPO = ["#5c9bff", "#34d399", "#fb923c", "#f472b6", "#a78bfa", "#fbbf24", "#22d3ee", "#f87171"];
function GruposLineas({ red, grupos, onChange }) {
  const lista = grupos || [];
  const nombres = [...new Set((red?.lineas || []).map(l => String(l.nombre)))].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  const deLinea = new Map(lista.flatMap((g, i) => (g.lineas || []).map(n => [String(n), i])));
  const cambiar = (i, cambio) => onChange(lista.map((g, k) => (k === i ? { ...g, ...cambio } : g)));
  // pulsar una línea: entra en este grupo (y sale del que estuviera) o sale de él
  const alternar = (i, n) => onChange(lista.map((g, k) => {
    const ls = (g.lineas || []).map(String).filter(x => x !== n);
    return k === i && deLinea.get(n) !== i ? { ...g, lineas: [...ls, n] } : { ...g, lineas: ls };
  }));
  const sinGrupo = nombres.filter(n => !deLinea.has(n));
  return (
    <div>
      {lista.map((g, i) => {
        const color = COLORES_GRUPO[i % COLORES_GRUPO.length];
        return (
          <div key={g.id} style={{ border: `1px solid ${C.border}`, borderLeft: `3px solid ${color}`, borderRadius: 8, padding: "10px 12px", marginBottom: 10, background: C.bg }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <input value={g.nombre} onChange={e => cambiar(i, { nombre: e.target.value })} placeholder="Nombre del grupo"
                style={{ width: 200, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 8px", fontSize: 12.5, fontWeight: 600, fontFamily: font, outline: "none" }} />
              <span style={{ fontSize: 11, color: C.dim }}>{(g.lineas || []).length} línea{(g.lineas || []).length === 1 ? "" : "s"} · pulsa una línea para meterla o sacarla</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => onChange(lista.filter((_, k) => k !== i))} title="Quitar este grupo (las líneas quedan sin grupo)" style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>✕</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {nombres.map(n => {
                const aqui = deLinea.get(n) === i, otro = deLinea.has(n) && !aqui;
                return (
                  <button key={n} onClick={() => alternar(i, n)} title={otro ? `Está en «${lista[deLinea.get(n)].nombre}»: pulsa para pasarla aquí` : aqui ? "Sacar del grupo" : "Meter en el grupo"}
                    style={{ minWidth: 38, padding: "3px 8px", borderRadius: 5, fontSize: 11.5, fontWeight: 700, fontFamily: mono, cursor: "pointer",
                      border: `1px solid ${aqui ? color : C.border}`, background: aqui ? `${color}33` : "transparent", color: aqui ? C.text : otro ? C.dim : C.muted, opacity: otro ? 0.45 : 1 }}>{n}</button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => onChange([...lista, { id: `g${Date.now().toString(36)}`, nombre: `Grupo ${lista.length + 1}`, lineas: [] }])}
          style={{ background: "none", border: `1px solid ${C.border2}`, color: C.text, borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer", fontFamily: font }}>+ Nuevo grupo</button>
        <span style={{ fontSize: 10.5, color: C.dim, lineHeight: 1.5 }}>
          {sinGrupo.length ? `Sin grupo: ${sinGrupo.join(", ")}. Cada línea sin grupo cuenta como un grupo propio.` : "Todas las líneas están en algún grupo."} Lo que se puede mezclar dentro de un grupo se elige en «Mezclas».
        </span>
      </div>
    </div>
  );
}

// ── Restricciones ──────────────────────────────────────────────────────
// Como en los programas del sector: buscador, «en uso / todas», las
// categorías a la izquierda con sus apartados y, a la derecha, solo los
// ajustes del apartado elegido. Los límites opcionales llevan un interruptor
// (apagado = sin límite) y el número al lado.

// Valor con el que se enciende un límite opcional (apagado es null = sin límite)
const AL_ENCENDER = {
  flotaMax: 100, amplitudBusMax: 960, esperaMaxCabecera: 120, conductoresMax: 300, maxCambiosBus: 1, maxCambiosBusTotal: 100,
  jornadaSinPausaMax: 360, costeVehiculoDia: 250, costeKm: 0.9, costeHora: 22, costeCambioBus: 5,
};

export function Restricciones({ p, onChange, red, onCambiarDia, onCerrar }) {
  // el radio de los vacíos de la estrategia también enciende o apaga los vacíos
  const set = (k, v) => onChange(k === "vacioKm" ? { vacioKm: v, vacios: v !== 0 } : { [k]: v });
  const conTipos = (p.tiposTurno || []).some(x => x.activo !== false);

  // ── controles ──
  const numero = (k, sufijo, { decimal = false, step } = {}) => (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <CampoNumero valor={p[k]} defecto={PARAMS_DEFECTO[k]} min={MINIMOS[k] ?? 0} decimal={decimal} step={step} onCambiar={v => set(k, v)} />
      {sufijo && <span style={{ fontSize: 11, color: C.dim }}>{sufijo}</span>}
    </span>
  );
  // límite opcional: interruptor + número (apagado = sin límite)
  const limite = (k, sufijo, { decimal = false, step, cero = false } = {}) => {
    const on = cero ? p[k] != null && p[k] !== "" : p[k] != null && p[k] !== "" && p[k] > 0;
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Interruptor on={on} onCambiar={v => set(k, v ? (AL_ENCENDER[k] ?? 1) : (k === "jornadaSinPausaMax" ? 0 : null))} titulo={on ? "Quitar el límite" : "Poner límite"} />
        {on
          ? <><CampoNumero valor={p[k]} defecto={AL_ENCENDER[k]} min={MINIMOS[k] ?? 0} decimal={decimal} step={step} onCambiar={v => set(k, v)} />{sufijo && <span style={{ fontSize: 11, color: C.dim }}>{sufijo}</span>}</>
          : <span style={{ fontSize: 11, color: C.dim }}>sin límite</span>}
      </span>
    );
  };
  const sino = (k, invertido = false) => <Interruptor on={invertido ? !p[k] : !!p[k]} onCambiar={v => set(k, invertido ? !v : v)} />;
  const lista = (k, opciones) => (
    <select value={String(p[k])} onChange={e => { const o = opciones.find(x => String(x[0]) === e.target.value); set(k, o[0]); }}
      style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: font, outline: "none", maxWidth: 360 }}>
      {opciones.map(([v, l]) => <option key={v} value={String(v)}>{l}</option>)}
    </select>
  );

  const lista2 = (valor, alCambiar, opciones) => (
    <select value={valor} onChange={e => alCambiar(e.target.value)}
      style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: font, outline: "none", maxWidth: 360 }}>
      {opciones.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  const mezclaBus = !p.entreLineas ? "no" : p.mezclaBuses === "grupo" ? "grupo" : "libre";
  const mezclaTurno = p.turnoUnaLinea || p.mezclaTurnos === "linea" ? "linea" : p.mezclaTurnos === "grupo" ? "grupo" : "libre";

  // ── categorías, apartados y ajustes ──
  // cada ajuste: [clave (para «en uso»), nombre, control, ayuda]
  const CATS = [
    { id: "vehiculos", nombre: "Vehículos", icono: <IconoCategoria tipo="vehiculos" />, secs: [
      { id: "flota", nombre: "Flota y coste", items: [
        ["flotaMax", "Flota disponible", limite("flotaMax", "autobuses"), "El optimizador no usa más autobuses que estos."],
        ["costeVehiculoDia", "Coste por autobús y día", limite("costeVehiculoDia", "€/autobús·día", { decimal: true }), "Para el coste estimado y «Menor coste»."],
        ["costeKm", "Coste por km", limite("costeKm", "€/km (con los vacíos)", { decimal: true, step: 0.01 })],
      ] },
      { id: "cochera", nombre: "Cochera", items: [
        ["margenCochera", "Rato mínimo en cochera entre dos salidas", numero("margenCochera", "min")],
        ["amplitudBusMax", "Amplitud máxima del autobús", limite("amplitudBusMax", "min de la salida a la vuelta a cochera"), "Pasado este tiempo fuera, el autobús vuelve a cochera."],
        ["esperaMaxCabecera", "Espera larga en cabecera: a cochera", limite("esperaMaxCabecera", "min"), "Si un autobús va a esperar más en una cabecera, vuelve a cochera y sale otra vez (si le da tiempo)."],
      ] },
      { id: "regulacion", nombre: "Regulación", items: [
        ["regulacion", "Regulación en cabecera", numero("regulacion", "min (si la línea no tiene la suya)")],
      ] },
      { id: "vacios", nombre: "Vacíos entre cabeceras", items: [
        ["vacioMaxKm", "Distancia máxima de un vacío", numero("vacioMaxKm", "km (0 = no se hacen)", { decimal: true, step: 0.5 })],
        ["velocidadVacio", "Velocidad de los vacíos", numero("velocidadVacio", "km/h"), "También la usa el conductor para ir de una cabecera a otra."],
        ["factorRodeo", "Factor de rodeo", numero("factorRodeo", "× la línea recta", { decimal: true, step: 0.05 })],
      ] },
    ] },
    { id: "conductores", nombre: "Conductores", icono: <IconoCategoria tipo="conductores" />, secs: [
      { id: "tipos", nombre: "Tipos de turno", usado: conTipos, buscar: "tipos de turno mañana tarde noche partido refuerzo cambio de bus", contenido: <TiposTurno tipos={p.tiposTurno} onChange={v => set("tiposTurno", v)} /> },
      { id: "jornada", nombre: "Jornada", items: [
        ...(conTipos ? [] : [
          ["amplitudMax", "Amplitud máxima del turno", numero("amplitudMax", "min")],
          ["jornadaMax", "Jornada de trabajo máxima", numero("jornadaMax", "min (piezas + huecos cortos)")],
          ["maxPartidos", "Jornadas partidas por turno", numero("maxPartidos", "como mucho (0 = sin partidos)")],
        ]),
        ["huecoNoPagado", "Hueco que ya no se paga", numero("huecoNoPagado", "min o más (jornada partida)")],
      ], nota: conTipos ? "Amplitud, trabajo mínimo y máximo y partidos: los marca cada tipo de turno." : null },
      { id: "toma", nombre: "Toma y deje de servicio", items: [
        ["tomaServicio", "Toma de servicio", numero("tomaServicio", "min al empezar"), "Presentarse, coger el autobús y prepararlo. Es trabajo pagado."],
        ["dejeServicio", "Deje de servicio", numero("dejeServicio", "min al acabar"), "Liquidar y dejar el autobús. Es trabajo pagado."],
        ["presentacionEnCochera", "El conductor se presenta en cochera", sino("presentacionEnCochera"), "Si coge el autobús en una cabecera (relevo en la calle), se cuenta además el viaje de la cochera hasta allí, y al revés al acabar."],
      ] },
      { id: "piezas", nombre: "Piezas y relevos", items: [
        ["piezaMax", "Pieza máxima", numero("piezaMax", "min de relevo a relevo")],
        ["piezaMin", "Pieza mínima", numero("piezaMin", "min (no se releva antes)")],
        ["maxPiezas", "Piezas por turno", numero("maxPiezas", "como mucho")],
        ["relevoMin", "Relevo en la misma cabecera", numero("relevoMin", "min")],
        ["desplazamiento", "Ir a otra cabecera", numero("desplazamiento", "min como mínimo"), "Si está lejos, lo que se tarde (distancia a la velocidad de los vacíos). Es trabajo, no pausa."],
      ] },
      { id: "cambios", nombre: "Cambios de bus", items: [
        ...(conTipos ? [] : [["maxCambiosBus", "Cambios de autobús por turno", limite("maxCambiosBus", "como mucho (0 = siempre el mismo)", { cero: true })]]),
        ["busSigueConductor", "Los autobuses siguen al conductor", sino("busSigueConductor"), "Después de hacer los turnos, donde un conductor cambiaría de autobús en una cabecera, se intercambia lo que les queda a los dos autobuses para que siga en el suyo. No cambia los turnos ni el número de autobuses."],
        ["maxCambiosBusTotal", "Cambios de autobús en todo el escenario", limite("maxCambiosBusTotal", "como mucho, sumando todos los turnos", { cero: true })],
        ["costeCambioBus", "Coste de cada cambio de autobús", limite("costeCambioBus", "€ por cambio", { decimal: true, cero: true }), "Lo que te molesta que un conductor cambie de autobús (Optimizar todo junto)."],
      ], nota: conTipos ? "Si un turno puede cambiar de autobús lo marca cada tipo de turno («Cambio de bus»)." : null },
      { id: "descansos", nombre: "Descansos", items: [
        ["jornadaSinPausaMax", "Exigir descanso si la jornada pasa de", limite("jornadaSinPausaMax", "min (Estatuto: 360)")],
        ["pausaJornadaMin", "Descanso de", numero("pausaJornadaMin", "min seguidos entre viajes")],
      ] },
      { id: "561", nombre: "Conducción (UE 561/2006)", items: [
        ["aplicar561", "Aplicar la UE 561/2006", sino("aplicar561"), "No se aplica a líneas regulares de hasta 50 km (la mayoría de las urbanas). Apagado: sin pausa de conducción ni corte de pieza a las 4 h 30."],
        ["conduccionContinuaMax", "Conducción continua máxima", numero("conduccionContinuaMax", "min")],
        ["pausaConduccionMin", "Pausa de conducción", numero("pausaConduccionMin", "min (se puede partir 15 + 30)")],
        ["conduccionDiariaMax", "Conducción diaria máxima", numero("conduccionDiariaMax", "min")],
      ] },
      { id: "plantilla", nombre: "Plantilla y coste", items: [
        ["conductoresMax", "Conductores disponibles", limite("conductoresMax", "turnos")],
        ["costeHora", "Coste por hora de conductor", limite("costeHora", "€/h", { decimal: true })],
      ] },
    ] },
    { id: "lineas", nombre: "Líneas", icono: <IconoCategoria tipo="lineas" />, secs: [
      { id: "grupos", nombre: "Grupos de líneas", usado: (p.gruposLineas || []).length > 0, buscar: "grupos de lineas agrupar mezclar", contenido: <GruposLineas red={red} grupos={p.gruposLineas} onChange={v => set("gruposLineas", v)} /> },
      { id: "mezclas", nombre: "Mezclas", items: [
        [["entreLineas", "mezclaBuses"], "Un autobús, en cabecera, puede seguir con…", lista2(mezclaBus, v => onChange({ entreLineas: v !== "no", mezclaBuses: v === "grupo" ? "grupo" : "libre" }), [
          ["libre", "Cualquier línea"], ["grupo", "Solo líneas de su grupo"], ["no", "La misma línea (otra solo pasando por cochera)"]]),
          "Pasando por cochera, un autobús siempre puede salir con otra línea."],
        [["turnoUnaLinea", "mezclaTurnos"], "Un conductor, en su turno, puede hacer…", lista2(mezclaTurno, v => onChange({ turnoUnaLinea: v === "linea", mezclaTurnos: v === "grupo" ? "grupo" : "libre" }), [
          ["libre", "Cualquier línea"], ["grupo", "Solo líneas de un mismo grupo"], ["linea", "Una sola línea"]]),
          "Las variantes de una línea cuentan como la misma. Para hacer varias, su autobús tiene que cambiar de línea o él cambiar de autobús («Cambio de bus»)."],
      ], nota: (p.gruposLineas || []).length ? null : "Aún no hay grupos: «Solo líneas de su grupo» funciona como «la misma línea». Créalos en «Grupos de líneas»." },
    ] },
    { id: "optimizador", nombre: "Optimizador", icono: <IconoCategoria tipo="optimizador" />, secs: [
      { id: "estrategia", nombre: "Estrategia de este calendario", items: [
        ["eleccion", "Qué autobús coge cada viaje", lista("eleccion", [["optimo", "El mínimo de autobuses (óptimo)"], ["ultimo", "El que menos espera en cabecera"], ["primero", "El que más espera (reparte la regulación)"]])],
        ["vacioKm", "Vacíos entre cabeceras", lista("vacioKm", [[null, `Hasta el máximo (${String(p.vacioMaxKm).replace(".", ",")} km)`], ...[8, 3].filter(k => k < p.vacioMaxKm).map(k => [k, `Hasta ${k} km`]), [0, "No (cada autobús sigue en su cabecera)"]])],
        ["corte", "Dónde se corta la pieza (relevo)", lista("corte", [["max", "Piezas lo más largas posible"], ["equilibrado", "Piezas de largo parecido"], ["flexible", "Cortes flexibles (el optimizador elige dónde relevar)"], ...[225, 210, 180, 150, 120, 90, 60].filter(m => m < p.piezaMax).map(m => [m, `Piezas de hasta ${hm(m)}`])])],
        ["metodo", "Cómo se forman los turnos", lista("metodo", [["particion", "La mejor combinación"], ["voraz", "Pieza a pieza (rápido)"]])],
        ...(p.metodo === "voraz" ? [["emparejar", "A qué conductor va cada pieza", lista("emparejar", [["primera", "Al que menos espera"], ["llena", "Al que lleva más horas (llenar turnos)"]])]] : []),
      ], nota: "La elige Optimizar; también puedes fijarla a mano." },
    ] },
  ];

  // en uso: lo que no está como viene por defecto
  const usado = k => { const v = p[k], d = PARAMS_DEFECTO[k]; if (Array.isArray(d)) return (v || []).length > 0; return !(v === d || (v == null && d == null) || (v === "" && d == null)); };
  const revision = revisarRestricciones(p);
  return (
    <PanelRestricciones categorias={CATS} usado={usado} onCerrar={onCerrar} seccionInicial="tipos"
      cabecera={<SelectorCalendario red={red} valor={p.dia} onCambiar={onCambiarDia} ancho={280} />}
      avisos={revision.length > 0 && (
        <div style={{ margin: "0 0 14px", padding: "8px 12px", borderRadius: 8, border: `1px solid ${revision.some(x => x.grave) ? "rgba(248,113,113,0.5)" : "rgba(251,191,36,0.45)"}`, background: revision.some(x => x.grave) ? "rgba(248,113,113,0.08)" : "rgba(251,191,36,0.07)" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: revision.some(x => x.grave) ? C.red : C.amber, marginBottom: 4 }}>Revisa estas restricciones</div>
          {revision.map((x, i) => <div key={i} style={{ fontSize: 11.5, color: x.grave ? "#fecaca" : C.muted, lineHeight: 1.5 }}>{x.grave ? "⛔" : "⚠"} {x.texto}</div>)}
        </div>
      )} />
  );
}

// ── Selector de calendario: tipos de día y calendarios del GTFS ─────────
