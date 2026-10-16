// Bajas reales por tipo de contrato: recorre el canal de la Plataforma de
// Contratación, coge las licitaciones ADJUDICADAS de servicios de los sectores
// de Operanzia (sin lotes: con lotes, las cifras no se pueden comparar) y
// calcula, por familia de CPV, cuántas ofertas suele haber y cuánto bajan la
// ganadora y la oferta más baja respecto al presupuesto. Lo usa Alternativas
// para proponer la competencia. Uso:
//   node scripts/banco-pliegos/adjudicaciones.mjs [páginas=200] [salida=src/concursos/bajas-referencia.json]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { entradasDelCanal } from "../../api/_plataforma/codice.js";

const PAGINAS = Number(process.argv[2] || 200);
const SALIDA = process.argv[3] || new URL("../../src/concursos/bajas-referencia.json", import.meta.url);
const CRUDO = `${SALIDA}`.replace(/\.json$/, "") + ".crudo.json";
export const FAMILIAS = {
  9051: "Recogida de residuos", 9052: "Tratamiento de residuos", 9050: "Residuos (general)", 9061: "Limpieza viaria",
  9068: "Limpieza de playas", 9091: "Limpieza de edificios", 9092: "Limpieza e higienización", 6011: "Transporte en autobús",
  6013: "Transporte escolar y especial", 6017: "Alquiler de autobuses con conductor", 7731: "Jardinería", 9090: "Limpieza (general)",
};
const familia = cpvs => (cpvs || []).map(c => c.slice(0, 4)).find(c => FAMILIAS[c]) || null;
const pct = (n, d) => (d > 0 && n > 0 ? Math.round((1 - n / d) * 1000) / 10 : null);
const cuantil = (xs, q) => { const o = [...xs].sort((a, b) => a - b); if (!o.length) return null; const i = (o.length - 1) * q; const a = Math.floor(i); return Math.round((o[a] + (o[Math.ceil(i)] - o[a]) * (i - a)) * 10) / 10; };

const crudo = existsSync(CRUDO) ? JSON.parse(readFileSync(CRUDO, "utf8")) : { registros: [], siguiente: null };
const vistos = new Set(crudo.registros.map(r => r.id));
let url = process.argv.includes("--seguir") && crudo.siguiente ? crudo.siguiente : "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom";
for (let p = 0; p < PAGINAS && url; p++) {
  let atom;
  try { atom = await (await fetch(url)).text(); } catch (e) { console.log("fallo", e.message); break; }
  const { entradas, siguiente } = entradasDelCanal(atom);
  for (const e of entradas) {
    const fam = familia(e.cpvs);
    if (!fam || e.tipoContrato !== "2" || vistos.has(e.id) || (e.lotes || 0) > 1) continue;
    const r = e.resultado, pres = e.presupuesto?.sinIva;
    if (!r || !pres || !(r.adjudicado > 0 || r.ofertaMin > 0)) continue;
    const reg = { id: e.id, familia: fam, cpvs: e.cpvs, titulo: (e.titulo || "").slice(0, 120), organo: e.organo, presupuesto: pres, ofertas: r.ofertas, bajaGanadora: pct(r.adjudicado, pres), bajaMinima: pct(r.ofertaMin, pres), bajaMaxima: pct(r.ofertaMax, pres), fecha: (e.actualizado || "").slice(0, 10) };
    if (reg.bajaGanadora != null && (reg.bajaGanadora < -5 || reg.bajaGanadora > 70)) continue; // cifras raras
    crudo.registros.push(reg); vistos.add(e.id);
  }
  url = siguiente; crudo.siguiente = siguiente;
  if (p % 10 === 9) { writeFileSync(CRUDO, JSON.stringify(crudo)); console.log(`página ${p + 1}: ${crudo.registros.length} adjudicaciones`); }
}
writeFileSync(CRUDO, JSON.stringify(crudo));

// ── resumen por familia ──
const familias = {};
for (const [fam, nombre] of Object.entries(FAMILIAS)) {
  const todos = crudo.registros.filter(r => r.familia === fam);
  if (!todos.length) continue;
  const tramo = rs => {
    const g = rs.map(r => r.bajaGanadora).filter(x => x != null), o = rs.map(r => r.ofertas).filter(x => x > 0), m = rs.map(r => r.bajaMinima).filter(x => x != null);
    return { n: rs.length, ofertas: { mediana: cuantil(o, 0.5), p25: cuantil(o, 0.25), p75: cuantil(o, 0.75) }, bajaGanadora: { mediana: cuantil(g, 0.5), p25: cuantil(g, 0.25), p75: cuantil(g, 0.75) }, bajaMinima: { mediana: cuantil(m, 0.5), p75: cuantil(m, 0.75) } };
  };
  // por tamaño del contrato (presupuesto sin IVA): los grandes se comportan distinto
  familias[fam] = { nombre, ...tramo(todos), tramos: Object.fromEntries([["mas200k", 2e5], ["mas1M", 1e6]].map(([k, min]) => [k, todos.filter(r => r.presupuesto >= min)]).filter(([, rs]) => rs.length >= 3).map(([k, rs]) => [k, tramo(rs)])) };
}
const fechas = crudo.registros.map(r => r.fecha).filter(Boolean).sort();
writeFileSync(SALIDA, JSON.stringify({ generado: new Date().toISOString().slice(0, 10), desde: fechas[0] || null, hasta: fechas[fechas.length - 1] || null, total: crudo.registros.length, familias }, null, 1));
console.log("FIN", crudo.registros.length, "adjudicaciones;", Object.entries(familias).map(([f, x]) => `${f} ${x.nombre}: ${x.n} (baja ganadora mediana ${x.bajaGanadora.mediana} %, ${x.ofertas.mediana} ofertas)`).join(" | "));
