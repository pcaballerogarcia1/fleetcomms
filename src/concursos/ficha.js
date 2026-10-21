// Ficha de requisitos de un concurso: lo que el usuario confirma del pliego.
// El lector (pliego.js) solo PROPONE; aquí se convierte lo propuesto en
// requisitos que se confirman o se corrigen, y de esta ficha leen los demás
// módulos (Planning para dimensionar, Cálculo, Resumen). Sin React ni Firebase.
//
// Ficha (concursos/{id}/requisitos/ficha):
//   datos:     { [clave]: { valor, estado: "confirmado" | "corregido" | "descartado", propuesto, pagina, frase, doc } }
//   servicios: { [id]: { nombre, fraccion, ubicacion, cantidadAnual, unidades, frecuencia, pagina, doc, orden } }

import { origenDe, periodoDeMediciones } from "./tecnico.js";

const sinAcentos = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Fracción a partir de cómo la llama el pliego
const FRACCIONES = [
  ["Resto", /\b(rsu|resto|rechazo|fraccion resto|rebuig|resta|residual|refuse|general waste|hondakin|errefusa|fr)\b/],
  ["Papel y cartón", /\b(papel|carton|pc|paper|cartro|cardboard|papera)\b/],
  ["Envases", /\b(envases?|envasos|ligeros|packaging|plastic|plastico|ontziak|el|lleugers)\b/],
  ["Vidrio", /\b(vidrio|vidre|glass|beira|iglu)\b/],
  ["Orgánica", /\b(organica|organico|organic|form|biorresiduo|bio|fo|biowaste|organikoa)\b/],
  ["Aceite", /\b(aceite|oli|oil)\b/],
  ["Textil", /\b(textil|ropa|roba|clothes)\b/],
  ["Todas", /\b(todas|todos|total|totes)\b/],
];
export function fraccionDe(texto) {
  const t = sinAcentos(texto);
  return FRACCIONES.find(([, re]) => re.test(t))?.[0] || null;
}
export function ubicacionDe(texto) {
  const t = sinAcentos(texto);
  if (/soterr|subterr|enterrad|underground|lurpe|buried/.test(t)) return "Soterrado";
  if (/superficie|surface|above ?ground|azaleko|en calle/.test(t)) return "Superficie";
  if (/carga lateral|lateral/.test(t)) return "Carga lateral";
  if (/bilateral|carga superior/.test(t)) return "Bilateral";
  return null;
}

// Nombre del servicio a partir del título de la tabla
const SERVICIOS = [
  // limpieza viaria y transporte (pliegos por frecuencias o por mediciones)
  ["Barrido manual", /barrido manual/],
  ["Barrido mecánico", /barrido mec/],
  ["Baldeo", /baldeo/],
  ["Fregado", /fregado/],
  ["Vaciado de papeleras", /papeleras/],
  ["Transporte de residuos", /^(?:servicio de )?transporte|transporte de (?:fangos|lodos)/],
  ["Mantenimiento correctivo", /mantenimiento correctivo|correctivo/],
  ["Mantenimiento preventivo", /mantenimiento preventivo|preventivo|mantenimiento/],
  ["Rehabilitación de contenedores", /rehabilitaci/],
  ["Limpieza bajo contenedor", /bajo contenedor|bajos|\bbajo\b|zona inferior|pavimento/],
  ["Limpieza exterior", /limpieza exterior|exterior|hidrolimpiad/],
  ["Lavado interior", /lavado|lavados/],
  ["Recogida", /recogida|vaciado/],
  ["Achiques", /achique/],
];
export function servicioDe(titulo) {
  const t = sinAcentos(titulo);
  return SERVICIOS.find(([, re]) => re.test(t))?.[0] || null;
}

/**
 * Tablas del pliego → servicios propuestos, con su cantidad al año y, cuando
 * la tabla trae unidades y frecuencia, la comprobación de la cuenta del propio
 * pliego (166 contenedores × 12 meses = 1.992). Las tablas de precios no son
 * servicios: dan el precio unitario de cada uno (preciosDelPliego); las de
 * parque (solo unidades) tampoco (parqueDelPliego).
 * @returns [{ indice, titulo, pagina, servicio, clase: "anual"|"porAnios"|"programa"|"parque"|"precios",
 *            usar, motivo, lineas: [{ id, nombre, fraccion, ubicacion, cantidadAnual, unidades, frecuencia, cuadra, cuenta, … }] }]
 */
