// Concursos → Alternativas: qué baja presentar.
// Con los criterios de adjudicación de la ficha (puntos del precio, fórmula,
// regla de baja anormal), el coste del Cálculo y lo que se espera de la
// competencia, se prueba cada baja posible: precio, margen, puntos, puesto y si
// caería en baja anormal. La recomendada es la menor baja que gana sin perder
// dinero ni caer en anormal. Y tres escenarios (base, adverso, tensión) para ver
// cuánto aguanta el margen. Sin React ni Firebase.
import { calcularConcurso } from "./calculo.js";

/** Baja en puntos porcentuales: 12 = un 12 % por debajo del presupuesto */
export const bajaDe = (oferta, presupuesto) => (presupuesto > 0 ? (1 - oferta / presupuesto) * 100 : 0);

/**
 * Puntos del precio de cada oferta.
 * @param ofertas [importe] (todas las presentadas, la propia incluida)
 * @param formula "lineal" | "proporcional" | "saciedad"
 * @param maximo puntos del precio; presupuesto: el de licitación (mismo periodo que las ofertas)
 */
export function puntosPrecio(ofertas, { formula = "lineal", maximo = 0, presupuesto = 0, saciedad = 15 } = {}) {
  const min = Math.min(...ofertas);
  return ofertas.map(o => {
    if (formula === "proporcional") return o > 0 ? maximo * min / o : 0;
    if (formula === "saciedad") return maximo * Math.min(1, Math.max(0, bajaDe(o, presupuesto)) / Math.max(0.01, saciedad));
    // lineal a la baja: la más baja se lleva todos; la que no baja, ninguno
    return presupuesto - min > 0 ? maximo * Math.max(0, presupuesto - o) / (presupuesto - min) : 0;
  });
}

/**
 * ¿Qué ofertas son anormalmente bajas?
 * @param bajas [baja de cada oferta, en puntos porcentuales]
 * @param regla { id: "art85" | "media", valor } (valor: puntos sobre la media en «media»)
 * @returns [true/false por oferta]
 */
export function anormales(bajas, regla = { id: "art85" }) {
  const n = bajas.length;
  const media = xs => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  if (regla.id === "media") { const m = media(bajas); return bajas.map(b => b > m + (Number(regla.valor) || 10)); }
  // artículo 85 del RGLCAP (sobre las bajas)
  if (n === 1) return bajas.map(b => b > 25);
  if (n === 2) return bajas.map((b, i) => b - bajas[1 - i] > 20);
  if (n === 3) {
    let m = media(bajas);
    const peor = Math.min(...bajas); // la oferta más cara
    if (peor < m - 10) m = media(bajas.filter((b, i) => i !== bajas.indexOf(peor)));
    return bajas.map(b => b > m + 10 || b > 25);
  }
  const m = media(bajas);
  let resto = bajas.filter(b => !(b < m - 10)); // fuera las que son más de 10 puntos más caras que la media
  if (resto.length < 3) resto = [...bajas].sort((a, b) => b - a).slice(0, 3); // las tres más baratas
  const m2 = media(resto);
  return bajas.map(b => b > m2 + 10);
}

/** Los puntos que hay en juego: { precio, resto, total } */
export function puntosEnJuego(criterios = []) {
  const precio = criterios.filter(c => c.tipo === "precio").reduce((s, c) => s + (Number(c.puntos) || 0), 0);
  const resto = criterios.filter(c => c.tipo !== "precio").reduce((s, c) => s + (Number(c.puntos) || 0), 0);
  return { precio, resto, total: precio + resto };
}

/**
 * Probar cada baja propia contra la competencia esperada.
 * @param o { criterios, formula, saciedad, regla, presupuesto (anual, sin IVA), coste (medio anual),
 *            competidores: [{ nombre, baja, tecnicaPct }], tecnicaPct (lo que se espera sacar del resto de puntos, %),
 *            margenMinimoPct, paso, hasta }
 * @returns { filas: [{ baja, precio, margen, puntosPrecio, puntos, puesto, anormal }], recomendada, maxima }
 */
