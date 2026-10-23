import { describe, expect, it } from "vitest";
import { parseKML } from "./comun.js";

const KML_MYMAPS = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name><![CDATA[Ruta lunes]]></name>
    <Placemark id="p1">
      <name>Calle Mayor 3 &amp; esquina</name>
      <ExtendedData>
        <Data name="Turno">
          <value>Mañana</value>
        </Data>
      </ExtendedData>
      <Point>
        <coordinates>
          2.6502,39.5701,0
        </coordinates>
      </Point>
    </Placemark>
    <Placemark>
      <name>Plaza de España</name>
      <Point><coordinates>2.6540,39.5760,0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>Zona</name>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>2.6,39.5,0 2.7,39.5,0 2.7,39.6,0</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>
    <Placemark>
      <LineString><coordinates>2.65,39.57,0 2.654,39.576,0</coordinates></LineString>
    </Placemark>
  </Document>
</kml>`;

describe("KML de cualquier origen", () => {
  it("lee los puntos de Google My Maps (placemarks con id, campos con saltos de línea, CDATA)", () => {
    const r = parseKML(KML_MYMAPS);
    expect(r.docName).toBe("Ruta lunes");
    expect(r.ubicaciones.map(u => [u.calle, u.turno, u.lat])).toEqual([["Calle Mayor 3 & esquina", "Mañana", 39.5701], ["Plaza de España", "", 39.576]]);
    expect(r.recorrido).toHaveLength(2);
  });
});
