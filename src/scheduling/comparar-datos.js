// Cifras para comparar dos escenarios (ver comparar.jsx).

export const num = (n, dec = 0) => (n == null ? "—" : Number(n).toLocaleString("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec }));
const horas = min => (min == null ? "—" : `${num(min / 60)} h`);

// Qué se compara. menos: true si cuanto menos, mejor.
const METRICAS = [
  { clave: "vehiculos",  etiqueta: "Vehículos",          menos: true },
  { clave: "turnos",     etiqueta: "Turnos",             menos: true },
  { clave: "paradas",    etiqueta: "Paradas hechas",     menos: false },
  { clave: "sinAsignar", etiqueta: "Sin asignar",        menos: true },
  { clave: "km",         etiqueta: "Kilómetros",         menos: true, fmt: n => `${num(n)} km` },
  { clave: "kmVacio",    etiqueta: "Km en vacío",        menos: true, fmt: n => `${num(n)} km` },
  { clave: "pagado",     etiqueta: "Horas pagadas",      menos: true, fmt: horas },
  { clave: "avisos",     etiqueta: "Avisos de reglas",   menos: true },
  { clave: "coste",      etiqueta: "Coste",              menos: true, fmt: n => `${num(n)} €` },
];

/** Filas de la comparación: a = escenario actual, b = la otra versión.
 *  dif = a − b; mejor: true si el actual sale mejor, false si peor, null si igual. */
export function filasComparacion(a, b) {
  // las que no dicen nada (vacías o a cero en las dos) no salen, salvo las principales
  const principal = ["vehiculos", "paradas", "sinAsignar", "km"];
  return METRICAS.filter(m => principal.includes(m.clave) ? (a?.[m.clave] != null || b?.[m.clave] != null) : (a?.[m.clave] || b?.[m.clave])).map(m => {
    const va = a?.[m.clave] ?? null, vb = b?.[m.clave] ?? null;
    const dif = va != null && vb != null ? va - vb : null;
    const igual = dif == null || Math.abs(dif) < (m.clave === "km" || m.clave === "kmVacio" || m.clave === "coste" ? 0.5 : m.clave === "pagado" ? 1 : 1e-9);
    return { ...m, a: va, b: vb, dif, mejor: igual ? null : (m.menos ? dif < 0 : dif > 0) };
  });
}
