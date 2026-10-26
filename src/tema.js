// ── Tema visual de Operanzia ─────────────────────────────────────────
// Dos aspectos, claro y oscuro, con el azul marino de la marca como color
// principal (sin degradados morados). Una sola paleta para toda la app: las
// pantallas que tenían su propia `const C` la toman de aquí.
// El aspecto se elige al cargar (lo guardado; si no, el oscuro) y cambiarlo
// recarga la página: así los colores siguen siendo valores fijos y se pueden
// combinar con transparencias (`${C.blue}55`).

const PALETAS = {
  oscuro: {
    // superficies (de más al fondo a más arriba)
    bg: "#0c0f14",        // fondo de la app
    card: "#131821",      // paneles y tarjetas
    surface2: "#1a202b",  // controles, filas al pasar el ratón
    surface3: "#222a37",  // seleccionado / pulsado
    input: "#0e1218",     // fondo de los campos
    border: "rgba(255,255,255,0.08)",
    border2: "rgba(255,255,255,0.14)",
    // texto
    text: "#e7eaf0",
    muted: "#9ba4b3",
    dim: "#5f6878",
    // acento (uno solo: el azul de la marca) y su fondo suave
    blue: "#4f7fe0", blueText: "#b9cdf6", blueDim: "#17243d",
    cyan: "#4f7fe0", cyanText: "#b9cdf6", cyanDim: "#17243d",
    violet: "#8f9be8", purple: "#8f9be8",
    // estados
    green: "#3fcf8e", greenDim: "#0f2a1f",
    amber: "#f0b44a", orange: "#f09a5b",
    red: "#ef6b6b",
    marino: "#1b2a4a",
  },
  claro: {
    bg: "#f4f5f8",
    card: "#ffffff",
    surface2: "#eef0f4",
    surface3: "#e2e6ee",
    input: "#ffffff",
    border: "rgba(16,24,40,0.11)",
    border2: "rgba(16,24,40,0.2)",
    text: "#141b2b",
    muted: "#545f73",
    dim: "#8790a1",
    blue: "#1f4e9c", blueText: "#1b3a72", blueDim: "#e5ecf8",
    cyan: "#1f4e9c", cyanText: "#1b3a72", cyanDim: "#e5ecf8",
    violet: "#5a5fb0", purple: "#5a5fb0",
    green: "#16955a", greenDim: "#e2f4ea",
    amber: "#b3741a", orange: "#c2610c",
    red: "#c63737",
    marino: "#1b2a4a",
  },
};

const leer = k => { try { return globalThis.localStorage?.getItem(k); } catch { return null; } };

/** «claro» u «oscuro»: lo elegido en este ordenador o, si nada, el oscuro (el de siempre de Operanzia) */
export const TEMA = (() => {
  const g = leer("op-tema");
  return g === "claro" ? "claro" : "oscuro";
})();
export const CLARO = TEMA === "claro";

if (typeof document !== "undefined") {
  document.documentElement.dataset.tema = TEMA;
  document.documentElement.style.colorScheme = CLARO ? "light" : "dark";
}

/** Cambia el aspecto (se guarda en este ordenador y se recarga la página) */
export function cambiarTema(t) {
  try { globalThis.localStorage?.setItem("op-tema", t); } catch { /* sin almacenamiento: solo esta vez */ }
  globalThis.location?.reload();
}

export const C = PALETAS[TEMA];

/**
 * Un velo del color del texto con esa opacidad: en oscuro, blanco
 * transparente; en claro, gris azulado transparente (las líneas, fondos
 * suaves y bordes que antes eran rgba(255,255,255,x)).
 */
export const alfa = n => (CLARO ? `rgba(16,24,40,${Math.min(1, +(n * 1.25).toFixed(3))})` : `rgba(255,255,255,${n})`);

// La marca: azul marino (sin degradado). `degradado` se queda por compatibilidad: ya es un color liso.
export const MARCA = CLARO
  ? { desde: "#1b2a4a", hasta: "#1f4e9c", degradado: "#1b2a4a" }
  : { desde: "#2b4f96", hasta: "#4f7fe0", degradado: "#2b4f96" };

export const font = "'Inter Variable','Inter',system-ui,-apple-system,'Segoe UI',sans-serif";
// Las cifras ya van alineadas en toda la app (index.css: tabular-nums): no
// hace falta letra de máquina de escribir para las tablas.
export const mono = font;

export const R = { s: 6, m: 8, l: 12, xl: 16 };            // radios
export const SOMBRA = CLARO ? {
  s: "0 1px 2px rgba(16,24,40,0.06)",
  m: "0 4px 14px rgba(16,24,40,0.08), 0 1px 2px rgba(16,24,40,0.06)",
  l: "0 16px 40px rgba(16,24,40,0.14), 0 2px 6px rgba(16,24,40,0.08)",
} : {
  s: "0 1px 2px rgba(0,0,0,0.4)",
  m: "0 4px 16px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.4)",
  l: "0 16px 48px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.4)",
};

/** Un color para cada aspecto: tono("#2d1515", "#fbeaea") */
export const tono = (oscuro, claro) => (CLARO ? claro : oscuro);
