# A6 · Equipo multi-agente (Director + especialistas)

**Objetivo:** agentes reales con rol, prompt, herramientas y criterios propios, coordinados por un Director, en vez de un solo
modelo actuando voces.

## Contexto y hallazgos
- Consejo actual: `COUNCIL_VOICES` y `INNER_VOICE_RULES` en `ai-harness/src/agent/reasoning-prompts.ts:48-195` (Nexus, Lyra, Volt,
  Kael, Iris) en un solo hilo; `REASONING_PHASE_META`; `<<<VERDICT>>>` pedido y nunca parseado.
- No hay rol de ingeniero de mezcla/mastering; conocimiento de mezcla disperso (`prompting/music-policy.ts`, `modes.ts:432,478`,
  `music-build/executor.ts` "Mezcla de producción").

## Agentes
| id | Nombre | Responsabilidad | Herramientas (A2 `toolsForRole`) | Salida |
|---|---|---|---|---|
| `director` | Director | Entender pedido, escribir/actualizar plan, asignar pasos, decidir fin | `plan.*`, `session.summary`, lectura | plan y asignaciones |
| `productor` | Productor/Arreglista | Estructura, armonía, MIDI, instrumentos, estilo | `track.*`, `clip.*`, `midi.*`, `plugin.insert/lookup` (instrumentos), `style.*`, `daw.musicBuild/composeProject` | cambios + resumen |
| `mezcla` | Ingeniero de mezcla | Gain staging, EQ, compresión, paneo, buses/sends, automatización, profundidad | `analysis.*`, `audit.mix`, `plugin.*` (semántico, A7c), `send/bus`, `automation.*`, `clip.gain` | cambios + antes/después |
| `mastering` | Ingeniero de mastering | Cadena master, loudness por plataforma, true-peak, balance tonal, referencia | `analysis.master/*`, `reference.*`, `audit.compareReference`, master chain | cambios + reporte |
| `qa` | QA / Escucha | Verificar criterios de cada paso con medición; veredicto bloqueante | solo lectura + análisis + `audit.*` | VERDICT |

## Tareas
- [ ] `ai-harness/src/agents/registry.ts`: definición por agente (`id, nombre, promptFile, tools, maxIterPorPaso, temperatura`).
- [ ] Prompts en `ai-harness/src/agents/prompts/*.md` (español, sin artistas fijos), cargados en build (import como texto):
      - director: planificación con pasos medibles, asignación, cuándo replanificar, cuándo preguntar.
      - mezcla: protocolo **medir → diagnosticar → ≤N cambios → re-medir → comparar**; gain staging (−18 dBFS RMS pre-fader),
        rangos por instrumento, cadenas típicas (HPF → EQ correctiva → comp → EQ color), compresión por rol (ratios/attack/release
        de partida), paneo y ancho, sends de reverb/delay, sidechain kick→bajo, automatización de volumen.
      - mastering: EQ amplia → comp de bus → limitador true-peak; objetivos por plataforma (A7a); verificación con referencia.
      - productor: estructura/armonía/voicing, rango por instrumento, groove; delega mezcla.
      - qa: solo verifica; usa `audit.step` y emite `VERDICT` JSON; nunca modifica.
- [ ] Contrato `StepHandoff {stepId, objetivo, criterios, contexto, evidenciaPrevia, restricciones}` y `StepResult {cambios,
      mediciones, notas}`; el Director no comparte el hilo completo, solo el resumen (`session.summary`, A9).
- [ ] Parser obligatorio de `VERDICT` (tool `qa.verdict` en tool-calling, o bloque en fallback) y gate en el engine.
- [ ] Ejecución secuencial de pasos; lecturas/análisis de un paso en paralelo cuando no dependen (Promise.all con límite).
- [ ] UI: timeline del turno con avatar/nombre del agente por evento; filtro por agente.
- [ ] Retirar las voces antiguas del razonamiento previo (o mapearlas: Nexus→director, Kael→qa) y simplificar `reasoning-loop`
      a "análisis previo" del Director cuando sea necesario.
- [ ] Tests (mock): el Director asigna; un agente no puede usar herramientas fuera de su rol; QA rechaza sin evidencia; handoff
      no incluye el hilo completo.

## Archivos
Nuevos `ai-harness/src/agents/*`; `ai-harness/src/agent/{reasoning-prompts,reasoning-loop,base-prompt}.ts`, engine (A1/A5),
`jas-wave/components/coproducer-panel.tsx` (timeline).

## Criterios de aceptación
- Cada paso lo ejecuta el agente asignado con sus herramientas; QA bloquea pasos sin evidencia.
- Mezcla/mastering producen cambios con valores reales (A7c) y mediciones antes/después.

## Verificación
`npm run verify`; e2e con mock; prueba manual con proveedor real y un proyecto de ejemplo.

## Notas de traspaso
_(vacío)_
