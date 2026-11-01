# A7c · Actuar con valores reales (dB, Hz, ms, ratio)

**Objetivo:** que el agente ajuste plugins con valores físicos ("threshold −18 dB", "corte 3.2 kHz −2 dB Q 1.4") y sepa qué hace
cada parámetro de EQ/compresor/limitador.

## Contexto y hallazgos
- `plugin.setParameter` solo `normalizedValue`/`delta` (`jas-wave/src/lib/ai-daw-agent.ts:2514-2551`); host `setParameter`
  normalizado (`native/plugin-host/src/main.cpp:2003-2017`); `plainValue` en el schema pero ignorado
  (`shared/src/commands/plugin-commands.ts:570-630`).
- `listParameters` ya devuelve `id, name, unit, displayValue, normalized, default, stepCount, flags` (`vst3_slot.cpp:521-550`).
- `plugin-parameter-intel.ts` `TAG_RULES` (`:29-50`) orientado a sintes; sin threshold/ratio/knee/makeup/ceiling/bandas EQ.
- Contexto de mezcla para el modelo: `vol=0.80 pan=0.00` lineal (`ai-harness/src/loop/harness.ts:375,391`); ganancias ocultas ×2 y ×1.35.

## Tareas
- [ ] VST3 (`vst3_slot.cpp`): exponer `normalizedParamToPlain`, `plainParamToNormalized` y `getParamValueByString`/
      `getParamStringByValue`; comandos host `setParameterPlain {slotId, paramId, plain}` y
      `setParameterText {slotId, paramId, text}` (usa `getParamValueByString`), ambos responden el `displayValue` resultante.
      VST2: aproximación por búsqueda binaria sobre `getParameterDisplay` (documentar límites).
- [ ] Allowlist del host (`electron/plugin-host-guard.ts`) con los nuevos comandos.
- [ ] `plugin.setParameter` acepta `plainValue` | `displayValue` (texto con unidad) | `normalizedValue`; verifica leyendo el
      `displayValue` y devuelve `{antes, despues, unidad}`; si no converge, error explicativo.
- [ ] Perfiles semánticos en `plugin-parameter-intel.ts`: detectar rol del plugin (eq, comp, limiter, deesser, gate, reverb, delay,
      saturación, utilidad) y mapear parámetros a claves canónicas: EQ `band[i].{freq,gain,q,type,enabled}`; comp
      `{threshold,ratio,attack,release,knee,makeup,mix,sidechainHpf}`; limiter `{ceiling,threshold|gain,release,lookahead}`;
      con reglas por nombre + base JSON por plugin (`src/lib/plugin/processor-profiles.json`, ampliable) reutilizando
      `compatibility-db.ts`/`known-vst-aliases.ts`.
- [ ] Herramientas semánticas: `mix.eq {trackId, bandas:[{freq, gain, q, type}]}`, `mix.compress {trackId, threshold, ratio,
      attack, release, makeup?, knee?}`, `mix.limit {ceiling, gainIn}` → eligen/insertan el procesador (preferir FX JasWave, A7d) y
      fijan parámetros por claves canónicas; `plugin.describe {slotId}` → mapa semántico con valores actuales en unidades.
- [ ] Gain staging en contexto del agente: volúmenes y envíos en **dB** (`linealADb` de `jas-wave/lib/audio-conversions.ts`),
      cadena por pista con parámetros clave, buses y sends; acción `clip.gain {clipId, db}` (comando nuevo, undoable).
- [ ] Ganancias ocultas del host: documentar en `00-contexto.md` y decidir (recomendado: mantener ×2 solo si es compensación
      conocida y exponerlo al agente; quitar ×1.35 post-master o moverlo a un trim visible).
- [ ] Tests: conversión plain/normalized en un VST3 propio (Roles/Piano o FX A7d); `mix.eq` sobre perfil JSON de prueba;
      `plugin.setParameter displayValue:"-18 dB"` converge.

## Archivos
`native/plugin-host/src/{main.cpp,vst3_slot.cpp,vst2_slot.cpp}`, `jas-wave/electron/plugin-host-guard.ts`,
`src/lib/plugin/{plugin-parameter-intel,track-vst-runtime}.ts`, nuevo `src/lib/plugin/processor-profiles.json`,
`src/lib/{ai-daw-agent,agent-action-catalog}.ts`, `shared/src/commands/{plugin,domain}-commands.ts`, `ai-harness/src/loop/harness.ts`.

## Verificación
`npm run native:build`; `npm run verify`; CLI: `daw-cli action plugin.setParameter '{"…","displayValue":"-12 dB"}'`.

## Notas de traspaso
_(vacío)_
