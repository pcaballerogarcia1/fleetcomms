// Inventario de contenedores (vertical de puntos). Cada contenedor con su
// ficha: código, RFID, tipo, litros, fracción, estado, fechas y notas. Se
// crea a partir de los puntos de Planning (una fila del Excel = un
// contenedor), se edita a mano o se actualiza con otro Excel, y lo usan:
//  · Scheduling: los litros de cada parada (capacidad del camión);
//  · la app del conductor: los RFID de cada parada, para marcarla al leerlos.
// Sin React ni Firebase (el guardado está en inventario-store.js).
import { litrosDe } from "./scheduling/capacidad.js";

export const ESTADOS = ["En servicio", "Dañado", "En taller", "Pendiente de instalar", "Retirado"];
export const ACTIVO = c => c.estado !== "Retirado" && c.estado !== "Pendiente de instalar";

const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
export const puntoDe = (lat, lng) => `${(+lat).toFixed(5)}_${(+lng).toFixed(5)}`;

const columna = (campos, re) => {
  const k = Object.keys(campos || {}).find(c => re.test(norm(c)));
  return k != null && String(campos[k]).trim() ? String(campos[k]).trim() : "";
};
// (también las columnas de contadores y de otros sectores: nº de serie, calibre, tipo de contador…)
const RE_CODIGO = /^(codigo|cod|cod\.? contenedor|codigo contenedor|id contenedor|id_contenedor|n[ºo°]? ?contenedor|num(ero)? contenedor|matricula contenedor|id|n[ºo°]? ?(de )?serie|num(ero)? (de )?serie|serie|codigo contador|id contador|codigo elemento|id elemento)$/;
const RE_RFID = /rfid|^tag|chip|transponder/;
const RE_TIPO = /^(contenedor|tipo contenedor|tipo_contenedor|tipocontenedor|modelo contenedor|modelo_contenedor|tipo|tipo (de )?contador|modelo|tipo (de )?elemento)$/;
const RE_FRACCION = /^(fraccion|fracción|residuo|tipo residuo|tipo_residuo|flujo|calibre|categoria)$/;

/** Una ficha a partir de un punto de Planning */
export function fichaDePunto(m, i = 0) {
  // las capas subidas de un CSV/Excel traen las columnas sueltas en el punto, no en «campos»
  const campos = m.campos || m.fields || Object.fromEntries(Object.entries(m).filter(([k]) => !/^(_|lat$|lng$|id$)/.test(k)));
  const codigo = columna(campos, RE_CODIGO);
  const litros = litrosDe({ campos });
  return {
    id: codigo || `${puntoDe(m.lat, m.lng)}#${i}`,
    punto: puntoDe(m.lat, m.lng), lat: +m.lat, lng: +m.lng,
    nombre: columna(campos, /^(nombre|name|calle|street|direccion|dirección)$/),
    codigo, rfid: columna(campos, RE_RFID),
    tipo: columna(campos, RE_TIPO), litros: litros || null,
    fraccion: columna(campos, RE_FRACCION),
    estado: "En servicio", instalado: "", revisado: "", lavado: "", notas: "",
  };
}

/**
 * Crea o completa el inventario con los puntos de las capas: los que ya
 * estaban se dejan como están (con lo editado a mano) y se añaden los nuevos.
 * @param markers  [{ lat, lng, campos }] (todas las capas visibles)
 * @returns { lista, nuevos }
 */
export function completarConPuntos(lista, markers) {
  const out = [...lista];
  const ids = new Set(out.map(c => c.id));
  const porPunto = new Map();
  for (const c of out) porPunto.set(c.punto, (porPunto.get(c.punto) || 0) + 1);
  const vistos = new Map(); // cuántos de cada punto llevamos en las capas
  let nuevos = 0;
  for (const m of markers) {
    if (!(Math.abs(+m.lat) > 0.0001 && Math.abs(+m.lng) > 0.0001)) continue;
    const p = puntoDe(m.lat, m.lng);
    const n = vistos.get(p) || 0;
    vistos.set(p, n + 1);
    const f = fichaDePunto(m, n);
    if (ids.has(f.id)) continue;
    // sin código: el n-ésimo del punto ya está si el punto tiene más de n fichas
    if (!f.codigo && (porPunto.get(p) || 0) > n) continue;
    out.push(f); ids.add(f.id); nuevos++;
  }
  return { lista: out, nuevos };
}

/**
 * Actualiza el inventario con un Excel (por código o por RFID). Las filas que
 * no están y tienen coordenadas se añaden.
 * @returns { lista, actualizados, nuevos, ignorados }
 */
