# ADR-0015: Planificación y ejecución del agente JasWave

## Contexto

El agente DAW (`ai-daw-agent.ts`) concentraba prompt, contexto, parse de `<<<ACTIONS>>>`, fallbacks heurísticos, catálogo de herramientas y orquestación. ADR-0006 exige que el Tool Registry sea la interfaz IA↔DAW. ADR-0014 ya orquesta Music Build por stages. El tipo `ExecutionPlan` en `shared/src/ai/planner.ts` es una lista plana de pasos (dry-run / confirmación), no un plan por fases.

## Decisión

1. **Congelar el monolito.** No añadir capacidades nuevas a `buildAgentSystemPrompt` ni a `fallbackActionsFromUserIntent` sin colocarlas en el bounded context destino (`ai-harness` prompting / recovery / planning).
2. **Prompt por composición.** Contexto, política musical, fragmento de tools y modo se ensamblan; el catálogo de tools sale del Tool Registry (`generatePromptFragment`).
3. **`AgentWorkPlan`** (fases) es el contrato de operaciones complejas. No se reutiliza el nombre `ExecutionPlan` (sigue siendo el plan plano de `planner.ts`).
4. **`<<<ACTIONS>>>` permanece** durante la migración, encapsulado en parser + adapter `DawAction` ↔ `ToolCall`.
5. **Fallbacks:** solo deterministas (BPM, compás, zoom, mute, dedupe) o edición MIDI acotada. No inventar `daw.musicBuild` / MIDI creativo si el modelo falla.
6. **`plan.md` es proyección** del trabajo (objetivo, fases, mutaciones reales), no protocolo obligatorio en cada mensaje.
7. Mutaciones siguen el Command System. Planner y quality gates fuera del audio thread.

El bucle observe→decide→act entre herramientas está en ADR-0016.

## Consecuencias

- Una fuente de verdad para capacidades (Registry) alimenta prompt, descubrimiento y riesgo.
- Canciones / musicBuild / master+render pueden ejecutarse por fases con checksum entre fases.
- El modelo sigue siendo probabilístico; la ejecución sigue siendo determinista.
