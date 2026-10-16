// Recorre el canal ATOM de la Plataforma de Contratación y guarda las licitaciones
// de servicios de residuos, limpieza y autobuses con sus datos declarados y sus pliegos.
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
const DIR = process.argv[2];
const MAX_PAG = Number(process.argv[3] || 120), OBJ = Number(process.argv[4] || 45);
const CPV = new RegExp(process.env.CPV || "^(9051|9052|9061|9062|9063|9091|9068|9060|6011|6013|6017|6014|9050|7731)");
const dec = t => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
const uno = (e, re) => { const m = e.match(re); return m ? dec(m[1]).trim() : null; };
const todos = (e, re) => [...e.matchAll(re)].map(m => dec(m[1]).trim());
let url = process.env.DESDE || "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom";
mkdirSync(DIR, { recursive: true });
const salida = existsSync(`${DIR}/indice.json`) ? JSON.parse(readFileSync(`${DIR}/indice.json`, "utf8")) : [];
const vistos = new Set(salida.map(x => x.id));
for (let pag = 0; pag < MAX_PAG && (salida.length < OBJ || salida.some(z => !z.adicionales)) && url; pag++) {
  let xml;
  try { xml = Buffer.from(await (await fetch(url)).arrayBuffer()).toString("utf8"); } catch (e) { console.log("fallo", url, e.message); break; }
  url = (xml.match(/<link href="([^"]+)" rel="next"\/>/) || [])[1] || null;
  for (const e of xml.split("<entry>").slice(1)) {
    const cpvs = todos(e, /<cbc:ItemClassificationCode[^>]*>(\d{8})</g);
    if (!cpvs.some(c => CPV.test(c))) continue;
    if (uno(e, /<cbc:TypeCode[^>]*ContractCode[^>]*>(\d+)</) !== "2") continue; // servicios
    const id = uno(e, /<id>([^<]+)<\/id>/);
    const adicionales = [...e.matchAll(/<cac:AdditionalDocumentReference>\s*<cbc:ID>([^<]+)<\/cbc:ID>[\s\S]*?<cbc:URI>([^<]+)<\/cbc:URI>/g)].map(m => ({ nombre: dec(m[1]), uri: dec(m[2]) }));
    if (vistos.has(id)) { const y = salida.find(z => z.id === id); if (y && !y.adicionales) y.adicionales = adicionales; continue; }
    const legal = uno(e, /<cac:LegalDocumentReference>[\s\S]*?<cbc:URI>([^<]+)<\/cbc:URI>/);
    const tecnico = uno(e, /<cac:TechnicalDocumentReference>[\s\S]*?<cbc:URI>([^<]+)<\/cbc:URI>/);
    if (!legal || !tecnico) continue;
    const criterios = [...e.matchAll(/<cac:AwardingCriteria>([\s\S]*?)<\/cac:AwardingCriteria>/g)].map(m => ({
      tipo: uno(m[1], /AwardingCriteriaTypeCode[^>]*>([^<]+)</), nombre: uno(m[1], /<cbc:Description>([^<]+)</), sub: uno(m[1], /AwardingCriteriaSubTypeCode[^>]*>([^<]+)</), peso: Number(uno(m[1], /<cbc:WeightNumeric>([^<]+)</)) || null,
    }));
    const dur = e.match(/<cac:PlannedPeriod>[\s\S]*?<cbc:DurationMeasure unitCode="(\w+)">([\d.]+)</);
    const x = {
      id, titulo: uno(e, /<title>([^<]+)<\/title>/), expediente: uno(e, /<cbc:ContractFolderID>([^<]+)</), estado: uno(e, /ContractFolderStatusCode[^>]*>([^<]+)</),
      organo: uno(e, /<cac:PartyName>\s*<cbc:Name>([^<]+)</), cpvs,
      vec: Number(uno(e, /<cbc:EstimatedOverallContractAmount[^>]*>([^<]+)</)) || null,
      pblConIva: Number(uno(e, /<cac:BudgetAmount>[\s\S]*?<cbc:TotalAmount[^>]*>([^<]+)</)) || null,
      pblSinIva: Number(uno(e, /<cac:BudgetAmount>[\s\S]*?<cbc:TaxExclusiveAmount[^>]*>([^<]+)</)) || null,
      duracion: dur ? { unidad: dur[1], valor: Number(dur[2]) } : null,
      prorroga: uno(e, /<cac:ContractExtension>[\s\S]*?<cbc:OptionsDescription>([^<]+)</),
      criterios, ofertas: Number(uno(e, /<cbc:ReceivedTenderQuantity>([^<]+)</)) || null,
      ofertaMin: Number(uno(e, /<cbc:LowerTenderAmount[^>]*>([^<]+)</)) || null, ofertaMax: Number(uno(e, /<cbc:HigherTenderAmount[^>]*>([^<]+)</)) || null,
      docs: { pcap: legal, ppt: tecnico }, adicionales,
    };
    salida.push(x); vistos.add(id);
    console.log(salida.length, x.cpvs[0], x.titulo.slice(0, 80));
  }
  writeFileSync(`${DIR}/indice.json`, JSON.stringify(salida, null, 1));
}
console.log("FIN", salida.length, "siguiente", url);
