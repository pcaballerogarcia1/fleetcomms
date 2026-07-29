import { useState, useEffect } from "react";

// ── i18n ligero para el "chrome" de la app (menús, pestañas, títulos de
// módulo, botones principales) — no traduce datos de usuario (Excel,
// nombres de calle, etc.), esos se quedan siempre en el idioma original.
const DICT = {
  es: {
    proyectos: "Proyectos", planning: "Planning", scheduling: "Scheduling",
    rostering: "Rostering", control: "Control", analytics: "Analytics",
    fullscreen: "Pantalla completa", exitFullscreen: "Salir de pantalla completa", logout: "Cerrar sesión",
    vehiculos: "Vehículos", trabajadores: "Trabajadores", restricciones: "Restricciones",
    importar: "Importar", publicarRutas: "Publicar en Rutas", generarEscenario: "Generar escenario",
    generando: "Generando…", calculandoKm: "Calculando km…",
    planes: "Planes", mapaFlota: "Mapa de flota", fichajes: "Fichajes",
    produccion: "Producción", personal: "Personal", varios: "Varios",
    plantillas: "Plantillas", historial: "Historial", simulador: "Simulador",
  },
  en: {
    proyectos: "Projects", planning: "Planning", scheduling: "Scheduling",
    rostering: "Rostering", control: "Control", analytics: "Analytics",
    fullscreen: "Fullscreen", exitFullscreen: "Exit fullscreen", logout: "Log out",
    vehiculos: "Vehicles", trabajadores: "Workers", restricciones: "Constraints",
    importar: "Import", publicarRutas: "Publish to Routes", generarEscenario: "Generate scenario",
    generando: "Generating…", calculandoKm: "Computing km…",
    planes: "Plans", mapaFlota: "Fleet map", fichajes: "Clock-ins",
    produccion: "Production", personal: "Staff", varios: "Other",
    plantillas: "Templates", historial: "History", simulador: "Simulator",
  },
};

const LANG_KEY = "fc_lang";
const LANG_EVENT = "fc-lang-change";

export function getLang() {
  try { return localStorage.getItem(LANG_KEY) || "es"; } catch { return "es"; }
}

export function setLang(l) {
  try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: l }));
}

// Hook reactivo: se actualiza en todos los módulos (aunque estén en chunks
// lazy distintos) en cuanto alguien cambia el idioma, vía evento global.
export function useLang() {
  const [lang, setLangState] = useState(getLang);
  useEffect(() => {
    const onChange = e => setLangState(e.detail);
    window.addEventListener(LANG_EVENT, onChange);
    return () => window.removeEventListener(LANG_EVENT, onChange);
  }, []);
  return lang;
}

export function t(key, lang) {
  const l = lang || getLang();
  return DICT[l]?.[key] ?? DICT.es[key] ?? key;
}
