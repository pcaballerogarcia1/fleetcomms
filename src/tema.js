// ── Tema visual de Operanzia ─────────────────────────────────────────
// Una sola paleta, tipografía, radios y sombras para toda la app (oscuro
// refinado, con la marca de operanzia.com: degradado azul → violeta).
// Las pantallas que aún tienen su propia `const C` usan estos mismos valores;
// lo nuevo debe importar de aquí.

export const C = {
  // superficies (de más al fondo a más arriba)
  bg: "#0b0d12",        // fondo de la app
  card: "#12151c",      // paneles y tarjetas
  surface2: "#181c25",  // controles, filas al pasar el ratón
  surface3: "#1f2430",  // seleccionado / pulsado
  input: "#0d0f14",     // fondo de los campos
  border: "rgba(255,255,255,0.08)",
  border2: "rgba(255,255,255,0.14)",
  // texto
  text: "#e6e8ee",
  muted: "#9aa3b2",
  dim: "#5d6574",
  // acento (uno solo) y su fondo suave
  blue: "#5b7cfa", blueText: "#b4c3ff", blueDim: "#1a2142",
  cyan: "#5b7cfa", cyanText: "#b4c3ff", cyanDim: "#1a2142",
  violet: "#a78bfa", purple: "#a78bfa",
  // estados
  green: "#3fcf8e", greenDim: "#0f2a1f",
  amber: "#f5b84a", orange: "#f59e5b",
  red: "#f26d6d",
};

export const MARCA = { desde: "#2563eb", hasta: "#6d28d9", degradado: "linear-gradient(135deg,#2563eb 0%,#6d28d9 100%)" };

export const font = "'Inter Variable','Inter',system-ui,-apple-system,'Segoe UI',sans-serif";
// Las cifras ya van alineadas en toda la app (index.css: tabular-nums): no
// hace falta letra de máquina de escribir para las tablas.
export const mono = font;

export const R = { s: 6, m: 8, l: 12, xl: 16 };            // radios
export const SOMBRA = {
  s: "0 1px 2px rgba(0,0,0,0.4)",
  m: "0 4px 16px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.4)",
  l: "0 16px 48px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.4)",
};
