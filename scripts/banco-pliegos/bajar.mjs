// Baja los pliegos (PCAP, PPT y los anexos que importan) de cada licitación y guarda su texto por páginas
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const { textoDeOfimatica } = await import(new URL("../../src/concursos/documento-texto.js", import.meta.url).href);
const { unzipSync } = await import("fflate");
const indice = JSON.parse(readFileSync("indice.json", "utf8"));
mkdirSync("txt", { recursive: true });
async function pdfTexto(buf) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const paginas = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    paginas.push(c.items.map(t => (t.str || "") + (t.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+/g, " "));
  }
  await pdf.destroy();
  return paginas;
}
// cualquier archivo → [páginas de cada documento que contiene]
async function documentos(buf, nombre = "") {
  const b = new Uint8Array(buf);
  if (b[0] === 0x25 && b[1] === 0x50) return [await pdfTexto(b)];
  if (b[0] === 0x50 && b[1] === 0x4b) {
    const z = unzipSync(b);
    if (z["word/document.xml"] || z["content.xml"]) return [textoDeOfimatica(b, nombre)];
    const out = [];
    for (const [ruta, bytes] of Object.entries(z)) if (/\.(pdf|docx|docm|odt)$/i.test(ruta) && bytes.length) out.push(...await documentos(bytes, ruta));
    return out;
  }
  return [];
}
const UTIL = /cuadro|resumen|caracter[ií]stic|anexo\s*(?:i|1)\b|anexo i[^ivx]|pcap|pliego|prescrip|clausulas|cl[aá]usulas|memoria econ|estudio econ|justificativ/i;
const NO = /modelo|declaraci|deuc|oferta econ|proposici|aval|seguro|cauci|conflicto|prohibic|instrucci|formulario|solicitud|plano|mapa|foto/i;
let k = 0;
for (const x of indice) {
  k++;
  const lista = [["pcap", x.docs.pcap, "pcap"], ["ppt", x.docs.ppt, "ppt"], ...(x.adicionales || []).filter(a => UTIL.test(a.nombre) && !NO.test(a.nombre)).slice(0, 4).map((a, i) => [`extra${i}`, a.uri, a.nombre])];
  for (const [tipo, uri, nombre] of lista) {
    const f = `txt/${k}-${tipo}.json`;
    if (existsSync(f) && readFileSync(f, "utf8") !== "null") continue;
    try {
      const buf = Buffer.from(await (await fetch(uri)).arrayBuffer());
      const docs = await documentos(buf, nombre);
      if (!docs.length) { writeFileSync(f, "null"); console.log(k, tipo, "no se puede leer", nombre); continue; }
      const paginas = docs.flat();
      writeFileSync(f, JSON.stringify(paginas));
      console.log(k, tipo, paginas.length, "págs", nombre.slice(0, 50));
    } catch (e) { console.log(k, tipo, "fallo", e.message); writeFileSync(f, "null"); }
  }
}
