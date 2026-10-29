# P — Velocidad de producción (una canción completa en ≤ 15 min, nunca más de 30)

> Estado: implementado y probado con reloj y chat simulados (sin modelo real, sin gasto). Pendiente: una pasada real (ver «Qué validar»).
> Continúa el plan [N](N-eficiencia-ia.md) (tokens y peticiones); aquí se ataca el **reloj**.

## 1. Datos de partida (reales, `ConsumoIA`, últimos 14 días)

Script: `backend/scripts/_tmp/latencias-ia.ts` (`npx tsx --env-file=.env scripts/_tmp/latencias-ia.ts` en `backend/`; solo agrega
latencias y recuentos, no imprime claves ni textos).

Latencia por petición del agente (`proposito = agent`, todas con éxito):

| modelo | peticiones | p50 | p90 | p95 | máx |
|---|---|---|---|---|---|
| nvidia/nemotron-3.5-super-vl:free | 5.150 | 3,3 s | 11,1 s | 13,7 s | 79 s |
| nvidia/nemotron-3.5-lightning:free | 916 | 12,8 s | 22,0 s | 29,0 s | 65 s |
| deepseek/deepseek-v4.1-flash | 701 | 1,3 s | 5,6 s | 7,6 s | 19 s |
| anthropic/claude-haiku-5.5 | 180 | 2,5 s | 6,4 s | 7,1 s | 8 s |
| reflection/beam-free | 62 | 19,9 s | 30,1 s | 38,5 s | 48 s |

Sesiones de agente (peticiones separadas por < 8 min) con ≥ 40 peticiones, las que hoy cuentan como «una canción»:

| sesión (UTC) | duración | peticiones | reloj por petición |
|---|---|---|---|
| 28-oct 13:34 | 16 min | 180 | 5,5 s |
| 28-oct 19:58 | 15 min | 284 | 3,3 s |
| 28-oct 21:08 | 62 min | 462 | 8,1 s |
| 28-oct 22:22 | 36 min | 480 | 4,4 s |
| 28-oct 23:06 | 38 min | 554 | 4,1 s |
| 29-oct 00:04 | 100 min | 903 | 6,7 s |
| 29-oct 04:13 | 94 min | 463 | 12,2 s |
| 29-oct 08:27 | 87 min | 481 | 10,9 s |
| 29-oct 13:19 | 78 min | 495 | 9,4 s |
| 29-oct 15:24 | 83 min | 549 | 9,0 s |
| 29-oct 17:30 (Haiku/DeepSeek) | 65 min | 644 | 6,1 s |

Lectura, con los datos y no con suposiciones:

1. **El reloj lo manda el número de peticiones, no la latencia de cada una.** La pasada limpia (180 peticiones) tarda 16–22 min;
   las que entran en bucles hacen 450–900 peticiones y tardan 60–100 min **con los mismos modelos**. La latencia por petición
   (3–12 s de reloj) es parecida en ambas.
2. Con p50 de 3,3 s y p90 de 11 s del modelo «rápido», `cubrirTrasMs = 10 s` ya cubría al ~p88: el margen estaba en los modelos que
   responden en < 6 s (DeepSeek, Haiku), que esperaban 10 s antes de duplicar la petición.
3. La traza `[banda]` de las pasadas 14 y 16 muestra el patrón arreglista → mezcla → revisión de mezcla → mezcla…: la medición salía
   vacía y la revisión repetía la misma ronda con la misma medición (el bucle que ahora se corta).
4. Nemotron Ultra («profundo») **no aparece** en las 7.210 peticiones de `agent` de estos 14 días: `agent` cae en la preferencia
   general `rapido → creativo → profundo` (`PREFERENCIA_GENERAL`), así que «profundo» solo entra como último recurso. No hizo falta
   cambiar el enrutado (y `modelos-gratis.ts` no se toca).

Peticiones por etapa (simulación del plan N, 11 músicos / 10 secciones; sin tiempos porque antes no se medían):

| etapa | antes (N) | tras N | reloj estimado tras N (≈ 7 s/pet., músicos en paralelo) |
|---|---|---|---|
| plan + dirección | 5 | 5 | ≈ 1 min |
| músicos (+ reintentos por completitud) | 90 | ≈ 80 | 5–7 min (2 oleadas × 5–8 pasos × ≈ 7 s, en paralelo) |
| ensayo | 33 | 0 si la coherencia aprueba | 0–3 min |
| arreglista | 4 | 0 si aprueba | 0–4 min |
| QA partes / mezcla / máster | 42 | 0 si la medición aprueba | 0–4 min |
| mezcla + máster | 5 | 5 | 1–3 min |
| mediciones nativas | 2–6 renders | 2–6 | 1–6 min (no medido; ver §4) |

