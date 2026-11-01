# S — Humanización, cobertura real y coordinación de voces

> Estado: implementado y probado con tests deterministas (sin modelo real, sin oído, sin e2e). Pendiente: una pasada real del e2e 29 (ver §7).

## 1. Hallazgos medidos (pasada real del e2e 29, 7 pistas, 64 compases, 74 BPM)

El usuario dijo que lo que produce la IA «no es para nada humano». Medido nota por nota en el proyecto vivo (el análisis se reproduce con `jas-wave/scripts/analizar-proyecto-musical.mjs` sobre `proyecto-19.json`):

| Hallazgo | Medida |
| --- | --- |
| Cuerdas | 0 notas: nadie la tenía asignada (el director solo encargó batería, bajo, piano, guitarra y sintes) |
| Piano | 4 compases de 64: `seccionesFaltantes` daba por completa la pista porque su encargo nombraba la intro («si el encargo nombra secciones, solo esas») |
| Batería | 24 compases de 64 sin notas, también DENTRO de secciones activas (10–12, 22–24, 30–32, 42–44, 52, 58–60): la comprobación miraba «alguna nota en la sección» |
| Copias exactas | 70–72 % de los compases de batería, 71–81 % del bajo, 61 % de la guitarra idénticos a otro |
| Cuantización | 100 % de la batería y 77 % de la guitarra en la rejilla EXACTA de semicorcheas; sin micro-timing |
| Clips sin nombre | 4–5 clips de guitarra llamados «Clip MIDI» |
| Choques verticales (pasada 19) | 32–37 % de los tiempos con segunda menor (o séptima mayor) entre pistas distintas; pad sosteniendo la nota del acorde anterior; bajo en sol♯ sobre A/C# |

## 2. Qué se hizo (por fases)

### Fase 1 — Dueño para cada pista (`ai-harness/src/agente/duenos.ts`, `produccion.ts`)
- `ConfigProduccion.pistas?: () => Array<{id; nombre; tipo?; notas?}>` (lo implementa `turno-banda.ts` con el estado real: pistas `audio|midi|instrumento`, sin máster ni buses).
- Tras la dirección, `asignarPistasHuerfanas` calcula las pistas sin encargo (por campo `pista`, por id citado o por nombre entre «»/"") y las reparte por afinidad de familia: cuerdas → músico de cuerdas, si no pianista/teclista, si no sintes; pad → sintes, si no teclas; guitarra → guitarrista; bajo → bajista; batería/percusión → baterista; sin afinidad, el músico con menos pistas.
- Un músico sin encargo recibe uno nuevo; si ya tiene, su encargo se **amplía** con el texto de rol («Toca en TODA la canción: …») y la pista se anota en `Encargo.pistasExtra` (puede escribir en ella; `completitud` la mide). Decisión: el resto del harness asume un encargo por músico, por eso no se duplican encargos.
- Tras la etapa de músicos, una pista con 0 notas recibe **un** rescate de su dueño (`rescatarPistasVacias`).
- Evento nuevo `pistas_asignadas` y línea en el resumen final («Pistas sin encargo repartidas por la producción: «Cuerdas» → Pianista (estaba vacía: rescate)»).

### Fase 2 — Cobertura real por compás (`coherencia-banda.ts`)
- `seccionesFaltantes` ya **no** restringe a las secciones nombradas: solo lo hace si «solo/solamente/únicamente/exclusivamente» está a ≤ 30 caracteres de la mención (cualquier otra mención no limita). Sin límite: toda la canción salvo intro y outro (la base rítmica, también el outro).
- Mide **por compás** (`huecosPorCompas`): un compás está cubierto si empieza una nota en él o lo atraviesa una (≥ 40 % del compás; la cola de legato de ~medio beat no cuenta). En pistas continuas (todas menos lead/melodía/voz/fx) ningún compás vacío, salvo **un** compás de respiro al final de la sección si el resto está cubierto. Leads y melodías: basta con notas en cada sección exigida.
- Mensaje accionable con rangos: `en «Batería» no hay notas en: Verso 1 (compases 10–12, beat 36, 12 beats); …`. Mismo prefijo que antes (lo usan el diagnóstico y los tests del harness).
- `analizarCoherencia` usa el mismo cálculo para la base («sin notas en los compases 10–12 (Verso 1)»).

