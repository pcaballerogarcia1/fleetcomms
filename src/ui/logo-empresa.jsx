// El logo de la empresa en la barra de arriba (a la derecha). Con un fondo
// blanco detrás, salvo que el superadmin lo quite: así un logo oscuro se ve
// también en el aspecto oscuro.
export function LogoEnBarra({ logo, nombre, fondo = true }) {
  return (
    <div className="op-cabecera-logo" title={nombre || undefined} style={{
      height: 32, display: "flex", alignItems: "center", flexShrink: 0,
      padding: fondo ? "3px 10px" : 0, background: fondo ? "#fff" : "none", borderRadius: 8,
    }}>
      <img src={logo} alt={nombre ? `Logo de ${nombre}` : "Logo de la empresa"} style={{ maxHeight: fondo ? 26 : 30, maxWidth: 160, objectFit: "contain", display: "block" }} />
    </div>
  );
}
