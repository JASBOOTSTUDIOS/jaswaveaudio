# Análisis Avanzado

## Objetivo
Implementar análisis avanzado de audio: separación de stems, detección de tonalidad, detección de BPM, análisis de armónicos y reconocimiento de acordes.

## Criterios de Aceptación
- [ ] Separación de stems
- [ ] Detección de tonalidad
- [ ] Análisis avanzado integrado

## Requerimientos Detallados

### 1. Separación de Stems
- Separar audio en stems: voz, batería, bajo, otros.
- Usar modelo de IA local o remoto.
- Los stems se generan como clips separados.

### 2. Detección de Tonalidad
- Detectar tonalidad musical (ej: C mayor, A menor).
- Detectar escala (mayor, menor, blues, etc.).
- Mostrar en UI y exponer a la IA.

### 3. Detección de BPM
- Detectar tempo de un clip o proyecto.
- Detectar cambios de tempo.
- Sugerir alineación de grid.

### 4. Análisis de Armónicos
- Detectar notas individuales en audio polifónico.
- Mostrar como piano roll o partitura.
- Exportar como MIDI.

### 5. Reconocimiento de Acordes
- Detectar acordes en audio.
- Mostrar secuencia de acordes.
- Exportar como automatización o MIDI.

### 6. Integración con IA
- La IA usa estos análisis para tomar decisiones.
- Ejemplo: "La tonalidad es C mayor, ¿quieres que ajuste la automatización de bajo a la escala?"

### 7. Tests
- Test: detección de tonalidad es correcta para audio conocido
- Test: detección de BPM es correcta
- Test: separación de stems produce audio válido
- Test: análisis se puede consultar desde IA

## Dependencias
- Motor de Audio
- AI Provider
- State Model
- Event Bus

## Documentación Relacionada
- `docs/audio/ANALISIS.md`
- `docs/ia/ARQUITECTURA-IA.md`