### Fase 3 — Humanización determinista (`shared/src/music/humanizar-banda.ts`, `turno/humanizar-banda.ts`)
- Decisión: se aplica **al escribir cada clip** (junto a las guardias de armonía y legato), no al terminar el músico: es más simple, no hace falta releer el proyecto y la memoria por pista (`MemoriaHumanizado`) detecta copias también entre clips. Orden en `ejecutar`: armonía → nombre de clip → **humanización** → legato. El tiempo se mueve antes del legato para que las notas largas sigan sin huecos (probado: ningún hueco salvo el respiro de 1/64 de la misma altura).
- Micro-timing gaussiano (semilla = id de pista + compás): batería σ 3 ms (tope ±6; golpe de bombo/caja del tiempo 1 σ 1,2 ms, tope 3 ms y nunca adelantado; hi-hats con swing leve), bajo +5 ms «detrás» (tope 12), piano/guitarra σ 7 (tope 16), pad/cuerdas σ 9 (18), lead σ 9 (20). Tope absoluto 0,06 beats (`MAX_DESVIO_BEATS`). Las notas de un acorde se mueven juntas (el legato las agrupa por inicio). Nada cruza la barra hacia atrás.
- Microdinámica: acento por tiempo (fuerte > medio > débil), ganancia distinta por compás (mayor en copias), ghost notes de caja con su propia variación.
- Variación entre compases copia (misma firma a 1/32 de beat, en el clip o en otro anterior de la pista): batería con ghost notes añadidas/quitadas (objetivo 2–3 por compás, en sitios distintos), hi-hat abierto ocasional (solo si el kit ya usa el 46) y fill corto en el último compás de cada 4 (largo en cada 8, con toms si el clip ya los usa); bajo/guitarra/piano: un ataque débil desplazado una semicorchea o suprimido, y pequeñas variaciones de duración. **Nunca cambia alturas ni añade notas afinadas**; no toca el primer compás de cada sección (ni el primero de la llamada) más allá del tiempo y la dinámica; solo corta/ mueve ataques débiles y cortos (la regla de armonía del primer tiempo y de notas ≥ 1 beat no se ve afectada).
- Ajuste: `localStorage['jaswave-banda-humanizar']` = `siempre` (amplitud ×1,25 y variación también en compases no copia) | `suave` (defecto) | `nunca`.
- Herramientas afectadas: `midi.clip.create`, `midi.createNotes`, `midi.notes.set`, `midi.notes.add`. **No** `midi.notes.patch` (retoques nota a nota).
- No se reutiliza `midi.humanize`/`style.touch.apply`: el primero aplica un desvío uniforme al clip ya escrito, el segundo el perfil aprendido del teclado del usuario; ninguno distingue instrumento ni varía copias, y ambos son comandos posteriores a la escritura. Conviven: el estilo del usuario se sigue aplicando al terminar cada músico.
- `MARGEN_REJILLA` 0,08 → 0,1 (documentado): la rejilla admitida es la unión de semicorcheas, tresillos de corchea y sextillos, cuyo punto más lejano está a 1/12 ≈ 0,083 beats; con margen ≥ 0,084 la comprobación «lejos de la rejilla» solo salta con ritmos que no son de ninguna rejilla y **nunca** por el desvío humano (test a 60–200 BPM en modo `siempre`). Límite conocido: esa comprobación ya era casi inerte; no se endureció para no marcar tresillos legítimos.

### Fase 4 — Copias y nombres
- `diagnosticoEscritura` añade «N de M compases son copia exacta de otro (X %): varía velocidades, adornos o reparto» por encima de `UMBRAL_COPIAS` = 40 % (pista entera, o un clip con ≥ 4 compases). Los pads y cuerdas quedan exentos (repiten el mismo acorde de forma legítima). `copiasExactas` (≥ 3 notas por compás, firma a 1/32 de beat) es exportada.
- `nombrarClipGenerico`: al crear un clip con `midi.clip.create` sin nombre o con «Clip MIDI»/«clip 3», se llama `<Pista> - <Sección>` según el beat de inicio. Límite: no existe comando de renombrado de clip, así que no se renombran los ya creados (por ejemplo, con `groove.insertar`).

