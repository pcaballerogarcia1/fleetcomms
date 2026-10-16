// Concursos → la plantilla a subrogar.
// Cuando el pliego obliga a quedarse con el personal actual, su coste no se
// dimensiona: se calcula con la lista que publica el Ayuntamiento (categoría,
// antigüedad, jornada, sueldo bruto o coste para la empresa). Se entiende
// cualquier Excel/CSV como el inventario: por el nombre de las columnas y, si
// no, por su contenido. Sin React ni Firebase.

const norm = t => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

export const CAMPOS_PLANTILLA = {
  categoria: "Categoría / puesto", antiguedad: "Antigüedad", jornada: "Jornada (%)", bruto: "Sueldo bruto al año",
  coste: "Coste para la empresa al año", contrato: "Tipo de contrato", nombre: "Trabajador (nombre o código)",
};
const SINONIMOS = {
  categoria: /categor|puesto|grupo profesional|oficio|funcion/,
  antiguedad: /antig|fecha (de )?(alta|ingreso|incorporacion)|alta en la empresa/,
  jornada: /jornada|% ?(de )?jornada|dedicacion|parcialidad|coef/,
  coste: /coste (total|empresa|anual)|coste$|total coste|coste para la empresa|coste ss/,
  bruto: /bruto|salario|retribuci|sueldo|total devengado|importe anual/,
  contrato: /tipo (de )?contrato|contrato|modalidad/,
  nombre: /^(nombre|trabajador|empleado|dni|codigo|n[ºo°]|id)$/,
};
const numero = v => {
  if (typeof v === "number") return v;
  const t = String(v ?? "").replace(/€|\s/g, "");
  if (!t) return null;
  const n = Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Cómo se entiende la hoja: { cabecera, columnas: { campo: índice }, nombres } */
export function entenderPlantilla(matriz) {
  const filas = (matriz || []).filter(Array.isArray);
  let cab = -1, mejor = 0;
  filas.slice(0, 15).forEach((f, i) => {
    const n = f.filter(h => Object.values(SINONIMOS).some(re => re.test(norm(h)))).length;
    if (n > mejor) { mejor = n; cab = i; }
  });
  const nombres = (cab >= 0 ? filas[cab] : filas[0] || []).map((h, i) => String(h ?? "").trim() || `Columna ${i + 1}`);
  const columnas = {};
  const usadas = new Set();
  // coste antes que bruto («coste bruto anual» es coste)
  for (const k of ["coste", "categoria", "antiguedad", "jornada", "bruto", "contrato", "nombre"]) {
    const i = nombres.findIndex((h, j) => !usadas.has(j) && SINONIMOS[k].test(norm(h)));
    if (i >= 0) { columnas[k] = i; usadas.add(i); }
  }
  return { cabecera: cab, columnas, nombres };
}

/**
 * El coste de la plantilla.
 * @param o { ssPct: Seguridad Social de la empresa (si solo hay bruto), absentismoPct: cobertura de bajas y vacaciones }
 * @returns { personas, etc, coste, porCategoria: [{ categoria, personas, etc, coste }], error }
 */
export function costePlantilla(matriz, entendido = entenderPlantilla(matriz), { ssPct = 33, absentismoPct = 5 } = {}) {
  const { cabecera, columnas: c } = entendido;
  if (c.coste == null && c.bruto == null) return { personas: 0, etc: 0, coste: 0, porCategoria: [], error: "No encuentro el sueldo ni el coste: dime cuál es la columna." };
  const filas = (matriz || []).slice(cabecera + 1).filter(f => Array.isArray(f) && f.some(x => String(x ?? "").trim()));
  const cats = new Map();
  let personas = 0, etc = 0, coste = 0;
  for (const f of filas) {
    const costeFila = c.coste != null ? numero(f[c.coste]) : null;
    const bruto = c.bruto != null ? numero(f[c.bruto]) : null;
    if (!(costeFila > 0) && !(bruto > 0)) continue; // totales, líneas vacías
    if (c.categoria != null && /^total/i.test(String(f[c.categoria] ?? ""))) continue;
    let jornada = c.jornada != null ? numero(f[c.jornada]) : 100;
    if (jornada == null) jornada = 100;
    if (jornada <= 1.5) jornada *= 100; // 0,5 = 50 %
    const anual = (costeFila > 0 ? costeFila : bruto * (1 + ssPct / 100)) * (1 + absentismoPct / 100);
    const cat = c.categoria != null ? String(f[c.categoria] ?? "").trim() || "Sin categoría" : "Plantilla";
    const x = cats.get(cat) || { categoria: cat, personas: 0, etc: 0, coste: 0 };
    x.personas += 1; x.etc += jornada / 100; x.coste += anual;
    cats.set(cat, x);
    personas += 1; etc += jornada / 100; coste += anual;
  }
  if (!personas) return { personas: 0, etc: 0, coste: 0, porCategoria: [], error: "No sale ningún trabajador con sueldo o coste." };
  return { personas, etc: Math.round(etc * 100) / 100, coste: Math.round(coste * 100) / 100, porCategoria: [...cats.values()].sort((a, b) => b.coste - a.coste), absentismoPct, ssPct: c.coste != null ? null : ssPct };
}
