# Lecturas de Firestore por pantalla

Medido con `npm run medir` el 2026-10-05, contra los emuladores con los datos de un cliente mediano (4309 documentos: 600 rutas en 3 meses, 40 trabajadores, 2.000 líneas de historial, 1.000 fichajes…).

«Lecturas» son los documentos que llegan del servidor (lo que cobra Firestore). Además, cada petición hace 1–2 lecturas en las reglas (`get()` del perfil y del proyecto).

| Paso | Lecturas | Peticiones | Escrituras | Dónde lee más |
|---|---:|---:|---:|---|
| Oficina · entrar y lista de proyectos | 68 | 8 | 2 | scheduling_workers 40, scheduling_vehicles 25, usuarios 2, scheduling_projects 1 |
| Oficina · abrir proyecto (Planning) | 5 | 6 | 2 | presencia 1, planning_layers 1, scheduling_projects/*/timetable 1, planning_depots 1 |
| Oficina · Scheduling | 7 | 7 | 1 | presencia 1, rostering 1, rostering/*/trabajadores 1, rostering_vehicles 1 |
| Oficina · Rostering | 51 | 10 | 1 | scheduling_workers 40, usuarios 3, rostering 2, presencia 1 |
| Oficina · Control | 207 | 3 | 1 | planes 202, usuarios 4, presencia 1 |
| Oficina · Analytics | 319 | 14 | 1 | planes 202, fichajes 101, precios/*/trozos 8, incidencias 6 |
| Oficina · Historial de cambios | 100 | 1 | 0 | auditoria 100 |
| Oficina · 30 s con todo abierto, sin tocar nada | 0 | 0 | 0 | — |
| Conductor · entrar (portada de rutas) | 54 | 7 | 0 | planes 43, fichajes 7, usuarios 4 |
| Conductor · abrir una ruta | 0 | 1 | 1 | — |
| Conductor · marcar una parada | 2 | 1 | 1 | planes 2 |
| Conductor · incidencias | 100 | 2 | 1 | incidencias 100 |
| Conductor · inventario | 81 | 1 | 0 | inventario 81 |
| **Total del recorrido** | **994** | | | |

Plan Spark: 50.000 lecturas al día para toda la aplicación.
