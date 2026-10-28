// Limpieza viaria · cobertura del mes: cada tramo de calle de las rutas
// publicadas, cuántas veces tocaba (una por cada ruta en la que sale) y
// cuántas se hizo (marcado en la app).
const clave = u => `${(+u.lat).toFixed(5)}_${(+u.lng).toFixed(5)}`;

/** @returns [{ clave, nombre, geom, metros, previstas, hechas, pct, ultima }] solo los tramos con línea */
export function coberturaTramos(planes = []) {
  const porTramo = new Map();
  for (const p of planes) {
    if (!p || p.tipo === "corr") continue;
    for (const u of p.ubicaciones || []) {
      if (!Array.isArray(u.geom) || u.geom.length < 4) continue;
      const k = clave(u);
      const t = porTramo.get(k) || porTramo.set(k, { clave: k, nombre: u.pa || u.calle || "Tramo", geom: u.geom, metros: +u.metros || 0, previstas: 0, hechas: 0, ultima: null }).get(k);
      t.previstas++;
      if (u.realizado) {
        t.hechas++;
        const en = typeof u.realizadoEn === "number" ? u.realizadoEn : u.realizadoEn?.toMillis?.() ?? null;
        if (en && (!t.ultima || en > t.ultima)) t.ultima = en;
      }
    }
  }
  return [...porTramo.values()].map(t => ({ ...t, pct: t.previstas ? Math.round((t.hechas / t.previstas) * 100) : 0 }));
}

/** Totales: tramos y metros con todas sus pasadas hechas, a medias y sin ninguna */
export function resumenCobertura(tramos) {
  const r = { tramos: tramos.length, completos: 0, aMedias: 0, nada: 0, metros: 0, metrosCompletos: 0, previstas: 0, hechas: 0 };
  for (const t of tramos) {
    r.metros += t.metros; r.previstas += t.previstas; r.hechas += t.hechas;
    if (t.hechas >= t.previstas) { r.completos++; r.metrosCompletos += t.metros; } else if (t.hechas > 0) r.aMedias++; else r.nada++;
  }
  r.pct = r.previstas ? Math.round((r.hechas / r.previstas) * 100) : 0;
  return r;
}

/** Color del tramo: verde todas sus pasadas, ámbar a medias, rojo ninguna */
export const colorCobertura = (t, C) => (t.hechas >= t.previstas ? C.green : t.hechas > 0 ? C.amber : C.red);
