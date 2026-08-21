# ADR-0008: Sistema de Actions, Shortcuts y Keymaps

## Contexto

JasWave necesita un sistema profesional de acciones y atajos (inspirado en REAPER/VS Code) que soporte cientos de acciones, contextos, múltiples shortcuts, Command Palette, reasignación y futura integración con IA — sin `if/else` de teclado ni mutaciones directas de `DAWState`.

## Decisión

1. **Action ≠ Command**: una Action es una intención invocable; un Command es la mutación determinista del dominio.
2. **Flujo único**: `Keyboard / Palette / UI / AI → ActionRegistry → (handler) → CommandExecutor → DAWState → Event Bus`.
3. **Módulos en** `shared/src/actions/`:
   - `ActionRegistry`, `ShortcutRegistry`, `KeyboardNormalizer`, `ShortcutResolver`, `ActionSystem`, catálogo y keymap default.
4. **IDs canónicos en inglés** (`transport.togglePlay`); aliases legacy en español (`transporte.reproducir`) para menús existentes.
5. **Contextos con prioridad** (plugin → midi → arrangement → global).
6. **Persistencia** vía `KeymapStorage` (localStorage en renderer; preparado para Preload/Main).
7. **Electron**: no registrar `Space` como accelerator de menú (secuestraba el keydown del renderer).

## Consecuencias

### Positivas
- Una sola fuente de verdad para palette, teclado, menús e IA.
- Resolución O(1) por índice `context+chord`.
- Conflictos explícitos; shadowing contextual documentado.
- Compatible con Undo/Redo y Command System existentes.

### Negativas
- Migración gradual de IDs legacy.
- Handlers de IO (guardar/abrir) siguen en la capa UI enlazados al registry.

## Estado

Aceptado — 2026-08-20
