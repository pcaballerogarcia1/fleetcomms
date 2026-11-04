// Pedidos con fecha (reparto): la bandeja de cada día de un proyecto. Los
// clientes son los puntos de Planificación (la lista importada); cada pedido
// guarda una copia del cliente (nombre, dirección, coordenadas) para que el
// día se pueda planificar aunque la lista cambie después.
// Sin React ni Firebase.
//
//   pedidos/{id}        { org_id, projectId, fecha: "AAAA-MM-DD", cliente: { clave, nombre, direccion, lat, lng, telefono, contacto },
//                         ref, bultos, kg, desde, hasta, duracion, notas, estado: "pendiente" | "anulado",
//                         origen: "manual" | "excel" | "fijo", fijoId, creadoPor: { uid, nombre }, creadoEn }
//   pedidos_fijos/{id}  { org_id, projectId, cliente, dias: [1..7] (1 = lunes), ref, bultos, kg, desde, hasta, duracion, notas, activo, creadoEn }
//   (el pedido de un fijo en una fecha tiene id fijo: fijo_{fijoId}_{fecha}; si se anula, no vuelve a salir)

import { columnasDireccion, textoDireccion } from "../planning/direcciones.js";
import { decimal } from "../vehiculo-ficha.js";

export const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const campo = (fields, nombres) => {
  for (const [k, v] of Object.entries(fields || {})) if (nombres.includes(norm(k)) && String(v ?? "").trim()) return String(v).trim();
  return "";
};
const NOMBRE = ["cliente", "nombre", "nombre cliente", "razon social", "name", "empresa", "establecimiento"];
const TELEFONO = ["telefono", "tel", "tlf", "movil", "phone", "telefono contacto"];
const CONTACTO = ["persona de contacto", "persona contacto", "contacto", "contact"];
const PEDIDO = ["pedido", "n pedido", "no pedido", "num pedido", "numero de pedido", "albaran", "referencia", "ref", "order"];
const BULTOS = ["bultos", "n bultos", "cajas", "palets", "pales", "unidades", "paquetes"];
const KG = ["kg", "kilos", "peso", "peso kg"];
const DESDE = ["desde", "hora desde", "franja desde", "entrega desde"];
const HASTA = ["hasta", "hora hasta", "franja hasta", "entrega hasta"];
const NOTAS = ["notas", "nota", "observaciones", "instrucciones", "comentario"];
const DURACION = ["duracion", "duracion min", "minutos", "tiempo min"];

/** Fecha local → «AAAA-MM-DD» */
export const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Suma días a «AAAA-MM-DD» */
export function masDias(fecha, n) { const [a, m, d] = fecha.split("-").map(Number); return ymd(new Date(a, m - 1, d + n)); }
/** Día de la semana de «AAAA-MM-DD»: 1 = lunes … 7 = domingo */
export function diaSemana(fecha) { const [a, m, d] = fecha.split("-").map(Number); const w = new Date(a, m - 1, d).getDay(); return w === 0 ? 7 : w; }
export const DIAS = [[1, "L", "lunes"], [2, "M", "martes"], [3, "X", "miércoles"], [4, "J", "jueves"], [5, "V", "viernes"], [6, "S", "sábado"], [7, "D", "domingo"]];
/** «lunes 3 de noviembre» */
export function fechaLarga(fecha) {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}

/** Un número escrito a la española («1.200», «12,5»), o null */
export function numero(v) {
  const n = decimal(v);
  return n === "" || !Number.isFinite(n) ? null : n;
}
/** «9», «9:30», «09.30» → «09:30» (o "" si no se entiende) */
export function hora(v) {
  const m = String(v ?? "").trim().match(/^(\d{1,2})(?:[:.h](\d{2}))?$/);
  if (!m || +m[1] > 24 || +(m[2] || 0) > 59) return "";
  return `${m[1].padStart(2, "0")}:${m[2] || "00"}`;
}

/** Los clientes de un proyecto: los puntos de sus capas de Planificación (sin repetir) */
export function clientesDe(layers) {
  const vistos = new Map();
  for (const l of layers || []) {
    if (l.visible === false || l.lineasCloud) continue;
    for (const m of l.markers || []) {
      const lat = +m.lat, lng = +m.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const f = m.campos || m.fields || m;
      const cols = columnasDireccion(Object.keys(f));
      const direccion = (cols && textoDireccion(f, cols)) || campo(f, ["calle", "direccion"]);
      const nombre = campo(f, NOMBRE) || direccion || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      const clave = `${lat.toFixed(5)}_${lng.toFixed(5)}_${norm(nombre)}`;
      if (!vistos.has(clave)) vistos.set(clave, { clave, nombre, direccion, lat, lng, telefono: campo(f, TELEFONO), contacto: campo(f, CONTACTO) });
    }
  }
  return [...vistos.values()];
}