const VECES = { diaria: 365, diario: 365, semanal: 52, quincenal: 24, mensual: 12, bimestral: 6, trimestral: 4, semestral: 2, anual: 1 };
const MESES_TEMPORADA = t => { const m = /\(([a-záéíóú]+)\s*-\s*([a-záéíóú]+)\)/i.exec(t); if (!m) return null; const o = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]; const a = o.findIndex(x => x.startsWith(sinAcentos(m[1]).slice(0, 3))), b = o.findIndex(x => x.startsWith(sinAcentos(m[2]).slice(0, 3))); return a < 0 || b < 0 ? null : ((b - a + 12) % 12) + 1; };
const FMT_ES = n => Number(n).toLocaleString("es-ES");

function claseDe(t) {
  const cab = sinAcentos(`${t.cabecera || ""} ${t.titulo}`);
  if (t.filas.some(f => f.euros)) return "precios";
  // unidades + una cifra por periodo (166 TRIMESTRAL 166 166 166 166): programación
  if (t.filas.every(f => f.frecuencia) && t.filas.some(f => f.valores.length >= 3)) return "programa";
  if (/anual/.test(cab)) return "anual";
  if (/\ba[nñ]o\b|1r ano|2ndo|prorroga/.test(cab)) return "porAnios";
  if (t.filas.every(f => f.frecuencia) || /\bmes 1\b|enero|febrero/.test(cab)) return "programa";
  if (t.filas.every(f => f.valores.length === 1)) return "parque";
  return "otra";
}

export function tablasParaServicios(tablas = [], docId = null) {
  const propuestas = tablas.map((t, k) => {
    const clase = claseDe(t);
    const nombreTabla = servicioDe(t.cabecera || "") || servicioDe(t.titulo);
    const lineas = [];
    t.filas.forEach((f, i) => {
      if (/suma|total general|acumulad|festivos|d[ií]as|lavados mensuales/i.test(f.concepto)) return;
      const v = f.valores, ult = v[v.length - 1];
      let cantidad = null, unidades = null, cuenta = null, cuadra = null;
      if (clase === "anual") {
        cantidad = ult; unidades = v.length >= 2 ? v[0] : null;
        if (unidades && f.frecuencia && VECES[f.frecuencia]) { const esp = unidades * VECES[f.frecuencia]; cuenta = `${FMT_ES(unidades)} × ${VECES[f.frecuencia]} (${f.frecuencia})`; cuadra = esp === cantidad; }
        else if (v.length === 3) { const meses = MESES_TEMPORADA(f.concepto); if (meses) { const esp = v[0] * v[1] * meses; cuenta = `${FMT_ES(v[0])} × ${v[1]} al mes × ${meses} meses`; cuadra = esp === cantidad; } }
      } else if (clase === "porAnios") cantidad = v[0];
      else if (clase === "programa" && f.frecuencia && VECES[f.frecuencia]) { unidades = v[0]; cantidad = v[0] * VECES[f.frecuencia]; cuenta = `${FMT_ES(v[0])} × ${VECES[f.frecuencia]} (${f.frecuencia})`; }
      else if (clase === "parque") unidades = v[0];
      else return;
      const concepto = f.concepto;
      const temporada = MESES_TEMPORADA(concepto) ? concepto : null;
      const ubicacion = ubicacionDe(f.grupo || "") || ubicacionDe(concepto) || ubicacionDe(t.titulo) || ubicacionDe(t.cabecera || "");
      lineas.push({
        id: `d${docId || "x"}_t${k}_${i}`, nombre: servicioDe(concepto) || servicioDe(f.grupo || "") || nombreTabla || "Servicio",
        // la fracción, si la fila es de una; si es de una temporada o de una ubicación, todas
        fraccion: fraccionDe(concepto) || fraccionDe(f.grupo || "") || (temporada || ubicacionDe(concepto) ? "Todas" : null), temporada, ubicacion,
        cantidadAnual: cantidad, unidades, frecuencia: f.frecuencia || null, cuenta, cuadra,
        concepto: [f.grupo, f.concepto].filter(Boolean).join(" · "), tabla: t.titulo, pagina: t.pagina, doc: docId,
      });
    });
    const esServicio = ["anual", "porAnios", "programa"].includes(clase);
    const usar = esServicio && clase !== "programa" && lineas.length > 0 && lineas.every(l => l.cantidadAnual > 0);
    const motivo = clase === "programa" ? "programación por periodos (el total al año sale de unidades × frecuencia): suele repetirse en el anexo"
      : !esServicio ? null : lineas.some(l => l.cuadra === false) ? "las cuentas de la tabla no cuadran: revísala" : null;
    return { indice: k, titulo: t.titulo, pagina: t.pagina, servicio: nombreTabla, clase, usar, motivo, lineas };
  }).filter(t => t.lineas.length);

  // El mismo servicio en dos tablas: se propone la que más dice (unidades y
  // frecuencia) y en la otra se avisa, con las cifras si no coinciden
  const servicios = propuestas.filter(t => ["anual", "porAnios", "programa"].includes(t.clase));
  const clave = l => `${l.nombre}|${l.ubicacion || ""}`;
  const totalDe = (t, claves) => t.lineas.filter(l => claves.has(clave(l))).reduce((a, l) => a + (l.cantidadAnual || 0), 0);
  const elegida = new Map();
  for (const t of servicios.filter(x => x.usar)) {
    for (const l of t.lineas) if (!elegida.has(clave(l))) elegida.set(clave(l), t);
  }
  for (const t of servicios) {
    const otras = [...new Set(t.lineas.map(l => elegida.get(clave(l))).filter(o => o && o !== t))];
    if (!otras.length) continue;
    const o = otras[0], claves = new Set(t.lineas.map(clave));
    const a = totalDe(t, claves), b = totalDe(o, claves);
    if (t.usar && (o.clase === "anual" || o.pagina < t.pagina)) t.usar = false;
    if (!t.usar) t.motivo = `repite «${t.servicio || t.lineas[0].nombre}» de la pág. ${o.pagina}` + (a !== b ? ` con otra cifra (${FMT_ES(a)} frente a ${FMT_ES(b)}): comprueba cuál vale` : " (mismas cifras)");
  }
  // la limpieza exterior por temporadas va con su total al año (no por fracción)
  return propuestas.filter(t => t.clase !== "precios" && t.clase !== "parque" && t.clase !== "otra");
}

