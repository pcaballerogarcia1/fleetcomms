// Concursos → Cálculo: la cuenta de explotación del contrato.
// Lee el dimensionamiento del Planning (servicios de la ficha, rendimientos,
// vehículos y personas) y le pone coste: plantilla, vehículos, operación,
// estructura, gastos generales y contingencias, cada año del contrato. De ahí
// salen el precio de equilibrio y el precio objetivo (con el margen que se
// quiere), comparados con el presupuesto del pliego. Todo se cambia aquí y se
// guarda solo; Alternativas y Resumen leen lo mismo.
import { Calculator, FileText } from "lucide-react";
import { useMemo } from "react";
import { C, font } from "../tema.js";
import { alarmasConcurso } from "./alarmas.js";
import { PanelAlarmas } from "./alarmas-panel.jsx";
import { PARAMETROS_CALCULO, calcularConcurso, costeOrientativo } from "./calculo.js";
import { PlantillaSubrogar } from "./plantilla-panel.jsx";
import { AvisoLeido } from "./confirmar-panel.jsx";
import { F0, F1, F2, eur, pct } from "./formato.js";
import { useDatosConcurso, useGuardadoDiferido } from "./usar-concurso.js";

const GRUPOS_PARAM = [
  ["Personal", [["salarioOperario", "Salario bruto de una persona de servicio", "€/año"], ["ssPct", "Seguridad Social de la empresa", "%"], ["personasPorEncargado", "Un encargado por cada", "personas"], ["salarioEncargado", "Salario bruto de un encargado", "€/año"], ["jefeDedicacion", "Jefe de servicio dedicado a este contrato", "jornadas"], ["salarioJefe", "Salario bruto del jefe de servicio", "€/año"], ["uniformesPersona", "Uniformes y EPIs por persona", "€/año"], ["subidaSalarialPct", "Subida salarial cada año", "%"]]],
  ["Vehículos", [["reservaPct", "Vehículos de reserva", "%"], ["aniosAmortizacion", "Amortizar en (vacío = años del contrato)", "años"], ["residualPct", "Valor que les queda al final", "%"], ["interesPct", "Interés de la financiación", "%"]]],
  ["Estructura y riesgo", [["instalacionesAnio", "Instalaciones (nave, vestuarios…)", "€/año"], ["sistemasAnio", "Sistemas (GPS, software…)", "€/año"], ["seguroRCAnio", "Seguros del contrato", "€/año"], ["ipcPct", "IPC cada año (lo que no es personal)", "%"], ["gastosGeneralesPct", "Gastos generales", "%"], ["contingenciasPct", "Contingencias", "%"]]],
  ["Precio", [["margenPct", "Margen que se quiere sobre lo que se cobra", "%"], ["diasCobro", "Días que se tarda en cobrar", "días"]]],
];
const CAMPOS_VEHICULO = [["precio", "Precio de compra", "€"], ["combustibleTurno", "Combustible", "€/turno"], ["combustibleKm", "Combustible (si hay km)", "€/km"], ["consumiblesTurno", "Consumibles", "€/turno"], ["mantenimientoAnio", "Mantenimiento", "€/año"], ["seguroAnio", "Seguro e impuestos", "€/año"]];

