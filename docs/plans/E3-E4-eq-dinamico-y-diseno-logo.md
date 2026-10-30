# E3/E4 · EQ dinámico y diseño cyber galáctico con la paleta del logo

## E3 · EQ dinámico (hecho)
- VST `com.jaswave.plugin.param-eq`: pool de **24 slots** con IDs estables (0..43 y bandas 1..8 intactos; bandas 9..24 desde 400; extras por banda desde 100:
  usada, pendiente propia, modo stereo/mid/side/L/R, solo). Tipo band-pass. Alta/baja de banda = marcar el slot (limitación de VST3: lista de
  parámetros fija, así la automatizan Reaper y otros DAW). Estado: sin cambios de formato (pares id/valor; los IDs nuevos los ignoran versiones antiguas).
- Medición por banda (solo con el editor abierto): nivel real que entra/sale de cada banda en su región (pasa-banda); aporte = salida − entrada.
  Editor: tira paginada con barras IN/OUT y Δ, monitor de banda y resumen "AJUSTES" (lo cambiado frente a fábrica); doble clic añade, Mayús+doble clic quita.
- `shared/src/audio/eq-dinamico.ts`: modelo único de banda, mapeo a IDs del VST, diferencias auditables, perfil para la IA.
  Comandos `pista.eq.banda.agregar/editar/quitar`; corregido el undo de `pista.eq.agregar`; migración de códigos de tipo del esquema 1.
- IA: `mix.eq` con `accion: ajustar|agregarBanda|quitarBanda|estado`; corregido que descartaba toda clave por nombre; cambios auditados en `mezcla.eqCambiado`.
- Pruebas: `jw_dsp_selftest` (91), `jas-wave/src/lib/plugin/eq-contrato.test.ts` (TS ↔ manifiesto), `shared` (comandos y módulo), validador VST3 47/47 en los 7 VST.

## E4 · Diseño (hecho)
Paleta medida del PNG (negro, violeta `#8A4DFF`, azul `#3D5BFF`, cian `#19D9FF`, plata), marca JAS|WAVE con degradado, fondo galáctico
(nebulosas + estrellas), paneles translúcidos. Aplicado en `shared-ui` (nativo), `lib/ui-cyber` (web), `globals.css`, portal y `DESIGN.md`.

## Pendiente / traspaso
- Los cambios hechos en el editor NATIVO no se notifican a la app (`vst3_slot.cpp`): la auditoría completa cubre IA y comandos; falta evento host→app.
- La réplica web del EQ (`ui-cyber`) usa los widgets genéricos: falta portar curva/nodos/tira de bandas (`designBand` a TS) y un EQ real en Web Audio.
- Dinámica por banda (umbral/ratio) no implementada. Nombres de banda no persisten.
- Despliegue local de VST: `plugins/deploy_vst3.ps1` (tras `limpiar-vst-antiguos.ps1`). No se ha ejecutado.
