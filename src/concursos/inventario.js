// Inventario de contenedores de un concurso (sin coordenadas).
// Muchos pliegos traen (o el cliente pasa) un listado de contenedores con su
// dirección, fracción y modelo, pero sin coordenadas. Sirve igualmente para:
//  · contrastar el parque con el del pliego (fracción a fracción);
//  · saber cuántos puntos de aportación hay y cuántos contenedores tiene cada
//    uno (el camión va de punto en punto, no de contenedor en contenedor);
//  · con eso, estimar lo que rinde un equipo por turno en vez de a ojo.
// Sin React ni Firebase.
import { fraccionDe, ubicacionDe } from "./ficha.js";

// ── Entender cualquier listado ──
// Cada empresa y cada ayuntamiento llama a las columnas a su manera (y en su
// idioma), a veces sin cabecera o con filas de título encima. Se reconoce
// cada columna por su NOMBRE (sinónimos en castellano, catalán, gallego,
// euskera e inglés) y, si no, por su CONTENIDO (una columna con «RSU, PAPEL,
// VIDRIO» es la fracción; con «Soterrado/Superficie», el modelo; con «3000 L»,
// la capacidad; con «PA001751» repetidos, el punto…). También listados «por
// punto» con una columna por fracción y el número de contenedores.
export const CAMPOS = {
  calle: "Calle", numero: "Número", barrio: "Barrio", distrito: "Distrito", municipio: "Municipio", fraccion: "Fracción",
  modelo: "Modelo / ubicación", capacidad: "Capacidad", punto: "Punto de aportación", codigo: "Código del contenedor",
  cantidad: "Cantidad de contenedores", lat: "Latitud", lng: "Longitud",
};
const SINONIMOS = {
  calle: /^(calle|carrer|rua|r[uú]a|kalea|street|direcci[oó]n|direccio|adre[cç]a|helbidea|address|via|v[ií]a|domicilio|ubicaci[oó]n postal|nombre de la v[ií]a|nom carrer|calle\/plaza)$/,
  numero: /^(n[uú]m\.?|numero|n[uú]mero|num portal|portal|zenbakia|number|no\.?)$/,
  barrio: /^(barrio|barri|bairro|auzoa|neighbou?rhood|zona|sector|secci[oó]n)$/,
  distrito: /^(distrito|districte|barrutia|district|junta|junta municipal)$/,
  municipio: /^(municipio|municipi|concello|udalerria|localidad|poblaci[oó]n|town|city|ciudad)$/,
  fraccion: /^(fracci[oó]n|fracci[oó]|fraccion|frakzioa|fraction|residuo|tipo de residuo|tipo residuo|waste|flujo|tipus residu|material)$/,
  modelo: /^(model|modelo|tipolog[ií]a|tipologia|tipo contenedor|tipo de contenedor|tipus|tipo|sistema|carga|instalaci[oó]n|ubicaci[oó]n|type)$/,
  capacidad: /^(capacidad|capacitat|capacidade|edukiera|capacity|volumen|volum|litros|litres|l)$/,
  punto: /^(ubicaci[oó] t[eè]cnica|ubicacio tecnica|ubicaci[oó]n t[eé]cnica|punto|punt|punto de aportaci[oó]n|punt d'aportaci[oó]|pa|isla|illa|area|[aá]rea|[aá]rea de aportaci[oó]n|c[oó]digo punto|id punto|ecopunto|bater[ií]a|grupo)$/,
  codigo: /^(equip|equipo|c[oó]digo|codi|kodea|id|matr[ií]cula|n[ºo°] contenedor|num contenedor|id contenedor|serial|n[ºo°] serie|qr|codi qr|rfid)$/,
  cantidad: /^(cantidad|unidades|uds\.?|n[ºo°] contenedores|num contenedores|contenedores|quantitat|kopurua|count|qty)$/,
  lat: /^(lat|latitud|latitude|y|coord y|coordenada y|utm y)$/,
  lng: /^(lon|long|lng|longitud|longitude|x|coord x|coordenada x|utm x)$/,
};
const norm = t => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

// cómo es el contenido de una columna (para reconocerla sin cabecera)
const ES_FRACCION = /^(rsu|resto|rechazo|fraccion resto|rebuig|resta|residual|papel|carton|papel y carton|papel carton|pc|paper|cartro|envases?|envasos|ligeros|el|packaging|plastic|vidrio|vidre|glass|organica|organico|organic|form|bio|biorresiduo|fo|aceite|oli|textil|ropa|roba)$/;
const ES_MODELO = /soterr|superficie|surface|underground|bilateral|lateral|trasera|carga superior|iglu|subterr|enterrad/;
const ES_CAPACIDAD = /^\d{3,5}\s*(l|lts?|litros)?$|^\d+([.,]\d+)?\s*m3$/;
function puntuar(valores) {
  const vs = valores.map(v => norm(v)).filter(Boolean);
  if (!vs.length) return {};
  const parte = re => vs.filter(v => re.test(v)).length / vs.length;
  const unicos = new Set(vs).size / vs.length;
  const numeros = vs.filter(v => /^-?\d+([.,]\d+)?$/.test(v));
  const decimales = numeros.map(v => Number(v.replace(",", ".")));
  return {
    fraccion: parte(ES_FRACCION),
    modelo: parte(ES_MODELO),
    capacidad: parte(ES_CAPACIDAD),
    lat: decimales.length / vs.length > 0.8 && decimales.every(n => n > 27 && n < 44 && !Number.isInteger(n)) ? 1 : 0,
    lng: decimales.length / vs.length > 0.8 && decimales.every(n => n > -19 && n < 5 && !Number.isInteger(n)) ? 1 : 0,
    // un código que se repite en varias filas seguidas: el punto
    punto: vs.every(v => /^[a-z]{1,4}[-\s]?\d{2,}$/.test(v)) && unicos < 0.7 ? 1 : 0,
    codigo: vs.every(v => /^[a-z]{0,4}\d{3,}$/.test(v)) && unicos > 0.95 ? 0.8 : 0,
    numero: numeros.length / vs.length > 0.7 && decimales.every(n => Number.isInteger(n) && n >= 0 && n < 2000) && unicos < 0.9 ? 0.6 : 0,
    calle: vs.filter(v => /[a-z]{3,}/.test(v) && !ES_FRACCION.test(v) && !ES_MODELO.test(v)).length / vs.length > 0.8 && unicos > 0.05 && unicos < 0.9 ? 0.5 : 0,
  };
}

/**
 * Cómo se entiende una hoja: la fila de cabecera (o ninguna) y qué columna es cada campo.
 * @returns { cabecera: índice de fila | -1, columnas: { campo: índice }, porFraccion: [{ col, fraccion }] (listado por punto), nombres: [texto de cada columna] }
 */
export function entenderHoja(matriz) {
  const filas = (matriz || []).filter(Array.isArray);
  // la cabecera: la fila (de las 15 primeras) que más nombres reconoce
  let cab = -1, mejor = 0;
  filas.slice(0, 15).forEach((f, i) => {
    const n = f.filter(h => Object.values(SINONIMOS).some(re => re.test(norm(h))) || (String(h ?? "").trim().length < 25 && fraccionDe(String(h ?? "")))).length;
    if (n > mejor) { mejor = n; cab = i; }
  });
  if (mejor < 2) cab = -1;
  const ancho = Math.max(0, ...filas.slice(0, 50).map(f => f.length));
  const nombres = Array.from({ length: ancho }, (_, i) => (cab >= 0 ? String(filas[cab][i] ?? "").trim() : "") || `Columna ${i + 1}`);
  const datos = filas.slice(cab + 1, cab + 301);
  const columnas = {};
  const notas = nombres.map((_, i) => puntuar(datos.map(f => f[i])));
  // 1) por el nombre; si varias encajan (p. ej. «Tipus» y «Model»), la de contenido más adecuado
  const candidatas = {};
  nombres.forEach((h, i) => {
    const t = norm(h);
    for (const [k, re] of Object.entries(SINONIMOS)) if (re.test(t)) { (candidatas[k] ||= []).push(i); break; }
  });
  for (const [k, cs] of Object.entries(candidatas)) columnas[k] = cs.length > 1 ? cs.reduce((a, b) => ((notas[b][k] || 0) > (notas[a][k] || 0) ? b : a)) : cs[0];
  // «Num.» es el portal; «Nº» suele ser el número de fila
  const num = nombres.findIndex(h => /^(num\.?|numero|n[uú]mero)$/.test(norm(h)));
  if (num >= 0) columnas.numero = num;
  // 2) por el contenido, lo que falte (sin tocar las columnas que se llaman como una fracción:
  // en un listado por punto, ahí van las cantidades)
  const usadas = new Set(Object.values(columnas));
  if (cab >= 0 && columnas.fraccion == null) nombres.forEach((h, i) => { const f = fraccionDe(h); if (f && f !== "Todas" && h.length < 25) usadas.add(i); });
  for (const k of ["fraccion", "modelo", "capacidad", "punto", "lat", "lng", "codigo", "calle", "numero"]) {
    if (columnas[k] != null) continue;
    let mejorI = -1, mejorN = k === "calle" || k === "numero" ? 0.4 : 0.6;
    notas.forEach((n, i) => { if (!usadas.has(i) && (n[k] || 0) > mejorN) { mejorN = n[k]; mejorI = i; } });
    if (mejorI >= 0) { columnas[k] = mejorI; usadas.add(mejorI); }
  }
  // 3) listado por punto: columnas cuyo nombre es una fracción y traen cantidades
  const porFraccion = [];
  if (columnas.fraccion == null) {
    nombres.forEach((h, i) => {
      const f = fraccionDe(h);
      if (!f || f === "Todas" || Object.values(columnas).includes(i)) return;
      const vs = datos.map(r => r[i]).filter(v => String(v ?? "").trim() !== "");
      if (vs.length && vs.every(v => /^\d+$/.test(String(v).trim()))) porFraccion.push({ col: i, fraccion: f });
    });
  }
  return { cabecera: cab, columnas, porFraccion, nombres };
}

/**
 * Lee el listado con lo entendido (o lo corregido por el usuario).
 * @returns { contenedores, error }
 */
export function leerInventario(matriz, entendido = entenderHoja(matriz)) {
  const { cabecera, columnas: col, porFraccion } = entendido;
  if (col.fraccion == null && !porFraccion?.length) return { contenedores: [], error: "No encuentro la fracción (ni una columna por fracción): dime cuál es." };
  if (col.calle == null && col.punto == null && col.lat == null) return { contenedores: [], error: "No encuentro ni la calle, ni el punto, ni las coordenadas: dime cuál es." };
  const v = (f, k) => (col[k] == null ? null : String(f[col[k]] ?? "").trim() || null);
  const contenedores = [];
  for (const f of (matriz || []).slice(cabecera + 1)) {
    if (!Array.isArray(f) || !f.some(x => String(x ?? "").trim())) continue;
    const calle = v(f, "calle"), numero = v(f, "numero");
    const lat = Number(String(v(f, "lat") ?? "").replace(",", ".")), lng = Number(String(v(f, "lng") ?? "").replace(",", "."));
    const base = {
      calle, numero, barrio: v(f, "barrio"), distrito: v(f, "distrito"), municipio: v(f, "municipio"),
      ubicacion: ubicacionDe(v(f, "modelo") || "") || v(f, "modelo"), capacidad: v(f, "capacidad"),
      punto: v(f, "punto") || [calle, numero].filter(Boolean).join(" ") || (Number.isFinite(lat) && lat ? `${lat.toFixed(5)},${lng.toFixed(5)}` : null),
      ...(Number.isFinite(lat) && Number.isFinite(lng) && lat && lng ? { lat, lng } : {}),
    };
    if (porFraccion?.length && col.fraccion == null) {
      // una fila por punto, con cuántos contenedores de cada fracción
      for (const { col: c, fraccion } of porFraccion) {
        const n = parseInt(String(f[c] ?? "").trim(), 10) || 0;
        for (let i = 0; i < n; i++) contenedores.push({ ...base, fraccion, fraccionPliego: fraccion });
      }
      continue;
    }
    const fraccion = v(f, "fraccion");
    if (!fraccion) continue;
    const cuantos = Math.max(1, parseInt(v(f, "cantidad") || "1", 10) || 1);
    for (let i = 0; i < cuantos; i++) contenedores.push({ ...base, fraccion, fraccionPliego: fraccionDe(fraccion) || fraccion, codigo: v(f, "codigo") });
  }
  return { contenedores };
}

/** De un archivo (Excel, ODS, CSV, texto con tabuladores) a sus hojas: [{ nombre, matriz }] */
export async function hojasDeArchivo(archivo) {
  const XLSX = await import("xlsx");
  const buf = await archivo.arrayBuffer();
  let wb;
  if (/\.(csv|txt|tsv)$/i.test(archivo.name)) {
    // texto: se detecta la codificación (UTF-8 o Windows) y el separador
    let texto = new TextDecoder("utf-8").decode(buf);
    if (texto.includes("�")) texto = new TextDecoder("windows-1252").decode(buf);
    const primera = texto.split(/\r?\n/).find(l => l.trim()) || "";
    const sep = [";", "\t", ",", "|"].sort((a, b) => primera.split(b).length - primera.split(a).length)[0];
    wb = XLSX.read(texto, { type: "string", FS: sep });
  } else wb = XLSX.read(buf);
  return wb.SheetNames.map(n => ({ nombre: n, matriz: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "", raw: false }) }));
}

