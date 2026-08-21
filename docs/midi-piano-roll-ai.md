# Piano Roll profesional y MIDI AI-First

> El Piano Roll es una **proyección** del dominio MIDI; nunca la fuente de verdad.

## Flujo

```
MIDI Domain → DAWState → MIDI Query API → Piano Roll Projection → React
Usuario/IA → Tool/Action → Validation → Command → MIDI Domain → Event Bus → UI
```

## Estado

### Fase A — Cimientos
- [x] Modelo MidiNote extensible + IDs estables
- [x] PPQ / tiempo musical / grid adaptativo
- [x] Query API + ops puras + tools IA

### Fase B — Editor profesional
- [x] Snap, zoom H/V, grid adaptativo, multi-select, lasso
- [x] Velocity lane, edge resize, Alt+drag, playhead transporte
- [x] Canvas virtualizado (≥64 notas)

### Fase C — Expresión
- [x] CC / Pitch Bend en `MidiClip.expression` + lanes UI (`midi.setCC`, `midi.setPitchBend`)
- [x] ArticulationMap + InstrumentCapabilities (+ MPE capabilities)
- [x] Staccato/legato + noteExpression MPE-ready en modelo

### Fase D — Musical AI
- [x] Scale constraints, patterns, generadores
- [x] Groove templates (`midi.applyGroove`, biblioteca swing/MPC/push)

Módulos: `shared/src/midi/`.
