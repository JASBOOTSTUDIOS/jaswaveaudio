# @jaswave/shared

Tipos, contratos y estado compartido del DAW JasWave.

## Incluye

- **Event Bus** — pub/sub en memoria con replay buffer, priorización y backpressure.
- **State Model** — `DAWState`, queries inmutables, factory, validadores y migraciones.
- **Command System** — registry, executor, undo/redo, batch, macros, audit log y script API.
- **Validation Layer** — pipeline schema/auth/permission/domain/conflict/AI con dry-run.
- **Context Manager** — ensamblado de contexto de 5 niveles para IA con presupuesto de tokens.

## Estructura

```
src/
  types/        — interfaces y tipos de dominio
  state/        — runtime: tienda, pipeline, ejecutor, validadores
  events/       — bus, replay, dominio
  ai/           — context manager, tool registry, memory manager
  test/         — suite vitest (142 tests)
```

## Uso

```bash
npm install
npm test
npm run typecheck
```

## Licencia

MIT
