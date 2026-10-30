# E1/E2 · Motor de audio estable e instalador autónomo

**Objetivo:** que importar y reproducir audio no tumbe la app ni falle en silencio, y que el instalador funcione en una PC limpia.

## Causas encontradas
- Al reproducir, el clip decodificado completo viajaba al host como **un único string base64** (`clip.load` con `pcmBase64`): 5 min ≈ 154 MB, UI congelada
  y, pasados ~17-23 min, `RangeError` (límite de string de V8) tragado → el clip no sonaba. Se reenviaba entero en cada play/seek.
- `clip.load` tenía timeout de 30 s y, al vencer, el bridge mataba el host.
- Los clips importados llevan `sourceId` relativo (`media/x.wav`); el host no lo resuelve, así que la carga por ruta siempre fallaba.
- `ma_decoder_init_file` (ANSI) fallaba con acentos/ñ; `float tmp[4096*8]` desbordaba con >8 canales; `std::vector` en el callback de mezcla.
- `getNumberField` copiaba el resto de la línea (`substr`) por cada campo numérico.
- `jaswave-plugin-host.exe` dependía de `VCRUNTIME140/MSVCP140`: en una PC sin el redistribuible no arrancaba, caía a `node-host.cjs`
  (sin `clip.load`) y nunca sonaba.

## Hecho
- [x] Host: `clip.loadBegin/loadChunk/loadEnd` (orden estricto, tope 3 GB, 64 canales), `clip.has`, ruta UTF-16, decodificación por trozos con
      buffer en heap, mezcla por bloques sin alocar, `getNumberField` con `strtod`.
- [x] Renderer: `hostClipEnsureBuffer` (trozos de 131 072 frames, cede a la UI entre trozos, deduplica subidas, reutiliza lo ya cargado preguntando
      a `clip.has`, así un reinicio del host fuerza resubida); `hostClipLoadPcm` ahora también va por trozos.
- [x] Bridge/guard: nuevos comandos permitidos; `clip.load*` con timeout blando (no mata el host).
- [x] Avisos visibles (`comando.fallido`): importar sin try/catch, copia al proyecto fallida, clip no cargado en el host, motor nativo no armado.
- [x] E2: host enlazado con `/MT` (`CMAKE_MSVC_RUNTIME_LIBRARY`, `SMTG_USE_STATIC_CRT`): solo depende de DLLs del sistema (verificado con dumpbin).
      Instalador regenerado con `stage:host:strict`.
- [x] Pruebas: `native/plugin-host/scripts/clip-smoke.cjs <host.exe> [minutos]` (30 min, orden, ruta con acentos, ruta relativa) y
      `jas-wave/src/lib/plugin/host-transport-clips.test.ts`.

## Pendiente / notas de traspaso
- Reproducción **web** (sin Electron): `playClips` es solo-host y `ensureContext()` usa un `OfflineAudioContext`; falta un `AudioContext` de respaldo.
- Carga por ruta absoluta: requiere que el renderer resuelva `media/…` contra la carpeta del proyecto (hoy se usa siempre el buffer decodificado).
- `ffmpeg` no va en el instalador (se invoca desde el PATH en `electron/main.ts`); exportar/convertir falla sin él.
- Sin firma de código: SmartScreen avisará. Los VST de JasWave se descargan bajo demanda (D1): la PC destino necesita red o paquetes `.jwx`.
- Build nativo: usar el CMake de Visual Studio (`.../CommonExtensions/Microsoft/CMake/CMake/bin`) en el PATH; `node native/scripts/build-native.mjs --no-fx`.
- Formatos: Chromium decodifica wav (16/24/32f), mp3, flac, ogg; **AIFF no**; m4a depende del códec. Fallo → mensaje claro.
