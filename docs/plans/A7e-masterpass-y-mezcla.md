# A7e · masterPass y mezcla por medición

**Objetivo:** mastering y mezcla inicial correctos y basados en medición.

## Contexto y hallazgos
- `jas-wave/src/lib/master-pass.ts`: `pickMasterPlugins` (`:30-42`) ordena limitador → EQ → comp; reemplaza la cadena del master
  (`:56-64`) sin fijar parámetros; ajusta el **fader del master** post-cadena (`:79-121`, ×0.75–1.25) → empuja el soft limiter;
  renders de 120 s; clase `write` pero hace `render.start` (sistema) internamente.
- `music-build/executor.ts` `MIX_BY_ROLE` (`:140-154`) fijo (batería 1.0, bajo 0.98, pad 0.82) contradice
  `prompting/music-policy.ts:32-34` (batería 0.75–0.85, pads 0.4–0.55); "Mezcla de producción" (`:800-847`) sin EQ/comp ni medición.

## Tareas
- [ ] Reescribir `masterPass` como procedimiento del ingeniero de mastering:
      1) `analysis.mix` (render de análisis, A7b) → 2) cadena EQ amplia → comp de bus suave → limitador true-peak (FX JasWave, A7d)
      **añadida al final de la cadena existente** (no reemplazar; si ya hay limitador, usarlo) → 3) fijar ceiling según plataforma
      (A7a) y subir **input gain del limitador** (no el fader) iterando hasta LUFS objetivo ±0.5 y TP ≤ ceiling → 4) verificar
      balance tonal vs curva de género y PLR mínimo (no destruir dinámica) → 5) reporte antes/después.
      Clase: `write` si solo analiza en temporal; `system` si exporta a ruta del usuario.
- [ ] Mezcla inicial de Music Build por medición: render de análisis por stem, fijar faders para offsets objetivo por rol
      (p. ej. kick y voz como ancla, bajo −2 LU, pads −8 LU…) en `music-build/executor.ts`; eliminar `MIX_BY_ROLE` y alinear
      `music-policy.ts`.
- [ ] Sends de reverb por rol con niveles en dB y HPF/LPF en el retorno (FX JasWave EQ).
- [ ] Tests: con un proyecto sintético, `masterPass target:spotify` deja LUFS −14 ±0.5 y TP ≤ −1 dBTP y la cadena previa intacta.

## Archivos
`jas-wave/src/lib/{master-pass,music-build/executor,prompting/music-policy}.ts`, `ai-harness/src/agent/action-policy.ts`.

## Verificación
`npm run verify`; e2e: `daw.masterPass {target:'spotify'}` → reporte dentro de objetivo.

## Notas de traspaso
_(vacío)_
