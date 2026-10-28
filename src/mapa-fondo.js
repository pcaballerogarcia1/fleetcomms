// El fondo de los mapas (Leaflet): cada proveedor tiene imágenes hasta un
// zoom; más allá devuelve un cuadro de «no disponible». Con maxNativeZoom,
// Leaflet amplía la última imagen que hay en vez de pedir una que no existe.
// Y la mención de la fuente, que piden las licencias (OpenStreetMap, Esri).
export const ZOOM_MAX = 20;
export const ATRIB_OSM = '© colaboradores de <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
export const ATRIB_ESRI = "© Esri";

const nativoDe = url => (/World_(Dark|Light)_Gray/.test(url) ? 16 : /World_Imagery/.test(url) ? 18 : 19);
const atribDe = url => (/openstreetmap\.org/.test(url) ? ATRIB_OSM : /arcgisonline/.test(url) ? ATRIB_ESRI : "");

const esLienzo = url => /World_(Dark|Light)_Gray/.test(url);
const OSM = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Capa de fondo con su zoom real y su mención. Los fondos gris de Esri solo
 *  tienen detalle hasta el 16: desde ahí manda la capa de detalle (capaDetalle). */
export function capaFondo(L, url, opciones = {}) {
  const tope = esLienzo(url) ? { maxZoom: nativoDe(url) } : { maxNativeZoom: nativoDe(url), maxZoom: ZOOM_MAX };
  return L.tileLayer(url, { ...tope, attribution: atribDe(url), ...opciones });
}

/** Detalle a partir del zoom 17 (calles, portales): OpenStreetMap, oscurecido en el estilo oscuro */
export function capaDetalle(L, oscuro = true) {
  return L.tileLayer(OSM, { minZoom: 17, maxNativeZoom: 19, maxZoom: ZOOM_MAX, attribution: ATRIB_OSM, className: oscuro ? "op-fondo-oscuro" : "" });
}
export const necesitaDetalle = url => esLienzo(url);
export const esOscuro = url => /World_Dark_Gray/.test(url);

/** Opciones del mapa: zoom hasta 20 y la mención de la fuente abajo a la derecha */
export const opcionesMapa = (extra = {}) => ({ maxZoom: ZOOM_MAX, attributionControl: true, ...extra });

/** Quita el «Leaflet» delante de la mención */
export function sinPrefijo(map) {
  try { map.attributionControl?.setPrefix(false); } catch { /* sin control de mención */ }
  return map;
}
