// Concursos → la parte técnica del pliego, para dimensionar: los servicios con
// su cantidad al año aunque no vengan en una tabla de contenedores.
//  · Por frecuencias: «ZONA 1 CASCO HISTÓRICO … • Barrido manual, 6 veces por
//    semana» → Barrido manual en la zona 1, 312 pasadas al año.
//  · Por mediciones del presupuesto: «Servicio de transporte de fangos EDAR
//    Arguineguín … 260,00 t 21,08€ 5.480,8€» → 260 t a 21,08 €/t.
//  · El personal que exige: «un Jefe de Servicio con dedicación del 25 % …,
//    4 peones especialistas y 4 peones».
// Sin React ni Firebase: se prueba sola.

const sinAcentos = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const NUM_LETRA = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };
const numero = t => (/^\d+$/.test(t) ? Number(t) : NUM_LETRA[sinAcentos(t)] ?? null);
const importe = t => Number(String(t).replace(/\./g, "").replace(",", "."));

const lineasDe = paginas => {
  const out = [];
  (paginas || []).forEach((p, i) => String(p || "").split("\n").forEach(l => {
    const t = l.replace(/\s+/g, " ").trim();
    if (t) out.push({ t, pagina: i + 1 });
  }));
  return out;
};

// ── Frecuencias → veces al año ──
const N = "(\\d+|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce)";
const FRECUENCIAS = [
  [new RegExp(`${N} (?:veces|pasadas|servicios) (?:a la|por|cada|en la) semana`, "i"), n => n * 52],
  [new RegExp(`${N} (?:veces|pasadas|servicios) (?:al|por|cada|en el) d[ií]a`, "i"), n => n * 365],
  [new RegExp(`${N} (?:veces|pasadas|servicios) (?:al|por|cada|en el) mes`, "i"), n => n * 12],
  [new RegExp(`${N} (?:veces|pasadas|servicios) (?:al|por|cada|en el) trimestre`, "i"), n => n * 4],
  [new RegExp(`${N} (?:veces|pasadas|servicios) (?:al|por|cada|en el) a[nñ]o`, "i"), n => n],
  [/cada (\d+) d[ií]as/i, n => Math.round(365 / n)],
  [/cada (\d+) semanas/i, n => Math.round(52 / n)],
  [/cada (\d+) meses/i, n => Math.round(12 / n)],
  [/d[ií]as alternos/i, () => 182],
  [/\bdiari[oa]s?\b|\bdiariamente\b|todos los d[ií]as/i, () => 365],
  [/\bsemanal(?:es|mente)?\b/i, () => 52],
  [/\bquincenal(?:es|mente)?\b/i, () => 24],
  [/\bmensual(?:es|mente)?\b/i, () => 12],
  [/\btrimestral(?:es|mente)?\b/i, () => 4],
  [/\bsemestral(?:es|mente)?\b/i, () => 2],
  [/\banual(?:es|mente)?\b|una vez al a[nñ]o/i, () => 1],
];
/** «6 veces por semana» → { veces: 312, texto: "6 veces por semana" } */
export function vecesAlAnio(texto) {
  for (const [re, f] of FRECUENCIAS) {
    const m = re.exec(texto);
    if (!m) continue;
    const n = m[1] != null ? numero(m[1]) : 1;
    if (n == null) continue;
    return { veces: f(n), texto: m[0] };
  }
  return null;
}

// Las operaciones de limpieza y recogida que se reconocen en una viñeta
const OPERACIONES = /barrido|baldeo|fregado|hidrolimpi|papeleras|recogida|lavado|limpieza|desbroce|riego|siega|poda|vaciado|retirada|mantenimiento|revisi[oó]n|desinfecci|desratizaci|transporte/i;
const ZONA = /^(?:(ZONA|NIVEL|SECTOR|[AÁ]REA|DISTRITO|BARRIO)\s+([\dIVX]{1,4}|[A-Z])\b[\s.:–-]*(.{0,70}))$/i;
const VIÑETA = /^[•·▪\-–o*✓]\s*/;

