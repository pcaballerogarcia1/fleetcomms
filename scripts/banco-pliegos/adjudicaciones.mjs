// Bajas reales por tipo de contrato: recorre el canal de la Plataforma de
// Contratación, coge las licitaciones ADJUDICADAS de los sectores de Operanzia
// (servicios y, para contenedores y camiones, suministros; ver familias-cpv.js) (sin lotes: con lotes, las cifras no se pueden comparar) y
// calcula, por familia de CPV, cuántas ofertas suele haber y cuánto bajan la
// ganadora y la oferta más baja respecto al presupuesto. Lo usa Alternativas
// para proponer la competencia. Uso:
//   node scripts/banco-pliegos/adjudicaciones.mjs [páginas=200] [salida=src/concursos/bajas-referencia.json]
//   node scripts/banco-pliegos/adjudicaciones.mjs --meses 202510-202609 [--cache <carpeta>] [salida]
//     (un año entero: baja los archivos mensuales de la Plataforma, unos 70 MB cada uno)
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, renameSync, createWriteStream } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { entradasDelCanal } from "../../api/_plataforma/codice.js";
import { FAMILIAS_CPV, familiaDeCpv } from "../../src/concursos/familias-cpv.js";

const opcion = n => { const i = process.argv.indexOf(n); if (i < 0) return null; const v = process.argv[i + 1]; process.argv.splice(i, 2); return v; };
const MESES = opcion("--meses");
const CACHE = opcion("--cache") || "banco-adjudicaciones";
const PAGINAS = MESES ? 0 : Number(process.argv[2] || 200);
const SALIDA = (MESES ? process.argv[2] : process.argv[3]) || new URL("../../src/concursos/bajas-referencia.json", import.meta.url);
const CRUDO = `${SALIDA}`.replace(/\.json$/, "") + ".crudo.json";
// la familia de cada contrato: la misma tabla que usa la app
const familia = e => familiaDeCpv(e.cpvs, { titulo: e.titulo || "", tipo: e.tipoContrato || "?" })?.clave || null;
const pct = (n, d) => (d > 0 && n > 0 ? Math.round((1 - n / d) * 1000) / 10 : null);
const cuantil = (xs, q) => { const o = [...xs].sort((a, b) => a - b); if (!o.length) return null; const i = (o.length - 1) * q; const a = Math.floor(i); return Math.round((o[a] + (o[Math.ceil(i)] - o[a]) * (i - a)) * 10) / 10; };

const crudo = existsSync(CRUDO) ? JSON.parse(readFileSync(CRUDO, "utf8")) : { registros: [], siguiente: null };
// una licitación sale muchas veces (cada vez que cambia): se queda la versión más reciente
const porId = new Map(crudo.registros.map(r => [r.id, r]));
function anotar(e) {
  const fam = familia(e);
  if (!fam || (e.lotes || 0) > 1) return;
  const r = e.resultado, pres = e.presupuesto?.sinIva;
  if (!r || !pres || !(r.adjudicado > 0 || r.ofertaMin > 0)) return;
  const reg = { id: e.id, familia: fam, cpvs: e.cpvs, titulo: (e.titulo || "").slice(0, 120), organo: e.organo, lugar: e.lugar || null, presupuesto: pres, ofertas: r.ofertas, bajaGanadora: pct(r.adjudicado, pres), bajaMinima: (b => (b != null && b > 90 ? null : b))(pct(r.ofertaMin, pres)), bajaMaxima: pct(r.ofertaMax, pres), ganador: r.ganador || null, fecha: (e.actualizado || "").slice(0, 10) };
  if (reg.bajaGanadora != null && (reg.bajaGanadora < -5 || reg.bajaGanadora > 70)) return; // cifras raras
  // copia limpia: los textos sacados con regex retienen el .atom entero en memoria
  const limpio = JSON.parse(JSON.stringify(reg));
  const antes = porId.get(e.id);
  if (!antes || (antes.fecha || "") <= limpio.fecha) porId.set(limpio.id, limpio);
}
const guardarCrudo = () => { crudo.registros = [...porId.values()]; writeFileSync(CRUDO, JSON.stringify(crudo)); };

let url = process.argv.includes("--seguir") && crudo.siguiente ? crudo.siguiente : "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom";
for (let p = 0; p < PAGINAS && url; p++) {
  let atom;
  try { atom = await (await fetch(url)).text(); } catch (e) { console.log("fallo", e.message); break; }
  const { entradas, siguiente } = entradasDelCanal(atom);
  entradas.forEach(anotar);
  url = siguiente; crudo.siguiente = siguiente;
  if (p % 10 === 9) { guardarCrudo(); console.log(`página ${p + 1}: ${porId.size} adjudicaciones`); }
}

