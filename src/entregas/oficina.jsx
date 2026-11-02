// Oficina · la prueba de entrega de una parada (Control → actividad): quién
// lo recibió, cuándo y dónde, la firma y las fotos, y el albarán firmado en
// PDF para mandárselo al cliente.
import { FileDown, MapPin, PackageCheck, PackageX } from "lucide-react";
import { useEffect, useState } from "react";
import { C, font } from "../control/datos.js";
import { BotonCerrar } from "../ui/cerrar.jsx";
import { franjaTexto, nombreMotivo, queSeEntrega } from "./datos.js";
import { leerPruebas } from "./pruebas.js";

const fecha = t => (t ? new Date(t).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const direccion = ub => [ub.calle, ub.num].filter(Boolean).join(" ") || ub.pa || `Parada ${ub.orden}`;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** La etiqueta de la parada en la actividad: entregada (con quién) o no entregada (con el motivo) */
export function EtiquetaEntrega({ ub }) {
  const e = ub.entrega;
  if (!e) return null;
  const ok = e.estado !== "no_entregada";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: ok ? C.green : C.red, border: `1px solid ${(ok ? C.green : C.red)}55`, borderRadius: 10, padding: "1px 7px" }}>
      {ok ? <PackageCheck size={11} /> : <PackageX size={11} />}
      {ok ? (e.recibe ? `${e.sinFirma ? "Se deja en" : "Recibe"} ${e.recibe}` : "Entregado") : `No entregado · ${nombreMotivo(e.motivo)}`}
    </span>
  );
}

/** Las imágenes como datos dentro del PDF (las blob: no siempre llegan a la ventana de imprimir) */
const comoDatos = url => fetch(url).then(r => r.blob()).then(b => new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(b); }));

