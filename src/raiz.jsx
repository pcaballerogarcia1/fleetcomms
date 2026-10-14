// Lo que envuelve a toda la web: la app de conductores y la de superadmin (se
// cargan solo si se visitan), el aviso de versión nueva, el «cargando» inicial
// y el aviso cuando una pantalla se rompe.
import { lazy, Component } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { reportError } from "./error-report.js";
import { esFalloDeCarga, recuperarVersion } from "./recuperar-version.js";
import { C, font } from "./raiz-estilo.js";

export const App            = lazy(() => import("./App.jsx"));
export const SuperAdminApp  = lazy(() => import("./superadmin.jsx"));

// Si una pantalla se rompe, en vez de quedarse en blanco se ve un aviso con
// "Recargar", y el error queda registrado.
export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    // versión vieja guardada en el navegador tras publicar una nueva: se pone al día sola
    if (esFalloDeCarga(error)) { recuperarVersion().then(va => { if (!va) this.setState({ recuperando: false }); }); this.setState({ recuperando: true }); }
    reportError({ tipo: "pantalla", mensaje: error?.message || String(error), stack: (error?.stack || "") + "\n--- componentes:" + (info?.componentStack || "") });
  }
  render() {
    if (!this.state.error) return this.props.children;
    if (this.state.recuperando) return (
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, fontFamily: font }}>
        <div style={{ color: C.muted, fontSize: 13 }}>Actualizando a la versión nueva de Operanzia…</div>
      </div>
    );
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, fontFamily: font }}>
        <div style={{ maxWidth: 420, textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 8 }}>Algo ha fallado en esta pantalla</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 18 }}>El error ya se ha registrado para revisarlo. Tus datos guardados no se han perdido.</div>
          <button onClick={() => window.location.reload()} style={{ padding: "8px 18px", borderRadius: 8, background: C.blue, color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font }}>Recargar</button>
        </div>
      </div>
    );
  }
}


export function RootFallback() {
  return (
    <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: C.bg, fontFamily: font }}>
      <div style={{ color: C.muted, fontSize: 13 }}>Cargando…</div>
    </div>
  );
}

// El registro por defecto de vite-plugin-pwa solo hace
// `serviceWorker.register()` al cargar la página, una vez — con
// registerType "autoUpdate" el navegador activa la versión nueva en
// segundo plano, pero solo la detecta en sus propias comprobaciones
// pasivas (más o menos una vez al día), y una pestaña ya abierta se queda
// con el JS viejo cargado en memoria hasta que se recarga. Con despliegues
// frecuentes eso significaba clientes usando una versión desactualizada
// sin ningún aviso — "esto no cambia nada" tras cada fix.
//
// Con registerType "prompt" + este hook: comprobamos activamente cada 5
// minutos (no solo al cargar) y mostramos un aviso visible en vez de
// confiar en que el navegador se entere solo.
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(url, registration) {
      if (!registration) return;
      setInterval(() => { registration.update().catch(() => {}); }, 5 * 60 * 1000);
    },
  });

  if (!needRefresh) return null;
  return (
    <div style={{
      position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)",
      zIndex: 99999, display: "flex", alignItems: "center", gap: 12,
      background: C.card, border: `1px solid ${C.border2}`, borderRadius: 10,
      padding: "10px 12px 10px 16px", boxShadow: "0 8px 28px rgba(0,0,0,.5)",
      fontFamily: font,
    }}>
      <span style={{ fontSize: 13, color: C.text }}>Hay una versión nueva de Operanzia disponible</span>
      <button
        onClick={() => updateServiceWorker(true)}
        style={{
          background: C.blue, border: "none", color: "#fff", fontWeight: 600,
          fontSize: 12, borderRadius: 7, padding: "7px 14px", cursor: "pointer",
          fontFamily: font, whiteSpace: "nowrap",
        }}
      >
        Actualizar
      </button>
    </div>
  );
}
