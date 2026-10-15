// Cifras para las pantallas de los concursos (punto de miles siempre, también en 4 cifras)
const crear = o => { try { return new Intl.NumberFormat("es-ES", { useGrouping: "always", ...o }); } catch { return new Intl.NumberFormat("es-ES", o); } };
export const F0 = crear({ maximumFractionDigits: 0 }), F1 = crear({ maximumFractionDigits: 1 }), F2 = crear({ maximumFractionDigits: 2 });
export const eur = n => (n == null || !Number.isFinite(n) ? "—" : `${F0.format(Math.round(n))} €`);
export const pct = n => (n == null || !Number.isFinite(n) ? "—" : `${F1.format(n)} %`);
