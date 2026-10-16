// Lector de pliegos (sin IA, en el navegador): del texto de cada página de un
// pliego de prescripciones técnicas (o de cláusulas administrativas) saca lo
// que importa para calcular la oferta, siempre con la página y la frase de
// donde lo ha sacado, para poder comprobarlo:
//  · objeto, duración y prórrogas, presupuesto base y valor estimado;
//  · el servicio: fracciones de residuos, servicios de limpieza o, en
//    autobuses, líneas, expediciones, km y horas;
//  · contenedores, vehículos, habitantes, personal (subrogación, convenio),
//    horarios, frecuencias y exigencias ambientales;
//  · los requisitos más claros («deberá…», «como mínimo…») y un índice.
// Igual que el lector de convenios: si algo no lo encuentra, no se inventa.
// Sin React ni Firebase.

import { criteriosDelPliego } from "./criterios.js";
import { estudioDeCostes } from "./estudio.js";
import { personalExigido, serviciosPorFrecuencia, serviciosPorMediciones, textoPersonal } from "./tecnico.js";

// Versión del lector: si sube, los pliegos ya guardados se vuelven a leer al abrirlos
export const VERSION_LECTOR = 9;

const NUM_LETRA = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  "dieciséis": 16, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, "veintidós": 22, veintidos: 22, "veintitrés": 23, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, "veintiséis": 26, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  // gallego, catalán y valenciano (pliegos de Galicia, Cataluña y la Comunidad Valenciana)
  "un ano": 1, "dous": 2, "tres anos": 3, "dotze": 12, "vint-i-quatre": 24, "quatre": 4, "cinc": 5,
};
// «treinta y seis», «cuarenta y ocho»: decenas + unidades
const DECENAS = "treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa";
const UNIDADES = "uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve";
const LETRAS = `(?:${DECENAS})\\s+y\\s+(?:${UNIDADES})|${Object.keys(NUM_LETRA).filter(k => !k.includes(" ")).sort((a, b) => b.length - a.length).join("|")}`;

/** «1.234.567,89» → 1234567.89 */
export function numeroEs(txt) {
  const t = String(txt).trim().replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^\d+,\d+$/.test(t)) return Number(t.replace(",", "."));
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, "")); // formato inglés
  return Number(t.replace(",", "."));
}
const enteroDe = s => {
  if (s == null) return null;
  if (/^\d/.test(s)) return numeroEs(String(s).replace(/\s/g, ""));
  const t = s.toLowerCase().replace(/\s+/g, " ").trim();
  const c = t.match(/^(\w+) y (\w+)$/);
  if (c && NUM_LETRA[c[1]] && NUM_LETRA[c[2]]) return NUM_LETRA[c[1]] + NUM_LETRA[c[2]];
  return NUM_LETRA[t] ?? null;
};

// Texto limpio de una página (sin cortes de palabra al final de línea)
// («S.A.» → «SA»: si no, el punto de la abreviatura corta la frase)
const limpia = t => String(t || "").replace(/\b([A-Z])\.([A-Z])\.(?=[\s,;])/g, "$1$2").replace(/-\n(?=[a-záéíóúñ])/g, "").replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ");
const sinAcentos = t => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** La frase alrededor de una posición (para enseñar de dónde sale cada dato) */
function fraseEn(texto, i, largo = 0) {
  const ini = Math.max(texto.lastIndexOf(". ", i) + 2, i - 220, 0);
  let fin = texto.indexOf(". ", i + largo);
  if (fin < 0 || fin - i > 260) fin = Math.min(texto.length, i + largo + 220);
  return texto.slice(ini, fin + 1).trim();
}

/** Primera coincidencia de una expresión en las páginas: { m, pagina, frase } */
function buscar(paginas, re) {
  for (let p = 0; p < paginas.length; p++) {
    re.lastIndex = 0;
    const m = re.exec(paginas[p]);
    if (m) return { m, pagina: p + 1, frase: fraseEn(paginas[p], m.index, m[0].length) };
  }
  return null;
}
/** Todas las coincidencias: [{ m, pagina, frase }] */
function buscarTodas(paginas, re, max = 50) {
  const out = [];
  for (let p = 0; p < paginas.length && out.length < max; p++) {
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m;
    while ((m = r.exec(paginas[p])) && out.length < max) out.push({ m, pagina: p + 1, frase: fraseEn(paginas[p], m.index, m[0].length) });
  }
  return out;
}

// donde se corta un texto del anuncio (empieza el siguiente campo)
const corta = t => t.split(/\s(?:Descripci[oó]n del|Valor estimado|Presupuesto base|Clasificaci[oó]n CPV|Lugar de ejecuci[oó]n|Plazo de ejecuci[oó]n)/i)[0].trim();
// quita lo que arrastra de una tabla o de la cabecera antes de la frase
const sinArrastre = t => t.replace(/^[^a-záéíóúñ•]*?(?=(?:• )?[A-ZÁÉÍÓÚÑ][a-záéíóúñ])/, "").trim();

const IMPORTE = String.raw`(\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)\s*(?:€|euros|eur\b)`;

// Qué servicio es, por las palabras que más se repiten
const TIPOS = {
  residuos: /recogida|residuo|contenedor|fracci[oó]n|vertedero|planta de tratamiento|punto limpio/gi,
  limpieza: /limpieza viaria|barrido|baldeo|fregado|papeleras|limpieza de (?:calles|v[ií]as)/gi,
  autobuses: /autob[uú]s|autobuses|l[ií]neas? de|expedici[oó]n|parada|viajeros|cochera/gi,
};

const FRACCIONES = [
  ["Resto", /fracci[oó]n resto|\bresto\b(?= |,)|rechazo/i],
  ["Envases ligeros", /envases ligeros|envases\b/i],
  ["Papel y cartón", /papel[- ]y[- ]cart[oó]n|papel-cart[oó]n/i],
  ["Vidrio", /\bvidrio\b/i],
  ["Orgánica / biorresiduo", /org[aá]nica|biorresiduo|bio-residuo/i],
  ["Voluminosos / enseres", /voluminosos|enseres/i],
  ["Textil", /textil|ropa usada/i],
  ["Aceite", /aceite (?:dom[eé]stico|vegetal|usado)/i],
  ["Poda", /\bpoda\b|restos vegetales/i],
  ["Puntos limpios", /punto limpio|puntos limpios/i],
];
const SERVICIOS_LIMPIEZA = [
  ["Barrido manual", /barrido manual/i], ["Barrido mecánico", /barrido mec[aá]nico/i], ["Barrido mixto", /barrido mixto/i],
  ["Baldeo", /baldeo/i], ["Fregado", /fregado/i], ["Papeleras", /papeleras/i], ["Limpieza de pintadas", /pintadas|grafitis/i],
  ["Limpieza de mercados / eventos", /mercadillos?|eventos|fiestas/i],
];
const AMBIENTAL = [
  ["Vehículos eléctricos", /el[eé]ctric[oa]s?\b/i], ["Gas natural (GNC/GNL)", /\bGNC\b|\bGNL\b|gas natural/i], ["Híbridos", /h[ií]brid[oa]s?/i],
  ["Cero emisiones", /cero emisiones|etiqueta 0|etiqueta cero/i], ["Euro VI", /euro\s?(?:vi|6)\b/i],
];

