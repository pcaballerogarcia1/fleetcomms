// Concursos → los kilómetros de un transporte (de cada depuradora, planta o
// punto limpio a donde se lleva): se busca cada sitio en CartoCiudad (por su
// nombre, por la dirección que da el pliego o por el municipio) y se mide la
// ruta por carretera con OSRM. Lo que no se encuentra se deja para poner a mano.
const CARTO = "https://www.cartociudad.es/geocoder/api/geocoder";
const OSRM = "https://router.project-osrm.org/route/v1/driving";

const kmLinea = (a, b) => {
  const R = 6371, r = x => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Los sitios que CartoCiudad da para un texto, con sus coordenadas: [{ texto, tipo, lat, lng }] */
export async function sitios(texto, { fetchFn = (...a) => fetch(...a), limite = 4 } = {}) {
  if (!texto) return [];
  let lista;
  try { lista = await (await fetchFn(`${CARTO}/candidates?limit=${limite}&q=${encodeURIComponent(texto)}`)).json(); } catch { return []; }
  const out = [];
  for (const c of lista || []) {
    let { lat, lng } = c;
    if (!lat || !lng) {
      try {
        const f = await (await fetchFn(`${CARTO}/find?id=${encodeURIComponent(c.id)}&type=${encodeURIComponent(c.type)}`)).text();
        const m = /"lat":\s*([\d.-]+),\s*"lng":\s*([\d.-]+)/.exec(f);
        if (m) { lat = Number(m[1]); lng = Number(m[2]); }
      } catch { /* sin coordenadas */ }
    }
    if (lat && lng) out.push({ texto: c.address || texto, tipo: c.type, lat, lng });
  }
  return out;
}

/**
 * Kilómetros de cada origen al destino.
 * @param origenes [{ nombre, direccion?, municipio? }]; destino: texto («Salto del Negro»)
 * @returns { destino: { texto, lat, lng } | null, rutas: [{ nombre, km, minutos, desde, metodo } | { nombre, error }] }
 */
export async function kmDeTransportes(origenes, destino, { fetchFn = (...a) => fetch(...a) } = {}) {
  const sin = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  // la dirección como la entiende CartoCiudad: «C/ Las Marciégas no2» → «Calle Las Marciégas 2»
  const limpia = d => String(d || "").replace(/\bC\/\s*/gi, "Calle ").replace(/\bAvda?\.?\s/gi, "Avenida ").replace(/\b(?:n[oº°]\.?\s*)(\d)/gi, "$1").replace(/\bs\/n\b/gi, "").replace(/\s+,/g, ",").trim();
  // de cada origen, todo lo que se puede probar, por orden de confianza
  const intentos = [];
  for (const o of origenes) {
    const clave = sin(o.nombre).replace(/\b(edar|etap|ebar|depuradora|planta|punto limpio|de|del|la|el|los|las)\b/g, " ").trim().split(/\s+/).filter(w => w.length > 2);
    const porNombre = (await sitios(o.nombre, { fetchFn })).filter(x => clave.length && clave.every(w => sin(x.texto).includes(w))).map(x => ({ ...x, metodo: "nombre" }));
    // la dirección: con el municipio y, si no sale (nombres antiguos de municipio), sin él; solo portales y calles
    let porDireccion = [];
    for (const t of o.direccion ? [`${limpia(o.direccion)}${o.municipio ? `, ${o.municipio}` : ""}`, limpia(o.direccion)] : []) {
      porDireccion = (await sitios(t, { fetchFn })).filter(x => x.tipo === "portal" || x.tipo === "callejero").map(x => ({ ...x, metodo: "dirección" }));
      if (porDireccion.length) break;
    }
    // el municipio o la población: solo si se llama así (no una calle con ese nombre en otra ciudad)
    const pueblo = (t, metodo) => sitios(t, { fetchFn }).then(l => l.filter(x => /municipio|poblacion|toponimo/.test(x.tipo) && sin(x.texto).includes(sin(t).split(/\s+/).filter(w => w.length > 3)[0] || sin(t))).map(x => ({ ...x, metodo })));
    const porMunicipio = o.municipio ? await pueblo(o.municipio, "municipio") : [];
    const porNombreSuelto = clave.length ? await pueblo(clave.join(" "), "población") : [];
    intentos.push([porNombre, porDireccion, porMunicipio, porNombreSuelto]);
  }
  const destinos = await sitios(destino, { fetchFn, limite: 6 });
  // el destino: el que tiene más orígenes cerca (hay sitios que se llaman igual en otras provincias)
  const cerca = (d, o) => Math.min(...o.flat().map(x => kmLinea(x, d)).concat([Infinity]));
  const elegido = destinos.map(d => ({ d, n: intentos.filter(o => cerca(d, o) < 150).length, suma: intentos.reduce((s, o) => s + Math.min(500, cerca(d, o)), 0) }))
    .sort((a, b) => b.n - a.n || a.suma - b.suma)[0]?.d || null;
  // cada origen: el primer intento (por confianza) que cae a menos de 150 km del destino
  const candidatos = intentos.map(o => (elegido ? o.map(lista => lista.filter(x => kmLinea(x, elegido) < 150)).find(l => l.length) || [] : []));
  const rutas = [];
  for (const [k, o] of origenes.entries()) {
    const c = candidatos[k];
    if (!elegido || !c.length) { rutas.push({ nombre: o.nombre, error: !elegido ? `No encuentro «${destino}»` : `No encuentro «${o.nombre}»` }); continue; }
    const desde = c[0];
    try {
      const j = await (await fetchFn(`${OSRM}/${desde.lng},${desde.lat};${elegido.lng},${elegido.lat}?overview=false`)).json();
      const r = j.routes?.[0];
      if (!r) throw new Error("sin ruta");
      rutas.push({ nombre: o.nombre, km: Math.round(r.distance / 100) / 10, minutos: Math.round(r.duration / 60), desde: desde.texto, metodo: desde.metodo });
    } catch { rutas.push({ nombre: o.nombre, error: "No se pudo medir la ruta" }); }
  }
  return { destino: elegido, rutas };
}
