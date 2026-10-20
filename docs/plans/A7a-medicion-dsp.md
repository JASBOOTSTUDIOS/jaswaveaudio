# A7a · Medición DSP correcta

**Objetivo:** mediciones de nivel profesional y correctas (base de todas las decisiones del ingeniero).

## Contexto y hallazgos
- `shared/src/audio/loudness-bs1770.ts`: K-weighting con coeficientes fijos de 48 kHz (`:36-42`) aplicados a 44–50 kHz (`:88`);
  true-peak 4× por interpolación **lineal** (`:91-105`) = sample peak; momentary/short-term = último bloque (`:146-147`);
  LRA percentil sin gating EBU (`:149-156`); `LOUDNESS_TARGETS` solo streaming/club/cd (`:169-173`).
- `shared/src/audio/mix-analysis.ts`: espectro de 10 bandas con **una** FFT de 4096 muestras del centro (`:106-116`); crest factor
  `peakDb − (integrated+0.691)` (`:186`); correlación global (`:49-73`); clipping ≥0.999 (`:75-83`);
  `buildAudioListenReport` (`:201-245`) solo clipping/TP/correlación/objetivo.

## Tareas
- [ ] K-weighting por sample rate (diseño de los dos biquads de BS.1770 por fórmula bilineal para cualquier fs).
- [ ] True-peak: sobremuestreo 4× con FIR polifásico (≥48 taps) según BS.1770-4 Anexo 2.
- [ ] Momentary (400 ms) y short-term (3 s) como **series temporales** + máximos; integrated con gating absoluto −70 y relativo −10.
- [ ] LRA EBU Tech 3342 (gating absoluto −70 LUFS y relativo −20 LU, percentiles 10–95 de short-term).
- [ ] Crest factor real (pico/RMS en dB) global y por ventana; RMS por ventana; PLR (peak-to-loudness ratio).
- [ ] Espectro promediado (Welch: ventana Hann 8192, 50 % solape, toda la señal) en **1/3 de octava** (31 bandas) + agregados
      (sub 20–60, low 60–250, lowmid 250–500, mid 500–2k, highmid 2–6k, high 6–20k).
- [ ] Estéreo: correlación por banda, mid/side energía y ancho, balance L/R; compatibilidad mono (pérdida en dB al sumar).
- [ ] Transientes: densidad de onsets (flujo espectral) y tiempo de ataque medio.
- [ ] Objetivos por plataforma en `loudness-bs1770.ts`: `spotify −14 LUFS/−1 dBTP`, `apple −16/−1`, `youtube −14/−1`,
      `amazon −14/−2`, `club −8/−0.3`, `broadcast −23/−1 (EBU R128)`, `cd −9/−0.3`; mantener alias `streaming`.
- [ ] Ampliar `buildAudioListenReport` con nuevas métricas (sin romper consumidores: campos nuevos opcionales).
- [ ] Tests con señales de referencia: seno 1 kHz −20 dBFS (RMS/peak exactos), ruido rosa (espectro plano en 1/3 oct ±1 dB),
      señal EBU de prueba 1 kHz → −23 LUFS ±0.1, inter-sample peak (seno fs/4 desfasado 45°: TP > sample peak ≈ +3 dB),
      44.1/48/96 kHz dan el mismo LUFS para la misma señal.

## Archivos
`shared/src/audio/{loudness-bs1770,mix-analysis}.ts` (+ nuevos módulos `spectrum.ts`, `stereo.ts`, `transients.ts`),
`shared/src/audio/*.test.ts`, consumidores en `shared/src/commands/analysis-commands.ts`.

## Criterios de aceptación
- Todos los tests de referencia pasan; ningún consumidor existente se rompe.

## Verificación
`cd shared && npx vitest run src/audio`; `npm run verify`.

## Notas de traspaso
_(vacío)_