/**
 * Lee un pliego.
 * @param paginas [texto de cada página] (textoDelPdf)
 * listas.frecuencias: [{ texto, pagina }] — cada frecuencia con lo que se hace («Frecuencia mensual para contenedores de RSU…»)
 * @returns { tipo, clase ("anuncio" | "tecnico" | "administrativo" | null), datos: [{ id, nombre, valor, pagina, frase }], listas: { fracciones, limpieza, ambiental },
 *            requisitos: [{ texto, pagina }], indice: [{ titulo, pagina }],
 *            tablas: [{ titulo, pagina, cabecera, filas: [{ grupo, concepto, valores }] }], paginas, conTexto }
 */
export function leerPliego(paginasCrudas) {
  const paginas = (paginasCrudas || []).map(limpia);
  const conTexto = paginas.reduce((s, p) => s + p.replace(/\s/g, "").length, 0) > 200 * Math.max(1, paginas.length) * 0.05;
  const datos = [];
  const poner = (id, nombre, r, valor) => { if (r && valor != null && valor !== "") datos.push({ id, nombre, valor, pagina: r.pagina, frase: r.frase }); };

  // ── qué servicio ──
  const cuenta = Object.fromEntries(Object.entries(TIPOS).map(([k, re]) => [k, paginas.reduce((s, p) => s + (p.match(re) || []).length, 0)]));
  const tipo = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0];

  // ── qué documento es ──
  const todo = paginas.join(" ");
  const clase = /plataforma de contrataci[oó]n|documento de pliegos|clasificaci[oó]n cpv/i.test(todo) && paginas.length < 20 ? "anuncio"
    : /^[\s\S]{0,1500}pliego de cl[aá]usulas administrativas/i.test(todo) ? "administrativo"
    : /^[\s\S]{0,1500}(?:pliego de (?:prescripciones|condiciones) t[eé]cnicas)/i.test(todo) ? "tecnico"
    : /prescripciones t[eé]cnicas/i.test(todo) ? "tecnico" : /cl[aá]usulas administrativas/i.test(todo) ? "administrativo" : null;

  // ── ficha del anuncio / expediente ──
  const expd = buscar(paginas, /(?:n[uú]mero de expediente|exp(?:te|ediente)?\.?)\s*(?:n[ºo°.]*\s*)?:?\s*([A-Z][A-Z0-9 .-]{0,15}?\d{1,6}\/\d{2,4}|\d[\d.-]{2,20})/i);
  if (expd) poner("expediente", "Expediente", expd, expd.m[1].trim());
  const ent = buscar(paginas, /entidad adjudicadora\s+(.{5,200}?)\s+(?:tipo de administraci|actividad principal|sitio web|direcci[oó]n)/i);
  if (ent) poner("organismo", "Entidad adjudicadora", ent, ent.m[1].trim());
  const plazoOf = buscar(paginas, /plazo de presentaci[oó]n de (?:la )?ofertas?[^0-9]{0,30}(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (plazoOf) poner("fechaLimite", "Fecha límite de presentación", plazoOf, `${plazoOf.m[3]}-${plazoOf.m[2].padStart(2, "0")}-${plazoOf.m[1].padStart(2, "0")}`);
  const nLotes = buscar(paginas, /n[ºo°.]*\s*de lotes\s*:?\s*(\d{1,2})/i);
  if (nLotes) poner("lotes", "Número de lotes", nLotes, Number(nLotes.m[1]));
  const cpv = buscar(paginas, /\b(\d{8})\s*-\s*([^.\n]{5,90})/);
  if (cpv && /cpv/i.test(todo)) poner("cpv", "CPV", cpv, `${cpv.m[1]} · ${cpv.m[2].trim()}`);
  const proc = buscar(paginas, /procedimiento (abierto(?: simplificado)?|restringido|negociado(?: sin publicidad)?)/i);
  if (proc) poner("procedimiento", "Procedimiento", proc, `Procedimiento ${proc.m[1].toLowerCase()}`);
  const sinIva = buscar(paginas, new RegExp(String.raw`importe \(sin impuestos\)\s*${IMPORTE}`, "i"));
  if (sinIva) poner("importeSinIva", "Importe sin impuestos", sinIva, numeroEs(sinIva.m[1]));
  const conIva = buscar(paginas, new RegExp(String.raw`importe\s+${IMPORTE}`, "i"));
  if (conIva) poner("importeConIva", "Importe con impuestos", conIva, numeroEs(conIva.m[1]));

  // ── lotes descritos ──
  const lotesTxt = buscarTodas(paginas, /lote\s*(\d{1,2})\s*[.:\-–]+\s*([A-ZÁÉÍÓÚÑa-záéíóúñ][^.•]{8,140})/i, 12);
  const vistosLote = new Set();
  for (const l of lotesTxt) { if (vistosLote.has(l.m[1])) continue; vistosLote.add(l.m[1]); poner(`lote${l.m[1]}`, `Lote ${l.m[1]}`, l, corta(l.m[2])); }

  // ── objeto ──
  // (no el del índice del PDF, que va en mayúsculas)
  const mayusculas = t => { const l = t.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, ""); return l.replace(/[^A-ZÁÉÍÓÚÑ]/g, "").length / Math.max(1, l.length); };
  const obj = buscarTodas(paginas, /(?:tiene por objeto|objeto del (?:presente )?(?:contrato|pliego)(?: es| ser[aá])?)\s*[:,]?\s*(?:la |el |regular |definir )?([^.]{15,500})/i, 20).find(o => mayusculas(o.m[1]) < 0.5);
  const objetoLimpio = t => { const x = corta(t.replace(/^[:,\s]+/, "").replace(/^(?:el )?objeto del (?:presente )?(?:contrato|pliego) (?:es|ser[aá])\s+(?:el |la )?/i, "")); return x.charAt(0).toUpperCase() + x.slice(1); };
  poner("objeto", "Objeto del contrato", obj, obj && objetoLimpio(obj.m[1]));

  // ── duración y prórrogas ──
  // Todas las frases candidatas, puntuadas por su contexto: «se establece un
  // plazo de duración del contrato de diez (10) años» vale; «cuando su duración
  // no sea superior a cuatro años» (el órgano de contratación) o «tendrán un
  // plazo máximo de duración de cinco años» (la ley, en general) no.
  const DUR = new RegExp(String.raw`(?:duraci[oó]n|vigencia|plazo de ejecuci[oó]n|plazo de (?:la )?prestaci[oó]n|plazo total|per[ií]odo de ejecuci[oó]n|durada|duraci[oó]n inicial|prazo de execuci[oó]n)[^.]{0,140}?(?:\b|\()((?:\d\s?)?\d{1,2}|${LETRAS})\s*(?:\((\d{1,3})\)\s*)?(a[nñ]os?|anos?|anys?|mes(?:es|\(es\))?|meses|d[ií]as(?: naturales)?)\b`, "i");
  const notaDuracion = c => {
    // el entorno cercano de la cifra (las frases de los PDF a veces no se separan bien)
    const pag = paginas[c.pagina - 1], ini = c.m.index, fin = c.m.index + c.m[0].length;
    const f = sinAcentos(pag.slice(Math.max(0, ini - 45), fin + 45));
    const entre = sinAcentos(c.m[0].slice(0, c.m[0].indexOf(c.m[1])));
    let nota = 0;
    if (/duracion del (presente )?contrato|plazo de duracion|vigencia del contrato|plazo de ejecucion|duracion inicial|plazo de (la )?prestacion|periodo de ejecucion|plazo total de ejecucion|durada del contracte|prazo de execucion/.test(f)) nota += 4;
    if (/sera de|es de|tendra una duracion|se establece|queda fijad|se fija|\bde duracion\b|:\s*$|: \S/.test(f)) nota += 2;
    if (c.pagina <= 12) nota += 2;
    if (/^\s*(?:\d+[.)]|[a-z]\))?\s*(?:plazo|duracion)/.test(f)) nota += 1;
    // lo que NO es la duración del contrato
    if (/preaviso|inferior a|superior a|no sea superior|no podra (?:ser )?superior|no excedera|excedera|maximo|maxima|antelacion|confidencial|sigilo|conocimiento de esa informacion|garantia|prorrogas? incluidas|incluidas? (?:las|sus|la) (?:posibles |eventuales )?prorrogas|acuerdo marco|presentacion de (?:ofertas|proposiciones)|subsanacion|recurso|abono|pago|factura|desde la (?:recepcion|solicitud|notificacion)|requerimiento|organo de contratacion|articulo 29|art\. 29|cuando (su|la) duracion|recursos ordinarios|plurianual|vida util|antiguedad|amortiz|demora|penalidad|interrupci|suspensi|colectivos|desemplead|inscrit|parado|experiencia|en los ultimos|ultimos tres|ultimos cinco|ejercicios|de antelacion|con anterioridad|excepcionalmente|podra establecer|como maximo|hasta un maximo|plazo maximo/.test(f)) nota -= 8;
    // la cifra de la prórroga no es la de la duración: «36 meses, prorrogables 24»
    if (/prorrog/.test(entre)) nota -= 4;
    if (/^d/i.test(c.m[3])) nota -= 1;
    return nota;
  };
  const durs = buscarTodas(paginas, DUR, 400).map(c => ({ ...c, nota: notaDuracion(c) })).filter(c => c.nota > 0).sort((x, y) => y.nota - x.nota || x.pagina - y.pagina);
  const dur = durs[0];
  if (dur) {
    let n = enteroDe(dur.m[2] || dur.m[1]);
    let unidad = /^(a[nñ]|an)/i.test(dur.m[3]) ? "años" : /^mes/i.test(dur.m[3]) ? "meses" : "días";
    if (unidad === "días" && n >= 28) { n = Math.round(n / 30); unidad = "meses"; }
    if (n === 1) unidad = unidad === "años" ? "año" : unidad === "meses" ? "mes" : "día";
    poner("duracion", "Duración", dur, n ? `${n} ${unidad}` : null);
  }
  const sinProrroga = buscar(paginas, /no (?:siendo|ser[aá]|es) susceptible de pr[oó]rroga|sin (?:posibilidad de )?pr[oó]rrogas?|no (?:se prev[eé]n?|habr[aá]|cabe|podr[aá]n?) (?:ninguna )?pr[oó]rroga|no podr[aá] (?:ser )?prorrogad/i);
  if (sinProrroga) poner("prorroga", "Prórrogas", sinProrroga, "Sin prórroga");
  else {
    const pro = buscarTodas(paginas, new RegExp(String.raw`pr[oó]rrogas?[^.]{0,120}?\b(\d{1,2}|${LETRAS})\s*(?:\((\d{1,2})\)\s*)?(a[nñ]os?|mes(?:es|\(es\))?|anualidad(?:es)?)`, "i"), 20)
      .find(c => !/plazo m[aá]ximo|no sea superior|art[ií]culo 29|desde la (?:adjudicaci|firma|formalizaci)|plazo de (?:\d|dos|tres)/i.test(c.frase));
    if (pro) {
      const n = enteroDe(pro.m[2] || pro.m[1]);
      const u = /^a[nñ]/i.test(pro.m[3]) ? (n === 1 ? "año" : "años") : /^mes/i.test(pro.m[3]) ? (n === 1 ? "mes" : "meses") : (n === 1 ? "anualidad" : "anualidades");
      poner("prorroga", "Prórrogas", pro, n ? `${n} ${u}` : null);
    }
  }

  // ── dinero ──
  // Las cifras de dinero tras «presupuesto base de licitación» o «valor estimado»,
  // puntuadas por su entorno: fuera los umbrales de la ley («si el valor estimado
  // es inferior a 35.000 €…»); en un desglose («presupuesto 231.812 + prórroga
  // 231.812 = 463.624»), el total.
  const cifrasTras = (clave, largo = 260, otro = null) => {
    const out = [];
    paginas.forEach((pag, i) => {
      for (const k of pag.matchAll(new RegExp(clave, "gi"))) {
        const tramo = pag.slice(k.index, k.index + largo);
        for (const m of tramo.matchAll(new RegExp(IMPORTE, "gi"))) {
          const pos = k.index + m.index;
          // entre la palabra clave y la cifra no puede empezar otro concepto («… y el valor estimado es de X»)
          if (otro && new RegExp(otro, "i").test(pag.slice(k.index + k[0].length, pos))) continue;
          out.push({ valor: numeroEs(m[1]), pagina: i + 1, pos, antes: sinAcentos(pag.slice(Math.max(0, pos - 70), pos)), despues: sinAcentos(pag.slice(pos, pos + 60)), frase: fraseEn(pag, pos, m[0].length), dist: m.index, m });
        }
      }
    });
    return out;
  };
  const UMBRAL = /inferior(?:es)? a|superior(?:es)? a|igual(?:es)? o superior|igual o inferior|no (?:supere|exceda|sea superior)|umbral|cuando (?:el|su) (?:valor|importe|presupuesto)|menor(?:es)? de|mayor(?:es)? de|sujeto a regulacion|contratos? menor|hasta (?:un maximo de )?$|limite de|cuantia (?:minima|maxima)|solvencia|volumen (?:anual )?de negocio|facturacion|seguro|poliza|garantia|aval|penalidad|multa/;
  const notaDinero = c => {
    let n = 0;
    if (UMBRAL.test(c.antes.slice(-55))) n -= 10;
    if (/total|asciende|es de|sera de|importe de|cifra en|cantidad de|:\s*$|=\s*$/.test(c.antes.slice(-35))) n += 3;
    if (c.pagina <= 12) n += 2;
    n -= c.dist / 200; // cuanto más cerca de la palabra clave, mejor
    return n;
  };
  const elegir = (cands, total) => {
    const buenos = cands.map(c => ({ ...c, nota: notaDinero(c) })).filter(c => c.nota > -5 && c.valor >= 100);
    if (!buenos.length) return null;
    const mejor = Math.max(...buenos.map(c => c.nota));
    const top = buenos.filter(c => c.nota >= mejor - 0.75);
    // en un desglose del valor estimado, el total es la cifra mayor de las más cercanas
    return total ? top.sort((a, b) => b.valor - a.valor)[0] : top.sort((a, b) => b.nota - a.nota || a.pagina - b.pagina)[0];
  };
  const pbl = elegir(cifrasTras(String.raw`presupuesto base de licitaci[oó]n|presupuesto (?:base )?de (?:la )?licitaci[oó]n|presupuesto m[aá]ximo de licitaci[oó]n|pressupost base de licitaci[oó]|orzamento base de licitaci[oó]n`, 260, String.raw`valor estimado|valor estimat|anualidad|lote\s*\d|importe del lote`), false);
  if (pbl) poner("presupuesto", /iva (?:excluido|no incluido)|sin iva|excluido el iva|iva excluido/.test(pbl.despues + pbl.antes) ? "Presupuesto base de licitación (sin IVA)" : "Presupuesto base de licitación", pbl, pbl.valor);
  const ve = elegir(cifrasTras(String.raw`valor estimado(?: del contrato)?|valor estimat|valor estimado total`, 260, String.raw`presupuesto base de licitaci|cr[eé]dito|anualidad`), true);
  if (ve) poner("valorEstimado", "Valor estimado del contrato", ve, ve.valor);
  // (no el «importe anual de facturación» de la solvencia ni el «volumen anual de negocios»)
  const anual = buscarTodas(paginas, new RegExp(String.raw`(?:importe|presupuesto|precio)\s+anual[^.€]{0,120}?${IMPORTE}`, "i"), 20)
    .find(c => !/facturaci|volumen (?:anual )?de negocio|solvencia|seguro|cobertura|contratos? de (?:limpieza|recogida)/i.test(c.frase));
  if (anual) poner("importeAnual", "Importe anual", anual, numeroEs(anual.m[1]));
  // el precio que se oferta: «el precio de licitación … referido a la primera anualidad (año 1º): 1.406.520,42 euros»
  const primerAnio = buscar(paginas, new RegExp(String.raw`(?:primera anualidad|primer a[nñ]o|a[nñ]o 1)[^€]{0,80}?${IMPORTE}`, "i"));
  if (primerAnio) poner("precioPrimerAnio", "Precio de licitación del primer año", primerAnio, numeroEs(primerAnio.m[1]));
  const ivaTipo = buscar(paginas, /(?:\bIVA\b|impuesto sobre el valor a[nñ]adido)[^.%]{0,30}?\(?\s*(\d{1,2})\s*%|(\d{1,2})\s*%\s*(?:de\s+)?\bIVA\b/i);
  if (ivaTipo) poner("ivaPct", "Tipo de IVA", ivaTipo, `${ivaTipo.m[1] || ivaTipo.m[2]} %`);

  // ── tamaño del servicio ──
  const hab = buscar(paginas, /(\d{1,3}(?:\.\d{3})+|\d{4,})\s*habitantes/i);
  if (hab) poner("habitantes", "Habitantes", hab, numeroEs(hab.m[1]));
  const cont = buscarTodas(paginas, /(\d{1,3}(?:\.\d{3})+|\d{2,6})\s+contenedores/i);
  for (const u of buscarTodas(paginas, /contenedor[^.]{0,120}?(\d{1,3}(?:\.\d{3})+|\d{2,6})\s+unidades/i)) cont.push(u);
  if (cont.length) { const mayor = cont.reduce((a, b) => (numeroEs(b.m[1]) > numeroEs(a.m[1]) ? b : a)); poner("contenedores", "Contenedores (la cifra mayor que aparece)", mayor, numeroEs(mayor.m[1])); }
  const veh = buscarTodas(paginas, /(\d{1,3})\s+(?:veh[ií]culos|camiones|autobuses|unidades m[oó]viles|barredoras|baldeadoras)/i);
  if (veh.length) { const mayor = veh.reduce((a, b) => (Number(b.m[1]) > Number(a.m[1]) ? b : a)); poner("vehiculos", "Vehículos (la cifra mayor que aparece)", mayor, Number(mayor.m[1])); }
  const ant = buscar(paginas, /antig[uü]edad (?:m[aá]xima|no (?:superior|mayor)) (?:de |a )?(\d{1,2})\s*a[nñ]os/i);
  if (ant) poner("antiguedad", "Antigüedad máxima de los vehículos", ant, `${ant.m[1]} años`);

  // autobuses
  const lin = buscar(paginas, /(\d{1,3})\s+l[ií]neas\b/i);
  if (lin) poner("lineas", "Líneas", lin, Number(lin.m[1]));
  const exp = buscar(paginas, /(\d{1,3}(?:\.\d{3})+|\d{3,})\s+expediciones/i);
  if (exp) poner("expediciones", "Expediciones", exp, numeroEs(exp.m[1]));
  const kms = buscar(paginas, /(\d{1,3}(?:\.\d{3})+|\d{5,})\s*(?:km|kil[oó]metros)(?:[- ]?(?:anuales|al a[nñ]o|\/a[nñ]o|útiles|comerciales))/i);
  if (kms) poner("kmAnuales", "Kilómetros al año", kms, numeroEs(kms.m[1]));
  const horas = buscar(paginas, /(\d{1,3}(?:\.\d{3})+|\d{4,})\s*horas(?:[- ]?(?:anuales|al a[nñ]o|de servicio))/i);
  if (horas) poner("horasAnuales", "Horas de servicio al año", horas, numeroEs(horas.m[1]));

  const porAnio = buscar(paginas, new RegExp(String.raw`\b(\d{1,2}|${LETRAS})\s*(?:\((\d{1,2})\)\s*)?(lavados|recogidas|operaciones(?: de \w+)?|pasadas|servicios|vaciados|limpiezas)\s+(?:por (?:unidad de )?contenedor|al a[nñ]o)[^.]{0,20}?a[nñ]o`, "i"));
  if (porAnio) { const n = enteroDe(porAnio.m[2] || porAnio.m[1]); poner("vecesAnio", "Veces al año por contenedor", porAnio, n ? `${n} ${porAnio.m[3].toLowerCase()} al año` : null); }
  const opsAnio = buscarTodas(paginas, /(\d{1,3}(?:\.\d{3})+|\d{3,})\s+(?:operaciones de \w+|lavados|recogidas|vaciados|servicios)\s+al a[nñ]o/i);
  if (opsAnio.length) { const mayor = opsAnio.reduce((a, b) => (numeroEs(b.m[1]) > numeroEs(a.m[1]) ? b : a)); poner("operacionesAnio", "Operaciones al año (la cifra mayor)", mayor, numeroEs(mayor.m[1])); }
  const jorn = buscar(paginas, /jornadas (?:computables |laborables |de trabajo )?(?:al a[nñ]o )?(?:alcanzan |son |ser[aá]n )?(?:las |de )?\s*(\d{3})/i);
  if (jorn) poner("jornadasAnio", "Jornadas de servicio al año", jorn, Number(jorn.m[1]));
  const ini = buscar(paginas, /iniciar (?:la actividad|el servicio|los trabajos)[^.]{0,60}?(\d{1,3})\s*d[ií]as/i);
  if (ini) poner("inicio", "Plazo para empezar el servicio", ini, `${ini.m[1]} días`);
  const tdias = buscar(paginas, /de lunes a (domingo|s[aá]bado|viernes)/i);
  if (tdias) poner("dias", "Días de servicio", tdias, `De lunes a ${tdias.m[1].toLowerCase()}`);

  // ── personal ──
  const sub = buscar(paginas, /subrogaci[oó]n|subrogar/i);
  if (sub) poner("subrogacion", "Subrogación del personal", sub, "Sí, el pliego habla de subrogar plantilla");
  const trab = buscarTodas(paginas, /(\d{1,4})\s+(?:trabajadores|operarios|conductores|personas)/i);
  if (trab.length) { const mayor = trab.reduce((a, b) => (Number(b.m[1]) > Number(a.m[1]) ? b : a)); poner("plantilla", "Plantilla (la cifra mayor que aparece)", mayor, Number(mayor.m[1])); }
  const conv = buscar(paginas, /convenio colectivo (?:de |del |para (?:el|la) )?([^.,;:()\d]{6,120})/i);
  if (conv) poner("convenio", "Convenio colectivo", conv, conv.m[1].trim());

  // ── quién paga qué y otras condiciones que cambian el coste ──
  const revierte = buscar(paginas, /(?:pasar[aá]n? a ser|revertir[aá]n?|revierte[n]?)[^.]{0,60}?(?:propiedad )?(?:municipal|del ayuntamiento|a la administraci)/i);
  if (revierte) poner("revierte", "La maquinaria nueva pasa al Ayuntamiento al acabar", revierte, "Sí: se amortiza entera durante el contrato");
  const agua = buscar(paginas, /(?:pondr[aá] a disposici[oó]n[^.]{0,60}agua|agua[^.]{0,120}sin coste para el adjudicatario)/i);
  if (agua) poner("agua", "El agua la pone el Ayuntamiento", agua, "Sí, sin coste");
  const vertido = buscar(paginas, /(?:canon de vertido|tasa o tarifa de tratamiento|tarifa de (?:tratamiento|vertido))[^.]{0,200}?(?:a cargo del|ser[aá] realizado (?:directamente )?por el|correr[aá] a cargo del|abonar[aá] el) Ayuntamiento/i);
  if (vertido) poner("vertido", "El tratamiento o vertido lo paga el Ayuntamiento", vertido, "Sí");
  const garantia = buscar(paginas, /garant[ií]a definitiva[^.]{0,40}?(\d{1,2})\s*%\s*(?:del|sobre el)?\s*([^.;]{0,80})/i);
  if (garantia) poner("garantia", "Garantía definitiva", garantia, `${garantia.m[1]} % ${garantia.m[2].trim().replace(/,$/, "")}`.trim());
  const solvencia = buscar(paginas, new RegExp(String.raw`volumen anual de negocios[^.]{0,200}?(?:(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?)\s*(?:€|euros)|\((\d{1,3})\)\s*millones)`, "i"));
  if (solvencia) poner("solvencia", "Solvencia: facturación mínima", solvencia, solvencia.m[1] ? `${solvencia.m[1]} €` : `${solvencia.m[2]} millones de €`);
  const temporada = buscar(paginas, /temporada alta[:\s]+(?:del?\s+)?(\d{1,2} de [a-z]+)\s+al?\s+(\d{1,2} de [a-z]+)/i);
  if (temporada) poner("temporadaAlta", "Temporada alta", temporada, `Del ${temporada.m[1]} al ${temporada.m[2]}`);

  // ── horarios ──
  const hor = buscarTodas(paginas, /(?:de|entre las?)\s+(\d{1,2})[:.,](\d{2})\s*(?:h(?:oras)?\.?)?\s*(?:a|y|hasta)\s*(?:las?\s+)?(\d{1,2})[:.,](\d{2})/i, 8);
  hor.forEach((h, k) => poner(`horario${k}`, "Horario", h, `${h.m[1].padStart(2, "0")}:${h.m[2]} – ${h.m[3].padStart(2, "0")}:${h.m[4]}`));
  const turnoNoche = buscar(paginas, /(?:turno|horario|servicio) (?:de |en )?(?:la )?noche|nocturn[oa]/i);
  if (turnoNoche) poner("nocturno", "Trabajo nocturno", turnoNoche, "Sí");

  // ── frecuencias del servicio ──
  // La frase entera (qué se hace y cada cuánto), no la palabra suelta: «mensual»
  // sola no dice nada, y muchas veces es de un informe o de la factura.
  const frecuencias = frecuenciasDelServicio(paginas);

  // ── criterios de adjudicación ──
  const crit = buscar(paginas, /(?:oferta econ[oó]mica|precio)[^.]{0,60}?(\d{1,3})\s*puntos/i);
  if (crit) poner("puntosPrecio", "Puntos por el precio", crit, `${crit.m[1]} puntos`);

  // ── listas ──
  const enAlguna = re => paginas.findIndex(p => re.test(p));
  const lista = defs => defs.map(([nombre, re]) => { const i = enAlguna(re); return i < 0 ? null : { nombre, pagina: i + 1 }; }).filter(Boolean);

  // ── requisitos claros ──
  const requisitos = [];
  const reqRe = /[^.]*\b(?:deber[aá]n?|ser[aá] obligatori[oa]|como m[ií]nimo|m[ií]nimo de|m[aá]ximo de|no podr[aá]n?|se exigir[aá])\b[^.]*\./gi;
  paginas.forEach((p, i) => {
    for (const m of p.matchAll(reqRe)) {
      const t = sinArrastre(m[0].trim());
      if (t.length < 40 || t.length > 420) continue;
      const clave = sinAcentos(t).slice(0, 90);
      if (requisitos.some(r => r.clave === clave)) continue;
      // primero los que tienen cifras o tocan lo que se calcula
      const nota = (/\d/.test(t) ? 2 : 0) + (/veh[ií]cul|cami[oó]n|autob|contenedor|frecuencia|horario|personal|plantilla|turno|km|kil[oó]metr/i.test(t) ? 2 : 0);
      requisitos.push({ texto: t, pagina: i + 1, nota, clave });
    }
  });
  requisitos.sort((a, b) => b.nota - a.nota || a.pagina - b.pagina);

  // ── índice: títulos numerados y en mayúsculas ──
  const indice = [];
  (paginasCrudas || []).forEach((p, i) => {
    for (const linea of String(p || "").split("\n")) {
      const l = linea.trim();
      if (l.length < 6 || l.length > 110 || /\.{4,}/.test(l)) continue; // fuera las líneas del índice del propio PDF
      const letras = l.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, ""), mayus = letras.replace(/[^A-ZÁÉÍÓÚÑ]/g, "").length / Math.max(1, letras.length);
      const palabra = /^(?:art[ií]culo\s+\d+|cl[aá]usula\s+\d+|cap[ií]tulo\s+[\divxl]+|anexo\s+[\divxl]+|t[ií]tulo\s+[\divxl]+)\b/i.test(l);
      const numerado = /^\d{1,2}(?:\.\d{1,2}){0,2}\.?\s+[A-ZÁÉÍÓÚÑ]/.test(l) && mayus > 0.6 && letras.length >= 5;
      if ((palabra || numerado) && l === l.replace(/\s{3,}/g, " ")) {
        if (!indice.some(x => x.titulo === l)) indice.push({ titulo: l.replace(/\s+/g, " "), pagina: i + 1 });
      }
    }
  });

  const tablas = tablasDeCantidades(paginasCrudas || []);
  const equipos = equiposDelPliego(paginasCrudas || []);
  const estudio = estudioDeCostes(paginasCrudas || []);
  const mediosMinimos = mediosMinimosDe(paginasCrudas || []);
  // la parte técnica para dimensionar: servicios por frecuencias o por mediciones, y el personal que exige
  const tecnico = { frecuencias: serviciosPorFrecuencia(paginasCrudas || []), mediciones: serviciosPorMediciones(paginasCrudas || []), personal: personalExigido(paginasCrudas || []) };
  if (tecnico.personal.length) poner("personalMinimo", "Personal mínimo que exige", { pagina: tecnico.personal[0].pagina, frase: tecnico.personal[0].frase }, textoPersonal(tecnico.personal));
  const adjudicacion = criteriosDelPliego(paginasCrudas || []);

  return {
    version: VERSION_LECTOR, tipo: tipo && tipo[1] > 3 ? tipo[0] : null, clase, tablas, equipos, adjudicacion, estudio, mediosMinimos, tecnico,
    datos, requisitos: requisitos.slice(0, 40).map(({ texto, pagina }) => ({ texto, pagina })), indice: indice.slice(0, 120),
    listas: { fracciones: lista(FRACCIONES), limpieza: lista(SERVICIOS_LIMPIEZA), ambiental: lista(AMBIENTAL), frecuencias },
    paginas: paginas.length, conTexto,
  };
}