> A partir de ahora **cada pasada real registra su propia tabla** (§2): sustituye las estimaciones de la última columna.

## 2. Instrumentación (hecho)

- `ai-harness/src/agente/tiempos.ts` (nuevo): `crearCronometro(reloj)` (pila de etapas: el tiempo de una etapa anidada se resta de la que
  la contiene; las peticiones se cuentan en la etapa en curso), `resumenTiempos`, `formatearDuracion`, tipos `TiemposProduccion`,
  `Omision`. Reloj inyectable.
- `ejecutarProduccion` mide: plan, dirección, músicos (incluye las regrabaciones que piden mezcla/máster/arreglista), ensayo (incluye
  su regrabación), coherencia, revisión de partes, mezcla, revisión de mezcla, máster, revisión de máster; cuenta peticiones al
  modelo por etapa y cronometra **cada medición del host** (`medirHost`).
- Eventos nuevos de `EventoProduccion`: `tiempo` (por etapa o tramo), `medicion` (etapa, ms, ok|null), `omitido` (qué, motivo, texto) y
  `tiempos` (todo, al terminar). `ResultadoProduccionAgentes.tiempos` lleva lo mismo.
- Resumen final de la banda: línea `Tiempos: plan 40 s (2 pet.) · músicos 6 min (78 pet.) · … · total 14 min (105 peticiones).` y, si
  se recortó algo, `Para entregar a tiempo (16 min): se omitió el ensayo por tiempo; …`.
- Consola del módulo (`turno-banda.ts`): `[tiempos] …` con las mediciones (etapa, duración, fuera de objetivo / no medible) y lo omitido.
  El e2e 29 la imprime junto a `[banda]` (`jas-wave/e2e/29-cancion-completa-ia.spec.ts`, filtro de `consoleErrors`).
- SDK regenerado (`npm run sdk:generar` en `plugins/`); `api-host.ts` exporta `formatearDuracion`, `resumenTiempos` y `TiemposProduccion`.

## 3. Presupuesto de tiempo con degradación ordenada (hecho)

`ConfigProduccion.presupuestoMs` (15 min) y `limiteMs` (30 min), `reloj` inyectable. `Infinity` desactiva cada uno. Entre ambos hay una
**ventana**; cada refinamiento se sacrifica al consumirse una fracción de ella (con los valores por defecto):

| qué se omite | cuándo (fracción de la ventana) | por defecto |
|---|---|---|
| ensayo | 0 % (al agotar el presupuesto) | 15 min |
| revisión de partes por el modelo (queda la medición del host, sin rondas) | 0 % | 15 min |
| rondas extra del arreglista (máximo 1) | 20 % | 18 min |
| segunda ronda de corrección de mezcla/máster | 40 % | 21 min |
| revisión de la mezcla (y su render nativo) | 60 % | 24 min |
| **límite**: sin mezcla ni máster ni devoluciones; reintentos de completitud limitados a 1; se mide el máster y se entrega | 100 % | 30 min |

- Nunca se saltan: la grabación de los músicos (y su primer reintento por completitud) y la medición final (si el máster no se midió,
  `qa_master` se mide al final y su resultado entra en el informe).
- Cada salto va al resumen («se omitió el ensayo por tiempo», «… por superar el límite de tiempo») y como evento `omitido`.
- Pasar el límite deja `estado: 'con_avisos'` (no `fallo`): lo grabado queda entero.
- Pruebas: `ai-harness/src/test/agente-tiempos.test.ts` (reloj falso: orden de degradación, límite con medición final, tiempos emitidos,
  cronómetro anidado, formatos).

## 4. Cuellos de botella (verificados con datos)

(a) **Rondas y bucles sin progreso** — hecho. Se cortan cuando dos revisiones seguidas dan **la misma firma** (misma medición del host
y mismos problemas) tras una corrección: ronda del arreglista (`rondas del arreglista`), revisión de partes/mezcla/máster
(`qa_*`), con evento `omitido` motivo `sin_progreso`. Es el corte de los bucles de las pasadas 14 y 16. Topes ya existentes que se
mantienen: `maxRondasQA` (2), `MAX_DEVOLUCIONES_POR_ETAPA` (1), `MAX_REINTENTOS_COMPLETITUD` (3), `RONDAS_COHERENCIA` (2).
Dos pruebas que dependían de repetir la misma ronda se actualizaron (`agente-produccion.test.ts`, `agent-engine-host.test.ts`).

