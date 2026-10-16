// GET /api/plataforma — intermediario con la Plataforma de Contratación del
// Sector Público (no deja que el navegador lea sus datos directamente).
// Solo con sesión de Operanzia, y solo habla con la Plataforma.
//  · ?accion=licitacion&enlace=<enlace de la licitación>: sus datos oficiales
//    (del XML del anuncio y del pliego) y sus documentos.
//  · ?accion=documento&url=<enlace de un documento>: el documento (para leerlo).
//  · ?accion=buscar&cpv=9051,9061&desde=<fecha ISO>: las licitaciones nuevas
//    del canal con esos CPV desde esa fecha (las más recientes primero).
import { verificarToken, AvisoError } from "./_avisos/core.js";
import { documentosDeDetalle, entradasDelCanal, licitacionDeCodice } from "./_plataforma/codice.js";

export const config = { maxDuration: 60 };

const PROYECTOS = [globalThis.process.env.FIREBASE_PROJECT_ID, globalThis.process.env.VITE_FIREBASE_PROJECT_ID, "fleetcomms-13d89", "operanzia-pruebas"];
const HOSTS = /^https:\/\/(contrataciondelestado\.es|contrataciondelsectorpublico\.gob\.es)\//;
const CANAL = "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom";
const MAX_DOC = 4.3 * 1024 * 1024; // lo que deja devolver Vercel

async function traer(url, { texto = true } = {}) {
  if (!HOSTS.test(url)) throw new AvisoError(400, "Solo se pueden pedir enlaces de la Plataforma de Contratación");
  const r = await fetch(url, { headers: { "User-Agent": "Operanzia (licitaciones)" }, redirect: "follow", signal: AbortSignal.timeout(25000) })
    .catch(e => { throw new AvisoError(504, e.name === "TimeoutError" ? "La Plataforma tarda demasiado en responder" : "No se pudo hablar con la Plataforma"); });
  if (!r.ok) throw new AvisoError(502, `La Plataforma respondió ${r.status}`);
  return texto ? r.text() : { tipo: r.headers.get("content-type") || "application/octet-stream", datos: Buffer.from(await r.arrayBuffer()) };
}

/** Datos oficiales de una licitación a partir de su enlace */
export async function licitacion(enlace) {
  if (!/deeplink:detalle_licitacion|detalle_licitacion|idEvl=/.test(enlace)) throw new AvisoError(400, "Ese no parece el enlace de una licitación (debe ser el de su página en la Plataforma)");
  const html = await traer(enlace);
  const docs = documentosDeDetalle(html);
  // el 2.º enlace de cada documento es su XML (HTML, XML, PDF)
  const xmls = [];
  for (const nombre of ["^Pliego", "^Anuncio de Licitaci", "Anuncio previo|Anuncio de adjudicaci"]) {
    const d = docs.find(x => new RegExp(nombre, "i").test(x.nombre));
    if (!d) continue;
    for (const u of d.enlaces) {
      const t = await traer(u);
      if (/^\s*<\?xml/.test(t)) { xmls.push(t); break; }
    }
  }
  if (!xmls.length) throw new AvisoError(404, "No encuentro el anuncio ni el pliego de esa licitación");
  const partes = xmls.map(licitacionDeCodice);
  // lo de cada XML que falte en el primero (el del pliego trae los documentos; el anuncio, a veces más datos)
  const l = { ...partes[0] };
  for (const p of partes.slice(1)) for (const [k, v] of Object.entries(p)) {
    const vacio = l[k] == null || (Array.isArray(l[k]) && !l[k].length) || (k === "presupuesto" && l[k].sinIva == null);
    if (vacio && v != null) l[k] = v;
  }
  l.documentos = l.documentos.filter(d => !/^Detalle_Licitacion/i.test(d.nombre));
  l.publicados = docs.map(d => ({ nombre: d.nombre, fecha: d.fecha, pdf: d.enlaces[d.enlaces.length - 1] }));
  return { ...l, enlace };
}

/**
 * Licitaciones nuevas del canal con esos CPV desde una fecha. Por tandas: cada
 * llamada lee páginas durante unos segundos (Vercel corta a los 60) y devuelve
 * por dónde seguir; el navegador vuelve a llamar con `desdePagina` hasta que
 * `siguiente` es null.
 */
export async function buscar(cpvs, desde, { paginas = 12, desdePagina = null, segundos = 20 } = {}) {
  const prefijos = cpvs.map(c => c.replace(/\D/g, "")).filter(Boolean);
  if (!prefijos.length) throw new AvisoError(400, "Dime al menos un CPV");
  if (desdePagina && !HOSTS.test(desdePagina)) throw new AvisoError(400, "Página del canal no válida");
  const limite = desde ? new Date(desde).getTime() : Date.now() - 7 * 864e5;
  const out = [];
  let url = desdePagina || CANAL, leidas = 0, mas = true;
  const inicio = Date.now();
  while (url && mas && leidas < paginas && Date.now() - inicio < segundos * 1000) {
    const { entradas, siguiente } = entradasDelCanal(await traer(url));
    leidas++;
    for (const e of entradas) {
      if (new Date(e.actualizado).getTime() < limite) { mas = false; continue; }
      // servicios y suministros (contenedores, camiones); no obras
      if (e.tipoContrato && !["1", "2"].includes(e.tipoContrato)) continue;
      if (!e.cpvs.some(c => prefijos.some(p => c.startsWith(p)))) continue;
      const { documentos: _d, ...resto } = e; void _d;
      if (!out.some(x => x.id === e.id)) out.push(resto);
    }
    url = siguiente;
  }
  return { licitaciones: out, paginasLeidas: leidas, siguiente: mas ? url : null, completo: !mas || !url };
}

export default async function handler(req, res) {
  try {
    await verificarToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), PROYECTOS);
    const q = req.query || {};
    if (q.accion === "licitacion") return res.status(200).json(await licitacion(String(q.enlace || "")));
    if (q.accion === "buscar") return res.status(200).json(await buscar(String(q.cpv || "").split(","), q.desde || null, { paginas: Math.min(40, Number(q.paginas) || 12), desdePagina: q.desdePagina || null }));
    if (q.accion === "documento") {
      const url = String(q.url || "");
      if (!/GetDocumentByIdServlet/.test(url)) throw new AvisoError(400, "Ese no es el enlace de un documento de la Plataforma");
      const { tipo, datos } = await traer(url, { texto: false });
      if (datos.length > MAX_DOC) throw new AvisoError(413, "El documento es demasiado grande para traerlo desde aquí: bájalo de la Plataforma y súbelo a mano");
      res.setHeader("Content-Type", tipo);
      return res.status(200).send(datos);
    }
    throw new AvisoError(400, "Acción desconocida");
  } catch (e) {
    if (e instanceof AvisoError) return res.status(e.status).json({ error: e.message });
    console.error("Plataforma:", e);
    return res.status(500).json({ error: "No se pudo hablar con la Plataforma de Contratación" });
  }
}
