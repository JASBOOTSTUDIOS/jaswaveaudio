# A5 · Ejecución hasta terminar

**Objetivo:** con el plan aprobado, el agente trabaja paso a paso hasta completarlo y verificarlo, sin "Aplicar" por cada cambio y
sin cortar el turno con preguntas innecesarias.

## Contexto y hallazgos
- Pausa en la primera escritura (`ai-harness/src/loop/agent-loop.ts:323-350`, `agent-loop-bridge.ts:67`).
- Una mutación por iteración (`ai-harness/src/loop/validate-tool-calls.ts:94-101`; `limitToOneMutatingAction` en el panel);
  exceso de `maxToolCallsPerIteration` rechaza **todas** las llamadas (`:64-73`); diferidas se descartan.
- Límites: 8 iteraciones / 32 llamadas (64/128 canción) (`agent-run-types.ts:2-11`), replans >3 → fail.
- Pregunta "¿te gustó?" forzada (`base-prompt.ts:13-19`, `agent-loop.ts:87-91`, `modes.ts:470`).
- Bug de idempotencia de ids `c1` (`jas-wave/src/lib/agent-tool-runner.ts:50-58`, `parse-agent-decision.ts:10-16`).
- Undo por turno por profundidad (`src/lib/agent-turn-undo.ts:17-45`) falla con pila llena.

## Bucle objetivo (engine)
```
mientras haya pasos pendientes y no (cancelado | presupuesto agotado):
  paso = siguiente pendiente (tras releer plan, A4)
  agente = paso.agente (A6); contexto = session.summary + paso + evidencia previa (A9)
  repetir (presupuesto del paso):
     decisión = chat(agente, tools permitidas)
     ejecutar tool calls (varias por iteración; mutaciones en un batch con un undo)
     si destructiva/sistema → needs-user (confirmación) y esperar
  QA: audit.step(paso) → VERDICT {ok, issues, evidencia}
     ok → marcar [x] con evidencia; no ok → reintento con issues (máx N) → si persiste, [!] bloqueado y seguir con el resto
fin: audit.project (+ audit.mix si hubo mezcla/master) → resumen final (opcional: pregunta de satisfacción)
```

## Tareas
- [ ] Engine implementa el bucle; eliminar la pausa en primera escritura cuando el plan está aprobado (create/auto).
- [ ] Varias mutaciones por iteración ejecutadas como `executor.batch` (un undo por iteración) respetando política y orden.
- [ ] `maxToolCallsPerIteration`: ejecutar hasta el límite y devolver al modelo "N llamadas pendientes no ejecutadas: reenvíalas".
- [ ] Ids de llamada únicos por turno (`${runId}:${iter}:${n}`) y deduplicación por hash de (tool, args) dentro de la iteración.
- [ ] Presupuestos configurables (Ajustes → IA): por turno (llamadas, tokens/caracteres, tiempo) y por paso; mostrar consumo en la UI.
      Valores por defecto razonables para trabajos largos (p. ej. 200 llamadas / 60 min por turno, 30 llamadas por paso).
- [ ] Paradas solo por: completado, needs-user (destructiva/sistema, aclaración real), presupuesto, error irrecuperable, pausa/cancelación.
      Botones en el timeline: Pausar / Reanudar / Cancelar.
- [ ] Quitar la pregunta de satisfacción a mitad de turno (prompts y CLARIFY forzados en el panel); opcional al final.
- [ ] Transacción de turno y de paso: snapshot de estado al inicio (estructura y mezcla) + `executor` registra los ids de undo del
      turno; "Deshacer turno" / "Deshacer paso" restauran por snapshot (sustituye `agent-turn-undo.ts`).
- [ ] Tests (mock): turno de 6 pasos termina sin intervención; paso que falla QA reintenta y luego se bloquea sin detener el resto;
      destructiva pide confirmación y continúa tras aprobar; pausa/reanudación; deshacer turno restaura.

## Archivos
`ai-harness/src/engine/turn-engine.ts`, `ai-harness/src/loop/{agent-loop,validate-tool-calls,parse-agent-decision}.ts`,
`ai-harness/src/agent/{base-prompt,modes,budget}.ts`, `jas-wave/src/lib/{agent-tool-runner,agent-turn-undo}.ts`,
`shared/src/state/ejecutor-comandos.ts` (snapshot/restore de turno), componentes de timeline.

## Criterios de aceptación
- Un pedido "mezcla y masteriza para Spotify" con plan aprobado se completa sin clics intermedios (solo confirmaciones de sistema).
- Deshacer turno deja el proyecto como antes del turno.

## Verificación
`npm run verify`; e2e con mock; CLI `agent` (A8).

## Notas de traspaso
_(vacío)_
