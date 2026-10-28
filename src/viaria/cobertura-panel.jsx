// Análisis → Cobertura (limpieza viaria): el mapa de las calles del mes en
// verde (todas sus pasadas hechas), ámbar (a medias) o rojo (ninguna).
import { useEffect, useMemo, useRef } from "react";
import { C, font, tono } from "../tema.js";
import { useLeaflet } from "../use-leaflet.js";
import { Cifra } from "../analisis/ui.jsx";
import { coberturaTramos, colorCobertura, resumenCobertura } from "./cobertura.js";
import { lineaDe } from "./callejero.js";
import { capaFondo, opcionesMapa, sinPrefijo } from "../mapa-fondo.js";

const num = (n, d = 0) => Number(n).toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });

export function PanelCobertura({ planes }) {
  const tramos = useMemo(() => coberturaTramos(planes), [planes]);
  const r = resumenCobertura(tramos);
  const L = useLeaflet();
  const divRef = useRef(null), mapRef = useRef(null), capaRef = useRef(null);

  useEffect(() => {
    if (!L || !divRef.current || !tramos.length) return;
    if (!mapRef.current) {
      mapRef.current = sinPrefijo(L.map(divRef.current, opcionesMapa({ zoomControl: true })));
      capaFondo(L, "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { opacity: 0.6 }).addTo(mapRef.current);
    }
    const map = mapRef.current;
    if (capaRef.current) map.removeLayer(capaRef.current);
    const renderer = L.canvas({ padding: 0.3 });
    const lineas = tramos.map(t => [t, lineaDe(t.geom)]).filter(([, l]) => l);
    capaRef.current = L.layerGroup(lineas.map(([t, l]) => L.polyline(l, { color: colorCobertura(t, C), weight: 5, opacity: 0.9, renderer })
      .bindTooltip(`${t.nombre.replace(/[<>&]/g, "")}: ${t.hechas} de ${t.previstas} pasadas${t.metros ? ` · ${t.metros} m` : ""}`, { sticky: true }))).addTo(map);
    const todos = lineas.flatMap(([, l]) => l);
    if (todos.length) map.fitBounds(todos, { padding: [20, 20] });
  }, [L, tramos]);
  useEffect(() => () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } }, []);

  if (!tramos.length) return <div style={{ color: C.dim, fontSize: 13, padding: "40px 0", textAlign: "center" }}>No hay tramos de calle en las rutas publicadas este mes. Se crean en Planificación con «Calles para barrer».</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontFamily: font }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Cifra label="Pasadas hechas" value={`${r.pct} %`} sub={`${num(r.hechas)} de ${num(r.previstas)}`} color={r.pct >= 95 ? C.green : r.pct >= 80 ? C.amber : C.red} ayuda="Cada vez que un tramo sale en una ruta publicada es una pasada prevista." />
        <Cifra label="Calles completas" value={num(r.completos)} sub={`${num(r.metrosCompletos / 1000, 1)} de ${num(r.metros / 1000, 1)} km`} color={C.green} />
        <Cifra label="A medias" value={num(r.aMedias)} sub="alguna pasada sin hacer" color={r.aMedias ? C.amber : undefined} />
        <Cifra label="Sin barrer" value={num(r.nada)} sub="ninguna pasada hecha" color={r.nada ? C.red : undefined} />
      </div>
      <div style={{ display: "flex", gap: 14, fontSize: 12, color: C.muted }}>
        {[[C.green, "Todas las pasadas"], [C.amber, "A medias"], [C.red, "Ninguna"]].map(([c, l]) => (
          <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 18, height: 4, borderRadius: 2, background: c }} />{l}</span>
        ))}
      </div>
      <div ref={divRef} role="region" aria-label="Mapa de cobertura" style={{ height: "58vh", borderRadius: 12, border: `1px solid ${C.border}`, background: tono("#131e35", "#e7ecf6") }} />
    </div>
  );
}
