// Panel de restricciones del optimizador.
// (Separado de scheduling.jsx sin cambiar su comportamiento.)
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../firebase.js";
import { t, useLang } from "../i18n.js";
import { minToTime, timeToMin } from "../vrp-engine.js";
import { C, font, mono } from "./estilo.js";

// ── CONSTRAINTS PANEL ─────────────────────────────────────────────
export function ConstraintsPanel({ c, onChange, orgId }) {
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
  const row = (label, children) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <label style={{ fontSize: 11, color: C.muted, width: 200, flexShrink: 0 }}>{label}</label>
      {children}
    </div>
  );
  const numInput = (key, min, max, suffix) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input type="number" min={min} max={max} value={c[key] || ""}
        onChange={e => set(key, parseInt(e.target.value) || 0)}
        style={{ width: 72, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: mono, outline: "none" }}
      />
      {suffix && <span style={{ fontSize: 11, color: C.dim }}>{suffix}</span>}
    </div>
  );
  const timeInput = (key) => (
    <input type="time"
      value={minToTime(c[key])}
      onChange={e => { const m = timeToMin(e.target.value); if (m !== null) set(key, m); }}
      style={{ background: C.surface2, border: `1px solid ${C.border}`, color: C.blueText, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: mono, outline: "none" }}
    />
  );
  const decInput = (key, suffix) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input type="number" min="0" step="0.01" value={c[key] ?? ""}
        onChange={e => set(key, e.target.value === "" ? null : Math.max(0, parseFloat(String(e.target.value).replace(",", ".")) || 0))}
        style={{ width: 72, background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: mono, outline: "none" }}
      />
      {suffix && <span style={{ fontSize: 11, color: C.dim }}>{suffix}</span>}
    </div>
  );
  const checkbox = (key) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
      <input type="checkbox" checked={!!c[key]} onChange={e => set(key, e.target.checked)}
        style={{ width: 15, height: 15, accentColor: C.blue, cursor: "pointer" }}
      />
    </label>
  );

  return (
    <div style={{
      background: C.surface2, borderBottom: `1px solid ${C.border}`,
      padding: "14px 20px", flexShrink: 0,
      animation: "sched-fadein .15s ease both",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>{t("restricciones", lang)}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase" }}>{t("plantillas", lang)}</span>
          <select
            value={selectedTpl}
            onChange={e => e.target.value ? cargarPlantilla(e.target.value) : setSelectedTpl("")}
            style={{ background: C.surface2, border: `1px solid ${C.border2}`, color: C.text, borderRadius: 6, padding: "4px 8px", fontSize: 11, fontFamily: font, cursor: "pointer", outline: "none", maxWidth: 160 }}
          >
            <option value="">— ninguna —</option>
            {templates.map(tpl => <option key={tpl._id} value={tpl._id}>{tpl.nombre}</option>)}
          </select>
          {selectedTpl && (
            <button onClick={borrarPlantillaActual} title="Eliminar esta plantilla" style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1 }}>×</button>
          )}
          <button onClick={guardarPlantilla} style={{
            padding: "4px 9px", background: "none", border: `1px solid ${C.border}`, color: C.muted,
            borderRadius: 6, fontSize: 10.5, cursor: "pointer", fontFamily: font, whiteSpace: "nowrap",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blue; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
          >Guardar como plantilla</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 40px" }}>
        {row("Duración máxima de turno (0 = sin límite)", numInput("maxShiftMin", 0, 1440, "min"))}
        {row("Máximo de paradas (0 = sin límite)", numInput("maxStops", 0, 500, "paradas"))}
        {row("Pausa automática cada", numInput("breakAfter", 0, 480, "min trabajo"))}
        {row("Duración de la pausa", numInput("breakDur", 0, 120, "min"))}
        {row("Ventana: hora de inicio", timeInput("startMin"))}
        {row("Ventana: hora de fin", timeInput("endMin"))}
        {row("Días máximos de escenario (0 = automático)", numInput("maxDays", 0, 365, "días"))}
        {row("Circularidad (vuelve donde empieza)", checkbox("circular"))}
        {row("Coste por hora de conductor (indicadores)", decInput("costeHora", "€/h"))}
        {row("Coste por km (indicadores)", decInput("costeKm", "€/km"))}
        {row("No aplicar tiempos de conducción UE 561/2006 (p. ej. recogida de residuos exenta)", checkbox("sin561"))}
      </div>
      <div style={{ marginTop: 4, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
        {row("Rostering", (
          <select value={c.rosterMode || "cuadrante"} onChange={e => set("rosterMode", e.target.value)}
            style={{ background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: font, outline: "none", cursor: "pointer" }}>
            <option value="cuadrante">Respetar el cuadrante</option>
            <option value="libre">Libre — optimizar turnos después en Rostering</option>
          </select>
        ))}
        <div style={{ fontSize: 11, color: C.dim, marginTop: -4 }}>
          {(c.rosterMode || "cuadrante") === "cuadrante"
            ? "Cada conductor trabaja el turno de su cuadrante ese día (M/T/N obligan, L/B no trabaja, D/G/vacío = turno de su ficha)."
            : "Las rutas se calculan sin mirar quién trabaja. Después, en Rostering → Optimizar, se asigna trabajador y vehículo a cada turno según las reglas (días seguidos, horas/mes, descanso)."}
        </div>
      </div>
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: C.muted }}>Priorizar optimización</span>
          <span style={{ fontSize: 11, color: C.blueText, fontFamily: mono }}>
            {c.optimizeWeight > 0 ? `${c.optimizeWeight}% turnos` : "kilómetros"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase", flexShrink: 0 }}>Kilómetros</span>
          <input type="range" min={0} max={100} step={5} value={c.optimizeWeight || 0}
            onChange={e => set("optimizeWeight", parseInt(e.target.value))}
            style={{ flex: 1, accentColor: C.blue, cursor: "pointer" }}
          />
          <span style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase", flexShrink: 0 }}>Turnos</span>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: C.dim }}>
          Hacia "Kilómetros": rutas más compactas por vehículo, aunque la carga de trabajo quede desigual entre ellos.
          Hacia "Turnos": reparte el trabajo por tiempo estimado para evitar que un solo vehículo alargue los días del escenario, a costa de más km totales.
        </div>
      </div>
      {c.maxDays > 0 && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 10 }}>
            Si con la flota actual no caben todas las paradas en {c.maxDays} día{c.maxDays === 1 ? "" : "s"},
            se añadirán automáticamente los vehículos y conductores necesarios ("Vehículo necesario 1", "Conductor necesario 1"…) para cumplir el límite.
          </div>
          {row("Jornada máx. de los añadidos (0 = jornada completa)", numInput("virtualShiftMin", 0, 1440, "min"))}
        </div>
      )}
      {c.circular && (
        <div style={{ marginTop: 10, fontSize: 11, color: C.dim }}>
          Cada vehículo (y cada conductor, si hay relevo de turno en el mismo vehículo) termina su recorrido
          en el mismo punto donde lo empezó: el depósito si el vehículo tiene uno configurado, o si no,
          la ubicación de su primera parada del día.
        </div>
      )}
    </div>
  );
}
