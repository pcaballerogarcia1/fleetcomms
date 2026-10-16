import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { enPaginas, textoDeOdtXml, textoDeOfimatica, textoDeWordXml } from "./documento-texto.js";

const W = cuerpo => `<?xml version="1.0"?><w:document xmlns:w="w" xmlns:w14="w14"><w:body>${cuerpo}</w:body></w:document>`;
const p = t => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;

describe("Word y OpenDocument", () => {
  it("párrafos, tablas por filas y casillas marcadas", () => {
    const xml = W(p("3. Duración del contrato.") + `<w:tbl><w:tr><w:tc>${p("Duración inicial")}</w:tc><w:tc>${p("12")}</w:tc><w:tc><w:p><w:r><w14:checkbox><w14:checked w14:val="0"/></w14:checkbox><w:t>días</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w14:checkbox><w14:checked w14:val="1"/></w14:checkbox><w:t>meses</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`);
    const t = textoDeWordXml(xml);
    expect(t).toContain("3. Duración del contrato.");
    expect(t).toMatch(/Duración inicial\s*\n?\s*\|\s*12/);
    expect(t).toMatch(/☐\s*días/);
    expect(t).toMatch(/☒\s*meses/);
  });
  it("OpenDocument", () => {
    const t = textoDeOdtXml(`<office:text><text:h>Presupuesto</text:h><text:p>Importe: 1.000 &amp; más</text:p></office:text>`);
    expect(t.trim()).toBe("Presupuesto\nImporte: 1.000 & más");
  });
  it("un .docx entero, en páginas", () => {
    const docx = zipSync({ "word/document.xml": strToU8(W(p("Página uno") + `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` + p("Página dos"))) });
    expect(textoDeOfimatica(docx, "a.docx")).toEqual(["Página uno", "Página dos"]);
  });
  it("sin saltos de página: trozos", () => {
    expect(enPaginas("a\n".repeat(3000), 1000).length).toBeGreaterThan(4);
  });
});
