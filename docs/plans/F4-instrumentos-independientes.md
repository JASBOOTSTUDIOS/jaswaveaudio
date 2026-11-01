# F4 — Suite de 6 instrumentos VST3 independientes (+ réplica web; el 7.º, Ambient Atmos, sigue el mismo contrato)

Cada instrumento es **un VST3 propio e independiente** (un plugin = un instrumento, sin compartir motor entre
instrumentos) con su **versión web** (AudioWorklet) del mismo diseño sonoro. Sustituye a la implementación de
174a40c, que no compilaba y quedaba muda (ver auditoría en `docs/hallazgos-recientes/`).

## Instrumentos y carpetas
| Slug | Carpeta | Target CMake (ya existente) |
|---|---|---|
| grand-piano | `plugins/com.jaswave.plugin.grand-piano` | `JasWaveGrandPiano` |
| worship-drums | `plugins/com.jaswave.plugin.worship-drums` | `JasWaveWorshipDrums` |
| electric-bass | `plugins/com.jaswave.plugin.electric-bass` | `JasWaveElectricBass` |
| electric-guitar | `plugins/com.jaswave.plugin.electric-guitar` | `JasWaveElectricGuitar` |
| shimmer-pad | `plugins/com.jaswave.plugin.shimmer-pad` | `JasWaveShimmerPad` |
| strings-section | `plugins/com.jaswave.plugin.strings-section` | `JasWaveStringsSection` |
| ambient-atmos (7.º) | `plugins/com.jaswave.plugin.ambient-atmos` | `JasWaveAmbientAtmos` |

(Confirma el nombre real del target en cada `CMakeLists.txt`.)

## Patrón obligatorio: `plugins/com.jaswave.plugin.piano-synth`
Lee **completos** `piano_plugin.cpp`, `piano_dsp.h`, `plugins/shared-dsp/jw_vst3.h`, `jw_dsp.h`, `jw_params.h`,
`plugins/shared-ui/jw_ui_plantilla.h` y `plugins/CONTRATO-V5.md`. Reglas:
1. `Processor : JwProcessor` implementa **`prepare`, `resetDsp`, `updateParams` y las dos `render(...)`** (float y double,
   vía `template renderT`). **No sobrescribas `process()`**: la base aplica parámetros, licencia, denormales y 32/64 bit.
2. Eventos MIDI con **precisión de muestra** (`sampleOffset`), como `renderT` del piano. Soporta además: pitch bend
   (`Event::kLegacyMIDICCOutEvent` de entrada con controlNumber 129 = bend, o el mapeo que use piano-synth si existe;
   si no hay, usa `IMidiMapping` en el `Controller::midiCcParam` para CC1/CC11/CC64 → parámetros) y CC64 sustain.
3. `Controller : JwController` implementa `createEditor()` (Editor con `Plantilla`, medidores y teclado/visualizador
   como el piano). El **botón RESET** de la cabecera ya lo aporta la vista compartida (`jw_ui_view.cpp`) a todos los
   plugins: no lo reimplementes, comprueba en la captura que aparece.
4. `PlugType` solo de los que existen en el SDK: `kInstrumentPiano`, `kInstrumentDrum`, `kInstrumentSynth`,
   `kInstrumentSampler`, `kInstrumentSynthSampler`, `kInstrument`. (No existen `kInstrumentBass/Guitar/Strings`.)
5. Tiempo real: **sin asignaciones, locks ni excepciones en `render`**; todo preasignado en `prepare`. Sin `rand()`:
   usa un PRNG propio (xorshift) por voz. `ScopedNoDenormals` ya lo pone la base. Suavizado con `Smoother`
   (`jw_dsp.h`: usa `advance(n)`). Robo de voces: la **más antigua**, con fundido corto (≈5 ms), sin clics.
6. Calidad de sonido **orgánica**: nada de «onda pura repetida». Variación por nota (microdesafinación ±cents,
   fase, ruido de ataque, round-robin con semillas), respuesta a velocidad (timbre, no solo volumen), liberación
   realista, resonancia de cuerpo/sala. Salida con **soft-clip/limitador suave**, nunca `clamp` duro, y sin DC.
7. Reverbs/espacios: usa una red de retardos realimentada (FDN o Schroeder con difusores) con amortiguación; **no**
   integradores de un polo. Comprueba estabilidad con `fb < 1` en cualquier rango de parámetros.