/** Cuentas del inventario: por fracción y ubicación, puntos y contenedores por punto */
export function resumenInventario(contenedores) {
  const porTipo = new Map(), puntos = new Map(), porDistrito = new Map();
  for (const c of contenedores) {
    const k = `${c.ubicacion || "—"}|${c.fraccionPliego}`;
    porTipo.set(k, (porTipo.get(k) || 0) + 1);
    const p = `${c.ubicacion || "—"}|${c.punto}`;
    if (!puntos.has(p)) puntos.set(p, { ubicacion: c.ubicacion || "—", punto: c.punto, contenedores: [] });
    puntos.get(p).contenedores.push(c);
    if (c.distrito) porDistrito.set(c.distrito, (porDistrito.get(c.distrito) || 0) + 1);
  }
  const lista = [...puntos.values()];
  const ubicaciones = [...new Set(lista.map(p => p.ubicacion))];
  const porUbicacion = ubicaciones.map(u => {
    const ps = lista.filter(p => p.ubicacion === u);
    const n = ps.reduce((s, p) => s + p.contenedores.length, 0);
    return { ubicacion: u, puntos: ps.length, contenedores: n, porPunto: ps.length ? n / ps.length : 0 };
  });
  return {
    total: contenedores.length, puntos: lista.length,
    porTipo: [...porTipo.entries()].map(([k, n]) => { const [ubicacion, fraccion] = k.split("|"); return { ubicacion, fraccion, contenedores: n }; }).sort((a, b) => a.ubicacion.localeCompare(b.ubicacion) || a.fraccion.localeCompare(b.fraccion)),
    porUbicacion, porDistrito: [...porDistrito.entries()].sort((a, b) => b[1] - a[1]),
    lista,
  };
}

