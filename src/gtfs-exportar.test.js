import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { parseGtfsRed } from "./gtfs-red.js";
import { crearGtfs } from "./gtfs-exportar.js";
import { salidasDe } from "./lineas-sched/base.js";

// Un GTFS pequeño: dos paradas intermedias, ida y vuelta, laborables y sábados
function gtfs() {
  const viaje = (t, s, dir, h0) => [`${t},${h0},${h0},A,1`, `${t},${h0.replace(/:(\d\d):/, (_, m) => `:${String(+m + 10).padStart(2, "0")}:`)},${h0.replace(/:(\d\d):/, (_, m) => `:${String(+m + 10).padStart(2, "0")}:`)},B,2`, `${t},${h0.replace(/^(\d\d)/, (_, h) => String(+h + 1).padStart(2, "0"))},${h0.replace(/^(\d\d)/, (_, h) => String(+h + 1).padStart(2, "0"))},C,3`].join("\n");
  const f = {
    "agency.txt": "agency_id,agency_name\nX,Prueba\n",
    "routes.txt": "route_id,agency_id,route_short_name,route_long_name,route_type,route_color\nL,X,7,Centro - Hospital,3,FF0000\n",
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nA,Centro,40.40,-3.70\nB,Plaza,40.41,-3.70\nC,Hospital,40.43,-3.70\n",
    "trips.txt": "route_id,service_id,trip_id,direction_id,trip_headsign\nL,LAB,t1,0,Hospital\nL,LAB,t2,0,Hospital\nL,SAB,t3,0,Hospital\n",
    "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" + [viaje("t1", "LAB", 0, "07:00:00"), viaje("t2", "LAB", 0, "08:00:00"), viaje("t3", "SAB", 0, "09:00:00")].join("\n") + "\n",
    "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nLAB,1,1,1,1,1,0,0,20261005,20261016\nSAB,0,0,0,0,0,1,0,20261005,20261016\n",
  };
  return new Blob([zipSync(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, strToU8(v)])))]);
}

describe("crear un GTFS desde Operanzia", () => {
  it("exportar e importar de nuevo da las mismas salidas, paradas y calendarios", async () => {
    const red = await parseGtfsRed(gtfs());
    // una salida cambiada a mano en Planning (laborable): también sale en el GTFS
    const ida = red.lineas[0].sentidos[0];
    const calLab = red.calendarios.find(c => c.fechas.includes("2026-10-05"));
    const cfg = { [red.lineas[0].id]: { salidas: { [`0|${calLab.id}`]: [420, 480, 510] } } };
    const { zip, resumen } = crearGtfs(red, cfg, { operador: "Empresa, S.A." });
    expect(resumen).toMatchObject({ lineas: 1, paradas: 3, calendarios: 2 });
    const otra = await parseGtfsRed(new Blob([zip]));
    expect(otra.lineas[0]).toMatchObject({ nombre: "7", color: "#ff0000" });
    expect(otra.paradas.map(p => p.nombre).sort()).toEqual(["Centro", "Hospital", "Plaza"]);
    expect(otra.calendarios.map(c => c.fechas.join()).sort()).toEqual(red.calendarios.map(c => c.fechas.join()).sort());
    const lab2 = otra.calendarios.find(c => c.fechas.includes("2026-10-05"));
    expect(salidasDe(otra.lineas[0].sentidos[0], lab2.id, otra).lista).toEqual([420, 480, 510]);
    // y los pasos por parada: la intermedia a los 10 min
    expect(otra.lineas[0].sentidos[0].fracciones[1]).toBeCloseTo(ida.fracciones[1], 2);
    expect(otra.lineas[0].agencia).toBe("Empresa, S.A.");
  });
  it("sin calendarios no se puede", () => {
    expect(() => crearGtfs({ lineas: [], paradas: [], calendarios: [] })).toThrow(/calendarios/);
  });
});
