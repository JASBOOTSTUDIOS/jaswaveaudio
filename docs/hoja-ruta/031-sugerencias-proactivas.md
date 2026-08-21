# Sugerencias Proactivas

## Objetivo
Implementar el sistema de sugerencias proactivas de la IA: basadas en el estado del proyecto, la IA sugiere mejoras sin que el usuario las pida explícitamente.

## Criterios de Aceptación
- [ ] IA sugiere mejoras basadas en el estado
- [ ] El usuario recibe sugerencias contextuales
- [ ] No intrusivo ni molesto
- [ ] Configurable por el usuario

## Requerimientos Detallados

### 1. Concepto
- La IA analiza el estado del proyecto periódicamente.
- Si detecta oportunidades de mejora, genera sugerencias.
- Las sugerencias se muestran en el panel de chat o como notificaciones.
- El usuario puede aceptar, rechazar o ignorar cada sugerencia.

### 2. Tipos de Sugerencias
- **Mejora de mezcla**: "La track de batería tiene clipping, ¿quieres reducir el volumen o agregar un limitador?"
- **Organización**: "Tienes 12 tracks sin nombre, ¿quieres renombrarlas automáticamente?"
- **Efectos**: "La track vocal no tiene compresión, ¿quieres agregar un compresor?"
- **Routing**: "Tienes 3 tracks enviando al reverb, ¿quieres crear un bus de reverb?"
- **Automatización**: "El volumen de la track de bajo es constante, ¿quieres automatizarlo?"
- **Análisis**: "El LUFS del proyecto es -8 LUFS, ¿quieres ajustarlo a -14 LUFS?"

### 3. Motor de Sugerencias
- `SuggestionEngine`:
  - `analyze(state: DAWState, context: AIContext): Suggestion[]`
  - `shouldSuggest(): boolean` — basado en historial y preferencias del usuario.
- Se ejecuta en eventos del Event Bus:
  - `track.created`, `track.volume.changed`, `plugin.loaded`, `audio.analysis.updated`.
- No se ejecuta durante playback activo (evitar distracciones).

### 4. Suggestion
Definir `Suggestion`:
- `id: string`
- `type: 'mixing' | 'organization' | 'effects' | 'routing' | 'automation' | 'analysis'`
- `priority: 'low' | 'medium' | 'high'`
- `title: string`
- `description: string`
- `toolCalls?: ToolCall[]` — acciones sugeridas.
- `requiresConfirmation: boolean`
- `context: AIContext`

### 5. Presentación
- Sugerencias en el chat como mensajes del sistema.
- Notificaciones no intrusivas en la status bar.
- Contador de sugerencias pendientes.
- El usuario puede:
  - Aceptar → ejecutar tool calls.
  - Rechazar → descartar sugerencia.
  - Posponer → mostrar más tarde.
  - Silenciar tipo → no mostrar más sugerencias de ese tipo.

### 6. Rate Limiting
- Máximo 1 sugerencia cada 2 minutos.
- Máximo 5 sugerencias por sesión.
- Si el usuario rechaza 3 seguidas, pausar sugerencias por 5 minutos.
- Respeta el nivel de autonomía del usuario.

### 7. Learning
- Si el usuario acepta una sugerencia, registrar en memoria:
  - "El usuario aceptó sugerencia de compresión vocal."
- Si el usuario rechaza, registrar:
  - "El usuario rechazó sugerencia de renombrar tracks."
- Usar estas memorias para ajustar futuras sugerencias.

### 8. Tests
- Test: engine detecta clipping y sugiere acción
- Test: engine detecta tracks sin nombre
- Test: sugerencia se presenta correctamente en UI
- Test: usuario puede aceptar/rechazar
- Test: rate limiting respeta límites
- Test: memoria se actualiza según respuesta del usuario
- Test: no sugiere durante playback activo

## Dependencias
- Context Manager
- Memory Manager
- Event Bus
- AI Harness
- Tool Registry
- Permissions

## Documentación Relacionada
- `docs/ia/ARQUITECTURA-IA.md`
- `docs/ia/GESTOR-CONTEXTO.md`
