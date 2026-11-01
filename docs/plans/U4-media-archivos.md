# U4 · Media y archivos

**Objetivo:** el audio importado y grabado nunca se pierde (al guardar en otra carpeta, abrir en otro equipo o borrar la sesión)
y los archivos problemáticos se manejan con mensajes claros.

## Contexto y hallazgos
- Import (drag-drop `components/playback-provider.tsx:1302-1326`; IA `src/lib/audio-import-agent.ts:70-90`) usa claves en memoria
  `file-…`/`import-…` como `sourceId`; la rehidratación desde disco solo maneja grabaciones o rutas `.wav`
  (`playback-provider.tsx:963`); `audioReferences` siempre `{}` → tras nuevo proyecto/otra carpeta/otro PC los clips quedan mudos.
- Grabaciones: sin proyecto van a `userData/media/grabaciones` (`electron/main.ts` `recordings-dir`) pero `sourceId` se guarda
  relativo (`src/lib/audio-recording-persist.ts:44`) y se resuelve contra la carpeta del proyecto al cargar (`:74-78`) → se pierden
  tras el primer guardado en otra carpeta o "Guardar como". Fallos de escritura caen a memoria en silencio
  (`playback-provider.tsx:1160-1161`); media faltante se salta en silencio (`:969-988`); `verificarReferenciasAudio` solo hace
  `console.warn` (`shared/src/project/persistencia.ts`).
- Import sin límites: decodifica el archivo entero en el renderer (`lib/audio-engine.ts:693-699`); permite clip de audio en pista
  MIDI (`components/arrangement/ArrangementView.tsx:1701-1706`) y mover clips a pistas incompatibles (`clip.move`); multi-drop usa
  solo el primero; drop no-audio → error crudo + rechazo no capturado (`playback-provider.tsx:1334-1338`).
- Errores de disco crudos (`EACCES…`) en `main.ts` (handlers `file-save*`).

## Tareas
- [x] Servicio `src/lib/project-media.ts`: `importMediaFile(file|path)` copia el archivo a `<proyecto>/media/` (si no hay proyecto:
      `userData/media/pending/` y se mueve al primer guardado), devuelve ruta relativa `media/<nombre-único>`; usado por drag-drop,
      `audio.import`, `reference.import` y grabación. IPC nuevo en main `media-copy {src, destDir}` validado con `path-grants`.
- [x] `clip.create` audio guarda `sourceId` relativo + entrada en `audioReferences`; carga resuelve relativo a la carpeta del proyecto.
- [x] "Guardar como" / primer guardado: copiar `media/` (y `pending/`) a la carpeta nueva; actualizar rutas.
- [x] Al abrir: si `verificarReferenciasAudio` reporta faltantes → diálogo "Media faltante" (lista + "Buscar en carpeta…" que
      intenta encontrar por nombre y re-enlaza; "Ignorar").
- [x] Grabación: si falla el WAV → toast + reintento en `userData/media/grabaciones`; nunca solo memoria sin aviso.
- [x] Validaciones de import: extensión (wav, aif/aiff, flac, mp3, ogg, m4a), tamaño/duración (aviso > 20 min, rechazo > 2 h o > 2 GB),
      tipo de pista compatible (crear pista de audio nueva si se suelta sobre MIDI); multi-drop → una pista por archivo;
      error de decodificación → mensaje amigable sin rechazo no capturado.
- [x] `clip.move` valida compatibilidad pista/clip (se apoya en U3).
- [x] Traducir errores de disco en main (`EACCES`→"Sin permiso para escribir en …", `ENOSPC`→"Disco lleno", `EBUSY`/`EPERM`→"Archivo en uso").
- [x] Tests: unit de rutas relativas/copias; e2e: importar WAV → guardar en carpeta A → "Guardar como" carpeta B → borrar A →
      reabrir B → el clip suena (bounce no silencioso).

## Archivos
`jas-wave/src/lib/{audio-import-agent,audio-recording-persist,project-io}.ts`, nuevo `src/lib/project-media.ts`,
`components/playback-provider.tsx`, `components/arrangement/ArrangementView.tsx`, `lib/audio-engine.ts`, `electron/main.ts`,
`shared/src/project/{persistencia,ciclo-vida}.ts`, `shared/src/commands/domain-commands.ts`.

## Verificación
`npm run verify`; e2e del escenario anterior; `cd jas-wave && npm run e2e`.

## Notas de traspaso

Estado: **hecho** (rama `ws/u4-u7`, 2026-10-21). Último commit: `1e689ff`.

Decisiones:
- El audio importado o grabado se **copia** dentro del proyecto: `<proyecto>/media/<nombre>`.
  El proyecto guarda la ruta **relativa** (`media/intro.wav`), así que el mismo proyecto funciona
  en otra carpeta, otro disco u otro equipo.
- Sin proyecto guardado, el archivo va a `userData/media/pending/` (ruta relativa
  `media/pending/<nombre>`) y se mueve a `<proyecto>/media/` en el primer guardado
  (`clip.setSource` reapunta el clip).
- Las grabaciones que no están dentro del proyecto se guardan en
  `userData/media/grabaciones/` con ruta **absoluta** (no se pierden al mover el proyecto).
- "Guardar como" copia el árbol `media/` del origen al destino; las rutas relativas no cambian.

Piezas nuevas:
- `shared/src/project/ciclo-vida.ts`: `MEDIA_REL_DIR`, `MEDIA_PENDING_REL_DIR`,
  `MEDIA_RECORDINGS_REL_DIR`, `normalizarRutaRelativa`, `esRutaMediaRelativa`,
  `formatoAudioDesdeRuta`, `unirRuta`, `referenciasAudioFaltantes`.
- `shared/src/commands/domain-commands.ts`: comando `clip.setSource` (reenlace de media)
  y `incompatibilidadPistaClip` (usado por `clip.move`).
- `shared/src/commands/project-commands.ts`: `project.load` devuelve `mediaFaltante` y
  emite `validacion.advertencia` con `code: 'MEDIA_FALTANTE'`.
- `jas-wave/src/lib/project-media.ts` + `project-media-flow.ts` + `media-faltante.ts`:
  rutas, copia, guardado como, media pendiente y solicitud de reenlace.
- `jas-wave/electron/media-service.ts`: copia/mueve/busca con nombres únicos y
  `traducirErrorDisco`; IPC `media-copy` y `media-buscar` (con `path-grants`).
- `jas-wave/components/media-faltante-dialog.tsx`: diálogo "Media faltante".

Gotchas para quien siga:
- `obtenerSolicitudMediaFaltante` debe devolver **la misma identidad** de objeto entre
  lecturas: `useSyncExternalStore` compara por `Object.is` y, si no, React renderiza
  sin fin (error #185) y el diálogo nunca aparece.
- En el renderer no se listan carpetas con rutas relativas: `file-list-dir` espera ruta
  absoluta (grant incluido).
- `clip.create` con `sourceId` relativo crea un clip de audio con `source.ruta` relativa;
  `derivarReferenciasAudio` la convierte en `audioReferences` al guardar.