/** Precios unitarios del pliego (Anexo de costes): [{ nombre, ubicacion, fraccion, precio, pagina }] (el del primer año) */
export function preciosDelPliego(tablas = []) {
  const out = [];
  tablas.forEach(t => {
    if (claseDe(t) !== "precios") return;
    const nombre = servicioDe(t.cabecera || "") || servicioDe(t.titulo);
    for (const f of t.filas) {
      if (!f.euros || !f.valores.length) continue;
      out.push({ nombre: servicioDe(f.concepto) || servicioDe(f.grupo || "") || nombre, ubicacion: ubicacionDe(f.grupo || "") || ubicacionDe(f.concepto), fraccion: fraccionDe(f.concepto), concepto: [f.grupo, f.concepto].filter(Boolean).join(" · "), precio: f.valores[0], pagina: t.pagina });
    }
  });
  return out;
}
/** El precio unitario de un servicio (mismo servicio, ubicación y, si la hay, fracción) */
export function precioDe(linea, precios) {
  const mismos = precios.filter(p => p.nombre === linea.nombre && (!p.ubicacion || !linea.ubicacion || p.ubicacion === linea.ubicacion));
  return mismos.find(p => p.fraccion && p.fraccion === linea.fraccion) || mismos.find(p => !p.fraccion) || null;
}
/** El equipo que el pliego exige para un servicio (vehículo y personas), si lo dice */
export function equipoDe(linea, equipos = []) {
  return equipos.find(e => servicioDe(e.apartado || "") === linea.nombre) || equipos.find(e => servicioDe(`${e.apartado || ""} ${e.vehiculo || ""}`) === linea.nombre) || null;
}

/**
 * Servicios que salen de los datos del texto (sin tabla): «6.037 contenedores
 * con 4 lavados por contenedor y año» → 24.148 al año.
 */