### Fase 5 — Métricas en el e2e (`jas-wave/e2e/29-cancion-completa-ia.spec.ts`, `jas-wave/scripts/analizar-proyecto-musical.mjs`)
- El script (`node jas-wave/scripts/analizar-proyecto-musical.mjs proyecto.json [--json]`) imprime por pista: notas, clips (y sin nombre), compases vacíos con rangos, % de copias, % de notas en rejilla exacta, duraciones y velocidades distintas; y del conjunto: % de tiempos con choque entre pistas y % de bajo en el primer tiempo que no es el bajo de la barra. Sale con código 1 si hay fallos. Es importable (`analizarProyecto`, `evaluarCalidad`, `tablaResumen`). Arreglada la lectura de marcadores (`marcadores[] {nombre, tiempo}`; admite también `markers`).
- El e2e lee las notas del proyecto vivo con `midi.notes.get` por ventanas de 8 beats (el comando devuelve ≤ 128 por llamada), usa como secciones la forma del PEDIDO, imprime la tabla `[musica] …` y falla si: hay una pista de instrumento vacía; hay compases vacíos; alguna pista tiene ≥ 50 % de copias (excepto pad/cuerdas); batería ≥ 90 % o resto ≥ 60 % de notas en rejilla exacta; ≥ 8 % de tiempos con choque. **Esa parte del spec no se ha ejecutado** (solo `tsc`).
- Sobre `proyecto-19.json` el script reproduce lo medido: batería 72 % de copias y 100 % de rejilla, 19 compases vacíos en secciones activas, cuerdas vacías, piano con 56, choques 37 %.

### Fase 6 (añadida) — Coordinación vertical (`shared/src/music/coordinar-voces.ts`, `turno/coordinar-banda.ts`)
- Hueco de coordinación que `armonia-banda.ts` no puede ver: cada pista cumple el acorde por separado y juntas rozan. `coordinarVoces` (pura) y `medirChoques` (exportada) corrigen, sin añadir notas ni sacar ninguna del acorde/color:
  1. **Bajo**: en el primer tiempo, el bajo de la barra (la nota tras «/»); notas ≥ 0,5 beat fuera de acorde y escala → nota del acorde más cercana (cromáticas solo como paso < 0,5).
  2. **Pad y cuerdas siguen al acorde**: nota fuera del acorde de su compás → nota del acorde más cercana; nota sostenida que cruza a un acorde que no la contiene → se corta en el cambio dejando solo el solape legato de R (1 s pad, 500 ms cuerdas).
  3. **Tiempo fuerte y notas largas** de los instrumentos armónicos: acorde o color (9.ª, 6.ª, 11.ª en menores).
  4. **Choques** (1 o 11 semitonos, ambas ≥ E2, solape ≥ ¼ de beat, pistas distintas): la de menor prioridad (lead > piano > guitarra > cuerdas > pad) cambia de octava o de nota del acorde sin crear otro choque; sin alternativa se acorta o se quita. Bajo y batería no entran.
  5. **Registro**: el pad por debajo del piano/guitarra cuando se puede (sin crear choques) y no se duplica la misma nota a la vez (otra octava o se quita la de menor prioridad).
- Se aplica **al terminar la etapa de músicos** (`ConfigProduccion.afinarConjunto`, tras el rescate de pistas vacías y antes de ensayo y coherencia) reescribiendo solo los clips afectados con `midi.notes.set` (conserva ids y campos). Deviación del orden pedido («antes de humanización/legato»): necesita ver todas las pistas ya escritas, y como la humanización solo mueve tiempo/velocidad y el legato solo duraciones, no interfieren con un cambio de alturas; el recorte del pad deja explícitamente el solape de R.
- Canción sintética (4 pistas, 16 compases, choques como los medidos): **75 % → 0 %** de tiempos con choque; objetivo < 8 %. Resumen en el informe final («Coordinación de voces: choques entre pistas en 75 % de los tiempos → 0 %, …»).
- La métrica `choques` está en el análisis del e2e y del script.