// ── Medios mínimos ──
// La lista de lo que el pliego exige como mínimo: «o 1 Vehículo recolector de 18 m3», «- 463 Contenedores…»
const MEDIOS = /(?:al menos|como m[ií]nimo|m[ií]nimo de)[^.:]{0,80}(?:maquinaria|medios|materiales|veh[ií]culos|equipos)[^.:]{0,60}:/i;
export function mediosMinimosDe(paginasCrudas) {
  const lineas = [];
  (paginasCrudas || []).forEach((p, i) => String(p || "").split("\n").forEach(l => lineas.push({ t: l.replace(/\s+/g, " ").trim(), pagina: i + 1 })));
  const out = [];
  for (let k = 0; k < lineas.length; k++) {
    if (!MEDIOS.test(lineas[k].t)) continue;
    let fallos = 0;
    for (let j = k + 1; j < lineas.length && fallos < 12; j++) {
      const m = lineas[j].t.match(/^(?:[o•\-–·*]\s+)?(\d{1,5})\s+([A-ZÁÉÍÓÚÑa-záéíóúñ][^€]{2,90})$/);
      if (m) { out.push({ uds: Number(m[1]), concepto: m[2].trim(), pagina: lineas[j].pagina }); fallos = 0; continue; }
      const sinNum = lineas[j].t.match(/^[o•\-–·*]\s+([A-ZÁÉÍÓÚÑ][^€]{2,90})$/);
      if (sinNum && out.length) { out.push({ uds: null, concepto: sinNum[1].trim(), pagina: lineas[j].pagina }); fallos = 0; continue; }
      if (/^Art\.?\s*\d|^CAP[IÍ]TULO|^SECCI[OÓ]N/i.test(lineas[j].t)) break;
      fallos++;
    }
    if (out.length >= 3) return out;
    out.length = 0;
  }
  return [];
}

