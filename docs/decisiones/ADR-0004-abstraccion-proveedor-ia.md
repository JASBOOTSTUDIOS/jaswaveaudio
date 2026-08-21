# ADR-0004: Abstracción de Proveedor de IA

## Contexto

Necesitamos soportar múltiples proveedores de IA (Ollama local, OpenAI, Anthropic, etc.) sin acoplar el DAW a ninguno en particular. Los modelos y APIs evolucionan rápidamente, y el usuario debe poder cambiar de proveedor sin actualizar el DAW.

## Decisión

Implementar una **interfaz `AIProvider` abstracta** con adaptadores concretos por proveedor:

```typescript
interface AIProvider {
  id: string;
  name: string;
  capabilities: ProviderCapabilities;
  
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<StreamChunk>;
  embeddings?(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  
  supportsStreaming(): boolean;
  supportsToolUse(): boolean;
  supportsJSONMode(): boolean;
}
```

Reglas:
1. El DAW core nunca importa un proveedor concreto.
2. Se accede a proveedores mediante una Factoría de Proveedores.
3. El proveedor se selecciona en configuración del usuario.
4. Se soporta fallback entre proveedores primario y secundario.

## Consecuencias

### Positivas
- Cambio de proveedor = cambio de configuración, no de código
- Facilita agregar nuevos proveedores
- Permite usar modelos locales (Ollama) sin dependencia de Internet
- Facilita testing con mocks de proveedor

### Negativas
- Overhead de abstracción (normalizar formatos entre proveedores)
- Mantenimiento de adaptadores individuales
- Cada proveedor puede tener limitaciones específicas (tool format, context window)

### Riesgos
- Proveedor deprecado o API cambiada
- Mitigación: tests de integración por proveedor, monitoreo de health
- Diferencias en comportamiento entre proveedores (ej: tool calling)
- Mitigación: capa de normalización robusta, fallbacks
