# W2 — WebSynth y stem freezing para VST en web

**Depende de:** W1
**Fuente:** Documento Maestro V5 (`JasWave DAW — Arquitectura Integral…V5.md`) y decisiones del usuario (ver memoria `v5-decisiones-usuario`).

## Archivos principales
`jas-wave/lib/web-synth/`, `jas-wave/src/lib/plugin/vst-voice-router.ts`

## Criterios de aceptación
Pistas VST reproducen con WebSynth sin host nativo; stems congelados se reproducen manteniendo MIDI editable; test de audio no nulo.

## Checklist
- [x] WebSynth AudioWorklet (16 voces, PolyBLEP, SVF, sustractivo/FM/piano/batería GM)
- [x] Integrado en el planificador MIDI y la previsualización cuando no hay plugin host (web)
- [x] Pruebas DSP: afinación ±1 cent, sin NaN ni recortes, inicio al sample, release, robo de voz, batería
- [ ] Stem freezing (bounce del escritorio a Storage y reproducción en web): pendiente
- [ ] Escucha verificada en navegador real

## Verificación
`npm run verify` en raíz; tests específicos del workstream (ver criterios).

## Notas de traspaso
- lib/web-synth/web-synth-processor.js es el worklet real y también se prueba en Node (vm).
- Preset por pista: presetParaPista (nombre, etiquetas, plugins) → TrackAudioConfig.instrumentoWeb.
- La salida entra en getTrackNode(trackId).gain: volumen, paneo y medidores aplican.
