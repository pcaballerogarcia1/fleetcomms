// Concursos → criterios de adjudicación: cuántos puntos da cada cosa, con qué
// fórmula se puntúa el precio y cuándo una oferta es anormalmente baja.
// Se leen del anuncio de la Plataforma de Contratación (bloques «Subtipo
// Criterio / Ponderación») y del pliego administrativo («Oferta económica:
// hasta 51 puntos»). Lo leído se propone en la Ficha de requisitos y allí se
// confirma o se corrige: Alternativas puntúa con lo de la ficha.

const sinAcentos = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const numero = s => Number(String(s).replace(",", "."));
const ES_PRECIO = /precio|econ[oó]mic|proposici[oó]n econ|oferta econ|importe/i;
// rótulos y totales, no criterios
const NO_ES_CRITERIO = /criterios?|total|puntuaci[oó]n m[aá]xima|m[aá]ximo de puntos|sobre\s*n?[º°]?\s*\d|umbral|m[ií]nim[oa] de \d+ puntos|obtener|alcanzar|superar|quedar[aá]n? excluid|^ponderaci[oó]n$|^f[oó]rmula|^descripci[oó]n|^(?:hasta|entre|desde|m[aá]s de)?\s*\d+(?:\s*(?:y|a)\s*\d+)?\s*(?:o m[aá]s)?\s+[a-záéíóúñ]/i;
// escalones de una mejora: «Entre 6 y 10 papeleras: 1 puntos», «16 o más jornadas de desbroce: 5 puntos», «Hasta 5 papeleras de madera: 0 puntos»
const ESCALON = /^(?:[•·\-–]\s*)?(hasta|entre|desde|m[aá]s de)?\s*(\d+)(?:\s*(?:y|a)\s*(\d+))?\s*(o m[aá]s)?\s+([a-záéíóúñ][a-záéíóúñ ]{2,60}?)\s*:\s*(\d{1,2}(?:,\d+)?)\s*puntos?\.?$/i;
const ES_MEJORA = /mejora|bolsa de|sin coste adicional|adicional(?:es)? (?:a|sin)/i;
const SECCION_JUICIO = /juicios? de valor|no evaluables mediante f[oó]rmulas|valoraci[oó]n subjetiva|criterios subjetivos/i;
const SECCION_FORMULA = /mediante (?:la )?aplicaci[oó]n de f[oó]rmulas|evaluables (?:mediante|por) f[oó]rmulas|evaluables de forma autom[aá]tica|valoraci[oó]n autom[aá]tica|criterios objetivos|cuantificables (?:de forma )?autom/i;
const RUIDO = /direcci[oó]n postal|^\(\d{5}\)|espa[nñ]a$|^ES\d{3}$|tel[eé]fono|correo|plaza de|^calle|^avda|^===/i;

export const FORMULAS_PRECIO = [
  { id: "lineal", nombre: "Lineal a la baja", texto: "Puntos = máximo × (presupuesto − oferta) ÷ (presupuesto − oferta más baja)" },
  { id: "proporcional", nombre: "Proporcional a la más baja", texto: "Puntos = máximo × oferta más baja ÷ oferta" },
  { id: "saciedad", nombre: "Lineal con umbral de saciedad", texto: "Puntos = máximo × baja ÷ umbral (a partir del umbral, todos los puntos)" },
];
export const BAJA_ANORMAL = [
  { id: "art85", nombre: "Artículo 85 del RGLCAP", texto: "1 oferta: más de 25 puntos de baja · 2: más de 20 por debajo de la otra · 3 o más: más de 10 por debajo de la media" },
  { id: "media", nombre: "Puntos por encima de la baja media", texto: "Anormal si su baja supera la baja media en más de los puntos indicados" },
];

/**
 * Los criterios de adjudicación de un pliego o anuncio.
 * @param paginasCrudas [texto de cada página, con sus saltos de línea]
 * @returns { criterios: [{ nombre, puntos, tipo: "precio" | "formula" | "juicio" | "mejora", pagina, frase,
 *              subcriterios?: [{ nombre, puntos }], escalones?: [{ desde, hasta, puntos }], unidad? }],
 *            formula: { id, pagina, frase } | null, baja: { id, valor, pagina, frase } | null }
 */
