# ADR-0010: Arrangement View como proyección profesional

## Estado

Aceptado.

## Contexto

[`jas-wave/components/arrange-view.tsx`](../../jas-wave/components/arrange-view.tsx) es un monolito (~1.3k líneas)
que ya muta vía Command System (`clip.move`, `clip.resize`, `track.*`) y usa
[`timeline-projection.ts`](../../jas-wave/lib/timeline-projection.ts).

El producto necesita un Arrangement comparable a DAWs profesionales sin:

- mutar DAWState desde React;
- crear un segundo modelo Track/Clip;
- re-renderizar todas las lanes en cada tick del playhead;
- conectar la IA al DOM.

## Decisión

### Arquitectura

```
DAWState → Domain/Query → Arrangement Projection → React UI
Usuario/IA → Action/Tool → Validator → Command → Domain → Event Bus → UI
```

El Arrangement View es **solo proyección + interacción**.

### Rendering híbrido (performance)

- **React** para estructura (headers, clips, interacción).
- **Canvas 2D** para grid + regla (evitar miles de nodos DOM).
- **Playhead** vía `transform` + RAF sin re-render estructural.
- **No** migrar el Arrangement a WebGL/Qt/ImGui: el cuello de botella era densidad DOM + sync de store, no React en sí.

### Módulos UI

```
jas-wave/components/arrangement/
  ArrangementView.tsx
  TimelineRuler.tsx
  TrackHeaderPanel.tsx
  TrackCanvas.tsx
  PlayheadOverlay.tsx
  GridLayer.tsx
jas-wave/hooks/arrangement/
  useTimelineScale.ts
  useArrangementViewport.ts
  useClipInteraction.ts
  useSnap.ts
  usePlayheadOverlay.ts
```

`arrange-view.tsx` reexporta `ArrangementView` para no romper imports existentes.

### Contratos reutilizados

- Commands existentes: `clip.*`, `track.*`, `selection.set`, `marker.create`, `transport.*`, `ui.setZoom`.
- Proyección: `createProjection` (beat ↔ pixel).
- Grid: `adaptiveGridForZoom` en `shared/src/midi/grid.ts` (+ snap UI).
- Waveforms: cache runtime fuera de DAWState (`StereoWaveform` / peaks).

### UI vs Project

- Zoom/scroll/alturas de track → UIState / viewport local (sin Undo).
- Posición/duración de clips, tracks, markers → ProjectState vía Commands (con Undo).

### IA

No tools DOM. Consulta vía estado/tools existentes; tools `arrangement.*` en fases posteriores (ADR futuro si hace falta).

## Consecuencias

### Positivas

- Playhead fluido sin freeze.
- Código mantenible por módulos.
- Misma fuente de verdad que el resto del DAW.

### Negativas

- Refactor gradual del monolito.
- Virtualización (fase K) pendiente.

### Alternativas rechazadas

- Canvas único monolítico sin Commands.
- Playhead que escribe `establecerEstado` cada frame.
- Modelo Clip paralelo en React.

## Impacto

- **Command System**: sin cambios de contrato; solo más llamadas desde hooks.
- **Event Bus**: structural events sí; playhead HF no.
- **DAWState**: sin campos nuevos obligatorios en esta fase.
- **AI Harness**: sin cambios inmediatos.
