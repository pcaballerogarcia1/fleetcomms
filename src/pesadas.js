// Pesadas de báscula (vertical de puntos): los kg que descarga cada camión en
// la planta, con su fracción y el ticket. Mientras no haya báscula a bordo,
// se apuntan a mano (oficina o conductor) y aquí se resumen: kg por día, por
// fracción, por camión y por planta, y kg por parada recogida.
// Sin React ni Firebase (el guardado está en pesadas-store.js).

const kgDe = p => (Number(p.kg) > 0 ? Number(p.kg) : 0);
const sumaPor = (lista, clave) => {
  const m = new Map();
  for (const p of lista) { const k = clave(p) || "—"; m.set(k, (m.get(k) || 0) + kgDe(p)); }
  return [...m.entries()].map(([name, kg]) => ({ name, kg: Math.round(kg) })).sort((a, b) => b.kg - a.kg);
};

/** «1.234,5» / «1234.5» / «1,2 t» → kg */
export function leerKg(texto) {
  let s = String(texto ?? "").trim().toLowerCase();
  if (!s) return null;
  const toneladas = /\bt\b|ton/.test(s);
  s = s.replace(/[^\d.,]/g, "");
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // 8.450 = ocho mil cuatrocientos cincuenta
  else if (/,\d{1,2}$/.test(s) || (s.includes(",") && !s.includes("."))) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = parseFloat(s);
  if (!(n > 0)) return null;
  return Math.round((toneladas ? n * 1000 : n) * 10) / 10;
}

/**
 * Resumen del mes.
 * @param pesadas  [{ fecha, vehiculo, planta, fraccion, kg }]
 * @param planes   planes publicados del mes (para las paradas hechas por camión y día)
 */
export function resumenPesadas(pesadas, planes = []) {
  const total = pesadas.reduce((s, p) => s + kgDe(p), 0);
  const porDia = new Map();
  for (const p of pesadas) porDia.set(p.fecha, (porDia.get(p.fecha) || 0) + kgDe(p));
  const hechas = planes.reduce((s, pl) => s + (pl.ubicaciones || []).filter(u => u.realizado).length, 0);
  return {
    total: Math.round(total), n: pesadas.length,
    mediaPorPesada: pesadas.length ? Math.round(total / pesadas.length) : 0,
    paradasHechas: hechas,
    kgPorParada: hechas ? Math.round((total / hechas) * 10) / 10 : null,
    porDia: [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([fecha, kg]) => ({ fecha: fecha.slice(8, 10) + "/" + fecha.slice(5, 7), kg: Math.round(kg) })),
    porFraccion: sumaPor(pesadas, p => p.fraccion),
    porVehiculo: sumaPor(pesadas, p => p.vehiculo),
    porPlanta: sumaPor(pesadas, p => p.planta),
  };
}
