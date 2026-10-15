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
const NO_ES_CRITERIO = /criterios?|total|puntuaci[oó]n m[aá]xima|m[aá]ximo de puntos|sobre\s*n?[º°]?\s*\d|umbral|m[ií]nim[oa] de \d+ puntos|obtener|alcanzar|superar|quedar[aá]n? excluid/i;
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
 * @returns { criterios: [{ nombre, puntos, tipo: "precio" | "formula" | "juicio", pagina, frase }],
 *            formula: { id, pagina, frase } | null, baja: { id, valor, pagina, frase } | null }
 */
export function criteriosDelPliego(paginasCrudas = []) {
  const lineas = [];
  paginasCrudas.forEach((p, i) => String(p || "").split("\n").forEach(l => { const t = l.replace(/\s+/g, " ").trim(); if (t) lineas.push({ t, pagina: i + 1 }); }));
  const criterios = [];
  const anadir = c => {
    const nombre = c.nombre.replace(/^[\s:.\-–•·]+|[\s:.\-–,(]+$/g, "").replace(/^(?:[a-z\d]{1,3}[.)]|[ivx]{1,4}[.)])\s+/i, "").trim();
    if (nombre.length < 3 || nombre.length > 120 || NO_ES_CRITERIO.test(nombre) || !(c.puntos > 0 && c.puntos <= 100)) return;
    const clave = sinAcentos(nombre);
    if (criterios.some(x => sinAcentos(x.nombre) === clave)) return;
    criterios.push({ ...c, nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1) });
  };

  // 1) anuncio de la Plataforma: «NOMBRE» / «: Precio Subtipo Criterio» / «: 40 Ponderación»
  let seccion = null, pendiente = null;
  for (let k = 0; k < lineas.length; k++) {
    const { t, pagina } = lineas[k];
    if (SECCION_JUICIO.test(t)) seccion = "juicio";
    else if (SECCION_FORMULA.test(t)) seccion = "formula";
    const sub = t.match(/^:?\s*(.*?)\s*Subtipo Criterio/i);
    if (sub) {
      // el nombre: la línea anterior que no es ruido
      let j = k - 1; while (j >= 0 && (RUIDO.test(lineas[j].t) || /ponderaci|subtipo/i.test(lineas[j].t))) j--;
      const nombre = j >= 0 ? lineas[j].t : "Criterio";
      pendiente = { nombre, tipo: /precio/i.test(sub[1]) || ES_PRECIO.test(nombre) ? "precio" : seccion || "formula", pagina, frase: `${nombre} · ${sub[1]}` };
      continue;
    }
    const pond = t.match(/^:?\s*(\d{1,3}(?:[.,]\d+)?)\s*Ponderaci[oó]n/i);
    if (pond && pendiente) { anadir({ ...pendiente, puntos: numero(pond[1]) }); pendiente = null; continue; }

    // 2) pliego: «Oferta económica: hasta 51 puntos», «Memoria técnica (máximo 25 puntos)»
    const m = t.match(/^(.{3,120}?)[\s:.–\-(]*(?:hasta(?: un m[aá]ximo de)?|m[aá]ximo(?: de)?|m[aá]x\.?|con)?\s*(\d{1,3}(?:,\d{1,2})?)\s*(?:puntos|ptos\.?|p\.)\)?\.?$/i);
    if (m && !/^\d+([.,]\d+)?$/.test(m[1].trim())) {
      const nombre = m[1];
      const tipo = ES_PRECIO.test(nombre) ? "precio" : seccion || "formula";
      anadir({ nombre, puntos: numero(m[2]), tipo, pagina, frase: t });
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
  return { criterios, formula, baja };
}
