// Pedir el callejero: a nuestro servidor (/api/callejero), que descarga de
// OpenStreetMap; si no está (en local), directamente a OpenStreetMap.
import { auth } from "../firebase.js";
import { descargarConEspejos } from "./callejero.js";

export async function pedirCallejero(bbox, opciones = {}) {
  let r;
  try {
    const token = await auth.currentUser?.getIdToken();
    r = await fetch("/api/callejero", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
      body: JSON.stringify({ bbox, tipos: opciones.tipos, mPorHora: opciones.mPorHora, aceras: opciones.aceras }) });
  } catch { r = null; }
  const esJson = r && (r.headers.get("content-type") || "").includes("application/json");
  if (!r || !esJson || r.status === 404) return descargarConEspejos(bbox, opciones); // sin servidor (en local)
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `El servidor respondió ${r.status}`);
  return d.tramos || [];
}