export function serviciosDeDatos(datos = [], docId = null) {
  const v = id => datos.find(d => d.id === id);
  const cont = v("contenedores"), veces = v("vecesAnio"), ops = v("operacionesAnio");
  if (!cont && !ops) return [];
  const n = veces ? parseInt(veces.valor, 10) : null;
  const anual = ops?.valor || (cont && n ? cont.valor * n : null);
  if (!anual) return [];
  const de = veces || ops || cont;
  const nombre = servicioDe(`${de.frase} ${veces?.valor || ""}`) || "Servicio";
  return [{
    indice: "texto", titulo: "Del texto del pliego", pagina: de.pagina, servicio: nombre, usar: true, motivo: null,
    lineas: [{ id: `d${docId || "x"}_texto`, nombre, fraccion: "Todas", ubicacion: ubicacionDe(de.frase), cantidadAnual: anual, unidades: cont?.valor || null,
      concepto: cont && n ? `${cont.valor.toLocaleString("es-ES")} contenedores × ${n} al año` : "operaciones al año", tabla: "texto", pagina: de.pagina, doc: docId }],
  }];
}

/**
 * Servicios de la parte técnica (lectura.tecnico de pliego.js): por
 * frecuencias (Barrido manual · Zona 1: 6 veces por semana = 312 al año) y por
 * mediciones del presupuesto (260 t de transporte a 21,08 €/t). Mismo formato
 * que tablasParaServicios; vienen marcados.
 */
export function serviciosDelTecnico(tecnico, docId = null, contexto = {}) {
  const out = [];
  const fr = tecnico?.frecuencias || [], me = tecnico?.mediciones || [];
  // si las mediciones son las del presupuesto de un mes (o de 2 años…), al año
  const per = periodoDeMediciones(me, contexto);
  const lugar = n => (tecnico?.lugares || []).find(l => origenDe(l.nombre) === n || l.nombre === n) || null;
  if (fr.length) out.push({
    indice: "frecuencias", titulo: "Frecuencias del pliego", pagina: fr[0].pagina, servicio: "Servicios por frecuencia", usar: true, motivo: null,
    lineas: fr.map((s, i) => ({ id: `d${docId || "x"}_f${i}`, nombre: servicioDe(s.nombre) || s.nombre, fraccion: null, ubicacion: s.zona || null, cantidadAnual: s.cantidadAnual,
      unidades: null, frecuencia: s.frecuencia, concepto: `${s.frecuencia} = ${FMT_ES(s.cantidadAnual)} al año`, tabla: "frecuencias", pagina: s.pagina, doc: docId })),
  });
  if (me.length) out.push({
    indice: "mediciones", titulo: "Mediciones del presupuesto", pagina: me[0].pagina, servicio: "Servicios por mediciones", usar: true,
    motivo: per.motivo || (per.meses ? null : "Comprueba que las cantidades son de un año (son las del presupuesto)"),
    lineas: me.map((s, i) => {
      const origen = origenDe(s.nombre), l = origen ? lugar(origen) : null;
      const anual = Math.round(s.cantidad * per.factorAnual * 1000) / 1000;
      return {
        id: `d${docId || "x"}_m${i}`, nombre: servicioDe(s.nombre) || s.nombre.slice(0, 60), fraccion: null,
        ubicacion: origen || (servicioDe(s.nombre) ? s.nombre.replace(/^(?:servicio de )?transporte de \S+\s*/i, "").slice(0, 80) : null),
        cantidadAnual: anual, cantidadPresupuesto: s.cantidad, periodoMeses: per.meses, unidad: s.unidad, precioUnitario: s.precio, unidades: null, frecuencia: null,
        origen: origen ? { nombre: origen, direccion: l?.direccion || null, municipio: l?.municipio || null } : null, destino: tecnico?.destino?.nombre || null,
        concepto: per.factorAnual !== 1 ? `${FMT_ES(s.cantidad)} ${s.unidad} en ${per.meses} ${per.meses === 1 ? "mes" : "meses"} × ${FMT_ES(Math.round(per.factorAnual * 100) / 100)} = ${FMT_ES(anual)} ${s.unidad} al año, a ${FMT_ES(s.precio)} €` : `${FMT_ES(s.cantidad)} ${s.unidad} × ${FMT_ES(s.precio)} €`,
        tabla: "mediciones", pagina: s.pagina, doc: docId,
      };
    }),
  });
  return out;
}