(b) **Mediciones nativas** — hecho en el módulo (`turno-banda.ts` → `medirBanda`):
- Caché por **huella** = `getStateRevision` + hash de lo que esa revisión no ve (notas con altura/inicio/duración/velocidad, volumen,
  paneo, mute/solo, envíos, parámetros de plugins, máster, enrutado) + rango (`todo`). Mezcla → revisión de mezcla → máster → revisión de
  máster ya no renderizan otra vez si nada cambió; la escucha en vivo solo se pausa cuando de verdad se renderiza. Las mediciones
  fallidas no se guardan. Prueba: `test/medicion-cache.test.ts` (6 casos).
- La revisión del proyecto por sí sola **no** servía de clave: no cambia con volumen, paneo, EQ ni con editar una nota sin cambiar cuántas hay
  (lo probamos). Por eso la huella propia.
- Tiempo máximo por medición `MAX_MS_MEDICION` = 3 min con respaldo: la última medición válida o «no medible» (nunca un fallo inventado).
  Limitación: el render que se cuelga sigue en la cola nativa; solo se deja de esperarlo.
- **No hecho**: ventana más corta «solo nivel/picos». `analysis.mix` renderiza toda la canción y su proveedor
  (`analysis-render-native.ts`, `render-lock*.ts`) está siendo modificado por la pasada real en curso; se deja anotado para después.

(c) **Paralelismo** — hecho. Los músicos de una oleada ya iban en paralelo, pero la segunda oleada esperaba a que la base **terminara
también sus reintentos por completitud** (1–3 pasadas más). Ahora arranca en cuanto la base acaba su primera pasada y los reintentos
corren a la vez (`solaparOleadas`, por defecto activo; `false` = comportamiento anterior). Coste: el resto oye la base sin los reintentos
(la base incompleta rara vez cambia lo que necesitan oír). Mezcla por lotes: `INSTRUCCIONES_ROL.mezcla` ahora exige agrupar en un solo
paso las llamadas independientes de todas las pistas (el límite es 24 escrituras por paso: `MAX_ESCRITURAS_POR_PASO`); el runtime ya
las ejecutaba juntas, faltaba pedirlo. Cada paso evitado = una espera de 3–12 s.

(d) **Enrutador** — hecho (`backend/src/ia/jaswave/enrutador.ts`). Latencias recordadas por modelo (últimas 40 respuestas útiles); con ≥ 8
muestras la cobertura salta al **p90 observado de ese modelo**, acotada entre 3 s y el tope configurado (`cubrirTrasMs`: 6/10/14 s).
Efecto: DeepSeek (p90 5,6 s) y Haiku (6,4 s) cubren a ~6 s en vez de 10 s; los modelos lentos conservan el tope. Pruebas en
`test/ia-enrutador.test.ts`. Nemotron Ultra: `agent` no lo usa de primero (ver §1.4); no se tocó el enrutado por propósito.

(e) **Pasos por agente** — hecho, con riesgo (ver §6): `PASOS_POR_ROL` musico 36→32, coherencia 40→24, qa 14→10, mezcla 24→16, master
14→10. Un arreglista de 40 pasos × 10 s era 6–7 min por ronda. La guardia de repeticiones del runtime (idénticas lecturas ≤ 2, escrituras
idénticas 1, 5 fallos seguidos de una herramienta) ya existía y se mantiene.

(f) **Huecos entre etapas** — revisado: no hay `sleep` ni esperas fijas entre etapas. Lo que había: (1) los reintentos por servicio saturado
de la banda sumaban ≈ 7 min por petición (`ESPERAS_REINTENTO_BANDA` 4+12+30+60+120+180 s) → ahora 3+8+20+45+90 s ≈ 2 min 46 s;
(2) pausar/reanudar la escucha en vivo alrededor de **cada** medición, incluso las de caché o las que no renderizan → ahora solo en el
render real; (3) la espera de 500 ms/200 ms de la escucha en vivo es de su propio hilo y no bloquea a los agentes.

## 5. Antes / después (estimado; hay que validarlo con una pasada real)

| caso | antes | después (estimado) |
|---|---|---|
| todo a la primera, Haiku/DeepSeek | 16–22 min, 180 peticiones | 12–15 min (oleadas solapadas, cobertura al p90, menos pasos de refinamiento) |
| bucle de QA/mezcla/arreglista, modelos gratuitos | 60–100 min, 450–900 peticiones | ≤ 18–24 min: bucles cortados por «sin progreso», refinamientos sacrificados desde el min 15 |
| medición nativa vacía o colgada | indefinido (bucle) | ≤ 3 min por medición y respaldo; sin repetir si no cambió |
| peor caso | > 100 min | ≈ 30 min (+ lo que dure el último paso en curso al llegar al límite) |

