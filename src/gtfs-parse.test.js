import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { parseGtfs, csvLine, simplificar, tipoRuta, zipEntries, minToHHMM } from "./gtfs-parse.js";

// GTFS mínimo, con stop_times ANTES que trips en el zip y dentro de una carpeta
function gtfsZip({ sinStops = false, comprimir = true } = {}) {
  const files = {
    "red/agency.txt": "agency_id,agency_name,agency_url,agency_timezone\nOP1,Atac,http://x,Europe/Rome\n",
    "red/stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\r\n" +
      "t1,07:00:00,07:00:00,S1,1\r\nt1,07:10:00,07:10:00,S2,2\r\n" +
      "t2,24:30:00,24:30:00,S2,1\r\nt2,24:40:00,24:40:00,S3,2\r\n" +
      "t3,05:00:00,05:00:00,S1,1\r\n",
    "red/routes.txt": "route_id,agency_id,route_short_name,route_long_name,route_type,route_color\n" +
      "64,OP1,64,,3,\nTR8,OP1,8,\"Casaletto - Piazza Venezia, centro\",0,FF0000\nVACIA,OP1,99,,3,\n",
    "red/trips.txt": "route_id,service_id,trip_id,direction_id,shape_id\n64,s,t1,0,SH1\n64,s,t3,0,SH1\nTR8,s,t2,1,SH2\n",
    "red/shapes.txt": "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n" +
      "SH1,41.9,12.45,2\nSH1,41.8,12.4,1\nSH1,41.95,12.55,3\nSH2,41.7,12.3,1\nSH2,41.71,12.31,2\nOTRO,1,1,1\n",
    "red/stops.txt": "stop_id,stop_code,stop_name,stop_lat,stop_lon,location_type\n" +
      "S1,1001,\"TERMINI, piazza\",41.90,12.50,0\nS2,,Venezia,41.89,12.48,\nS3,1003,Casaletto,41.87,12.43,0\n" +
      "EST,,Estación Termini,41.90,12.50,1\nMALA,,Sin coordenadas,0,0,0\n",
  };
  if (sinStops) delete files["red/stops.txt"];
  const z = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [strToU8(v), { level: comprimir ? 6 : 0 }]])));
  return new Blob([z]);
}

describe("lectura de GTFS", () => {
  it("paradas con sus líneas, líneas con viajes, horario y recorrido", async () => {
    const progreso = [];
    const r = await parseGtfs(gtfsZip(), { onProgress: (f, t) => progreso.push([f, t]) });
    expect(r.agencias).toEqual(["Atac"]);
    expect(r.paradas.map(p => p.nombre)).toEqual(["TERMINI, piazza", "Venezia", "Casaletto"]); // sin estación ni 0,0
    expect(r.paradas[0]).toMatchObject({ codigo: "1001", lineas: "64", _r: ["64"] });
    expect(r.paradas[1]).toMatchObject({ codigo: "S2", lineas: "8 · 64", _r: ["TR8", "64"] });
    const l64 = r.lineas.find(l => l.id === "64"), l8 = r.lineas.find(l => l.id === "TR8");
    expect(l64).toMatchObject({ nombre: "64", tipo: "Autobús", agencia: "Atac", viajes: 2, paradas: 2, primera: "05:00", ultima: "07:10" });
    expect(l64.trazados).toEqual([[[41.8, 12.4], [41.9, 12.45], [41.95, 12.55]]]); // ordenado por secuencia
    expect(l8).toMatchObject({ nombre: "8", largo: "Casaletto - Piazza Venezia, centro", tipo: "Tranvía", color: "#ff0000", ultima: "00:40 (+1)" });
    expect(r.lineas.find(l => l.id === "VACIA")).toBeUndefined(); // sin viajes
    expect(progreso.at(-1)).toEqual([1, "Listo"]);
  });

  it("también sin compresión (método stored)", async () => {
    const r = await parseGtfs(gtfsZip({ comprimir: false }));
    expect(r.paradas).toHaveLength(3);
  });

  it("avisa si no es un GTFS o no es un zip", async () => {
    await expect(parseGtfs(gtfsZip({ sinStops: true }))).rejects.toThrow(/falta stops.txt/);
    await expect(parseGtfs(new Blob(["hola"]))).rejects.toThrow(/zip válido/);
  });

  it("índice del zip sin la carpeta", async () => {
    expect([...(await zipEntries(gtfsZip())).keys()]).toContain("stops.txt");
  });
});

describe("utilidades", () => {
  it("CSV con comillas y comas dentro", () => {
    expect(csvLine('a,"b, c","d ""e"""')).toEqual(["a", "b, c", 'd "e"']);
    expect(csvLine("1,2,,3")).toEqual(["1", "2", "", "3"]);
  });
  it("horas de madrugada del día siguiente", () => {
    expect([minToHHMM(300), minToHHMM(1440 + 90), minToHHMM(1440 * 2 + 5), minToHHMM(null)]).toEqual(["05:00", "01:30 (+1)", "00:05 (+2)", ""]);
  });
  it("tipo de transporte (también códigos extendidos)", () => {
    expect([tipoRuta(3), tipoRuta(700), tipoRuta(1), tipoRuta(0), tipoRuta(2), tipoRuta(11)])
      .toEqual(["Autobús", "Autobús", "Metro", "Tranvía", "Tren", "Trolebús"]);
  });
  it("simplificar quita puntos alineados y conserva las curvas", () => {
    const recta = Array.from({ length: 50 }, (_, i) => [40 + i * 0.001, -3]);
    expect(simplificar(recta)).toHaveLength(2);
    const codo = [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]];
    expect(simplificar(codo)).toEqual([[0, 0], [0, 2], [2, 2]]);
  });
});