/** Una línea propuesta → lo que se guarda en la ficha (con el equipo y el precio del pliego si los hay) */
export function servicioParaGuardar(l, { equipos = [], precios = [], orden = 0 } = {}) {
  const e = equipoDe(l, equipos), pr = precioDe(l, precios);
  return {
    nombre: l.nombre, fraccion: l.fraccion ?? null, ubicacion: l.ubicacion || null, temporada: l.temporada ?? null,
    cantidadAnual: l.cantidadAnual, unidades: l.unidades ?? null, unidad: l.unidad ?? null, frecuencia: l.frecuencia ?? null, cuenta: l.cuenta ?? null, cuadra: l.cuadra ?? null,
    cantidadPresupuesto: l.cantidadPresupuesto ?? null, periodoMeses: l.periodoMeses ?? null, origen: l.origen ?? null, destino: l.destino ?? null, tabla: l.tabla ?? null,
    vehiculo: e?.vehiculo ?? null, personas: e?.personas ?? null, equipoPagina: e?.pagina ?? null,
    precioUnitario: pr?.precio ?? l.precioUnitario ?? null, precioPagina: pr?.pagina ?? (l.precioUnitario != null ? l.pagina : null),
    concepto: l.concepto, pagina: l.pagina, doc: l.doc, orden,
  };
}

/** Todas las propuestas de servicios de los documentos leídos: [{ …propuesta, clave, docNombre }] */
export function propuestasDeServicios(docs = [], contexto = {}) {
  // los sitios y el destino del transporte pueden venir en otro documento (anexo, pliego técnico)
  const lugares = (docs || []).flatMap(d => d.lectura?.tecnico?.lugares || []);
  const destino = (docs || []).map(d => d.lectura?.tecnico?.destino).find(Boolean) || null;
  return (docs || []).flatMap(d => [...serviciosDelTecnico(d.lectura?.tecnico && { ...d.lectura.tecnico, lugares, destino }, d._id, contexto), ...serviciosDeDatos(d.lectura?.datos || [], d._id), ...tablasParaServicios(d.lectura?.tablas || [], d._id)]
    .map(t => ({ ...t, clave: `${d._id}|${t.indice}`, docNombre: d.nombre })));
}

