// Foto de perfil: se recorta en cuadrado, se reduce a 192 px y se guarda en
// el perfil (usuarios/{uid}.foto) como imagen JPEG en texto (unos 10-20 KB).
// Sin Firebase Storage (pide el plan Blaze). Si no hay foto, se ven las iniciales.
import { doc, updateDoc } from "firebase/firestore";
import { db } from "./firebase.js";

export const LADO_FOTO = 192;

/** Lado y origen del cuadrado central de una imagen de ancho × alto */
export function recorteCuadrado(ancho, alto) {
  const lado = Math.min(ancho, alto);
  return { sx: Math.round((ancho - lado) / 2), sy: Math.round((alto - lado) / 2), lado };
}

/** Archivo de imagen (de la galería o la cámara) → foto pequeña en texto (data:image/jpeg) */
export async function reducirFoto(archivo, lado = LADO_FOTO) {
  if (!archivo || !/^image\//.test(archivo.type || "image/")) throw new Error("Eso no es una imagen.");
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error("No se pudo abrir la imagen.")); i.src = url; });
    const { sx, sy, lado: l } = recorteCuadrado(img.naturalWidth, img.naturalHeight);
    const c = document.createElement("canvas");
    c.width = lado; c.height = lado;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, l, l, 0, 0, lado, lado);
    return c.toDataURL("image/jpeg", 0.82);
  } finally { URL.revokeObjectURL(url); }
}

/** Guarda (o quita, con null) la foto del propio usuario */
export const guardarFoto = (uid, foto) => updateDoc(doc(db, "usuarios", uid), { foto: foto || null });
