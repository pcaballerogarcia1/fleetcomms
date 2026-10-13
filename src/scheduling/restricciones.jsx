// Panel de restricciones del optimizador de puntos: el mismo formato que el de
// líneas (buscador, «en uso / todas», categorías y apartados, interruptores).
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../firebase.js";
import { t, useLang } from "../i18n.js";
import { minToTime, timeToMin } from "../vrp-engine.js";
import { C, font, mono } from "./estilo.js";
import { PanelRestricciones, Interruptor, IconoCategoria } from "../panel-restricciones.jsx";
import { RESTRICCIONES_DEFECTO } from "./restricciones-defecto.js";

// Valor con el que se enciende un límite opcional (apagado = sin límite)
const AL_ENCENDER = { maxStops: 100, maxDays: 5, virtualShiftMin: 480, costeKm: 0.9, maxShiftMin: 480, breakAfter: 240, costeHora: 22 };

// ── CONSTRAINTS PANEL ─────────────────────────────────────────────
export function ConstraintsPanel({ c, onChange, orgId, onCerrar }) {
  const lang = useLang();
  const set = (key, val) => onChange({ ...c, [key]: val });

  // ── Plantillas de restricciones reutilizables entre proyectos ──
  const [templates, setTemplates] = useState([]);
  const [selectedTpl, setSelectedTpl] = useState("");

  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(
      query(collection(db, "scheduling_constraint_templates"), where("org_id", "==", orgId)),
      snap => setTemplates(snap.docs.map(d => ({ _id: d.id, ...d.data() })).sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""))),
      () => {}
    );
  }, [orgId]);

  async function guardarPlantilla() {
    const nombre = window.prompt("Nombre para esta plantilla de restricciones:");
    if (!nombre || !nombre.trim()) return;
    await addDoc(collection(db, "scheduling_constraint_templates"), {
      org_id: orgId, nombre: nombre.trim(), constraints: c, createdAt: serverTimestamp(),
    });
  }
  function cargarPlantilla(id) {
    setSelectedTpl(id);
    const tpl = templates.find(x => x._id === id);
    if (tpl) onChange({ ...c, ...tpl.constraints });
  }
  async function borrarPlantillaActual() {
    if (!selectedTpl) return;
    if (!window.confirm("¿Eliminar esta plantilla? No afecta a los proyectos donde ya se usó.")) return;
    await deleteDoc(doc(db, "scheduling_constraint_templates", selectedTpl));
    setSelectedTpl("");
  }
  // ── controles ──
  const estiloNum = { width: 72, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: mono, outline: "none" };
  const sufijo = s => s && <span style={{ fontSize: 11, color: C.dim }}>{s}</span>;
  const numero = (key, min, max, suf) => (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input type="number" min={min} max={max} value={c[key] ?? ""} onChange={e => set(key, parseInt(e.target.value) || 0)} style={estiloNum} />{sufijo(suf)}
    </span>
  );
  // límite opcional: interruptor + número (apagado = 0 / vacío, sin límite)
  const limite = (key, max, suf, { decimal = false } = {}) => {
    const on = Number(c[key]) > 0;
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Interruptor on={on} onCambiar={v => set(key, v ? AL_ENCENDER[key] : (decimal ? null : 0))} titulo={on ? "Quitar el límite" : "Poner límite"} />
        {on ? <>
          <input type="number" min="0" max={max} step={decimal ? "0.01" : undefined} value={c[key] ?? ""}
            onChange={e => set(key, decimal ? (e.target.value === "" ? null : Math.max(0, parseFloat(String(e.target.value).replace(",", ".")) || 0)) : parseInt(e.target.value) || 0)} style={estiloNum} />{sufijo(suf)}
        </> : <span style={{ fontSize: 11, color: C.dim }}>sin límite</span>}
      </span>
    );
  };
  const hora = key => (
    <input type="time" value={minToTime(c[key])} onChange={e => { const m = timeToMin(e.target.value); if (m !== null) set(key, m); }}
      style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.blueText, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: mono, outline: "none", colorScheme: "dark" }} />
  );
  const sino = (key, invertido = false) => <Interruptor on={invertido ? !c[key] : !!c[key]} onCambiar={v => set(key, invertido ? !v : v)} />;

  const CATS = [
    { id: "vehiculos", nombre: "Vehículos", icono: <IconoCategoria tipo="vehiculos" />, secs: [
      { id: "rutas", nombre: "Rutas", items: [
        ["maxStops", "Máximo de paradas por ruta", limite("maxStops", 500, "paradas")],
        ["circular", "Circularidad (vuelve donde empieza)", sino("circular"), "Cada vehículo (y cada conductor, si hay relevo en el mismo vehículo) termina donde empezó: su depósito o, si no tiene, su primera parada del día."],
      ] },
      { id: "flota", nombre: "Días y flota necesaria", items: [
        ["maxDays", "Días máximos del escenario", limite("maxDays", 365, "días"), "Si con la flota actual no caben todas las paradas en esos días, se añaden los vehículos y conductores necesarios («Vehículo necesario 1»…). Apagado: los días que hagan falta."],
        ...(c.maxDays > 0 ? [["virtualShiftMin", "Jornada de los añadidos", limite("virtualShiftMin", 1440, "min"), "Apagado: jornada completa."]] : []),
      ] },
      { id: "coste-v", nombre: "Coste", items: [
        ["costeKm", "Coste por km", limite("costeKm", null, "€/km", { decimal: true }), "Para el coste estimado de los indicadores."],
      ] },
    ] },
    { id: "conductores", nombre: "Trabajadores", icono: <IconoCategoria tipo="conductores" />, secs: [
      { id: "jornada", nombre: "Jornada y horario", items: [
        ["maxShiftMin", "Duración máxima de turno", limite("maxShiftMin", 1440, "min")],
        ["startMin", "Ventana: hora de inicio", hora("startMin")],
        ["endMin", "Ventana: hora de fin", hora("endMin")],
      ] },
      { id: "pausas", nombre: "Pausas", items: [
        ["breakAfter", "Pausa automática cada", limite("breakAfter", 480, "min de trabajo")],
        ["breakDur", "Duración de la pausa", numero("breakDur", 0, 120, "min")],
      ] },
      { id: "561", nombre: "Conducción (UE 561/2006)", items: [
        ["sin561", "Aplicar la UE 561/2006", sino("sin561", true), "Apagado si la actividad está exenta (p. ej. la recogida de residuos)."],
      ] },
      { id: "rostering", nombre: "Rostering", items: [
        ["rosterMode", "Quién trabaja cada día", (
          <select value={c.rosterMode || "cuadrante"} onChange={e => set("rosterMode", e.target.value)}
            style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: font, outline: "none", cursor: "pointer" }}>
            <option value="cuadrante">Respetar el cuadrante</option>
            <option value="libre">Libre — optimizar turnos después en Rostering</option>
          </select>
        ), (c.rosterMode || "cuadrante") === "cuadrante"
          ? "Cada conductor trabaja el turno de su cuadrante ese día (M/T/N obligan, L/B no trabaja, D/G/vacío = turno de su ficha)."
          : "Las rutas se calculan sin mirar quién trabaja. Después, en Rostering → Optimizar, se asigna trabajador y vehículo a cada turno según las reglas."],
      ] },
      { id: "coste-c", nombre: "Coste", items: [
        ["costeHora", "Coste por hora de conductor", limite("costeHora", null, "€/h", { decimal: true }), "Para el coste estimado de los indicadores."],
      ] },
    ] },
    { id: "optimizador", nombre: "Optimizador", icono: <IconoCategoria tipo="optimizador" />, secs: [
      { id: "prioridad", nombre: "Qué priorizar", items: [
        ["optimizeWeight", "Kilómetros o turnos", (
          <div style={{ maxWidth: 420 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase", flexShrink: 0 }}>Kilómetros</span>
              <input type="range" min={0} max={100} step={5} value={c.optimizeWeight || 0} onChange={e => set("optimizeWeight", parseInt(e.target.value))} style={{ flex: 1, accentColor: C.blue, cursor: "pointer" }} />
              <span style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase", flexShrink: 0 }}>Turnos</span>
            </div>
            <div style={{ fontSize: 11, color: C.blueText, fontFamily: mono, marginTop: 4 }}>{c.optimizeWeight > 0 ? `${c.optimizeWeight}% turnos` : "kilómetros"}</div>
          </div>
        ), "Hacia «Kilómetros»: rutas más compactas, aunque la carga quede desigual. Hacia «Turnos»: reparte el trabajo por tiempo para que ningún vehículo alargue los días del escenario, a costa de más km."],
      ] },
    ] },
  ];
  const usado = k => { const v = c[k], d = RESTRICCIONES_DEFECTO[k]; return !(v === d || (v == null && d == null) || (v === "" && d == null) || (v == null && d === false) || (v == null && d === 0)); };

  // plantillas (arriba, junto al título)
  const plantillas = (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase" }}>{t("plantillas", lang)}</span>
      <select value={selectedTpl} onChange={e => e.target.value ? cargarPlantilla(e.target.value) : setSelectedTpl("")}
        style={{ background: C.bg, border: `1px solid ${C.border2}`, color: C.text, borderRadius: 6, padding: "4px 8px", fontSize: 11, fontFamily: font, cursor: "pointer", outline: "none", maxWidth: 180 }}>
        <option value="">— ninguna —</option>
        {templates.map(tpl => <option key={tpl._id} value={tpl._id}>{tpl.nombre}</option>)}
      </select>
      {selectedTpl && <button onClick={borrarPlantillaActual} title="Eliminar esta plantilla" style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1 }}>×</button>}
      <button onClick={guardarPlantilla} style={{ padding: "4px 9px", background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, fontSize: 10.5, cursor: "pointer", fontFamily: font, whiteSpace: "nowrap" }}>Guardar como plantilla</button>
    </div>
  );

  return <PanelRestricciones titulo={t("restricciones", lang)} cabecera={plantillas} categorias={CATS} usado={usado} onCerrar={onCerrar} seccionInicial="jornada" alto="min(58vh, 600px)" />;
}
