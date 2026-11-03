// Planificación · importar puntos con DIRECCIÓN en vez de coordenadas (la
// lista de clientes que sale de cualquier programa de facturación): se
// reconocen las columnas de calle, número, municipio y código postal, se
// arma el texto de búsqueda y se sitúa cada dirección en el mapa con
// CartoCiudad (concursos/geocodificar.js: el buscador oficial, gratis).
// Sin React ni Firebase.

const norm = s => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9º]+/g, " ").trim();

const DIRECCION = ["direccion", "direccion de entrega", "direccion entrega", "direccion de envio", "direccion envio", "domicilio", "domicilio de entrega", "address", "calle", "via", "carrer", "direccion completa", "direccion postal"];
const NUMERO = ["numero", "num", "n", "nº", "n º", "no", "portal", "number"];
const MUNICIPIO = ["municipio", "poblacion", "localidad", "ciudad", "city", "town", "municipi", "poblacio", "localitat"];
const CP = ["cp", "c p", "codigo postal", "cod postal", "postal", "zip", "codi postal"];

/** Las columnas de dirección de una hoja: { direccion, numero, municipio, cp } (o null si no hay calle) */
export function columnasDireccion(claves) {
  const busca = lista => {
    for (const c of lista) { const k = claves.find(x => norm(x) === c); if (k) return k; }
    // «Dirección del cliente», «Población (envío)»…: por palabra al principio
    for (const c of lista.filter(c => c.length > 3)) { const k = claves.find(x => norm(x).startsWith(`${c} `)); if (k) return k; }
    return null;
  };
  const direccion = busca(DIRECCION);
  if (!direccion) return null;
  return { direccion, numero: busca(NUMERO), municipio: busca(MUNICIPIO), cp: busca(CP) };
}

// abreviaturas de vía más comunes, para que el buscador las entienda
const ABREV = [[/^c\s*\/\s*/i, "Calle "], [/^cl\.?\s+/i, "Calle "], [/^avda?\.?\s+/i, "Avenida "], [/^av\.\s*/i, "Avenida "], [/^pza?\.?\s+/i, "Plaza "], [/^pl\.\s*/i, "Plaza "],
  [/^p[ºo°]\.?\s+/i, "Paseo "], [/^ctra\.?\s+/i, "Carretera "], [/^cno\.?\s+/i, "Camino "], [/^ronda\s+/i, "Ronda "], [/^trv?a?\.?\s+/i, "Travesía "]];
const limpia = s => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * El texto para buscar una fila: «Calle Mayor 12, Madrid».
 * Admite la dirección entera en una columna («C/ Mayor, 12 - 28013 Madrid»)
 * o repartida en calle, número, municipio y código postal.
 * @returns el texto, o null si la fila no trae calle
 */
export function textoDireccion(fila, cols, municipioDefecto = "") {
  let calle = limpia(fila[cols.direccion]);
  if (!calle) return null;
  let num = limpia(cols.numero ? fila[cols.numero] : "");
  let muni = limpia(cols.municipio ? fila[cols.municipio] : "");
  // todo en una columna: «Calle, número, CP Municipio» → la calle y lo demás
  if (calle.includes(",") || / - /.test(calle)) {
    const partes = calle.split(/\s*,\s*|\s+-\s+/).filter(Boolean);
    calle = partes.shift();
    for (const p of partes) {
      if (!num && /^(n[º°o.]?\s*)?\d+\s*[a-z]?$/i.test(p)) num = p;
      else if (!muni && /[a-záéíóúñ]{3,}/i.test(p.replace(/\b\d{5}\b/, ""))) muni = p;
    }
  }
  // el número pegado a la calle («Mayor 12», «Mayor nº 12», «Mayor, 12 bajo»)
  // (solo al final, o seguido de piso o puerta: «Calle 5 de Mayo» no lleva número)
  const pegado = calle.match(/^(.*?)(?:,?\s+n[º°o.]?\s*|\s+)(\d+)\s*(?:[a-z]\b|bis\b)?\s*(?:(?:bajo|bj|pral|principal|entlo|local|piso|puerta|planta|esc\w*|\d+\s*[ºª°]).*)?$/i);
  if (!num && pegado && pegado[1].length > 2) { calle = pegado[1]; num = pegado[2]; }
  num = (String(num).match(/\d+/) || [""])[0];
  for (const [re, txt] of ABREV) if (re.test(calle)) { calle = calle.replace(re, txt); break; }
  // fuera el código postal (estorba al comparar el municipio) y lo que va entre paréntesis
  muni = limpia(String(muni || municipioDefecto).replace(/\b\d{5}\b/g, "").replace(/\(.*?\)/g, ""));
  calle = limpia(calle.replace(/\b\d{5}\b/g, ""));
  return [`${calle}${num ? ` ${num}` : ""}`, muni].filter(Boolean).join(", ");
}

