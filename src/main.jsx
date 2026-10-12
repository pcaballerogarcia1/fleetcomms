import { Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { initErrorReporting } from "./error-report.js";
import { App, SuperAdminApp, ErrorBoundary, RootFallback, UpdatePrompt } from "./raiz.jsx";
import { WorkspaceRouter } from "./workspace.jsx";

// Errores de cualquier pantalla (oficina y Rutas) → errores/{id} para el superadmin
initErrorReporting();

// ── Entry ─────────────────────────────────────────────────────────
const initPath = window.location.pathname;
const isFleetApp    = initPath.startsWith("/incidencias") ||
                      initPath.startsWith("/rutas") || initPath.startsWith("/inventario");
const isSuperAdmin  = initPath.startsWith("/superadmin");

createRoot(document.getElementById("root")).render(
  <>
    <UpdatePrompt />
    <ErrorBoundary>
      <Suspense fallback={<RootFallback />}>
        {isSuperAdmin ? <SuperAdminApp /> : isFleetApp ? <App /> : <WorkspaceRouter />}
      </Suspense>
    </ErrorBoundary>
  </>
);
