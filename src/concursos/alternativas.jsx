// Concursos → Alternativas: qué baja presentar.
// Con los criterios de adjudicación de la ficha, el coste del Cálculo y lo que
// se espera de la competencia, prueba cada baja: precio, margen, puntos, puesto
// y si caería en baja anormal. Recomienda la menor baja que gana sin perder
// dinero ni caer en anormal, y enseña cómo aguanta el margen en tres
// escenarios (base, adverso, tensión).
import { Award, FileText, GitCompareArrows, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { C, font } from "../tema.js";
import { BAJA_ANORMAL, FORMULAS_PRECIO } from "./criterios.js";
import { F1, eur, pct } from "./formato.js";
import bajasReferencia from "./bajas-referencia.json";
import { OFERTA_DEFECTO, analizarOferta, competenciaDeReferencia, puntosEnJuego } from "./oferta.js";
import { PanelAlarmas } from "./alarmas-panel.jsx";
import { useDatosConcurso, useGuardadoDiferido } from "./usar-concurso.js";

function Grafica({ sim, elegida }) {
  const W = 1100, H = 250, m = { l: 44, r: 50, t: 14, b: 24 };
  const filas = sim.filas, maxB = filas[filas.length - 1].baja;
  const maxP = Math.max(1, ...filas.map(f => f.puntos));
  const x = b => m.l + (b / maxB) * (W - m.l - m.r);
  const y = v => m.t + (1 - v / maxP) * (H - m.t - m.b);
  // margen: de lo peor a lo mejor que se ve (entre −50 % y 100 %), redondeado a 20
  const lo = Math.max(-60, Math.floor(Math.min(0, ...filas.map(f => f.margen)) / 20) * 20), hi = Math.min(100, Math.ceil(Math.max(20, ...filas.map(f => f.margen)) / 20) * 20);
  const ym = v => m.t + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (H - m.t - m.b);
  const marcas = Array.from({ length: (hi - lo) / 20 + 1 }, (_, i) => lo + i * 20);
  const linea = (fy) => filas.map((f, i) => `${i ? "L" : "M"}${x(f.baja).toFixed(1)},${fy(f).toFixed(1)}`).join(" ");
  // zonas: perder dinero y baja anormal
  const zonas = [];
  let ini = null;
  filas.forEach((f, i) => { const mala = f.margen < 0 || f.anormal; if (mala && ini == null) ini = f.baja; if ((!mala || i === filas.length - 1) && ini != null) { zonas.push([ini, mala ? f.baja : filas[i - 1].baja]); ini = null; } });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img" aria-label="Puntos y margen según la baja">
      {zonas.map(([a, b], i) => <rect key={i} x={x(a)} y={m.t} width={Math.max(2, x(b) - x(a))} height={H - m.t - m.b} fill="rgba(240,82,82,0.08)" />)}
      {[0, 0.25, 0.5, 0.75, 1].map(t => <g key={t}><line x1={m.l} x2={W - m.r} y1={y(maxP * t)} y2={y(maxP * t)} stroke={C.border} /><text x={m.l - 6} y={y(maxP * t) + 4} fontSize="10" fill={C.dim} textAnchor="end">{Math.round(maxP * t)}</text></g>)}
      {marcas.map(v => <text key={v} x={W - m.r + 6} y={ym(v) + 4} fontSize="10" fill={C.amber}>{v} %</text>)}
      <line x1={m.l} x2={W - m.r} y1={ym(0)} y2={ym(0)} stroke={C.amber} strokeDasharray="3 3" opacity="0.5" />
      {filas.filter((_, i) => i % 10 === 0).map(f => <text key={f.baja} x={x(f.baja)} y={H - 6} fontSize="10" fill={C.dim} textAnchor="middle">{f.baja} %</text>)}
      <path d={linea(f => ym(f.margen))} fill="none" stroke={C.amber} strokeWidth="1.6" />
      <path d={linea(f => y(f.puntos))} fill="none" stroke={C.blue} strokeWidth="2.2" />
      {filas.map(f => f.puesto === 1 && !f.empate ? <circle key={f.baja} cx={x(f.baja)} cy={y(f.puntos)} r="2" fill={C.green} /> : null)}
      {elegida && <g><line x1={x(elegida.baja)} x2={x(elegida.baja)} y1={m.t} y2={H - m.b} stroke={C.green} strokeWidth="1.5" /><text x={x(elegida.baja) + 4} y={m.t + 10} fontSize="11" fill={C.green}>{elegida.baja} % · {eur(elegida.precio)}</text></g>}
    </svg>
  );
}

