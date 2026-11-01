# F4 · FX Rack comun — guia de integracion por plugin

> Cada instrumento propio lleva el MISMO rack de mezcla integrado: paso-altos/bajos, ecualizador parametrico de
> 6 bandas, compresor, saturacion, chorus, delay (sync al tempo), reverb y anchura, con ids y nombres estandar,
> pagina «MIX / FX» en el editor nativo y en la replica web. Piloto verificado: `shimmer-pad`.
> Todo va **apagado por defecto**: integrar el rack no cambia el sonido hasta que el usuario lo activa
> (con todos los bloques en Off el rack no toca el buffer: salida identica bit a bit).

## 1. Que hay (archivos)

| Archivo | Para que |
|---|---|
| `plugins/shared-dsp/jw_fxrack.h` | DSP C++17 (`JasWaveFx::FxRack`), tabla de parametros (`registrarParametros`), `FxParams::leer`, respuesta analitica del EQ |
| `plugins/shared-ui/jw_fxrack_page.h` | Pagina «MIX / FX» del editor Cyber: `Plantilla::paginaMixFx(c)` (+ boton de cabecera y RESET FX) |
| `plugins/shared-dsp/web/fxrack.js` (+ `fxrack.test.mjs`) | Mismo rack en JS (AudioWorklet), 17 pruebas `node:test` |
| `plugins/lib/ui-cyber/src/fxrack.ts` | Replica web de la pagina: respuesta del EQ, perillas que siguen a la banda; dibujo en `dibujo.ts`, gestos en `editor.ts` |
| `plugins/scripts/fxrack-ids.mjs` | Fuente unica (JS) de ids/nombres/rangos/defaults estandar |
| `plugins/scripts/fxrack-integrar.mjs` | Pasos mecanicos: manifiesto (58 `ai.parameters`) + copia del rack en el worklet |
| `plugins/scripts/fxrack-comprobar.mjs` | Verifica los 8 bloques con ids/nombres estandar (manifiesto, codigo, layout, worklet y, con `--dump`, el binario) |

Cambios aditivos en compartidos: `MeterBusBase::fxGrDb` (jw_dsp.h), `Widget::pagina` / `Widget::layoutExtra()` /
`EditorContext::suppressPanels` / `gPaginaInicial` (jw_ui.h), 4 guardas `suppressPanels` + volcado de `pagina` (jw_ui_view.cpp),
`--page N` (snapshot), `--solo-web`, `validarPaginaMixFx` (ui-layout.mjs).

## 2. Ids estandar (base fija `FXR_BASE = 100`, igual en TODOS los plugins)

Bloque contiguo AL FINAL de la lista de parametros. Id = `100 + offset`; nombres `FX · <bloque> <parametro>` (con punto medio).
Rango reservado: 100..243 (el plugin NO puede usar ids >= 100 para lo suyo).

| Bloque | offsets | Parametros (nombre tras `FX · `) |
|---|---|---|
| A filtros | 0..5 | `HPF On`, `HPF Freq` (20..1k Hz, 80), `HPF Slope` (12/24 dB/oct), `LPF On`, `LPF Freq` (1k..20k, 16k), `LPF Slope` |
| B EQ | 16, 17..34 | `EQ On`; `EQ Band n Freq` / `Gain` (±18 dB) / `Q` para n=1..6 (1 = low shelf, 2-5 = campanas, 6 = high shelf); id banda n = 17 + 3(n-1) + {0 Freq, 1 Gain, 2 Q} |
| C compresor | 48..55 | `Comp On`, `Threshold` (-60..0, -18), `Ratio` (1..20, 3), `Attack` (0.1..200 ms, 10), `Release` (10..2000 ms, 120), `Knee` (0..24, 6), `Makeup` (0..24), `Mix` (0..100 %, 100) |
| D saturacion | 64..68 | `Sat On`, `Sat Type` (Tape/Tube), `Sat Drive` (30 %), `Sat Tone` (1k..20k, 12k), `Sat Mix` |
| E chorus | 80..83 | `Chorus On`, `Depth` (40), `Rate` (0.05..5 Hz, 0.6), `Mix` (35) |
| F delay | 96..102 | `Delay On`, `Sync` (Free, 1/4, 1/8, 1/8., 1/16), `Time` (20..2000 ms, 350), `Feedback` (0..90, 35), `Tone` (500..16k, 5k), `Mix` (25), `Ping-Pong` |
| G reverb | 112..117 | `Reverb On`, `Type` (Plate/Hall/Room, Hall), `Size` (50), `Damping` (50), `Pre-Delay` (0..200 ms, 20), `Mix` (20) |
| H salida | 128..130 | `Out On`, `Out Width` (0..200 %, 100), `Out Gain` (-24..12 dB) |

