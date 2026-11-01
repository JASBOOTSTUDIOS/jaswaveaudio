# N — Eficiencia de la IA (menos tokens y dinero sin perder calidad) y armonía al escribir

> Estado: implementado y probado con chat simulado (sin modelo real). Pendiente: una pasada real (ver «Qué validar»).

## 1. Cómo se mide (reproducible, sin gastar dinero)

- Simulación: `plugins/com.jaswave.modulo.asistente-ia/test/ayuda/simulacion-banda.ts`. Usa el **catálogo real**
  (`catalogoAgente`), el **`ejecutarProduccion` real**, el **tool runner real** (`runRegisteredTool`) y una tienda real;
  solo el «modelo» es un guion determinista (11 músicos, 10 secciones, 68 compases). Registra lo que `cfg.chat`
  enviaría: sistema, esquemas de herramientas, historial; tokens ≈ caracteres / 3,5.
- Prueba: `test/eficiencia-ia.test.ts` (≈ 1 min). `EFICIENCIA_INFORME=ruta.json` guarda el detalle (incluye muestras de
  sistema y tamaño de cada esquema). Ejecutar con
  `npx tsx --tsconfig ../sdk/host-sdk/pruebas/tsconfig.pruebas.json --test test/eficiencia-ia.test.ts`.
- `ahorro: false` en `ConfigProduccion` reproduce el comportamiento anterior (es la fila «antes»). Cada palanca se activa
  sola para medir su efecto por separado.
- Guarda de equivalencia (la prueba falla si no se cumple): mismas escrituras (herramienta + argumentos), misma
  cobertura de secciones por pista y misma medición final de coherencia en todas las variantes sin guardia de armonía; con
  guardia, misma **estructura** (inicio/duración de cada nota, clips) y coherencia en verde.

Limitación honesta: la simulación da ≈ 7,5 k tokens de entrada por petición; la realidad medida es ≈ 25 k (clips con
más notas, más pasos por músico, contexto del proyecto de 3.000 car., habilidades y notas del usuario). Los **porcentajes**
son extrapolables; las cifras absolutas, no.

## 2. Dónde se iba el 98 % (datos de la simulación, línea base)

Entrada total 1,35 M tokens en 179 peticiones.

| etapa | peticiones | tokens entrada | sistema | herramientas | historial | herr./petición |
|---|---|---|---|---|---|---|
| plan | 2 | 4.384 | 1.674 | 1.947 | 763 | 10,0 |
| dirección | 3 | 16.215 | 4.060 | 9.211 | 2.943 | 26,0 |
| músicos | 78 | 767.597 | 173.486 | 214.680 | 379.431 | 23,6 |
| músicos (reintento por completitud) | 12 | 110.665 | 27.607 | 35.931 | 47.127 | 24,0 |
| ensayo | 33 | 158.009 | 75.057 | 33.459 | 49.494 | 11,2 |
| coherencia (arreglista) | 4 | 20.166 | 8.385 | 9.515 | 2.265 | 21,0 |
| QA partes | 14 | 82.357 | 26.109 | 14.804 | 41.444 | 13,0 |
| mezcla | 3 | 16.211 | 5.900 | 7.951 | 2.360 | 26,0 |
| QA mezcla | 14 | 81.413 | 26.109 | 14.688 | 40.616 | 13,0 |
| máster | 2 | 8.987 | 3.729 | 5.005 | 253 | 25,0 |
| QA máster | 14 | 81.789 | 26.109 | 15.216 | 40.464 | 13,0 |

Conclusiones sobre las hipótesis:

- (a) Herramientas: el 16 % de la entrada. Cada músico veía **24 herramientas** (7 de oficio + 5 base + las ~12 que
  `seleccionarIniciales` elegía comparando palabras del pedido, p. ej. `mix.eq` porque el encargo decía «piano»). Los esquemas
  no son verbosos (≈ 300 car. cada uno): el problema era la cantidad.
- (b) Prefijo: dentro de la misma ejecución de un agente el prefijo YA era estable (sistema fijo, herramientas fijas,
  historial que solo crece); ≈ 66 % de lo enviado es prefijo repetido. Lo que faltaba era **decírselo al proveedor**:
  Anthropic vía OpenRouter no cachea sin `cache_control`. DeepSeek cachea el prefijo solo.
