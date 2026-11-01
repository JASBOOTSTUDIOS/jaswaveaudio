# Q — Resiliencia de la IA (cortes de internet, cierres forzados, memoria, apagados)

> Estado: implementado y probado con modelo, red y disco simulados (sin modelo real, sin gasto). Pendiente: una pasada
> real matando el proceso con la banda trabajando (ver «Cómo probar a mano»).
> Continúa el plan [P](P-velocidad-produccion.md) (reloj) y [N](N-eficiencia-ia.md) (tokens).

## 1. Objetivo y límites honestos

Una producción de la banda dura minutos y muchas peticiones. Antes de Q, cualquier interrupción la estropeaba: tras
unos minutos sin internet la petición fallaba, y un cierre forzado o una caída de la ventana perdía **todo** lo que la
banda sabía (plan, reparto, quién había terminado). Ahora:

| Caso | Qué pasa |
|---|---|
| Se cae internet | La petición pendiente **no gasta reintentos**: la producción pasa a «pausada por red», conserva la petición y **continúa sola** al volver la conexión. Sin límite de espera salvo Detener. |
| Se cierra la app / se mata el proceso / se va la luz | Al reabrir, el panel de la banda muestra «La producción se interrumpió en … hace … · qué estaba hecho» con **Reanudar**, **Reanudar desde la última copia** y **Descartar**. |
| La ventana se cuelga o muere (memoria, fallo gráfico) | Se marca la producción como interrumpida; si murió, la ventana se recarga sola (máx. 3 veces en 5 min) y se ofrece reanudar. Si solo se cuelga, tras 45 s se pregunta «Esperar / Reiniciar la ventana». |
| Apagado, cierre de sesión de Windows, cerrar la app | Cierre de emergencia **síncrono**: lo abierto se marca «interrumpida» en el diario y se pide al renderer una copia extra del proyecto. |
| Poca memoria | Cada 20 s se mide la memoria de la app y la RAM libre; con nivel alto o crítico se guarda una copia extra y se avisa en lenguaje llano (sin cifras ni tecnicismos). |
| Cae el host de audio a mitad de una medición | La app ya lo reinicia; la medición se **reintenta una vez** (tras 2 s). Si vuelve a caer, «no medible» y la producción sigue. |
| La producción se pasa del límite de tiempo | Se aplica **siempre** un máster mínimo determinista (sin modelo) en lugar de entregar sin limitador. |
| Proyecto sin guardar (sin ruta) | El autosave de 2 min ya no exige ruta: va a la carpeta de recuperación. |

**Lo que NO se tolera / límites reales**

- Un corte de luz a mitad de una escritura se tolera (escritura atómica + 3 copias rotativas + diario por líneas), pero
  **los últimos segundos pueden perderse**: se pierde, como mucho, la línea del diario en curso y el trabajo hecho desde
  el último punto de control (la última etapa o el último músico terminado).
- Un apagado repentino del sistema (`session-end`/`shutdown`) da al proceso muy poco tiempo: el marcado de «interrumpida»
  es síncrono y casi siempre llega, pero la copia extra del proyecto es **best effort** (si el sistema mata el proceso antes,
  queda la copia de la última etapa o músico).
- Si **ni siquiera** llega el marcado, el diario queda «en curso» sin señal de vida: se detecta igual (ver §4).
- La copia del proyecto guarda la estructura (pistas, clips, notas, mezcla, plugins). El **audio grabado** vive en la
  carpeta de medios del proyecto y no se duplica en el punto de control.
- Al reanudar, el reloj de presupuesto/límite de P **empieza de cero** (la interrupción no es culpa del modelo); el
  tiempo previo queda en el diario.
- Un músico a medias no se retoma «por la mitad de su turno de modelo»: se **mide su completitud** y, si le faltan
  secciones, vuelve a trabajar con el mismo mensaje de «tu parte está INCOMPLETA» de siempre.
- Dos ventanas pueden ver la tarjeta, pero solo una puede reanudar (candado de archivo, §6).
- Sin Electron (web) no hay diario ni puntos de control: todo degrada a «no hacer nada» sin romper la producción.

