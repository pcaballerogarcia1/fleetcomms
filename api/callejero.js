// POST /api/callejero — las calles de una zona en tramos (ver
// src/viaria/callejero.js). La descarga de OpenStreetMap la hace el servidor:
// desde algunas redes el navegador no llega a sus servidores públicos.
// Prueba varios servidores seguidos. Solo con sesión de Operanzia.
import { AvisoError, verificarToken } from "./_avisos/core.js";
import { compactarTramos, descargarConEspejos, rectanguloValido, TIPOS_VIA } from "../src/viaria/callejero.js";

export const config = { maxDuration: 60 };
const PROYECTOS = [globalThis.process.env.FIREBASE_PROJECT_ID, globalThis.process.env.VITE_FIREBASE_PROJECT_ID, "fleetcomms-13d89", "operanzia-pruebas"];
const MAX_TRAMOS = 20000;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  try {
    await verificarToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), PROYECTOS);
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (!rectanguloValido(b.bbox)) return res.status(400).json({ error: "La zona tiene que ser de como mucho 12 km de lado" });
    const tipos = (Array.isArray(b.tipos) ? b.tipos : []).filter(t => TIPOS_VIA[t]);
    const opciones = { tipos: tipos.length ? tipos : undefined, mPorHora: +b.mPorHora || 1200, aceras: +b.aceras || 2 };
    const fetchConEspera = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(25000) });
    const tramos = await descargarConEspejos(b.bbox.map(Number), opciones, fetchConEspera);
    if (tramos.length > MAX_TRAMOS) return res.status(413).json({ error: `Son ${tramos.length} tramos: elige un radio más pequeño (como mucho ${MAX_TRAMOS})` });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ tramos: compactarTramos(tramos) });
  } catch (e) {
    if (e instanceof AvisoError) return res.status(e.status).json({ error: e.message });
    console.error("Callejero:", e?.message || e);
    return res.status(502).json({ error: e?.name === "TimeoutError" ? "OpenStreetMap tarda demasiado: prueba con un radio más pequeño" : (e?.message || "No se pudo descargar el callejero") });
  }
}