- (c) Historial: **50 % de la entrada de los músicos** (379 k de 768 k). Son sobre todo las listas de notas de las últimas
  llamadas de escritura y los resultados de lectura acumulados.
- (e) Etapas de LLM sustituibles por medición: ensayo (33 peticiones), QA de partes/mezcla/máster (42) = 24 % de la entrada
  y no aportan nada cuando la medición determinista ya aprueba.
- Hallazgo de calidad (bug): `MAX_ENCARGOS = 8` **cortaba a 8 los encargos** de una banda de 11: tres músicos no recibían
  encargo y sus pistas quedaban vacías. Subido a 16 (test en `agente-ahorro.test.ts`).

## 3. Qué se cambió (y su efecto medido por separado)

Todas las palancas son opcionales en `ConfigProduccion.ahorro` (`boolean | Partial<AhorroProduccion>`, por defecto todas
activas). Tabla «aislada» = solo esa palanca activa frente a «antes» (negativo = gasta más).

| palanca | qué hace | entrada total | peticiones |
|---|---|---|---|
| antes | comportamiento anterior (`ahorro:false`, sin guardia) | 1.347.792 | 179 |
| `herramientasPorRol` | cada rol ve solo sus herramientas de oficio + base (13–15 en vez de 24; tope 8 por relevancia si el rol no tiene lista). `buscar_herramientas` sigue disponible. | −10,3 % | 179 |
| `resultados` | historial: resultados de herramientas antiguos (más allá de los 6 últimos) recortados a 400 car.; solo 2 llamadas completas (antes 3); acuse mínimo en escrituras correctas (solo ids/avisos/diagnóstico) | −6,8 % | 179 |
| `diagnostico` | el resultado de cada `midi.*` de escritura del músico incluye un diagnóstico determinista de SU pista (1 línea si está bien) | **+4,7 %** (coste del texto en historial) | 179 |
| `ensayoLimpio` | sin ensayo si `coherencia` ya aprueba (por sí sola no dispara: en la simulación hay defectos de armonía, ver armonía) | −0,1 % | 179 |
| `qaMedible` | mezcla y máster: si `medir()` aprueba, no se llama al QA (modelo) | **−12,1 %** | 151 |
| `qaPartesLimpias` | QA de partes omitido si medición + coherencia + completitud aprueban | −0,1 % (idem) | 179 |
| armonía al escribir, `auto` | ver §4 | +6,6 % (30 escrituras corregidas en el momento) | 180 |
| armonía `ajustar` siempre | ver §4 | +1,6 % | 175 |
| armonía `rechazar` siempre | ver §4 | +18,6 % | 190 |
| **TODO activo** (las 6 palancas + armonía `auto`) | | **−36,4 %** | **105** |

TODO activo, por etapa: músicos 767 k → 725 k, reintentos 111 k → 98 k, **ensayo 158 k → 0**, **arreglista 20 k → 0**,
**QA ×3 245 k → 0**, dirección 16 k → 11 k, mezcla 16 k → 13 k, máster 9 k → 7 k. Total 1,35 M → 0,86 M tokens y de 179 a
105 peticiones (−41 %). Las palancas se suman con efecto cruzado: ensayo y QA solo se omiten porque el guardia de
armonía deja la medición en verde (con las partes «sucias» la medición las manda al arreglista, como debe).

Ahorro esperado en USD (aplicando los porcentajes a lo medido por pasada completa; **estimación**, hay que validarla):

| modelo | antes (medido) | tokens −36 % | + `cache_control` |
|---|---|---|---|
| Haiku 5.5 (0,10/0,50 por M) | ≈ 0,60 USD | ≈ 0,38 USD | ≈ 0,25–0,30 USD si la caché lee ~56 % de la entrada a ~10 % del precio |
| DeepSeek V4.1 Flash (0,045/0,50, caché 0,006) | ≈ 0,55 USD | ≈ 0,35 USD | la caché automática ya actuaba; sin cambio adicional esperado |

Antes de la última tanda las peticiones de salida son ≈ 5 % del coste; el resto es entrada.

### 3.1 Prefijo estable y `cache_control` (backend)

