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

// Versión del lector: si sube, los pliegos ya guardados se vuelven a leer al abrirlos
export const VERSION_LECTOR = 3;

const NUM_LETRA = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciséis: 16, dieciseis: 16, veinte: 20, veinticinco: 25, treinta: 30 };
const LETRAS = Object.keys(NUM_LETRA).join("|");

/** «1.234.567,89» → 1234567.89 */
export function numeroEs(txt) {
  const t = String(txt).trim().replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^\d+,\d+$/.test(t)) return Number(t.replace(",", "."));
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, "")); // formato inglés
  return Number(t.replace(",", "."));
}
const enteroDe = s => (s == null ? null : /^\d/.test(s) ? numeroEs(s) : NUM_LETRA[s.toLowerCase()] ?? null);

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
  // primero «duración del contrato», luego cualquier plazo de ejecución o vigencia
  const durRe = pre => new RegExp(String.raw`${pre}[^.]{0,120}?(\d{1,2}|${LETRAS})\s*(?:\((\d{1,2})\)\s*)?(a[nñ]os|mes(?:es|\(es\))?)`, "i");
  const dur = buscar(paginas, durRe(String.raw`(?:duraci[oó]n|vigencia|plazo de ejecuci[oó]n) del (?:presente )?contrato`)) || buscar(paginas, new RegExp(String.raw`(?:duraci[oó]n|plazo de (?:ejecuci[oó]n|vigencia)|vigencia)[^.]{0,120}?\b(\d{1,2}|${LETRAS})\s*(?:\((\d{1,2})\)\s*)?(a[nñ]os|mes(?:es|\(es\))?)`, "i"));
  if (dur) {
    const n = enteroDe(dur.m[2] || dur.m[1]);
    const unidad = /^a/i.test(dur.m[3]) ? (n === 1 ? "año" : "años") : (n === 1 ? "mes" : "meses");
    poner("duracion", "Duración", dur, n ? `${n} ${unidad}` : null);
  }
  const pro = buscar(paginas, new RegExp(String.raw`pr[oó]rrogas?[^.]{0,120}?\b(\d{1,2}|${LETRAS})\s*(?:\((\d{1,2})\)\s*)?(a[nñ]os?|mes(?:es|\(es\))?|anualidad(?:es)?)`, "i"));
  if (pro) {
    const n = enteroDe(pro.m[2] || pro.m[1]);
    const u = /^a[nñ]/i.test(pro.m[3]) ? (n === 1 ? "año" : "años") : /^mes/i.test(pro.m[3]) ? (n === 1 ? "mes" : "meses") : (n === 1 ? "anualidad" : "anualidades");
    poner("prorroga", "Prórrogas", pro, n ? `${n} ${u}` : null);
  }

  // ── dinero ──
  const pbl = buscar(paginas, new RegExp(String.raw`presupuesto base de licitaci[oó]n[^.€]{0,160}?${IMPORTE}`, "i"));
  if (pbl) poner("presupuesto", "Presupuesto base de licitación", pbl, numeroEs(pbl.m[1]));
  const ve = buscar(paginas, new RegExp(String.raw`valor estimado(?: del contrato)?[^.€]{0,160}?${IMPORTE}`, "i"));
  if (ve) poner("valorEstimado", "Valor estimado del contrato", ve, numeroEs(ve.m[1]));
  const anual = buscar(paginas, new RegExp(String.raw`(?:importe|presupuesto|precio)\s+anual[^.€]{0,120}?${IMPORTE}`, "i"));
  if (anual) poner("importeAnual", "Importe anual", anual, numeroEs(anual.m[1]));

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

  return {
    version: VERSION_LECTOR, tipo: tipo && tipo[1] > 3 ? tipo[0] : null, clase, tablas,
    datos, requisitos: requisitos.slice(0, 40).map(({ texto, pagina }) => ({ texto, pagina })), indice: indice.slice(0, 120),
    listas: { fracciones: lista(FRACCIONES), limpieza: lista(SERVICIOS_LIMPIEZA), ambiental: lista(AMBIENTAL), frecuencias },
    paginas: paginas.length, conTexto,
  };
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

// ── Tablas de cantidades ──
// Los anexos traen las cantidades en tablas («RSU 664 664 664 664», «Suma
// contenedores 2.709 1.327 1.877 5.913»). En el texto del PDF cada fila es una
// línea: un concepto y tres o más cifras. El título de la tabla es la última
// línea sin cifras antes de las filas (o la que trae «AÑO», «TURNO»…), y una
// línea corta en mayúsculas entre filas («SOTERRADO») es un grupo.
const NUM = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?`;
const FILA = new RegExp(String.raw`^(.{2,60}?[A-Za-zÁÉÍÓÚÑáéíóúñ)º.])\s+((?:(?:${NUM})\s+){2,}(?:${NUM}))(?=\s|$)`);
const RUIDO = /firmado|verificaci|c[oó]digo|p[aá]gina|copia aut[eé]ntica|https?:|registre|registro mercantil|n\.?i\.?f/i;
export function tablasDeCantidades(paginasCrudas) {
  const tablas = [];
  let actual = null, ultimaSinCifras = null, grupo = null, cabecera = null;
  const recientes = []; // últimas líneas de texto, para dar con el título de la tabla
  const TITULO = /anexo|mantenimiento|lavado|limpieza|necesidades|programaci[oó]n|unidades|recogida|cantidades|servicio|contenedores|precios|costes/i;
  const enMayus = t => { const l = t.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, ""); return l.replace(/[^A-ZÁÉÍÓÚÑ]/g, "").length / Math.max(1, l.length) > 0.7; };
  const candidato = t => TITULO.test(t) && t.length >= 12 && t.length < 120;
  // primero un título en mayúsculas (así van las cabeceras de las tablas)
  const tituloDe = () => [...recientes].reverse().find(t => candidato(t) && enMayus(t)) || [...recientes].reverse().find(candidato) || ultimaSinCifras || "Tabla";
  paginasCrudas.forEach((p, i) => {
    for (const bruta of String(p || "").split("\n")) {
      let l = bruta.replace(/\s+/g, " ").trim();
      const ruido = l.search(RUIDO); // el pie de firma puede venir pegado a la última fila
      if (ruido === 0) continue;
      if (ruido > 0) l = l.slice(0, ruido).trim();
      if (!l) continue;
      const m = FILA.exec(l);
      if (m && !/^\d/.test(m[1]) && !/^(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|d[ií]as?\/mes)/i.test(m[1])) {
        const valores = m[2].split(" ").map(numeroEs);
        if (!actual) { actual = { titulo: tituloDe(), pagina: i + 1, cabecera, filas: [] }; tablas.push(actual); }
        actual.filas.push({ grupo, concepto: m[1].trim(), valores });
        continue;
      }
      const conCifras = /\d/.test(l);
      if (l.length < 120) { recientes.push(l); if (recientes.length > 20) recientes.shift(); }
      const corta = l.length <= 30 && l === l.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{3,}/.test(l);
      if (corta && !conCifras && actual) { grupo = l; continue; }
      if (/\b(?:a[nñ]o|turno|periodo|lote)\b/i.test(l) && l.length < 120) cabecera = l;
      if (!conCifras || /\ba[nñ]o\b/i.test(l)) {
        if (actual && actual.filas.length) actual = null;
        if (!corta || !actual) { ultimaSinCifras = l.length < 120 ? l : ultimaSinCifras; grupo = corta ? l : null; }
      }
    }
  });
  return tablas.filter(t => t.filas.length >= 2).slice(0, 40);
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