// ── Rendimientos orientativos (por turno de ~7 h) ──
// Valores de partida para dimensionar sin inventario; se cambian en Planning
// con la experiencia de cada empresa (y, más adelante, con los datos reales).
export const RENDIMIENTOS = [
  { servicio: "Lavado interior", ubicacion: "Soterrado", porTurno: 25, vehiculo: "camión lavacontenedores", personas: 2, nota: "camión lavacontenedores con sistema de elevación" },
  { servicio: "Lavado interior", ubicacion: "Bilateral", porTurno: 35, vehiculo: "camión lavacontenedores", personas: 2, nota: "carga superior bilateral" },
  { servicio: "Lavado interior", ubicacion: null, porTurno: 70, vehiculo: "camión lavacontenedores", personas: 1, nota: "carga lateral / superficie" },
  { servicio: "Limpieza exterior", ubicacion: "Soterrado", porTurno: 60, vehiculo: "vehículo con hidrolimpiadora", personas: 1, nota: "hidrolimpiadora, buzones" },
  { servicio: "Limpieza exterior", ubicacion: null, porTurno: 70, vehiculo: "vehículo con hidrolimpiadora", personas: 1, nota: "hidrolimpiadora" },
  { servicio: "Limpieza bajo contenedor", ubicacion: null, porTurno: 60, vehiculo: "vehículo con grúa", personas: 2, nota: "levantar el contenedor y barrer debajo" },
  { servicio: "Mantenimiento preventivo", ubicacion: "Soterrado", porTurno: 20, vehiculo: "furgoneta de taller", personas: 2, nota: "revisión de soterrado (mecanismos, plataforma)" },
  { servicio: "Mantenimiento preventivo", ubicacion: null, porTurno: 40, vehiculo: "furgoneta de taller", personas: 2, nota: "revisión de contenedor de superficie" },
  { servicio: "Mantenimiento correctivo", ubicacion: null, porTurno: 10, vehiculo: "furgoneta de taller", personas: 2, nota: "reparaciones por aviso" },
  { servicio: "Rehabilitación de contenedores", ubicacion: null, porTurno: 1, vehiculo: "furgoneta de taller", personas: 2, nota: "en taller (traslado con la furgoneta de taller)" },
  { servicio: "Achiques", ubicacion: null, porTurno: 10, vehiculo: "furgoneta de taller", personas: 2, nota: "achique de fosos de soterrados" },
  { servicio: "Recogida", ubicacion: "Soterrado", porTurno: 120, vehiculo: "camión recolector", personas: 1, nota: "carga bilateral / grúa" },
  { servicio: "Recogida", ubicacion: null, porTurno: 250, vehiculo: "camión recolector", personas: 1, nota: "carga lateral" },
  // limpieza viaria: la cantidad son pasadas por zona; el rendimiento, cuántas pasadas de zona hace un equipo en un turno
  { servicio: "Barrido manual", ubicacion: null, porTurno: 1, vehiculo: "carro de barrido manual", personas: 1, nota: "una pasada de la zona por turno: ajústalo con el tamaño de la zona" },
  { servicio: "Barrido mecánico", ubicacion: null, porTurno: 1, vehiculo: "barredora", personas: 1, nota: "una pasada de la zona por turno: ajústalo con el tamaño de la zona" },
  { servicio: "Baldeo", ubicacion: null, porTurno: 1, vehiculo: "baldeadora", personas: 1, nota: "una pasada de la zona por turno" },
  { servicio: "Fregado", ubicacion: null, porTurno: 1, vehiculo: "fregadora", personas: 1, nota: "una pasada de la zona por turno" },
  { servicio: "Vaciado de papeleras", ubicacion: null, porTurno: 1, vehiculo: "vehículo auxiliar", personas: 1, nota: "una pasada de la zona por turno" },
  // transporte por mediciones: toneladas por turno (2 viajes de unas 20 t)
  { servicio: "Transporte de residuos", ubicacion: null, porTurno: 40, vehiculo: "camión bañera / portacontenedores", personas: 1, nota: "toneladas por turno: depende de la distancia a la planta" },
  { servicio: null, ubicacion: null, porTurno: 50, vehiculo: null, personas: 2, nota: "valor genérico: ajústalo" },
];
export function rendimientoOrientativo(s) {
  const r = RENDIMIENTOS.find(x => (x.servicio === s.nombre || x.servicio == null) && (x.ubicacion == null || x.ubicacion === s.ubicacion));
  return r || RENDIMIENTOS[RENDIMIENTOS.length - 1];
}

export const PARAMETROS_DEFECTO = {
  jornadasAnio: 357,        // días de servicio al año (los del pliego si los trae)
  horasTurno: 7,            // horas de trabajo efectivo por turno
  cargaViaje: 20,           // transporte: toneladas (o m³) por viaje de un camión
  horasCargaDescarga: 1,    // transporte: carga, báscula, descarga y esperas en cada viaje
  velocidadMedia: 50,       // transporte: km/h si no se sabe el tiempo por carretera
  factorCamion: 1.15,       // transporte: un camión tarda más que el tiempo de la ruta (pensado para coches)
  personasPorEquipo: 2,     // si el pliego no dice cuántas personas lleva el equipo
  horasAnualesConvenio: 1720, // horas de trabajo al año de un trabajador (convenio)
  absentismoPct: 6,         // bajas y ausencias, en % de las horas
};

/** ¿Es un transporte (se mide en toneladas o m³ y se hace en viajes)? */
export const esTransporte = s => /transporte|traslado|acarreo/i.test(s?.nombre || "") || /^(t|tn|kg|m3|m³)$/i.test(s?.unidad || "") && /residu|lodo|fango|rsu|tierra/i.test(`${s?.nombre} ${s?.ubicacion}`);

/**
 * Un transporte por viajes: con los km de ida (o los minutos por carretera),
 * la carga de cada viaje y lo que se tarda en cargar y descargar.
 *   viajes = cantidad ÷ carga; horas por viaje = ida y vuelta + carga y descarga;
 *   turnos = viajes × horas ÷ horas del turno; km = viajes × 2 × km de ida.
 * @returns null (no es transporte o no tiene km) | { viajesAnio, horasViaje, porTurno, turnosAnio, kmAnio, cargaViaje }
 */
