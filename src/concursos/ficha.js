// Ficha de requisitos de un concurso: lo que el usuario confirma del pliego.
// El lector (pliego.js) solo PROPONE; aquí se convierte lo propuesto en
// requisitos que se confirman o se corrigen, y de esta ficha leen los demás
// módulos (Planning para dimensionar, Cálculo, Resumen). Sin React ni Firebase.
//
// Ficha (concursos/{id}/requisitos/ficha):
//   datos:     { [clave]: { valor, estado: "confirmado" | "corregido" | "descartado", propuesto, pagina, frase, doc } }
//   servicios: { [id]: { nombre, fraccion, ubicacion, cantidadAnual, unidades, frecuencia, pagina, doc, orden } }

const sinAcentos = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Fracción a partir de cómo la llama el pliego
const FRACCIONES = [
  ["Resto", /\b(rsu|resto|rechazo|fraccion resto)\b/],
  ["Papel y cartón", /\b(papel|carton|pc)\b/],
  ["Envases", /\b(envases?|envasos|ligeros)\b/],
  ["Vidrio", /\bvidrio\b/],
  ["Orgánica", /\b(organica|form|biorresiduo|bio)\b/],
  ["Todas", /\b(todas|todos|total)\b/],
];
export function fraccionDe(texto) {
  const t = sinAcentos(texto);
  return FRACCIONES.find(([, re]) => re.test(t))?.[0] || null;
}
export function ubicacionDe(texto) {
  const t = sinAcentos(texto);
  if (/soterrad/.test(t)) return "Soterrado";
  if (/superficie/.test(t)) return "Superficie";
  if (/carga lateral|lateral/.test(t)) return "Carga lateral";
  if (/bilateral|carga superior/.test(t)) return "Bilateral";
  return null;
}

