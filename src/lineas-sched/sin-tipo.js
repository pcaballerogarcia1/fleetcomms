// Por qué hay turnos sin tipo: para cada uno, el tipo de turno al que más se
// parece (el que menos reglas incumple) y qué le falta para encajar; luego se
// agrupan y se explican con lo que se puede cambiar en Restricciones.
import { hm, reloj } from "./base.js";

const enFranja = (min, desde, hasta) => { const m = ((min % 1440) + 1440) % 1440; return desde <= hasta ? m >= desde && m <= hasta : m >= desde || m <= hasta; };

// Lo que incumple el turno t para ser del tipo
function fallos(t, tipo) {
  const f = [];
  if (!enFranja(t.inicio, tipo.desde, tipo.hasta)) f.push("hora");
  if (t.trabajo < tipo.trabajoMin) f.push("corto");
  if (t.trabajo > tipo.trabajoMax) f.push("largo");
  if (t.fin - t.inicio > tipo.amplitudMax) f.push("amplitud");
  if (t.partidos > (tipo.partido ? 1 : 0)) f.push("partido");
  if (tipo.partido && !t.partidos) f.push("sinHueco");
  if (t.partidos && tipo.splitMax > 0 && (t.split || 0) > tipo.splitMax) f.push("split");
  if (tipo.cambiosBus != null && (t.cambios ?? t.cambiosBus ?? 0) > tipo.cambiosBus) f.push("cambio");
  return f;
}

const rango = vs => { const a = Math.min(...vs), b = Math.max(...vs); return a === b ? hm(a) : `de ${hm(a)} a ${hm(b)}`; };

/**
 * @returns { total, grupos: [{ n, tipo, motivos, texto, consejo }], cambiosAgotados } o null si no hay turnos sin tipo
 */
export function porQueSinTipo(turnos, p, kpis = null) {
  const tipos = (p.tiposTurno || []).filter(x => x.activo !== false);
  const sin = (turnos || []).filter(t => !t.tipo);
  if (!tipos.length || !sin.length) return null;
  const grupos = new Map();
  for (const t of sin) {
    let mejor = null;
    for (const tipo of tipos) {
      const f = fallos(t, tipo);
      if (!mejor || f.length < mejor.f.length) mejor = { tipo, f };
    }
    const motivos = mejor.f.length ? mejor.f : ["lleno"];
    const clave = `${mejor.tipo.id}|${motivos.join(",")}`;
    if (!grupos.has(clave)) grupos.set(clave, { tipo: mejor.tipo, motivos, turnos: [] });
    grupos.get(clave).turnos.push(t);
  }
  const lista = [...grupos.values()].sort((a, b) => b.turnos.length - a.turnos.length).map(g => {
    const { tipo, motivos, turnos: ts } = g;
    const nom = `«${tipo.nombre}»`;
    const trabajo = rango(ts.map(t => t.trabajo));
    const partes = [], consejos = [];
    for (const m of motivos) {
      if (m === "lleno") { partes.push(tipo.maximo > 0 ? `encajarían en ${nom}, pero ya hay el máximo (${tipo.maximo} al día)` : `encajarían en ${nom}`); consejos.push(`sube o quita el «Máximo al día» de ${nom}`); }
      if (m === "corto") { partes.push(`tienen ${trabajo} de trabajo y ${nom} pide al menos ${hm(tipo.trabajoMin)}`); consejos.push(`baja el trabajo mínimo de ${nom}, o deja que más turnos cambien de bus para juntar estos trozos con otros`); }
      if (m === "largo") { partes.push(`tienen ${trabajo} de trabajo y ${nom} admite como mucho ${hm(tipo.trabajoMax)}`); consejos.push(`sube el trabajo máximo de ${nom} o baja la pieza máxima`); }
      if (m === "amplitud") { partes.push(`pasan de la amplitud de ${hm(tipo.amplitudMax)} de ${nom}`); consejos.push(`sube la amplitud máxima de ${nom}`); }
      if (m === "hora") { partes.push(`empiezan a las ${[...new Set(ts.map(t => reloj(t.inicio).slice(0, 2) + "h"))].slice(0, 4).join(", ")}, fuera del horario de ${nom} (${reloj(tipo.desde)}–${reloj(tipo.hasta)})`); consejos.push(`amplía «Empieza entre» de ${nom} o añade un tipo para esas horas`); }
      if (m === "partido") { partes.push(`son partidos y ${nom} no lo es`); consejos.push("activa un tipo partido para esas horas"); }
      if (m === "sinHueco") { partes.push(`${nom} es partido y estos no tienen hueco`); consejos.push("añade un tipo continuo para estos turnos"); }
      if (m === "split") { partes.push(`el hueco del partido pasa del split máximo de ${nom} (${hm(tipo.splitMax)})`); consejos.push(`sube el split máximo de ${nom}`); }
      if (m === "cambio") { partes.push(`cambian de autobús y ${nom} no lo permite`); consejos.push(`marca «Cambio de bus» en ${nom}`); }
    }
    return { n: ts.length, tipo: tipo.nombre, motivos, texto: partes.join(" y "), consejo: consejos.join("; ") };
  });
  const usados = kpis?.cambiosBus ?? sin.reduce((s, t) => s + (t.cambiosBus || 0), 0);
  const cambiosAgotados = p.maxCambiosBusTotal != null && p.maxCambiosBusTotal !== "" && usados >= p.maxCambiosBusTotal ? p.maxCambiosBusTotal : null;
  return { total: sin.length, grupos: lista, cambiosAgotados };
}
