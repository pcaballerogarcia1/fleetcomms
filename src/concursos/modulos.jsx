// Concursos → Resumen: la foto final de la oferta y lo que falta comprobar.
// Junta la ficha del concurso, el coste del Cálculo y la baja de Alternativas
// (la elegida o la recomendada), con una lista de comprobaciones: cada una
// dice si está bien y a qué módulo ir para arreglarla.
import { CircleAlert, CircleCheck, ClipboardList } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { C, font } from "../tema.js";
import { F1, eur, pct } from "./formato.js";
import { analizarOferta, puntosEnJuego } from "./oferta.js";
import { ESTADOS, TIPOS_CONCURSO, escucharDocumentos } from "./store.js";
import { useDatosConcurso } from "./usar-concurso.js";

export function ResumenConcurso({ concursoId, irA }) {
  const datos = useDatosConcurso(concursoId);
  const [docs, setDocs] = useState([]);
  useEffect(() => (concursoId ? escucharDocumentos(concursoId, setDocs) : undefined), [concursoId]);
  const a = useMemo(() => (datos.listo ? analizarOferta(datos) : null), [datos]);
  const c = datos.concurso;
  const est = ESTADOS.find(e => e.id === c?.estado);

  const tarjeta = (l, v, sub, color) => (
    <div key={l} className="op-tarjeta" style={{ padding: "12px 16px" }}>
      <div style={{ fontSize: 12, color: C.muted }}>{l}</div>
      <div style={{ fontSize: 16, fontWeight: 650, color: color || C.text, marginTop: 3 }}>{v}</div>
      {sub ? <div style={{ fontSize: 11.5, color: C.dim, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
  const titulo = t => <div style={{ fontSize: 14, fontWeight: 650, color: C.text, margin: "24px 0 10px" }}>{t}</div>;
  const rejilla = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 };

  // ── comprobaciones: [bien, texto, módulo, solo aviso] ──
  const comprobaciones = [];
  if (a && c) {
    const propuestos = new Set(docs.flatMap(d => (d.lectura?.datos || []).map(x => x.id).filter(id => !/^(horario|lote|frecuencia)/.test(id))));
    const revisados = Object.keys(datos.ficha?.datos || {});
    const pendientes = [...propuestos].filter(k => !revisados.includes(k)).length;
    const servicios = Object.values(datos.ficha?.servicios || {});
    const noCuadran = servicios.filter(s => s.cuadra === false).length;
    const juego = a.adj ? puntosEnJuego(a.adj.criterios) : null;
    const e = a.elegida, adverso = a.esc?.find(x => x.id === "adverso"), tension = a.esc?.find(x => x.id === "tension");
    const pl = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
    comprobaciones.push(
      [!!docs.length, docs.length ? `${pl(docs.length, "documento subido", "documentos subidos")}` : "No hay pliegos subidos", "/documentos"],
      [!pendientes, pendientes ? `Quedan ${pl(pendientes, "dato", "datos")} del pliego por revisar en la ficha` : "Datos de la ficha revisados", "/documentos"],
      [servicios.length > 0 && !noCuadran, !servicios.length ? "No hay servicios en la ficha" : noCuadran ? `${pl(noCuadran, "servicio no cuadra", "servicios no cuadran")} con las unidades y la frecuencia del pliego` : `${pl(servicios.length, "servicio", "servicios")} en la ficha`, "/documentos"],
      [!!juego && juego.total === 100 && juego.precio > 0, !juego ? "Faltan los criterios de adjudicación" : juego.total !== 100 ? `Los criterios suman ${juego.total} puntos, no 100` : `Criterios: ${juego.precio} puntos de precio y ${juego.resto} del resto`, "/documentos"],
      [!!a.presupuesto, a.presupuesto ? `Presupuesto: ${eur(a.presupuesto)} al año sin IVA` : "Falta el presupuesto", "/calculo"],
      [!!e && e.margen >= a.o.margenMinimoPct, !e ? "No hay baja elegida" : `Margen con la baja elegida: ${pct(e.margen)} (mínimo ${pct(a.o.margenMinimoPct)})`, "/alternativas"],
      [!!e && !e.anormal, !e ? "Sin baja, no se sabe si sería anormal" : e.anormal ? "La baja elegida sería anormalmente baja: habría que justificarla" : "La baja elegida no es anormal con lo que se espera de la competencia", "/alternativas"],
      [!!e && e.puesto === 1 && !e.empate, !e ? "Sin baja elegida" : e.puesto === 1 && !e.empate ? "Con lo que se espera de la competencia, ganaría" : `Con lo que se espera de la competencia, quedaría ${e.puesto}.º`, "/alternativas"],
      [!!adverso && adverso.resultado >= 0, !adverso ? "Sin escenarios" : adverso.resultado >= 0 ? `Aguanta el escenario adverso (${eur(adverso.resultado)} al año)` : `En el escenario adverso pierde ${eur(-adverso.resultado)} al año`, "/alternativas"],
      [!!tension && tension.resultado >= 0, !tension ? "Sin escenarios" : tension.resultado >= 0 ? `Aguanta también el de tensión (${eur(tension.resultado)} al año)` : `En el escenario de tensión pierde ${eur(-tension.resultado)} al año: ¿se puede asumir?`, "/alternativas", true],
    );
  }
  const malas = comprobaciones.filter(([ok, , , aviso]) => !ok && !aviso).length;

  return (
    <div style={{ flex: 1, overflow: "auto", background: C.bg, fontFamily: font, padding: "24px 28px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: "rgba(91,124,250,0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: C.blue }}><ClipboardList size={19} /></div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 650, color: C.text, letterSpacing: "-0.02em" }}>Resumen</div>
          <div style={{ fontSize: 13, color: C.muted }}>{c?.nombre || "…"}</div>
        </div>
      </div>

      {c && <div style={{ ...rejilla, marginTop: 18 }}>
        {[["Organismo", c.organismo || "—"], ["Servicio", TIPOS_CONCURSO.find(t => t.id === c.tipo)?.nombre || "—"], ["Expediente", c.expediente || "—"],
          ["Duración", c.duracionMeses && c.duracionMeses % 12 ? `${c.duracionMeses} meses` : c.duracionAnios ? `${c.duracionAnios} año${c.duracionAnios === 1 ? "" : "s"}` : "—"],
          ["Presupuesto sin IVA", c.presupuestoSinIva != null ? eur(c.presupuestoSinIva) : "—"], ["Valor estimado", c.valorEstimado != null ? eur(c.valorEstimado) : "—"],
          ["Presentar antes del", c.fechaLimite ? new Date(`${c.fechaLimite}T12:00:00`).toLocaleDateString("es-ES") : "—"], ["Estado", est?.nombre || "—", null, est?.color]].map(([l, v, s, col]) => tarjeta(l, v, s, col))}
      </div>}

      {a && a.r.dimension.lineas.length > 0 && <>
        {titulo("La oferta")}
        <div style={rejilla}>
          {tarjeta("Coste al año", eur(a.r.cuenta.costeMedioAnual), `${eur(a.r.cuenta.totalContrato)} el contrato`)}
          {a.elegida ? <>
            {tarjeta("Precio al año (sin IVA)", eur(a.elegida.precio), `baja del ${pct(a.elegida.baja)}`)}
            {tarjeta("Precio del contrato", eur(a.elegida.precio * a.r.anios), `${F1.format(a.r.anios)} año${a.r.anios === 1 ? "" : "s"}, sin IVA`)}
            {tarjeta("Margen", pct(a.elegida.margen), `${eur((a.elegida.precio - a.r.cuenta.costeMedioAnual) * a.r.anios)} en el contrato`, a.elegida.margen < 0 ? C.red : null)}
            {tarjeta("Puntos esperados", F1.format(a.elegida.puntos), a.elegida.puesto === 1 && !a.elegida.empate ? "ganaría" : `quedaría ${a.elegida.puesto}.º`, a.elegida.puesto === 1 && !a.elegida.empate ? C.green : C.amber)}
          </> : tarjeta("Precio", "—", a.adj ? "falta el presupuesto" : "faltan los criterios de adjudicación")}
          {tarjeta("Plantilla", F1.format(a.r.cuenta.plantilla.total), "personas a jornada completa")}
          {tarjeta("Vehículos", String(a.r.cuenta.vehiculos.reduce((s, v) => s + v.total, 0)), a.r.cuenta.vehiculos.map(v => `${v.total} ${v.tipo}`).join(" · "))}
        </div>
      </>}

      {comprobaciones.length > 0 && <>
        {titulo(<>Comprobaciones <span style={{ fontSize: 12.5, fontWeight: 500, color: malas ? C.amber : C.green, marginLeft: 6 }}>{malas ? `${malas} por resolver` : "todo en orden"}</span></>)}
        <div className="op-tarjeta" style={{ padding: 0, overflow: "hidden", maxWidth: 860 }}>
          {comprobaciones.map(([ok, texto, ruta, aviso], i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderTop: i ? `1px solid ${C.border}` : "none" }}>
              {ok ? <CircleCheck size={16} color={C.green} /> : <CircleAlert size={16} color={aviso ? C.amber : C.red} />}
              <div style={{ flex: 1, fontSize: 13, color: C.text }}>{texto}</div>
              {!ok && <button className="op-btn op-fantasma" style={{ height: 26, fontSize: 12 }} onClick={() => irA?.(ruta)}>Ir</button>}
            </div>
          ))}
        </div>
      </>}
    </div>
  );
}