// Nombre del servicio a partir del título de la tabla
const SERVICIOS = [
  ["Mantenimiento correctivo", /mantenimiento correctivo|correctivo/],
  ["Mantenimiento preventivo", /mantenimiento preventivo|preventivo|mantenimiento/],
  ["Limpieza bajo contenedor", /bajo contenedor|bajos|zona inferior|pavimento/],
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
 * Tablas del pliego convertidas en servicios propuestos: una línea por fila
 * (fracción y ubicación) con su cantidad al año. Cada tabla dice si se
 * propone usarla (porAnio) o no (cantidades por trimestre, programación mes a
 * mes…): el usuario elige y corrige.
 * @param tablas  lectura.tablas de pliego.js
 * @param docId   el documento del que salen (para volver a la página)
 * @returns [{ indice, titulo, pagina, servicio, usar, motivo, lineas: [{ id, nombre, fraccion, ubicacion, cantidadAnual, concepto, … }] }]
 */
export function tablasParaServicios(tablas = [], docId = null) {
  const propuestas = tablas.map((t, k) => {
    const texto = `${t.titulo} ${t.cabecera || ""}`;
    const nombreTabla = servicioDe(t.titulo) || servicioDe(t.cabecera || "");
    const porAnios = /a[nñ]o/i.test(texto);              // columnas por año (1r año, 2º año…)
    const anual = /anual/i.test(texto);                   // «cantidades previstas anuales»: la última columna
    const mesAMes = /enero|febrero|mes 1|d[ií]as\/mes/i.test(texto);
    const trimestral = t.filas.some(f => /trimestral|semestral|mensual/i.test(f.concepto));
    const lineas = [];
    let conProducto = false; // alguna fila es «ud × veces = total»: cantidades al año
    t.filas.forEach((f, i) => {
      if (/suma|total general|acumulad|festivos|d[ií]as/i.test(f.concepto)) return;
      const iguales = f.valores.every(v => v === f.valores[0]);
      // años iguales → el primero; «cantidades anuales» con varias columnas → la última (ud × veces = anual)
      // o la última si es el producto de las demás por un número entero (543 ud × 2 veces/mes × 7 meses = 7.602)
      const ult = f.valores[f.valores.length - 1], prod = f.valores.slice(0, -1).reduce((x, y) => x * y, 1);
      const esProducto = f.valores.length >= 3 && prod > 0 && ult > prod && ult % prod === 0;
      if (esProducto) conProducto = true;
      const cantidad = iguales ? f.valores[0] : anual || esProducto ? ult : f.valores[0];
      if (!(cantidad > 0)) return;
      const concepto = f.concepto.replace(/\s+\d[\d.,]*\s+(trimestral|semestral|mensual|anual)\b.*$/i, "");
      const ubicacion = ubicacionDe(f.grupo || "") || ubicacionDe(f.concepto) || ubicacionDe(t.titulo);
      lineas.push({
        id: `d${docId || "x"}_t${k}_${i}`, nombre: servicioDe(concepto) || nombreTabla || "Servicio",
        fraccion: fraccionDe(concepto) || fraccionDe(f.grupo || "") || concepto,
        ubicacion, cantidadAnual: cantidad, concepto: [f.grupo, f.concepto].filter(Boolean).join(" · "),
        tabla: t.titulo, pagina: t.pagina, doc: docId,
      });
    });
    const usar = lineas.length > 0 && !mesAMes && !trimestral && (porAnios || anual || conProducto);
    const motivo = mesAMes ? "programación mes a mes" : trimestral ? "cantidades por periodo (no al año)" : !(porAnios || anual || conProducto) ? "no dice que sean cantidades al año" : null;
    return { indice: k, titulo: t.titulo, pagina: t.pagina, servicio: nombreTabla, usar, motivo, lineas };
  }).filter(t => t.lineas.length);
  // El mismo servicio en dos tablas (el pliego lo cuenta dos veces, a veces
  // con cifras distintas): solo se propone la primera y se avisa en la otra
  const usados = new Map();
  for (const t of propuestas) {
    if (!t.usar) continue;
    const claves = [...new Set(t.lineas.map(l => `${l.nombre}|${l.ubicacion || ""}`))];
    const repetida = claves.map(c => usados.get(c)).find(Boolean);
    if (repetida) {
      const total = ts => ts.lineas.filter(l => claves.includes(`${l.nombre}|${l.ubicacion || ""}`)).reduce((a, l) => a + l.cantidadAnual, 0);
      t.usar = false;
      t.motivo = `repite «${t.servicio || t.lineas[0].nombre}» de la pág. ${repetida.pagina}` + (total(t) !== total(repetida) ? ` con otra cifra (${total(t).toLocaleString("es-ES")} frente a ${total(repetida).toLocaleString("es-ES")}): elige cuál vale` : "");
      continue;
    }
    claves.forEach(c => usados.set(c, t));
  }
  return propuestas;
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

// ── Rendimientos orientativos (por turno de ~7 h) ──
// Valores de partida para dimensionar sin inventario; se cambian en Planning
// con la experiencia de cada empresa (y, más adelante, con los datos reales).
export const RENDIMIENTOS = [
  { servicio: "Lavado interior", ubicacion: "Soterrado", porTurno: 25, nota: "camión lavacontenedores con sistema de elevación" },
  { servicio: "Lavado interior", ubicacion: "Bilateral", porTurno: 35, nota: "carga superior bilateral" },
  { servicio: "Lavado interior", ubicacion: null, porTurno: 70, nota: "carga lateral / superficie" },
  { servicio: "Limpieza exterior", ubicacion: "Soterrado", porTurno: 60, nota: "hidrolimpiadora, buzones" },
  { servicio: "Limpieza exterior", ubicacion: null, porTurno: 70, nota: "hidrolimpiadora" },
  { servicio: "Limpieza bajo contenedor", ubicacion: null, porTurno: 60, nota: "barrido y fregado del pavimento" },
  { servicio: "Mantenimiento preventivo", ubicacion: "Soterrado", porTurno: 20, nota: "revisión de soterrado (mecanismos, plataforma)" },
  { servicio: "Mantenimiento preventivo", ubicacion: null, porTurno: 40, nota: "revisión de contenedor de superficie" },
  { servicio: "Mantenimiento correctivo", ubicacion: null, porTurno: 10, nota: "reparaciones por aviso" },
  { servicio: "Achiques", ubicacion: null, porTurno: 10, nota: "achique de fosos de soterrados" },
  { servicio: "Recogida", ubicacion: "Soterrado", porTurno: 120, nota: "carga bilateral / grúa" },
  { servicio: "Recogida", ubicacion: null, porTurno: 250, nota: "carga lateral" },
  { servicio: null, ubicacion: null, porTurno: 50, nota: "valor genérico: ajústalo" },
];
export function rendimientoOrientativo(s) {
  const r = RENDIMIENTOS.find(x => (x.servicio === s.nombre || x.servicio == null) && (x.ubicacion == null || x.ubicacion === s.ubicacion));
  return r ? { porTurno: r.porTurno, nota: r.nota } : { porTurno: 50, nota: "valor genérico: ajústalo" };
}

export const PARAMETROS_DEFECTO = {
  jornadasAnio: 357,        // días de servicio al año (los del pliego si los trae)
  horasTurno: 7,            // horas de trabajo efectivo por turno
  personasPorEquipo: 1,     // conductor (+ peón si hace falta)
  horasAnualesConvenio: 1720, // horas de trabajo al año de un trabajador (convenio)
  absentismoPct: 6,         // bajas y ausencias, en % de las horas
};

/**
 * Dimensionar por rendimientos (sin inventario ni rutas).
 * @param servicios [{ id, nombre, fraccion, ubicacion, cantidadAnual, porTurno, equipo }]
 *   equipo: nombre del equipo (vehículo) que lo hace; los servicios con el mismo equipo lo comparten
 * @param p PARAMETROS_DEFECTO (o los del concurso)
 * @returns { lineas: [{ …, turnosAnio }], equipos: [{ equipo, turnosAnio, porDia, unidades }], resumen }
 */
export function dimensionar(servicios, p = PARAMETROS_DEFECTO) {
  const q = { ...PARAMETROS_DEFECTO, ...p };
  const lineas = servicios.map(s => {
    const porTurno = Number(s.porTurno) > 0 ? Number(s.porTurno) : rendimientoOrientativo(s).porTurno;
    return { ...s, porTurno, turnosAnio: (Number(s.cantidadAnual) || 0) / porTurno };
  });
  const porEquipo = new Map();
  for (const l of lineas) {
    const e = l.equipo || l.nombre;
    porEquipo.set(e, (porEquipo.get(e) || 0) + l.turnosAnio);
  }
  const equipos = [...porEquipo.entries()].map(([equipo, turnosAnio]) => {
    const porDia = turnosAnio / q.jornadasAnio;     // turnos que hacen falta cada día de servicio
    const unidades = Math.max(1, Math.ceil(porDia - 1e-9)); // vehículos (un turno al día cada uno)
    return { equipo, turnosAnio, porDia, unidades, ocupacion: porDia / unidades };
  });
  const turnosAnio = lineas.reduce((s, l) => s + l.turnosAnio, 0);
  const horasAnio = turnosAnio * q.horasTurno * q.personasPorEquipo;
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