8. Todos los rangos de parámetros del manifiesto `jaswave-plugin.json` ↔ `paramDefs()` ↔ DSP ↔ worklet web deben
   coincidir. Las **funciones premium** (features) por licencia siguen el patrón del piano (`feature(...)`; sin
   concesión el valor cae al defecto).
9. El plugin debe funcionar a 44.1/48/88.2/96/176.4/192 kHz y bloques de 1 a 4096 muestras sin lecturas fuera de
   rango ni NaN/inf.

## Versión web (AudioWorklet) — mismo instrumento, mismo diseño
Archivo `web/<slug>-worklet.js` dentro de la carpeta del plugin, **autocontenido**, sin imports:
- Clase `Motor` pura (sin APIs de AudioWorklet) con `constructor(sampleRate)`, `setParam(id, plainValue)`,
  `noteOn(nota, vel)`, `noteOff(nota)`, `pitchBend(semitonos)`, `cc(num, valor)`, `panic()`, `render(outL, outR, n)`.
- Al final: `if (typeof registerProcessor !== 'undefined') registerProcessor('jaswave-<slug>', class extends AudioWorkletProcessor {...})`
  y `if (typeof module !== 'undefined') module.exports = { Motor }`.
- Mensajes del puerto: `{tipo:'param', id, valor}` (`id` = ParamID numérico del VST3, `valor` = valor plano),
  `{tipo:'on', nota, vel, cuando}`, `{tipo:'off', nota, cuando}` (`cuando` en segundos del `AudioContext`, igual que
  `jas-wave/lib/web-synth/web-synth-processor.js`: lee ese archivo para el manejo sample-accurate), `{tipo:'panico'}`,
  `{tipo:'bend', valor}`, `{tipo:'cc', num, valor}`.
- Mismo algoritmo y mismos nombres/rangos de parámetros que el VST3 (portado a JS con `Float32Array` preasignados;
  sin asignaciones en `render`).
- Test `web/<slug>.test.mjs` (`node:test`): renderiza offline notas y comprueba f0 (YIN o autocorrelación) con error
  < 15 cents, ausencia de NaN/inf, nivel (pico < 0,98 y RMS razonable), decaimiento, silencio tras `panic`, y que
  `setParam` cambia el timbre/nivel. Ejecútalo con `node --test plugins/com.jaswave.plugin.<slug>/web`.
- Manifiesto: `targetPlatforms: ["win-x64","web"]`, `entrypoints.dspWeb: "web/<slug>-worklet.js"`.

## Verificación nativa (obligatoria, sin oír: medir)
Cada plugin incluye en su carpeta `test/render_test.cpp` + un target `<Target>_rendertest` en su `CMakeLists.txt`
que incluye solo el `*_dsp.h` (sin VST3) y: renderiza una frase de ≥6 notas (rango bajo/medio/alto, varias
velocidades), escribe un WAV 24-bit/48k estéreo en la ruta pasada por argumento, e imprime: f0 por nota vs esperado
(cents), pico, RMS, tiempo de CPU por segundo de audio (debe ser < 5 % de un núcleo a 48 kHz con 16 voces), y
comprueba no-NaN, ausencia de clics (derivada máxima) y de DC. Sal con código ≠ 0 si algo falla.
Compila y pasa: `cmake -S plugins/<carpeta> -B plugins/build_<slug> -G "Visual Studio 17 2022" -A x64` seguido de
`cmake --build plugins/build_<slug> --config Release --target <Target>` y `<Target>_rendertest` y `<Target>_snapshot`.
Genera capturas con `plugins/build_<slug>/tools/Release/<Target>_snapshot.exe --out <dir> --name <slug>` y revísalas
(la imagen debe mostrar el editor con el botón RESET en la cabecera).

## Fuera de tu alcance (lo integra el agente raíz)
No edites: `plugins/CMakeLists.txt`, `plugins/shared-*/**`, `plugins/scripts/**`, `plugins/tests/**`, `jas-wave/**`,
`shared/**`, ni los manifiestos de otros plugins. Si necesitas un cambio compartido, descríbelo en tu informe.
No hagas commit. Hay cambios sin confirmar de otros procesos en el árbol: no los reviertas.

## Informe final de cada agente
Archivos creados/modificados, resultados medidos (tabla f0/cents/pico/RMS/CPU), rutas de los WAV y capturas,
pruebas web ejecutadas y su salida, y lo que **no** pudiste verificar.
