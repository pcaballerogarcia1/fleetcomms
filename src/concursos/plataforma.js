// Concursos ↔ Plataforma de Contratación del Sector Público (a través de
// /api/plataforma): traer los datos oficiales de una licitación por su enlace,
// bajar y leer sus pliegos, y buscar licitaciones nuevas por CPV.
// Los datos oficiales (presupuesto, valor estimado, duración, CPV, criterios
// con su peso) se ponen en la ficha ya confirmados: son los que declaró el
// Ayuntamiento. El lector de pliegos saca lo demás y se comprueba que cuadre.
import { auth } from "../firebase.js";
import { documentosDeArchivo } from "./documento-texto.js";
import { leerPliego } from "./pliego.js";
import { preciosDelPliego, propuestasDeServicios, servicioParaGuardar } from "./ficha.js";
import { cambiarConcurso, crearConcurso, fijarAdjudicacion, fijarDato, fijarEstudio, fijarServicio, guardarDocumento } from "./store.js";

async function pedir(params, { binario = false } = {}) {
  const token = await auth.currentUser?.getIdToken();
  const r = await fetch(`/api/plataforma?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `la Plataforma no responde (${r.status})`); }
  return binario ? r : r.json();
}

/** Los datos oficiales de una licitación a partir del enlace de su página en la Plataforma */
export const licitacionDeEnlace = enlace => pedir({ accion: "licitacion", enlace: enlace.trim() });

/**
 * Las licitaciones nuevas con esos CPV desde una fecha. El servidor lee el canal
 * por tandas cortas; aquí se le llama hasta llegar a la fecha o a `paginas`.
 */
export async function buscarLicitaciones(cpvs, desde, paginas = 12, { onProgreso } = {}) {
  const licitaciones = [];
  let desdePagina = null, leidas = 0;
  do {
    const r = await pedir({ accion: "buscar", cpv: cpvs.join(","), ...(desde ? { desde } : {}), paginas: String(Math.max(1, paginas - leidas)), ...(desdePagina ? { desdePagina } : {}) });
    for (const l of r.licitaciones) if (!licitaciones.some(x => x.id === l.id)) licitaciones.push(l);
    leidas += r.paginasLeidas || 1;
    desdePagina = r.siguiente;
    onProgreso?.(leidas, licitaciones.length);
  } while (desdePagina && leidas < paginas);
  return { licitaciones, paginasLeidas: leidas, completo: !desdePagina };
}

// los documentos que sirven: los pliegos, todos los anexos menos los modelos
// para rellenar, y de lo publicado en el expediente la memoria justificativa y
// los informes de costes (ahí suele estar el estudio económico)
const NO = /modelo|declaraci|deuc|oferta econ|proposici|aval|cauci|conflicto|prohibic|instrucci|formulario|solicitud|plano|mapa|foto|iae|insuficiencia|composici[oó]n de la mesa|acuerdo de inicio|acuerdo de iniciaci|aprobaci[oó]n del expediente|resoluci[oó]n|certificad|anuncio/i;
const PUBLICADO_UTIL = /memoria|estudio|informe (?:t[eé]cnico|econ|de costes|justificativ)|estructura de costes|costes/i;
export const documentosUtiles = l => [
  ...(l.documentos || []).filter(d => d.tipo !== "anexo" || !NO.test(d.nombre)),
  ...(l.publicados || []).filter(p => p.pdf && PUBLICADO_UTIL.test(p.nombre) && !NO.test(p.nombre)).map(p => ({ tipo: "publicado", nombre: `${p.nombre}.pdf`, uri: p.pdf })),
];

/** Un documento de la Plataforma (en trozos si es grande) → Blob */
async function bajarDocumento(uri) {
  const primero = await pedir({ accion: "documento", url: uri, parte: "0" }, { binario: true });
  const partes = Number(primero.headers.get("X-Partes")) || 1;
  const trozos = [await primero.blob()];
  for (let i = 1; i < partes; i++) trozos.push(await (await pedir({ accion: "documento", url: uri, parte: String(i) }, { binario: true })).blob());
  return new Blob(trozos, { type: trozos[0].type || "application/pdf" });
}

const duracionTexto = d => (!d?.meses ? null : d.meses % 12 === 0 ? `${d.meses / 12} año${d.meses === 12 ? "" : "s"}` : `${d.meses} meses`);

/** Licitación oficial → lo que va a la ficha y al concurso (sin Firebase: se prueba sola) */
export function datosOficiales(l) {
  const frase = "Dato oficial de la Plataforma de Contratación";
  const d = (nombre, valor) => (valor == null || valor === "" ? null : { nombre, valor, estado: "confirmado", propuesto: valor, pagina: null, frase, doc: "plataforma" });
  const fecha = l.fechaLimite ? String(l.fechaLimite).slice(0, 10) : null;
  const datos = Object.fromEntries(Object.entries({
    organismo: d("Órgano de contratación", l.organo), expediente: d("Expediente", l.expediente), objeto: d("Objeto del contrato", l.titulo),
    cpv: d("CPV", (l.cpvs || []).join(", ")), duracion: d("Duración", duracionTexto(l.duracion)), prorroga: d("Prórrogas", l.prorroga),
    presupuesto: d("Presupuesto base de licitación (con IVA)", l.presupuesto?.conIva), importeSinIva: d("Presupuesto sin IVA", l.presupuesto?.sinIva),
    valorEstimado: d("Valor estimado del contrato", l.valorEstimado), fechaLimite: d("Fecha límite de presentación", fecha),
  }).filter(([, v]) => v));
  const criterios = (l.criterios || []).filter(c => c.peso > 0).map(c => ({ nombre: c.nombre, puntos: c.peso, tipo: c.tipo, pagina: null, doc: "Plataforma" }));
  const adjudicacion = criterios.length ? { criterios, formula: "lineal", formulaSupuesta: true, saciedad: 15, baja: { id: "art85", valor: null }, origen: "plataforma" } : null;
  const meses = l.duracion?.meses || null;
  const concurso = Object.fromEntries(Object.entries({
    organismo: l.organo, expediente: l.expediente, fechaLimite: fecha, cpvs: l.cpvs?.length ? l.cpvs : null,
    duracionMeses: meses, duracionAnios: meses ? Math.round((meses / 12) * 10) / 10 : null,
    presupuestoConIva: l.presupuesto?.conIva, presupuestoSinIva: l.presupuesto?.sinIva, valorEstimado: l.valorEstimado,
    plataforma: { enlace: l.enlace || null, estado: l.estado || null, lugar: l.lugar || null, lotes: l.lotes || null, titulo: l.titulo || null },
  }).filter(([, v]) => v != null));
  return { datos, adjudicacion, concurso };
}

/** Baja, lee y guarda en el concurso esos documentos de la Plataforma. @returns { leidos: [{ _id, nombre, lectura }], fallos } */
async function bajarYLeer(concursoId, lista, onProgreso) {
  const fallos = [], leidos = [];
  for (const doc of lista) {
    try {
      onProgreso?.(`Bajando ${doc.nombre}…`);
      const blob = await bajarDocumento(doc.uri);
      const archivo = new File([blob], doc.nombre || `${doc.tipo}.pdf`, { type: blob.type || "application/pdf" });
      const docs = await documentosDeArchivo(archivo, { onProgreso: (i, t) => onProgreso?.(`Leyendo ${doc.nombre}: página ${i} de ${t}…`) });
      for (const { archivo: a, paginas } of docs) {
        onProgreso?.(`Guardando ${a.name}…`);
        const lectura = leerPliego(paginas);
        const id = await guardarDocumento(concursoId, { archivo: a, paginas, lectura });
        leidos.push({ _id: id, nombre: a.name, lectura });
      }
    } catch (e) { fallos.push(`${doc.nombre}: ${e.message || e}`); }
  }
  return { leidos, fallos };
}

const mismoNombre = (a, b) => String(a).toLowerCase().replace(/\.[a-z]{3,4}$/, "").replace(/[^a-z0-9]/g, "") === String(b).toLowerCase().replace(/\.[a-z]{3,4}$/, "").replace(/[^a-z0-9]/g, "");
/**
 * Un concurso ya creado desde la Plataforma: baja los documentos útiles que
 * aún no tiene (los que no llegaron, o los que antes no se traían).
 * @param yaTiene [nombre de cada documento del concurso]
 * @returns { leidos, fallos, nuevos: n }
 */
export async function traerLoQueFalta(concursoId, enlace, yaTiene, { onProgreso } = {}) {
  onProgreso?.("Mirando la licitación en la Plataforma…");
  const l = await licitacionDeEnlace(enlace);
  const faltan = documentosUtiles(l).filter(d => !yaTiene.some(n => mismoNombre(n, d.nombre)));
  const r = await bajarYLeer(concursoId, faltan, onProgreso);
  return { ...r, nuevos: faltan.length };
}

/**
 * Con los documentos recién leídos, deja el concurso listo para dimensionar:
 * los servicios que propone la parte técnica (frecuencias, mediciones,
 * tablas marcadas), el estudio de costes del Ayuntamiento y el personal mínimo.
 * @param docs [{ _id, nombre, lectura }]
 * @returns { servicios: n, estudio: bool, personal: texto | null }
 */
export async function prepararDimension(concursoId, docs) {
  const equipos = docs.flatMap(d => d.lectura?.equipos || []);
  const precios = docs.flatMap(d => preciosDelPliego(d.lectura?.tablas || []));
  let orden = 0;
  for (const t of propuestasDeServicios(docs).filter(t => t.usar)) {
    for (const l of t.lineas) await fijarServicio(concursoId, l.id, servicioParaGuardar(l, { equipos, precios, orden: orden++ }));
  }
  const conEstudio = docs.find(d => d.lectura?.estudio?.cuadra) || docs.find(d => d.lectura?.estudio);
  if (conEstudio) await fijarEstudio(concursoId, conEstudio.lectura.estudio, conEstudio.nombre);
  // el personal mínimo: del pliego técnico antes que del administrativo
  const pm = [...docs].sort((a, b) => (b.lectura?.clase === "tecnico") - (a.lectura?.clase === "tecnico"))
    .map(d => ({ d, x: (d.lectura?.datos || []).find(x => x.id === "personalMinimo") })).find(o => o.x);
  if (pm) await fijarDato(concursoId, "personalMinimo", { nombre: pm.x.nombre, valor: pm.x.valor, estado: "confirmado", propuesto: pm.x.valor, pagina: pm.x.pagina, frase: pm.x.frase || null, doc: pm.d._id });
  return { servicios: orden, estudio: !!conEstudio, personal: pm?.x.valor || null };
}

/**
 * Pone en el concurso los datos oficiales y baja y lee sus pliegos.
 * @param opciones.preparar true: además, servicios, estudio y personal (concurso nuevo)
 * @returns { documentos: n leídos, fallos: [texto], preparado }
 */
export async function importarLicitacion(concursoId, l, { onProgreso, preparar = false } = {}) {
  const { datos, adjudicacion, concurso } = datosOficiales(l);
  onProgreso?.("Guardando los datos oficiales…");
  await cambiarConcurso(concursoId, concurso, "Trajo una licitación de la Plataforma");
  for (const [k, v] of Object.entries(datos)) await fijarDato(concursoId, k, v);
  if (adjudicacion) await fijarAdjudicacion(concursoId, adjudicacion);
  const { fallos, leidos: leidosTodos } = await bajarYLeer(concursoId, documentosUtiles(l), onProgreso);
  const n = leidosTodos.length;
  let preparado = null;
  if (preparar && leidosTodos.length) {
    onProgreso?.("Preparando los servicios para dimensionar…");
    try { preparado = await prepararDimension(concursoId, leidosTodos); } catch (e) { fallos.push(`Servicios: ${e.message || e}`); }
  }
  return { documentos: n, fallos, preparado };
}

/** El tipo de concurso por sus CPV: autobuses (6011…, 6013…, 6017…) o por puntos */
export const tipoPorCpv = cpvs => ((cpvs || []).some(c => /^60(11|13|17)/.test(c)) ? "lineas" : "puntos");

/** Crea el concurso con los datos oficiales y sus pliegos ya leídos. @returns { concurso, documentos, fallos } */
export async function crearConcursoDesdePlataforma({ orgId, licitacion: l, nombre, onProgreso }) {
  const meses = l.duracion?.meses;
  const { concurso } = await crearConcurso({
    orgId, nombre: (nombre || l.titulo || "Licitación").slice(0, 120), tipo: tipoPorCpv(l.cpvs), organismo: l.organo || "",
    duracionAnios: meses ? Math.round((meses / 12) * 10) / 10 : null, fechaLimite: l.fechaLimite ? String(l.fechaLimite).slice(0, 10) : "",
  });
  const r = await importarLicitacion(concurso._id, l, { onProgreso, preparar: true });
  return { concurso, ...r };
}