## 2. Diario de producción (event-sourcing)

Archivo JSON-lines por producción: `%APPDATA%\JasWave\producciones\<proyectoId>\<runId>.jsonl`
(`JASWAVE_PRODUCCIONES_DIR` lo cambia). Lo escribe el **proceso principal** por IPC (`produccion-anexar`) con
`append` + `fsync` en cada línea; el renderer solo pasa identificadores (`[A-Za-z0-9_-]{1,80}`), nunca rutas.
Tope de 20 MB por diario. Se conservan las **10 últimas producciones por proyecto** (se poda al iniciar una nueva).

Cada línea: `{"v":1,"t":<ms epoch>,"k":"<tipo>", …}`.

| `k` | Contenido |
|---|---|
| `inicio` | `runId`, `proyectoId`, `pedido`, `config` (reintentos, si reanuda…), `participantes`, `reanudaDe?` |
| `evento` | un `EventoProduccion` del harness (etapas, plan/hoja, encargos, informes, músico terminado, mediciones, devoluciones, ensayo, QA, notas del usuario, tiempos, omisiones por tiempo, máster mínimo) y, en las mediciones, la `huella` de la revisión del proyecto. **No** se registra cada paso de cada agente (`agente`): serían miles de líneas sin valor para reanudar. |
| `estado` | `en_curso` · `pausada_red` · `detenida` · `completada` · `interrumpida` (+ `motivo`) |
| `vida` | señal de vida cada **15 s** (con la etapa actual) |
| `control` | punto de control del proyecto guardado: `que` (`etapa:mezcla`, `musico:bat`…), `huella` SHA-256 y archivo |

**Lectura tolerante** (`parsearDiario`): una última línea cortada se descarta (`truncada: true`); una línea dañada en
medio se cuenta y se salta. **Estado efectivo**: «en curso» o «pausada por red» con más de **90 s** sin ningún registro
(`UMBRAL_INTERRUMPIDA_MS`) = interrumpida. Una señal de vida posterior a un «interrumpida» (suspensión que no mató la app)
devuelve la producción a «en curso».

Una producción **reanudada escribe su propio diario nuevo**, autosuficiente: el harness vuelve a emitir plan, hoja,
encargos, informes y músicos terminados restaurados, de modo que se puede reanudar otra vez, y otra.

Código: `ai-harness/src/agente/diario.ts` (formato, parseo, reconstrucción; puro), `jas-wave/electron/produccion-diario.ts`
(disco), `jas-wave/src/lib/produccion-resiliente.ts` (escritor `DiarioProduccion`, búsqueda de interrumpidas).

## 3. Puntos de control del proyecto

`%APPDATA%\JasWave\recuperacion\<proyectoId>\punto-{0,1,2}.json` (`JASWAVE_RECUPERACION_DIR`). Se guarda uno al terminar
**cada etapa y cada músico** (`alPuntoDeControl` del harness) y en el autosave de proyectos sin ruta, avisos de memoria y
cierres de emergencia.

- **Escritura atómica**: archivo temporal + `fsync` + renombrado; nunca queda un archivo a medias en su sitio.
- **3 copias rotativas**: la ranura es `seq % 3`; siempre hay las 2 anteriores.
- **Formato**: primera línea = cabecera JSON (`seq`, `t`, `que`, `huella`, `bytes`); el resto, el proyecto.
- **Carga verificada**: se lee la más reciente, se comprueba el SHA-256 y que el JSON parsee; si no, cae a la anterior
  (`usoCopiaAnterior: true`). Si todas están dañadas, no se inventa nada.
- La huella se registra en el diario (`control`) y en las mediciones va la de la revisión del proyecto.

## 4. Detección y reanudación

`ejecutarProduccion({ reanudar })` recibe un `EstadoProduccionGuardado` reconstruido del diario (`reconstruirEstado`):
pedido, plan, hoja de ruta, encargos, informes de etapa, etapas completas, músicos terminados, notas del usuario.

