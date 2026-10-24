// La ficha de cada trabajador: los datos personales y laborales que se
// guardan con él (además de nombre, turno, rol y vehículo). La usan el
// formulario de Recursos y la subida desde Excel. Sin React ni Firebase.

/** Los campos de la ficha: k (nombre en la base de datos), l (etiqueta), sin (columnas del Excel que valen), tipo */
export const CAMPOS_FICHA = [
  { k: "dni", l: "DNI / NIE", sin: ["dni", "nie", "dni nie", "d n i", "n i e", "documento", "nif", "n i f", "documento de identidad"] },
  { k: "fechaNacimiento", l: "Fecha de nacimiento", sin: ["fecha de nacimiento", "fecha nacimiento", "nacimiento", "f nacimiento"], tipo: "fecha" },
  { k: "edad", l: "Edad", sin: ["edad"], tipo: "numero" },
  { k: "nacionalidad", l: "Nacionalidad", sin: ["nacionalidad", "pais", "pais de origen"] },
  { k: "categoria", l: "Categoría profesional", sin: ["categoria", "categoria profesional", "grupo profesional", "nivel"] },
  { k: "email", l: "Correo electrónico", sin: ["email", "e mail", "correo", "correo electronico", "mail"], tipo: "email" },
  { k: "telefono", l: "Teléfono", sin: ["telefono", "movil", "tlf", "telefono movil", "telf"] },
  { k: "direccion", l: "Dirección", sin: ["direccion", "domicilio", "direccion postal"] },
  { k: "carnet", l: "Permiso de conducir", sin: ["carnet", "carne", "permiso de conducir", "permiso", "licencia", "carnet de conducir"] },
  { k: "fechaAlta", l: "Fecha de alta", sin: ["fecha de alta", "alta", "antiguedad", "fecha antiguedad", "fecha ingreso", "fecha de ingreso"], tipo: "fecha" },
  { k: "notas", l: "Notas", sin: ["notas", "observaciones", "comentarios"] },
];

/**
 * Una fecha de un Excel o escrita a mano → «AAAA-MM-DD» (o "" si no se entiende).
 * Vale el número de serie de Excel, «dd/mm/aaaa», «dd-mm-aa» y «aaaa-mm-dd».
 */
export function fechaISO(v) {
  if (v == null || v === "") return "";
  if (typeof v === "string" && /^\d{5}(\.\d+)?$/.test(v.trim())) v = +v; // número de serie de Excel leído como texto
  if (typeof v === "number" && v > 1000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const t = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y += y > (new Date().getFullYear() % 100) ? 1900 : 2000;
    const mes = +m[2], dia = +m[1];
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return "";
    return `${y}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  }
  return "";
}

/** La edad de hoy: por la fecha de nacimiento si la hay, si no la escrita */
export function edadDe(t, hoy = new Date()) {
  const f = fechaISO(t?.fechaNacimiento);
  if (f) {
    const [y, m, d] = f.split("-").map(Number);
    let e = hoy.getFullYear() - y;
    if (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) e--;
    return e >= 0 && e < 120 ? e : null;
  }
  const n = parseInt(t?.edad, 10);
  return Number.isFinite(n) && n > 0 && n < 120 ? n : null;
}

/** Normaliza el valor de un campo de la ficha (fechas a AAAA-MM-DD, edad a número, el resto texto) */
export function valorFicha(campo, v) {
  if (campo.tipo === "fecha") return fechaISO(v);
  if (campo.tipo === "numero") { const n = parseInt(String(v ?? "").replace(/\D/g, ""), 10); return Number.isFinite(n) ? n : ""; }
  if (campo.tipo === "email") return String(v ?? "").trim().toLowerCase();
  return String(v ?? "").trim();
}
