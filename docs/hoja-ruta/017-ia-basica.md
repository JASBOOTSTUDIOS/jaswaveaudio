# IA Básica

## Objetivo
Implementar la integración básica de IA: chat con herramientas de lectura para que la IA pueda responder preguntas sobre el proyecto. La IA debe poder consultar tracks, clips, plugins, estado de transporte, etc.

## Criterios de Aceptación
- [ ] Chat con herramientas de lectura
- [ ] IA puede responder preguntas sobre el proyecto
- [ ] Integración con UI de chat
- [ ] Tool calls se traducen a comandos

## Requerimientos Detallados

### 1. Alcance
- La IA básica solo ejecuta herramientas de **lectura** (`read`).
- No puede modificar el estado.
- No puede ejecutar herramientas de escritura o peligrosas.
- Objetivo: demostrar que la arquitectura AI-First funciona; la IA comprende el proyecto sin ver la UI.

### 2. Chat UI
- Panel de chat en la UI con:
  - Historial de conversación
  - Input de texto
  - Botón de envío
  - Indicador de estado del modelo (conectado, pensando, error)
- El chat consume `AIHarnessAPI.sendMessage()`.
- Streaming opcional para mostrar respuesta incremental.

### 3. Herramientas de Lectura Disponibles
Registrar herramientas `read`:
- `project.getState` — obtener resumen del proyecto
- `project.getSummary` — obtener resumen compacto
- `track.get` — obtener detalles de un track
- `track.list` — listar todos los tracks
- `clip.get` — obtener detalles de un clip
- `clip.list` — listar clips de un track
- `plugin.list` — listar plugins disponibles
- `plugin.get` — obtener detalles de un plugin
- `transport.getState` — obtener estado de transporte
- `mixer.getState` — obtener estado del mixer
- `routing.get` — obtener matriz de routing
- `analysis.getPeak` — obtener peak de un track
- `analysis.getRMS` — obtener RMS de un track
- `analysis.getLUFS` — obtener LUFS de un track
- `midi.getEvents` — obtener eventos MIDI de un track

### 4. Flujo de Ejecución
1. Usuario escribe mensaje en chat.
2. UI envía a `AIHarness.sendMessage()`.
3. AI Harness:
   - Context Manager arma contexto de niveles 1-3.
   - Tool Registry inyecta definiciones de herramientas de lectura.
   - Provider envía mensaje a modelo local (Ollama).
4. Modelo devuelve texto y/o tool calls.
5. Si hay tool calls:
   - Planner las valida.
   - Permission Policy verifica que son `read` (permitidas en todos los niveles).
   - Tool Runner ejecuta cada tool.
   - Los resultados se envían de vuelta al modelo.
   - Modelo genera respuesta final.
6. Respuesta se muestra en UI.

### 5. Respuestas de la IA
- La IA debe responder en español (o idioma configurado).
- Las respuestas deben ser concisas pero completas.
- Si la IA necesita datos que no tiene, debe pedir aclaración.
- Ejemplos de consultas válidas:
  - "¿Cuántas tracks tiene el proyecto?"
  - "¿Qué plugins hay cargados?"
  - "¿Cuál es el BPM?"
  - "Muéstrame el estado del transporte"
  - "¿Qué clips hay en la track vocal?"

### 6. Límites
- Solo herramientas `read`.
- No se pueden ejecutar comandos que modifiquen el estado.
- No se puede acceder a archivos del sistema.
- No se puede acceder a buffers de audio en bruto.
- Context Manager limita tokens para evitar overflow.

### 7. Manejo de Errores
- Si el modelo no responde: mostrar error amigable, permitir reintento.
- Si una tool falla: mostrar error específico, no crash.
- Si el contexto excede el límite: truncar contexto y avisar al usuario.
- Timeout: 30 segundos por defecto.

### 8. Persistencia de Conversación
- El historial de chat se guarda en `SessionMemory` (nivel 4).
- Al cerrar el proyecto, el historial se limpia.
- Las memorias persistentes (nivel 5) NO se crean automáticamente.

### 9. Tests
- Test: enviar mensaje simple obtiene respuesta
- Test: tool call de lectura se ejecuta correctamente
- Test: resultado de tool se incluye en respuesta de IA
- Test: herramienta write es rechazada por permisos
- Test: contexto excedente se trunca correctamente
- Test: timeout se maneja gracefulmente
- Test: historial se mantiene entre turnos

## Dependencias
- AI Provider
- Context Manager (niveles 1-3)
- Tool Registry
- Permissions
- Command System (para tools que delegan a comandos)
- Event Bus

## Documentación Relacionada
- `docs/ia/ARQUITECTURA-IA.md`
- `docs/ia/GESTOR-CONTEXTO.md`
- `docs/ia/REGISTRO-HERRAMIENTAS.md`
- `docs/ia/PERMISOS.md`