async function albaranPDF(ub, planNombre, conductor, imgs) {
  const w = window.open("", "_blank");
  if (!w) return;
  const e = ub.entrega || {};
  const ok = e.estado !== "no_entregada";
  const fotos = await Promise.all(imgs.filter(i => i.tipo === "foto").map(i => comoDatos(i.url)));
  const firma = imgs.find(i => i.tipo === "firma");
  const firmaDatos = firma ? await comoDatos(firma.url) : null;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Albarán ${esc(ub.pedido || direccion(ub))}</title><style>
    body{font-family:Arial,sans-serif;color:#111;margin:28px;font-size:13px}
    h1{font-size:20px;margin:0 0 4px} .sub{color:#555;margin-bottom:18px}
    table{border-collapse:collapse;width:100%;margin-bottom:16px} td{border:1px solid #ccc;padding:7px 9px;vertical-align:top} td:first-child{width:32%;background:#f4f5f7;font-weight:bold}
    .estado{font-size:16px;font-weight:bold;color:${ok ? "#1a7f4b" : "#b42318"}}
    .fotos img{max-width:31%;margin-right:2%;border:1px solid #ccc} .firma img{max-width:340px;border:1px solid #ccc}
  </style></head><body>
    <h1>Albarán de entrega</h1>
    <div class="sub">${esc(planNombre)}</div>
    <table>
      <tr><td>Estado</td><td class="estado">${ok ? "Entregado" : "No entregado"}</td></tr>
      ${!ok ? `<tr><td>Motivo</td><td>${esc(nombreMotivo(e.motivo))}</td></tr>` : ""}
      ${ub.pedido ? `<tr><td>Pedido</td><td>${esc(ub.pedido)}</td></tr>` : ""}
      ${queSeEntrega({ ...ub, pedido: null }) ? `<tr><td>Mercancía</td><td>${esc(queSeEntrega({ ...ub, pedido: null }))}</td></tr>` : ""}
      <tr><td>Cliente</td><td>${esc(ub.contacto || "")}</td></tr>
      <tr><td>Dirección</td><td>${esc(direccion(ub))}${ub.barri ? ` · ${esc(ub.barri)}` : ""}</td></tr>
      ${franjaTexto(ub.franja) ? `<tr><td>Franja acordada</td><td>${esc(franjaTexto(ub.franja))}</td></tr>` : ""}
      <tr><td>Fecha y hora</td><td>${esc(fecha(e.en || ub.realizadoEn))}</td></tr>
      ${ok ? `<tr><td>${e.sinFirma ? "Se deja en" : "Lo recibe"}</td><td>${esc(e.recibe || "")}</td></tr>` : ""}
      <tr><td>Conductor</td><td>${esc(conductor || "")}</td></tr>
      <tr><td>Posición al confirmar</td><td>${e.lat != null ? `${e.lat}, ${e.lng}${e.precision ? ` (±${e.precision} m)` : ""}` : "sin GPS"}</td></tr>
      ${e.nota ? `<tr><td>Nota</td><td>${esc(e.nota)}</td></tr>` : ""}
    </table>
    ${firmaDatos ? `<div class="firma"><b>Firma</b><br><img src="${firmaDatos}"></div><br>` : ""}
    ${fotos.length ? `<div class="fotos"><b>Fotos</b><br>${fotos.map(f => `<img src="${f}">`).join("")}</div>` : ""}
  </body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

/** La ventana con la prueba de entrega de una parada */
export function VentanaEntrega({ ev, orgId, conductor, onCerrar }) {
  const [imgs, setImgs] = useState(null);
  const [error, setError] = useState("");
  const e = ev.entrega || {};
  const ok = e.estado !== "no_entregada";

  useEffect(() => {
    let vivo = true, urls = [];
    leerPruebas(orgId, ev.planId, ev.id)
      .then(l => {
        // solo las de esta entrega (si se deshizo y se volvió a entregar, las de antes sobran)
        const suyas = l.filter(i => (i.tipo === "firma" ? e.firma : i.k < (e.fotos || 0)));
        urls = l.map(i => i.url);
        if (vivo) setImgs(suyas);
      })
      .catch(err => vivo && setError(`No se pudieron cargar las fotos (${err.code || err.message})`));
    return () => { vivo = false; urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [orgId, ev.planId, ev.id, e.firma, e.fotos]);

  const faltan = imgs && ((e.fotos || 0) + (e.firma ? 1 : 0)) > imgs.length;
  const fila = (k, v) => v ? <div style={{ display: "flex", gap: 10, fontSize: 12, padding: "4px 0", borderBottom: `1px solid ${C.border}` }}><span style={{ width: 130, color: C.muted, flexShrink: 0 }}>{k}</span><span style={{ color: C.text }}>{v}</span></div> : null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={onCerrar}>
      <div role="dialog" aria-label="Prueba de entrega" onClick={x => x.stopPropagation()} style={{
        background: C.card, borderRadius: 12, padding: "20px 22px", width: 620, maxWidth: "calc(100vw - 32px)", maxHeight: "88vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)", border: `1px solid ${C.border}`, fontFamily: font,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: ok ? C.green : C.red }}>
            {ok ? <PackageCheck size={17} /> : <PackageX size={17} />}{ok ? "Entregado" : "No entregado"}
            <span style={{ color: C.muted, fontWeight: 400, fontSize: 13 }}>· {direccion(ev)}</span>
          </div>
          <BotonCerrar onClick={onCerrar} />
        </div>
        {fila("Pedido", ev.pedido)}
        {fila("Mercancía", queSeEntrega({ ...ev, pedido: null }))}
        {fila("Cliente", ev.contacto)}
        {fila("Franja acordada", franjaTexto(ev.franja))}
        {fila("Fecha y hora", fecha(e.en || ev.realizadoEn))}
        {ok ? fila(e.sinFirma ? "Se deja en" : "Lo recibe", e.recibe) : fila("Motivo", nombreMotivo(e.motivo))}
        {fila("Conductor", conductor)}
        {fila("Nota", e.nota)}
        {fila("Posición", e.lat != null
          ? <a href={`https://www.google.com/maps?q=${e.lat},${e.lng}`} target="_blank" rel="noreferrer" style={{ color: C.blueText, display: "inline-flex", alignItems: "center", gap: 4 }}><MapPin size={12} />{e.lat}, {e.lng}{e.precision ? ` (±${e.precision} m)` : ""}</a>
          : "sin GPS")}

        <div style={{ marginTop: 14 }}>
          {error && <div style={{ fontSize: 12, color: C.red }}>{error}</div>}
          {!imgs && !error && (e.fotos || e.firma) ? <div style={{ fontSize: 12, color: C.muted }}>Cargando la firma y las fotos…</div> : null}
          {faltan && <div style={{ fontSize: 12, color: C.amber, marginBottom: 8 }}>Faltan fotos por llegar: el móvil las enviará en cuanto tenga cobertura.</div>}
          {imgs?.some(i => i.tipo === "firma") && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Firma</div>
              <img src={imgs.find(i => i.tipo === "firma").url} alt="Firma de quien lo recibe" style={{ maxWidth: 320, width: "100%", background: "#fff", borderRadius: 8, border: `1px solid ${C.border}` }} />
            </div>
          )}
          {imgs?.some(i => i.tipo === "foto") && (
            <div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Fotos</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {imgs.filter(i => i.tipo === "foto").map((i, n) => (
                  <a key={i.id} href={i.url} target="_blank" rel="noreferrer"><img src={i.url} alt={`Foto ${n + 1} de la entrega`} style={{ width: 170, height: 130, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.border}` }} /></a>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button className="op-btn" disabled={!imgs && !error} onClick={() => albaranPDF(ev, ev.planNombre, conductor, imgs || [])} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <FileDown size={14} /> Albarán en PDF
          </button>
        </div>
      </div>
    </div>
  );
}