/** Los clientes que encajan con lo que se escribe (por nombre o dirección), los mejores primero */
export function buscarClientes(clientes, texto, max = 8) {
  const q = norm(texto);
  if (!q) return [];
  const palabras = q.split(" ");
  const puntos = c => {
    const n = norm(c.nombre), d = norm(c.direccion);
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (palabras.every(p => n.includes(p))) return 2;
    if (palabras.every(p => `${n} ${d}`.includes(p))) return 3;
    return 9;
  };
  return clientes.map(c => [puntos(c), c]).filter(([p]) => p < 9).sort((a, b) => a[0] - b[0] || a[1].nombre.localeCompare(b[1].nombre)).slice(0, max).map(x => x[1]);
}

/** El cliente cuyo nombre es exactamente ese (sin mayúsculas ni acentos), o null */
export const clientePorNombre = (clientes, nombre) => clientes.find(c => norm(c.nombre) === norm(nombre)) || null;

/** Un pedido nuevo (lo que se guarda, sin los datos de quién y cuándo) */
export function nuevoPedido({ orgId, projectId, fecha, cliente, ref, bultos, kg, desde, hasta, duracion, notas, origen = "manual", fijoId = null }) {
  return {
    org_id: orgId, projectId, fecha,
    cliente: { clave: cliente.clave || null, nombre: cliente.nombre || "", direccion: cliente.direccion || "", lat: +cliente.lat, lng: +cliente.lng, telefono: cliente.telefono || "", contacto: cliente.contacto || "" },
    ref: String(ref || "").trim(), bultos: numero(bultos), kg: numero(kg),
    desde: hora(desde), hasta: hora(hasta) || hora(desde), duracion: numero(duracion), notas: String(notas || "").trim(),
    estado: "pendiente", origen, fijoId,
  };
}

/** ¿Este fijo sale en esa fecha? */
export const aplicaFijo = (fijo, fecha) => fijo.activo !== false && (fijo.dias || []).includes(diaSemana(fecha));
/** El id del pedido de un fijo en una fecha */
export const idDeFijo = (fijoId, fecha) => `fijo_${fijoId}_${fecha}`;
/** Los pedidos que faltan por crear de los fijos de esa fecha (los que ya existen, aunque estén anulados, no) */
export function pedidosDeFijos(fijos, fecha, existentes) {
  const hay = new Set((existentes || []).map(p => p.id || p._id));
  return (fijos || []).filter(f => aplicaFijo(f, fecha) && !hay.has(idDeFijo(f.id || f._id, fecha)))
    .map(f => ({ id: idDeFijo(f.id || f._id, fecha), datos: nuevoPedido({ ...f, orgId: f.org_id, fecha, origen: "fijo", fijoId: f.id || f._id }) }));
}

/** Totales del día: { pedidos, bultos, kg, fijos } (sin los anulados) */
export function resumenDia(pedidos) {
  const vivos = (pedidos || []).filter(p => p.estado !== "anulado");
  return { pedidos: vivos.length, bultos: vivos.reduce((s, p) => s + (p.bultos || 0), 0), kg: vivos.reduce((s, p) => s + (p.kg || 0), 0), fijos: vivos.filter(p => p.origen === "fijo").length };
}

/**
 * Lo que se pega desde Excel (filas separadas por tabuladores, la primera con los títulos).
 * Cada fila: el cliente conocido por su nombre, o su dirección para situarla.
 * @returns { filas: [{ campos, cliente | null, texto | null, ref, bultos, kg, desde, hasta, duracion, notas }], error }
 */
export function leerPegado(texto, clientes) {
  const lineas = String(texto || "").replace(/\r/g, "").split("\n").filter(l => l.trim());
  if (lineas.length < 2) return { filas: [], error: "Pega la tabla con su fila de títulos (Cliente, Dirección, Pedido, Bultos…) y al menos un pedido." };
  const sep = lineas[0].includes("\t") ? "\t" : lineas[0].split(";").length > lineas[0].split(",").length ? ";" : ",";
  const titulos = lineas[0].split(sep).map(t => t.trim());
  const cols = columnasDireccion(titulos);
  if (!titulos.some(t => NOMBRE.includes(norm(t))) && !cols) return { filas: [], error: "No veo una columna «Cliente» ni «Dirección» en la primera fila." };
  const filas = lineas.slice(1).map(l => {
    const vals = l.split(sep);
    const campos = Object.fromEntries(titulos.map((t, i) => [t, (vals[i] ?? "").trim()]));
    const nombre = campo(campos, NOMBRE);
    const cliente = nombre ? clientePorNombre(clientes, nombre) : null;
    return {
      campos, nombre, cliente,
      texto: cliente ? null : (cols && textoDireccion(campos, cols)) || null,
      ref: campo(campos, PEDIDO), bultos: campo(campos, BULTOS), kg: campo(campos, KG),
      desde: campo(campos, DESDE), hasta: campo(campos, HASTA), duracion: campo(campos, DURACION), notas: campo(campos, NOTAS),
      telefono: campo(campos, TELEFONO), contacto: campo(campos, CONTACTO),
    };
  }).filter(f => f.nombre || f.texto);
  return { filas, error: filas.length ? null : "No hay ninguna fila con cliente o dirección." };
}

