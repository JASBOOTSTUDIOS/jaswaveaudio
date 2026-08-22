"use strict";
/**
 * Gateway multi-proveedor de IA para el proceso principal de Electron.
 * OpenAI / Anthropic / Gemini / Ollama / OpenRouter / KiloCode / OpenAI-compatible.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiChat = aiChat;
exports.aiHealth = aiHealth;
exports.legacyChatArgsToRequest = legacyChatArgsToRequest;
const DEFAULT_TIMEOUT_MS = 90000;
function hintFor(code, kind) {
    switch (code) {
        case 'missing_api_key':
            return 'Añade la API key en Configuración → IA.';
        case 'missing_model':
            return 'Elige o escribe un nombre de modelo válido.';
        case 'missing_base_url':
            return 'Indica la URL base del proveedor.';
        case 'connection':
            return kind === 'ollama'
                ? 'Comprueba que Ollama esté en marcha (ollama serve).'
                : 'Comprueba internet, la URL y el firewall.';
        case 'timeout':
            return 'El proveedor tardó demasiado. Reintenta o baja max tokens.';
        case 'unauthorized':
            return 'API key inválida o caducada. Regenera la clave en el panel del proveedor.';
        case 'forbidden':
            return 'Tu cuenta no tiene permiso para este modelo o región.';
        case 'rate_limit':
            return 'Límite de peticiones alcanzado. Espera unos segundos e inténtalo de nuevo.';
        case 'model_not_found':
            return 'El modelo no existe o no está disponible. Verifica el nombre exacto.';
        case 'bad_request':
            return 'Revisa el nombre del modelo, la URL y los parámetros.';
        case 'empty_response':
            return 'El proveedor respondió vacío. Prueba otro modelo.';
        default:
            return 'Revisa Configuración → IA y vuelve a probar la conexión.';
    }
}
function fail(error, errorCode, kind, extra) {
    return Object.assign({ success: false, error,
        errorCode, hint: hintFor(errorCode, kind), provider: kind }, extra);
}
function healthFail(error, errorCode, kind, status = 'disconnected') {
    return {
        status,
        models: [],
        error,
        errorCode,
        hint: hintFor(errorCode, kind),
        provider: kind,
    };
}
function normalizeBase(url) {
    return String(url || '').trim().replace(/\/$/, '');
}
function needsKey(kind, custom) {
    if ((custom === null || custom === void 0 ? void 0 : custom.needsApiKey) != null)
        return custom.needsApiKey;
    return kind !== 'ollama' && kind !== 'openai-compatible';
}
function joinUrl(base, path) {
    const b = normalizeBase(base);
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${b}${p}`;
}
function applyAuthHeaders(headers, apiKey, kind, custom) {
    var _a;
    const style = (_a = custom === null || custom === void 0 ? void 0 : custom.authStyle) !== null && _a !== void 0 ? _a : ((apiKey === null || apiKey === void 0 ? void 0 : apiKey.trim()) ? 'bearer' : 'none');
    const key = apiKey === null || apiKey === void 0 ? void 0 : apiKey.trim();
    if (style === 'bearer' && key)
        headers.Authorization = `Bearer ${key}`;
    if (style === 'x-api-key' && key)
        headers['x-api-key'] = key;
    if (custom === null || custom === void 0 ? void 0 : custom.extraHeaders) {
        for (const [k, v] of Object.entries(custom.extraHeaders)) {
            if (k && typeof v === 'string')
                headers[k] = v;
        }
    }
    if (kind === 'openrouter') {
        headers['HTTP-Referer'] = headers['HTTP-Referer'] || 'https://jaswave.app';
        headers['X-Title'] = headers['X-Title'] || 'JasWave';
    }
}
function mapHttpStatus(status, body, kind) {
    const snippet = body.replace(/\s+/g, ' ').slice(0, 280);
    if (status === 401)
        return fail(`No autorizado (${status}). ${snippet}`, 'unauthorized', kind);
    if (status === 403)
        return fail(`Acceso denegado (${status}). ${snippet}`, 'forbidden', kind);
    if (status === 404)
        return fail(`Recurso no encontrado (${status}). ${snippet}`, 'model_not_found', kind);
    if (status === 429)
        return fail(`Límite de tasa (${status}). ${snippet}`, 'rate_limit', kind);
    if (status >= 400 && status < 500)
        return fail(`Petición inválida (${status}). ${snippet}`, 'bad_request', kind);
    return fail(`Error del proveedor (${status}). ${snippet}`, 'provider_error', kind);
}
function fetchWithTimeout(url_1, init_1) {
    return __awaiter(this, arguments, void 0, function* (url, init, timeoutMs = DEFAULT_TIMEOUT_MS) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return yield fetch(url, Object.assign(Object.assign({}, init), { signal: controller.signal }));
        }
        finally {
            clearTimeout(timer);
        }
    });
}
function classifyFetchError(err, kind) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.name === 'AbortError') {
        return fail('Tiempo de espera agotado al contactar el proveedor.', 'timeout', kind);
    }
    if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(msg)) {
        return fail(`No se pudo conectar: ${msg}`, 'connection', kind);
    }
    return fail(msg || 'Error desconocido de red', 'unknown', kind);
}
function validateRequest(req) {
    if (!req.kind)
        return fail('Falta el tipo de proveedor.', 'bad_request', 'openai-compatible');
    if (!normalizeBase(req.baseUrl))
        return fail('Falta la URL base del proveedor.', 'missing_base_url', req.kind);
    if (!String(req.model || '').trim())
        return fail('Falta el modelo.', 'missing_model', req.kind);
    if (needsKey(req.kind, req.custom) && !String(req.apiKey || '').trim()) {
        return fail(`El proveedor ${req.kind} requiere API key.`, 'missing_api_key', req.kind);
    }
    if (!Array.isArray(req.messages) || req.messages.length === 0) {
        return fail('No hay mensajes para enviar.', 'bad_request', req.kind);
    }
    return null;
}
function isOpenAiCompatible(kind) {
    return kind === 'openai' || kind === 'openrouter' || kind === 'kilocode' || kind === 'openai-compatible';
}
/**
 * Base URL para clientes OpenAI-compatible.
 * Kilo usa `…/api/gateway` (sin /v1). OpenAI/OpenRouter suelen necesitar /v1.
 * `custom.appendV1` tiene prioridad.
 */