El límite se evalúa **entre** pasos del flujo, no dentro de un agente: un agente que empieza a los 29 min puede tardar sus pasos
(máx. 32 × latencia). Por eso la grabación es lo último que consume tiempo y los demás pasos tienen 10–24 pasos.

## 6. Riesgos

- **Calidad por tiempo**: con modelos lentos la canción se entrega sin ensayo ni revisión del modelo (se informa). Subir
  `presupuestoMs`/`limiteMs` (`Infinity`) restituye el comportamiento anterior; `solaparOleadas: false` y `PASOS_POR_ROL` son constantes
  en `produccion.ts`.
- **Pasos reducidos**: un arreglista o una mezcla con muchas pistas puede quedarse a medias con 24/16 pasos; el siguiente chequeo
  (medición) lo vuelve a señalar, pero cuesta una ronda. Si la pasada real lo muestra, subir `coherencia` a 30 / `mezcla` a 20.
- **Pasado el límite no hay mezcla ni máster** (decisión literal del encargo: «directo a la entrega con lo que hay»): la canción sale con
  los faders por defecto y sin limitador; el resumen lo dice y mide el máster. Alternativa si molesta: dejar una pasada corta (8 pasos)
  de mezcla/máster también tras el límite.
- **Caché de medición**: si algo que cambia el audio no está en la huella (p. ej. un parámetro de plugin fuera de `tracks[].plugins`),
  se reutilizaría una medición vieja. Cubre pistas (excepto clips, hasheados aparte), máster y enrutado.
- **Cobertura adaptativa**: más peticiones duplicadas (coste) en modelos con cola larga; acotado a 2 en paralelo (`maxParalelo`).
- «Sin progreso» compara texto: una medición que oscila entre dos valores no se detecta (la acota `maxRondasQA`).

## 7. Qué validar con una pasada real

1. e2e 29 con el modelo habitual: leer la línea `[tiempos]` y el resumen «Tiempos: …» → rellenar la tabla de §1 con minutos reales por
   etapa. Esperado: total ≤ 15 min con Haiku/DeepSeek; ≤ 30 min con gratuitos.
2. `[tiempos] … Mediciones: …`: cuántos renders nativos y cuánto tardó cada uno (decide si merece la pena la ventana corta de nivel/picos).
3. Que ninguna pista quede vacía tras la segunda oleada solapada y que `completitud` siga cerrando la base.
4. Que el resumen enumere lo omitido y que el estado sea `con_avisos` solo cuando se superó el límite o falló algo real.
5. Latencias del enrutador: `latenciaPercentil(modelo)` tras la pasada (no se expone aún en el panel admin; sale por depuración).

## 8. Archivos tocados

- `ai-harness/src/agente/tiempos.ts` (nuevo), `produccion.ts`, `index.ts`; tests `src/test/agente-tiempos.test.ts` (nuevo),
  `agente-produccion.test.ts` (una prueba ajustada). SDK regenerado.
- Módulo asistente: `src/motor/turno/turno-banda.ts` (caché y límite de mediciones, `[tiempos]`), `turno/chat-agente.ts` (esperas),
  tests `test/medicion-cache.test.ts` (nuevo), `agent-engine-host.test.ts` (una aserción).
- `jas-wave/src/modulos/api-host.ts` (exportaciones), `jas-wave/e2e/29-cancion-completa-ia.spec.ts` (imprime `[tiempos]`).
- Backend: `src/ia/jaswave/enrutador.ts`, `test/ia-enrutador.test.ts`, `scripts/_tmp/latencias-ia.ts` (temporal, ignorado por git).

## Notas de traspaso

- Verificado: ai-harness 335 tests + typecheck; módulo typecheck + `npm test` (144 tests, tras ajustar 1 aserción); backend typecheck +
  `ia-enrutador`; `tsc -b --noEmit` de jas-wave. No se ejecutaron e2e ni builds ni despliegues (hay una pasada real en curso).
- Para activar en la app hay que **reconstruir el módulo asistente** (usa `ejecutarProduccion` y `medirBanda`) y reiniciar el backend
  (enrutador). Nada de esto toca los archivos nativos de medición.
- Siguiente: ventana corta de nivel/picos en `analysis.mix` cuando termine la pasada real; exponer `latenciaPercentil` en el panel admin;
  afinar `PASOS_POR_ROL` y los umbrales de la ventana (0/20/40/60 %) con los tiempos reales.
