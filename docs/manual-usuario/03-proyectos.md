# 03 · Proyectos

## Formato

Los proyectos se guardan como **`.jaswave`**. Incluyen (entre otras cosas):

- Pistas, clips, MIDI, BPM, compás
- Cadena FX y parámetros
- Estado / chunk de VSTs (best-effort al guardar)
- Referencias a biblioteca del proyecto

## Operaciones

| Acción | Atajo | Notas |
|--------|-------|-------|
| Nuevo | `Ctrl+N` | Proyecto vacío |
| Abrir | `Ctrl+O` | `project.load` |
| Guardar | `Ctrl+S` | Snapshot VST + guardar |
| Guardar como | `Ctrl+Shift+S` | Elige ruta |
| Cerrar | menú Archivo | Si hay cambios: Guardar / Descartar / Cancelar |

## Buenas prácticas

1. **Guarda pronto** (`Ctrl+S`) tras cargar VSTs pesados (Kontakt, BFD, DecentSampler).
2. Guarda de nuevo **antes de bounce** y **antes de cerrar**.
3. Mantén samples/WAV grandes en una carpeta estable; los clips apuntan por ruta.
4. Usa **Biblioteca → Guardar** para presets importantes (no solo el `.jaswave`).

## Biblioteca del proyecto

Al guardar presets aparece `library/instruments.json` junto al proyecto.  
Los presets **globales** viven en datos de usuario (sirven entre proyectos).

## Reabrir un proyecto

1. `Ctrl+O` → elige el `.jaswave`.
2. Espera a que el Plugin Host confirme los VST (barra / estado de plugins).
3. Si un VST falla, verás caption de error / cuarentena — no significa que el proyecto esté corrupto.

Siguiente: [04 · Transporte y Arrange](./04-transporte-y-arrange.md).
