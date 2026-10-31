# Referencia para la tabla de clasificación (bench/clasificacion.mjs): PyVRP,
# uno de los mejores motores de rutas de código abierto, con N segundos por
# problema. Guarda bench/referencia/pyvrp.json. Uso: python bench/pyvrp_referencia.py 60
import json, sys, os, inspect
from pyvrp import read, solve
from pyvrp.stop import MaxRuntime
seg = int(sys.argv[1]) if len(sys.argv) > 1 else 60
base = os.path.join(os.path.dirname(__file__), "referencia")
salida = os.path.join(base, "pyvrp.json")
res = json.load(open(salida)) if os.path.exists(salida) else {}
kw = "round_func" if "round_func" in inspect.signature(read).parameters else None
for f in sorted(os.listdir(base)):
    if not f.endswith(".vrp"): continue
    n = f[:-4]
    solomon = not n.startswith("X-")
    data = read(os.path.join(base, f), **({kw: "dimacs" if solomon else "round"} if kw else {}))
    r = solve(data, stop=MaxRuntime(seg), display=False)
    esc = 10 if solomon else 1  # dimacs: distancias ×10, truncadas a un decimal
    res[n] = {"distancia": r.best.distance() / esc, "rutas": r.best.num_routes(), "factible": r.best.is_feasible(), "segundos": seg}
    print(n, res[n], flush=True)
    json.dump(res, open(salida, "w"), indent=1)
