// Planning de rutas por puntos: leer los archivos que se suben (CSV, Excel, KML).









import { loadXLSX } from "./datos.js";

// ── CSV PARSER ────────────────────────────────────────────────────
export function parseCSV(text) {
  const lines = text.replace(/\r/g, "").trim().split("\n").filter(Boolean);
  if (lines.length < 2) return { markers: [], error: "El CSV necesita al menos cabecera + 1 fila de datos." };

  // Detect delimiter: count commas vs semicolons in header
  const rawHeader = lines[0];
  const delim = (rawHeader.split(";").length > rawHeader.split(",").length) ? ";" : ",";

  const headers = rawHeader.split(delim).map(h => h.trim().replace(/^["']|["']$/g, "").toLowerCase());

  // Find lat/lng column indices — misma detección (exacta, luego por
  // palabra completa) que usa el importador de Excel, ver _findCol.
  const LAT_NAMES = ["lat","latitude","latitud","y","coord_y","geo_lat"];
  const LNG_NAMES = ["lon","lng","long","longitude","longitud","x","coord_x","geo_lon","geo_long"];
  const latHeader = _findCol(headers, LAT_NAMES);
  const lngHeader = _findCol(headers, LNG_NAMES);
  const latIdx = latHeader != null ? headers.indexOf(latHeader) : -1;
  const lngIdx = lngHeader != null ? headers.indexOf(lngHeader) : -1;

  if (latIdx === -1 || lngIdx === -1) {
    return {
      markers: [],
      error: `No se encontraron columnas de coordenadas. Cabeceras detectadas: ${headers.join(", ")}. Asegúrate de tener columnas 'lat'/'latitude' y 'lon'/'longitude'.`,
    };
  }

  const markers = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delim).map(c => c.trim().replace(/^["']|["']$/g, ""));
    // A prueba de coma decimal (frecuente en CSV exportados con locale
    // español) — sin esto, parseFloat("39,5712345") se quedaba en 39,
    // perdiendo todo el decimal en silencio: no daba error, simplemente
    // amontonaba puntos de sitios distintos en la misma coordenada
    // truncada a grados enteros.
    const lat = parseFloat((cols[latIdx] ?? "").replace(",", "."));
    const lng = parseFloat((cols[lngIdx] ?? "").replace(",", "."));
    if (isNaN(lat) || isNaN(lng)) continue;
    const fields = {};
    headers.forEach((h, idx) => {
      if (idx !== latIdx && idx !== lngIdx && cols[idx] !== undefined && cols[idx] !== "") {
        fields[h] = cols[idx];
      }
    });
    markers.push({ lat, lng, ...fields });
  }

  if (markers.length === 0) return { markers: [], error: "No se encontraron filas con coordenadas válidas." };
  return { markers, error: null };
}

// Interpreta una celda combinada "lat,lng" en sus dos números — a prueba
// del formato español (coma decimal), que hace ambiguo el separador de
// campo cuando también es coma. Casos reales que esto cubre:
//   "39.5712345,2.6543210"   → separador coma, decimales con punto (caso normal)
//   "39,5712345,2,6543210"   → 4 trozos sin puntos: cada par de trozos es
//                              un número con coma decimal, pegado sin más
//                              separador que la propia coma decimal
//   "39,5712345;2,6543210"   → punto y coma como separador de campo,
//                              coma como decimal dentro de cada número
// Antes, un simple raw.split(",") con el primer/segundo trozo se comía
// filas enteras con coma decimal: partía "39,5712345,2,6543210" en 4
// trozos y se quedaba solo con los dos primeros (lat=39, lng=5712345),
// que ni siquiera pasa el rango geográfico — la fila entera se perdía en
// silencio, sin error visible para el usuario.
function parseCoordPair(raw) {
  const parts = raw.split(",").map(s => s.trim());

  if (parts.length === 2) {
    const lat = parseFloat(parts[0]), lng = parseFloat(parts[1]);
    if (!isNaN(lat) && !isNaN(lng)) return [lat, lng];
  }
  if (parts.length === 4 && parts.every(p => !p.includes("."))) {
    const lat = parseFloat(`${parts[0]}.${parts[1]}`);
    const lng = parseFloat(`${parts[2]}.${parts[3]}`);
    if (!isNaN(lat) && !isNaN(lng)) return [lat, lng];
  }
  if (raw.includes(";")) {
    const semi = raw.split(";").map(s => s.trim().replace(",", "."));
    if (semi.length === 2) {
      const lat = parseFloat(semi[0]), lng = parseFloat(semi[1]);
      if (!isNaN(lat) && !isNaN(lng)) return [lat, lng];
    }
  }
  return [NaN, NaN];
}

// Quita acentos y pasa a minúsculas — "Latitud (grados)" y "Latitud" deben
// reconocerse igual aunque el usuario le ponga texto extra a la cabecera.
function _normHeader(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// ── XLSX PARSER ───────────────────────────────────────────────────
// Dos niveles: primero coincidencia exacta (más segura); si ninguna
// columna encaja así, se prueba una coincidencia "por palabra completa"
// dentro de la cabecera (con límites de palabra, para que "latitud" no
// case por accidente con algo tipo "plataforma"). Esto cubre cabeceras
// reales tipo "Latitud (WGS84)", "LAT." o "Coordenada Y" que antes no
// encontraban columna y el import fallaba entero con "no se encontraron
// columnas de coordenadas".
function _findCol(keys, candidates) {
  for (const c of candidates) {
    const k = keys.find(k => _normHeader(k) === c);
    if (k) return k;
  }
  // Candidatos de una sola letra ("x", "y") se quedan fuera del nivel 2:
  // "y" es la conjunción española, así que "Nombre y Dirección" haría
  // falso positivo como columna de latitud si se permitiera aquí.
  for (const c of candidates.filter(c => c.length > 2)) {
    const re = new RegExp(`\\b${c}\\b`);
    const k = keys.find(k => re.test(_normHeader(k)));
    if (k) return k;
  }
  return null;
}

function parseXLSXRows(rows) {
  if (rows.length === 0) return { markers: [], error: "La hoja está vacía." };

  const keys = Object.keys(rows[0]);

  // Priority 1: separate numeric lat/lng columns (most reliable — SheetJS returns actual JS numbers)
  const LAT_CANDS = ["latitud", "lat", "latitude", "y", "geo_lat", "coord_lat"];
  const LNG_CANDS = ["longitud", "lon", "lng", "long", "longitude", "x", "geo_lon", "geo_long", "coord_lon", "coord_lng"];
  const latKey = _findCol(keys, LAT_CANDS);
  const lngKey = _findCol(keys, LNG_CANDS);

  // Priority 2: combined "coordenadas" column (only when separate columns not found)
  const coordKey = (!latKey || !lngKey) ? _findCol(keys, ["coordenadas", "coordinates", "coords"]) : null;

  if (!latKey && !lngKey && !coordKey) {
    return { markers: [], error: `No se encontraron columnas de coordenadas. Columnas detectadas: ${keys.join(", ")}. El Excel debe tener columnas "Latitud"/"Longitud" o una columna "Coordenadas" (lat,lng).` };
  }

  const markers = [];
  let utmCount = 0;
  for (const row of rows) {
    let lat, lng;
    if (latKey && lngKey) {
      // Numeric cells from SheetJS — most reliable
      lat = parseFloat(String(row[latKey] ?? "").replace(",", "."));
      lng = parseFloat(String(row[lngKey] ?? "").replace(",", "."));
    } else {
      // Combined "coordenadas" text column — a prueba de coma decimal (ver parseCoordPair)
      const raw = String(row[coordKey] ?? "").trim();
      if (!raw) continue;
      [lat, lng] = parseCoordPair(raw);
    }
    if (isNaN(lat) || isNaN(lng)) continue;
    // Skip UTM / out-of-range geographic coordinates
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) { utmCount++; continue; }

    const skipKeys = new Set([coordKey, latKey, lngKey].filter(Boolean));
    const fields = {};
    for (const [k, v] of Object.entries(row)) {
      if (!skipKeys.has(k)) fields[k] = String(v);
    }
    markers.push({ lat, lng, ...fields });
  }

  if (markers.length === 0) {
    const hint = utmCount > 0
      ? `Se detectaron ${utmCount} filas con coordenadas fuera de rango geográfico (¿están en UTM?). Convierte a WGS84 decimal antes de subir.`
      : `No se encontraron filas con coordenadas válidas.`;
    return { markers: [], error: hint };
  }
  return { markers, error: null };
}

export async function parseXLSX(file) {
  const XLSX = await loadXLSX();
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });

  if (wb.SheetNames.length === 0) return { markers: [], error: "El archivo Excel está vacío." };

  // Antes solo se miraba wb.SheetNames[0] — si los datos estaban en una
  // pestaña que no era la primera (portada, resumen, otra hoja delante...)
  // el import fallaba con "no se encontraron columnas de coordenadas" sin
  // más pista, aunque el archivo tuviera los datos correctos más allá.
  // Probamos cada hoja en orden y nos quedamos con la primera que dé
  // resultado; si ninguna cuaja, devolvemos el error de la última — suele
  // ser la más informativa (la hoja con más pinta de ser la de datos).
  let lastResult = { markers: [], error: "El archivo Excel está vacío." };
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
    const result = parseXLSXRows(rows);
    if (result.markers.length > 0) return result;
    lastResult = result;
  }
  return lastResult;
}

// ── KML PARSER (generic) ─────────────────────────────────────────
export function parseKMLPlanning(rawText) {
  const markers = [];
  try {
    const text = rawText.charCodeAt(0) === 0xFEFF ? rawText.slice(1) : rawText;

    function getTag(block, tag) {
      const s = block.indexOf(`<${tag}>`), e = block.indexOf(`</${tag}>`);
      return (s !== -1 && e > s) ? block.slice(s + tag.length + 2, e).trim() : "";
    }
    function getAllData(block) {
      const fields = {};
      const sdRe = /<SimpleData\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/SimpleData>/g;
      let m;
      while ((m = sdRe.exec(block)) !== null) fields[m[1]] = m[2].trim();
      const dRe = /<Data\s+name="([^"]+)"[^>]*>[\s\S]*?<value>([\s\S]*?)<\/value>/g;
      while ((m = dRe.exec(block)) !== null) fields[m[1]] = m[2].trim();
      return fields;
    }

    let pos = 0;
    while (true) {
      const ps = text.indexOf("<Placemark>", pos);
      if (ps === -1) break;
      const pe = text.indexOf("</Placemark>", ps);
      if (pe === -1) break;
      const block = text.slice(ps, pe + 12);
      pos = pe + 12;

      if (block.includes("<LineString>")) continue;

      const cs = block.indexOf("<coordinates>"), ce = block.indexOf("</coordinates>");
      if (cs === -1 || ce === -1) continue;
      const parts = block.slice(cs + 13, ce).trim().split(",");
      if (parts.length < 2) continue;
      const lng = parseFloat(parts[0]), lat = parseFloat(parts[1]);
      if (isNaN(lat) || isNaN(lng)) continue;

      const name = getTag(block, "name") || getTag(block, "description") || "";
      const fields = getAllData(block);
      // Remove coordinate-named keys so they can't override parsed lat/lng
      const COORD_KEYS = ["lat","lng","lon","latitude","longitude","latitud","longitud","x","y"];
      COORD_KEYS.forEach(k => { delete fields[k]; delete fields[k.toUpperCase()]; });
      markers.push({ lat, lng, nombre: name, ...fields });
    }
  } catch (e) {
    return { markers: [], error: "Error al parsear el KML: " + e.message };
  }

  if (markers.length === 0) return { markers: [], error: "No se encontraron puntos (Placemarks) en el KML." };
  return { markers, error: null };
}
