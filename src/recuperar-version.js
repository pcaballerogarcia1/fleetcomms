// Después de publicar una versión nueva, un navegador que aún tiene la
// anterior (guardada por el service worker para funcionar sin cobertura)
// puede pedir una parte de la app que ya no casa y fallar con «Failed to
// fetch dynamically imported module»: la pantalla se rompía y «Recargar» no
// lo arreglaba. Aquí se borra la copia guardada de la app (no los mapas ni
// las suscripciones de avisos), se activa la versión nueva y se recarga una
// vez. Si vuelve a fallar en el mismo minuto, no se insiste (se ve el aviso).

const CLAVE = "operanzia_recuperando_version";

export const esFalloDeCarga = e =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .* failed|Unable to preload CSS/i.test(String(e?.message || e || ""));

/** true si va a recargar (la primera vez); false si ya lo intentó hace poco */
export async function recuperarVersion() {
  try {
    const antes = Number(sessionStorage.getItem(CLAVE) || 0);
    if (Date.now() - antes < 60_000) return false;
    sessionStorage.setItem(CLAVE, String(Date.now()));
  } catch { /* sin sessionStorage: se intenta igual */ }
  try {
    const nombres = await caches.keys();
    await Promise.all(nombres.filter(n => !/mapa|google-fonts/.test(n)).map(n => caches.delete(n)));
  } catch { /* sin caché: nada que borrar */ }
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
    for (const r of regs) {
      await r.update().catch(() => {});
      r.waiting?.postMessage({ type: "SKIP_WAITING" });
    }
  } catch { /* sin service worker */ }
  window.location.reload();
  return true;
}

export function vigilarFallosDeCarga() {
  if (typeof window === "undefined") return;
  // Vite avisa así cuando no puede cargar una parte de la app
  window.addEventListener("vite:preloadError", e => { e.preventDefault?.(); recuperarVersion(); });
  window.addEventListener("unhandledrejection", e => { if (esFalloDeCarga(e.reason)) recuperarVersion(); });
}
