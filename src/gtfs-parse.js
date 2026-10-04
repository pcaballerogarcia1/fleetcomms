// ── Lectura de GTFS (red de transporte) para Planning ─────────────────
// Un GTFS es un .zip con CSVs: stops, routes, trips, stop_times, shapes…
// Las redes grandes pesan mucho (Roma: stop_times de 235 MB sin comprimir),
// así que nada se carga entero: se lee el índice del zip y cada archivo se
// descomprime y procesa por trozos, línea a línea, en el orden que conviene
// (rutas y viajes antes que stop_times), venga como venga en el zip.
//
// Resultado:
//   paradas: [{ lat, lng, nombre, codigo, lineas: "211 · C2", _r: [ids de ruta] }]
//   lineas:  [{ id, nombre, largo, color, tipo, agencia, viajes, paradas,
//               primera, ultima, trazados: [[[lat, lng], …], …] }]
// Funciona igual en el navegador (File) y en Node (Blob) — sin DOM.

import { Inflate } from "fflate";

// ── zip: índice central y descompresión por trozos ───────────────────
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const bytesOf = async blob => new Uint8Array(await blob.arrayBuffer());

export async function zipEntries(blob) {
  const tail = Math.min(blob.size, 65_557);
  const end = await bytesOf(blob.slice(blob.size - tail));
  let e = -1;
  for (let i = end.length - 22; i >= 0; i--) if (u32(end, i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("No es un archivo .zip válido");
  const count = u16(end, e + 10), cdSize = u32(end, e + 12), cdOff = u32(end, e + 16);
  const cd = await bytesOf(blob.slice(cdOff, cdOff + cdSize));
  const out = new Map();
  for (let p = 0, k = 0; k < count && p < cd.length; k++) {
    if (u32(cd, p) !== 0x02014b50) break;
    const method = u16(cd, p + 10), csize = u32(cd, p + 20), usize = u32(cd, p + 24);
    const nlen = u16(cd, p + 28), xlen = u16(cd, p + 30), clen = u16(cd, p + 32), local = u32(cd, p + 42);
    const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nlen));
    // GTFS a veces viene dentro de una carpeta: se usa el nombre sin ruta
    out.set(name.split("/").pop().toLowerCase(), { name, method, csize, usize, local });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/** Recorre las líneas de un archivo del zip: onLine(texto) por cada una. */
async function forEachLine(blob, entry, onLine, onBytes) {
  const lh = await bytesOf(blob.slice(entry.local, entry.local + 30));
  if (u32(lh, 0) !== 0x04034b50) throw new Error(`Cabecera dañada en ${entry.name}`);
  const start = entry.local + 30 + u16(lh, 26) + u16(lh, 28);
  const dec = new TextDecoder("utf-8");
  let resto = "";
  const texto = (chunk, final) => {
    const s = resto + dec.decode(chunk, { stream: !final });
    const lines = s.split("\n");
    resto = final ? "" : lines.pop();
    for (const l of lines) onLine(l.endsWith("\r") ? l.slice(0, -1) : l);
  };
  if (entry.method === 0) {
    const reader = blob.slice(start, start + entry.csize).stream().getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; texto(value, false); onBytes?.(value.length); }
    texto(new Uint8Array(0), true);
    return;
  }
  if (entry.method !== 8) throw new Error(`Compresión no soportada en ${entry.name}`);
  const inf = new Inflate((data, final) => texto(data, final));
  const reader = blob.slice(start, start + entry.csize).stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) { inf.push(new Uint8Array(0), true); break; }
    inf.push(value, false);
    onBytes?.(value.length);
  }
}