/**
 * Servicios por frecuencias: viñetas «Operación, frecuencia» (o «Operación:
 * frecuencia»), agrupadas por la zona o nivel bajo el que aparecen.
 * @returns [{ nombre, zona, cantidadAnual, frecuencia, pagina, frase }]
 */
export function serviciosPorFrecuencia(paginas) {
  const out = [], vistos = new Set();
  let zona = null;
  for (const { t, pagina } of lineasDe(paginas)) {
    const z = ZONA.exec(t);
    if (z && t.length <= 80 && !/[.;]$/.test(t)) { zona = `${z[1][0].toUpperCase()}${z[1].slice(1).toLowerCase()} ${z[2]}${z[3] ? ` · ${z[3].replace(/[.:]+$/, "").trim()}` : ""}`; continue; }
    if (!VIÑETA.test(t) && !/^[A-ZÁÉÍÓÚ][a-záéíóúñ ]{3,40}[,:]\s/.test(t)) continue;
    const s = t.replace(VIÑETA, "");
    const m = /^([^,:;]{3,60}?)\s*[,:]\s*(.+)$/.exec(s);
    if (!m || !OPERACIONES.test(m[1])) continue;
    const f = vecesAlAnio(m[2]);
    if (!f) continue;
    const nombre = m[1].trim().replace(/^./, c => c.toUpperCase());
    const k = `${sinAcentos(nombre)}|${zona || ""}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push({ nombre, zona, cantidadAnual: f.veces, frecuencia: f.texto, pagina, frase: t });
  }
  return out;
}

// ── Mediciones del presupuesto ──
const UNIDAD = "(t|tn|tm|kg|m3|m³|m2|m²|ml|km|h|horas?|ud|uds|u|viajes?|servicios?|mes(?:es)?|jornadas?|contenedores?|d[ií]as?)";
const MEDICION = new RegExp(`^(\\d{1,3}(?:\\.\\d{3})*(?:,\\d{1,3})?)\\s*${UNIDAD}\\s+(\\d{1,3}(?:\\.\\d{3})*,\\d{1,4})\\s*€?\\s+(\\d{1,3}(?:\\.\\d{3})*,\\d{1,2})\\s*€?$`, "i");
const NO_DESCRIPCION = /€|^descripci|^importe|^total|^uds?\b|^n[ºo°]\b|^\(sin |^precio|^\d+\s*\|\s*\d+|^p[aá]gina|^\d+$|^licitaci/i;

/**
 * Líneas de mediciones: la descripción (las líneas de antes) y «cantidad
 * unidad precio importe», cuando cantidad × precio = importe.
 * @returns [{ nombre, cantidad, unidad, precio, importe, pagina }]
 */
export function serviciosPorMediciones(paginas) {
  const lineas = lineasDe(paginas), out = [], vistos = new Set();
  lineas.forEach(({ t, pagina }, k) => {
    const m = MEDICION.exec(t);
    if (!m) return;
    const cantidad = importe(m[1]), precio = importe(m[3]), total = importe(m[4]);
    if (!(cantidad > 0 && precio > 0) || Math.abs(cantidad * precio - total) > Math.max(1, total * 0.01)) return;
    const desc = [];
    for (let j = k - 1; j >= 0 && desc.length < 6; j--) {
      const x = lineas[j].t;
      if (MEDICION.test(x) || NO_DESCRIPCION.test(x)) { if (desc.length) break; else continue; }
      desc.unshift(x);
    }
    if (!desc.length) return;
    const texto = desc.join(" ").replace(/\s+/g, " ");
    const nombre = (texto.split(/[.;]|,\s*(?:tasa|seg[uú]n|incluid)/i)[0] || texto).trim().slice(0, 110);
    const unidad = m[2].toLowerCase().replace(/^tn$|^tm$/, "t");
    const kk = `${cantidad}|${unidad}|${precio}`; // el mismo cuadro sale otra vez en el modelo de oferta
    if (vistos.has(kk)) return;
    vistos.add(kk);
    out.push({ nombre, cantidad, unidad, precio, importe: total, pagina, frase: `${texto} ${t}` });
  });
  return out;
}

// ── Personal que exige el pliego ──
const PUESTOS = "(jefes? de servicio|jefes? de equipo|encargad[oa]s?|capataz|capataces|conductor(?:es)?(?:[ -]maquinistas?)?|peones? especialistas?|peones?|operari[oa]s?|oficiales?|mec[aá]nicos?|administrativ[oa]s?|vigilantes?|limpiador(?:es|as)?|jardiner[oa]s?|t[eé]cnicos?)";
const PERSONAL = new RegExp(`\\b(\\d{1,3}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\\s+${PUESTOS}\\b(?=([^.;,]{0,90}))`, "gi"); // lo de detrás (dedicación) sin comérselo: «4 peones especialistas y 4 peones»
const CONTEXTO_PERSONAL = /dispondr[aá]|adscribir|adscrito|plantilla|personal m[ií]nimo|como m[ií]nimo|contar[aá] con|equipo humano|medios humanos/i;

/**
 * El personal mínimo que pide el pliego, en las frases que hablan de adscribir
 * o disponer de personal: [{ puesto, uds, dedicacionPct, pagina, frase }]
 */
export function personalExigido(paginas) {
  const out = [];
  (paginas || []).forEach((p, i) => {
    const texto = String(p || "").replace(/\s+/g, " ");
    for (const frase of texto.split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚ])/)) {
      if (!CONTEXTO_PERSONAL.test(frase) || /subrogaci|subrogar/i.test(frase.slice(0, 60))) continue;
      for (const m of frase.matchAll(PERSONAL)) {
        const uds = numero(m[1]);
        if (!uds || uds > 300) continue;
        const ded = /dedicaci[oó]n del?\s*(\d{1,3})\s*%/i.exec(m[3] || "");
        const puesto = m[2].replace(/^./, c => c.toUpperCase());
        if (out.some(o => sinAcentos(o.puesto) === sinAcentos(puesto) && o.uds === uds)) continue;
        out.push({ puesto, uds, dedicacionPct: ded ? Number(ded[1]) : 100, pagina: i + 1, frase: frase.slice(0, 260) });
      }
      if (out.length) return;
    }
  });
  return out;
}

/** La lista del personal exigido, en texto para la ficha: «1 Jefe de servicio (25 %) · 4 Peones especialistas · 4 Peones» */
export const textoPersonal = lista => (lista || []).map(p => `${p.uds} ${p.puesto}${p.dedicacionPct && p.dedicacionPct < 100 ? ` (${p.dedicacionPct} %)` : ""}`).join(" · ");

const MANDOS_JEFE = /jefe de servicio|t[eé]cnico/i, MANDOS = /encargad|capataz|jefe de equipo/i;
/**
 * Ese texto (o el que escriba el usuario) → lo mínimo para la plantilla:
 * { operarios, encargados, jefe (en jornadas: 0,25 = un 25 %) } o null
 */
export function minimoDePersonal(texto) {
  if (!texto) return null;
  const r = { operarios: 0, encargados: 0, jefe: 0 };
  for (const parte of String(texto).split(/·|;|\n|,(?=\s*\d)/)) {
    const m = /^\s*(\d{1,3}(?:[.,]\d+)?)\s+([^(]+?)\s*(?:\((\d{1,3})\s*%\))?\s*$/.exec(parte);
    if (!m) continue;
    const uds = Number(m[1].replace(",", ".")), ded = m[3] ? Number(m[3]) / 100 : 1;
    if (MANDOS_JEFE.test(m[2])) r.jefe += uds * ded;
    else if (MANDOS.test(m[2])) r.encargados += uds * ded;
    else r.operarios += uds * ded;
  }
  return r.operarios || r.encargados || r.jefe ? r : null;
}
