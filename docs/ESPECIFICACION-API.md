# Especificación de API de Jaswave

## 1. Principios

- Todas las APIs internas son **síncronas** dentro del proceso (excepto comunicación con proveedor de IA y operaciones de archivo).
- Todas las APIs externas (IA, plugins) son **asíncronas**.
- Los errores se comunican mediante códigos estructurados, no excepciones arbitrarias.
- Los contratos son **estrictos**: cualquier cambio requiere actualizar la documentación y los tests.

## 2. APIs Internas (DAW Core)

### 2.1 Command System API

```typescript
interface CommandAPI {
  register<T>(definition: CommandDefinition<T>): void;
  unregister(type: string): void;
  execute<T>(type: string, payload: unknown): Promise<CommandResult<T>>;
  undo(): Promise<CommandResult | null>;
  redo(): Promise<CommandResult | null>;
  canUndo(): boolean;
  canRedo(): boolean;
  batch(commands: CommandPayload[]): Promise<TransactionResult>;
}

interface CommandDefinition<T = unknown> {
  type: string;
  description: string;
  risk: RiskLevel;
  schema: JSONSchema;
  inverseType?: string;
  handler: (state: DAWState, payload: T) => StateTransition;
}

interface CommandResult<T = unknown> {
  success: boolean;
  state: DAWState;
  events: DomainEvent[];
  result?: T;
  error?: CommandError;
}
```

**Contrato**: `execute()` devuelve el nuevo estado y los eventos emitidos. Si `success` es `false`, el estado no cambió.

### 2.2 Event Bus API

```typescript
interface EventBusAPI {
  on<T>(event: EventName, handler: EventHandler<T>): Subscription;
  off(event: EventName, handler: EventHandler<unknown>): void;
  emit<T>(event: EventName, payload: T): void;
  once<T>(event: EventName, handler: EventHandler<T>): Subscription;
  clear(): void;
  getReplayBuffer(filter?: EventFilter): DomainEvent[];
}

type EventHandler<T> = (payload: T) => void;
type Subscription = { unsubscribe: () => void };
```

**Contrato**: Los eventos se entregan en orden causal. Los handlers nunca deben bloquear (si es necesario, despachar a worker).

### 2.3 Query API (AI Read)

```typescript
interface QueryAPI {
  getProjectSummary(): ProjectSummary;
  getTracks(filter?: TrackFilter): Track[];
  getTrack(trackId: string): Track | null;
  getSelectedItems(): SelectedItems;
  getClip(clipId: string): AudioClip | MidiClip | null;
  getPlugins(): PluginDescriptor[];
  getPluginParameter(pluginId: string, paramId: string): ParameterValue | null;
  getAudioAnalysis(trackId?: string): AudioAnalysis;
  getRouting(): RoutingMatrix;
  getAutomation(trackId?: string): AutomationLane[];
  getRecentEvents(limit?: number): DomainEvent[];
  getCapabilities(): CapabilityDescriptor[];
  getMixerState(): MixerState;
  getTransportState(): TransportState;
}

interface ProjectSummary {
  name: string;
  tempo: BPM;
  timeSignature: TimeSignature;
  trackCount: number;
  busCount: number;
  pluginCount: number;
  duration: TimeDuration;
}

interface TrackSummary {
  id: string;
  name: string;
  type: TrackType;
  color: string;
  muted: boolean;
  soloed: boolean;
  volume: Decibel;
  pan: StereoPan;
}
```

**Contrato**: Todas las consultas son deterministas y sin efectos secundarios. No modifican el estado.

### 2.4 Transaction API

```typescript
interface TransactionAPI {
  begin(description: string): Transaction;
  addCommand(tx: Transaction, command: CommandPayload): void;
  commit(tx: Transaction): Promise<TransactionResult>;
  rollback(tx: Transaction): Promise<TransactionResult>;
}

interface TransactionResult {
  transactionId: string;
  status: 'committed' | 'rolledBack';
  executedCommands: string[];
  rolledBackCommands: string[];
  error?: TransactionError;
}
```

