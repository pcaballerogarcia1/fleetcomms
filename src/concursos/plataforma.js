// Concursos ↔ Plataforma de Contratación del Sector Público (a través de
// /api/plataforma): traer los datos oficiales de una licitación por su enlace,
// bajar y leer sus pliegos, y buscar licitaciones nuevas por CPV.
// Los datos oficiales (presupuesto, valor estimado, duración, CPV, criterios
// con su peso) se ponen en la ficha ya confirmados: son los que declaró el
// Ayuntamiento. El lector de pliegos saca lo demás y se comprueba que cuadre.
import { auth } from "../firebase.js";
import { documentosDeArchivo } from "./documento-texto.js";
import { leerPliego } from "./pliego.js";
import { cambiarConcurso, crearConcurso, fijarAdjudicacion, fijarDato, guardarDocumento } from "./store.js";

async function pedir(params, { binario = false } = {}) {
  const token = await auth.currentUser?.getIdToken();
  const r = await fetch(`/api/plataforma?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `la Plataforma no responde (${r.status})`); }
  return binario ? r : r.json();
}

/** Los datos oficiales de una licitación a partir del enlace de su página en la Plataforma */
export const licitacionDeEnlace = enlace => pedir({ accion: "licitacion", enlace: enlace.trim() });

/** Las licitaciones nuevas (en plazo) con esos CPV desde una fecha */
export const buscarLicitaciones = (cpvs, desde, paginas = 12) => pedir({ accion: "buscar", cpv: cpvs.join(","), ...(desde ? { desde } : {}), paginas: String(paginas) });

// los anexos que sirven (cuadros, anexos del pliego, memorias económicas), no los modelos de declaración
const UTIL = /cuadro|resumen|caracter[ií]stic|anexo\s*(?:i|1)\b|anexo i[^ivx]|pcap|pliego|prescrip|cl[aá]usulas|memoria econ|estudio econ|justificativ|subroga|personal/i;
const NO = /modelo|declaraci|deuc|oferta econ|proposici|aval|seguro|cauci|conflicto|prohibic|instrucci|formulario|solicitud|plano|mapa|foto|iae/i;
export const documentosUtiles = l => (l.documentos || []).filter(d => d.tipo !== "anexo" || (UTIL.test(d.nombre) && !NO.test(d.nombre)));

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

/**
 * Pone en el concurso los datos oficiales y baja y lee sus pliegos.
 * @returns { documentos: n leídos, fallos: [texto] }
 */
export async function importarLicitacion(concursoId, l, { onProgreso } = {}) {
  const { datos, adjudicacion, concurso } = datosOficiales(l);
  onProgreso?.("Guardando los datos oficiales…");
  await cambiarConcurso(concursoId, concurso, "Trajo una licitación de la Plataforma");
  for (const [k, v] of Object.entries(datos)) await fijarDato(concursoId, k, v);
  if (adjudicacion) await fijarAdjudicacion(concursoId, adjudicacion);
  const fallos = [];
  let n = 0;
  for (const doc of documentosUtiles(l)) {
    try {
      onProgreso?.(`Bajando ${doc.nombre}…`);
      const r = await pedir({ accion: "documento", url: doc.uri }, { binario: true });
      const blob = await r.blob();
      const archivo = new File([blob], doc.nombre || `${doc.tipo}.pdf`, { type: blob.type || "application/pdf" });
      const leidos = await documentosDeArchivo(archivo, { onProgreso: (i, t) => onProgreso?.(`Leyendo ${doc.nombre}: página ${i} de ${t}…`) });
      for (const { archivo: a, paginas } of leidos) {
        onProgreso?.(`Guardando ${a.name}…`);
        await guardarDocumento(concursoId, { archivo: a, paginas, lectura: leerPliego(paginas) });
        n++;
      }
    } catch (e) { fallos.push(`${doc.nombre}: ${e.message || e}`); }
  }
  return { documentos: n, fallos };
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
  const r = await importarLicitacion(concurso._id, l, { onProgreso });
  return { concurso, ...r };
}
