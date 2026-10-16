// Plataforma de Contratación del Sector Público → los datos OFICIALES de una
// licitación, del XML en formato CODICE que publica (la entrada del canal
// ATOM, el anuncio «ContractNotice» o el pliego «CallForTenders»): título,
// expediente, órgano, CPV, presupuesto con y sin IVA, valor estimado,
// duración, prórrogas, plazo de presentación, criterios con su peso,
// documentos (pliegos y anexos) y, si está adjudicada, cuántas ofertas hubo,
// la más baja, la más alta y la adjudicada. Sin dependencias.

const dec = t => String(t ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&").trim();
const uno = (x, re) => { const m = x.match(re); return m ? dec(m[1]) : null; };
const todos = (x, re) => [...x.matchAll(re)].map(m => dec(m[1]));
const num = v => (v == null || v === "" ? null : Number(v));
const bloque = (x, etiqueta) => { const m = x.match(new RegExp(`<${etiqueta}[^>]*>([\\s\\S]*?)</${etiqueta}>`)); return m ? m[1] : ""; };
const bloques = (x, etiqueta) => [...x.matchAll(new RegExp(`<${etiqueta}[^>]*>([\\s\\S]*?)</${etiqueta}>`, "g"))].map(m => m[1]);

const ES_PRECIO = /precio|econ[oó]mic|importe|oferta econ|prezo|preu/i;
const MESES = { MON: 1, ANN: 12, DAY: 1 / 30, WEE: 7 / 30 };

/** Un documento referenciado: { nombre, uri } */
const documentos = (x, etiqueta) => bloques(x, etiqueta).map(b => ({ nombre: uno(b, /<cbc:ID[^>]*>([^<]+)</), uri: uno(b, /<cbc:URI>([^<]+)</) })).filter(d => d.uri);

/**
 * El XML CODICE de una licitación → sus datos oficiales.
 * @returns { titulo, expediente, organo, estado, cpvs, presupuesto: { sinIva, conIva }, valorEstimado, duracion: { valor, unidad, meses },
 *            prorroga, fechaLimite, lugar, lotes, criterios: [{ nombre, tipo: "precio"|"formula"|"juicio", peso }],
 *            documentos: [{ tipo: "pcap"|"ppt"|"anexo", nombre, uri }], resultado: { ofertas, ofertaMin, ofertaMax, adjudicado } | null }
 */
export function licitacionDeCodice(xml) {
  const x = String(xml || "");
  const proyecto = bloque(x, "cac:ProcurementProject");
  const presu = bloque(proyecto, "cac:BudgetAmount") || bloque(x, "cac:BudgetAmount");
  const dur = (bloque(proyecto, "cac:PlannedPeriod") || bloque(x, "cac:PlannedPeriod")).match(/<cbc:DurationMeasure unitCode="(\w+)">([\d.]+)</);
  const criterios = bloques(x, "cac:AwardingCriteria").map(b => {
    const nombre = uno(b, /<cbc:Description>([^<]+)</) || "Criterio";
    const tipoCod = uno(b, /AwardingCriteriaTypeCode[^>]*>([^<]+)</);
    const sub = uno(b, /AwardingCriteriaSubTypeCode[^>]*>([^<]+)</);
    const tipo = tipoCod === "SUBJ" ? "juicio" : (sub === "1" || ES_PRECIO.test(nombre)) && !/mejora/i.test(nombre) ? "precio" : /mejora/i.test(nombre) ? "mejora" : "formula";
    return { nombre: nombre.replace(/\s+/g, " "), tipo, peso: num(uno(b, /<cbc:WeightNumeric>([^<]+)</)) };
  });
  const resultado = bloque(x, "cac:TenderResult");
  const parte = bloque(x, "cac:LocatedContractingParty") || bloque(x, "cac:ContractingParty");
  return {
    titulo: uno(proyecto, /<cbc:Name>([^<]+)</) || uno(x, /<title>([^<]+)</),
    expediente: uno(x, /<cbc:ContractFolderID>([^<]+)</),
    organo: uno(parte, /<cac:PartyName>\s*<cbc:Name>([^<]+)</),
    estado: uno(x, /ContractFolderStatusCode[^>]*>([^<]+)</),
    cpvs: [...new Set(todos(proyecto || x, /<cbc:ItemClassificationCode[^>]*>(\d{8})</g))],
    presupuesto: { sinIva: num(uno(presu, /<cbc:TaxExclusiveAmount[^>]*>([^<]+)</)), conIva: num(uno(presu, /<cbc:TotalAmount[^>]*>([^<]+)</)) },
    valorEstimado: num(uno(presu, /<cbc:EstimatedOverallContractAmount[^>]*>([^<]+)</)),
    duracion: dur ? { valor: Number(dur[2]), unidad: dur[1], meses: MESES[dur[1]] ? Math.round(Number(dur[2]) * MESES[dur[1]] * 10) / 10 : null } : null,
    prorroga: uno(x, /<cac:ContractExtension>[\s\S]*?<cbc:OptionsDescription>([^<]+)</),
    fechaLimite: uno(x, /<cac:TenderSubmissionDeadlinePeriod>[\s\S]*?<cbc:EndDate>([^<]+)</),
    lugar: uno(proyecto, /<cbc:CityName>([^<]+)</) || uno(proyecto, /<cbc:CountrySubentity>([^<]+)</),
    lotes: (x.match(/<cac:ProcurementProjectLot>/g) || []).length || null,
    criterios,
    documentos: [
      ...documentos(x, "cac:LegalDocumentReference").map(d => ({ ...d, tipo: "pcap" })),
      ...documentos(x, "cac:TechnicalDocumentReference").map(d => ({ ...d, tipo: "ppt" })),
      ...documentos(x, "cac:AdditionalDocumentReference").map(d => ({ ...d, tipo: "anexo" })),
    ],
    resultado: resultado ? {
      ofertas: num(uno(resultado, /<cbc:ReceivedTenderQuantity>([^<]+)</)),
      ofertaMin: num(uno(resultado, /<cbc:LowerTenderAmount[^>]*>([^<]+)</)),
      ofertaMax: num(uno(resultado, /<cbc:HigherTenderAmount[^>]*>([^<]+)</)),
      adjudicado: num(uno(resultado, /<cac:LegalMonetaryTotal>[\s\S]*?<cbc:TaxExclusiveAmount[^>]*>([^<]+)</)),
      ganador: uno(resultado, /<cac:WinningParty>[\s\S]*?<cac:PartyName>\s*<cbc:Name>([^<]+)</),
    } : null,
  };
}

/** Una página del canal ATOM → [{ id, enlace, actualizado, ...licitacionDeCodice }] y el enlace a la siguiente (más antigua) */
export function entradasDelCanal(atom) {
  const s = String(atom || "");
  const siguiente = (s.match(/<link href="([^"]+)" rel="next"\s*\/>/) || [])[1] || null;
  const entradas = s.split("<entry>").slice(1).map(e => ({
    id: uno(e, /<id>([^<]+)<\/id>/),
    enlace: uno(e, /<link href="([^"]+)"/),
    actualizado: uno(e, /<updated>([^<]+)<\/updated>/),
    tipoContrato: uno(e, /<cbc:TypeCode[^>]*ContractCode[^>]*>(\d+)</), // 2 = servicios
    ...licitacionDeCodice(e),
  }));
  return { entradas, siguiente };
}