/**
 * Contenedores de una fracción por punto que la tiene (para estimar lo que se
 * hace en cada parada): el lavado de RSU va a los puntos con RSU, y en cada uno
 * lava solo los de RSU; la limpieza exterior o la de bajos, todos los del punto.
 */
export function porPuntoDe(resumen, { ubicacion, fraccion }) {
  const ps = resumen.lista.filter(p => !ubicacion || p.ubicacion === ubicacion);
  const todas = !fraccion || fraccion === "Todas";
  const con = ps.map(p => (todas ? p.contenedores.length : p.contenedores.filter(c => c.fraccionPliego === fraccion).length)).filter(n => n > 0);
  return con.length ? { puntos: con.length, porPunto: con.reduce((a, b) => a + b, 0) / con.length } : null;
}

/** El parque del pliego (tablas de solo unidades) contra el inventario: [{ ubicacion, fraccion, pliego, listado, diferencia }] */
export function compararConPliego(resumen, parquePliego) {
  const filas = new Map();
  const clave = (u, f) => `${u}|${f}`;
  for (const p of parquePliego) filas.set(clave(p.ubicacion || "—", p.fraccion), { ubicacion: p.ubicacion || "—", fraccion: p.fraccion, pliego: p.unidades, listado: 0 });
  for (const t of resumen.porTipo) {
    const k = clave(t.ubicacion, t.fraccion);
    const f = filas.get(k) || { ubicacion: t.ubicacion, fraccion: t.fraccion, pliego: null, listado: 0 };
    f.listado = t.contenedores; filas.set(k, f);
  }
  return [...filas.values()].map(f => ({ ...f, diferencia: f.pliego == null ? null : f.listado - f.pliego }))
    .sort((a, b) => a.ubicacion.localeCompare(b.ubicacion) || a.fraccion.localeCompare(b.fraccion));
}