## 3. Choques con R, N, P, Q (resueltos)
- **R (legato)**: tiempo antes que legato (§Fase 3); el recorte de pad deja su solape; la cola de un legato no se cuenta como cobertura de un compás.
- **N/P (eficiencia/velocidad)**: la nueva `completitud` por compás puede provocar más reintentos de músicos (máx. 3 como antes) y el rescate añade, como mucho, una llamada por pista vacía; no se añade ninguna etapa con modelo. Humanización y coordinación son deterministas, sin tokens.
- **Q (reanudar)**: `pistas_asignadas` y `coordinacion` son eventos nuevos que el diario guarda y la reanudación ignora; las asignaciones quedan en `encargos` (que sí se restauran). La coordinación se ejecuta solo en la rama que graba, no al reanudar con la etapa ya hecha.
- **K1 (perfil de toque)**: el estilo del usuario se aplica después, al terminar cada músico; la humanización lo precede sin pisarlo (no hay `style.touch.apply` si no hay estilo activo).

## 4. Archivos
`ai-harness/src/agente/{duenos,produccion,index}.ts` · `shared/src/music/{humanizar-banda,coordinar-voces}.ts` (+ `index.ts`) · `plugins/com.jaswave.modulo.asistente-ia/src/motor/turno/{humanizar-banda,coordinar-banda,coherencia-banda,turno-banda}.ts` · `jas-wave/src/modulos/api-host.ts` (+ `plugins/sdk/host-sdk/src/host-api.generated.ts` regenerado) · `jas-wave/scripts/analizar-proyecto-musical.mjs` · `jas-wave/e2e/29-cancion-completa-ia.spec.ts`.
Tests: `ai-harness/src/test/agente-duenos.test.ts`, `shared/src/test/{humanizar-banda,coordinar-voces}.test.ts`, módulo `test/{cobertura-copias-banda,humanizar-banda,coordinar-banda}.test.ts`.

## 5. Límites conocidos
- La humanización ve solo las notas de la llamada (no actúa en `midi.notes.patch`); releer y reescribir con `midi.notes.set` vuelve a mover el tiempo con la misma semilla y no acumula ghost notes (objetivo 2–3 por compás).
- La batería asume percusión General MIDI (35/36 bombo, 37–40 caja, 42/44/46 hi-hat, toms 41–50). Con otro mapa de kit las notas desconocidas solo reciben micro-timing y dinámica; los fills y ghost notes solo se añaden si hay caja GM en el clip.
- Los compases «copia exacta» se miden a 1/32 de beat: el micro-timing por sí solo no cuenta como variación (a propósito).
- La coordinación no resuelve tensiones de tres o más voces ni intervalos distintos de 1/11 semitonos; solo mueve a notas del acorde (o color), nunca a «cualquier nota libre».
- `MARGEN_REJILLA` apenas discrimina (§Fase 3).
- No se pueden renombrar clips ya creados.

## 6. Cómo reproducir
```
node jas-wave/scripts/analizar-proyecto-musical.mjs <proyecto.json>
cd shared && npm test && npm run typecheck
cd ai-harness && npm test && npm run typecheck
cd plugins/com.jaswave.modulo.asistente-ia && npx tsx --tsconfig ../sdk/host-sdk/pruebas/tsconfig.pruebas.json --test test/<archivo>.test.ts
```

## 7. Qué validar con una pasada real
1. Que el director deje alguna pista sin encargo y que el resumen diga a quién se asignó; que «Cuerdas» tenga notas en toda la canción.
2. Piano, guitarra y batería sin compases vacíos (tabla `[musica]` del e2e) y que el número de reintentos de completitud no dispare el tiempo total (plan P).
3. Escuchar: que el micro-timing se note humano pero no desordenado (si molesta, `jaswave-banda-humanizar` = `nunca`; si falta, `siempre`), que los fills de cada 4 compases suenen bien y los ghost notes no tapen la caja.
4. Que `analizarCoherencia` siga aprobando y que ningún compás de bajo/guitarra quede sin acorde por las variaciones.
5. Choques entre pistas < 8 % y que el pad cambie con el acorde (oído: sin roces en A/C#, Gmaj7); que la reescritura de la coordinación no cause un deshacer raro (se deshace con el turno).
6. Que los clips lleguen con nombre «<Pista> - <Sección>».