export function importarFilas(lista, filas) {
  const out = lista.map(c => ({ ...c }));
  const porCodigo = new Map(out.filter(c => c.codigo).map(c => [norm(c.codigo), c]));
  const porRfid = new Map(out.filter(c => c.rfid).map(c => [norm(c.rfid), c]));
  let actualizados = 0, nuevos = 0, ignorados = 0;
  for (const f of filas) {
    const codigo = columna(f, RE_CODIGO), rfid = columna(f, RE_RFID);
    const ya = (codigo && porCodigo.get(norm(codigo))) || (rfid && porRfid.get(norm(rfid)));
    const estadoTxt = columna(f, /^(estado|situacion|situación)$/);
    const estado = ESTADOS.find(e => norm(e) === norm(estadoTxt) || (estadoTxt && norm(e).includes(norm(estadoTxt))));
    const cambios = {
      ...(codigo ? { codigo } : {}), ...(rfid ? { rfid } : {}),
      ...(columna(f, RE_TIPO) ? { tipo: columna(f, RE_TIPO) } : {}),
      ...(litrosDe({ campos: f }) ? { litros: litrosDe({ campos: f }) } : {}),
      ...(columna(f, RE_FRACCION) ? { fraccion: columna(f, RE_FRACCION) } : {}),
      ...(estado ? { estado } : {}),
      ...(columna(f, /^(instalado|fecha instalacion|instalacion)$/) ? { instalado: columna(f, /^(instalado|fecha instalacion|instalacion)$/) } : {}),
      ...(columna(f, /^(revisado|ultima revision|revision)$/) ? { revisado: columna(f, /^(revisado|ultima revision|revision)$/) } : {}),
      ...(columna(f, /^(lavado|ultimo lavado)$/) ? { lavado: columna(f, /^(lavado|ultimo lavado)$/) } : {}),
      ...(columna(f, /^(nota|notas|observaciones|comentario)$/) ? { notas: columna(f, /^(nota|notas|observaciones|comentario)$/) } : {}),
    };
    if (ya) { Object.assign(ya, cambios); actualizados++; continue; }
    const lat = parseFloat(String(columna(f, /^(lat|latitud|latitude|y)$/)).replace(",", "."));
    const lng = parseFloat(String(columna(f, /^(lng|lon|long|longitud|longitude|x)$/)).replace(",", "."));
    if (!codigo || !(Math.abs(lat) > 0.0001 && Math.abs(lng) > 0.0001)) { ignorados++; continue; }
    const nueva = { ...fichaDePunto({ lat, lng, campos: {} }), id: codigo, estado: "En servicio", ...cambios };
    out.push(nueva); porCodigo.set(norm(codigo), nueva); if (rfid) porRfid.set(norm(rfid), nueva);
    nuevos++;
  }
  return { lista: out, actualizados, nuevos, ignorados };
}

/** Los contenedores activos de cada punto: Map(punto → [fichas]) */
export function porPunto(lista) {
  const m = new Map();
  for (const c of lista) if (ACTIVO(c)) { if (!m.has(c.punto)) m.set(c.punto, []); m.get(c.punto).push(c); }
  return m;
}

/** A cada parada de Scheduling, sus contenedores del inventario (litros y RFID).
 *  Un punto cuyos contenedores están todos retirados o sin instalar no se recoge. */
export function conInventario(tasks, lista) {
  if (!lista?.length) return tasks;
  const pp = porPunto(lista);
  const conFicha = new Set(lista.map(c => c.punto));
  const clave = t => t._id || puntoDe(t.lat, t.lng);
  // varias paradas en el mismo punto (una por fila del Excel): se reparten sus contenedores
  const nPunto = new Map(), visto = new Map();
  for (const t of tasks) nPunto.set(clave(t), (nPunto.get(clave(t)) || 0) + 1);
  return tasks.flatMap(t => {
    const p = clave(t);
    const k = visto.get(p) || 0, n = nPunto.get(p);
    visto.set(p, k + 1);
    const cs = (pp.get(p) || []).filter((_, i) => i % n === k);
    if (!cs.length) return conFicha.has(p) && !pp.get(p)?.length ? [] : [t];
    const litros = cs.reduce((s, c) => s + (Number(c.litros) || 0), 0);
    return [{
      ...t,
      contenedores: cs.map(c => ({ id: c.id, codigo: c.codigo || "", rfid: c.rfid || "", tipo: c.tipo || "", fraccion: c.fraccion || "" })),
      ...(litros > 0 ? { litros } : {}),
    }];
  });
}

/** Recuentos para la cabecera */
export function resumenInventario(lista) {
  const cuenta = f => { const m = {}; for (const c of lista) { const k = f(c) || "—"; m[k] = (m[k] || 0) + 1; } return m; };
  return {
    total: lista.length,
    porEstado: cuenta(c => c.estado),
    conRfid: lista.filter(c => c.rfid).length,
    litros: lista.filter(ACTIVO).reduce((s, c) => s + (Number(c.litros) || 0), 0),
    porFraccion: cuenta(c => c.fraccion),
  };
}
