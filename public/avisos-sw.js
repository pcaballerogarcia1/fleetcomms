// Avisos al móvil (notificaciones push) de Operanzia. Lo carga el service
// worker de la app (vite.config.js → workbox.importScripts). El aviso llega
// aunque la app esté cerrada; al tocarlo, se abre (o se trae al frente) la
// app en la pantalla que diga el aviso.
self.addEventListener("push", event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { cuerpo: event.data && event.data.text() }; }
  const titulo = d.titulo || "Operanzia";
  event.waitUntil(self.registration.showNotification(titulo, {
    body: d.cuerpo || "",
    icon: "/pwa-192x192.png",
    badge: "/pwa-64x64.png",
    tag: d.etiqueta || undefined,
    renotify: !!d.etiqueta,
    data: { url: d.url || "/rutas" },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/rutas", self.location.origin).href;
  event.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const misma = abiertas.find(c => c.url.startsWith(self.location.origin));
    if (misma) { await misma.focus(); if ("navigate" in misma && misma.url !== url) await misma.navigate(url).catch(() => {}); return; }
    await self.clients.openWindow(url);
  })());
});