// ── Frecuencias ──
const CADA_CUANTO = /\b(?:diari[oa]s?|diariamente|semanal(?:es|mente)?|quincenal(?:es|mente)?|mensual(?:es|mente)?|bimestral(?:es|mente)?|trimestral(?:es|mente)?|semestral(?:es|mente)?|una vez al a[nñ]o|por contenedor y a[nñ]o|d[ií]as alternos|(?:\d+|una|dos|tres|cuatro|cinco|seis|siete|ocho|diez|doce) (?:veces|pasadas|lavados|recogidas) (?:al|por|a la|cada|en el|en la) (?:d[ií]a|semana|mes|a[nñ]o|trimestre)|cada \d+ (?:d[ií]as|semanas|meses))\b/i;
const NO_ES_SERVICIO = /informe|factura|abonar[aá]|se abona|precio|reuni[oó]n|certificad|liquidaci|pago|abono|memoria|declaraci|registr|seguro|revisi[oó]n de precios|planificaci|programaci|compromiso|penalidad|propuesta|oferta|aver[ií]as|se indican|ser[aá] (?:el|la) siguiente|siguiente:/i;
// una frase nueva que el PDF ha pegado detrás (sin punto entre medias)
// Se queda con la frase que contiene la frecuencia (de la última frase nueva
// antes de ella a la primera después)
const NUEVA = /\s(?=(?:La|El|Los|Las|Se|En|Para|Con|Este|Esta)\s[a-záéíóúñ])/g;
function cortaFrase(t) {
  const m = CADA_CUANTO.exec(t);
  if (!m) return t;
  let ini = 0, fin = t.length;
  for (const b of t.matchAll(NUEVA)) {
    if (b.index < m.index && b.index > 0) ini = b.index + 1;
    else if (b.index > m.index + m[0].length) { fin = b.index; break; }
  }
  return t.slice(ini, fin).trim();
}
export function frecuenciasDelServicio(paginas) {
  const out = [], vistas = new Set();
  paginas.forEach((p, i) => {
    // trozos: frases, y también las viñetas («- Frecuencia trimestral para…»)
    for (const trozo of p.split(/(?<=[.;:])\s+|\s[-–•✓]\s/)) {
      const t = cortaFrase(sinArrastre(trozo.trim().replace(/^[-–•✓▪]\s*/, "")));
      if ((t.match(/\d+/g) || []).length >= 6 || /^tabla\s+\d/i.test(t)) continue; // una tabla volcada, no una frase
      if (t.length < 20 || t.length > 320 || !CADA_CUANTO.test(t) || NO_ES_SERVICIO.test(t)) continue;
      // tiene que decir de qué es (contenedores, lavado, recogida, limpieza…)
      if (!/contenedor|lavad|limpi|recogid|mantenimiento|revisi[oó]n|inspecci[oó]n|achique|barrido|baldeo|vaciad|servicio|parque|soterrad|superficie|frecuencia|periodicidad/i.test(t)) continue;
      const texto = t.length > 220 ? t.slice(0, 217).replace(/\s\S*$/, "") + "…" : t;
      const k = sinAcentos(texto).slice(0, 80);
      if (vistas.has(k)) continue;
      vistas.add(k);
      out.push({ texto: texto.charAt(0).toUpperCase() + texto.slice(1), pagina: i + 1 });
      if (out.length >= 20) return;
    }
  });
  return out;
}

