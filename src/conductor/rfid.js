// App del conductor · lectura de etiquetas RFID de los contenedores.
// Un lector RFID por USB/Bluetooth «escribe» el código y pulsa Intro, como un
// teclado; en Android, el NFC del móvil lee las etiquetas de 13,56 MHz. En
// los dos casos se busca el código entre los contenedores de la ruta.
// Sin React.

/** El código tal como venga («04:A2:1F…», « e2 00 34 », …) → «04A21F…» */
export const normalizarEtiqueta = s => String(s ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

/**
 * Busca una etiqueta leída entre las paradas de la ruta.
 * @returns { ubicId, codiQR, yaHecho } o null si no es de esta ruta
 */
export function buscarEtiqueta(ubicaciones, leido) {
  const x = normalizarEtiqueta(leido);
  if (!x) return null;
  for (const u of ubicaciones || []) {
    for (const e of u.elementos || []) {
      if ([e.rfid, e.codiQR].some(c => c && normalizarEtiqueta(c) === x)) return { ubicId: u.id, codiQR: e.codiQR, yaHecho: !!e.realizado };
    }
  }
  return null;
}

/** ¿Este móvil puede leer etiquetas con NFC? (Chrome en Android) */
export const hayNfc = () => typeof window !== "undefined" && "NDEFReader" in window;
