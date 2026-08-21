# Glosario de Jaswave

## Términos Generales

- **DAW**: Digital Audio Workstation. Estación de trabajo de audio digital.
- **AI-First**: Filosofía de diseño donde la IA es una capa integral desde el principio, no un complemento.
- **Prompt**: Instrucción de texto enviada al modelo de IA.
- **LLM**: Large Language Model. Modelo de lenguaje grande.
- **Context Window**: Cantidad de tokens que un modelo puede procesar en una sola interacción.
- **Token**: Unidad básica de texto para modelos de lenguaje (aproximadamente 4 caracteres o 0.75 palabras).

## Arquitectura

- **Event Bus**: Sistema de eventos tipados y ordenados que notifica a todos los consumidores de cambios de estado.
- **Command System**: Sistema centralizado para registrar, ejecutar y revertir comandos. Es el único camino para mutar el estado.
- **Transaction**: Grupo de comandos ejecutados atómicamente con capacidad de rollback.
- **State Model**: Modelo de estado centralizado, serializable e inmutable lógicamente.
- **Domain Layer**: Lógica de negocio pura del DAW (proyectos, tracks, clips, plugins, routing).
- **Native Bridge**: Interfaz de comunicación entre Electron y el motor de audio nativo.
- **IPC**: Inter-Process Communication. Comunicación entre procesos (Main y Renderer en Electron).
- **Preload Script**: Script de Electron que expone APIs tipadas al Renderer de forma segura.

## Estado del DAW

- **Project**: Contenedor principal de un proyecto musical.
- **Track**: Canal individual en la mezcla. Tipos: Audio, MIDI, Instrumento, Bus, Folder.
- **Clip**: Segmento de audio o MIDI en una track.
- **Take**: Grabación individual dentro de un clip.
- **Automation**: Curva de automatización para un parámetro a lo largo del tiempo.
- **FX Chain**: Cadena de efectos conectados en serie.
- **Bus**: Canal de audio que recibe la salida de otros tracks.
- **Routing**: Conexiones entre entradas, salidas, tracks y buses.
- **Mixer**: Vista de mezcla con canales verticales.
- **Timeline**: Línea de tiempo donde se disponen los clips y eventos.
- **Playhead**: Indicador de posición actual en la timeline.
- **Transport**: Control de reproducción (play, pause, stop, seek).

## AI

- **AI Harness**: Módulo que orquesta la comunicación con la IA, gestión de contexto, herramientas y permisos.
- **Context Manager**: Sistema que ensambla el contexto óptimo para enviar al modelo en cada interacción.
- **Memory Manager**: Sistema de gestión de memorias (corto plazo, sesión, largo plazo, proyecto).
- **Tool Registry**: Catálogo de herramientas disponibles para la IA.
- **AI Provider**: Abstracción del proveedor de IA (Ollama, OpenAI, Anthropic, etc.).
- **Planner**: Componente que convierte respuestas de IA en planes de ejecución.
- **Tool Runner**: Ejecutor de herramientas llamadas por la IA.
- **Prompt Fragment**: Fragmento de texto que describe las herramientas disponibles, inyectado en el system prompt.
- **Streaming**: Envío incremental de la respuesta del modelo para mostrar el "pensamiento" en tiempo real.
- **Embeddings**: Representaciones vectoriales de texto para búsqueda semántica.

## Herramientas

- **Tool**: Operación estructurada que la IA puede ejecutar. Tiene nombre, parámetros, esquema y nivel de riesgo.
- **Risk Level**: Clasificación de riesgo de una herramienta: `read`, `write`, `dangerous`.
- **Read Tool**: Herramienta de solo lectura (consultas). Sin efectos secundarios.
- **Write Tool**: Herramienta que modifica el estado del proyecto.
- **Dangerous Tool**: Herramienta potencialmente destructiva o irreversible (ej: eliminar proyecto, renderizar).
- **Schema**: Definición JSON Schema de los parámetros de una herramienta o comando.
- **Validation**: Proceso de verificar que una acción es segura y válida antes de ejecutarla.
- **Dry Run**: Ejecución simulada que devuelve el resultado sin aplicar cambios.