export function criteriosDelPliego(paginasCrudas = []) {
  const lineas = [];
  paginasCrudas.forEach((p, i) => String(p || "").split("\n").forEach(l => { const t = l.replace(/\s+/g, " ").trim(); if (t) lineas.push({ t, pagina: i + 1 }); }));
  // «… (hasta 2» + «puntos)»: una línea partida en dos
  for (let i = lineas.length - 2; i >= 0; i--) {
    if (/(?:hasta|m[aá]ximo(?: de)?)\s+\d{1,3}(?:,\d+)?\s*$/i.test(lineas[i].t) && /^puntos?\b/i.test(lineas[i + 1].t)) {
      lineas[i] = { ...lineas[i], t: `${lineas[i].t} ${lineas[i + 1].t}` };
      lineas.splice(i + 1, 1);
    }
  }
  const criterios = [];
  const anadir = c => {
    const nombre = c.nombre.replace(/^[\s:.\-–•·]+|[\s:.\-–,(]+$/g, "").replace(/^(?:[a-z\d]{1,3}[.)]|[ivx]{1,4}[.)])\s+/i, "").trim();
    if (nombre.length < 3 || nombre.length > 120 || NO_ES_CRITERIO.test(nombre) || !(c.puntos > 0 && c.puntos <= 100)) return;
    const clave = sinAcentos(nombre);
    if (criterios.some(x => sinAcentos(x.nombre) === clave)) return;
    criterios.push({ ...c, nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1) });
  };

  // 1) anuncio de la Plataforma: «NOMBRE» / «: Precio Subtipo Criterio» / «: 40 Ponderación»
  let seccion = null, pendiente = null, titulo = null;
  const escalones = []; // [{ unidad, desde, hasta, puntos, pagina, k }]
  for (let k = 0; k < lineas.length; k++) {
    const { t, pagina } = lineas[k];
    // escalones de una mejora
    const esc = t.match(ESCALON);
    if (esc) {
      const a = Number(esc[2]), b = esc[3] ? Number(esc[3]) : null;
      const [desde, hasta] = /hasta/i.test(esc[1] || "") ? [0, a] : esc[4] || /m[aá]s de|desde/i.test(esc[1] || "") ? [/m[aá]s de/i.test(esc[1] || "") ? a + 1 : a, null] : [a, b ?? a];
      escalones.push({ unidad: esc[5].trim().replace(/\s+(anuales|al a[nñ]o)$/i, ""), desde, hasta, puntos: numero(esc[6]), pagina, k });
      continue;
    }
    // un título de criterio sin puntos («• Mejoras – constitución de una bolsa anual de papeleras…»): sus puntos vienen luego en «Ponderación 5 puntos»
    const tit = t.match(/^[•·]\s*(.{8,160}?)[:\s]*$/);
    if (tit && !/\d+\s*puntos/i.test(t)) titulo = { nombre: tit[1], pagina, k };
    const pondTabla = t.match(/^Ponderaci[oó]n\s+(\d{1,3}(?:,\d+)?)\s*puntos?$/i);
    if (pondTabla && titulo && k - titulo.k < 25) {
      anadir({ nombre: titulo.nombre, puntos: numero(pondTabla[1]), tipo: ES_MEJORA.test(titulo.nombre) ? "mejora" : ES_PRECIO.test(titulo.nombre) ? "precio" : seccion || "formula", pagina: titulo.pagina, frase: `${titulo.nombre} · ${t}` });
      titulo = null;
      continue;
    }
    if (SECCION_JUICIO.test(t)) seccion = "juicio";
    else if (SECCION_FORMULA.test(t)) seccion = "formula";
    const sub = t.match(/^:?\s*(.*?)\s*Subtipo Criterio/i);
    if (sub) {
      // el nombre: la línea anterior que no es ruido
      let j = k - 1; while (j >= 0 && (RUIDO.test(lineas[j].t) || /ponderaci|subtipo/i.test(lineas[j].t))) j--;
      const nombre = j >= 0 ? lineas[j].t : "Criterio";
      pendiente = { nombre, tipo: /precio/i.test(sub[1]) || ES_PRECIO.test(nombre) ? "precio" : ES_MEJORA.test(nombre) ? "mejora" : seccion || "formula", pagina, frase: `${nombre} · ${sub[1]}` };
      continue;
    }
    const pond = t.match(/^:?\s*(\d{1,3}(?:[.,]\d+)?)\s*Ponderaci[oó]n/i);
    if (pond && pendiente) { anadir({ ...pendiente, puntos: numero(pond[1]) }); pendiente = null; continue; }

    // 2) pliego: «Oferta económica: hasta 51 puntos», «Memoria técnica (máximo 25 puntos)»
    const m = t.match(/^(.{3,160}?)[\s:.–\-(]*(?:hasta(?: un m[aá]ximo de)?|m[aá]ximo(?: de)?|m[aá]x\.?|con)?\s*(\d{1,3}(?:,\d{1,2})?)\s*(?:puntos|ptos\.?|p\.)\s*\)?\s*[.:]?$/i);
    if (m && !/^\d+([.,]\d+)?$/.test(m[1].trim())) {
      const nombre = m[1];
      const tipo = ES_PRECIO.test(nombre) ? "precio" : ES_MEJORA.test(nombre) ? "mejora" : seccion || "formula";
      anadir({ nombre, puntos: numero(m[2]), tipo, pagina, frase: t, k });
    }
  }

  // apartados: los criterios seguidos que suman justo lo de uno anterior son sus apartados
  // («Memoria técnica 45 puntos» = 12 + 12 + 3 + 3 + 9 + 2 + 2 + 2)
  for (let i = 0; i < criterios.length; i++) {
    const padre = criterios[i];
    let suma = 0, j = i + 1;
    while (j < criterios.length && suma < padre.puntos - 1e-9) suma += criterios[j++].puntos;
    if (padre.tipo !== "precio" && padre.tipo !== "mejora" && j - i - 1 >= 2 && Math.abs(suma - padre.puntos) < 1e-9 && !criterios.slice(i + 1, j).some(c => c.tipo === "precio" || c.tipo === "mejora")) {
      padre.subcriterios = criterios.slice(i + 1, j).map(({ nombre, puntos }) => ({ nombre, puntos }));
      criterios.splice(i + 1, j - i - 1);
    }
  }
  // los escalones, a su mejora (por la palabra de la unidad: «papeleras», «jornadas de desbroce»)
  const grupos = [];
  for (const e of escalones) {
    const g = grupos.find(x => x.unidad === e.unidad || sinAcentos(x.unidad).split(" ")[0] === sinAcentos(e.unidad).split(" ")[0]);
    if (g) g.escalones.push(e); else grupos.push({ unidad: e.unidad, escalones: [e] });
  }
  for (const g of grupos) {
    const palabra = sinAcentos(g.unidad).split(" ").find(w => w.length > 4) || sinAcentos(g.unidad);
    const c = criterios.find(x => sinAcentos(x.nombre).includes(palabra)) || null;
    const lista = g.escalones.map(({ desde, hasta, puntos }) => ({ desde, hasta, puntos })).sort((a, b) => a.desde - b.desde);
    if (c) { c.escalones = lista; c.unidad = g.unidad; c.tipo = "mejora"; }
    g.lista = lista;
  }
  // dos mejoras de lo mismo (una de la frase del criterio y otra de su tabla): la que tiene escalones
  for (let i = criterios.length - 1; i >= 0; i--) {
    const c = criterios[i];
    if (c.tipo !== "mejora") continue;
    const palabra = (sinAcentos(c.nombre).match(/papeleras|desbroce|jornadas|contenedores|horas|vehiculos|barredora|personal|limpiezas?/) || [])[0];
    const otra = palabra && criterios.find(x => x !== c && x.tipo === "mejora" && sinAcentos(x.nombre).includes(palabra) && x.puntos === c.puntos);
    if (otra && (!c.escalones || otra.escalones)) criterios.splice(i, 1);
  }
  for (const c of criterios) delete c.k;

  // 2b) en el texto seguido (los PDF no siempre cortan las líneas donde acaba cada
  // criterio): «-Oferta económica …, IVA incluido: 80 puntos. Criterio: …».
  // Si lo leído por líneas no suma 100, se busca en el texto el grupo SEGUIDO de
  // criterios que suma 100 y lleva el precio (casi siempre suman 100).
  const sumaDe = cs => cs.reduce((a, c) => a + (Number(c.puntos) || 0), 0);
  if (!(Math.abs(sumaDe(criterios) - 100) < 1e-6 && criterios.some(c => c.tipo === "precio"))) {
    const seguido = [];
    paginasCrudas.forEach((pg, i) => {
      const t = String(pg || "").replace(/\s+/g, " ");
      const re = /(?:^|[•·\-–]\s*|\d{1,2}[.)]\s+|\b[a-h]\)\s+|\.\s+)([A-ZÁÉÍÓÚÑa-záéíóúñ][^:•·\n]{2,140}?)\s*(?:[:.–-]|\(|,)\s*(?:hasta(?: un)?(?: m[aá]ximo de)?|m[aá]ximo(?: de)?|m[aá]x\.?)?\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:puntos|ptos\.?|%|pts)\b/gi;
      for (const m of t.matchAll(re)) {
        const nombre = m[1].replace(/^(?:criterio|apartado)\s*\d*[.:]?\s*/i, "").trim();
        const puntos = numero(m[2]);
        if (!(puntos > 0 && puntos <= 100) || NO_ES_CRITERIO.test(nombre) || /^(?:el|la|los|las|un|una|de|del|al|con|por|se|que|y)\b/i.test(nombre) && nombre.length < 12) continue;
        if (/inferior|superior|baja|anormal|desproporcion|penalidad|garant[ií]a|iva|retenci|anticipo|plazo de|d[ií]as|horas? de antelaci|cada|por cada|reduc|incremento del|precio del contrato|presupuesto/i.test(nombre) && !ES_PRECIO.test(nombre.slice(0, 30))) continue;
        seguido.push({ nombre, puntos, tipo: ES_PRECIO.test(nombre) ? "precio" : ES_MEJORA.test(nombre) ? "mejora" : "formula", pagina: i + 1, frase: m[0].trim().slice(0, 200), pos: i * 1e7 + m.index });
      }
    });
    // el primer grupo seguido que suma 100 y lleva el precio (mirando hasta 14 criterios)
    let mejor = null;
    for (let a = 0; a < seguido.length && !mejor; a++) {
      let suma = 0;
      for (let b = a; b < Math.min(seguido.length, a + 14); b++) {
        suma += seguido[b].puntos;
        if (suma > 100 + 1e-6) break;
        const grupo = seguido.slice(a, b + 1);
        if (Math.abs(suma - 100) < 1e-6 && grupo.some(c => c.tipo === "precio") && new Set(grupo.map(c => sinAcentos(c.nombre))).size === grupo.length) { mejor = grupo; break; }
      }
    }
    if (mejor) {
      criterios.length = 0;
      for (const c of mejor) { const { pos: _pos, ...x } = c; void _pos; criterios.push({ ...x, nombre: x.nombre.charAt(0).toUpperCase() + x.nombre.slice(1) }); }
    }
  }

  // 3) la fórmula del precio y la baja anormal, en el texto seguido
  const paginas = paginasCrudas.map(p => String(p || "").replace(/\s+/g, " "));
  const busca = re => { for (let i = 0; i < paginas.length; i++) { const m = paginas[i].match(re); if (m) return { m, pagina: i + 1, frase: paginas[i].slice(Math.max(0, m.index - 80), m.index + m[0].length + 80).trim() }; } return null; };
  let formula = null;
  const prop = busca(/(?:o(?:ferta)?\s*(?:m[aá]s baja|min|m[ií]nima)|pmin|omin|precio m[aá]s bajo)\s*\/\s*(?:o(?:ferta)?\s*(?:i|a valorar|del licitador)|pi|oi|precio (?:ofertado|de la oferta))/i)
    || busca(/oferta m[aá]s baja (?:dividid[ao]|entre) (?:por )?(?:la oferta|el precio) (?:a valorar|de cada licitador|ofertad)/i);
  const saciedad = busca(/umbral de saciedad|baja de saciedad|saciedad/i);
  const lineal = busca(/\((?:pbl|pl|presupuesto(?: base)?(?: de licitaci[oó]n)?|ib|pb)\s*[-–]\s*(?:oi|pi|of|o)\)\s*\/\s*\((?:pbl|pl|presupuesto(?: base)?(?: de licitaci[oó]n)?|ib|pb)\s*[-–]\s*(?:omin|pmin|o ?min|om)\)|bi\s*\/\s*b\s*max|baja (?:de la oferta|ofertada) (?:a valorar )?\/\s*baja m[aá]xima|proporcional(?:mente)? a la baja/i);
  if (saciedad) formula = { id: "saciedad", pagina: saciedad.pagina, frase: saciedad.frase };
  else if (prop) formula = { id: "proporcional", pagina: prop.pagina, frase: prop.frase };
  else if (lineal) formula = { id: "lineal", pagina: lineal.pagina, frase: lineal.frase };

  let baja = null;
  const anormal = busca(/(?:anormalmente baj|anormales|desproporcionad|temerari)/i);
  if (anormal) {
    const art = busca(/art[ií]culo 85 del (?:reglamento|rglcap|r\.?d\.? 1098)|art\.? ?85 (?:del )?rglcap|85 del real decreto 1098/i);
    const pct = busca(/(\d{1,2}(?:,\d+)?)\s*(?:unidades porcentuales|puntos porcentuales|%)\s*(?:o m[aá]s\s*)?(?:a la|por debajo de la|inferior(?:es)? a la|respecto (?:de|a) la)\s*(?:baja )?media/i);
    if (pct) baja = { id: "media", valor: numero(pct.m[1]), pagina: pct.pagina, frase: pct.frase };
    else baja = { id: "art85", valor: null, pagina: (art || anormal).pagina, frase: (art || anormal).frase };
  }
  // los escalones de cada mejora, también sueltos (por si la mejora está en otro documento, p. ej. el anuncio)
  const escalonesMejoras = grupos.map(g => ({ unidad: g.unidad, escalones: g.lista }));
  return { criterios, formula, baja, escalonesMejoras };
}