- `backend/src/ia/gateway/ai-tools.ts` + `ai-gateway.ts`: `AiToolRequestPart.cache` y `admiteCachePrompt(req, style)`.
  Solo con herramientas (caso del agente) y solo para Anthropic directo o modelos `claude`/`anthropic` vía OpenRouter:
  - OpenAI-compatible (OpenRouter): el mensaje `system` y el **primer** mensaje `user` (el encargo, estable todo el turno
    del agente) pasan a bloques con `cache_control: {type:'ephemeral'}`. En Anthropic la caché de un punto cubre también
    las herramientas, que van antes.
  - Anthropic nativo: `system` como bloque con `cache_control` y la última herramienta marcada.
  - Cualquier otro modelo (DeepSeek, etc.): el cuerpo no cambia.
  - Test: `backend/test/ia-cache-prompt.test.ts`.
- No se marca el historial creciente (resultados de herramientas) para no arriesgar un 400 por `content` en array en
  mensajes `tool`; es la ampliación natural si la pasada real confirma el ahorro (ver «Siguiente»).
- El orden del `sistema` ya era «estable primero, volátil al final» (instrucciones, habilidades, estilo, plan → notas,
  contexto, encargo). No se reordenó: cambiar la primera línea («Eres X…») rompería las pruebas que la leen y solo
  serviría para compartir prefijo **entre** agentes.

## 4. Armonía al escribir (requisito de calidad del usuario)

`turno/armonia-banda.ts` (nuevo) + `ejecutar` de `turno-banda.ts`. Reglas = las mismas que mide `analizarCoherencia`:

- Primer tiempo y notas largas (≥ 1 beat): notas del acorde del compás (+ 9.ª y 6.ª como color, salvo el bajo). Resto: escala de
  la tonalidad; cromática solo si dura < 0,5 beat en tiempo débil. Bajo: fundamental o nota tras «/» en el primer tiempo.
  Batería/percusión excluidas.
- Cubre `midi.clip.create`, `midi.notes.set`, `midi.createNotes`, `midi.notes.add`, `midi.notes.patch`; entiende las formas
  de nota del modelo (`note/start/duration`, nombres de nota, listas en texto).
- Con notas fuera: `ajustar` (nota permitida más cercana y se informa en `avisos`), `rechazar` (mensaje exacto: «compás 3 (Bm):
  do en beat 8 no pertenece; permitidas: si, re, fa♯…») o `auto` (por defecto: ajusta si ≤ 15 %, rechaza si es más).
  Configurable con `localStorage['jaswave-banda-armonia'] = {"modo":"auto|ajustar|rechazar","maxAjuste":0.15}`.
- El encargo de cada músico lleva la tabla de acordes **distintos de sus secciones** con notas permitidas y ejemplos en su
  registro (`tablaArmoniaMusico`, vía `ConfigProduccion.guiaArmonia`), más «NO SALGAS de estas notas».
- Nuevos hooks opcionales de `ConfigProduccion`: `alDefinirHoja`, `guiaArmonia`, `diagnostico`, `ahorro`.

Decisión con datos (simulación: 3 músicos con notas fuera: 8 %, 8 % y 40 %):

| modo | rondas del arreglista | rechazos | escrituras corregidas | coste de entrada vs antes | medición final |
|---|---|---|---|---|---|
| sin guardia | 4 peticiones, no se resuelve (los 2 intentos del arreglista simulado no corrigen) | 0 | 0 | 0 % | **roja (4 avisos)** |
| `ajustar` siempre | **0** | 0 | 30 | +1,6 % | verde |
| `auto` (≤ 15 %) | **0** | 10 (el músico con 40 %) | 20 | +6,6 % | verde |
| `rechazar` siempre | **0** | 30 | 0 | +18,6 % | verde |

`auto` se queda como defecto: ajusta lo pequeño (conserva la frase) y obliga a reescribir cuando la idea está mal; `ajustar`
es lo más barato si se prefiere no gastar un paso. `rechazar` siempre es el más caro. Rondas de arreglista evitadas en la
producción simulada: **4 peticiones del arreglista + su efecto en cadena** (ensayo, QA y reintentos quedan sin motivo).

## 5. Diagnóstico inmediato en cada escritura (estilo error del compilador)

