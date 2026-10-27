// Panel de Restricciones común a las dos verticales (puntos y líneas), como
// en los programas del sector: buscador, «en uso / todas», las categorías a
// la izquierda con sus apartados y, a la derecha, solo los ajustes del
// apartado elegido. Los límites opcionales llevan un interruptor.
import { useState } from "react";
import { C } from "./tema.js";
import { Ayuda } from "./ui/ayuda.jsx";


const font = "var(--font)";
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function Interruptor({ on, onCambiar, titulo }) {
  return (
    <button type="button" role="switch" aria-checked={on} title={titulo} onClick={() => onCambiar(!on)}
      style={{ width: 34, height: 18, borderRadius: 8, border: "none", padding: 2, cursor: "pointer", flexShrink: 0, background: on ? C.green : "#3a475e", transition: "background .15s", display: "flex", justifyContent: on ? "flex-end" : "flex-start" }}>
      <span style={{ width: 14, height: 14, borderRadius: 8, background: "#fff", display: "block" }} />
    </button>
  );
}

const svg = path => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{path}</svg>;
const ICONOS = {
  vehiculos: svg(<><rect x="4" y="3" width="16" height="14" rx="2" /><path d="M4 11h16M8 21v-4M16 21v-4" /></>),
  conductores: svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>),
  lineas: svg(<><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8 7.5c4 2 4 7 8 9" /></>),
  paradas: svg(<><path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></>),
  optimizador: svg(<path d="M3 17l6-6 4 4 8-8M15 7h6v6" />),
};
/** El icono de una categoría: vehiculos · conductores · lineas · paradas · optimizador */
export function IconoCategoria({ tipo }) { return ICONOS[tipo] || null; }

/**
 * @param categorias [{ id, nombre, icono, secs: [{ id, nombre, items?: [[clave | [claves], nombre, control, ayuda?]],
 *                    contenido?: nodo (en vez de items), buscar?: "palabras", usado?: bool, nota? }] }]
 * @param usado      clave → ¿está cambiada respecto a lo de por defecto?
 * @param cabecera   lo que va al lado del título (calendario, plantillas…)
 * @param avisos     lo que va arriba a la derecha (revisa estas restricciones…)
 */
export function PanelRestricciones({ titulo = "Restricciones", cabecera, categorias, usado, avisos, onCerrar, seccionInicial, alto = "min(62vh, 660px)" }) {
  const [busca, setBusca] = useState("");
  const [enUso, setEnUso] = useState(false);
  const [sec, setSec] = useState(seccionInicial || null);
  const usadoK = k => (Array.isArray(k) ? k.some(usado) : usado(k));
  const secUsada = s => s.usado ?? (s.items || []).some(([k]) => usadoK(k));
  const q = norm(busca.trim());
  const coincide = it => !q || norm(`${it[1]} ${it[3] || ""}`).includes(q);
  const visibles = categorias
    .map(c => ({ ...c, secs: c.secs.filter(s => (!enUso || secUsada(s)) && (!q || norm(`${s.nombre} ${s.buscar || ""}`).includes(q) || (s.items || []).some(coincide))) }))
    .filter(c => c.secs.length);
  const todas = visibles.flatMap(c => c.secs);
  const actual = q ? null : todas.find(s => s.id === sec) || todas[0];

  const fila = it => (
    <div key={String(it[0])} style={{ display: "grid", gridTemplateColumns: "250px 1fr", gap: 14, alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
      <div>
        <div style={{ fontSize: 12, lineHeight: 1.35, color: usadoK(it[0]) ? C.text : C.muted, fontWeight: usadoK(it[0]) ? 600 : 400 }}>{it[1]}<Ayuda texto={it[3]} /></div>
      </div>
      <div>{it[2]}</div>
    </div>
  );
  const apartado = (s, conTitulo) => (
    <div key={s.id} style={{ marginBottom: 18 }}>
      {conTitulo && <div style={{ fontSize: 11, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 700, marginBottom: 4 }}>{s.nombre}</div>}
      {s.nota && <div style={{ fontSize: 11, color: C.muted, margin: "4px 0 6px", lineHeight: 1.5 }}>{s.nota}</div>}
      {s.contenido ?? (q ? s.items.filter(coincide) : s.items).map(fila)}
    </div>
  );

  return (
    <div style={{ background: C.surface2, borderBottom: `1px solid ${C.border}`, flexShrink: 0, height: alto, display: "flex", flexDirection: "column", animation: "sched-fadein .15s ease both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 20px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: C.dim, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600 }}>{titulo}</span>
        {cabecera}
        <span style={{ flex: 1 }} />
        {onCerrar && <button onClick={onCerrar} className="op-btn">Cerrar</button>}
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ width: 250, flexShrink: 0, borderRight: `1px solid ${C.border}`, padding: 12, overflowY: "auto", background: C.bg }}>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar…"
            style={{ width: "100%", boxSizing: "border-box", background: C.surface2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: "7px 10px", fontSize: 12, fontFamily: font, outline: "none", marginBottom: 10 }} />
          <div style={{ display: "flex", border: `1px solid ${C.border2}`, borderRadius: 8, overflow: "hidden", marginBottom: 14 }}>
            {[[true, "En uso"], [false, "Todas"]].map(([v, t]) => (
              <button key={t} onClick={() => setEnUso(v)} style={{ flex: 1, padding: "5px 0", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: font, background: enUso === v ? C.surface2 : "transparent", color: enUso === v ? C.text : C.dim }}>{t}</button>
            ))}
          </div>
          {visibles.map(c => (
            <div key={c.id} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.green, fontSize: 13, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>{c.icono}{c.nombre}</div>
              {c.secs.map(s => {
                const activo = !q && actual?.id === s.id;
                return (
                  <button key={s.id} onClick={() => { setBusca(""); setSec(s.id); }} style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", padding: "5px 8px 5px 23px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 12, fontFamily: font, background: activo ? C.surface2 : "none", color: activo ? C.text : C.muted }}>
                    <span style={{ flex: 1 }}>{s.nombre}</span>
                    {secUsada(s) && <span title="Tiene algo cambiado" style={{ width: 6, height: 6, borderRadius: 4, background: C.green, flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>
          ))}
          {!visibles.length && <div style={{ fontSize: 12, color: C.dim, padding: 6 }}>{enUso && !q ? "No has cambiado nada todavía: está todo como viene." : `Nada con «${busca}».`}</div>}
        </div>
        <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "14px 24px" }}>
          {avisos}
          {q
            ? (todas.length ? todas.map(s => apartado(s, true)) : <div style={{ fontSize: 12, color: C.dim }}>Ninguna restricción con «{busca}».</div>)
            : actual && <>
              <div style={{ fontSize: 15, color: C.text, fontWeight: 600, marginBottom: 12 }}>{actual.nombre}</div>
              {apartado(actual, false)}
            </>}
        </div>
      </div>
    </div>
  );
}