export function AlternativasConcurso({ concursoId, irA }) {
  const datos = useDatosConcurso(concursoId);
  const [oferta, cambiar] = useGuardadoDiferido(concursoId, "oferta", datos.oferta);
  const a = useMemo(() => (datos.listo ? analizarOferta({ ...datos, oferta }) : null), [datos, oferta]);

  const tarjeta = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14 };
  const titulo = t => <div style={{ fontSize: 14, fontWeight: 650, color: C.text, margin: "24px 0 10px" }}>{t}</div>;
  const th = { textAlign: "right", padding: "7px 10px", fontSize: 11, color: C.dim, fontWeight: 600, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  const td = { padding: "5px 10px", fontSize: 13, color: C.text, textAlign: "right", whiteSpace: "nowrap" };
  const num = (valor, onCambio, w = 70, ph) => <input className="op-input" type="number" step="0.5" value={valor ?? ""} placeholder={ph} onChange={e => onCambio(e.target.value === "" ? null : Number(e.target.value))} style={{ width: w, height: 30, textAlign: "right" }} />;

  const cabecera = (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
      <div style={{ width: 40, height: 40, borderRadius: 11, background: "rgba(91,124,250,0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: C.blue }}><GitCompareArrows size={19} /></div>
      <div>
        <div style={{ fontSize: 22, fontWeight: 650, color: C.text, letterSpacing: "-0.02em" }}>Alternativas</div>
        <div style={{ fontSize: 13, color: C.muted }}>{datos.concurso?.nombre || "…"} · qué baja presentar</div>
      </div>
    </div>
  );
  const pagina = hijos => <div style={{ flex: 1, overflow: "auto", background: C.bg, fontFamily: font, padding: "24px 28px 60px" }}>{cabecera}{hijos}</div>;
  if (!a) return pagina(<div style={{ color: C.muted, marginTop: 20 }}>Cargando…</div>);
  const falta = (t, d) => (
    <div style={{ ...tarjeta, padding: 20, marginTop: 18, maxWidth: 680 }}>
      <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>{t}</div>
      <div style={{ fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.55 }}>{d}</div>
      <button className="op-btn op-primario" style={{ marginTop: 12 }} onClick={() => irA?.("/documentos")}><FileText size={14} /> Ir a la Ficha de requisitos</button>
    </div>
  );
  if (!a.r.dimension.lineas.length && a.r.modo !== "estudio") return pagina(falta("Aún no hay servicios", "Las alternativas parten del coste del Cálculo, y este de los servicios de la Ficha de requisitos."));
  if (!a.adj) return pagina(falta("Faltan los criterios de adjudicación", "Para saber cuántos puntos da cada baja hacen falta los criterios: confírmalos en la Ficha de requisitos (los lee del anuncio o del pliego administrativo, o se ponen a mano)."));

  const { r, adj, o, competidores, presupuesto, sim, elegida, esc, mejoras, mejorasElegidas, alarmas, bloqueado } = a;
  const juego = puntosEnJuego(adj.criterios);
  // la competencia según adjudicaciones reales (por CPV y tamaño)
  const cpvs = datos.concurso?.cpvs?.length ? datos.concurso.cpvs : String(datos.ficha?.datos?.cpv?.valor || "").match(/\d{8}/g) || [];
  const referencia = competenciaDeReferencia(bajasReferencia, cpvs, datos.concurso?.presupuestoSinIva || (presupuesto ? presupuesto * r.anios : null));
  const ponerCompetidores = f => cambiar({ competidores: f(competidores) });

  return pagina(<>
    {/* ── Criterios ── */}
    <div style={{ ...tarjeta, padding: "12px 16px", marginTop: 18, display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
      <Award size={18} color={C.blue} />
      <div style={{ fontSize: 13, color: C.muted }}>Precio <b style={{ color: C.text }}>{juego.precio} puntos</b> · memoria y demás <b style={{ color: C.text }}>{juego.resto} puntos</b>{juego.mejoras ? <> · mejoras <b style={{ color: C.text }}>{juego.mejoras} puntos</b></> : null}</div>
      <div style={{ fontSize: 13, color: C.muted }}>Fórmula: <b style={{ color: C.text }}>{FORMULAS_PRECIO.find(f => f.id === adj.formula)?.nombre}{adj.formula === "saciedad" ? ` (umbral ${adj.saciedad ?? 15} %)` : ""}</b></div>
      <div style={{ fontSize: 13, color: C.muted }}>Baja anormal: <b style={{ color: C.text }}>{BAJA_ANORMAL.find(f => f.id === (adj.baja?.id || "art85"))?.nombre}{adj.baja?.id === "media" ? ` (+${adj.baja.valor ?? 10})` : ""}</b></div>
      <button className="op-btn op-fantasma" style={{ height: 28, marginLeft: "auto" }} onClick={() => irA?.("/documentos")}>Cambiar en la ficha</button>
    </div>

    {/* ── Lo que se espera ── */}
    {titulo("Lo que se espera")}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 12 }}>
      <div style={{ ...tarjeta, padding: "10px 14px" }}>
        <div style={{ fontSize: 12.5, fontWeight: 650, color: C.text, marginBottom: 6 }}>Nosotros</div>
        {[["tecnicaPct", `Lo que sacaremos de los ${juego.resto} puntos que no son precio`, "%", String(OFERTA_DEFECTO.tecnicaPct)],
          ["margenMinimoPct", "Margen mínimo que aceptamos", "%", String(OFERTA_DEFECTO.margenMinimoPct)]].map(([k, l, u, ph, w]) => (
          <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 12.5, color: C.muted }}>
            <span style={{ flex: 1 }}>{l}</span>{num(oferta?.[k] ?? null, v => cambiar({ [k]: v }), w || 70, ph)}<span style={{ width: 16, fontSize: 11.5, color: C.dim }}>{u}</span>
          </label>
        ))}
        <div style={{ fontSize: 11.5, color: C.dim, marginTop: 6, lineHeight: 1.5 }}>Del Cálculo: presupuesto del primer año <b style={{ color: C.text }}>{presupuesto ? eur(presupuesto) : "sin confirmar"}</b> sin IVA; el contrato cuesta <b style={{ color: C.text }}>{eur(r.cuenta.totalContrato)}</b> en {F1.format(r.anios)} años, que en precio del primer año son <b style={{ color: C.text }}>{eur(r.costeEquivalente)}</b>{a.mejorasAnio ? <> (con <b style={{ color: C.text }}>{eur(a.mejorasAnio)}</b> al año de mejoras)</> : null}.</div>
      </div>
      <div style={{ ...tarjeta, padding: "10px 14px" }}>
        <div style={{ fontSize: 12.5, fontWeight: 650, color: C.text, marginBottom: 6 }}>Competencia</div>
        <div style={{ display: "flex", gap: 8, fontSize: 11, color: C.dim, padding: "0 0 2px" }}><span style={{ flex: 1 }}>Empresa</span><span style={{ width: 70, textAlign: "right" }}>Baja %</span><span style={{ width: 70, textAlign: "right" }}>Técnica %</span><span style={{ width: 30 }} /></div>
        {competidores.map((c, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "2px 0" }}>
            <input className="op-input" value={c.nombre} onChange={e => ponerCompetidores(cs => cs.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} style={{ flex: 1, height: 30 }} aria-label="Empresa" />
            {num(c.baja, v => ponerCompetidores(cs => cs.map((x, j) => (j === i ? { ...x, baja: v ?? 0 } : x))))}
            {num(c.tecnicaPct, v => ponerCompetidores(cs => cs.map((x, j) => (j === i ? { ...x, tecnicaPct: v ?? 0 } : x))))}
            <button className="op-btn op-fantasma op-icono" title="Quitar" onClick={() => ponerCompetidores(cs => cs.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
          </div>
        ))}
        <button className="op-btn op-fantasma" style={{ height: 28, marginTop: 4 }} onClick={() => ponerCompetidores(cs => [...cs, { nombre: `Competidor ${String.fromCharCode(65 + cs.length)}`, baja: 10, tecnicaPct: 70 }])}><Plus size={14} /> Añadir empresa</button>
        <div style={{ fontSize: 11.5, color: C.dim, marginTop: 4 }}>Las bajas de concursos parecidos (adjudicaciones en la Plataforma) son la mejor pista. Técnica: el % de los {juego.resto} puntos de memoria que creemos que sacará.{juego.mejoras ? ` Se supone que ofrece todas las mejoras (${juego.mejoras} puntos).` : ""}</div>
        {referencia && (
          <div style={{ marginTop: 8, background: C.surface2, borderRadius: 10, padding: "8px 12px", fontSize: 12, color: C.muted, lineHeight: 1.55 }}>
            <b style={{ color: C.text }}>Según adjudicaciones reales</b> de «{referencia.nombre}»{referencia.tramo === "mas1M" ? ", contratos de más de 1 M€" : referencia.tramo === "mas200k" ? ", contratos de más de 200.000 €" : ""} ({referencia.n} entre el {new Date(`${referencia.periodo.desde}T12:00:00`).toLocaleDateString("es-ES")} y el {new Date(`${referencia.periodo.hasta}T12:00:00`).toLocaleDateString("es-ES")}): mediana de <b style={{ color: C.text }}>{F1.format(referencia.ofertas.mediana)}</b> ofertas; la ganadora bajó <b style={{ color: C.text }}>{F1.format(referencia.baja.mediana)} %</b> (la mitad, entre {F1.format(referencia.baja.p25)} % y {F1.format(referencia.baja.p75)} %).
            <button className="op-btn" style={{ height: 26, fontSize: 12, marginLeft: 8 }} onClick={() => cambiar({ competidores: referencia.competidores })}>Usar como competencia</button>
          </div>
        )}
      </div>
    </div>

    {mejoras.length > 0 && <>
      {titulo("Mejoras: cuánto cuestan y cuántos puntos dan")}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 12 }}>
        {mejoras.map(m => {
          const elegida = mejorasElegidas.find(x => x.nombre === m.nombre);
          const cfg = oferta?.mejoras?.[m.nombre] || {};
          const todos = (adj.criterios.find(c => c.nombre === m.nombre)?.escalones || []);
          const niveles = [{ unidades: 0, puntos: 0 }, ...todos.filter(e => e.puntos > 0).map(e => ({ unidades: e.desde, puntos: e.puntos }))];
          const ponerMejora = cambio => cambiar({ mejoras: { [m.nombre]: { ...cfg, ...cambio } } });
          return (
            <div key={m.nombre} style={{ ...tarjeta, padding: "10px 14px" }}>
              <div style={{ fontSize: 12.5, fontWeight: 650, color: C.text, marginBottom: 6 }}>{m.nombre}</div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.muted, marginBottom: 6 }}>
                <span style={{ flex: 1 }}>Lo que cuesta cada una ({m.unidad}), al año</span>{num(cfg.costeUnidad ?? null, v => ponerMejora({ costeUnidad: v }), 90, String(m.costeUnidad))}<span style={{ fontSize: 11.5, color: C.dim }}>€</span>
              </label>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr>{["Ofrecer", "Puntos", "Coste al año", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {niveles.map(n => {
                    const es = elegida && elegida.unidades === n.unidades;
                    return (
                      <tr key={n.unidades} style={{ borderTop: `1px solid ${C.border}`, background: es ? "rgba(63,207,142,0.08)" : "transparent" }}>
                        <td style={td}>{n.unidades ? `${n.unidades} ${m.unidad}` : "nada"}</td>
                        <td style={td}>{n.puntos}</td>
                        <td style={td}>{eur(n.unidades * m.costeUnidad)}</td>
                        <td style={td}>{es ? <span style={{ fontSize: 12, color: C.green }}>{m.fijado ? "fijada" : "la mejor"}</span> : <button className="op-btn op-fantasma" style={{ height: 24, fontSize: 12 }} onClick={() => ponerMejora({ unidades: n.unidades })}>Fijar</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {m.fijado && <button className="op-btn op-fantasma" style={{ height: 24, fontSize: 12, marginTop: 4 }} onClick={() => ponerMejora({ unidades: null })}>Que la elija Operanzia</button>}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11.5, color: C.dim, marginTop: 6 }}>Operanzia prueba todas las combinaciones ({a.combinaciones}) con su coste y se queda con la que gana con más margen.</div>
    </>}

    <PanelAlarmas alarmas={alarmas} irA={irA} titulo={bloqueado ? "Sin recomendación hasta resolver esto" : undefined} />

    {!sim ? <div style={{ fontSize: 13, color: C.amber, marginTop: 14 }}>Falta el presupuesto: confírmalo en la Ficha de requisitos o escríbelo en Cálculo.</div> : bloqueado ? null : <>
      {/* ── Recomendación ── */}
      {titulo("Qué baja presentar")}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        {[[`Baja ${elegida === sim.recomendada ? "recomendada" : "elegida"}`, elegida ? pct(elegida.baja) : "—", elegida ? (elegida.puesto === 1 && !elegida.empate ? "ganaría" : `quedaría ${elegida.puesto}.º${elegida.empate ? " (empate)" : ""}`) : "ninguna cumple", elegida?.puesto === 1 && !elegida.empate ? C.green : C.amber],
          ["Precio al año", elegida ? eur(elegida.precio) : "—", elegida ? `${eur(elegida.precio * r.anios)} el contrato` : ""],
          ["Margen", elegida ? pct(elegida.margen) : "—", elegida ? `${eur(elegida.precio - r.cuenta.costeMedioAnual)} al año` : "", elegida && elegida.margen < 0 ? C.red : null],
          ["Puntos", elegida ? F1.format(elegida.puntos) : "—", elegida ? `${F1.format(elegida.puntosPrecio)} de precio de ${juego.precio}` : ""],
          ["Baja máxima sin perder dinero", sim.maxima ? `${sim.maxima === sim.filas[sim.filas.length - 1] ? "más de " : ""}${pct(sim.maxima.baja)}` : "—", sim.maxima ? eur(sim.maxima.precio) : "con este coste no hay margen", sim.maxima ? null : C.red]].map(([l, v, sub, col]) => (
          <div key={l} className="op-tarjeta" style={{ padding: "12px 16px" }}>
            <div style={{ fontSize: 12, color: C.muted }}>{l}</div>
            <div style={{ fontSize: 20, fontWeight: 650, color: C.text, marginTop: 3 }}>{v}</div>
            <div style={{ fontSize: 11.5, color: col || C.dim, marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8, lineHeight: 1.55 }}>
        {sim.recomendada && sim.recomendada.puesto === 1 && !sim.recomendada.empate
          ? <>La menor baja que gana sin caer en baja anormal y dejando al menos un {F1.format(o.margenMinimoPct)} % de margen es <b style={{ color: C.text }}>{pct(sim.recomendada.baja)}</b>.</>
          : <span style={{ color: C.amber }}><TriangleAlert size={13} style={{ verticalAlign: "-2px" }} /> Con lo que se espera de la competencia no se gana sin bajar del margen mínimo o caer en anormal. Mejora la parte técnica, baja el coste en Cálculo o revisa lo que se espera.</span>}
        {o.bajaElegida != null && <button className="op-btn op-fantasma" style={{ height: 26, marginLeft: 8 }} onClick={() => cambiar({ bajaElegida: null })}>Volver a la recomendada</button>}
      </div>

      <div style={{ ...tarjeta, padding: "12px 14px", marginTop: 12 }}>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}><span style={{ color: C.blue }}>━</span> nuestros puntos · <span style={{ color: C.amber }}>━</span> margen · <span style={{ color: C.green }}>●</span> ganaríamos · <span style={{ background: "rgba(240,82,82,0.15)", padding: "0 6px" }}>zona</span> se pierde dinero o baja anormal</div>
        <Grafica sim={sim} elegida={elegida} />
        <div style={{ fontSize: 11.5, color: C.dim, marginTop: 2 }}>Abajo, la baja sobre {eur(presupuesto)} al año.</div>
      </div>

      {titulo("Cada baja")}
      <div style={{ ...tarjeta, overflow: "auto", maxHeight: 360 }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead style={{ position: "sticky", top: 0, background: C.card }}><tr>{["Baja", "Precio al año", "Margen", "Puntos precio", "Puntos", "Puesto", "", ""].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {sim.filas.filter(f => f.baja % 1 === 0 || f === elegida || f === sim.recomendada).map(f => (
              <tr key={f.baja} style={{ borderTop: `1px solid ${C.border}`, background: f === elegida ? "rgba(63,207,142,0.08)" : "transparent" }}>
                <td style={{ ...td, fontWeight: 600 }}>{pct(f.baja)}</td>
                <td style={td}>{eur(f.precio)}</td>
                <td style={{ ...td, color: f.margen < 0 ? C.red : f.margen < o.margenMinimoPct ? C.amber : C.text }}>{pct(f.margen)}</td>
                <td style={td}>{F1.format(f.puntosPrecio)}</td>
                <td style={td}>{F1.format(f.puntos)}</td>
                <td style={{ ...td, color: f.puesto === 1 && !f.empate ? C.green : C.text }}>{f.puesto}.º{f.empate ? " =" : ""}</td>
                <td style={{ ...td, textAlign: "left", color: C.red, fontSize: 12 }}>{f.anormal ? "baja anormal" : f.margen < 0 ? "pierde dinero" : ""}</td>
                <td style={td}>{f === elegida ? <span style={{ fontSize: 12, color: C.green }}>elegida</span> : <button className="op-btn op-fantasma" style={{ height: 24, fontSize: 12 }} onClick={() => cambiar({ bajaElegida: f.baja })}>Elegir</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {esc && <>
        {titulo(`Escenarios con ${pct(elegida.baja)} de baja (${eur(elegida.precio)} al año)`)}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
          {esc.map(e => (
            <div key={e.id} className="op-tarjeta" style={{ padding: "12px 16px", borderColor: e.resultado < 0 ? "rgba(240,82,82,0.5)" : undefined }}>
              <div style={{ fontSize: 13, fontWeight: 650, color: C.text }}>{e.nombre}</div>
              <div style={{ fontSize: 11.5, color: C.dim, marginTop: 2, minHeight: 30 }}>{e.que}</div>
              <div style={{ fontSize: 20, fontWeight: 650, color: e.resultado < 0 ? C.red : C.green, marginTop: 6 }}>{eur(e.resultado)}<span style={{ fontSize: 12, fontWeight: 500, color: C.muted }}> al año</span></div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>margen {pct(e.margen)} · coste {eur(e.coste)}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{F1.format(e.personas)} personas · {e.vehiculos} vehículo{e.vehiculos === 1 ? "" : "s"} · caja {eur(e.caja)}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: C.dim, marginTop: 6 }}>Caja: lo que hay que adelantar (sueldos, combustible, cuotas) mientras se espera a cobrar las facturas.</div>
      </>}
    </>}
  </>);
}
