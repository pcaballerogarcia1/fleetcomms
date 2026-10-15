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
import { PARAMETROS_CALCULO, PARTIDAS, calcularConcurso, costeOrientativo } from "./calculo.js";
import { F0, F1, eur, pct } from "./formato.js";
import { useDatosConcurso, useGuardadoDiferido } from "./usar-concurso.js";

const GRUPOS_PARAM = [
  ["Personal", [["salarioOperario", "Salario bruto de una persona de servicio", "€/año"], ["ssPct", "Seguridad Social de la empresa", "%"], ["personasPorEncargado", "Un encargado por cada", "personas"], ["salarioEncargado", "Salario bruto de un encargado", "€/año"], ["jefeDedicacion", "Jefe de servicio dedicado a este contrato", "jornadas"], ["salarioJefe", "Salario bruto del jefe de servicio", "€/año"], ["uniformesPersona", "Uniformes y EPIs por persona", "€/año"], ["subidaSalarialPct", "Subida salarial cada año", "%"]]],
  ["Vehículos", [["reservaPct", "Vehículos de reserva", "%"], ["aniosAmortizacion", "Amortizar en (vacío = años del contrato)", "años"], ["residualPct", "Valor que les queda al final", "%"], ["interesPct", "Interés de la financiación", "%"]]],
  ["Estructura y riesgo", [["instalacionesAnio", "Instalaciones (nave, vestuarios…)", "€/año"], ["sistemasAnio", "Sistemas (GPS, software…)", "€/año"], ["seguroRCAnio", "Seguros del contrato", "€/año"], ["ipcPct", "IPC cada año (lo que no es personal)", "%"], ["gastosGeneralesPct", "Gastos generales", "%"], ["contingenciasPct", "Contingencias", "%"]]],
  ["Precio", [["margenPct", "Margen que se quiere sobre lo que se cobra", "%"], ["diasCobro", "Días que se tarda en cobrar", "días"]]],
];
const CAMPOS_VEHICULO = [["precio", "Precio de compra", "€"], ["combustibleTurno", "Combustible", "€/turno"], ["consumiblesTurno", "Consumibles", "€/turno"], ["mantenimientoAnio", "Mantenimiento", "€/año"], ["seguroAnio", "Seguro e impuestos", "€/año"]];

