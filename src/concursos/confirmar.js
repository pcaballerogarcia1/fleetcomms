// Concursos → «Confirmar todo lo leído»: lo que los pliegos proponen pasa a la
// ficha de una vez (datos del contrato, criterios de adjudicación y el estudio
// de costes del Ayuntamiento). Así Cálculo, Alternativas y Resumen no trabajan
// con valores por defecto mientras nadie revisa la ficha dato a dato. Lo que
// ya se haya confirmado, corregido o descartado a mano no se toca.
import { mejorPropuesta } from "./criterios.js";
import { cambiarConcurso, fijarAdjudicacion, fijarDato, fijarEstudio } from "./store.js";

/** Lo propuesto por los pliegos subidos, juntos: { [clave]: [{ valor, pagina, frase, doc, docNombre, nombre }] } */
export function propuestasDe(docs) {
  const out = {};
  for (const d of docs || []) {
    for (const x of d.lectura?.datos || []) {
      if (x.id.startsWith("horario") || x.id.startsWith("lote") || x.id.startsWith("frecuencia")) continue;
      (out[x.id] ||= []).push({ valor: x.valor, pagina: x.pagina, frase: x.frase, doc: d._id, docNombre: d.nombre, nombre: x.nombre });
    }
  }
  return out;
}

// La ficha del concurso (organismo, plazos, presupuesto) se rellena sola con lo confirmado
export function alConcurso(clave, valor) {
  if (clave === "organismo") return { organismo: valor };
  if (clave === "fechaLimite" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return { fechaLimite: valor };
  if (clave === "expediente") return { expediente: valor };
  if (clave === "duracion") { const n = parseInt(valor, 10); return /mes/.test(valor) ? { duracionMeses: n, duracionAnios: Math.round((n / 12) * 10) / 10 } : n ? { duracionAnios: n, duracionMeses: n * 12 } : {}; }
  // el presupuesto base de licitación suele llevar el IVA; el «importe sin impuestos», no
  if (clave === "presupuesto" && typeof valor === "number") return { presupuestoConIva: valor };
  if (clave === "importeSinIva" && typeof valor === "number") return { presupuestoSinIva: valor };
  if (clave === "valorEstimado" && typeof valor === "number") return { valorEstimado: valor };
  return {};
}

/** La propuesta de criterios de los pliegos, como se guarda en la ficha (o null) */
export function adjudicacionPropuesta(docs) {
  const prop = mejorPropuesta((docs || []).map(d => ({ nombre: d.nombre, adjudicacion: d.lectura?.adjudicacion })));
  if (!prop?.criterios?.length) return null;
  return {
    criterios: prop.criterios.map(({ nombre, puntos, tipo, pagina, docNombre, subcriterios, escalones, unidad }) => ({ nombre, puntos, tipo, pagina: pagina ?? null, doc: docNombre ?? null, subcriterios: subcriterios || null, escalones: escalones || null, unidad: unidad || null })),
    formula: prop.formula?.id || "lineal", formulaPagina: prop.formula?.pagina ?? null, formulaSupuesta: !prop.formula, saciedad: 15,
    baja: { id: prop.baja?.id || "art85", valor: prop.baja?.valor ?? null }, bajaPagina: prop.baja?.pagina ?? null, origen: "pliego",
  };
}

/**
 * Lo que queda por confirmar: datos propuestos sin revisar, criterios sin
 * poner y estudio de costes sin usar. @returns { datos: [clave], criterios: bool, estudio: bool, total }
 */
export function pendientes(docs, ficha) {
  const props = propuestasDe(docs), datos = ficha?.datos || {};
  const claves = Object.keys(props).filter(k => !datos[k]);
  const criterios = !ficha?.adjudicacion && !!adjudicacionPropuesta(docs);
  const estudio = !ficha?.estudio && (docs || []).some(d => d.lectura?.estudio);
  return { datos: claves, criterios, estudio, total: claves.length + (criterios ? 1 : 0) + (estudio ? 1 : 0) };
}

/** Confirma de una vez lo pendiente. @returns cuántas cosas se han confirmado */
export async function confirmarLoLeido(concursoId, docs, ficha) {
  const props = propuestasDe(docs), datos = ficha?.datos || {};
  const p = pendientes(docs, ficha);
  const cambios = {};
  for (const k of p.datos) {
    const x = props[k][0];
    await fijarDato(concursoId, k, { valor: x.valor, estado: "confirmado", propuesto: x.valor, pagina: x.pagina ?? null, frase: x.frase ?? null, doc: x.doc ?? null, nombre: x.nombre || k });
    Object.assign(cambios, alConcurso(k, x.valor));
  }
  // los datos ya revisados también dicen cosas del concurso (por si no se guardaron)
  for (const [k, d] of Object.entries(datos)) if (d?.estado !== "descartado" && !(k in cambios)) Object.assign(cambios, alConcurso(k, d.valor));
  if (Object.keys(cambios).length) await cambiarConcurso(concursoId, cambios, "Confirmó lo leído de los pliegos");
  if (p.criterios) await fijarAdjudicacion(concursoId, adjudicacionPropuesta(docs));
  if (p.estudio) {
    const d = docs.find(x => x.lectura?.estudio?.cuadra) || docs.find(x => x.lectura?.estudio);
    await fijarEstudio(concursoId, d.lectura.estudio, d.nombre);
  }
  return p.total;
}
