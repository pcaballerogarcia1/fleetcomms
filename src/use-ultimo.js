// El valor más reciente de algo (una función, un dato), para leerlo dentro de
// un efecto o una escucha sin que el efecto se rehaga cada vez que cambia:
// p. ej. un mapa que se crea una sola vez pero pinta con las funciones de
// ahora. Se actualiza después de cada pintado.
import { useRef, useEffect } from "react";

export function useUltimo(valor) {
  const ref = useRef(valor);
  useEffect(() => { ref.current = valor; });
  return ref;
}
