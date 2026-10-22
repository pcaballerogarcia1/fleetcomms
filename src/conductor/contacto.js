// App del conductor → lo práctico de cada parada: con qué app navegar
// (Google Maps, Waze o Apple Maps; se recuerda en este móvil), contactar con
// el cliente (llamar, WhatsApp, SMS) si la parada trae teléfono, y dictar
// notas con la voz (si el móvil lo permite).
import { useEffect, useRef, useState } from "react";

export const NAVEGADORES = [
  { id: "google", nombre: "Google Maps", url: (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving` },
  { id: "waze", nombre: "Waze", url: (lat, lng) => `https://waze.com/ul?ll=${lat},${lng}&navigate=yes` },
  { id: "apple", nombre: "Apple Maps", url: (lat, lng) => `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d` },
];
const CLAVE = "op_navegador";

/** La app de navegación elegida en este móvil (Google Maps si no se ha elegido) */
export function navegadorElegido() {
  try { const id = localStorage.getItem(CLAVE); return NAVEGADORES.find(n => n.id === id) || NAVEGADORES[0]; } catch { return NAVEGADORES[0]; }
}
export function elegirNavegador(id) { try { localStorage.setItem(CLAVE, id); } catch { /* sin almacenamiento: se usa la de por defecto */ } }
/** Abre la navegación hasta ese punto con la app elegida */
export function abrirNavegacion(lat, lng) { window.open(navegadorElegido().url(lat, lng), "_blank"); }

/**
 * El teléfono de una parada, listo para llamar: «612 34 56 78» → { ver, tel, wa }
 * (9 cifras de España → con +34 para WhatsApp). null si no hay o no parece un teléfono.
 */
export function telefonoDe(ub) {
  const crudo = String(ub?.telefono || "").trim();
  if (!crudo) return null;
  let cifras = crudo.replace(/[^\d+]/g, "");
  if (cifras.startsWith("00")) cifras = `+${cifras.slice(2)}`;
  const solo = cifras.replace(/\D/g, "");
  if (solo.length < 6) return null;
  const internacional = cifras.startsWith("+") ? solo : solo.length === 9 && /^[6789]/.test(solo) ? `34${solo}` : solo;
  return { ver: crudo, tel: cifras.startsWith("+") ? cifras : solo, wa: internacional };
}
export const enlacesContacto = t => (!t ? null : { llamar: `tel:${t.tel}`, whatsapp: `https://wa.me/${t.wa}`, sms: `sms:${t.tel}` });

/**
 * Dictado con la voz (reconocimiento del propio navegador, en español).
 * @param onTexto(texto) se llama con cada frase reconocida
 * @returns { disponible, escuchando, alternar }
 */
export function useDictado(onTexto) {
  const Rec = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const [escuchando, setEscuchando] = useState(false);
  const recRef = useRef(null);
  const onTextoRef = useRef(onTexto);
  useEffect(() => { onTextoRef.current = onTexto; });
  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* ya parado */ } }, []);
  function alternar() {
    if (!Rec) return;
    if (escuchando) { try { recRef.current?.stop(); } catch { /* ya parado */ } return; }
    const r = new Rec();
    r.lang = "es-ES"; r.continuous = false; r.interimResults = false;
    r.onresult = e => { const t = [...e.results].map(x => x[0]?.transcript || "").join(" ").trim(); if (t) onTextoRef.current?.(t); };
    r.onend = () => setEscuchando(false);
    r.onerror = () => setEscuchando(false);
    recRef.current = r;
    try { r.start(); setEscuchando(true); } catch { setEscuchando(false); }
  }
  return { disponible: !!Rec, escuchando, alternar };
}