// ── Rendimiento con el inventario ──
// Minutos de trabajo en cada contenedor y de desplazamiento entre puntos
// (orientativos, se cambian). Por turno: minutos útiles ÷ (minutos por
// contenedor + desplazamiento ÷ contenedores por punto).
export const MINUTOS_ORIENTATIVOS = {
  "Lavado interior|Soterrado": 8, "Lavado interior|Superficie": 4, "Lavado interior|": 5,
  "Limpieza exterior|Soterrado": 4, "Limpieza exterior|": 3,
  "Limpieza bajo contenedor|": 5,
  "Mantenimiento preventivo|Soterrado": 15, "Mantenimiento preventivo|": 8,
  "Achiques|": 30, "Mantenimiento correctivo|": 30, "Rehabilitación de contenedores|": 240,
};
export const minutosOrientativos = s => MINUTOS_ORIENTATIVOS[`${s.nombre}|${s.ubicacion || ""}`] ?? MINUTOS_ORIENTATIVOS[`${s.nombre}|`] ?? 10;
export const DESPLAZAMIENTO_DEFECTO = 6; // min entre un punto y el siguiente (ciudad)
export const UTIL_DEFECTO = 0.85;       // parte del turno trabajando (el resto: salir, volver, descargar agua…)

/** Lo que rinde por turno con el inventario: { porTurno, porPunto, puntos } o null si el inventario no tiene ese servicio */
// servicios que no van de punto en punto (se estiman a mano)
const NO_POR_PUNTO = /rehabilitaci|achique|correctivo/i;
export function rendimientoConInventario(s, resumen, { horasTurno = 7, minPorContenedor, desplazamiento = DESPLAZAMIENTO_DEFECTO, util = UTIL_DEFECTO, todasEnElPunto = false } = {}) {
  if (NO_POR_PUNTO.test(s.nombre || "")) return null;
  const pp = porPuntoDe(resumen, todasEnElPunto ? { ...s, fraccion: "Todas" } : s);
  if (!pp) return null;
  const min = minPorContenedor ?? minutosOrientativos(s);
  const porContenedor = min + desplazamiento / pp.porPunto;
  return { porTurno: Math.max(1, Math.floor((horasTurno * 60 * util) / porContenedor)), porPunto: pp.porPunto, puntos: pp.puntos, minPorContenedor: min };
}

/**
 * ¿Se hacen todas las fracciones del punto en la misma visita? Sí, si el
 * servicio va con la misma frecuencia para todas (veces al año por contenedor
 * parecidas): p. ej. el preventivo trimestral. El lavado (RSU mensual, papel
 * semestral) va fracción a fracción.
 */
export function vanJuntas(servicio, servicios, resumen) {
  const grupo = servicios.filter(x => x.nombre === servicio.nombre && (x.ubicacion || "") === (servicio.ubicacion || "") && x.fraccion && x.fraccion !== "Todas");
  if (grupo.length < 2) return false;
  const veces = grupo.map(x => {
    const n = resumen.porTipo.find(t => t.ubicacion === (x.ubicacion || "—") && t.fraccion === x.fraccion)?.contenedores;
    return n ? x.cantidadAnual / n : null;
  }).filter(v => v != null);
  if (veces.length < 2) return false;
  return Math.max(...veces) / Math.min(...veces) < 1.3;
}
