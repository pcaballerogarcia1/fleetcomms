// Ficha de requisitos → Criterios de adjudicación: lo que da puntos.
// El lector propone (del anuncio o del pliego administrativo, con su página);
// aquí se aceptan y se corrigen: cada criterio con sus puntos y si es el
// precio, con fórmula o por juicio de valor; la fórmula del precio y la regla
// de baja anormal. Alternativas puntúa con esto.
import { Award, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { C } from "../tema.js";
import { BAJA_ANORMAL, FORMULAS_PRECIO, mejorPropuesta } from "./criterios.js";
import { fijarAdjudicacion } from "./store.js";

const TIPOS = [["precio", "Precio"], ["formula", "Con fórmula"], ["juicio", "Juicio de valor"], ["mejora", "Mejora"]];

/** Lo que proponen los documentos subidos: el grupo que suma 100, con apartados y escalones */
const propuestaDe = docs => mejorPropuesta((docs || []).map(d => ({ nombre: d.nombre, adjudicacion: d.lectura?.adjudicacion })));

export function CriteriosFicha({ concursoId, docs, ficha, onError }) {
  const guardado = ficha?.adjudicacion || null;
  const [borrador, setBorrador] = useState(null);
  const adj = borrador || guardado;
  const tmr = useRef();
  const avisar = useRef(onError);
  useEffect(() => { avisar.current = onError; }, [onError]);
  useEffect(() => {
    if (!borrador) return;
    clearTimeout(tmr.current);
    tmr.current = setTimeout(() => { fijarAdjudicacion(concursoId, borrador).then(() => setBorrador(null)).catch(e => avisar.current?.(e.message || String(e))); }, 600);
    return () => clearTimeout(tmr.current);
  }, [borrador, concursoId]);
  const cambiar = f => setBorrador(b => f(b || guardado));

  const prop = propuestaDe(docs);
  const usarPropuesta = () => setBorrador({
    criterios: (prop?.criterios || []).map(({ nombre, puntos, tipo, pagina, docNombre, subcriterios, escalones, unidad }) => ({ nombre, puntos, tipo, pagina: pagina ?? null, doc: docNombre ?? null, subcriterios: subcriterios || null, escalones: escalones || null, unidad: unidad || null })),
    formula: prop?.formula?.id || "lineal", formulaPagina: prop?.formula?.pagina ?? null, formulaSupuesta: !prop?.formula, saciedad: 15,
    baja: { id: prop?.baja?.id || "art85", valor: prop?.baja?.valor ?? null }, bajaPagina: prop?.baja?.pagina ?? null, origen: "pliego",
  });
  const aMano = () => setBorrador({ criterios: [{ nombre: "Oferta económica", puntos: 50, tipo: "precio" }, { nombre: "Memoria técnica", puntos: 50, tipo: "juicio" }], formula: "lineal", saciedad: 15, baja: { id: "art85", valor: null }, origen: "mano" });

  const tarjeta = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 };
  const titulo = <div style={{ fontSize: 15, fontWeight: 650, color: C.text, margin: "22px 0 10px", display: "flex", alignItems: "center", gap: 8 }}><Award size={16} color={C.blue} /> Criterios de adjudicación</div>;

  if (!adj) {
    return (
      <div>
        {titulo}
        <div style={{ ...tarjeta, padding: 14 }}>
          {prop?.criterios?.length ? <>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>He encontrado estos criterios. Revísalos y úsalos: Alternativas calcula los puntos con ellos.</div>
            {prop.criterios.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 10, fontSize: 13, padding: "4px 0", color: C.text }} title={c.frase}>
                <span style={{ flex: 1 }}>{c.nombre}{c.subcriterios ? <span style={{ color: C.dim }}> · {c.subcriterios.length} apartados</span> : null}{c.escalones ? <span style={{ color: C.dim }}> · escalones {c.escalones.map(e => `${e.desde}${e.hasta ? `–${e.hasta}` : "+"}: ${e.puntos}`).join(", ")}</span> : null}</span><b>{c.puntos} puntos</b><span style={{ width: 120, color: C.muted }}>{TIPOS.find(t => t[0] === c.tipo)?.[1]}</span><span style={{ color: C.dim, fontSize: 12 }}>pág. {c.pagina} · {c.docNombre}</span>
              </div>
            ))}
            {!prop.formula && <div style={{ fontSize: 13, color: C.amber, marginTop: 6 }}><TriangleAlert size={12} style={{ verticalAlign: "-2px" }} /> El pliego no dice con qué fórmula se puntúa el precio: tendrás que elegir una (suposición).</div>}
            {prop.formula && <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>Fórmula del precio: <b style={{ color: C.text }}>{FORMULAS_PRECIO.find(f => f.id === prop.formula.id)?.nombre}</b> (pág. {prop.formula.pagina})</div>}
            {prop.baja && <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>Baja anormal: <b style={{ color: C.text }}>{BAJA_ANORMAL.find(f => f.id === prop.baja.id)?.nombre}{prop.baja.valor != null ? ` (${prop.baja.valor} puntos)` : ""}</b> (pág. {prop.baja.pagina})</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="op-btn op-primario" onClick={usarPropuesta}>Usar estos criterios</button>
              <button className="op-btn op-fantasma" onClick={aMano}>Ponerlos a mano</button>
            </div>
          </> : <>
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.55 }}>No he encontrado los criterios en lo subido. Suelen estar en el <b style={{ color: C.text }}>pliego de cláusulas administrativas</b> o en el <b style={{ color: C.text }}>anuncio</b> de la Plataforma: súbelo en «Pliegos», o ponlos a mano.</div>
            <button className="op-btn" style={{ marginTop: 10 }} onClick={aMano}><Plus size={14} /> Ponerlos a mano</button>
          </>}
        </div>
      </div>
    );
  }

  const total = adj.criterios.reduce((s, c) => s + (Number(c.puntos) || 0), 0);
  const precio = adj.criterios.filter(c => c.tipo === "precio").reduce((s, c) => s + (Number(c.puntos) || 0), 0);
  const fila = { display: "flex", gap: 8, alignItems: "center", padding: "6px 12px", borderTop: `1px solid ${C.border}`, flexWrap: "wrap" };
  const cambiarCriterio = (i, campo, v) => cambiar(a => ({ ...a, criterios: a.criterios.map((c, j) => (j === i ? { ...c, [campo]: v } : c)) }));
  return (
    <div>
      {titulo}
      <div style={{ ...tarjeta, overflow: "hidden" }}>
        {adj.criterios.map((c, i) => (
          <div key={i} style={{ ...fila, borderTop: i ? fila.borderTop : "none" }}>
            <input className="op-input" value={c.nombre} onChange={e => cambiarCriterio(i, "nombre", e.target.value)} style={{ flex: "1 1 240px", height: 30 }} aria-label="Criterio" />
            <input className="op-input" type="number" min={0} step="0.5" value={c.puntos} onChange={e => cambiarCriterio(i, "puntos", e.target.value === "" ? 0 : Number(e.target.value))} style={{ width: 80, height: 30, textAlign: "right" }} aria-label="Puntos" />
            <span style={{ fontSize: 12, color: C.dim }}>puntos</span>
            <select className="op-input" value={c.tipo} onChange={e => cambiarCriterio(i, "tipo", e.target.value)} style={{ width: 150, height: 30 }} aria-label="Tipo">
              {TIPOS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
            <span style={{ fontSize: 12, color: C.dim, width: 120 }}>{c.pagina ? `pág. ${c.pagina}` : "a mano"}</span>
            <button className="op-btn op-fantasma op-icono" title="Quitar" onClick={() => cambiar(a => ({ ...a, criterios: a.criterios.filter((_, j) => j !== i) }))}><Trash2 size={14} /></button>
            {(c.subcriterios?.length > 0 || c.escalones?.length > 0) && (
              <div style={{ flexBasis: "100%", fontSize: 12, color: C.dim, paddingLeft: 4 }}>
                {c.subcriterios?.length > 0 && <>Apartados: {c.subcriterios.map(x => `${x.nombre} (${x.puntos})`).join(" · ")}</>}
                {c.escalones?.length > 0 && <>Escalones{c.unidad ? ` (${c.unidad})` : ""}: {c.escalones.map(e => `${e.desde}${e.hasta ? `–${e.hasta}` : " o más"} → ${e.puntos} p.`).join(" · ")}. Alternativas calcula qué nivel compensa con su coste.</>}
              </div>
            )}
          </div>
        ))}
        <div style={{ ...fila, justifyContent: "space-between" }}>
          <button className="op-btn op-fantasma" style={{ height: 28 }} onClick={() => cambiar(a => ({ ...a, criterios: [...a.criterios, { nombre: "", puntos: 0, tipo: "formula" }] }))}><Plus size={14} /> Añadir criterio</button>
          <div style={{ fontSize: 13, color: total === 100 ? C.green : C.amber, fontWeight: 600 }}>
            {total !== 100 && <TriangleAlert size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />}Total {total} puntos · precio {precio}{total !== 100 ? " (suelen sumar 100)" : ""}
          </div>
        </div>
        <div style={{ ...fila, background: C.surface2 }}>
          <span style={{ fontSize: 13, color: C.muted, width: 150 }}>Fórmula del precio</span>
          <select className="op-input" value={adj.formula} onChange={e => cambiar(a => ({ ...a, formula: e.target.value, formulaSupuesta: false }))} style={{ width: 260, height: 30 }} aria-label="Fórmula del precio">
            {FORMULAS_PRECIO.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </select>
          {adj.formula === "saciedad" && <><span style={{ fontSize: 13, color: C.muted }}>umbral</span><input className="op-input" type="number" min={1} value={adj.saciedad ?? 15} onChange={e => cambiar(a => ({ ...a, saciedad: Number(e.target.value) || 15 }))} style={{ width: 70, height: 30, textAlign: "right" }} /><span style={{ fontSize: 12, color: C.dim }}>% de baja</span></>}
          <span style={{ fontSize: 12, color: adj.formulaSupuesta ? C.amber : C.dim, flex: "1 1 260px" }}>{adj.formulaSupuesta ? "El pliego no la dice: es una suposición. " : ""}{FORMULAS_PRECIO.find(f => f.id === adj.formula)?.texto}{adj.formulaPagina ? ` · pág. ${adj.formulaPagina}` : ""}</span>
        </div>
        <div style={{ ...fila, background: C.surface2 }}>
          <span style={{ fontSize: 13, color: C.muted, width: 150 }}>Baja anormal</span>
          <select className="op-input" value={adj.baja?.id || "art85"} onChange={e => cambiar(a => ({ ...a, baja: { id: e.target.value, valor: a.baja?.valor ?? (e.target.value === "media" ? 10 : null) } }))} style={{ width: 260, height: 30 }} aria-label="Baja anormal">
            {BAJA_ANORMAL.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </select>
          {adj.baja?.id === "media" && <><input className="op-input" type="number" min={1} value={adj.baja.valor ?? 10} onChange={e => cambiar(a => ({ ...a, baja: { ...a.baja, valor: Number(e.target.value) || 10 } }))} style={{ width: 70, height: 30, textAlign: "right" }} /><span style={{ fontSize: 12, color: C.dim }}>puntos</span></>}
          <span style={{ fontSize: 12, color: C.dim, flex: "1 1 260px" }}>{BAJA_ANORMAL.find(f => f.id === (adj.baja?.id || "art85"))?.texto}{adj.bajaPagina ? ` · pág. ${adj.bajaPagina}` : ""}</span>
        </div>
      </div>
      <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>
        Se guardan solos. {prop?.criterios?.length ? <button className="op-btn op-fantasma" style={{ height: 24, fontSize: 12, padding: "0 6px" }} onClick={() => window.confirm("¿Volver a lo que dice el pliego? Se pierden los cambios.") && usarPropuesta()}>Volver a lo del pliego</button> : null}
      </div>
    </div>
  );
}
