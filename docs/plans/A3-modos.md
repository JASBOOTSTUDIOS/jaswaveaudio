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
- [x] `resolveMode(selected, text)` devuelve el modo seleccionado tal cual + `suggestion?` (heurística) que la UI muestra como chip
      "¿Cambiar a Crear?". Eliminar el override de `detectAgentMode` (mantener función para la sugerencia).
- [x] Engine (A1): tabla de capacidades por modo (`ai-harness/src/engine/mode-capabilities.ts`) → herramientas permitidas (A2
      `toolsForRole`), si puede mutar, si requiere plan aprobado, flujo de fin de turno.
- [x] Reescribir `modePromptBlock` (`modes.ts:383-481`) por modo sin contradicciones; quitar exigencias de "un paso por turno" y de
      "¿te gustó?" (ver A5).
- [x] Picker: descripción de cada modo (tooltip con la tabla), atajo para alternar, indicador visible del modo activo en el
      timeline del turno.
- [x] Guardas reales: en ask/think/plan el engine rechaza cualquier tool call mutante (excepto `plan.*` en plan) con error
      explicativo al modelo (no `forceApply`).
- [x] Tests: cada modo con proveedor mock — ask no muta aunque el modelo lo intente; plan solo escribe plan; create pide aprobación
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
- `detectAgentMode(text, forced)` **no se tocó** (sus tests de `modes-refine`/`reasoning-loop` siguen vigentes); el override ya no
  se aplica en la app porque los call sites usan `workingMode(selected, text)` (nuevo): en `auto` decide el texto, en el resto manda
  el selector. Call sites migrados: `jas-wave/src/lib/ai-daw-agent.ts` (`buildAgentSystemPrompt`, `fallbackActionsFromUserIntent`)
  y `agent-legacy-turn.ts` (líneas ~583 y ~1860, `resolvedMode`).
- `modePromptBlock` reescrito: `think` ya no escribe plan.md (entrega propuesta); `plan` pide el formato estructurado de A4
  (`## Pasos` + criterios); `create`/`auto` ya no exigen la pregunta «¿te gustó?» ni «un paso por turno» (la eliminación del
  CLARIFY forzado de Kael en `base-prompt.ts` + `agent-legacy-turn.ts:954` queda para A5).
- `mode-capabilities.ts` ahora expone `allowedClasses`, `isPlanWriteTool(name, args?)` (plan.* o doc.write/append sobre plan.md),
  `visibleInMode` (lista de tools por modo) y `gateToolForMode` recibe `args` para decidir si un doc.write es de plan.
- UI: atajo **Ctrl+Shift+M** alterna modos (`nextAgentMode` en `src/lib/ai-modes.ts`); chip de sugerencia `data-testid="mode-suggestion"`
  sobre el input; chip de modo del turno en la barra de fase `data-testid="turn-mode-chip"`.
- El flujo legacy de la app (ACTIONS + tarjeta Aplicar) sigue intacto; el bucle paso a paso sin clicos intermedios llega con A5
  en el programa nativo del motor.
