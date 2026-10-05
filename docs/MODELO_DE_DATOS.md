# Modelo de datos de Operanzia

Mapa de qué se guarda dónde, cuál es la **fuente de verdad** de cada dato, qué
copias derivadas existen y cómo se mantienen al día. Revisado contra el código
el 5 de octubre de 2026.

Regla general: **la nube (Firestore) es la fuente de verdad**. IndexedDB y
`localStorage` del navegador son cachés; nada que se publique a otros usuarios
debe salir de ellas si la nube tiene el dato.

## 1. Identidad y organización

| Dato | Fuente de verdad | Copias | Notas |
|---|---|---|---|
| Organización | `orgs/{slug}` | — | ID = nombre «slugificado». Solo la escribe el superadmin. `max_usuarios` solo se comprueba en la interfaz. |
| Usuario (login) | Firebase Auth + `usuarios/{uid}` (rol, org) | — | El perfil lo crea quien da de alta (reglas). Sin perfil, una cuenta no ve nada. |
| Trabajador (planificación) | `scheduling_workers/{id}` | nombre repetido en planes y cuadrantes publicados | Persona distinta del usuario: se **vincula** con `scheduling_workers.uid` (Rostering → vincular). Un trabajador puede no tener usuario. |
| Vehículo | `scheduling_vehicles/{id}` | nombre/matrícula repetidos en planes publicados | |

## 2. Proyecto y planificación

| Dato | Fuente de verdad | Copias | Notas |
|---|---|---|---|
| Proyecto | `scheduling_projects/{id}` | `localStorage.fc_active_project` (proyecto abierto) | `tipo`: `puntos` o `lineas`. |
| Restricciones del Scheduling de puntos | `scheduling_projects/{id}.scheduling.constraints` | — | |
| Resumen del último escenario | `scheduling_projects/{id}.scheduling` (km, vehículos…) | — | **Derivado** del escenario; se reescribe al generar. Solo para la tarjeta del proyecto. |
| Capas de puntos / red GTFS | `planning_layers/{id}` + `trozos` | IndexedDB de Planning | Comprimidas y troceadas; la ficha apunta a la versión `v` de los trozos. |
| Horario por punto | `scheduling_projects/{id}/timetable` | — | `planning_timetable` (sin proyecto) es un camino antiguo: las reglas no lo permiten salvo al superadmin. |
| Depots y cocheras | `planning_depots/{projectId}.depots` | — | Mismo documento para los depots de puntos y las cocheras de líneas. |
| Configuración de líneas | `planning_settings/{id}.lineasCfg` | — | Tipos de vehículo, regulación, tiempos corregidos, cochera. |

## 3. Escenarios (Scheduling)

| Dato | Fuente de verdad | Copias | Cómo se mantiene |
|---|---|---|---|
| Escenario de puntos | `scheduling_scenarios/{id}` + `trozos` (versión `v`, `stamp` de generación) | IndexedDB `vrp_cache/vrp_{id}` | Al abrir Scheduling se descarga la versión de la nube si es distinta. Guardar comprueba la versión base (`baseV`) para no pisar a otra persona. |
| Métricas de cada generación | `scheduling_projects/{id}/scenario_history` | — | Solo cifras, para comparar. |
| Escenario de líneas | **no se guarda**: se recalcula (determinista) con la red, la configuración, las cocheras y los parámetros | resumen por calendario en `planning_settings/{id}.lineasSched.porCalendario[dia]` | El resumen lleva `claveV` / `clave` (huella de con qué se calculó): si no coincide, sale «Desactualizado». Los cambios a mano se guardan como lista de operaciones (`manuales`) y se vuelven a aplicar. |

## 4. Rostering

| Dato | Fuente de verdad | Copias | Cómo se mantiene |
|---|---|---|---|
| Turnos a cubrir del escenario | `scheduling_roster/{projectId}` + `partes` (`generatedAt` = `stamp` del escenario) | — | **Derivado** del escenario; se reescribe al generar. Las partes llevan la marca de su generación y solo se leen las de la vigente. |
| Cuadrante del mes | `rostering/{org}_{YYYY}_{MM}/trabajadores/{workerId}` | — | Se guarda casilla a casilla: dos personas en casillas distintas no se pisan. |
| Reglas / convenio | `rostering/{org}_…` | — | |
| Disponibilidad de vehículos | `rostering_vehicles/{org}_{YYYY}_{MM}` | — | |

## 5. Lo que se publica a los conductores (copias)

Son **copias** hechas en un momento dado; no se actualizan solas.

| Copia | Sale de | Cuándo se rehace | Regla para no duplicar |
|---|---|---|---|
| `planes` (rutas del día) | Escenario de puntos (nube) + cuadrante | Al pulsar «Publicar» en Scheduling (por vehículo y día) o en Rostering (por trabajador y día) | Publicar desde Scheduling **sustituye** las rutas no empezadas de ese proyecto y mes, vengan de donde vengan. Rostering avisa y quita las de Scheduling antes de publicar por trabajador. Las ya empezadas no se tocan nunca y no se vuelven a publicar. |
| `cuadrantes/{org}_{mes}_{uid}` | Cuadrante de Rostering | Al publicar en Rostering | Un documento por conductor y mes: se sobrescribe. |

Rostering publica el escenario **de la nube** y comprueba que su `stamp` sea el
`generatedAt` del cuadrante; si no casan (se volvió a generar), publica solo el
cuadrante y lo dice.

## 6. Datos de actividad

| Dato | Dónde | Notas |
|---|---|---|
| Fichajes | `fichajes` | Solo los escribe el propio conductor. Sin caducidad (RGPD: pendiente). |
| Ubicación en vivo | `ubicaciones_activas/{uid}` | Solo el propio conductor. Sin caducidad. |
| Presencia | `presencia/{uid}` | Quién está conectado. |
| Auditoría | `auditoria` | Solo añadir. |
| Errores del navegador | `errores` | Solo los lee el superadmin. |
| Field: incidencias, inventario, movimientos | colecciones con `org_id` | |

## 7. Problemas encontrados y estado

| Problema | Estado |
|---|---|
| «Publicar en Rutas» de Scheduling solo añadía: publicar dos veces, o desde Scheduling y desde Rostering, duplicaba las rutas de los conductores. | **Corregido**: sustituye las no empezadas y conserva las empezadas. |
| Rostering publicaba el escenario de la copia del navegador, que podía ser vieja si otra persona había regenerado. | **Corregido**: usa la nube y comprueba la generación. |
| Publicar escribe muchos documentos sin transacción. | Mitigado: primero escribe las nuevas y luego quita las viejas (si falla a medias puede quedar alguna repetida, nunca un conductor sin ruta). |
| `planning_timetable` sin regla. | Código antiguo sin uso real; pendiente de quitar. |
| `max_usuarios` de la organización solo se comprueba en la interfaz. | Pendiente (necesita alta en servidor, plan Blaze). |
| Cambios a mano del Scheduling de líneas: la lista se sobrescribe entera; dos personas a la vez pierden cambios. | Pendiente: punto 2 (concurrencia). |