export function viajesDe(s, q = PARAMETROS_DEFECTO) {
  if (!esTransporte(s)) return null;
  const km = Number(s.kmIda), min = Number(s.minutosIda);
  if (!(km > 0)) return null;
  const p = { ...PARAMETROS_DEFECTO, ...q };
  const carga = Number(s.cargaViaje) > 0 ? Number(s.cargaViaje) : p.cargaViaje;
  const horasRuta = min > 0 ? (2 * min / 60) * p.factorCamion : (2 * km) / p.velocidadMedia;
  const cargaDescarga = s.horasCargaDescarga != null && s.horasCargaDescarga !== "" ? Number(s.horasCargaDescarga) : p.horasCargaDescarga;
  const horasViaje = horasRuta + cargaDescarga;
  const viajesAnio = (Number(s.cantidadAnual) || 0) / carga;
  return { viajesAnio, horasViaje, cargaViaje: carga, porTurno: carga * p.horasTurno / horasViaje, turnosAnio: viajesAnio * horasViaje / p.horasTurno, kmAnio: viajesAnio * 2 * km };
}

/**
 * Dimensionar por rendimientos (sin inventario ni rutas).
 * @param servicios [{ id, nombre, fraccion, ubicacion, cantidadAnual, porTurno, vehiculo, personas, equipo }]
 *   vehiculo / personas: el equipo que exige el pliego para ese servicio; equipo: otro nombre
 *   de equipo si se quiere juntar servicios distintos. Los del mismo vehículo lo comparten.
 * @param p PARAMETROS_DEFECTO (o los del concurso)
 * @returns { lineas: [{ …, turnosAnio }], equipos: [{ equipo, turnosAnio, porDia, unidades }], resumen }
 */
export function dimensionar(servicios, p = PARAMETROS_DEFECTO) {
  const q = { ...PARAMETROS_DEFECTO, ...p };
  const lineas = servicios.map(s => {
    const ori = rendimientoOrientativo(s);
    const personas = Number(s.personas) > 0 ? Number(s.personas) : ori.personas || q.personasPorEquipo;
    const vehiculo = s.vehiculo || ori.vehiculo || s.nombre;
    const t = viajesDe(s, q);
    if (t) return { ...s, ...t, personas, vehiculo };
    const porTurno = Number(s.porTurno) > 0 ? Number(s.porTurno) : ori.porTurno;
    return { ...s, porTurno, personas, vehiculo, turnosAnio: (Number(s.cantidadAnual) || 0) / porTurno, sinKm: esTransporte(s) || undefined };
  });
  const porEquipo = new Map();
  for (const l of lineas) {
    // los servicios que hace el mismo tipo de vehículo lo comparten
    const e = l.equipo || l.vehiculo || l.nombre;
    const x = porEquipo.get(e) || { turnosAnio: 0, personas: 0, servicios: new Set(), kmAnio: 0 };
    x.turnosAnio += l.turnosAnio; x.personas = Math.max(x.personas, l.personas); x.servicios.add(l.nombre); x.kmAnio += l.kmAnio || 0;
    porEquipo.set(e, x);
  }
  const equipos = [...porEquipo.entries()].map(([equipo, { turnosAnio, personas, servicios, kmAnio }]) => {
    const porDia = turnosAnio / q.jornadasAnio;     // turnos que hacen falta cada día de servicio
    const unidades = Math.max(1, Math.ceil(porDia - 1e-9)); // vehículos (un turno al día cada uno)
    return { equipo, turnosAnio, porDia, unidades, ocupacion: porDia / unidades, personas, servicios: [...servicios], ...(kmAnio ? { kmAnio } : {}) };
  });
  const turnosAnio = lineas.reduce((s, l) => s + l.turnosAnio, 0);
  // horas de las personas: cada turno, con las personas que lleva su equipo
  const horasAnio = lineas.reduce((s, l) => s + l.turnosAnio * q.horasTurno * l.personas, 0);
  const horasPorPersona = q.horasAnualesConvenio * (1 - q.absentismoPct / 100);
  return {
    lineas, equipos,
    resumen: {
      turnosAnio, horasAnio,
      vehiculos: equipos.reduce((s, e) => s + e.unidades, 0),
      personas: horasPorPersona > 0 ? Math.ceil(horasAnio / horasPorPersona - 1e-9) : 0,
      personasExactas: horasPorPersona > 0 ? horasAnio / horasPorPersona : 0,
    },
  };
}