Cadena fija: A → B → C → D → E → F → G → H, cada bloque con su `On` (fundido de 3 ms, sin clics). Delay y reverb suman a la seco
(`Mix` = nivel del efecto); chorus, saturacion y compresor mezclan seco/procesado. Sin latencia. Lista completa: `fxrack-ids.mjs`.
Si se pulsa `RESET` de la cabecera (todo el plugin) o `RESET FX` (solo el rack), vuelven a estos defaults.

## 3. Pasos por plugin

### 3.1 C++ (DSP + parametros) — unas 8 lineas

```cpp
// <plugin>_dsp.h
#include "jw_fxrack.h"
...paramDefs():  JW_FXRACK_REGISTRAR(v);              // justo antes de `return v;` (al FINAL de la lista)
...clase del motor:
    JasWaveFx::FxRack fx_;                              // miembro
    prepare(sr):  fx_.prepare(sr);      reset():  fx_.reset();
    void setFx(const JasWaveFx::FxParams& p) { fx_.setParams(p); }
    void setTempo(double bpm) { fx_.setTempo(bpm); }
    // En render(outL, outR, n, bus), DESPUES de generar la salida final y ANTES de bus->salida(...) / medidores:
    fx_.process(outL, outR, n, bus);                    // bus: MeterBusBase* (publica la reduccion del compresor)
```
```cpp
// <plugin>_plugin.cpp (Processor)
JasWaveFx::FxParams fxp_;                                                       // miembro
updateParams():  fxp_.leer([this](uint32_t id) { return plainOf(id); });  engine_.setFx(fxp_);
render*():       if (data.processContext && (data.processContext->state & ProcessContext::kTempoValid)) engine_.setTempo(data.processContext->tempo);
```
- Llamar a `process` en el **envoltorio** de render (no dentro de un camino que se salta en silencio) para que colas de delay/reverb suenen.
- Si el plugin mide picos tras el render, mide DESPUES del rack (ver `PadEngine::render`).
- `kInfiniteTail` / `tailSamples()`: el rack puede alargar la cola (reverb hall hasta ~10 s): un instrumento con cola finita debe tenerlo en cuenta.
- CMake: nada (`jaswave_add_vst3` ya incluye `shared-dsp` y `shared-ui`; el `_rendertest` debe incluir `${JW_PLUGINS_ROOT}/shared-dsp`).

### 3.2 Editor nativo — 2 lineas

```cpp
#include "jw_fxrack_page.h"
void build(JasWaveUI::EditorContext& c) override {
    ... widgets del plugin (incluidos medidores) ...
    JasWaveUI::Plantilla::paginaMixFx(c);   // SIEMPRE LA ULTIMA LLAMADA de build()
}
```
Anade el boton «MIX / FX» (x 484..568, y 48..68 de la cabecera; LED si hay algun bloque activo), oculta los widgets del plugin
y suprime su `drawPanels` mientras la pagina esta abierta, y restaura al volver. Opcional: `demoPreset()` con los ids FX para capturas.
Captura de la pagina: `<Plugin>_snapshot --out <dir> --name fx --page 1`.

### 3.3 Layout (replica web)

```bash
cmake --build plugins/build_<plugin> --config Release --target JasWave<Plugin>_snapshot
plugins/build_<plugin>/tools/Release/JasWave<Plugin>_snapshot.exe --dump-layout plugins/com.jaswave.plugin.<plugin>/ui-layout.json
node plugins/scripts/ui-layout.mjs --solo-web      # regenera la copia de com.jaswave.modulo.editores-vst/src/generado/layouts.json
node plugins/scripts/ui-layout.mjs --validar       # incluye validarPaginaMixFx: 58 ids, nombres, rangos, sin solapes
```
(Alternativa: `node plugins/scripts/ui-layout.mjs --build plugins/build` con los 14 snapshots compilados.)

### 3.4 Manifiesto + worklet web

1. En el worklet del plugin, una vez: linea `// @@fxrack` tras la tabla `PARAMS`, y justo debajo `fxRegistrarParametros(PARAMS, PARAM_IDS)`.
2. En `class Motor`: `this.fx = new FxRack(this.sr)` (constructor); `this.fx.reset()` en `reset()`; `setTempo(bpm) { this.fx.setTempo(bpm) }`;
   en `setParam`, antes del `switch`: `if (id >= FXR_BASE && id < FXR_BASE + FXR_RANGO) { this.fx.setParam(id, v); return }`;
   al final de `render(outL, outR, n, offset)`: `this.fx.process(outL, outR, n, offset)`. Mensaje de puerto `{tipo:'tempo', bpm}` → `motor.setTempo`.
3. `node plugins/scripts/fxrack-integrar.mjs <plugin>` (incrusta `fxrack.js` entre `// <<fxrack` y `// fxrack>>`, anade los 58 `ai.parameters`
   con su descripcion para la IA y la frase del rack en `ai.summary`/`description`; `--check` no escribe).
