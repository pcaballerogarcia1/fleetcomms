// Rostering → Reglas: el texto de cada página de un PDF, leído en el propio
// navegador con pdf.js (la librería, ~1 MB, solo se descarga al usarla). Se usa
// su versión «legacy», que funciona también en navegadores no tan recientes.
// Un PDF escaneado (fotos de páginas) no tiene texto: se devuelve vacío.

/** archivo: File | Blob | ArrayBuffer → [texto de cada página] */
export async function textoDelPdf(archivo, { onProgreso } = {}) {
  const [pdfjs, { default: worker }] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.min.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const datos = archivo instanceof ArrayBuffer ? archivo : await archivo.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(datos) }).promise;
  const paginas = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgreso?.(i, pdf.numPages);
    const contenido = await (await pdf.getPage(i)).getTextContent();
    // cada trozo de texto; un salto de línea donde el PDF lo marca
    paginas.push(contenido.items.map(t => (t.str || "") + (t.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+/g, " "));
  }
  await pdf.destroy();
  return paginas;
}