**Contrato**: `commit()` es atómico. Si falla, se hace rollback automático. El estado nunca queda en un estado intermedio.

### 2.5 Validation API

```typescript
interface ValidationAPI {
  validate(request: ActionRequest): Promise<ValidationResult>;
  validateAndPreview(request: ActionRequest, options?: { dryRun: boolean }): Promise<ValidationPreview>;
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationPreview extends ValidationResult {
  events?: DomainEvent[];
  stateDiff?: StateDiff;
}
```

**Contrato**: `validate()` no modifica el estado. `validateAndPreview()` con `dryRun: true` simula la ejecución sin aplicarla.

## 3. APIs de IA

### 3.1 AI Harness API

```typescript
interface AIHarnessAPI {
  sendMessage(message: string): Promise<AIResponse>;
  sendMessageStream(message: string): AsyncIterable<AIResponseChunk>;
  getHistory(): ConversationTurn[];
  clearHistory(): void;
}

interface AIResponse {
  text?: string;
  toolCalls?: ToolCall[];
  requiresConfirmation?: boolean;
  confirmationRequest?: ConfirmationRequest;
  warnings?: string[];
}

interface AIResponseChunk {
  type: 'text_delta' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_stop' | 'done' | 'error';
  delta?: string;
  toolCall?: ToolCall;
}
```

**Contrato**: La respuesta siempre es estructurada. Nunca es texto plano sin tipo. Las tool calls incluyen validación de esquema.

### 3.2 Tool Execution API

```typescript
interface ToolAPI {
  execute(toolName: string, params: unknown): Promise<ToolResult>;
  executeBatch(toolCalls: ToolCall[]): Promise<ToolResult[]>;
}

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: ToolError;
  events: DomainEvent[];
  confirmationRequired?: boolean;
}

interface ToolError {
  code: string;
  message: string;
  details?: unknown;
}
```

**Contrato**: Una tool exitosa emite eventos. Una tool fallida no emite eventos ni modifica el estado.

### 3.3 Memory API

```typescript
interface MemoryAPI {
  create(request: MemoryCreationRequest): Promise<MemoryEntry>;
  search(query: string, filter?: MemoryFilter): Promise<MemoryEntry[]>;
  getRelevant(context: ImmediateContext, limit: number): Promise<MemoryEntry[]>;
  getAllForScope(scope: MemoryScope): Promise<MemoryEntry[]>;
  delete(id: string): Promise<void>;
  consolidate(): Promise<void>;
}

interface MemoryCreationRequest {
  content: string;
  source: MemorySource;
  category: MemoryCategory;
  scope: MemoryScope;
  confidence: number;
  tags?: string[];
  relatedEntities?: string[];
}
```

**Contrato**: Las memorias no se crean automáticamente desde logs. Requieren creación explícita o inferencia con consentimiento.

## 4. APIs de Audio

### 4.1 Native Bridge API

```typescript
interface NativeBridgeAPI {
  initialize(config: AudioEngineConfig): Promise<void>;
  startPlayback(): Promise<void>;
  stopPlayback(): Promise<void>;
  pausePlayback(): Promise<void>;
  seek(position: TimePosition): Promise<void>;
  startRecording(trackId: string): Promise<void>;
  stopRecording(): Promise<RecordingResult>;
  loadAudioFile(path: string): Promise<AudioBufferId>;
  unloadAudioBuffer(id: string): void;
  getAnalysis(trackId: string): Promise<AudioAnalysis>;
  getDeviceList(): Promise<AudioDevice[]>;
  setInputDevice(deviceId: string): Promise<void>;
  setOutputDevice(deviceId: string): Promise<void>;
  setSampleRate(sampleRate: number): Promise<void>;
  setBufferSize(bufferSize: number): Promise<void>;
  shutdown(): Promise<void>;
}

interface AudioEngineConfig {
  sampleRate: number;
  bufferSize: number;
  inputDeviceId?: string;
  outputDeviceId?: string;
}
```

**Contrato**: Todas las operaciones son no bloqueantes para el audio thread. Las operaciones largas retornan inmediatamente y notifican por eventos.

