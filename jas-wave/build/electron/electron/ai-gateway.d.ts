/**
 * Gateway multi-proveedor de IA para el proceso principal de Electron.
 * OpenAI / Anthropic / Gemini / Ollama / OpenRouter / KiloCode / OpenAI-compatible.
 */
export type AiProviderKind = 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'kilocode' | 'openai-compatible';
export type AiApiStyle = 'openai' | 'anthropic' | 'gemini' | 'ollama';
export type AiAuthStyle = 'bearer' | 'x-api-key' | 'none';
export type AiProviderCustom = {
    apiStyle?: AiApiStyle;
    chatPath?: string;
    modelsPath?: string;
    appendV1?: boolean;
    authStyle?: AiAuthStyle;
    extraHeaders?: Record<string, string>;
    needsApiKey?: boolean;
};
export type AiErrorCode = 'missing_api_key' | 'missing_model' | 'missing_base_url' | 'connection' | 'timeout' | 'unauthorized' | 'forbidden' | 'rate_limit' | 'model_not_found' | 'bad_request' | 'provider_error' | 'empty_response' | 'not_available' | 'unknown';
export type ChatMessage = {
    role: string;
    content: string;
};
export type AiChatRequest = {
    messages: ChatMessage[];
    kind: AiProviderKind;
    model: string;
    baseUrl: string;
    apiKey?: string;
    temperature?: number;
    maxTokens?: number;
    custom?: AiProviderCustom;
};
export type AiHealthRequest = {
    kind: AiProviderKind;
    baseUrl: string;
    apiKey?: string;
    custom?: AiProviderCustom;
};
export type AiChatResult = {
    success: boolean;
    content?: string;
    model?: string;
    provider?: string;
    error?: string;
    errorCode?: AiErrorCode;
    hint?: string;
};
export type AiHealthResult = {
    status: 'healthy' | 'disconnected' | 'misconfigured';
    models: string[];
    baseUrl?: string;
    provider?: string;
    error?: string;
    errorCode?: AiErrorCode;
    hint?: string;
};
export declare function aiChat(req: AiChatRequest): Promise<AiChatResult>;
export declare function aiHealth(req: AiHealthRequest): Promise<AiHealthResult>;
/** Compat: argumentos antiguos (messages, model, baseUrl, temperature). */
export declare function legacyChatArgsToRequest(messages: unknown[], model?: string, baseUrl?: string, temperature?: number): AiChatRequest;
