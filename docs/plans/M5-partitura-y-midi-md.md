# M5 — Partitura y MIDI·MD como paquetes independientes

**Depende de:** M3 · **Estado:** ver STATUS.md

## Hecho

- [x] `plugins/com.jaswave.modulo.midi-md`: panel y sincronización clip MIDI ↔ .md; acción «Abrir MIDI · MD» en el
      menú de clip y la barra del piano roll (contribución); prueba de contrato `test/sync.test.ts`.
- [x] `plugins/com.jaswave.modulo.partitura`: editor, vista previa, exportación PDF (vexflow, pdf-lib — ya no son
      dependencias del DAW); servicio `partitura` que usan las acciones `score.exportClip` / `score.exportProject`
      (sin el módulo informan de que falta); diálogo y escucha del menú Archivo como componentes globales.
- [x] Host: API de archivos para módulos (`src/modulos/api-archivos.ts`), servicios de módulos
      (`servicioDeModulo`), componentes globales (`ComponentesDeModulos`), núcleo sin referencias fijas a ambos.
- [x] Pruebas: contrato de cada módulo, `src/modulos/servicios-modulos.test.ts`, e2e `16-modulos`.

## Pendiente

- El asistente IA sigue en `src/modulos/integrados.tsx` hasta M4.
