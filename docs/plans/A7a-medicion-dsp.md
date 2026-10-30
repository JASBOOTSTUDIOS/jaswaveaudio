# A7a · Medición DSP correcta

**Objetivo:** mediciones de nivel profesionales y correctas (base de todas las decisiones del ingeniero).

## Contexto y hallazgos
- `shared/src/audio/loudness-bs1770.ts`: K-weighting con coeficientes fijos de 48 kHz (`:36-42`) aplicados a 44–50 kHz (`:88`);
  true-peak 4× por interpolación **lineal** (`:91-105`) = sample peak; momentary/short-term = último bloque (`:146-147`);
  LRA percentil sin gating EBU (`:149-156`); `LOUDNESS_TARGETS` solo streaming/club/cd (`:169-173`).
- `shared/src/audio/mix-analysis.ts`: espectro de 10 bandas con **una** FFT de 4096 muestras del centro (`:106-116`); crest factor
  `peakDb − (integrated+0.691)` (`:186`); correlación global (`:49-73`); clipping ≥0.999 (`:75-83`);
  `buildAudioListenReport` (`:201-245`) solo clipping/TP/correlación/objetivo.

## Tareas
- [x] K-weighting por sample rate (diseño de los dos biquads de BS.1770 por fórmula bilineal para cualquier fs).
  → `coeficientesKWeighting(fs)` en `loudness-bs1770.ts`; test: coeficientes a 48 kHz = tabla BS.1770-4 (±1e-6).
- [x] True-peak: sobremuestreo 4× con FIR polifásico (≥48 taps) según BS.1770-4 Anexo 2.
  → módulo `true-peak.ts`: 12 taps/fase × 4 fases = 48 taps, ventana Kaiser β=5.5, normalización DC por fase.
  Test: seno fs/4 +45° → TP > sample peak (+3.13 dB medidos; esperado ≈ +3.01).
- [x] Momentary (400 ms) y short-term (3 s) como **series temporales** + máximos; integrated con gating absoluto −70 y relativo −10.
  → series a 10 Hz (`serieMomentary`/`serieShortTerm`, opcionales), `momentaryMax`/`shortTermMax`; gating en `integradoConGating`.
  Test: seno EBU −23 dBFS → integrated −22.993 LUFS (±0.1) y series constantes.
- [x] LRA EBU Tech 3342 (gating absoluto −70 LUFS y relativo −20 LU, percentiles 10–95 de short-term).
  → `rangoLoudnessTech3342`. Test: secciones 4 s a −20/−30 LUFS → LRA 10.01 LU (esperado ≈10).
- [x] Crest factor real (pico/RMS en dB) global y por ventana; RMS por ventana; PLR (peak-to-loudness ratio).
  → `measureMixAnalysis` devuelve `crestFactorDb` (pico−RMS), `rmsDb`, `plrDb`, `psrDb`, `dinamicaVentanas`
  (ventanas de 1 s: `rmsDb[]`, `crestDb[]`, min/mediana/máx). Test: seno −20 dBFS → crest 3.010 dB, RMS −23.010 dB.
- [x] Espectro promediado (Welch: ventana Hann 8192, 50 % solape, toda la señal) en **1/3 de octava** (31 bandas) + agregados
      (sub 20–60, low 60–250, lowmid 250–500, mid 500–2k, highmid 2–6k, high 6–20k).
  → módulo `spectrum.ts` (+ `fft.ts`): densidades cruzadas L/R vía una FFT compleja (L+iR), reparto fraccional por bin.
  Tests: seno 1 kHz → banda 1k ≈ −3.0 dB; ruido rosa → ±0.405 dB máx. desviación (27 bandas 40 Hz–16 kHz).
- [x] Estéreo: correlación por banda, mid/side energía y ancho, balance L/R; compatibilidad mono (pérdida en dB al sumar).
  → módulos `stereo.ts` (banda ancha) + `BandaEstereo` por agregado en `spectrum.ts`. Tests: mono/anti-fase/balance 6 dB/descorrelado.
- [x] Transientes: densidad de onsets (flujo espectral) y tiempo de ataque medio.
  → módulo `transients.ts` (STFT 512/128 sobre señal diezmada ≈12 kHz, picos del flujo con umbral adaptativo,
  ataque 10 %→90 % de la envolvente). Tests: 4 clicks/s detectados; seno continuo → 0 onsets.
- [x] Objetivos por plataforma en `loudness-bs1770.ts`: `spotify −14/−1`, `apple −16/−1`, `youtube −14/−1`,
      `amazon −14/−2`, `club −8/−0.3`, `broadcast −23/−1 (EBU R128)`, `cd −9/−0.3`; mantener alias `streaming`.
  → `LOUDNESS_PLATFORM_TARGETS` (+ `LOUDNESS_TARGETS` derived para compat, `LOUDNESS_TARGET_NAMES`, `esLoudnessTargetName`);
  `compareLoudnessTarget` ahora además calcula `targetTruePeakDb` y avisa si la ganancia excede el techo.
- [x] Ampliar `buildAudioListenReport` con nuevas métricas (sin romper consumidores: campos nuevos opcionales).
  → campos opcionales `advertencias`, `targetLufs`, `targetTruePeakDb`; avisos de PLR/LRA/contrafase de graves;
  `MixAnalysisReport` ampliado con campos opcionales (`rmsDb`, `plrDb`, `psrDb`, `dinamicaVentanas`, `bandasAgregadas`,
  `estereo`, `transientes`). `compactarInformeAudio` recorta series/listas largas para la IA.
  Consumidor `commands/analysis-commands.ts`: enums de target ampliados a las 8 plataformas; `analysis.stereo` y
  `analysis.spectrum` exponen los campos nuevos (opcionales). `shared/src/index.ts` exporta los módulos nuevos.