/**
 * Los criterios a proponer, de entre los documentos subidos: el grupo que
 * tiene precio y suma 100 (si no, el más completo), con los apartados y los
 * escalones que traigan los otros documentos.
 * @param docs [{ nombre, adjudicacion: criteriosDelPliego(…) }]
 * @returns null | { criterios, formula, baja, docNombre, suma }
 */
export function mejorPropuesta(docs = []) {
  const sumaDe = cs => cs.reduce((s, c) => s + (Number(c.puntos) || 0), 0);
  const nota = cs => (cs.some(c => c.tipo === "precio") ? 2 : 0) + (Math.abs(sumaDe(cs) - 100) < 1e-6 ? 3 : 0) + (cs.length ? 1 : 0) + (cs.some(c => c.escalones || c.subcriterios) ? 0.5 : 0);
  const cands = docs.filter(d => d.adjudicacion?.criterios?.length).map(d => ({ d, cs: d.adjudicacion.criterios, n: nota(d.adjudicacion.criterios) })).sort((a, b) => b.n - a.n);
  const formula = docs.map(d => d.adjudicacion?.formula && { ...d.adjudicacion.formula, docNombre: d.nombre }).find(Boolean) || null;
  const baja = docs.map(d => d.adjudicacion?.baja && { ...d.adjudicacion.baja, docNombre: d.nombre }).find(Boolean) || null;
  if (!cands.length) return formula || baja ? { criterios: [], formula, baja, docNombre: null, suma: 0 } : null;
  const mejor = cands[0];
  const palabras = t => sinAcentos(t).split(/[^a-z0-9]+/).filter(w => w.length > 4 && !/mejora|constitucion|adicional|ayuntamiento|coste|bolsa/.test(w));
  const otros = cands.slice(1).flatMap(x => x.cs.map(c => ({ ...c, docNombre: x.d.nombre })));
  const sueltos = docs.flatMap(d => d.adjudicacion?.escalonesMejoras || []);
  const criterios = mejor.cs.map(c => {
    const out = { ...c, docNombre: mejor.d.nombre };
    const ws = palabras(c.nombre);
    const par = otros.find(o => o.puntos === c.puntos && o.tipo === c.tipo && palabras(o.nombre).some(w => ws.includes(w)))
      || otros.find(o => o.puntos === c.puntos && palabras(o.nombre).filter(w => ws.includes(w)).length >= 2);
    if (!out.subcriterios && par?.subcriterios) out.subcriterios = par.subcriterios;
    if (!out.escalones && par?.escalones) { out.escalones = par.escalones; out.unidad = par.unidad; out.tipo = "mejora"; }
    if (!out.escalones) {
      const g = sueltos.find(s => palabras(s.unidad).some(w => ws.includes(w)) || ws.some(w => sinAcentos(s.unidad).includes(w)));
      if (g) { out.escalones = g.escalones; out.unidad = g.unidad; out.tipo = "mejora"; }
    }
    return out;
  });
  return { criterios, formula, baja, docNombre: mejor.d.nombre, suma: sumaDe(criterios) };
}
