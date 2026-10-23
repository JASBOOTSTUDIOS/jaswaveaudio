# V2 — Rediseño UI cyber y calidad DSP de los VST

**Depende de:** V1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`plugins/shared-ui/`, `plugins/tests/dsp_selftest.cpp`, `plugins/shared-ui/DESIGN.md`

## Criterios de aceptación
Todos los VST siguen DESIGN.md (marco biselado, LEDs, retícula, perillas con glow, faders, osciloscopio); selftest ampliado (RBJ, true-peak, sin asignaciones en process, save/restore); validator VST3 y pluginval sin errores.

## Checklist
- [x] UI Direct2D + DirectWrite según DESIGN.md (marco, LEDs, retícula, perillas con glow, faders, secciones, overlay)
- [x] Visualizador propio por plugin (curva EQ con nodos, GR + curva estática, forma de onda TP + LUFS, espectro SC,
      goniómetro + correlación, teclado/voces)
- [x] Capturas PNG de los 7 editores (4 estados cada uno) en `plugins/docs/capturas/`
- [x] Selftest ampliado (RBJ ≤0.1 dB, compresor, TP ≤ techo a 16× y BS.1770-4, de-esser, utility, afinación, polifonía,
      denormales, NaN/Inf, bloques 1–4096, 44.1–192 kHz, 0 asignaciones en process)
- [x] validator del SDK (47/47) y pluginval nivel 10 en los 7 plugins

## Verificación
```bat
plugins\build\tests\Release\jw_dsp_selftest.exe          :: 68 comprobaciones objetivas
node plugins/scripts/validate-plugins.mjs --pluginval <pluginval.exe> --strictness 10
plugins\build\tools\Release\<Plugin>_snapshot.exe --out plugins/docs/capturas --name <id>
```

## Notas de traspaso
- 2026-10-23 · Claude Opus 5.5. Hecho.
- El selftest destapó dos errores reales ya corregidos: el limitador superaba el techo con ruido blanco (+0.5 dBTP a 16×):
  ahora detecta con un true-peak 8× de 64 taps/fase y añade 2 muestras de seguridad (latencia fija 10 ms + 17 muestras);
  el piano superaba la polifonía básica al robar voces. `TruePeak4x` usa ya los coeficientes normativos BS.1770-4.
- pluginval descargado de la release oficial v1.0.4 (Tracktion) en el scratchpad; no se versiona. Ejecuta los tests de editor.
- "Sin asignaciones por frame": geometrías, pinceles, formatos y layouts de texto cacheados y fondo estático en bitmap;
  DrawText de DirectWrite puede asignar internamente.
- Pendiente opcional: zoom por arrastre de esquina en hosts que no soportan `canResize` (la vista mantiene 16:9).