// ── CSV ──────────────────────────────────────────────────────────────
export function csvLine(line) {
  if (line.indexOf('"') < 0) return line.split(",");
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export async function leerCsv(blob, entries, file, onRow, onBytes) {
  const entry = entries.get(file);
  if (!entry) return false;
  let idx = null;
  await forEachLine(blob, entry, line => {
    if (!line.trim()) return;
    const cols = csvLine(line);
    if (!idx) {
      idx = Object.fromEntries(cols.map((c, i) => [c.replace(/^\uFEFF/, "").trim().toLowerCase(), i]));
      return;
    }
    onRow(cols, idx);
  }, onBytes);
  return true;
}

// ── Utilidades ───────────────────────────────────────────────────────
export const PALETA = ["#5c9bff", "#34d399", "#fb923c", "#f87171", "#a78bfa", "#fbbf24", "#f472b6", "#22d3ee", "#84cc16", "#e879f9", "#38bdf8", "#facc15"];

export function tipoRuta(t) {
  const n = Number(t);
  if (n === 0 || (n >= 900 && n < 1000)) return "Tranvía";
  if (n === 1 || (n >= 400 && n < 500)) return "Metro";
  if (n === 2 || (n >= 100 && n < 200)) return "Tren";
  if (n === 3 || (n >= 700 && n < 800)) return "Autobús";
  if (n === 4 || (n >= 1000 && n < 1300)) return "Barco";
  if (n === 11 || n === 800) return "Trolebús";
  if (n === 5 || n === 6 || n === 7 || n === 12) return "Cable / funicular";
  return "Otro";
}

export const hhmm = s => {
  const m = /^(\d+):(\d\d)/.exec(s || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
// GTFS cuenta la madrugada del día siguiente como 25:30, 28:04…: se muestra "01:30 (+1)"
export const minToHHMM = m => {
  if (m == null) return "";
  const dias = Math.floor(m / 1440), r = m % 1440;
  return `${String(Math.floor(r / 60)).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}${dias ? ` (+${dias})` : ""}`;
};

/** Douglas-Peucker sobre [[lat, lng], …] (tolerancia en grados) */
export function simplificar(pts, tol = 0.00008) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ay, ax] = pts[a], [by, bx] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let max = 0, imax = -1;
    for (let i = a + 1; i < b; i++) {
      const [py, px] = pts[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey;
      if (d > max) { max = d; imax = i; }
    }
    if (imax >= 0 && max > tol * tol) { keep[imax] = 1; stack.push([a, imax], [imax, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export const r5 = x => Math.round(x * 1e5) / 1e5;

// ── Lectura completa ─────────────────────────────────────────────────
/**
 * @param blob File/Blob del .zip
 * @param onProgress (fraccion 0..1, texto)
 */
export async function parseGtfs(blob, { onProgress = () => {} } = {}) {
  const entries = await zipEntries(blob);
  for (const f of ["stops.txt", "routes.txt", "trips.txt", "stop_times.txt"]) {
    if (!entries.has(f)) throw new Error(`No parece un GTFS: falta ${f}`);
  }
  const total = [...entries.values()].reduce((s, e) => s + e.csize, 0) || 1;
  let leidos = 0, ultimo = 0, fase = "";
  const bytes = n => {
    leidos += n;
    const f = leidos / total;
    if (f - ultimo > 0.01) { ultimo = f; onProgress(Math.min(f, 0.99), fase); }
  };
  const paso = t => { fase = t; onProgress(Math.min(leidos / total, 0.99), t); };

  // Agencias
  const agencias = new Map();
  paso("Leyendo operadores…");
  await leerCsv(blob, entries, "agency.txt", (c, i) => agencias.set(c[i.agency_id] ?? "", c[i.agency_name] ?? ""), bytes);

  // Rutas (líneas)
  paso("Leyendo líneas…");
  const lineas = [], rutaIdx = new Map();
  await leerCsv(blob, entries, "routes.txt", (c, i) => {
    const id = c[i.route_id];
    if (!id || rutaIdx.has(id)) return;
    const corto = (c[i.route_short_name] || "").trim(), largo = (c[i.route_long_name] || "").trim();
    const col = (c[i.route_color] || "").trim().replace(/^#/, "");
    const k = lineas.length;
    rutaIdx.set(id, k);
    lineas.push({
      id, nombre: corto || largo || id, largo: corto ? largo : "",
      color: /^[0-9a-f]{6}$/i.test(col) ? `#${col.toLowerCase()}` : PALETA[k % PALETA.length],
      tipo: tipoRuta(c[i.route_type]),
      agencia: agencias.get(c[i.agency_id] ?? "") || (agencias.size === 1 ? [...agencias.values()][0] : ""),
      viajes: 0, paradas: 0, primera: null, ultima: null, trazados: [],
    });
  }, bytes);

  // Viajes: a qué línea pertenece cada uno y qué trazado usa
  paso("Leyendo viajes…");
  const viajeRuta = new Map();
  const usoTrazado = new Map(); // "ruta|sentido" → Map(shape → nº viajes)
  await leerCsv(blob, entries, "trips.txt", (c, i) => {
    const r = rutaIdx.get(c[i.route_id]);
    if (r === undefined) return;
    viajeRuta.set(c[i.trip_id], r);
    lineas[r].viajes++;
    const sh = i.shape_id != null ? c[i.shape_id] : "";
    if (sh) {
      const key = `${r}|${i.direction_id != null ? c[i.direction_id] || "0" : "0"}`;
      if (!usoTrazado.has(key)) usoTrazado.set(key, new Map());
      const m = usoTrazado.get(key);
      m.set(sh, (m.get(sh) || 0) + 1);
    }
  }, bytes);

  // Paradas por las que pasa cada línea (y horario de primera/última salida)
  paso("Cruzando horarios de paso (puede tardar con redes grandes)…");
  const paradaRutas = new Map(); // stop_id → Set(ruta)
  await leerCsv(blob, entries, "stop_times.txt", (c, i) => {
    const r = viajeRuta.get(c[i.trip_id]);
    if (r === undefined) return;
    const sid = c[i.stop_id];
    let s = paradaRutas.get(sid);
    if (!s) paradaRutas.set(sid, (s = new Set()));
    s.add(r);
    const t = hhmm(c[i.departure_time] || c[i.arrival_time]);
    if (t != null) {
      const L = lineas[r];
      if (L.primera == null || t < L.primera) L.primera = t;
      if (L.ultima == null || t > L.ultima) L.ultima = t;
    }
  }, bytes);

  // Paradas
  paso("Leyendo paradas…");
  const paradas = [];
  await leerCsv(blob, entries, "stops.txt", (c, i) => {
    const tipo = i.location_type != null ? c[i.location_type] : "";
    if (tipo && tipo !== "0") return; // estaciones, accesos, nodos: no son paradas de servicio
    const lat = parseFloat(c[i.stop_lat]), lng = parseFloat(c[i.stop_lon]);
    if (!isFinite(lat) || !isFinite(lng) || (Math.abs(lat) < 0.5 && Math.abs(lng) < 0.5)) return;
    const sid = c[i.stop_id];
    const rs = [...(paradaRutas.get(sid) || [])].sort((a, b) => lineas[a].nombre.localeCompare(lineas[b].nombre, "es", { numeric: true }));
    for (const r of rs) lineas[r].paradas++;
    paradas.push({
      lat, lng,
      nombre: (c[i.stop_name] || "").trim() || sid,
      codigo: (i.stop_code != null && c[i.stop_code]) || sid,
      lineas: rs.map(r => lineas[r].nombre).join(" · "),
      _r: rs.map(r => lineas[r].id),
    });
  }, bytes);

  // Trazados: el más usado de cada línea y sentido
  const elegidos = new Map(); // shape → [rutas]
  for (const [key, m] of usoTrazado) {
    const [sh] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    const r = Number(key.split("|")[0]);
    if (!elegidos.has(sh)) elegidos.set(sh, []);
    elegidos.get(sh).push(r);
  }
  if (elegidos.size && entries.has("shapes.txt")) {
    paso("Leyendo trazados…");
    const puntos = new Map(); // shape → [[seq, lat, lng]]
    await leerCsv(blob, entries, "shapes.txt", (c, i) => {
      const sh = c[i.shape_id];
      if (!elegidos.has(sh)) return;
      let a = puntos.get(sh);
      if (!a) puntos.set(sh, (a = []));
      a.push([Number(c[i.shape_pt_sequence]), parseFloat(c[i.shape_pt_lat]), parseFloat(c[i.shape_pt_lon])]);
    }, bytes);
    for (const [sh, rs] of elegidos) {
      const a = puntos.get(sh);
      if (!a?.length) continue;
      a.sort((x, y) => x[0] - y[0]);
      const linea = simplificar(a.map(p => [p[1], p[2]])).map(([y, x]) => [r5(y), r5(x)]);
      for (const r of rs) lineas[r].trazados.push(linea);
    }
  }

  onProgress(1, "Listo");
  const usadas = lineas.filter(l => l.viajes > 0).map(l => ({ ...l, primera: minToHHMM(l.primera), ultima: minToHHMM(l.ultima) }));
  usadas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
  return { paradas, lineas: usadas, agencias: [...agencias.values()].filter(Boolean) };
}
