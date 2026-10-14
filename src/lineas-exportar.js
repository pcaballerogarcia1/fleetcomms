// Líneas regulares: exportar a Excel y a PDF (hojas para imprimir).
// Los PDF son páginas preparadas para imprimir en A4 que se abren en una
// ventana nueva; desde ahí se imprimen o se guardan como PDF (sin librerías).
import { minutosTurno, costeDeMinutos } from "./lineas-sched/costes.js";
import { pasosPorParada } from "./lineas-sched/base.js";

const reloj = m => { const x = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
const hm = m => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}`;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = v => (Math.round(v * 100) / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Ventana para imprimir ──
const ESTILO = `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10.5pt; margin: 0; }
  h1 { font-size: 15pt; margin: 0 0 2mm; } h2 { font-size: 12pt; margin: 4mm 0 2mm; }
  .sub { color: #555; font-size: 9pt; margin-bottom: 3mm; }
  table { border-collapse: collapse; width: 100%; margin-top: 2mm; }
  th, td { border: 0.3mm solid #999; padding: 1.2mm 1.6mm; text-align: left; vertical-align: top; }
  th { background: #eef2f7; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .3pt; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  .hoja { page-break-after: always; } .hoja:last-child { page-break-after: auto; }
  .datos { display: flex; flex-wrap: wrap; gap: 2mm 8mm; margin: 2mm 0 3mm; font-size: 10pt; }
  .datos b { font-weight: 700; }
  .vacio td { color: #777; font-style: italic; }
  .aviso { color: #b00; font-size: 9pt; margin-top: 2mm; }
  .barra { background: #1e2d48; color: #fff; padding: 2mm 3mm; margin: -1mm 0 3mm; display: flex; justify-content: space-between; }
  .firma { margin-top: 8mm; display: flex; gap: 20mm; font-size: 9pt; color: #555; } .firma div { border-top: 0.3mm solid #999; padding-top: 1mm; width: 60mm; }
  .horas td { font-variant-numeric: tabular-nums; }
  @media screen { body { background: #e5e7eb; } .hoja { background: #fff; width: 210mm; min-height: 297mm; margin: 6mm auto; padding: 12mm; box-shadow: 0 2px 8px rgba(0,0,0,.2); } }
`;
export function imprimir(titulo, cuerpo) {
  const w = window.open("", "_blank");
  if (!w) { alert("El navegador ha bloqueado la ventana: permite las ventanas emergentes para Operanzia y vuelve a probar."); return; }
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${ESTILO}</style></head><body>${cuerpo}<script>window.onload = () => setTimeout(() => window.print(), 300);</script></body></html>`);
  w.document.close();
}

// ── Hojas de servicio: una por turno ──
export function hojasDeServicio(res, { nombreParada, proyecto, dia }) {
  const busDe = id => res.vehiculos.find(v => v.id === id)?.autobus ?? id;
  const hojas = res.turnos.map(t => {
    const filas = [];
    if (t.toma) filas.push(`<tr class="vacio"><td>${reloj(t.toma.inicio)}</td><td>${reloj(t.toma.fin)}</td><td colspan="4">Toma de servicio${t.toma.viaje ? ` (incluye ${t.toma.viaje} min de viaje desde la cochera)` : ""}</td></tr>`);
    t.piezas.forEach((pz, i) => {
      if (i > 0) {
        const a = t.piezas[i - 1], hueco = pz.inicio - a.fin, d = (t.desplazamientos || []).find(x => x.inicio === a.fin);
        if (d) filas.push(`<tr class="vacio"><td>${reloj(d.inicio)}</td><td>${reloj(d.fin)}</td><td colspan="4">Desplazamiento a ${esc(nombreParada(pz.o))}${d.km ? ` (${String(d.km).replace(".", ",")} km)` : ""}</td></tr>`);
        filas.push(`<tr class="vacio"><td colspan="6">${hueco >= (res.params?.huecoNoPagado ?? 60) ? "Hueco sin pagar (partido)" : "Pausa"} de ${hm(hueco - (d ? d.fin - d.inicio : 0))} · ${busDe(a.vehiculo) === busDe(pz.vehiculo) ? "sigue en el autobús " + esc(busDe(pz.vehiculo)) : `cambia al autobús ${esc(busDe(pz.vehiculo))}`}</td></tr>`);
      }
      for (const x of pz.viajes) {
        filas.push(`<tr${x.vacio ? ' class="vacio"' : ""}><td>${reloj(x.dep)}</td><td>${reloj(x.arr)}</td><td>${esc(busDe(pz.vehiculo))}</td><td>${x.vacio ? "Vacío" : esc(x.nombre)}</td><td>${esc(nombreParada(x.o))}</td><td>${esc(nombreParada(x.d))}</td></tr>`);
      }
    });
    if (t.deje) filas.push(`<tr class="vacio"><td>${reloj(t.deje.inicio)}</td><td>${reloj(t.deje.fin)}</td><td colspan="4">Deje de servicio${t.deje.viaje ? ` (incluye ${t.deje.viaje} min de viaje hasta la cochera)` : ""}</td></tr>`);
    const ini = t.inicio - (t.antes || 0), fin = t.fin + (t.despues || 0);
    return `<div class="hoja">
      <div class="barra"><b>${esc(proyecto || "Operanzia")}</b><span>${esc(dia)}</span></div>
      <h1>Hoja de servicio · Turno T${t.id}</h1>
      <div class="datos"><span>Tipo: <b>${esc(t.tipoNombre || "sin tipo")}</b></span><span>Presentación: <b>${reloj(ini)}</b></span><span>Fin: <b>${reloj(fin)}</b></span>
        <span>Amplitud: <b>${hm(t.duracion)}</b></span><span>Trabajo: <b>${hm(t.trabajo)}</b></span><span>Conducción: <b>${hm(t.conduccion)}</b></span>
        <span>Autobuses: <b>${[...new Set(t.piezas.map(pz => busDe(pz.vehiculo)))].join(", ")}</b></span>${t.partidos ? "<span><b>Partido</b></span>" : ""}</div>
      <table><thead><tr><th>Salida</th><th>Llegada</th><th>Bus</th><th>Línea</th><th>Desde</th><th>Hasta</th></tr></thead><tbody>${filas.join("")}</tbody></table>
      ${t.avisos?.length ? `<div class="aviso">⚠ ${t.avisos.map(esc).join(" · ")}</div>` : ""}
      <div class="firma"><div>Firma del conductor</div><div>Inspector / jefe de tráfico</div></div>
    </div>`;
  });
  return hojas.join("");
}

// ── Hojas de autobús: una por autobús (todos sus bloques del día) ──
export function hojasDeAutobus(res, { nombreParada, proyecto, dia }) {
  const turnoDe = new Map();
  for (const t of res.turnos || []) for (const pz of t.piezas) for (const x of pz.viajes) turnoDe.set(x, t.id);
  const porBus = new Map();
  for (const v of res.vehiculos) { if (!porBus.has(v.autobus)) porBus.set(v.autobus, []); porBus.get(v.autobus).push(v); }
  return [...porBus.entries()].sort((a, b) => a[0] - b[0]).map(([bus, bloques]) => {
    const viajes = bloques.sort((a, b) => a.inicio - b.inicio).flatMap(b => b.viajes);
    const km = viajes.reduce((s, x) => s + (x.km || 0), 0);
    return `<div class="hoja">
      <div class="barra"><b>${esc(proyecto || "Operanzia")}</b><span>${esc(dia)}</span></div>
      <h1>Autobús ${esc(bus)}</h1>
      <div class="datos"><span>Sale: <b>${reloj(viajes[0]?.dep ?? 0)}</b></span><span>Vuelve: <b>${reloj(viajes.at(-1)?.arr ?? 0)}</b></span><span>Km: <b>${Math.round(km).toLocaleString("es-ES")}</b></span><span>Salidas de cochera: <b>${bloques.length}</b></span></div>
      <table><thead><tr><th>Salida</th><th>Llegada</th><th>Línea</th><th>Desde</th><th>Hasta</th><th class="n">Km</th><th>Turno</th></tr></thead><tbody>
      ${viajes.map(x => `<tr${x.vacio ? ' class="vacio"' : ""}><td>${reloj(x.dep)}</td><td>${reloj(x.arr)}</td><td>${x.vacio ? esc(x.sentido || "Vacío") : esc(x.nombre)}</td><td>${esc(nombreParada(x.o))}</td><td>${esc(nombreParada(x.d))}</td><td class="n">${x.km != null ? String(Math.round(x.km * 10) / 10).replace(".", ",") : ""}</td><td>${turnoDe.has(x) ? `T${turnoDe.get(x)}` : ""}</td></tr>`).join("")}
      </tbody></table></div>`;
  }).join("");
}

// ── Pasos por parada de una línea y sentido (la tabla, en horizontal por bloques de 14 expediciones) ──
export function hojaPasos(red, linea, sentido, salidas, cfgLinea, { dia, proyecto }) {
  const nombre = new Map((red.paradas || []).map(x => [x.id, x.nombre]));
  const pasos = salidas.map(m => pasosPorParada(sentido, m, red, cfgLinea).pasos);
  const POR = 14, trozos = [];
  for (let i = 0; i < salidas.length; i += POR) trozos.push([i, Math.min(salidas.length, i + POR)]);
  return trozos.map(([a, b]) => `<div class="hoja">
    <div class="barra"><b>${esc(proyecto || "Operanzia")}</b><span>${esc(dia)}</span></div>
    <h1>Línea ${esc(linea.nombre)} · ${sentido.dir === 0 ? "Ida" : "Vuelta"} → ${esc(sentido.cabecera)}</h1>
    <div class="sub">Expediciones ${a + 1} a ${b} de ${salidas.length}</div>
    <table class="horas"><thead><tr><th>Parada</th>${salidas.slice(a, b).map((_, k) => `<th class="n">${a + k + 1}</th>`).join("")}</tr></thead><tbody>
    ${sentido.paradas.map((id, i) => `<tr><td>${i === 0 || i === sentido.paradas.length - 1 ? `<b>${esc(nombre.get(id) || id)}</b>` : esc(nombre.get(id) || id)}</td>${pasos.slice(a, b).map(p => `<td class="n">${reloj(p[i])}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>`).join("");
}

// ── Cuadros horarios por parada (para la marquesina): una hoja por parada ──
export function cuadrosPorParada(red, linea, sentido, salidas, cfgLinea, { dia, proyecto }) {
  const nombre = new Map((red.paradas || []).map(x => [x.id, x.nombre]));
  const pasos = salidas.map(m => pasosPorParada(sentido, m, red, cfgLinea).pasos);
  return sentido.paradas.slice(0, -1).map((id, i) => {
    const porHora = new Map();
    for (const p of pasos) { const m = p[i], h = Math.floor(m / 60) % 24; if (!porHora.has(h)) porHora.set(h, []); porHora.get(h).push(m % 60); }
    return `<div class="hoja">
      <div class="barra"><b>Línea ${esc(linea.nombre)}</b><span>${esc(dia)}</span></div>
      <h1>${esc(nombre.get(id) || id)}</h1>
      <div class="sub">Dirección ${esc(sentido.cabecera)} · ${esc(proyecto || "")}</div>
      <table class="horas"><thead><tr><th style="width:18mm">Hora</th><th>Minutos de paso</th></tr></thead><tbody>
      ${[...porHora.entries()].sort((a, b) => a[0] - b[0]).map(([h, ms]) => `<tr><td><b>${String(h).padStart(2, "0")}</b></td><td style="letter-spacing:1.5mm">${ms.sort((a, b) => a - b).map(m => String(m).padStart(2, "0")).join("  ")}</td></tr>`).join("")}
      </tbody></table></div>`;
  }).join("");
}

// ── Excel ──
export function hojasExcel(res, { nombreParada, nombreTipo }) {
  const busDe = id => res.vehiculos.find(v => v.id === id)?.autobus ?? id;
  const p = res.params || {};
  const autobuses = res.vehiculos.flatMap(v => v.viajes.map(x => ({ "Autobús": v.autobus, "Bloque": v.id, "Tipo": nombreTipo(v.tipo), "Línea": x.vacio ? (x.hacia ? `Vacío → ${x.hacia}` : "Vacío") : x.nombre, "Sentido": x.sentido, "Salida": reloj(x.dep), "Llegada": reloj(x.arr), "Desde": nombreParada(x.o), "Hasta": nombreParada(x.d), "Km": x.km, "En vacío": x.vacio ? "sí" : "" })));
  const turnos = res.turnos || [];
  const detalle = turnos.flatMap(t => t.piezas.flatMap((pz, i) => pz.viajes.map(x => ({
    "Turno": `T${t.id}`, "Pieza": i + 1, "Autobús": busDe(pz.vehiculo), "Línea": x.vacio ? "Vacío" : x.nombre, "Sentido": x.sentido,
    "Salida": reloj(x.dep), "Llegada": reloj(x.arr), "Desde": nombreParada(x.o), "Hasta": nombreParada(x.d), "Inicio turno": reloj(t.inicio - (t.antes || 0)), "Fin turno": reloj(t.fin + (t.despues || 0)), "Avisos": t.avisos.join(" · "),
  }))));
  const h = m => Math.round((m / 60) * 100) / 100;
  const resumen = turnos.map(t => ({
    "Turno": `T${t.id}`, "Tipo": t.tipoNombre || "sin tipo", "Presentación": reloj(t.inicio - (t.antes || 0)), "Fin": reloj(t.fin + (t.despues || 0)),
    "Amplitud (h)": h(t.duracion), "Trabajo (h)": h(t.trabajo), "Conducción (h)": h(t.conduccion), "Piezas": t.piezas.length, "Partido": t.partidos ? "sí" : "",
    "Autobuses": [...new Set(t.piezas.map(pz => busDe(pz.vehiculo)))].join(", "), "Cambios de bus": t.cambiosBus || 0, "Desplazamientos": (t.desplazamientos || []).length, "Avisos": t.avisos.join(" · "),
  }));
  const nomina = turnos.map(t => {
    const m = minutosTurno(t, p), c = costeDeMinutos(m, p);
    return {
      "Turno": `T${t.id}`, "Tipo": t.tipoNombre || "sin tipo", "Horas ordinarias": h(m.ordinario), "Horas extra": h(m.extra), "Horas nocturnas": h(m.noche), "Partido": m.partidos ? "sí" : "",
      "Ordinario €": Math.round(c.ordinario * 100) / 100, "Extra €": Math.round(c.extra * 100) / 100, "Nocturnidad €": Math.round(c.nocturnidad * 100) / 100,
      "Plus partido €": Math.round(c.partido * 100) / 100, "Festivo €": Math.round(c.festivo * 100) / 100, "Fijo €": Math.round(c.fijo * 100) / 100, "Total €": Math.round(c.total * 100) / 100,
    };
  });
  return { autobuses, detalle, resumen, nomina };
}
export { eur };
