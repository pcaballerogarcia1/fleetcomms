// El botón de cerrar de todas las ventanas y paneles (antes cada uno con su «×» y su tamaño)
import { X } from "lucide-react";

export function BotonCerrar({ size = 15, title = "Cerrar", ...props }) {
  return (
    <button type="button" aria-label={props["aria-label"] || title} title={title} className="op-cerrar" {...props}>
      <X size={size} />
    </button>
  );
}
