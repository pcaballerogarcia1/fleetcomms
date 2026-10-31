// La ficha de cada vehículo: los datos que se guardan con él (además de
// nombre, matrícula, tipo, capacidad y turno). La autonomía (km que hace en un
// día con una carga o un depósito) y la carga máxima por viaje (kg, palés…) las
// respeta el Scheduling: ninguna ruta del vehículo pasa de ahí. La usan el formulario de Recursos y la subida desde
// Excel. Sin React ni Firebase.
import { fechaISO } from "./trabajador-ficha.js";

export const COMBUSTIBLES = ["Diésel", "Gasolina", "Eléctrico", "Híbrido", "Híbrido enchufable", "GNC (gas natural)", "GLP", "Hidrógeno", "HVO / biodiésel"];
export const PROPIEDAD = ["Propio", "Renting", "Leasing", "Alquiler"];

/** k (en la base de datos), l (etiqueta), sin (columnas del Excel que valen, ya normalizadas), tipo */
export const CAMPOS_FICHA_VEHICULO = [
  { k: "marca", l: "Marca", sin: ["marca", "fabricante"] },
  { k: "modelo", l: "Modelo", sin: ["modelo"] },
  { k: "bastidor", l: "Nº de bastidor", sin: ["bastidor", "n de bastidor", "n bastidor", "numero de bastidor", "vin", "chasis"] },
  { k: "fechaMatriculacion", l: "Fecha de matriculación", sin: ["fecha de matriculacion", "fecha matriculacion", "matriculacion", "primera matriculacion", "ano"], tipo: "fecha" },
  { k: "fechaAlta", l: "Fecha de alta", sin: ["fecha de alta", "alta", "fecha alta", "fecha de compra", "compra"], tipo: "fecha" },
  { k: "propiedad", l: "Propiedad", sin: ["propiedad", "regimen", "tenencia"], tipo: "opciones", opciones: PROPIEDAD },
  { k: "combustible", l: "Combustible", sin: ["combustible", "energia", "carburante", "motorizacion", "propulsion"], tipo: "opciones", opciones: COMBUSTIBLES },
  { k: "autonomiaKm", l: "Autonomía (km al día, con una carga o depósito)", sin: ["autonomia", "autonomia km", "km autonomia", "rango", "range"], tipo: "decimal" },
  { k: "cargaMax", l: "Carga máxima por viaje (kg, palés, cajas… en la misma unidad que la demanda de las paradas)", sin: ["carga maxima", "carga util", "carga util kg", "carga maxima kg", "palets", "pales", "n palets", "numero de palets", "carga por viaje"], tipo: "decimal" },
  { k: "consumo", l: "Consumo (litros o kWh cada 100 km)", sin: ["consumo", "consumo 100 km", "consumo l 100 km", "consumo kwh 100 km", "l 100 km", "kwh 100 km"], tipo: "decimal" },
  { k: "deposito", l: "Depósito o batería (litros o kWh)", sin: ["deposito", "deposito l o kwh", "deposito o bateria", "capacidad deposito", "bateria", "capacidad bateria", "kwh"], tipo: "decimal" },
  { k: "mma", l: "MMA (kg)", sin: ["mma", "masa maxima", "peso maximo", "mma kg"], tipo: "decimal" },
  { k: "tara", l: "Tara (kg)", sin: ["tara", "peso en vacio", "tara kg"], tipo: "decimal" },
  { k: "plazas", l: "Plazas", sin: ["plazas", "asientos", "ocupantes"], tipo: "decimal" },
  { k: "kmActuales", l: "Km actuales (cuentakilómetros)", sin: ["km", "km actuales", "kilometros", "kilometraje", "cuentakilometros", "odometro"], tipo: "decimal" },
  { k: "proximaITV", l: "Próxima ITV", sin: ["itv", "proxima itv", "fecha itv", "caducidad itv"], tipo: "fecha" },
  { k: "seguroVence", l: "El seguro vence", sin: ["seguro", "vencimiento seguro", "seguro vence", "fecha seguro", "poliza"], tipo: "fecha" },
  { k: "notas", l: "Notas", sin: ["notas", "observaciones", "comentarios"] },
];

const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Un número escrito a la española («12.000», «18,5», «300 km») → número, o "" */
export function decimal(v) {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : "";
  let t = String(v ?? "").trim().replace(/[^\d.,-]/g, "");
  if (!t) return "";
  if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "").replace(",", ".");
  else if (t.includes(",")) t = t.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = parseFloat(t);
  return Number.isFinite(n) && n >= 0 ? n : "";
}

/** Un valor de una lista cerrada: el que encaje sin tildes ni mayúsculas (o el texto tal cual) */
function opcion(campo, v) {
  const x = norm(v);
  if (!x) return "";
  if (campo.k === "combustible") {
    if (/electr|bev|bateria/.test(x)) return "Eléctrico";
    if (/enchuf|phev/.test(x)) return "Híbrido enchufable";
    if (/hibrid|hev/.test(x)) return "Híbrido";
    if (/gnc|gas natural|cng|gnl|lng/.test(x)) return "GNC (gas natural)";
    if (/glp|lpg|autogas/.test(x)) return "GLP";
    if (/hidrog|h2|pila/.test(x)) return "Hidrógeno";
    if (/hvo|biodi|bio/.test(x)) return "HVO / biodiésel";
    if (/diesel|gasoil|gasoleo/.test(x)) return "Diésel";
    if (/gasolin|nafta/.test(x)) return "Gasolina";
  }
  return campo.opciones.find(o => norm(o) === x) || String(v).trim();
}

/** Normaliza el valor de un campo de la ficha del vehículo */
export function valorFichaVehiculo(campo, v) {
  if (campo.tipo === "fecha") {
    if (campo.k === "fechaMatriculacion" && /^\s*\d{4}\s*$/.test(String(v ?? ""))) return `${String(v).trim()}-01-01`; // solo el año
    return fechaISO(v);
  }
  if (campo.tipo === "decimal") return decimal(v);
  if (campo.tipo === "opciones") return opcion(campo, v);
  return String(v ?? "").trim();
}

/** Días que faltan para una fecha (negativo si ya pasó), o null */
export function diasHasta(fecha, hoy = new Date()) {
  const f = fechaISO(fecha);
  if (!f) return null;
  const [y, m, d] = f.split("-").map(Number);
  const a = Date.UTC(y, m - 1, d), b = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((a - b) / 86400000);
}
