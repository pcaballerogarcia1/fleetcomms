# Carga de líneas: ~465 autobuses

Red: 93 líneas reales (corredores del GTFS interurbano de Madrid), 994 turnos publicados.

| Paso | Tiempo | Peor bloqueo | Memoria | Lecturas | Escrituras |
|---|---|---|---|---|---|
| Entrar en la oficina | 0.9 s | 0.1 s | 10 MB | 12 | 2 |
| Crear el proyecto de líneas | 0.3 s | 0 s | 10 MB | 13 | 3 |
| Leer el GTFS (21 MB, 93 líneas) | 6.5 s | 2.1 s | 10 MB | 0 | 1 |
| Importar la red y verla en el mapa | 0.5 s | 0.1 s | 10 MB | 4 | 4 |
| Rutas: generar los autobuses (paso 1) | 4.3 s | 0.3 s | 10 MB | 18 | 4 |
| Rutas: turnos de conductor (paso 2) | 0.7 s | 0.3 s | 10 MB | 0 | 0 |
| Rutas: desplazarse por el Gantt | 2.8 s | 0 s | 10 MB | 0 | 0 |
| Publicar a Control (hoy) | 13.4 s | 0.2 s | 10 MB | 1003 | 996 |
| Control: ver el día en marcha | 1.2 s | 0.5 s | 10 MB | 3 | 1 |
| Volver a abrir la app (recargar) y Rutas | 4.8 s | 0.4 s | 10 MB | 1029 | 7 |
| Cuadrante | 3.6 s | 0.2 s | 10 MB | 15 | 1 |
| **Total** | | | | **2097** | **1019** |

## Carga de líneas: ~465 autobuses (CPU 4× más lenta)

Red: 93 líneas reales (corredores del GTFS interurbano de Madrid), 994 turnos publicados.

| Paso | Tiempo | Peor bloqueo de la pantalla | Lecturas | Escrituras |
|---|---|---|---|---|
| Entrar en la oficina | 1.3 s | 0.2 s | 13 | 2 |
| Crear el proyecto de líneas | 0.6 s | 0.1 s | 13 | 3 |
| Leer el GTFS (21 MB, 93 líneas) | 13.5 s | 8.5 s | 0 | 1 |
| Importar la red y verla en el mapa | 1.4 s | 0.4 s | 4 | 4 |
| Rutas: generar los autobuses (paso 1) | 8.8 s | 1.3 s | 18 | 4 |
| Rutas: turnos de conductor (paso 2) | 3.2 s | 1.6 s | 0 | 0 |
| Rutas: desplazarse por el Gantt | 6.1 s | 0 s | 0 | 0 |
| Publicar a Control (hoy) | 32.4 s | 0.7 s | 1005 | 997 |
| Control: ver el día en marcha | 3.7 s | 1 s | 3 | 1 |
| Volver a abrir la app (recargar) y Rutas | 12.9 s | 1.2 s | 1029 | 7 |
| Cuadrante | 5.3 s | 0.9 s | 15 | 1 |
| **Total** | | | **2100** | **1020** |