/** Un pedido fijo nuevo: el cliente, los días de la semana y lo de siempre */
export function nuevoFijo({ orgId, projectId, cliente, dias, ref, bultos, kg, desde, hasta, duracion, notas }) {
  const p = nuevoPedido({ orgId, projectId, fecha: null, cliente, ref, bultos, kg, desde, hasta, duracion, notas });
  return { org_id: p.org_id, projectId: p.projectId, cliente: p.cliente, dias: [...new Set(dias)].sort(), ref: p.ref, bultos: p.bultos, kg: p.kg, desde: p.desde, hasta: p.hasta, duracion: p.duracion, notas: p.notas };
}

const aMin = h => { const m = String(h || "").match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; };
/**
 * Los pedidos de un día → paradas del motor de rutas (como las de Planificación:
 * con sus columnas para el conductor, su carga, su franja y su duración).
 * Los anulados no; dos pedidos del mismo cliente van como dos paradas en el mismo sitio.
 */
export function tareasDePedidos(pedidos, duracionDefecto = null) {
  return (pedidos || []).filter(p => p.estado !== "anulado" && Number.isFinite(+p.cliente?.lat) && Number.isFinite(+p.cliente?.lng)).map(p => {
    const c = p.cliente;
    const campos = Object.fromEntries(Object.entries({
      Cliente: c.nombre, Dirección: c.direccion, Teléfono: c.telefono, "Persona de contacto": c.contacto,
      Pedido: p.ref, Bultos: p.bultos, Kg: p.kg, Notas: p.notas,
    }).filter(([, v]) => v != null && v !== ""));
    const t = { _id: `ped_${p.id}`, _pedidoId: p.id, lat: +c.lat, lng: +c.lng, nombre: c.nombre || c.direccion || "", barrio: "", campos };
    const carga = p.kg > 0 ? p.kg : p.bultos > 0 ? p.bultos : 0; // como en Planificación: si hay kilos, cuentan los kilos
    if (carga) t.demanda = carga;
    const dur = p.duracion > 0 ? p.duracion : duracionDefecto > 0 ? duracionDefecto : null;
    if (dur) t.duracion = dur;
    const desde = aMin(p.desde), hasta = aMin(p.hasta);
    if (desde != null) { t.windowStart = desde; t.windowEnd = hasta != null && hasta >= desde ? hasta : desde; }
    return t;
  });
}

/** El día del mes (1-31) de «AAAA-MM-DD» si es de ese mes «AAAA-MM»; si no, null */
export const diaDelMes = (fecha, mes) => (fecha && mes && String(fecha).slice(0, 7) === mes ? Number(String(fecha).slice(8, 10)) : null);

/**
 * El resultado en ruta de cada pedido de un día, desde las rutas publicadas
 * (planes con esa fecha): Map<pedidoId, { estado: "pendiente" | "entregada" | "no_entregada", ub, plan }>
 */
export function resultadosPorPedido(planes) {
  const m = new Map();
  for (const plan of planes || []) {
    for (const ub of plan.ubicaciones || []) {
      if (!ub.pedidoId) continue;
      const estado = ub.entrega?.estado === "no_entregada" ? "no_entregada" : ub.realizado ? "entregada" : "pendiente";
      m.set(ub.pedidoId, { estado, ub, plan });
    }
  }
  return m;
}

/** Totales de lo hecho en ruta: { entregados, noEntregados, enRuta } */
export function resumenEntregas(pedidos, resultados) {
  const r = { entregados: 0, noEntregados: 0, enRuta: 0 };
  for (const p of pedidos || []) {
    if (p.estado === "anulado") continue;
    const x = resultados.get(p.id);
    if (!x) continue;
    if (x.estado === "entregada") r.entregados++; else if (x.estado === "no_entregada") r.noEntregados++; else r.enRuta++;
  }
  return r;
}

/** Un pedido no entregado, otra vez para otra fecha (lo mismo, apuntando de dónde viene) */
export function reprogramado(p, fecha) {
  return {
    ...nuevoPedido({ orgId: p.org_id, projectId: p.projectId, fecha, cliente: p.cliente, ref: p.ref, bultos: p.bultos, kg: p.kg, desde: p.desde, hasta: p.hasta, duracion: p.duracion, notas: p.notas, origen: "reprogramado" }),
    desdePedido: p.id, desdeFecha: p.fecha,
  };
}