### 4.2 Plugin Host API

```typescript
interface PluginHostAPI {
  scanPlugins(paths: string[]): Promise<PluginScanResult[]>;
  loadPlugin(pluginId: string, instanceId: string): Promise<PluginInstanceId>;
  unloadPlugin(instanceId: string): Promise<void>;
  getParameter(instanceId: string, paramId: string): Promise<ParameterValue>;
  setParameter(instanceId: string, paramId: string, value: number): Promise<void>;
  getPresets(pluginId: string): Promise<Preset[]>;
  loadPreset(instanceId: string, presetPath: string): Promise<void>;
  savePreset(instanceId: string, presetPath: string): Promise<void>;
  getLatency(instanceId: string): Promise<number>;
}

interface PluginScanResult {
  id: string;
  name: string;
  manufacturer: string;
  format: 'vst3' | 'au' | 'lv2';
  category: string;
  inputs: number;
  outputs: number;
  parameters: ParameterDescriptor[];
  latency: number;
}
```

## 5. APIs de UI

### 5.1 IPC API (Preload)

```typescript
interface PreloadAPI {
  // Command System
  executeCommand: (type: string, payload: unknown) => Promise<CommandResult>;
  undo: () => Promise<CommandResult | null>;
  redo: () => Promise<CommandResult | null>;
  
  // Query
  getProjectSummary: () => Promise<ProjectSummary>;
  getTracks: () => Promise<Track[]>;
  getMixerState: () => Promise<MixerState>;
  
  // Event Bus (read-only)
  onEvent: (event: string, handler: (payload: unknown) => void) => Subscription;
  
  // Audio
  startPlayback: () => Promise<void>;
  stopPlayback: () => Promise<void>;
  seek: (position: number) => Promise<void>;
  
  // AI
  sendChatMessage: (message: string) => Promise<AIResponse>;
  setPermissionLevel: (level: PermissionLevel) => Promise<void>;
}
```

**Contrato**: El Renderer solo accede a través de `PreloadAPI`. Nunca tiene acceso directo a Node.js o al motor de audio.

### 5.2 UI State API

```typescript
interface UIStateAPI {
  getLayout(): PanelLayout;
  setLayout(layout: PanelLayout): void;
  getActivePanel(): string | null;
  setActivePanel(panelId: string): void;
  getScrollPosition(panelId: string): Point;
  setScrollPosition(panelId: string, point: Point): void;
  getZoomLevel(): number;
  setZoomLevel(level: number): void;
  getSelectedItems(): SelectedItems;
  setSelectedItems(items: SelectedItems): void;
}
```

## 6. Códigos de Error

```typescript
type ErrorCode = 
  // Comunes
  | 'INVALID_PAYLOAD'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'READ_ONLY'
  | 'PERMISSION_DENIED'
  | 'VALIDATION_FAILED'
  | 'EXECUTION_ERROR'
  | 'INTERNAL_ERROR'
  
  // Audio
  | 'AUDIO_DEVICE_ERROR'
  | 'AUDIO_BUFFER_UNDERRUN'
  | 'PLUGIN_LOAD_FAILED'
  | 'PLUGIN_EXECUTION_ERROR'
  
  // IA
  | 'PROVIDER_ERROR'
  | 'CONTEXT_OVERFLOW'
  | 'TOOL_EXECUTION_FAILED'
  | 'VALIDATION_FAILED'
  | 'PERMISSION_DENIED'
  | 'TIMEOUT'
  
  // Proyecto
  | 'PROJECT_CORRUPTED'
  | 'PROJECT_TOO_OLD'
  | 'SAVE_FAILED'
  | 'LOAD_FAILED';
```

## 7. Versionado

- **API Interna**: Semver estricto. Cambios breaking requieren actualizar todos los consumidores.
- **Tools**: Semver individual por herramienta. El prompt fragment incluye la versión.
- **Eventos**: Versionado por evento. Cambios en el payload incrementan la versión del evento.
- **Proyecto**: Formato de archivo versionado. El loader es backward compatible con versiones anteriores.