/**
 * La página de detalle de una licitación (enlace «deeplink») → los documentos
 * publicados, cada uno con sus enlaces en HTML, XML y PDF.
 * @returns [{ nombre: «Anuncio de Licitación» | «Pliego» | …, fecha, html, xml, pdf }]
 */
export function documentosDeDetalle(html) {
  const s = String(html || "");
  const out = [];
  const re = /href="(https:\/\/contrataciondelestado\.es\/FileSystem\/servlet\/GetDocumentByIdServlet[^"]+)"/g;
  for (const m of s.matchAll(re)) {
    // lo que hay escrito justo antes del enlace: «19/08/2026 15:59:41 Anuncio de Licitación»
    const antes = dec(s.slice(Math.max(0, m.index - 700), m.index).replace(/<[^>]*$/, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    const f = antes.match(/(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2})\s+([^<>]{3,140}?)\s*$/);
    const url = dec(m[1]);
    const ultimo = out[out.length - 1];
    if (ultimo && (!f || (ultimo.nombre === f[2].trim() && ultimo.fecha === f[1]))) { ultimo.enlaces.push(url); continue; } // el 2.º y 3.er enlace del mismo documento (XML y PDF)
    if (!f) continue;
    out.push({ nombre: f[2].trim(), fecha: f[1], enlaces: [url] });
  }
  return out;
}