/** ¿Hace falta preguntar el municipio? (ninguna fila lo trae ni en su columna ni dentro de la dirección) */
export const faltaMunicipio = pendientes => pendientes.length > 0 && pendientes.every(p => !p.texto.includes(","));

/**
 * Las filas sin coordenadas, ya situadas → puntos de la capa.
 * @param pendientes [{ campos, texto }] (texto armado con el municipio que tocara)
 * @param porDireccion Map<texto, { lat, lng, calidad, texto } | null>
 * @returns { markers, sinSituar: [{ campos, texto }] }
 */
export function situarPendientes(pendientes, porDireccion) {
  const markers = [], sinSituar = [];
  for (const p of pendientes) {
    const r = porDireccion.get(p.texto);
    if (!r) { sinSituar.push(p); continue; }
    markers.push({
      ...p.campos, lat: r.lat, lng: r.lng,
      situado: r.calidad === "portal" ? "en el portal" : r.calidad === "calle" ? "en la calle (aproximado)" : "en el municipio (revisar)",
    });
  }
  return { markers, sinSituar };
}

/** Rehace el texto de búsqueda de las pendientes con el municipio que diga el usuario */
export const conMunicipio = (pendientes, cols, municipio) => pendientes.map(p => ({ ...p, texto: textoDireccion(p.campos, cols, municipio) || p.texto }));

/** La plantilla de Excel para quien no tiene nada: clientes con dirección (sin coordenadas) y lo que se les entrega */
export const PLANTILLA = [
  { Cliente: "Bar El Puente", Dirección: "Calle Mayor", Número: "12", Población: "Salamanca", "Código postal": "37002", Teléfono: "923 000 111", "Persona de contacto": "Luis", Pedido: "P-1001", Bultos: 3, Kg: 45, Desde: "09:00", Hasta: "11:00", "Duración (min)": 8, Notas: "Entrar por la puerta de atrás" },
  { Cliente: "Farmacia Sol", Dirección: "Plaza Mayor", Número: "5", Población: "Salamanca", "Código postal": "37002", Teléfono: "923 000 222", "Persona de contacto": "Marta", Pedido: "P-1002", Bultos: 1, Kg: 6, Desde: "", Hasta: "", "Duración (min)": 5, Notas: "" },
  { Cliente: "Restaurante La Ría", Dirección: "Avenida de Portugal", Número: "40", Población: "Salamanca", "Código postal": "37005", Teléfono: "923 000 333", "Persona de contacto": "", Pedido: "P-1003", Bultos: 6, Kg: 110, Desde: "12:00", Hasta: "13:30", "Duración (min)": 12, Notas: "Llamar antes de llegar" },
];
export const PLANTILLA_AYUDA = [
  ["Cómo rellenarla"],
  ["Una fila por cliente o por entrega. No hacen falta coordenadas: la dirección se sitúa sola en el mapa."],
  ["Dirección y Población son obligatorias (el número puede ir en su columna o dentro de la dirección)."],
  ["Bultos y Kg: lo que se entrega. Si el vehículo tiene «carga máxima» en su ficha, cuentan los kilos."],
  ["Desde / Hasta: la franja que se le promete al cliente (déjalas vacías si da igual)."],
  ["Duración (min): lo que se tarda en la parada (si no, la de por defecto del proyecto)."],
  ["El resto de columnas (teléfono, persona de contacto, notas…) las verá el conductor en el móvil."],
];