- **Etapas completas se saltan** (plan, dirección, grabación, ensayo, coherencia, revisión de partes, mezcla, máster y
  sus revisiones); no se vuelve a llamar al planificador ni al director.
- **Músicos**: cada uno mide primero su completitud (`completitud`/`seccionesFaltantes`); el que está completo no
  vuelve a escribir, el incompleto retoma lo que le falta. Nunca se duplican clips ni pistas (las escrituras son
  idempotentes: `midi.clip.create` sobre un tramo ocupado reescribe).
- **Coherencia**: se vuelve a medir (solo se corrige si la medición falla). Mezcla y máster retoman donde estaban.
- **Estilo del usuario**: no se reaplica a músicos ya terminados (sería humanizar dos veces).
- **UI**: la tarjeta del panel de la banda (`ui/tarjeta-reanudar.tsx`) y la línea compacta del chat. «Reanudar» envía
  `/banda reanudar <runId>` al chat; «Reanudar desde la última copia» añade `copia` y restaura primero el proyecto
  desde el último punto de control válido. «Descartar» marca la producción como detenida y deja de ofrecerla.
- La producción más reciente manda: si la última terminó bien o la detuvo el usuario, no se ofrece nada.

## 5. Pausa por falta de red

`chatDelMotor(..., { red })` (`motor/turno/chat-agente.ts`). Si la petición falla con `connection` (o `timeout` estando
sin red) **no se gasta un reintento**: `esperarConexion` (`ai-harness/src/agente/red.ts`) espera a `navigator.onLine` **y**
a un sondeo real del backend (`salud()`), cada **10 s** o antes si salta el evento `online`. El panel muestra el aviso,
el diario pasa a `pausada_red` (con señal de vida) y, al volver, a `en_curso`; la **misma petición** se repite. Detener
(`AbortSignal`) la corta. Los reintentos por saturación del servicio (`service_unavailable`, `rate_limit`…) siguen como
estaban (`ESPERAS_REINTENTO_BANDA`).

**Sin repetir lo ya hecho**: tras una pausa, las llamadas de herramienta que ya se entregaron al agente (misma
herramienta, mismo id y mismos argumentos) se descartan si el modelo las devuelve otra vez.

## 6. Dos reanudaciones a la vez

Quien reanuda toma un candado de archivo (`<runId>.lock`, creación exclusiva) con `pid` y hora. Otra ventana o instancia
ve «Esa producción ya se está reanudando en otra ventana». Un candado se considera abandonado si su `pid` ya no existe o
tiene más de 5 min. Se suelta al terminar (o por excepción).

## 7. Cierres, caídas y memoria (`electron/produccion-main.ts`)

- `before-quit` (ya confirmado), ventana `session-end` y `powerMonitor` `shutdown`: `cierreDeEmergencia` →
  `marcarInterrumpidas` (síncrono) y aviso al renderer para una copia extra. `suspend` solo pide la copia: al volver, la
  producción sigue.
- `render-process-gone`: marca interrumpidas, recarga la ventana (tope 3 en 5 min). `unresponsive`: a los 45 s pregunta.
- Memoria (`vigilancia-memoria.ts`, pura): `appBytes` (de `app.getAppMetrics`), RAM libre y total. `alta`: < 1 GB libres,
  < 10 % o la app se come > 80 % de lo disponible con < 2 GB libres; `crítica`: < 0,4 GB o < 4 %. Aviso como mucho cada
  5 min o al cambiar de nivel.

## 8. Después del límite de tiempo (decisión de calidad)

P omitía mezcla y máster pasado `limiteMs`. Ahora la mezcla del modelo se sigue omitiendo, pero **siempre** se ejecuta
un **máster mínimo determinista**, sin modelo (`motor/turno/master-minimo.ts`): `master.normalizar` a −14 LUFS y después
`mix.limit` en el máster con techo de −1 dBTP, más una medición final informativa. Se informa en el resumen
(«Se aplicó un máster mínimo automático…») y queda como informe de la etapa `master`. También se aplica si no hay
participante de máster.