export function CalculoConcurso({ concursoId, irA }) {
  const datos = useDatosConcurso(concursoId);
  const [calc, cambiar] = useGuardadoDiferido(concursoId, "calculo", datos.calc);
  const r = useMemo(() => (datos.listo ? calcularConcurso({ ficha: datos.ficha, dim: datos.dim, calc, concurso: datos.concurso }) : null), [datos.listo, datos.ficha, datos.dim, datos.concurso, calc]);

  const tarjeta = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 };
  const th = { textAlign: "right", padding: "8px 10px", fontSize: 11, color: C.dim, fontWeight: 600, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  const td = { padding: "6px 10px", fontSize: 13, color: C.text, textAlign: "right", whiteSpace: "nowrap" };
  const titulo = t => <div style={{ fontSize: 15, fontWeight: 650, color: C.text, margin: "24px 0 10px" }}>{t}</div>;
  const numInput = (valor, onCambio, w = 90, ph) => <input className="op-input" type="number" value={valor ?? ""} placeholder={ph} onChange={e => onCambio(e.target.value === "" ? null : Number(e.target.value))} style={{ width: w, height: 30, textAlign: "right" }} />;

  const cabeceraTitulo = (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(91,124,250,0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: C.blue }}><Calculator size={19} /></div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 650, color: C.text, letterSpacing: "-0.02em" }}>Cálculo</div>
        <div style={{ fontSize: 13, color: C.muted }}>{datos.concurso?.nombre || "…"} · cuenta de explotación del contrato, sin IVA</div>
      </div>
    </div>
  );
  const cabecera = <>{cabeceraTitulo}<AvisoLeido concursoId={concursoId} docs={datos.docs} ficha={datos.ficha} irA={irA} /></>;
  if (!r) return <div style={{ flex: 1, overflow: "auto", background: C.bg, fontFamily: font, padding: "24px 28px" }}>{cabecera}<div style={{ color: C.muted, marginTop: 20 }}>Cargando…</div></div>;
  if (!r.dimension.lineas.length && r.modo !== "estudio") {
    return (
      <div style={{ flex: 1, overflow: "auto", background: C.bg, fontFamily: font, padding: "24px 28px" }}>
        {cabecera}
        <div style={{ ...tarjeta, padding: 20, marginTop: 18, maxWidth: 680 }}>
          <div style={{ fontSize: 15, color: C.text, fontWeight: 600 }}>Aún no hay nada que calcular</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.55 }}>El cálculo parte del <b style={{ color: C.text }}>estudio de costes del Ayuntamiento</b> (si el pliego lo trae: úsalo desde la Ficha de requisitos) o de los servicios de la ficha con lo que rinde cada equipo en Planificación.</div>
          <button className="op-btn op-primario" style={{ marginTop: 12 }} onClick={() => irA?.("/documentos")}><FileText size={14} /> Ir a Documentos</button>
        </div>
      </div>
    );
  }

  const { cuenta: c, presupuestoAnual, anios } = r;
  const p = c.parametros;
  const alarmas = alarmasConcurso({ r, ficha: datos.ficha, concurso: datos.concurso, calc, adj: datos.ficha?.adjudicacion }).filter(x => x.ruta !== "/documentos" || /duración|presupuesto|valor estimado|servicio/i.test(x.texto));
  const vehiculosTotal = c.vehiculos.reduce((s, v) => s + (v.total || 0), 0);
  const bajaObjetivo = presupuestoAnual ? (1 - c.precios.objetivo / presupuestoAnual) * 100 : null;
  const cabe = presupuestoAnual ? c.precios.objetivo <= presupuestoAnual : null;
  // lo que se cobra cada año con el precio objetivo: el presupuesto de ese año con la misma baja
  const ingresosAnio = c.porAnio.map((a, k) => (presupuestoAnual ? (c.ingresosBase[k] ?? presupuestoAnual) * (c.precios.objetivo / presupuestoAnual) : c.precios.objetivo) * a.parte);
  const ingresosTotal = ingresosAnio.reduce((s, v) => s + v, 0);
  const kpis = [
    ["Coste del contrato", eur(c.totalContrato), `${F1.format(anios)} año${anios === 1 ? "" : "s"} · ${eur(c.costeMedioAnual)} de media al año`],
    [`Precio objetivo del primer año (${F1.format(p.margenPct)} % de margen)`, eur(c.precios.objetivo), `equilibrio ${eur(c.precios.equilibrio)}${c.ingresosBase.length > 1 && c.ingresosBase[1] !== c.ingresosBase[0] ? " · sube cada año como el pliego" : ""}`],
    ["Presupuesto del primer año", presupuestoAnual ? eur(presupuestoAnual) : "—", presupuestoAnual ? `sin IVA · ${r.fuentePresupuesto.fuente}` : "confírmalo en la ficha", r.fuentePresupuesto?.dudoso ? C.amber : null],
    ["Baja con el precio objetivo", bajaObjetivo != null ? pct(bajaObjetivo) : "—", cabe == null ? "" : cabe ? "cabe en el presupuesto" : "no cabe: pasa del presupuesto", cabe === false ? C.red : cabe ? C.green : null],
    ["Plantilla", F1.format(c.plantilla.total), r.modo === "estudio" ? (calc.usarPlantilla && calc.plantilla ? `la plantilla a subrogar (${calc.plantilla.personas} personas)` : "personas a jornada completa del estudio") : c.aDemanda ? "a demanda: solo las horas que se usan" : `${F1.format(c.plantilla.servicio)} de servicio · ${c.plantilla.encargados} encargado${c.plantilla.encargados === 1 ? "" : "s"} · jefe ${F1.format(c.plantilla.jefe)}`],
    ...(r.modo === "rendimientos" ? [["Vehículos", F1.format(vehiculosTotal), c.aDemanda ? "la parte del año que se usan" : `${vehiculosTotal - c.vehiculos.reduce((s, v) => s + v.reserva, 0)} trabajando + ${c.vehiculos.reduce((s, v) => s + v.reserva, 0)} de reserva`]] : []),
    ["Caja que hay que adelantar", eur(c.caja), `${p.diasCobro} días de gastos hasta cobrar`],
  ];
  const filasCuenta = c.partidas.filter(([k]) => c.porAnio.some(a => a[k])).map(([k, n]) => ({ k, n, anios: c.porAnio.map(a => a[k] || 0), total: c.porAnio.reduce((s, a) => s + (a[k] || 0), 0) }));

  return (
    <div style={{ flex: 1, overflow: "auto", background: C.bg, fontFamily: font, padding: "24px 28px 60px" }}>
      {cabecera}

      {r.estudio && (
        <div className="op-segmentado" style={{ display: "inline-flex", gap: 4, marginTop: 14, padding: 3, background: C.surface2, borderRadius: 12 }}>
          {[["estudio", "Desde el estudio del Ayuntamiento"], ["rendimientos", "Por rendimientos (Planificación)"]].map(([m, n]) => (
            <button key={m} className={`op-btn ${r.modo === m ? "op-primario" : "op-fantasma"}`} style={{ height: 30 }} onClick={() => cambiar({ base: m })}>{n}</button>
          ))}
        </div>
      )}

      <PanelAlarmas alarmas={alarmas} irA={irA} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginTop: 18 }}>
        {kpis.map(([l, v, sub, color]) => (
          <div key={l} className="op-tarjeta" style={{ padding: "12px 16px" }}>
            <div style={{ fontSize: 12, color: C.muted }}>{l}</div>
            <div style={{ fontSize: 20, fontWeight: 650, color: C.text, marginTop: 3, letterSpacing: "-0.01em" }}>{v}</div>
            <div style={{ fontSize: 12, color: typeof color === "string" ? color : C.dim, marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 13, color: C.muted, marginTop: 8 }}>Presupuesto del primer año, sin IVA, escrito a mano (si el de arriba no es el bueno): {numInput(calc.presupuestoAnual, v => cambiar({ presupuestoAnual: v }), 130, "€")}</div>

      {r.modo === "estudio" && <>
        {titulo("Partidas: las del Ayuntamiento y las tuyas")}
        <div style={{ ...tarjeta, overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr><th style={{ ...th, textAlign: "left" }}>Partida</th><th style={th}>Ayuntamiento (año 1)</th><th style={th}>Ajuste %</th><th style={th}>O tu importe</th><th style={th}>Tuyo (año 1)</th><th style={{ ...th, textAlign: "left" }}>Detalle</th></tr></thead>
            <tbody>
              {r.estudio.partidas.map(pa => {
                const aj = calc.ajustes?.[pa.id] || {};
                const tuyo = c.anio1[pa.id] ?? 0;
                return (
                  <tr key={pa.id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ ...td, textAlign: "left" }}>{pa.nombre}{pa.id === "personal" && calc.usarPlantilla && calc.plantilla ? <div style={{ fontSize: 11, color: C.green }}>con la plantilla a subrogar</div> : null}</td>
                    <td style={td}>{eur(pa.total)}</td>
                    <td style={td}>{numInput(aj.pct ?? null, x => cambiar({ ajustes: { [pa.id]: { pct: x } } }), 70, "0")}</td>
                    <td style={td}>{numInput(aj.importe ?? null, x => cambiar({ ajustes: { [pa.id]: { importe: x } } }), 110, "—")}</td>
                    <td style={{ ...td, fontWeight: 600, color: Math.abs(tuyo - pa.total) > 1 ? C.amber : C.text }}>{eur(tuyo)}</td>
                    <td style={{ ...td, textAlign: "left" }}>{pa.lineas?.length ? <details><summary style={{ cursor: "pointer", fontSize: 12, color: C.muted }}>{pa.lineas.length} líneas</summary><div style={{ fontSize: 12, color: C.muted, whiteSpace: "normal", maxWidth: 520, lineHeight: 1.5, marginTop: 4 }}>{pa.lineas.map((l, i) => <div key={i}>{F1.format(l.uds)} × {l.concepto}: <b style={{ color: C.text }}>{eur(l.total)}</b></div>)}</div></details> : null}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ ...td, textAlign: "left", color: C.muted }}>Sus gastos generales y beneficio ({F1.format(r.estudio.ggbiPct)} %) / tus gastos generales ({F1.format(p.gastosGeneralesPct)} %) y contingencias ({F1.format(p.contingenciasPct)} %)</td>
                <td style={td}>{eur(r.estudio.ggbi)}</td><td /><td />
                <td style={td}>{eur((c.anio1.gastosGenerales || 0) + (c.anio1.contingencias || 0))}</td><td />
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 6, lineHeight: 1.5 }}>Cada ajuste tiene que tener su porqué (mejor ruta, otra flota, otra plantilla…). Si tu coste baja mucho del suyo, la oferta puede quedar como anormalmente baja y habrá que justificarla.</div>
        <PlantillaSubrogar calc={calc} cambiar={cambiar} personalEstudio={r.estudio.partidas.find(x => x.id === "personal")?.total} tarjeta={tarjeta} titulo={titulo} />
      </>}

      {titulo("Cuenta de explotación")}
      <div style={{ ...tarjeta, overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>
            <th style={{ ...th, textAlign: "left" }}>Partida</th>
            {c.porAnio.map(a => <th key={a.anio} style={th}>Año {a.anio}{a.parte < 1 ? ` (${F1.format(a.parte * 12)} meses)` : ""}</th>)}
            <th style={th}>Contrato</th><th style={th}>% del coste</th>
          </tr></thead>
          <tbody>
            <tr style={{ background: "rgba(63,207,142,0.06)" }}>
              <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>Ingresos con el precio objetivo</td>
              {ingresosAnio.map((v, k) => <td key={k} style={{ ...td, fontWeight: 600 }}>{eur(v)}</td>)}
              <td style={{ ...td, fontWeight: 600 }}>{eur(ingresosTotal)}</td><td style={td} />
            </tr>
            {filasCuenta.map(f => (
              <tr key={f.k} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ ...td, textAlign: "left", color: C.muted }}>− {f.n}</td>
                {f.anios.map((v, i) => <td key={i} style={td}>{eur(v)}</td>)}
                <td style={td}>{eur(f.total)}</td><td style={{ ...td, color: C.dim }}>{pct(f.total / c.totalContrato * 100)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: `1px solid ${C.border}` }}>
              <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>Coste total</td>
              {c.porAnio.map(a => <td key={a.anio} style={{ ...td, fontWeight: 600 }}>{eur(a.total)}</td>)}
              <td style={{ ...td, fontWeight: 600 }}>{eur(c.totalContrato)}</td><td style={td} />
            </tr>
            <tr style={{ borderTop: `1px solid ${C.border}` }}>
              <td style={{ ...td, textAlign: "left", fontWeight: 650 }}>Resultado</td>
              {c.porAnio.map((a, k) => { const v = ingresosAnio[k] - a.total; return <td key={a.anio} style={{ ...td, fontWeight: 650, color: v < 0 ? C.red : C.green }}>{eur(v)}</td>; })}
              {(() => { const v = ingresosTotal - c.totalContrato; return <td style={{ ...td, fontWeight: 650, color: v < 0 ? C.red : C.green }}>{eur(v)}</td>; })()}
              <td style={{ ...td, color: C.dim }}>{pct((ingresosTotal - c.totalContrato) / ingresosTotal * 100)} s/ ingresos</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: C.dim, marginTop: 6, lineHeight: 1.5 }}>{c.ingresosBase.length > 1 && c.ingresosBase[1] !== c.ingresosBase[0] ? "Se oferta el precio del primer año; la baja se aplica igual a los siguientes, que suben como dice el pliego." : "El precio de la oferta es el mismo todos los años."} El coste sube con {r.modo === "estudio" && r.estudio.incrementos?.manoObra?.length ? "las subidas del pliego (mano de obra y resto)" : "el convenio y el IPC"}. Precio objetivo = lo que cuesta el contrato ÷ (1 − margen), repartido como los ingresos.</div>

      {c.preciosUnitarios?.length > 0 && <>
        {titulo("Precio por unidad para la oferta")}
        <div style={{ ...tarjeta, overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr><th style={{ ...th, textAlign: "left" }}>Servicio</th><th style={th}>Al año</th><th style={th}>Coste por unidad</th><th style={th}>Precio objetivo</th><th style={th}>Máximo del pliego</th><th style={th}>Baja sobre el máximo</th></tr></thead>
            <tbody>
              {c.preciosUnitarios.map(u => (
                <tr key={u.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ ...td, textAlign: "left" }}>{u.nombre}{u.ubicacion ? <span style={{ color: C.dim }}> · {u.ubicacion}</span> : null}</td>
                  <td style={td}>{F0.format(u.cantidadAnual)} {u.unidad}</td>
                  <td style={td}>{F2.format(u.coste)} €/{u.unidad}</td>
                  <td style={{ ...td, fontWeight: 650 }}>{F2.format(u.objetivo)} €/{u.unidad}</td>
                  <td style={td}>{F2.format(u.maximo)} €/{u.unidad}</td>
                  <td style={{ ...td, color: u.bajaPct < 0 ? C.red : u.bajaPct > 25 ? C.amber : C.green }}>{u.bajaPct < 0 ? "no cabe" : pct(u.bajaPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 6, lineHeight: 1.5 }}>Cada servicio se lleva la parte del coste que le toca por el tiempo de equipo que ocupa (en los transportes, por sus viajes y kilómetros). Una baja muy grande puede ser anormalmente baja: mira en Alternativas dónde empieza.</div>
      </>}

      {r.modo === "rendimientos" && <>
      {titulo("Plantilla")}
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: C.text, marginBottom: 8 }} title="Se pide cuando hace falta y se paga por unidad: se cuentan solo las horas de personas y vehículos que se usan">
        <input type="checkbox" checked={!!c.aDemanda} onChange={e => cambiar({ aDemanda: e.target.checked })} style={{ accentColor: C.blue }} /> Contrato a demanda (sin equipo fijo: solo las horas que se usan)
      </label>
      <div style={{ ...tarjeta, overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>Puesto</th><th style={th}>Personas</th><th style={th}>Coste al año (con S. Social)</th><th style={{ ...th, textAlign: "left" }}>De dónde sale</th></tr></thead>
          <tbody>
            {[["Personas de servicio", c.plantilla.servicio, c.plantilla.costeServicio, `${F0.format(r.dimension.resumen.horasAnio)} h al año ÷ ${F0.format(r.parametrosDimension.horasAnualesConvenio)} h de convenio (menos un ${F1.format(r.parametrosDimension.absentismoPct)} % de absentismo) = ${F1.format(c.plantilla.servicioETC)} a jornada completa`],
              ["Encargados", c.plantilla.encargados, c.plantilla.costeEncargados, `uno por cada ${p.personasPorEncargado} personas de servicio`],
              ["Jefe de servicio", F1.format(c.plantilla.jefe), c.plantilla.costeJefe, "parte de su jornada en este contrato"]].map(([n, k, v, de]) => (
              <tr key={n} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ ...td, textAlign: "left" }}>{n}</td><td style={td}>{k}</td><td style={td}>{eur(v)}</td><td style={{ ...td, textAlign: "left", color: C.dim, fontSize: 12 }}>{de}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>Las horas, las personas de cada equipo y el absentismo se cambian en Planificación; los salarios, abajo.</div>

      {titulo("Vehículos")}
      <div style={{ ...tarjeta, overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>
            <th style={{ ...th, textAlign: "left" }}>Vehículo</th><th style={th}>Turnos al año</th><th style={th}>Trabajando</th><th style={th}>Reserva</th>
            {CAMPOS_VEHICULO.map(([k, n, u]) => <th key={k} style={th}>{n} ({u})</th>)}
            <th style={th}>Amortización al año</th>
          </tr></thead>
          <tbody>
            {c.vehiculos.map(v => {
              const o = costeOrientativo(v.tipo), cambiado = calc.vehiculos?.[v.tipo] || {};
              return (
                <tr key={v.tipo} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{v.tipo}<div style={{ fontSize: 11, color: C.dim, fontWeight: 400 }}>{v.servicios.join(", ")}</div></td>
                  <td style={td}>{F1.format(v.turnosAnio)}</td>
                  <td style={td}>{c.aDemanda ? `${F0.format(v.unidades * 100)} %` : v.unidades}{v.pliego != null ? <div style={{ fontSize: 11, color: C.dim }} title={(v.conceptosPliego || []).join(" · ")}>las del pliego{v.calculadas != null && v.calculadas !== v.pliego ? ` (tus rendimientos: ${v.calculadas})` : ""}</div> : null}{v.kmAnio ? <div style={{ fontSize: 11, color: C.dim }}>{F0.format(v.kmAnio)} km/año</div> : null}</td>
                  <td style={td}>{numInput(cambiado.reserva ?? null, x => cambiar({ vehiculos: { [v.tipo]: { reserva: x } } }), 60, String(v.reserva))}</td>
                  {CAMPOS_VEHICULO.map(([k]) => <td key={k} style={td}>{numInput(cambiado[k] ?? null, x => cambiar({ vehiculos: { [v.tipo]: { [k]: x } } }), k === "precio" ? 100 : 80, F0.format(o[k]))}</td>)}
                  <td style={td}>{eur(v.amortizacion)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>En gris, valores orientativos: escribe encima los tuyos. La amortización incluye la financiación ({c.amortizacionCorta ? `contrato corto: el vehículo sigue en la empresa, se reparte en ${F1.format(c.amortizacionCorta)} años de vida útil, a ${F1.format(p.interesPct)} %` : `cuota de un préstamo a ${F1.format(p.interesPct)} % en ${F1.format(p.aniosAmortizacion || anios)} años, quedando un ${F1.format(p.residualPct)} % de valor`}).</div>

      </>}

      {titulo("Parámetros")}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 12 }}>
        {GRUPOS_PARAM.map(([g, ps]) => (
          <div key={g} style={{ ...tarjeta, padding: "10px 14px" }}>
            <div style={{ fontSize: 13, fontWeight: 650, color: C.text, marginBottom: 6 }}>{g}</div>
            {ps.map(([k, l, u]) => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 13, color: C.muted }}>
                <span style={{ flex: 1 }}>{l}</span>
                {numInput(calc.parametros?.[k] ?? null, x => cambiar({ parametros: { [k]: x } }), 90, PARAMETROS_CALCULO[k] == null ? "—" : String(PARAMETROS_CALCULO[k]))}
                <span style={{ width: 52, fontSize: 12, color: C.dim }}>{u}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
