// Concursos → el estudio de costes del Ayuntamiento.
// Muchos pliegos técnicos traen en un anexo cómo se ha calculado el
// presupuesto: personal (categorías con su coste al año), inversión
// (amortización y financiación), funcionamiento y mantenimiento, seguros,
// otros gastos; luego gastos generales y beneficio, IVA, y a veces la tabla
// de cada año del contrato con lo que sube la mano de obra y el resto. Es la
// mejor referencia de lo que cuesta el servicio: Cálculo parte de aquí.
// Sin React ni Firebase.

const NUM = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?`;
const EUROS = new RegExp(String.raw`(${NUM})\s*€`, "g");
const PCT = /(\d{1,2}(?:,\d{1,2})?)\s*%/g;
const n = s => Number(String(s).replace(/\./g, "").replace(",", "."));
const sinAcentos = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
// «T OTAL», «EXPLOT ACION»: el PDF parte algunas palabras en mayúsculas
const junta = t => t.replace(/\bT\s?O\s?T\s?A\s?L\b/g, "TOTAL").replace(/T OTAL/g, "TOTAL").replace(/EXPLOT ACI/g, "EXPLOTACI").replace(/OT ROS/g, "OTROS").replace(/COST E/g, "COSTE").replace(/LICIT ACI/g, "LICITACI").replace(/OT AL/g, "OTAL");

// las partidas del estudio, por su título
export const PARTIDAS_ESTUDIO = [
  { id: "personal", nombre: "Personal", re: /PERSONAL|MANO DE OBRA/ },
  { id: "inversion", nombre: "Inversión (amortización y financiación)", re: /INVERSI|AMORTIZ/ },
  { id: "funcionamiento", nombre: "Funcionamiento y mantenimiento", re: /FUNCIONAMIENTO|MANTENIMIENTO|EXPLOTACI|BIENES CORRIENTES/ },
  { id: "seguros", nombre: "Seguros", re: /SEGUROS/ },
  { id: "otros", nombre: "Otros gastos", re: /OTROS GASTOS|GASTOS VARIOS|OTROS/ },
];
const partidaDe = t => PARTIDAS_ESTUDIO.find(p => p.re.test(sinAcentos(t)));
const CLAVES = /PERSONAL|INVERSI|AMORTIZ|FUNCIONAMIENTO|BIENES CORRIENTES|SEGUROS|OTROS GASTOS|OTROS COSTES|GASTOS GENERALES|BENEFICIO INDUSTRIAL|BASE IMPONIBLE|\bIVA\b/g;

/**
 * El estudio de costes de un pliego, si lo trae.
 * @param paginasCrudas [texto de cada página, con saltos de línea]
 * @returns null | { pagina, partidas: [{ id, nombre, total, lineas: [{ uds, concepto, unitario, total }] }],
 *   costeEjecucion, ggbiPct, ggbi, baseImponible, ivaPct, iva, totalConIva,
 *   incrementos: { manoObra: [%], resto: [%] }, anios: { base: [€], conIva: [€] }, valorEstimado, cuadra }
 */
export function estudioDeCostes(paginasCrudas = []) {
  // las páginas del estudio: las que más claves de coste tienen (y las seguidas)
  const euros = paginasCrudas.map(p => (String(p).match(EUROS) || []).length);
  const notas = paginasCrudas.map((p, i) => (euros[i] >= 8 ? (sinAcentos(p).match(CLAVES) || []).length : 0));
  const inicio = notas.findIndex(x => x >= 3);
  if (inicio < 0) return null;
  let fin = inicio;
  while (fin + 1 < paginasCrudas.length && euros[fin + 1] >= 4) fin++;

  const r = { pagina: inicio + 1, partidas: [], incrementos: { manoObra: [], resto: [] }, anios: { base: [], conIva: [] } };
  let actual = null, pendiente = "";
  const lineas = [];
  for (let i = inicio; i <= fin; i++) for (const l of String(paginasCrudas[i]).split("\n")) lineas.push({ t: junta(l.replace(/\s+/g, " ").trim()), pagina: i + 1 });

  for (const { t } of lineas) {
    if (!t) continue;
    const T = sinAcentos(t);
    const euros = [...t.matchAll(EUROS)].map(m => n(m[1]));
    // título de partida con su total en la misma línea: «1.GASTOS DE PERSONAL 260.672,50 €»
    const titTotal = t.match(/^(\d{1,2})\s*[.\-–]*\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ()/,.´'-]{3,80}?)\s+(\d[\d.,]*)\s*€$/);
    if (titTotal && partidaDe(titTotal[2])) {
      const p = partidaDe(titTotal[2]);
      actual = r.partidas.find(x => x.id === p.id) || { id: p.id, nombre: p.nombre, titulo: titTotal[2].trim(), total: null, lineas: [] };
      if (!r.partidas.includes(actual)) r.partidas.push(actual);
      if (actual.total == null) actual.total = n(titTotal[3]);
      pendiente = ""; continue;
    }
    // el final de esa forma: «SUMA 420.505,15 €», «BENEFICIO INDUSTRIAL (8%) 33.640,41 €», «Total Coste Contrato …», «IVA (10%) …»
    if (euros.length === 1) {
      if (/^SUMA\b|^TOTAL COSTES? (?:DE )?EJECUCION/.test(T) && r.costeEjecucion == null) { r.costeEjecucion = euros[0]; continue; }
      const bi = T.match(/^(?:GASTOS GENERALES Y )?BENEFICIO INDUSTRIAL\s*\((\d{1,2}(?:,\d+)?)\s*%\)/);
      if (bi && r.ggbi == null) { r.ggbiPct = n(bi[1]); r.ggbi = euros[0]; continue; }
      if (/^TOTAL COSTE (?:DEL )?CONTRATO/.test(T) && r.baseImponible == null) { r.baseImponible = euros[0]; continue; }
      const iv = T.match(/^IVA\s*\((\d{1,2}(?:,\d+)?)\s*%\)/);
      if (iv && r.ivaPct == null) { r.ivaPct = n(iv[1]); r.iva = euros[0]; continue; }
      if (/^IMPORTE TOTAL DEL CONTRATO/.test(T) && r.totalConIva == null) { r.totalConIva = euros[0]; continue; }
      // una línea de la partida sin unidades: «Carburantes y lubricantes 33.288,61 €» (no los subtotales «2.1 …»)
      if (actual && /^[A-ZÁÉÍÓÚÑa-záéíóúñ]/.test(t) && !/^TOTAL|VALOR ESTIMADO|PRESUPUESTO|BASE IMPONIBLE|LICITACION/.test(T)) {
        actual.lineas.push({ uds: null, concepto: t.replace(/\s*\d[\d.,]*\s*€\s*$/, "").trim(), unitario: null, total: euros[0] });
        continue;
      }
    }
    // título de partida: «1.- PERSONAL», «2.- INVERSIÓN (AMORTIZACIÓN Y FINANCIACIÓN)»
    const tit = t.match(/^(\d{1,2})\s*[.\-–]+\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ()/,.-]{3,80})$/);
    if (tit && partidaDe(tit[2])) {
      const p = partidaDe(tit[2]);
      actual = r.partidas.find(x => x.id === p.id) || { id: p.id, nombre: p.nombre, titulo: tit[2].trim(), total: null, lineas: [] };
      if (!r.partidas.includes(actual)) r.partidas.push(actual);
      pendiente = ""; continue;
    }
    // la tabla de los años: una fila con muchas cifras
    if (euros.length >= 5) {
      if (/BASE IMPONIBLE/.test(T)) r.anios.base = euros;
      else if (/PRESUPUESTO TOTAL|BASE LICITACION|TOTAL PRESUPUESTO/.test(T)) r.anios.conIva = euros;
      continue;
    }
    const pcts = [...t.matchAll(PCT)].map(m => n(m[1]));
    if (pcts.length >= 3 && !euros.length) {
      if (/M\.?\s?O\.?|MANO DE OBRA|PERSONAL/.test(T)) r.incrementos.manoObra = pcts;
      else if (/RESTO/.test(T)) r.incrementos.resto = pcts;
      continue;
    }
    // totales y porcentajes del final
    const gg = t.match(/(\d{1,2}(?:,\d+)?)\s*%\s*Gastos generales(?: y)? (?:Beneficio industrial)?[^€]*?(\d[\d.,]*)\s*€/i);
    if (gg) { r.ggbiPct = n(gg[1]); r.ggbi = n(gg[2]); continue; }
    const iva = t.match(/^(\d{1,2}(?:,\d+)?)\s*%\s*IVA\s+(\d[\d.,]*)\s*€/i);
    if (iva) { r.ivaPct = n(iva[1]); r.iva = n(iva[2]); continue; }
    if (/^TOTAL/.test(T) && euros.length) {
      const v = euros[euros.length - 1];
      if (/GASTOS DEL SERVICIO|EJECUCION MATERIAL|COSTE DE EJECUCION|TOTAL GASTOS$/.test(T) && r.costeEjecucion == null) r.costeEjecucion = v;
      else if (/EJECUCION SERVICIO|BASE IMPONIBLE|PRESUPUESTO DE EJECUCION POR CONTRATA/.test(T) && r.baseImponible == null) r.baseImponible = v;
      else if (/COSTE ANUAL|IVA INCLUIDO|PRESUPUESTO TOTAL/.test(T) && r.totalConIva == null) r.totalConIva = v;
      else {
        const p = partidaDe(t.replace(/^TOTAL\s*/i, ""));
        const destino = (p && r.partidas.find(x => x.id === p.id)) || actual;
        if (destino && destino.total == null) destino.total = v;
      }
      pendiente = ""; continue;
    }
    const ve = t.match(/VALOR ESTIMADO[^€]*?(\d[\d.,]*)\s*€/i);
    if (ve) { r.valorEstimado = n(ve[1]); continue; }
    // una línea de la partida: «2,14 Peón RBU día 23.379,27 € 49.941,49 €»
    if (actual && !/^(uds|ud\.?|unidades)\b/i.test(t)) {
      const conPendiente = pendiente ? `${pendiente} ${t}` : t;
      if (!euros.length) { if (/^\d[\d.,]*(\s|$)/.test(t) || pendiente) pendiente = conPendiente.slice(0, 300); continue; }
      const m = conPendiente.match(/^(\d{1,4}(?:[.,]\d{1,2})?)\s+(.+?)\s+\d[\d.,]*\s*€/);
      if (m && !/se obtiene|presupuesto base|señal/i.test(conPendiente)) {
        actual.lineas.push({ uds: n(m[1]), concepto: m[2].replace(/\s+\d[\d.,]*\s*€.*$/, "").trim(), unitario: euros.length > 1 ? euros[0] : null, total: euros[euros.length - 1] });
      }
      pendiente = "";
    }
  }
  if (!r.partidas.length || r.partidas.every(p => p.total == null)) return null;
  // las partidas sin total: la suma de sus líneas
  for (const p of r.partidas) if (p.total == null && p.lineas.length) p.total = Math.round(p.lineas.reduce((s, l) => s + (l.total || 0), 0) * 100) / 100;
  const suma = r.partidas.reduce((s, p) => s + (p.total || 0), 0);
  if (r.costeEjecucion == null) r.costeEjecucion = suma;
  if (r.baseImponible == null && r.ggbi != null) r.baseImponible = r.costeEjecucion + r.ggbi;
  if (r.ggbiPct == null && r.baseImponible && r.costeEjecucion) r.ggbiPct = Math.round((r.baseImponible / r.costeEjecucion - 1) * 1000) / 10;
  if (!r.anios.base.length && r.baseImponible) r.anios.base = [r.baseImponible];
  r.cuadra = Math.abs(suma - r.costeEjecucion) <= Math.max(5, r.costeEjecucion * 0.01);
  r.sumaPartidas = Math.round(suma * 100) / 100;
  return r;
}

/** Lo que sube cada año: el del estudio o, si no lo trae, el que se diga (en %) */
export function subidaAnio(estudio, k, { manoObra = 2.5, resto = 2 } = {}) {
  const mo = estudio?.incrementos?.manoObra?.[k - 1], re = estudio?.incrementos?.resto?.[k - 1];
  return { manoObra: mo ?? manoObra, resto: re ?? resto };
}
