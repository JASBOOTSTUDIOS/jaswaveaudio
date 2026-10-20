# A3 · Los 5 modos, estilo IDE

**Objetivo:** que `auto`, `ask`, `plan`, `create` y `think` hagan exactamente lo que dicen y que **el selector del usuario mande**.

## Contexto y hallazgos
- `ai-harness/src/agent/modes.ts:334` `detectAgentMode` aplica regex antes de respetar el modo elegido; "analiza" fuerza `ask`
  aunque se eligió create. `modeHint` del modelo (`reasoning-depth.ts:309`) no se usa.
- `modeBlocksMutation` (`modes.ts:379`) se salta casi siempre (`forceApply`/`respectModeGate:false`).
- create y auto idénticos (`reasoning-prompts.ts:212`); prompts contradictorios (`midiSource` procedural vs ai, `modes.ts:459,472`).
- Picker: `jas-wave/components/agent-mode-picker.tsx`, persistencia `src/lib/ai-modes.ts`.

## Semántica objetivo
| Modo | Comportamiento | Herramientas | Muta |
|---|---|---|---|
| ask | Responde con evidencia; bucle de lectura/análisis hasta tener respuesta (incluye render de análisis interno, A7b) | lectura + análisis + auditoría | No |
| think | Consejo multi-agente profundo + crítica; entrega diagnóstico y **propuesta de plan** (no la escribe) | lectura + análisis | No |
| plan | Escribe/actualiza el **plan estructurado** (A4) y pide aprobación/edición | lectura + análisis + `plan.*` | Solo plan |
| create | Si no hay plan aprobado → planifica y pide aprobación una vez; luego ejecuta hasta terminar (A5) | todas según política | Sí |
| auto | Como create pero auto-aprueba el plan; el usuario puede pausar/editar en cualquier momento | todas según política | Sí |

Destructivas/sistema siempre confirman (todos los modos que mutan).

## Tareas
- [ ] `resolveMode(selected, text)` devuelve el modo seleccionado tal cual + `suggestion?` (heurística) que la UI muestra como chip
      "¿Cambiar a Crear?". Eliminar el override de `detectAgentMode` (mantener función para la sugerencia).
- [ ] Engine (A1): tabla de capacidades por modo (`ai-harness/src/engine/mode-capabilities.ts`) → herramientas permitidas (A2
      `toolsForRole`), si puede mutar, si requiere plan aprobado, flujo de fin de turno.
- [ ] Reescribir `modePromptBlock` (`modes.ts:383-481`) por modo sin contradicciones; quitar exigencias de "un paso por turno" y de
      "¿te gustó?" (ver A5).
- [ ] Picker: descripción de cada modo (tooltip con la tabla), atajo para alternar, indicador visible del modo activo en el
      timeline del turno.
- [ ] Guardas reales: en ask/think/plan el engine rechaza cualquier tool call mutante (excepto `plan.*` en plan) con error
      explicativo al modelo (no `forceApply`).
- [ ] Tests: cada modo con proveedor mock — ask no muta aunque el modelo lo intente; plan solo escribe plan; create pide aprobación
      una vez y luego no vuelve a pedir para escrituras normales; auto no pide aprobación; destructivas confirman en create/auto.

## Archivos
`ai-harness/src/agent/{modes,reasoning-prompts,reasoning-depth}.ts`, nuevo `ai-harness/src/engine/mode-capabilities.ts`,
`jas-wave/components/agent-mode-picker.tsx`, `src/lib/ai-modes.ts`, `components/coproducer-panel.tsx` (vista).

## Criterios de aceptación
- El modo elegido nunca cambia sin acción del usuario.
- Cada modo cumple su tabla, probado con tests.

## Verificación
`npm run verify`; e2e con mock por modo.

## Notas de traspaso
_(vacío)_
