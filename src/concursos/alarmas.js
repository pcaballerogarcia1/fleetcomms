// Concursos → lo que no cuadra.
// Antes de dar una rentabilidad o una baja, se comprueba que los números
// tengan sentido: que haya presupuesto y duración, que cuadren con el valor
// estimado, que el coste no sea una fracción del presupuesto (señal de que
// falta algo) ni se aleje mucho del estudio del Ayuntamiento, que se haya
// tenido en cuenta la plantilla a subrogar, y que los criterios estén claros.
// Las que «bloquean» impiden recomendar una baja hasta resolverlas.
// Sin React ni Firebase.

const valorDato = (ficha, clave) => { const d = ficha?.datos?.[clave]; return d && d.estado !== "descartado" ? d.valor : null; };
const eur = n => `${Math.round(n).toLocaleString("es-ES")} €`;

/**
 * @param o { r: calcularConcurso(), ficha, concurso, calc, adj }
 * @returns [{ nivel: "bloquea" | "aviso", texto, ruta }]
 */
export function alarmasConcurso({ r, ficha, concurso, calc, adj } = {}) {
  const out = [];
  const bloquea = (texto, ruta) => out.push({ nivel: "bloquea", texto, ruta });
  const aviso = (texto, ruta) => out.push({ nivel: "aviso", texto, ruta });
  if (!r) return out;
  const pres = r.presupuestoAnual;

  // ── lo básico ──
  if (!concurso?.duracionAnios && !concurso?.duracionMeses) bloquea("Falta la duración del contrato: confírmala en la Ficha de requisitos.", "/documentos");
  if (!pres) bloquea("Falta el presupuesto del primer año: confírmalo en la Ficha de requisitos o escríbelo en Cálculo.", "/calculo");
  else if (r.fuentePresupuesto?.dudoso) aviso(`El presupuesto del primer año sale de «${r.fuentePresupuesto.fuente}»: compruébalo.`, "/calculo");

  // ── que cuadre con el valor estimado: lo que se cobraría en todo el contrato sin baja ──
  const vec = Number(concurso?.valorEstimado) || Number(valorDato(ficha, "valorEstimado")) || null;
  const total = (r.cuenta.ingresosBase || []).reduce((s, v) => s + v, 0);
  if (vec && total) {
    if (total > vec * 1.05) bloquea(`No cuadra: presupuesto del primer año × años = ${eur(total)}, más que el valor estimado (${eur(vec)}). Revisa la duración o el presupuesto anual.`, "/documentos");
    else if (total < vec * 0.6) aviso(`Presupuesto × años = ${eur(total)}, bastante menos que el valor estimado (${eur(vec)}): ¿hay prórrogas o modificaciones? ¿La duración es la buena?`, "/documentos");
  }

  // ── el coste ──
  if (pres && r.costeEquivalente) {
    const ratio = r.costeEquivalente / pres;
    if (ratio < 0.6) bloquea(`Tu coste es solo el ${Math.round(ratio * 100)} % del presupuesto: casi seguro que falta algo (servicios, plantilla a subrogar, medios mínimos, temporada alta…).`, "/calculo");
    else if (ratio > 1) aviso(`Tu coste supera el presupuesto en un ${Math.round((ratio - 1) * 100)} %: con este coste no cabe.`, "/calculo");
  }
  if (r.estudio && r.modo === "estudio") {
    const suyo = r.estudio.costeEjecucion, nuestro = r.cuenta.anio1.total - (r.cuenta.anio1.gastosGenerales || 0) - (r.cuenta.anio1.contingencias || 0) - (r.cuenta.anio1.mejoras || 0);
    if (suyo && nuestro / suyo < 0.75) aviso(`Tu coste directo es un ${Math.round((1 - nuestro / suyo) * 100)} % menor que el del estudio del Ayuntamiento: justifica cada ajuste (riesgo de baja anormal y de no cumplir).`, "/calculo");
  }
  if (r.estudio && r.modo === "rendimientos") aviso("El pliego trae el estudio de costes del Ayuntamiento y estás calculando por rendimientos: compáralo o parte de él.", "/calculo");
  if (r.modo === "rendimientos" && Object.keys(ficha?.servicios || {}).length <= 1) aviso("Solo hay un servicio en la ficha: comprueba que estén todos los del objeto del contrato.", "/documentos");
  if (valorDato(ficha, "subrogacion") && !calc?.usarPlantilla) aviso("Hay que subrogar plantilla: sube la lista de personal (antigüedad, jornada, sueldo) para calcular su coste real.", "/calculo");

  // ── los criterios ──
  if (!adj?.criterios?.length) bloquea("Faltan los criterios de adjudicación: confírmalos en la Ficha de requisitos.", "/documentos");
  else {
    const suma = adj.criterios.reduce((s, c) => s + (Number(c.puntos) || 0), 0);
    if (Math.abs(suma - 100) > 1e-6) aviso(`Los criterios suman ${suma} puntos, no 100: revisa la ficha.`, "/documentos");
    if (!adj.criterios.some(c => c.tipo === "precio")) bloquea("Ningún criterio es el precio: márcalo en la ficha.", "/documentos");
    if (adj.formulaSupuesta) aviso("El pliego no dice la fórmula del precio: se calcula con una supuesta. Elige la que creas en la ficha.", "/documentos");
  }
  return out;
}