/**
 * Lo que dimensiona el Planning del concurso, igual en todos los módulos:
 * los servicios de la ficha con lo cambiado en Planning (rendimiento, vehículo,
 * personas) y los parámetros (los del pliego si los trae, luego los cambiados).
 * @returns { servicios, parametros, entrada } → dimensionar(entrada, parametros)
 */
export function entradaDimension(ficha, dim, extra = {}) {
  const servicios = Object.entries(ficha?.servicios || {}).map(([id, s]) => ({ id, ...s })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const jp = ficha?.datos?.jornadasAnio;
  const jornadasPliego = jp && jp.estado !== "descartado" ? Number(jp.valor) || null : null;
  const parametros = { ...extra, ...PARAMETROS_DEFECTO, ...(jornadasPliego ? { jornadasAnio: jornadasPliego } : {}), ...(dim?.parametros || {}) };
  const porServicio = dim?.porServicio || {};
  // vehículo y personas: lo cambiado en Planning > lo que exige el pliego (ficha) > orientativo
  const entrada = servicios.map(s => {
    const ps = porServicio[s.id] || {};
    return {
      ...s, porTurno: ps.porTurno ?? null, vehiculo: ps.vehiculo || s.vehiculo || null, personas: ps.personas ?? s.personas ?? null,
      // transporte: km, minutos y carga cambiados en Planning > los calculados (ficha)
      kmIda: ps.kmIda ?? s.kmIda ?? null, minutosIda: ps.kmIda != null ? (ps.minutosIda ?? null) : (s.minutosIda ?? null), cargaViaje: ps.cargaViaje ?? s.cargaViaje ?? null,
    };
  });
  return { servicios, parametros, porServicio, entrada };
}

/** El parque que da el pliego (tablas de solo unidades por fracción): [{ ubicacion, fraccion, unidades, pagina }] */
export function parqueDelPliego(tablas = []) {
  const out = [];
  tablas.forEach(t => {
    if (claseDe(t) !== "parque") return;
    for (const f of t.filas) {
      const fraccion = fraccionDe(f.concepto);
      if (!fraccion || fraccion === "Todas") continue;
      out.push({ ubicacion: ubicacionDe(f.grupo || "") || ubicacionDe(t.titulo), fraccion, unidades: f.valores[0], pagina: t.pagina });
    }
  });
  return out;
}

const mesesDeTexto = t => { const m = /(\d+(?:[.,]\d+)?)\s*(mes|a[nñ]o)/i.exec(String(t || "")); return m ? Number(m[1].replace(",", ".")) * (/a[nñ]o/i.test(m[2]) ? 12 : 1) : null; };
/** Lo que hace falta saber del concurso para pasar las mediciones al año: { presupuestoSinIva, meses } */
export function contextoDelConcurso(ficha, concurso) {
  const dato = k => { const d = ficha?.datos?.[k]; return d && d.estado !== "descartado" ? d.valor : null; };
  const pres = Number(dato("importeSinIva")) || Number(concurso?.presupuestoSinIva) || null;
  const meses = Number(concurso?.duracionMeses) || mesesDeTexto(dato("duracion")) || (Number(concurso?.duracionAnios) ? Number(concurso.duracionAnios) * 12 : null);
  return { presupuestoSinIva: pres, meses };
}

/**
 * Servicios ya guardados con las cantidades del presupuesto (de 1 mes, de 2
 * años…) como si fueran del año: lo que suman a su precio es el presupuesto y
 * el contrato no dura un año. @returns null | { factor, meses, ids, motivo }
 */
export function revisarPeriodo(servicios, contexto) {
  const conPrecio = (servicios || []).filter(s => Number(s.precioUnitario) > 0 && Number(s.cantidadAnual) > 0 && !s.periodoMeses);
  if (!conPrecio.length) return null;
  const per = periodoDeMediciones(conPrecio.map(s => ({ cantidad: s.cantidadAnual, precio: s.precioUnitario })), contexto);
  return per.factorAnual !== 1 ? { factor: per.factorAnual, meses: per.meses, ids: conPrecio.map(s => s.id), motivo: per.motivo } : null;
}
