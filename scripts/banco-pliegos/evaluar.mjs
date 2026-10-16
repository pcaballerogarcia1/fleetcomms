// Mide el acierto del lector de pliegos contra lo declarado en la Plataforma de Contratación
import { readFileSync, existsSync, writeFileSync } from "node:fs";
const B = new URL("../../src/concursos/", import.meta.url).href;
const { leerPliego } = await import(B + "pliego.js");
const { mejorPropuesta } = await import(B + "criterios.js");
const indice = JSON.parse(readFileSync("indice.json", "utf8"));
const meses = d => (!d ? null : d.unidad === "MON" ? d.valor : d.unidad === "ANN" ? d.valor * 12 : d.unidad === "DAY" ? Math.round(d.valor / 30) : null);
const mesesDe = t => { const m = String(t || "").match(/(\d+)\s*(año|años|mes|meses|día|días)/); return m ? (/^a/.test(m[2]) ? Number(m[1]) * 12 : /^d/.test(m[2]) ? Math.round(Number(m[1]) / 30) : Number(m[1])) : null; };
const cerca = (a, b, tol = 0.01) => a != null && b != null && Math.abs(a - b) <= Math.max(1, Math.abs(b) * tol);
const fmt = n => n == null ? null : new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" }).format(n);
const esta = (textos, n) => { if (n == null) return false; const a = fmt(n), b = a.replace(/,00$/, ""); return textos.some(t => t.includes(a) || [" ", "€", " €", " euros", " EUR"].some(x => t.includes(b + x))); };
const presentes = { presupuesto: [0, 0], valorEstimado: [0, 0] };
const res = { duracion: [], presupuesto: [], valorEstimado: [], cpv: [], precioPeso: [], criteriosSuma: [] };
const fallos = [];
indice.forEach((x, i) => {
  const k = i + 1;
  const extras = Array.from({ length: 4 }, (_, j) => `extra${j}`);
  const docs = ["pcap", ...extras, "ppt"].map(t => { const f = `txt/${k}-${t}.json`; const p = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; return p ? { tipo: t, lectura: leerPliego(p) } : null; }).filter(Boolean);
  if (!docs.length) return;
  const textos = ["pcap", ...extras, "ppt"].map(t => { const f = `txt/${k}-${t}.json`; const p = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; return p ? p.join(" ").replace(/\s+/g, " ") : ""; });
  const dato = id => { for (const d of docs) { const v = d.lectura.datos.find(z => z.id === id); if (v) return { ...v, doc: d.tipo }; } return null; };
  const anota = (campo, ok, nuestro, real) => { res[campo].push(ok); if (!ok) fallos.push({ k, campo, nuestro, real, titulo: x.titulo.slice(0, 60) }); };
  // duración
  const mReal = meses(x.duracion);
  if (mReal) { const d = dato("duracion"); anota("duracion", mesesDe(d?.valor) === mReal, d ? `${d.valor} (${d.doc} p${d.pagina}) «${d.frase.slice(0, 120)}»` : null, `${mReal} meses`); }
  // presupuesto base de licitación (con o sin IVA)
  if (x.pblConIva || x.pblSinIva) {
    const cands = ["presupuesto", "importeSinIva", "importeConIva"].map(dato).filter(Boolean);
    const ok = cands.some(c => cerca(c.valor, x.pblConIva) || cerca(c.valor, x.pblSinIva));
    if (esta(textos, x.pblConIva) || esta(textos, x.pblSinIva)) { presentes.presupuesto[0]++; if (ok) presentes.presupuesto[1]++; }
    anota("presupuesto", ok, cands.map(c => `${c.id}=${c.valor} (${c.doc} p${c.pagina})`).join(" ; ") || null, `con IVA ${x.pblConIva} / sin ${x.pblSinIva}`);
  }
  if (x.vec) { const d = dato("valorEstimado"); if (esta(textos, x.vec)) { presentes.valorEstimado[0]++; if (cerca(d?.valor, x.vec)) presentes.valorEstimado[1]++; } anota("valorEstimado", cerca(d?.valor, x.vec), d ? `${d.valor} (${d.doc} p${d.pagina})` : null, x.vec); }
  if (x.cpvs?.length) { const d = dato("cpv"); anota("cpv", !!d && x.cpvs.some(c => String(d.valor).startsWith(c)), d?.valor?.slice(0, 40) || null, x.cpvs.join(",")); }
  // criterios
  const precioReal = x.criterios.filter(c => /precio|econ[oó]mic|oferta econ|importe/i.test(c.nombre || "")).reduce((s, c) => s + (c.peso || 0), 0);
  const sumaReal = x.criterios.reduce((s, c) => s + (c.peso || 0), 0);
  if (x.criterios.length && sumaReal >= 99 && sumaReal <= 101 && precioReal) {
    const p = mejorPropuesta(docs.map(d => ({ nombre: d.tipo, adjudicacion: d.lectura.adjudicacion })));
    const precio = p ? p.criterios.filter(c => c.tipo === "precio").reduce((s, c) => s + (Number(c.puntos) || 0), 0) : 0;
    anota("precioPeso", Math.abs(precio - precioReal) < 0.01, p ? `${precio} (de ${p.criterios.length} criterios, suma ${p.suma})` : null, `${precioReal} de ${x.criterios.map(c => `${(c.nombre || "").slice(0, 25)}:${c.peso}`).join(" | ")}`);
    anota("criteriosSuma", !!p && Math.abs(p.suma - 100) < 0.01, p ? p.suma : null, 100);
  }
});
const tabla = Object.entries(res).map(([c, v]) => `${c.padEnd(15)} ${String(v.filter(Boolean).length).padStart(3)} / ${String(v.length).padStart(3)}  ${v.length ? Math.round(v.filter(Boolean).length / v.length * 100) : 0} %`);
console.log(tabla.join("\n"));
console.log(Object.entries(presentes).map(([c, [n, ok]]) => `${c}: cuando la cifra está en el texto (${n}), acierta ${ok} = ${n ? Math.round(ok / n * 100) : 0} %`).join(" | "));
writeFileSync("fallos.json", JSON.stringify(fallos, null, 1));