## Audio

- **Audio Thread**: Hilo de ejecución dedicado al procesamiento de audio en tiempo real. Máxima prioridad.
- **DSP**: Digital Signal Processing. Procesamiento digital de señales (audio).
- **Sample Rate**: Frecuencia de muestreo (ej: 44100 Hz, 48000 Hz).
- **Bit Depth**: Profundidad de bits por muestra (ej: 16-bit, 24-bit).
- **Latency**: Retardo entre la entrada y salida de audio.
- **Buffer**: Bloque de muestras procesadas en cada ciclo de audio.
- **RMS**: Root Mean Square. Medida de volumen promedio.
- **Peak**: Nivel máximo de señal.
- **LUFS**: Loudness Units Full Scale. Medida de volumen perceptual.
- **Spectrum**: Distribución de energía por frecuencias.
- **Fundamental Frequency**: Frecuencia fundamental de una nota (tonalidad).
- **Clipping**: Distorsión por exceso de nivel (señal > 0 dBFS).
- **Transient**: Cambio rápido de amplitud (ataque de un instrumento).
- **Plugin**: Módulo de procesamiento de audio (efecto o instrumento).
- **VST3**: Virtual Studio Technology. Formato de plugins de Steinberg.
- **AU**: Audio Unit. Formato de plugins de Apple.
- **LV2**: Formato de plugins abierto y multiplataforma.

## Permisos

- **Permission Level**: Nivel de autonomía de la IA: READ_ONLY, SUGGEST, CONFIRM, AUTO_EXECUTE_SAFE, FULL_AUTONOMY.
- **Permission Policy**: Conjunto de reglas que determinan si una herramienta puede ejecutarse según el nivel del usuario.
- **Confirmation Request**: Solicitud de confirmación al usuario antes de ejecutar una herramienta.
- **Emergency Stop**: Atajo para poner la IA en modo READ_ONLY instantáneamente.
- **Audit Log**: Registro de todas las operaciones para auditoría.

## Threading

- **UI Thread**: Hilo principal de la interfaz gráfica.
- **Audio Thread**: Hilo de procesamiento de audio en tiempo real.
- **Worker Thread**: Hilos de trabajo para tareas pesadas (análisis, renderizado, IA).
- **Plugin Processing**: Hilos dedicados al procesamiento de plugins.
- **Backpressure**: Mecanismo para manejar eventos en ráfaga sin saturar el sistema.

## Eventos

- **DomainEvent**: Evento estructurado con nombre, versión, timestamp, fuente y payload.
- **Event Handler**: Función que reacciona a un evento específico.
- **Subscription**: Vinculación entre un event handler y un evento, con capacidad de unsubscribe.
- **Causation ID**: Identificador que vincula un evento con el evento que lo causó.
- **Correlation ID**: Identificador que agrupa eventos relacionados en una operación compleja.
- **Replay Buffer**: Búfer circular de eventos para depuración y recuperación de contexto.

## Testing

- **Unit Test**: Prueba de una unidad de código aislada.
- **Integration Test**: Prueba de interacción entre módulos.
- **E2E Test**: Prueba de extremo a extremo simulando el uso real.
- **Mock**: Objeto simulado que reemplaza una dependencia en tests.
- **Deterministic Test**: Prueba que produce el mismo resultado siempre.
- **Fixture**: Datos de prueba predefinidos.
- **Test Double**: Término general para mocks, stubs, fakes y spies.

## ADR

- **ADR**: Architecture Decision Record. Registro de una decisión arquitectónica importante.
- **Contexto**: Situación y problemática que motiva la decisión.
- **Decisión**: La opción elegida y por qué.
- **Consecuencias**: Resultados positivos y negativos de la decisión.

## Especificación

- **API Specification**: Documento que define los contratos de comunicación entre módulos.
- **Contract**: Acuerdo formal sobre la interfaz entre dos módulos.
- **Schema**: Estructura de datos esperada (usualmente JSON Schema).
- **Serializable**: Capacidad de convertir un objeto a formato JSON y viceversa.
- **Immutable-ish**: Lógicamente inmutable; las mutaciones producen nuevas referencias.