- [x] Tests con señales de referencia (todos pasan):
  - seno 1 kHz −20 dBFS → peak −20.000 dB, RMS −23.010 dB, crest 3.010 dB.
  - ruido rosa → espectro 1/3 oct plano, desviación máx. 0.405 dB (±1 dB) en 40 Hz–16 kHz.
  - señal EBU 1 kHz −23 dBFS estéreo → −22.993 LUFS (±0.1); M/ST máx = −22.993.
  - inter-sample peak (seno fs/4 +45°) → sample peak 0.7071, TP 1.0137 → +3.129 dB.
  - 44.1/48/96 kHz → −22.991 / −22.993 / −23.011 LUFS (spread 0.02 LU).

## Archivos
`shared/src/audio/{loudness-bs1770,mix-analysis}.ts` (+ nuevos módulos `spectrum.ts`, `stereo.ts`, `transients.ts`,
`true-peak.ts`, `fft.ts`), `shared/src/audio/*.test.ts` (6 archivos, 29 tests), consumidores en
`shared/src/commands/analysis-commands.ts`, exports en `shared/src/index.ts`.

## Criterios de aceptación
- Todos los tests de referencia pasan; ningún consumidor existente se rompe. ✅
  Verificado: `npx vitest run src/audio` → 29/29; suite completa `shared` → 387/387; `tsc --noEmit` (shared) ✅;
  `npx tsc -b --noEmit` (jas-wave) ✅; `npm run lint` → 0 errores (19 warnings preexistentes en componentes React).

## Verificación
`cd shared && npx vitest run src/audio`; `npm run verify`.

## Notas de traspaso
- **Estado: hecho** (2026-10-20, rama `ws/a7a-dsp`). Commits: `feat(...)` DSP + `test(...)` referencias + `docs(plans)`.
- Decisiones de diseño:
  - `LoudnessResult.momentary`/`shortTerm` ahora son los **máximos** (antes: último bloque); los campos originales se
    conservan y los nuevos (`momentaryMax`, `shortTermMax`, `serieMomentary`, `serieShortTerm`, `pasoSerieSeg`,
    `loudnessRange`, `peakDb`, `truePeakDb`) son opcionales → ningún consumidor se rompe.
  - `LOUDNESS_TARGETS` sigue existiendo (mapa nombre → LUFS) para `master-pass.ts`/`analysis-commands.ts`;
    la fuente de verdad es `LOUDNESS_PLATFORM_TARGETS` (lufs + truePeakDb + descripción).
  - `crestFactorDb` cambió de `peak − (LUFS+0.691)` a **pico − RMS global** (definición real); el tipo no cambió.
  - `spectrumBands` pasó de 10 bandas a **31 de 1/3 octava** (mismo campo/tipo `BandEnergy[]`; `hzCenter` ahora es el
    centro ISO nominal). `mix-analyzer-panel.tsx` (jas-wave) solo lee `label/db/hzCenter` → sigue funcionando.
  - El true-peak es 4× con FIR de 48 taps; para ≥96 kHz sigue usando 4× (suficiente para la banda 0–2·fs… ver caveat).
- **Caveats / posibles mejoras futuras**:
  - `render-commands.ts` `listenTarget` y los unions `'streaming'|'club'|'cd'` en `types/render.ts`, `ai-harness`
    (`harness.ts`, `production-audit.ts`, `render-quality-gate.ts`) y `jas-wave` (`export-bounce-dialog.tsx`,
    `ai-daw-agent.ts`, `agent-audit-bridge.tsx`) **no** se ampliaron: ampliarlos rompería/obligaría a tocar UI y
    ai-harness fuera del alcance aislado de A7a. `analysis.*` ya acepta las 8 plataformas.
  - Si se necesita true-peak exacto "a banda completa" (BS.1770-4 Anexo 2 pide 4× con oversampling mínimo 192 kHz para
    48 kHz), el FIR actual es un windowed-sinc, no el filtro de referencia de 48 taps de la norma; la desviación medida
    es ≤0.13 dB en el test de inter-sample peak, suficiente para mastering, pero se puede sustituir por el FIR exacto
    del anexo si un certificador lo exige.
  - `compactarInformeAudio` existe pero **no se usa todavía** en los comandos `analysis.*` (los informes guardados en el
    job store incluyen las series). Cablearlo en `render-commands`/job-store sería trabajo de A7b/A9.
- Comandos útiles (desde el worktree `C:\src\jaswave-ia\.claude\worktrees\agent-a5d27e97cd1d07fb3`):
  - `cd shared && npx vitest run src/audio` (29 tests, ~2 s)
  - `cd shared && npm run typecheck`
  - `cd jas-wave && npx tsc -b --noEmit`
  - `npm run lint` (raíz del worktree)
- Archivos tocados: `shared/src/audio/{loudness-bs1770,mix-analysis}.ts` (reescritos), nuevos
  `shared/src/audio/{fft,true-peak,spectrum,stereo,transients}.ts`, tests
  `{loudness-bs1770,mix-analysis,spectrum,stereo,transients,true-peak}.test.ts`,
  `shared/src/commands/analysis-commands.ts`, `shared/src/index.ts`, `docs/plans/{A7a-medicion-dsp,STATUS}.md`.