export function CalculoConcurso({ concursoId, irA }) {
  const datos = useDatosConcurso(concursoId);
  const [calc, cambiar] = useGuardadoDiferido(concursoId, "calculo", datos.calc);
  const r = useMemo(() => (datos.listo ? calcularConcurso({ ficha: datos.ficha, dim: datos.dim, calc, concurso: datos.concurso }) : null), [datos.listo, datos.ficha, datos.dim, datos.concurso, calc]);

  const tarjeta = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14 };
  const th = { textAlign: "right", padding: "8px 10px", fontSize: 11, color: C.dim, fontWeight: 600, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  const td = { padding: "6px 10px", fontSize: 13, color: C.text, textAlign: "right", whiteSpace: "nowrap" };
  const titulo = t => <div style={{ fontSize: 14, fontWeight: 650, color: C.text, margin: "24px 0 10px" }}>{t}</div>;
  const numInput = (valor, onCambio, w = 90, ph) => <input className="op-input" type="number" value={valor ?? ""} placeholder={ph} onChange={e => onCambio(e.target.value === "" ? null : Number(e.target.value))} style={{ width: w, height: 30, textAlign: "right" }} />;

  const cabecera = (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
      <div style={{ width: 40, height: 40, borderRadius: 11, background: "rgba(91,124,250,0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: C.blue }}><Calculator size={19} /></div>
      <div>
        <div style={{ fontSize: 22, fontWeight: 650, color: C.text, letterSpacing: "-0.02em" }}>Cálculo</div>
        <div style={{ fontSize: 13, color: C.muted }}>{datos.concurso?.nombre || "…"} · cuenta de explotación del contrato, sin IVA</div>
      </div>
    </div>
  );
  if (!r) return <div style={{ flex: 1, overflow: "auto", background: C.bg, fontFamily: font, padding: "24px 28px" }}>{cabecera}<div style={{ color: C.muted, marginTop: 20 }}>Cargando…</div></div>;
  if (!r.dimension.lineas.length) {
    return (
      <div style={{ flex: 1, overflow: "auto", background: C.bg, fontFamily: font, padding: "24px 28px" }}>
        {cabecera}
        <div style={{ ...tarjeta, padding: 20, marginTop: 18, maxWidth: 680 }}>
          <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>Aún no hay servicios que calcular</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.55 }}>El cálculo parte de los servicios de la Ficha de requisitos y de lo que rinde cada equipo en Planning. Sube el pliego y añade sus servicios a la ficha.</div>
          <button className="op-btn op-primario" style={{ marginTop: 12 }} onClick={() => irA?.("/documentos")}><FileText size={14} /> Ir a Documentos</button>
        </div>
      </div>
    );
  }

  const { cuenta: c, presupuestoAnual, anios } = r;
  const p = c.parametros;
  const vehiculosTotal = c.vehiculos.reduce((s, v) => s + v.total, 0);
  const bajaObjetivo = presupuestoAnual ? (1 - c.precios.objetivo / presupuestoAnual) * 100 : null;
  const cabe = presupuestoAnual ? c.precios.objetivo <= presupuestoAnual : null;
  const kpis = [
    ["Coste al año", eur(c.costeMedioAnual), `${eur(c.totalContrato)} en ${F1.format(anios)} año${anios === 1 ? "" : "s"}`],
    [`Precio objetivo (${F1.format(p.margenPct)} % de margen)`, eur(c.precios.objetivo), `al año · equilibrio ${eur(c.precios.equilibrio)}`],
    ["Presupuesto del pliego", presupuestoAnual ? eur(presupuestoAnual) : "—", presupuestoAnual ? "al año, sin IVA" : "confírmalo en la ficha", true],
    ["Baja con el precio objetivo", bajaObjetivo != null ? pct(bajaObjetivo) : "—", cabe == null ? "" : cabe ? "cabe en el presupuesto" : "no cabe: pasa del presupuesto", cabe === false ? C.red : cabe ? C.green : null],
    ["Plantilla", F1.format(c.plantilla.total), `${c.plantilla.servicio} de servicio · ${c.plantilla.encargados} encargado${c.plantilla.encargados === 1 ? "" : "s"} · jefe ${F1.format(c.plantilla.jefe)}`],
    ["Vehículos", String(vehiculosTotal), `${vehiculosTotal - c.vehiculos.reduce((s, v) => s + v.reserva, 0)} trabajando + ${c.vehiculos.reduce((s, v) => s + v.reserva, 0)} de reserva`],
    ["Caja que hay que adelantar", eur(c.caja), `${p.diasCobro} días de gastos hasta cobrar`],
  ];

  const ingresos = c.precios.objetivo;
  const filasCuenta = PARTIDAS.map(([k, n]) => ({ k, n, anios: c.porAnio.map(a => a[k]), total: c.porAnio.reduce((s, a) => s + a[k], 0) }));

  return (
    <div style={{ flex: 1, overflow: "auto", background: C.bg, fontFamily: font, padding: "24px 28px 60px" }}>
      {cabecera}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginTop: 18 }}>
        {kpis.map(([l, v, sub, color]) => (
          <div key={l} className="op-tarjeta" style={{ padding: "12px 16px" }}>
            <div style={{ fontSize: 12, color: C.muted }}>{l}</div>
            <div style={{ fontSize: 20, fontWeight: 650, color: C.text, marginTop: 3, letterSpacing: "-0.01em" }}>{v}</div>
            <div style={{ fontSize: 11.5, color: typeof color === "string" ? color : C.dim, marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>
      {(presupuestoAnual == null || calc.presupuestoAnual != null) && <div style={{ fontSize: 12.5, color: C.amber, marginTop: 8 }}>Presupuesto al año sin IVA: confírmalo en la Ficha de requisitos («Presupuesto base de licitación» o «Importe sin impuestos») o escríbelo aquí: {numInput(calc.presupuestoAnual, v => cambiar({ presupuestoAnual: v }), 130, "€ al año")}</div>}

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
              {c.porAnio.map(a => <td key={a.anio} style={{ ...td, fontWeight: 600 }}>{eur(ingresos * a.parte)}</td>)}
              <td style={{ ...td, fontWeight: 600 }}>{eur(ingresos * anios)}</td><td style={td} />
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
              {c.porAnio.map(a => { const v = ingresos * a.parte - a.total; return <td key={a.anio} style={{ ...td, fontWeight: 650, color: v < 0 ? C.red : C.green }}>{eur(v)}</td>; })}
              {(() => { const v = ingresos * anios - c.totalContrato; return <td style={{ ...td, fontWeight: 650, color: v < 0 ? C.red : C.green }}>{eur(v)}</td>; })()}
              <td style={{ ...td, color: C.dim }}>{pct((ingresos * anios - c.totalContrato) / (ingresos * anios) * 100)} s/ ingresos</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: C.dim, marginTop: 6, lineHeight: 1.5 }}>El precio de la oferta es el mismo todos los años; el coste sube con el convenio y el IPC, así que los primeros años dan más margen que los últimos. Precio objetivo = coste medio ÷ (1 − margen).</div>

      {titulo("Plantilla")}
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
      <div style={{ fontSize: 11.5, color: C.dim, marginTop: 6 }}>Las horas, las personas de cada equipo y el absentismo se cambian en Planning; los salarios, abajo.</div>

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
                  <td style={td}>{v.unidades}</td>
                  <td style={td}>{numInput(cambiado.reserva ?? null, x => cambiar({ vehiculos: { [v.tipo]: { reserva: x } } }), 60, String(v.reserva))}</td>
                  {CAMPOS_VEHICULO.map(([k]) => <td key={k} style={td}>{numInput(cambiado[k] ?? null, x => cambiar({ vehiculos: { [v.tipo]: { [k]: x } } }), k === "precio" ? 100 : 80, F0.format(o[k]))}</td>)}
                  <td style={td}>{eur(v.amortizacion)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: C.dim, marginTop: 6 }}>En gris, valores orientativos: escribe encima los tuyos. La amortización incluye la financiación (cuota de un préstamo a {F1.format(p.interesPct)} % en {F1.format(p.aniosAmortizacion || anios)} años, quedando un {F1.format(p.residualPct)} % de valor).</div>

      {titulo("Parámetros")}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 12 }}>
        {GRUPOS_PARAM.map(([g, ps]) => (
          <div key={g} style={{ ...tarjeta, padding: "10px 14px" }}>
            <div style={{ fontSize: 12.5, fontWeight: 650, color: C.text, marginBottom: 6 }}>{g}</div>
            {ps.map(([k, l, u]) => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 12.5, color: C.muted }}>
                <span style={{ flex: 1 }}>{l}</span>
                {numInput(calc.parametros?.[k] ?? null, x => cambiar({ parametros: { [k]: x } }), 90, PARAMETROS_CALCULO[k] == null ? "—" : String(PARAMETROS_CALCULO[k]))}
                <span style={{ width: 52, fontSize: 11.5, color: C.dim }}>{u}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