## 9. Turno normal del agente (`jaswave-agente`)

Versión ligera sobre lo que ya existía (`findInterruptedRuns`, que marca como interrumpidos los turnos «running» al
recargar y guarda `executedCallKeys`): el mensaje del chat dice ahora «El turno anterior se interrumpió después de
aplicar N cambios, que se conservan» (o «antes de aplicar ningún cambio»), y la barra ofrece **Reanudar** (el motor no
repite las llamadas ya ejecutadas), **Reintentar mensaje** (vuelve a enviar el texto) y **Descartar**. Para el turno de
la banda interrumpido, el mensaje remite al panel de la banda.

## 10. Pruebas

| Dónde | Qué cubre |
|---|---|
| `ai-harness/src/test/agente-reanudacion.test.ts` (Vitest) | formato y truncado; estado efectivo (90 s); **caída tras cada punto de control y al empezar cada etapa**, con proyecto restaurado del último punto: mismo resultado, sin duplicados, sin repetir plan/reparto/grabación; diario de una reanudada reutilizable; máster mínimo tras el límite; espera de red (vuelve, se detiene, sondeo caído). |
| `jas-wave/electron/produccion-diario.test.ts` (node:test, **disco real** en carpeta temporal) | rutas validadas y variables de entorno; append/lectura/última línea cortada; cierre de emergencia; poda a 10; candado (dos reanudaciones, caducidad); 3 copias rotativas; copia corrupta (truncada o con huella distinta) → anterior; sin ruta; memoria; muerte tras puntos de control con producción real contra el disco; diario truncado + punto corrupto. |
| `jas-wave/src/lib/produccion-resiliente.test.ts` | escritor del diario (orden, vida, huella), detección de interrumpidas y descarte, punto de control sin ruta y restauración, avisos de emergencia/memoria. |
| `plugins/com.jaswave.modulo.asistente-ia/test/resiliencia-ia.test.ts` | pausa por red en `chatDelMotor` (sin gastar reintentos, Detener, sin repetir llamadas), máster mínimo, pausa en el panel, reintento de la medición si cae el host. |

Notas: la matriz completa de caídas (todos los puntos) corre en Vitest con memoria; en disco real se muestrean para que
el `fsync` de Windows no alargue la suite. «Muerte del renderer» y «apagado con producción en curso» se prueban a nivel de
almacén (`marcarInterrumpidas` + reanudación); los manejadores de Electron (`render-process-gone`, `session-end`,
`powerMonitor`) no se pueden ejecutar sin una app real: están en `produccion-main.ts`, que solo cablea esos eventos.

## 11. Cómo probar a mano (matar el proceso con la banda trabajando)

1. Abre un proyecto (con o sin guardar) y pide `/banda …`.
2. Cuando esté en «Los músicos graban», mata el proceso: `taskkill /F /IM JasWave.exe` (o `Stop-Process -Name JasWave -Force`).
3. Mira el diario: `%APPDATA%\JasWave\producciones\<proyectoId>\<runId>.jsonl` (última línea posiblemente cortada) y
   `%APPDATA%\JasWave\recuperacion\<proyectoId>\punto-*.json`.
4. Abre la app y el proyecto. Pasados 90 s desde la última señal de vida aparece la tarjeta «La producción se interrumpió
   en la grabación hace … · plan listo, N encargos repartidos, M de N músicos terminaron su parte».
5. Pulsa **Reanudar**: los músicos con la parte completa no escriben de nuevo; los incompletos retoman lo que falta;
   luego coherencia, mezcla y máster. Comprueba que no hay clips duplicados.
6. Corta internet (desactiva la red) en mitad de la producción: aparece «Sin conexión a internet…»; vuelve la red y sigue sola.
7. Daña a mano `punto-<n>.json` (cambia un carácter) y usa «Reanudar desde la última copia»: debe usar la anterior.
8. Con la banda trabajando, cierra sesión de Windows: al volver, la producción aparece como interrumpida.