// archivos mensuales: licitacionesPerfilesContratanteCompleto3_AAAAMM.zip (un montón de .atom dentro)
if (MESES) {
  const [a, b] = MESES.split("-");
  const meses = [];
  for (let y = +a.slice(0, 4), m = +a.slice(4); y * 100 + m <= +(b || a); m === 12 ? (y++, m = 1) : m++) meses.push(`${y}${String(m).padStart(2, "0")}`);
  mkdirSync(CACHE, { recursive: true });
  for (const mes of meses) {
    const zip = join(CACHE, `${mes}.zip`), dir = join(CACHE, mes);
    if (!existsSync(zip)) {
      console.log(`bajando ${mes}…`);
      const r = await fetch(`https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3_${mes}.zip`);
      if (!r.ok) { console.log(`  ${mes}: la Plataforma respondió ${r.status}`); continue; }
      await pipeline(Readable.fromWeb(r.body), createWriteStream(`${zip}.parte`));
      renameSync(`${zip}.parte`, zip);
    }
    rmSync(dir, { recursive: true, force: true });
    execFileSync("unzip", ["-q", "-o", zip, "-d", dir]);
    const atoms = readdirSync(dir, { recursive: true }).filter(f => String(f).endsWith(".atom"));
    for (const f of atoms) entradasDelCanal(readFileSync(join(dir, String(f)), "utf8")).entradas.forEach(anotar);
    rmSync(dir, { recursive: true, force: true });
    guardarCrudo();
    console.log(`  ${mes}: ${atoms.length} archivos, ${porId.size} adjudicaciones en total`);
  }
}
guardarCrudo();

// ── resumen por familia ──
// «FCC MEDIO AMBIENTE, S.A.U.» → «FCC Medio Ambiente»
const SIGLAS = /^(FCC|UTE|SA|SL|ISS|STV|OHL|EULEN|CLECE|TBF|ADDA|SRCL|CEE|GD)$/;
const empresa = g => String(g).replace(/[.,]/g, " ").replace(/\s+(S\s?R\s?L|S\s?A\s?U|S\s?L\s?U|S\s?A|S\s?L|S\s?COOP\s?\w*)\s*$/i, "").replace(/\s+/g, " ").trim()
  .split(" ").map(p => (SIGLAS.test(p.toUpperCase()) || p.length <= 2 && p === p.toUpperCase() && !/^(DE|LA|EL|Y|DEL|LOS|LAS)$/.test(p) ? p.toUpperCase() : /^(DE|LA|EL|Y|DEL|LOS|LAS)$/i.test(p) ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())).join(" ");
const familias = {};
for (const { clave: fam, nombre } of FAMILIAS_CPV) {
  const todos = crudo.registros.filter(r => r.familia === fam);
  if (!todos.length) continue;
  const tramo = rs => {
    const g = rs.map(r => r.bajaGanadora).filter(x => x != null), o = rs.map(r => r.ofertas).filter(x => x > 0), m = rs.map(r => r.bajaMinima).filter(x => x != null && x <= 90);
    const unaSola = o.length ? Math.round((100 * o.filter(x => x === 1).length) / o.length) : null;
    return { n: rs.length, ofertas: { mediana: cuantil(o, 0.5), p25: cuantil(o, 0.25), p75: cuantil(o, 0.75) }, unaSola, bajaGanadora: { mediana: cuantil(g, 0.5), p25: cuantil(g, 0.25), p75: cuantil(g, 0.75) }, bajaMinima: { mediana: cuantil(m, 0.5), p75: cuantil(m, 0.75) } };
  };
  // quién se lleva el dinero (contratos de más de 200.000 €): cuota sobre el importe licitado
  const g = {}; let total = 0;
  for (const r of todos.filter(r => r.presupuesto >= 2e5 && r.ganador)) { const k = empresa(r.ganador); (g[k] ||= { nombre: k, contratos: 0, importe: 0 }); g[k].contratos++; g[k].importe += r.presupuesto; total += r.presupuesto; }
  const ganadores = Object.values(g).filter(x => !/^UTE$/.test(x.nombre)).sort((a, b) => b.importe - a.importe).slice(0, 6).map(x => ({ nombre: x.nombre, contratos: x.contratos, cuotaPct: Math.round((100 * x.importe) / total) }));
  // por tamaño del contrato (presupuesto sin IVA): los grandes se comportan distinto
  familias[fam] = { nombre, ...tramo(todos), ganadores, tramos: Object.fromEntries([["mas200k", 2e5], ["mas1M", 1e6]].map(([k, min]) => [k, todos.filter(r => r.presupuesto >= min)]).filter(([, rs]) => rs.length >= 3).map(([k, rs]) => [k, tramo(rs)])) };
}
const fechas = crudo.registros.map(r => r.fecha).filter(Boolean).sort();
// unas pocas fichas antiguas que se tocaron dentro del periodo: no cuentan para la fecha de inicio
writeFileSync(SALIDA, JSON.stringify({ generado: new Date().toISOString().slice(0, 10), desde: fechas[Math.floor(fechas.length * 0.01)] || null, hasta: fechas[fechas.length - 1] || null, total: crudo.registros.length, familias }, null, 1));
console.log("FIN", crudo.registros.length, "adjudicaciones;", Object.entries(familias).map(([f, x]) => `${f} ${x.nombre}: ${x.n} (baja ganadora mediana ${x.bajaGanadora.mediana} %, ${x.ofertas.mediana} ofertas)`).join(" | "));