function openAiBase(url, kind, custom) {
    const base = normalizeBase(url);
    if ((custom === null || custom === void 0 ? void 0 : custom.appendV1) === true)
        return /\/v1$/i.test(base) ? base : `${base}/v1`;
    if ((custom === null || custom === void 0 ? void 0 : custom.appendV1) === false)
        return base;
    if (kind === 'kilocode')
        return base;
    if (/\/v1$/i.test(base) || /\/gateway$/i.test(base))
        return base;
    return `${base}/v1`;
}
function chatOpenAiCompatible(req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const base = openAiBase(req.baseUrl, req.kind, req.custom);
        const headers = { 'Content-Type': 'application/json' };
        applyAuthHeaders(headers, req.apiKey, req.kind, req.custom);
        const chatPath = ((_b = (_a = req.custom) === null || _a === void 0 ? void 0 : _a.chatPath) === null || _b === void 0 ? void 0 : _b.trim()) || '/chat/completions';
        let res;
        try {
            res = yield fetchWithTimeout(joinUrl(base, chatPath), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: req.model,
                    messages: req.messages,
                    temperature: (_c = req.temperature) !== null && _c !== void 0 ? _c : 0.4,
                    max_tokens: (_d = req.maxTokens) !== null && _d !== void 0 ? _d : 2048,
                    stream: false,
                }),
            });
        }
        catch (err) {
            return classifyFetchError(err, req.kind);
        }
        const text = yield res.text();
        if (!res.ok)
            return mapHttpStatus(res.status, text, req.kind);
        let data;
        try {
            data = JSON.parse(text);
        }
        catch (_j) {
            return fail('Respuesta no JSON del proveedor.', 'provider_error', req.kind);
        }
        if ((_e = data.error) === null || _e === void 0 ? void 0 : _e.message) {
            return fail(data.error.message, 'provider_error', req.kind);
        }
        const raw = (_h = (_g = (_f = data.choices) === null || _f === void 0 ? void 0 : _f[0]) === null || _g === void 0 ? void 0 : _g.message) === null || _h === void 0 ? void 0 : _h.content;
        let content = '';
        if (typeof raw === 'string')
            content = raw;
        else if (Array.isArray(raw))
            content = raw.map((p) => { var _a; return (_a = p.text) !== null && _a !== void 0 ? _a : ''; }).join('');
        if (!content.trim())
            return fail('El modelo devolvió una respuesta vacía.', 'empty_response', req.kind);
        return { success: true, content, model: req.model, provider: req.kind };
    });
}
function chatAnthropic(req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const base = normalizeBase(req.baseUrl) || 'https://api.anthropic.com';
        const systemParts = req.messages.filter((m) => m.role === 'system').map((m) => m.content);
        const messages = req.messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role, content: m.content }));
        if (messages.length === 0) {
            return fail('Anthropic requiere al menos un mensaje user/assistant.', 'bad_request', req.kind);
        }
        let res;
        try {
            res = yield fetchWithTimeout(`${base}/v1/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': req.apiKey.trim(),
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model: req.model,
                    max_tokens: (_a = req.maxTokens) !== null && _a !== void 0 ? _a : 2048,
                    temperature: (_b = req.temperature) !== null && _b !== void 0 ? _b : 0.4,
                    system: systemParts.length ? systemParts.join('\n\n') : undefined,
                    messages,
                }),
            });
        }
        catch (err) {
            return classifyFetchError(err, req.kind);
        }
        const text = yield res.text();
        if (!res.ok)
            return mapHttpStatus(res.status, text, req.kind);
        let data;
        try {
            data = JSON.parse(text);
        }
        catch (_e) {
            return fail('Respuesta no JSON de Anthropic.', 'provider_error', req.kind);
        }
        if ((_c = data.error) === null || _c === void 0 ? void 0 : _c.message)
            return fail(data.error.message, 'provider_error', req.kind);
        const content = ((_d = data.content) !== null && _d !== void 0 ? _d : [])
            .filter((b) => b.type === 'text' || !!b.text)
            .map((b) => { var _a; return (_a = b.text) !== null && _a !== void 0 ? _a : ''; })
            .join('');
        if (!content.trim())
            return fail('Claude devolvió una respuesta vacía.', 'empty_response', req.kind);
        return { success: true, content, model: req.model, provider: req.kind };
    });
}
function chatGemini(req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        const base = normalizeBase(req.baseUrl) || 'https://generativelanguage.googleapis.com/v1beta';
        const key = req.apiKey.trim();
        const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
        const contents = req.messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
        }));
        if (contents.length === 0) {
            return fail('Gemini requiere al menos un mensaje de usuario.', 'bad_request', req.kind);
        }
        const url = `${base}/models/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(key)}`;
        let res;
        try {
            res = yield fetchWithTimeout(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
                    contents,
                    generationConfig: {
                        temperature: (_a = req.temperature) !== null && _a !== void 0 ? _a : 0.4,
                        maxOutputTokens: (_b = req.maxTokens) !== null && _b !== void 0 ? _b : 2048,
                    },
                }),
            });
        }
        catch (err) {
            return classifyFetchError(err, req.kind);
        }
        const text = yield res.text();
        if (!res.ok)
            return mapHttpStatus(res.status, text, req.kind);
        let data;
        try {
            data = JSON.parse(text);
        }
        catch (_h) {
            return fail('Respuesta no JSON de Gemini.', 'provider_error', req.kind);
        }
        if ((_c = data.error) === null || _c === void 0 ? void 0 : _c.message)
            return fail(data.error.message, 'provider_error', req.kind);
        const content = ((_g = (_f = (_e = (_d = data.candidates) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.content) === null || _f === void 0 ? void 0 : _f.parts) !== null && _g !== void 0 ? _g : []).map((p) => { var _a; return (_a = p.text) !== null && _a !== void 0 ? _a : ''; }).join('');
        if (!content.trim())
            return fail('Gemini devolvió una respuesta vacía.', 'empty_response', req.kind);
        return { success: true, content, model: req.model, provider: req.kind };
    });
}
function chatOllama(req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const base = normalizeBase(req.baseUrl);
        let res;
        try {
            res = yield fetchWithTimeout(`${base}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: req.model,
                    messages: req.messages,
                    stream: false,
                    options: typeof req.temperature === 'number' ? { temperature: req.temperature } : undefined,
                }),
            });
        }
        catch (err) {
            return classifyFetchError(err, req.kind);
        }
        const text = yield res.text();
        if (!res.ok)
            return mapHttpStatus(res.status, text, req.kind);
        let data;
        try {
            data = JSON.parse(text);
        }
        catch (_d) {
            return fail('Respuesta no JSON de Ollama.', 'provider_error', req.kind);
        }
        if (data.error)
            return fail(String(data.error), 'provider_error', req.kind);
        const content = (_c = (_b = (_a = data.message) === null || _a === void 0 ? void 0 : _a.content) !== null && _b !== void 0 ? _b : data.response) !== null && _c !== void 0 ? _c : '';
        if (!String(content).trim())
            return fail('Ollama devolvió una respuesta vacía.', 'empty_response', req.kind);
        return { success: true, content: String(content), model: req.model, provider: req.kind };
    });
}
function aiChat(req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const invalid = validateRequest(req);
        if (invalid)
            return invalid;
        const style = (_a = req.custom) === null || _a === void 0 ? void 0 : _a.apiStyle;
        try {
            if (style === 'ollama' || (!style && req.kind === 'ollama'))
                return yield chatOllama(req);
            if (style === 'anthropic' || (!style && req.kind === 'anthropic'))
                return yield chatAnthropic(req);
            if (style === 'gemini' || (!style && req.kind === 'gemini'))
                return yield chatGemini(req);
            if (style === 'openai' || (!style && isOpenAiCompatible(req.kind)))
                return yield chatOpenAiCompatible(req);
            if (req.kind === 'ollama')
                return yield chatOllama(req);
            if (req.kind === 'anthropic')
                return yield chatAnthropic(req);
            if (req.kind === 'gemini')
                return yield chatGemini(req);
            if (isOpenAiCompatible(req.kind))
                return yield chatOpenAiCompatible(req);
            return fail(`Proveedor no soportado: ${req.kind}`, 'bad_request', req.kind);
        }
        catch (err) {
            return classifyFetchError(err, req.kind);
        }
    });
}
function healthOpenAi(req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        if (needsKey(req.kind, req.custom) && !((_a = req.apiKey) === null || _a === void 0 ? void 0 : _a.trim())) {
            return healthFail(`El proveedor ${req.kind} requiere API key.`, 'missing_api_key', req.kind, 'misconfigured');
        }
        const base = openAiBase(req.baseUrl, req.kind, req.custom);
        const headers = {};
        applyAuthHeaders(headers, req.apiKey, req.kind, req.custom);
        const modelsPath = ((_c = (_b = req.custom) === null || _b === void 0 ? void 0 : _b.modelsPath) === null || _c === void 0 ? void 0 : _c.trim()) || '/models';
        try {
            const res = yield fetchWithTimeout(joinUrl(base, modelsPath), { method: 'GET', headers }, 20000);
            const text = yield res.text();
            if (!res.ok) {
                const mapped = mapHttpStatus(res.status, text, req.kind);
                return healthFail(mapped.error, mapped.errorCode, req.kind);
            }
            const data = JSON.parse(text);
            const models = ((_d = data.data) !== null && _d !== void 0 ? _d : []).map((m) => m.id).filter(Boolean);
            return { status: 'healthy', models, baseUrl: base, provider: req.kind };
        }
        catch (err) {
            const mapped = classifyFetchError(err, req.kind);
            return healthFail(mapped.error, mapped.errorCode, req.kind);
        }
    });
}
function healthAnthropic(req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        if (!((_a = req.apiKey) === null || _a === void 0 ? void 0 : _a.trim())) {
            return healthFail('Anthropic requiere API key.', 'missing_api_key', req.kind, 'misconfigured');
        }
        // Anthropic no tiene list models público estable; validamos la key con un ping ligero fallido controlado
        // usando models endpoint si existe, si no marcamos healthy tras validar formato.
        const base = normalizeBase(req.baseUrl) || 'https://api.anthropic.com';
        try {
            const res = yield fetchWithTimeout(`${base}/v1/models`, {
                method: 'GET',
                headers: {
                    'x-api-key': req.apiKey.trim(),
                    'anthropic-version': '2023-06-01',
                },
            }, 20000);
            const text = yield res.text();
            if (res.ok) {
                const data = JSON.parse(text);
                const models = ((_b = data.data) !== null && _b !== void 0 ? _b : []).map((m) => m.id).filter(Boolean);
                return {
                    status: 'healthy',
                    models: models.length
                        ? models
                        : ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-haiku-latest'],
                    baseUrl: base,
                    provider: req.kind,
                };
            }
            if (res.status === 404) {
                // Endpoint no disponible: key presente → OK con modelos sugeridos
                return {
                    status: 'healthy',
                    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-haiku-latest'],
                    baseUrl: base,
                    provider: req.kind,
                    hint: 'Conexión lista. Anthropic no listó modelos; usa los sugeridos o añade el tuyo.',
                };
            }
            const mapped = mapHttpStatus(res.status, text, req.kind);
            return healthFail(mapped.error, mapped.errorCode, req.kind);
        }
        catch (err) {
            const mapped = classifyFetchError(err, req.kind);
            return healthFail(mapped.error, mapped.errorCode, req.kind);
        }
    });
}
function healthGemini(req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        if (!((_a = req.apiKey) === null || _a === void 0 ? void 0 : _a.trim())) {
            return healthFail('Gemini requiere API key.', 'missing_api_key', req.kind, 'misconfigured');
        }
        const base = normalizeBase(req.baseUrl) || 'https://generativelanguage.googleapis.com/v1beta';
        const url = `${base}/models?key=${encodeURIComponent(req.apiKey.trim())}`;
        try {
            const res = yield fetchWithTimeout(url, { method: 'GET' }, 20000);
            const text = yield res.text();
            if (!res.ok) {
                const mapped = mapHttpStatus(res.status, text, req.kind);
                return healthFail(mapped.error, mapped.errorCode, req.kind);
            }
            const data = JSON.parse(text);
            const models = ((_b = data.models) !== null && _b !== void 0 ? _b : [])
                .map((m) => (m.name || '').replace(/^models\//, ''))
                .filter((n) => n.includes('gemini'));
            return { status: 'healthy', models, baseUrl: base, provider: req.kind };
        }
        catch (err) {
            const mapped = classifyFetchError(err, req.kind);
            return healthFail(mapped.error, mapped.errorCode, req.kind);
        }
    });
}
function healthOllama(req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const base = normalizeBase(req.baseUrl);
        if (!base)
            return healthFail('Falta la URL de Ollama.', 'missing_base_url', req.kind, 'misconfigured');
        try {
            const res = yield fetchWithTimeout(`${base}/api/tags`, { method: 'GET' }, 15000);
            const text = yield res.text();
            if (!res.ok) {
                const mapped = mapHttpStatus(res.status, text, req.kind);
                return healthFail(mapped.error, mapped.errorCode, req.kind);
            }
            const data = JSON.parse(text);
            const models = ((_a = data.models) !== null && _a !== void 0 ? _a : []).map((m) => m.name).filter(Boolean);
            return { status: 'healthy', models, baseUrl: base, provider: req.kind };
        }
        catch (err) {
            const mapped = classifyFetchError(err, req.kind);
            return healthFail(mapped.error, mapped.errorCode, req.kind);
        }
    });
}
function aiHealth(req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!req.kind)
            return healthFail('Falta el tipo de proveedor.', 'bad_request', 'openai-compatible', 'misconfigured');
        if (!normalizeBase(req.baseUrl)) {
            return healthFail('Falta la URL base.', 'missing_base_url', req.kind, 'misconfigured');
        }
        const style = (_a = req.custom) === null || _a === void 0 ? void 0 : _a.apiStyle;
        try {
            if (style === 'ollama' || (!style && req.kind === 'ollama'))
                return yield healthOllama(req);
            if (style === 'anthropic' || (!style && req.kind === 'anthropic'))
                return yield healthAnthropic(req);
            if (style === 'gemini' || (!style && req.kind === 'gemini'))
                return yield healthGemini(req);
            if (style === 'openai' || (!style && isOpenAiCompatible(req.kind)))
                return yield healthOpenAi(req);
            if (req.kind === 'ollama')
                return yield healthOllama(req);
            if (req.kind === 'anthropic')
                return yield healthAnthropic(req);
            if (req.kind === 'gemini')
                return yield healthGemini(req);
            if (isOpenAiCompatible(req.kind))
                return yield healthOpenAi(req);
            return healthFail(`Proveedor no soportado: ${req.kind}`, 'bad_request', req.kind, 'misconfigured');
        }
        catch (err) {
            const mapped = classifyFetchError(err, req.kind);
            return healthFail(mapped.error, mapped.errorCode, req.kind);
        }
    });
}
/** Compat: argumentos antiguos (messages, model, baseUrl, temperature). */
function legacyChatArgsToRequest(messages, model, baseUrl, temperature) {
    var _a;
    return {
        messages: (_a = messages) !== null && _a !== void 0 ? _a : [],
        kind: 'ollama',
        model: model || 'llama3.2',
        baseUrl: baseUrl || 'http://127.0.0.1:11434',
        temperature,
    };
}