export function simularBajas(o) {
  const { criterios = [], formula = "lineal", saciedad = 15, regla = { id: "art85" }, presupuesto = 0, coste = 0, competidores = [], tecnicaPct = 70, margenMinimoPct = 0, paso = 0.5, hasta = 50 } = o;
  const { precio: maximo, resto } = puntosEnJuego(criterios);
  const filas = [];
  if (!(presupuesto > 0)) return { filas, recomendada: null, maxima: null };
  for (let b = 0; b <= hasta + 1e-9; b += paso) {
    const baja = Math.round(b * 100) / 100;
    const bajas = [baja, ...competidores.map(c => Number(c.baja) || 0)];
    const importes = bajas.map(x => presupuesto * (1 - x / 100));
    const pp = puntosPrecio(importes, { formula, maximo, presupuesto, saciedad });
    const tecnica = [tecnicaPct, ...competidores.map(c => Number(c.tecnicaPct) || 0)].map(t => resto * t / 100);
    const totales = pp.map((p, i) => p + tecnica[i]);
    const anor = anormales(bajas, regla);
    // las anormales de la competencia se dan por justificadas (cuentan)
    const puesto = 1 + totales.slice(1).filter(t => t > totales[0] + 1e-9).length;
    const precio = importes[0];
    filas.push({ baja, precio, margen: precio > 0 ? (precio - coste) / precio * 100 : 0, puntosPrecio: pp[0], puntos: totales[0], puesto, anormal: anor[0], empate: totales.slice(1).some(t => Math.abs(t - totales[0]) <= 1e-9) });
  }
  const validas = filas.filter(f => f.margen >= margenMinimoPct && !f.anormal);
  const ganadoras = validas.filter(f => f.puesto === 1 && !f.empate);
  const recomendada = ganadoras[0] || [...validas].sort((a, b) => a.puesto - b.puesto || b.puntos - a.puntos || a.baja - b.baja)[0] || null;
  // la baja más grande sin perder dinero
  const maxima = [...filas].reverse().find(f => f.margen >= 0) || null;
  return { filas, recomendada, maxima };
}

export const ESCENARIOS = [
  { id: "base", nombre: "Base", que: "Todo como está previsto.", factores: {}, diasCobroMas: 0 },
  { id: "adverso", nombre: "Adverso", que: "Personal +4 %, combustible y mantenimiento +15 %, se rinde un 8 % menos (más turnos con los mismos vehículos), se cobra 30 días más tarde.", factores: { personal: 1.04, operacion: 1.15, rendimiento: 0.92, flotaFija: true }, diasCobroMas: 30 },
  { id: "tension", nombre: "Tensión", que: "Personal +8 %, combustible y mantenimiento +30 %, se rinde un 15 % menos (más turnos con los mismos vehículos), se cobra 90 días más tarde.", factores: { personal: 1.08, operacion: 1.3, rendimiento: 0.85, flotaFija: true }, diasCobroMas: 90 },
];

/** Cómo queda un precio en cada escenario: [{ …escenario, coste, resultado, margen, caja }] */
export function escenarios(precio, calcular) {
  return ESCENARIOS.map(e => {
    const { cuenta } = calcular(e.factores);
    const coste = cuenta.costeMedioAnual;
    return { ...e, coste, resultado: precio - coste, margen: precio > 0 ? (precio - coste) / precio * 100 : 0, caja: coste / 365 * (cuenta.parametros.diasCobro + e.diasCobroMas), personas: cuenta.plantilla.total, vehiculos: cuenta.vehiculos.reduce((s, v) => s + v.total, 0) };
  });
}

export const COMPETIDORES_DEFECTO = [
  { nombre: "Competidor A", baja: 8, tecnicaPct: 75 },
  { nombre: "Competidor B", baja: 12, tecnicaPct: 65 },
  { nombre: "Competidor C", baja: 5, tecnicaPct: 80 },
];
export const OFERTA_DEFECTO = { tecnicaPct: 75, margenMinimoPct: 3 };

/** Todo lo de Alternativas a partir de lo guardado (lo usa también Resumen) */
export function analizarOferta({ ficha, dim, calc, concurso, oferta }) {
  const r = calcularConcurso({ ficha, dim, calc, concurso });
  const adj = ficha?.adjudicacion || null;
  const o = { ...OFERTA_DEFECTO, ...Object.fromEntries(Object.entries(oferta || {}).filter(([, v]) => v != null)) };
  const competidores = oferta?.competidores || COMPETIDORES_DEFECTO;
  const presupuesto = r.presupuestoAnual;
  const sim = adj && presupuesto ? simularBajas({
    criterios: adj.criterios, formula: adj.formula, saciedad: adj.saciedad, regla: adj.baja || { id: "art85" },
    presupuesto, coste: r.cuenta.costeMedioAnual, competidores, tecnicaPct: o.tecnicaPct, margenMinimoPct: o.margenMinimoPct,
  }) : null;
  const elegida = sim ? (o.bajaElegida != null ? sim.filas.find(f => Math.abs(f.baja - o.bajaElegida) < 1e-6) : null) || sim.recomendada : null;
  const esc = elegida ? escenarios(elegida.precio, factores => calcularConcurso({ ficha, dim, calc, concurso, factores })) : null;
  return { r, adj, o, competidores, presupuesto, sim, elegida, esc };
}
