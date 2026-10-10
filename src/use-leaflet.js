// Leaflet desde el CDN, cargado una sola vez (Planning y Control de líneas)
import { useState, useEffect } from "react";

export function useLeaflet() {
  const [L, setL] = useState(() => window.L || null);
  useEffect(() => {
    if (window.L) return;
    if (!document.getElementById("leaflet-css")) {
      const css = document.createElement("link");
      css.id = "leaflet-css"; css.rel = "stylesheet";
      css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(css);
    }
    let js = document.getElementById("leaflet-js");
    if (!js) {
      js = document.createElement("script");
      js.id = "leaflet-js"; js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      document.head.appendChild(js);
    }
    const ok = () => setL(window.L);
    js.addEventListener("load", ok);
    return () => js.removeEventListener("load", ok);
  }, []);
  return L;
}