// ── Tablas de cantidades, precios y parque ──
// Los pliegos traen las cifras en tablas: «RSU 166 MENSUAL 1.992» (unidades,
// frecuencia y total al año), «RSU 664 664 664 664» (por año del contrato),
// «RSU 166» (el parque), «RSU 21,14 € 21,56 € …» (precio unitario por año).
// En el texto del PDF cada fila es una línea: un concepto y una o más cifras
// (con, a veces, la frecuencia o «€» entre medias). Una fila con una sola
// cifra solo cuenta dentro de una tabla («Tabla 3 …», o tras su cabecera);
// suelta podría ser cualquier frase. El título es el de la «Tabla N» o, si no
// hay, la última línea de texto que lo parezca; una línea corta en mayúsculas
// entre filas («SOTERRADO») es un grupo.
const NUM = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?`;
const ES_NUM = new RegExp(String.raw`^(?:${NUM})$`);
const FRECUENCIA = /^(mensual|trimestral|semestral|anual|quincenal|semanal|bimestral|diari[oa])$/i;
const RUIDO = /firmado|verificaci|c[oó]digo|p[aá]gina|copia aut[eé]ntica|https?:|registre|registro mercantil|\bn\.?i\.?f\b|^cargo:/i;
const NO_ES_FILA = /^(?:mes|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|d[ií]as?\/mes|expte?\.?|art[ií]culo|p[aá]g\.?)$/i;
const CABECERA = /\b(?:ud|uds|unidades|frecuencia|a[nñ]o|anual(?:es)?|cantidad(?:es)?|previstas?|temporada|veces|fracci[oó]n|modelo|turno|precio|importe)\b/i;

/** Una línea como fila de tabla: { concepto, valores, frecuencia, euros } o null */
function filaDe(l) {
  const t = l.replace(/€/g, " € ").replace(/\s+/g, " ").trim().split(" ");
  const k = t.findIndex(x => ES_NUM.test(x));
  if (k < 1) return null;
  const concepto = t.slice(0, k).join(" ");
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(concepto) || concepto.length > 60 || NO_ES_FILA.test(concepto.split(" ")[0]) || /^\d/.test(concepto)) return null;
  const valores = [];
  let frecuencia = null, euros = false;
  for (const x of t.slice(k)) {
    if (ES_NUM.test(x)) valores.push(numeroEs(x));
    else if (x === "€") euros = true;
    else if (FRECUENCIA.test(x)) frecuencia = x.toLowerCase();
    else return null; // más texto: es una frase con cifras, no una fila
  }
  return { concepto, valores, frecuencia, euros };
}

export function tablasDeCantidades(paginasCrudas) {
  const tablas = [];
  let actual = null, titulo = null, cabecera = [], grupo = null, enTabla = 0;
  const recientes = []; // últimas líneas de texto, para dar con el título si no hay «Tabla N»
  const TITULO = /anexo|mantenimiento|lavado|limpieza|necesidades|programaci[oó]n|unidades|recogida|cantidades|servicio|contenedores|precios|costes/i;
  const enMayus = t => { const l = t.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, ""); return l.replace(/[^A-ZÁÉÍÓÚÑ]/g, "").length / Math.max(1, l.length) > 0.7; };
  const candidato = t => TITULO.test(t) && t.length >= 12 && t.length < 120;
  const tituloDe = () => titulo || [...recientes].reverse().find(t => candidato(t) && enMayus(t)) || [...recientes].reverse().find(candidato) || "Tabla";
  const cerrar = () => { actual = null; };
  paginasCrudas.forEach((p, i) => {
    for (const bruta of String(p || "").split("\n")) {
      let l = bruta.replace(/\s+/g, " ").trim();
      const ruido = l.search(RUIDO); // el pie de firma puede venir pegado a la última fila
      if (ruido === 0) continue;
      if (ruido > 0) l = l.slice(0, ruido).trim();
      if (!l || /^\d{1,3}$/.test(l)) continue; // número de página suelto

      // «Tabla 3 Cantidades y frecuencias lavados anuales»: empieza una tabla
      const tt = /^tabla\s+\d+\.?\s+(.{4,120})$/i.exec(l);
      if (tt) { cerrar(); titulo = tt[1].trim(); cabecera = []; grupo = null; enTabla = 30; continue; }

      const f = filaDe(l);
      const vale = f && (f.valores.length >= 3 || (f.valores.length >= 1 && (enTabla > 0 || actual)));
      if (vale) {
        if (!actual) { actual = { titulo: tituloDe(), pagina: i + 1, cabecera: cabecera.join(" ") || null, filas: [] }; tablas.push(actual); }
        actual.filas.push({ grupo, concepto: f.concepto, valores: f.valores, frecuencia: f.frecuencia, euros: f.euros });
        enTabla = 30;
        continue;
      }
      if (enTabla > 0) enTabla--;
      if (l.length < 120) { recientes.push(l); if (recientes.length > 20) recientes.shift(); }
      const corta = l.length <= 30 && l === l.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{3,}/.test(l) && !/\d/.test(l);
      if (corta && (actual || enTabla > 0)) { if (!CABECERA.test(l) || actual) { grupo = l; continue; } }
      if (CABECERA.test(l) && l.length < 120) {
        // cabecera de columnas («LAVADO FRACCIÓN UD FRECUENCIA Cantidades previstas anuales», en varias líneas)
        if (actual && actual.filas.length) { cerrar(); titulo = null; grupo = null; cabecera = []; }
        cabecera.push(l); if (cabecera.length > 6) cabecera.shift();
        if (!titulo && enMayus(l) && TITULO.test(l)) titulo = null;
        enTabla = Math.max(enTabla, 8);
        continue;
      }
      // texto corrido: se acaba la tabla
      if (!/\d/.test(l) && l.length > 40) { cerrar(); titulo = null; cabecera = []; grupo = corta ? l : null; enTabla = 0; }
    }
  });
  return tablas.filter(t => t.filas.length >= 1 && (t.filas.length >= 2 || /tabla|anexo/i.test(t.titulo) || t.cabecera)).slice(0, 60);
}

// ── Equipos que exige el pliego para cada servicio ──
// «…mediante un equipo formado por dos operarios y un camión lavacontenedores»
// «…realizadas por un equipo formado por un conductor, un operario y un vehículo
// equipado con grúa». De cada frase: el vehículo, cuántas personas y de qué
// servicio es (el apartado en el que está: «2.4. Lavado de contenedores»).
const CUANTOS = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
const PERSONA = /(\d+|un|una|uno|dos|tres|cuatro|cinco|seis)\s+(?:\(\d+\)\s+)?(operari[oa]s?|conductor(?:es|a)?|pe[oó]n(?:es)?|oficial(?:es)?|mec[aá]nicos?|trabajador(?:es|a)?|ayudantes?|encargad[oa]s?|personas?)\b/gi;
const VEHICULO = /(?:un|una|\d+)\s+((?:cami[oó]n|veh[ií]culo|furgoneta|furg[oó]n|barredora|baldeadora|cisterna|turismo|grúa|gr[uú]a)[^,.;:]{0,80})/i;
export function equiposDelPliego(paginasCrudas) {
  const out = [];
  (paginasCrudas || []).forEach((cruda, i) => {
    const lineas = String(cruda || "").split("\n");
    const texto = limpia(cruda);
    for (const m of texto.matchAll(/equipo formado por\s+([^.;]{5,220})/gi)) {
      const que = m[1];
      let personas = 0;
      const quien = [];
      for (const p of que.matchAll(PERSONA)) {
        const n = /^\d+$/.test(p[1]) ? Number(p[1]) : CUANTOS[p[1].toLowerCase()] || 1;
        personas += n; quien.push(`${n} ${p[2].toLowerCase()}`);
      }
      const v = VEHICULO.exec(que);
      const vehiculo = v ? v[1].replace(/\s+(?:con una frecuencia|que|para|durante|y\s+\w+\s+operari).*$/i, "").trim() : null;
      // el apartado en el que está la frase: el último título numerado antes de ella
      const antes = texto.slice(0, m.index);
      let apartado = null;
      for (const l of lineas) {
        const h = /^\s*(\d+(?:\.\d+)+)\.?\s+([A-ZÁÉÍÓÚÑ][^\n]{3,90})$/.exec(l);
        if (h && antes.includes(h[2].trim().slice(0, 25))) apartado = `${h[1]}. ${h[2].trim()}`;
      }
      out.push({ apartado, vehiculo, personas: personas || null, quien: quien.join(", "), pagina: i + 1, frase: fraseEn(texto, m.index, m[0].length) });
    }
  });
  // «…mediante vehículo lavador de contenedores con conductor», «El servicio se
  // deberá realizar con vehículo (camión) de lavado de contenedores de carga lateral»
  (paginasCrudas || []).forEach((cruda, i) => {
    const texto = limpia(cruda);
    for (const m of texto.matchAll(/(?:mediante|deber[aá] realizar con|se realizar[aá] con|dotad[oa] de)\s+(?:un |una )?((?:veh[ií]culo|cami[oó]n|furgoneta|barredora|baldeadora)[^.;:]{3,110})/gi)) {
      let vehiculo = m[1].replace(/\s+(?:apto|que|para|durante|lo que|con una|tanto).*$/i, "").trim();
      const conConductor = /con conductor/i.test(vehiculo);
      vehiculo = vehiculo.replace(/\s*con conductor.*$/i, "").trim();
      vehiculo = vehiculo.replace(/[,\s]+$/, "");
      if (out.some(e => e.pagina === i + 1 && e.vehiculo === vehiculo)) continue;
      out.push({ apartado: null, vehiculo, personas: conConductor ? 1 : null, quien: conConductor ? "1 conductor" : "", pagina: i + 1, frase: fraseEn(texto, m.index, m[0].length) });
    }
  });
  out.sort((a, b) => a.pagina - b.pagina);
  // el apartado puede estar en la página anterior: se arrastra el último visto
  let ultimo = null;
  for (const e of out) { if (e.apartado) ultimo = e.apartado; else e.apartado = ultimo; }
  return out;
}

/** Busca un texto en las páginas: [{ pagina, frase }] (sin distinguir acentos ni mayúsculas) */
export function buscarEnPliego(paginasCrudas, q, max = 30) {
  const aguja = sinAcentos(String(q || "").trim());
  if (aguja.length < 3) return [];
  const out = [];
  (paginasCrudas || []).forEach((p, i) => {
    const t = limpia(p), plano = sinAcentos(t);
    let k = plano.indexOf(aguja);
    while (k >= 0 && out.length < max) { out.push({ pagina: i + 1, frase: fraseEn(t, k, aguja.length) }); k = plano.indexOf(aguja, k + aguja.length + 200); }
  });
  return out;
}