`diagnosticoEscritura` (coherencia-banda.ts) se añade al resultado de cada `midi.*` del músico: secciones que aún faltan,
notas / duraciones distintas / rango de velocidades (aviso de parte «cuadrada»), y los defectos de tiempo, armonía y rejilla
de SU pista (hasta 3, con compás y acorde). Sin defectos: una línea de ~150 car. Coste aislado +4,7 % de entrada; su valor es
que el modelo corrige en el mismo paso y que la medición deja de necesitar rondas.

## 6. Archivos tocados

- `ai-harness/src/agente/produccion.ts` (ahorro, hooks, omisión de ensayo/QA, `MAX_ENCARGOS`), `runtime.ts` (`vistaHistorial`
  con recorte, `acuseEscritura`, `ahorro`).
- Módulo: `turno/armonia-banda.ts` (nuevo), `turno/coherencia-banda.ts` (`diagnosticoEscritura`, exporta `MAYOR`/`MENOR`),
  `turno/turno-banda.ts` (guardia, hooks, QA ve `midi.notes.get`).
- Backend: `gateway/ai-tools.ts`, `gateway/ai-gateway.ts`.
- Tests: `ai-harness/src/test/agente-ahorro.test.ts`, módulo `test/eficiencia-ia.test.ts`, `test/armonia-banda.test.ts`,
  `test/ayuda/simulacion-banda.ts`, backend `test/ia-cache-prompt.test.ts`. SDK regenerado (`npm run sdk:generar`).
- Verificado: ai-harness 322 tests + typecheck, módulo 138 tests + typecheck, backend typecheck + tests de IA.

## 7. Riesgos

- Omitir el QA «musical» de las partes cuando medición, coherencia y completitud aprueban pierde el juicio subjetivo del
  modelo. Es apagable: `ahorro: { qaPartesLimpias: false }` (y `ensayoLimpio: false` para el ensayo).
- Omitir el ensayo quita propuestas subjetivas entre músicos si todo cuadra por medición.
- Recortar resultados antiguos: si el modelo necesita un dato viejo debe volver a consultarlo (el recorte lo avisa).
- El guardia de armonía puede mover notas (modo `ajustar`/`auto`): el músico lo ve en `avisos`. Una pista con notas largas
  cromáticas intencionadas se rechazará/ajustará; en modo `ajustar` el cambio es silencioso para el usuario final.
- `cache_control`: sin validar contra OpenRouter real. Si un modelo/proveedor rechazara el array de contenido, la petición
  fallaría; el cambio está acotado a `claude`/`anthropic` + herramientas.
- La simulación subestima el tamaño real por petición; los % pueden variar.

## 8. Qué validar con una pasada real

1. Una producción completa con Haiku 5.5: comparar `ConsumoIA` (tokens de entrada por propósito, nº de peticiones) con las
   cifras de la tabla (esperado: ≈ −35 % de entrada y ≈ −40 % de peticiones; los tokens de caché leídos > 0 en el panel de
   OpenRouter si `cache_control` funciona).
2. Que ninguna pista quede vacía en una banda de 11 (arreglo de `MAX_ENCARGOS`).
3. Calidad: escuchar si el modo `auto` (≤ 15 % de ajuste) conserva la frase; si molesta, `maxAjuste` más bajo o `rechazar`.
4. Que el arreglista y el QA de partes se omiten solo cuando todo cuadra (la traza `[banda]` lo muestra).

## 9. Siguiente (no hecho)

- Enrutado por rol/propósito: `EngineChatPurpose` (ai-harness `engine/chat.ts`) es una unión cerrada; para enviar
  QA/máster/mezcla al modelo rápido y músicos/arreglista al creativo hay que ampliarla y añadir entradas a
  `PREFERENCIA_POR_PROPOSITO` (`backend/.../servicio.ts`); hoy todo `agent` cae en «rápido primero».
- Marcar el historial para caché (último mensaje `tool`) tras validar el formato en OpenRouter.
- Compartir prefijo entre los 11 músicos (línea «Eres X…» después del bloque común) cuando las pruebas dejen de depender de
  ella.
- Ediciones pequeñas: `midi.notes.patch` por rango (`rangeStart/rangeEnd`) ya permite reemplazar una sección sin reenviar la
  pista; falta empujar a los músicos y al ensayo a usarlo en lugar de `midi.notes.set` completo en las regrabaciones.
- Recortar instrucciones de rol (`INSTRUCCIONES_ROL.musico` ≈ 3,3 k car. se repiten en cada petición de cada músico).
