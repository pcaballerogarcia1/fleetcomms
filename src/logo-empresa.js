// El logo de cada empresa (panel del superadmin › Configuración), que sale en
// la barra de arriba de la oficina. Se guarda en su ficha (orgs/{org}.logo)
// como imagen pequeña: se reduce en el navegador, conservando la
// transparencia, para que la ficha siga siendo ligera.

export const LOGO_MAX = { ancho: 480, alto: 120 }; // el doble de lo que se ve, para pantallas nítidas
export const LOGO_BYTES = 150_000;

/** El tamaño reducido, sin deformar y sin agrandar */
export function medidaLogo(ancho, alto, max = LOGO_MAX) {
  if (!ancho || !alto) throw new Error("La imagen está vacía.");
  const f = Math.min(1, max.ancho / ancho, max.alto / alto);
  return { ancho: Math.max(1, Math.round(ancho * f)), alto: Math.max(1, Math.round(alto * f)) };
}

/** Un archivo de imagen (PNG, JPG, SVG, WebP…) → el logo reducido (data URL) */
export async function reducirLogo(archivo) {
  if (!archivo || !/^image\//.test(archivo.type || "")) throw new Error("Eso no es una imagen: usa un PNG, JPG o SVG.");
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error("No se pudo abrir la imagen.")); i.src = url; });
    for (const escala of [1, 0.75, 0.5]) {
      const { ancho, alto } = medidaLogo(img.naturalWidth || img.width, img.naturalHeight || img.height, { ancho: LOGO_MAX.ancho * escala, alto: LOGO_MAX.alto * escala });
      const c = document.createElement("canvas");
      c.width = ancho; c.height = alto;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, ancho, alto);
      const png = c.toDataURL("image/png"); // PNG: conserva el fondo transparente
      if (png.length <= LOGO_BYTES) return png;
      const webp = c.toDataURL("image/webp", 0.9);
      if (webp.startsWith("data:image/webp") && webp.length <= LOGO_BYTES) return webp;
    }
    throw new Error("El logo es demasiado pesado incluso reducido: prueba con otra versión más sencilla.");
  } finally { URL.revokeObjectURL(url); }
}