4. Si el test del worklet exige `man.ai.parameters.length === PARAMS.length`, ya cuadra (ambos suman 58).

### 3.5 Pruebas (copiar de `shimmer-pad`)

- `test/render_test.cpp`, seccion «[7] FX Rack»: ids/nombres/defaults, **neutralidad bit a bit** (hash FNV de un render determinista con el
  rack apagado == hash SIN rack: obtener el hash de referencia ANTES de integrar), EQ por banda, compresor, THD, delay/sync, reverb 60 s,
  chorus, barrido NaN (44.1–192 kHz × bloques 1–4096), clics, CPU. Las pruebas del rack solo usan `jw_fxrack.h`: copiables tal cual cambiando `PadEngine` por el motor.
- `web/<plugin>.test.mjs`: bloque «FX Rack» (58 ids registrados, apagado = bit a bit, encendido cambia, tempo, sin NaN).

## 4. Verificacion (todo debe pasar)

```bash
node plugins/scripts/fxrack-comprobar.mjs <plugin> --dump plugins/build_<plugin>/tools/Release/JasWave<Plugin>_snapshot.exe   # 8 bloques OK
node plugins/scripts/fxrack-comprobar.mjs --todos                                                                           # estado de los 7
node plugins/scripts/ui-layout.mjs --validar
node --test plugins/shared-dsp/web/fxrack.test.mjs plugins/com.jaswave.plugin.<plugin>/web/<plugin>.test.mjs
(cd plugins/lib/ui-cyber && npx vitest run && npx tsc --noEmit)
(cd plugins/com.jaswave.modulo.editores-vst && npm test && npx tsc --noEmit)
cmake --build plugins/build_<plugin> --config Release --target JasWave<Plugin>_rendertest JasWave<Plugin>
plugins/build_<plugin>/tools/Release/JasWave<Plugin>_rendertest.exe salida.wav      # incluye [7]
plugins/build/bin/Release/validator.exe <ruta .vst3>                                 # 47/47
```

## 5. Resultados del piloto (shimmer-pad, 48 kHz, medidos)

EQ: desviacion ≤ 0.001 dB en 12 casos (6 bandas × ±9 dB); Q medido 0.70/2.01/6.01 para 0.7/2/6; HPF/LPF -3.01 dB en fc, -12.3 / -24.1 dB a una octava.
Compresor: -8 dBFS con umbral -20 y 4:1 → -16.94 (esperado -17.0), GR 8.94 dB; 10:1 → -18.72 (esperado -18.8).
Saturacion: THD 1.0/3.6/11/23/37 % para drive 10/30/50/70/100; cinta H3/H2 > 10, valvula H2 0.16.
Delay: 300.00 ms exactos; sync @120 bpm 500/250/375/125 ms; ping-pong L→R correcto. Reverb: RT60 plate 0.5–1.4 s, hall 1.2–3.0 s, room 0.24–0.57 s;
ruido 60 s: 0.00 dB de deriva, sin NaN. CPU del rack completo (9 bloques, estereo, 48 kHz, reloj de pared, minimo de 3 pasadas): 1.4 % con la maquina en reposo y hasta 3.7 % con otros procesos compilando
(limite de la prueba: < 4 %); a 96 kHz 3.3–9 % (escala con la tasa). Desglose a 48 kHz (maquina cargada): reverb 1.2, saturacion 0.7, chorus 0.7, EQ 0.6, comp 0.6, delay 0.4, filtros 0.3, salida 0.2 %.
Rack apagado: hash identico al motor previo (`0x4e902380394f155d`). validator 47/47.

## 6. Limitaciones / pendiente

- No se oyo nada: toda la validacion es por metricas objetivas; falta escucha de calidad (saturacion ADAA sin sobremuestreo, reverb sin reflexiones tempranas, chorus de 3 voces).
- La pagina nativa se verifico por captura (`--page 1`) y logica de gestos por lectura, no con raton en un DAW; la replica web solo con pruebas unitarias del layout, la matematica y un contexto Canvas simulado (no en navegador).
- La replica web no procesa audio en el editor (el medidor GR muestra «—»); el rack web corre en el worklet del plugin.
- Un `getState` antiguo (sin ids 100+) carga con los defaults del rack (apagado). Las sesiones guardadas con el rack encendido necesitan este mismo build para sonar igual.

## Notas de traspaso

- Integrado y verificado: `shimmer-pad`. Pendientes (los integra el coordinador cuando terminen sus agentes): `grand-piano`, `worship-drums`, `electric-bass`, `electric-guitar`, `strings-section`, `ambient-atmos`.
- Orden recomendado por plugin: hash de referencia → 3.1 → 3.2 → 3.3 → 3.4 → 3.5 → seccion 4. `fxrack-comprobar.mjs` indica que falta.
- No desplegar el `.vst3` desde estos scripts (`deploy_vst3.ps1` lo hace el coordinador).
