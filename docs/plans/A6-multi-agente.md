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
- [x] `ai-harness/src/agents/registry.ts`: definición por agente (`id, nombre, promptKey, tools, maxIterPorPaso, temperatura`).
- [x] Prompts en `ai-harness/src/agents/prompts.ts` (español, sin artistas fijos), embebidos para navegador/bundler:
      - director: planificación con pasos medibles, delegación, cuándo replanificar.
      - mezcla: protocolo **medir → diagnosticar → pocos cambios reales → re-medir → comparar**; gain staging (−18 dBFS RMS pre-fader).
      - mastering: cadena master (EQ amplia → comp bus → limitador true-peak), loudness objetivo (−14 LUFS, −1 dBTP).
      - productor: estructura/armonía/voicing, groove, delegación de mezcla.
      - qa: solo verificación; usa `audit.step` y bloquea pasos sin evidencia (`gateStepAudit`).
- [x] Contrato y ejecución del Director (`ai-harness/src/engine/director-program.ts`): asignación por paso con herramientas y rol específicos, `session.summary` por paso, snapshot por turno/paso.
- [x] Personalización de especialistas: `ai-harness/src/agents/especialistas-config.ts` y panel editable en la UI (`plugins/com.jaswave.modulo.asistente-ia/src/ui/especialistas-panel.tsx` en `AjustesIA`), permitiendo ajustar instrucciones de estilo, temperatura, límites de iteraciones y activar/desactivar especialistas.
- [x] Tests: suite completa en `ai-harness/src/test/a6/director-program.test.ts` (5 tests) y 236 tests de ai-harness pasando en verde.

## Archivos
`ai-harness/src/agents/*`; `ai-harness/src/engine/director-program.ts`, `plugins/com.jaswave.modulo.asistente-ia/src/ui/especialistas-panel.tsx`, `plugins/com.jaswave.modulo.asistente-ia/src/ui/ajustes-ia.tsx`.

## Criterios de aceptación
- Cada paso lo ejecuta el especialista asignado con sus herramientas; QA bloquea pasos sin evidencia.
- Mezcla y mastering operan con mediciones y valores reales.
- El usuario puede editar instrucciones de estilo y reglas de cada especialista desde la UI.

## Verificación
`npm run verify` completo pasando con 0 errores (lint, typecheck y 511 tests en jas-wave, 236 en ai-harness, módulos y VSTs).

## Notas de traspaso
- Especialistas de producción multi-agente implementados con el Director (`director-program.ts`) y los 4 roles especializados (`productor`, `mezcla`, `mastering`, `qa`).
- Integrada la capacidad de especialización editable (`EspecialistasPanel`) en los Ajustes de IA para que el usuario pueda definir instrucciones personalizadas (p. ej. directrices de worship, balances tonales específicos) y controlar temperaturas e iteraciones.
- Plugin VST3 `JasWave Ambience` (rack worship con 17 presets de Jasboot FX + 4 presets de estudio) completamente implementado, compilado en MSVC y desplegado.
