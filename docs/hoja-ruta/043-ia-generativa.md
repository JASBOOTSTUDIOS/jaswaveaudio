# IA Generativa de Audio

## Objetivo
Implementar capacidades de IA generativa: texto a audio, generación de muestras, separación de stems y asistencia creativa avanzada.

## Criterios de Aceptación
- [ ] IA generativa de audio (texto a audio)
- [ ] Generación de muestras y loops
- [ ] Integración con DAW

## Requerimientos Detallados

### 1. Texto a Audio
- La IA genera archivos de audio a partir de descripciones de texto.
- Formatos soportados: WAV, FLAC.
- El audio generado se puede arrastrar a la timeline como clip.

### 2. Generación de Muestras
- Generar samples de batería, bajo, synths, etc.
- Control de parámetros: duración, tempo, estilo.
- Biblioteca de muestras generadas.

### 3. Separación de Stems
- Separar pista existente en stems: voz, batería, bajo, otros.
- Usar modelo de IA local o remoto.
- Los stems se generan como clips separados en nuevas tracks.

### 4. Asistencia Creativa
- La IA sugiere variaciones melódicas.
- Genera acompañamientos automáticos.
- Crea arreglos a partir de un tema simple.

### 5. Integración
- Las herramientas de generación se registran en el Tool Registry.
- El audio generado se almacena en `media/`.
- Se crean clips automáticamente.

### 6. Tests
- Test: texto a audio genera clip válido
- Test: separación de stems crea tracks correctas
- Test: generación de muestras funciona offline

## Dependencias
- AI Provider
- Tool Registry
- Motor de Audio
- State Model

## Documentación Relacionada
- `docs/ia/ARQUITECTURA-IA.md`
- `docs/audio/MOTOR-AUDIO.md`
