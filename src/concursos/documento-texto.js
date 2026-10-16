// Concursos → el texto de un documento que no es PDF: Word (.docx) y
// OpenDocument (.odt), que es como vienen muchos anexos y cuadros de
// características en la Plataforma de Contratación. Se saca el texto por
// párrafos y las tablas fila a fila (celdas separadas por « | »), con las
// casillas marcadas como ☒ y las vacías como ☐, y se reparte en «páginas»
// (los saltos de página del documento o, si no tiene, trozos de unas 3.500
// letras) para poder citar de dónde sale cada dato. Sin React ni Firebase.
import { strFromU8, unzipSync } from "fflate";

const entidades = t => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
const SALTO = "\u0000PAGINA\u0000";

/** document.xml de Word → texto con saltos de línea y de página */
export function textoDeWordXml(xml) {
  let t = xml
    .replace(/<w:br [^>]*w:type="page"[^>]*\/>|<w:lastRenderedPageBreak\/>/g, SALTO)
    // casillas: las de Word 2010+ (w14:checkbox) y los campos FORMCHECKBOX
    .replace(/<w14:checkbox>([\s\S]*?)<\/w14:checkbox>/g, (_, x) => (/<w14:checked w14:val="(?:1|true)"/.test(x) ? "☒" : "☐"))
    .replace(/<w:checkBox>([\s\S]*?)<\/w:checkBox>/g, (_, x) => (/<w:(?:checked|default) w:val="(?:1|true)"|<w:checked\/>/.test(x) ? "☒" : "☐"))
    .replace(/<w:tab\/>/g, " ")
    .replace(/<w:tc>/g, "").replace(/<\/w:tc>/g, " | ")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<\/w:p>/g, "\n");
  // las casillas que van como símbolo de la fuente Wingdings (☐ F06F / ☒ F078 / ☑ F0FE)
  t = t.replace(/<w:sym [^>]*w:char="(F0(?:78|FD|FE|7E))"[^>]*\/>/gi, "☒").replace(/<w:sym [^>]*w:char="(F0(?:6F|A8|71))"[^>]*\/>/gi, "☐");
  t = t.replace(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g, "$1").replace(/<[^>]+>/g, "");
  return entidades(t).replace(/[ \t]+/g, " ").replace(/ *\| *\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

/** content.xml de OpenDocument → texto */
export function textoDeOdtXml(xml) {
  const t = xml
    .replace(/<text:soft-page-break\/>/g, SALTO)
    .replace(/<form:checkbox[^>]*form:current-state="checked"[^>]*\/?>/g, "☒").replace(/<form:checkbox[^>]*\/?>/g, "☐")
    .replace(/<text:tab\/>|<text:s(?: [^>]*)?\/>/g, " ")
    .replace(/<\/table:table-cell>/g, " | ").replace(/<\/table:table-row>/g, "\n")
    .replace(/<\/text:p>|<\/text:h>|<text:line-break\/>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return entidades(t).replace(/[ \t]+/g, " ").replace(/ *\| *\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

/** Un texto largo en «páginas»: por sus saltos de página; si no tiene, por trozos de unas 3.500 letras */
export function enPaginas(texto, largo = 3500) {
  const partes = texto.split(SALTO).map(p => p.trim()).filter(Boolean);
  if (partes.length > 1) return partes;
  const out = [];
  let resto = texto.replaceAll(SALTO, "");
  while (resto.length > largo) {
    let corte = resto.lastIndexOf("\n", largo);
    if (corte < largo * 0.5) corte = largo;
    out.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte);
  }
  if (resto.trim()) out.push(resto.trim());
  return out;
}

export const ES_OFIMATICA = /\.(docx|docm|odt)$/i;

/** Word u OpenDocument (ArrayBuffer o Uint8Array) → [texto de cada «página»] */
export function textoDeOfimatica(datos, nombre = "") {
  const zip = unzipSync(datos instanceof Uint8Array ? datos : new Uint8Array(datos));
  if (zip["word/document.xml"]) return enPaginas(textoDeWordXml(strFromU8(zip["word/document.xml"])));
  if (zip["content.xml"]) return enPaginas(textoDeOdtXml(strFromU8(zip["content.xml"])));
  throw new Error(`«${nombre}» no es un Word ni un OpenDocument que se pueda leer.`);
}

const TIPO = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docm: "application/vnd.ms-word.document.macroEnabled.12", odt: "application/vnd.oasis.opendocument.text" };
export const ACEPTA_PLIEGOS = "application/pdf,.pdf,.docx,.docm,.odt,.zip";

/**
 * Un archivo subido → los documentos que contiene, con su texto por páginas:
 * PDF, Word, OpenDocument o un ZIP con varios de ellos dentro.
 * @returns [{ archivo: File, paginas: [texto] }]
 */
export async function documentosDeArchivo(archivo, { onProgreso } = {}) {
  const nombre = archivo.name || "documento";
  const ext = (nombre.match(/\.(\w+)$/) || [])[1]?.toLowerCase();
  if (ext === "pdf" || archivo.type === "application/pdf") {
    const { textoDelPdf } = await import("../rostering/convenio-pdf.js");
    return [{ archivo, paginas: await textoDelPdf(archivo, { onProgreso }) }];
  }
  const datos = new Uint8Array(await archivo.arrayBuffer());
  if (ES_OFIMATICA.test(nombre)) return [{ archivo, paginas: textoDeOfimatica(datos, nombre) }];
  if (ext === "zip" || (datos[0] === 0x50 && datos[1] === 0x4b && !ES_OFIMATICA.test(nombre))) {
    const zip = unzipSync(datos);
    const out = [];
    for (const [ruta, bytes] of Object.entries(zip)) {
      const e = (ruta.match(/\.(\w+)$/) || [])[1]?.toLowerCase();
      if (!TIPO[e] || /(^|\/)(__MACOSX|\._)/.test(ruta) || !bytes.length) continue;
      const dentro = new File([bytes], ruta.split("/").pop(), { type: TIPO[e] });
      out.push(...await documentosDeArchivo(dentro, { onProgreso }));
    }
    if (!out.length) throw new Error(`El ZIP «${nombre}» no trae ningún PDF, Word u OpenDocument.`);
    return out;
  }
  throw new Error(`«${nombre}» no es un PDF, Word, OpenDocument ni ZIP.`);
}
