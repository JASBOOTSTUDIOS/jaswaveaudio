import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAnthropicBody,
  buildGeminiBody,
  buildOllamaBody,
  buildOpenAiBody,
  decodeToolName,
  encodeToolName,
  isToolsUnsupportedError,
  parseAnthropicContent,
  parseGeminiParts,
  parseOllamaMessage,
  parseOpenAiMessage,
  providerSupportsTools,
  sanitizeSchemaForGemini,
  type AiToolRequestPart,
} from './ai-tools'
import { buildProviderRequest, parseProviderResponse, shouldSendTools, type AiChatRequest } from './ai-gateway'

const TOOLS = [
  {
    name: 'track.create',
    description: 'Crea una pista',
    parameters: {
      type: 'object',
      properties: { nombre: { type: 'string' }, tipo: { type: 'string', enum: ['midi', 'audio'] } },
      required: ['nombre'],
      additionalProperties: false,
    },
  },
]

const THREAD: AiToolRequestPart = {
  model: 'm',
  temperature: 0.2,
  maxTokens: 100,
  tools: TOOLS,
  toolChoice: 'auto',
  messages: [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'crea un pad' },
    { role: 'assistant', content: 'voy', toolCalls: [{ id: 'call_0_0', name: 'track.create', arguments: { nombre: 'Pad' } }] },
    { role: 'tool', toolCallId: 'call_0_0', name: 'track.create', content: '<tool_result>ok</tool_result>' },
  ],
}

test('codificación de nombres de herramienta (puntos ↔ __)', () => {
  assert.equal(encodeToolName('midi.clip.md.apply'), 'midi__clip__md__apply')
  assert.equal(decodeToolName('midi__clip__md__apply'), 'midi.clip.md.apply')
  assert.match(encodeToolName('a.b c/d'), /^[a-zA-Z0-9_-]+$/)
})

test('snapshot OpenAI: tools, tool_calls y mensajes tool', () => {
  assert.deepEqual(buildOpenAiBody(THREAD), {
    model: 'm',
    temperature: 0.2,
    max_tokens: 100,
    stream: false,
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'crea un pad' },
      {
        role: 'assistant',
        content: 'voy',
        tool_calls: [{ id: 'call_0_0', type: 'function', function: { name: 'track__create', arguments: '{"nombre":"Pad"}' } }],
      },
      { role: 'tool', tool_call_id: 'call_0_0', content: '<tool_result>ok</tool_result>' },
    ],
    tools: [{ type: 'function', function: { name: 'track__create', description: 'Crea una pista', parameters: TOOLS[0]!.parameters } }],
    tool_choice: 'auto',
  })
})

test('snapshot Anthropic: system aparte, tool_use y tool_result agrupados', () => {
  const twoResults: AiToolRequestPart = {
    ...THREAD,
    toolChoice: 'required',
    messages: [
      ...THREAD.messages.slice(0, 2),
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'a', name: 'track.create', arguments: { nombre: 'A' } },
          { id: 'b', name: 'track.create', arguments: { nombre: 'B' } },
        ],
      },
      { role: 'tool', toolCallId: 'a', name: 'track.create', content: 'ok A' },
      { role: 'tool', toolCallId: 'b', name: 'track.create', content: 'ok B' },
    ],
  }
  assert.deepEqual(buildAnthropicBody(twoResults), {
    model: 'm',
    max_tokens: 100,
    temperature: 0.2,
    system: 'sys',
    messages: [
      { role: 'user', content: 'crea un pad' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'a', name: 'track__create', input: { nombre: 'A' } },
          { type: 'tool_use', id: 'b', name: 'track__create', input: { nombre: 'B' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'a', content: 'ok A' },
          { type: 'tool_result', tool_use_id: 'b', content: 'ok B' },
        ],
      },
    ],
    tools: [{ name: 'track__create', description: 'Crea una pista', input_schema: TOOLS[0]!.parameters }],
    tool_choice: { type: 'any' },
  })
})

test('snapshot Gemini: functionDeclarations saneadas, functionCall/functionResponse', () => {
  assert.deepEqual(buildGeminiBody(THREAD), {
    systemInstruction: { parts: [{ text: 'sys' }] },
    contents: [
      { role: 'user', parts: [{ text: 'crea un pad' }] },
      { role: 'model', parts: [{ text: 'voy' }, { functionCall: { name: 'track__create', args: { nombre: 'Pad' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'track__create', response: { content: '<tool_result>ok</tool_result>' } } }] },
    ],
    generationConfig: { temperature: 0.2, maxOutputTokens: 100 },
    tools: [
      {
        functionDeclarations: [
          {
            name: 'track__create',
            description: 'Crea una pista',
            parameters: {
              type: 'object',
              properties: { nombre: { type: 'string' }, tipo: { type: 'string', enum: ['midi', 'audio'] } },
              required: ['nombre'],
            },
          },
        ],
      },
    ],
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
  })
  assert.deepEqual(sanitizeSchemaForGemini({ type: ['number', 'null'], default: 1, $schema: 'x' }), { type: 'number' })
})

test('snapshot Ollama: tools y tool_calls con argumentos objeto', () => {
  assert.deepEqual(buildOllamaBody(THREAD), {
    model: 'm',
    stream: false,
    options: { temperature: 0.2 },
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'crea un pad' },
      { role: 'assistant', content: 'voy', tool_calls: [{ function: { name: 'track__create', arguments: { nombre: 'Pad' } } }] },
      { role: 'tool', content: '<tool_result>ok</tool_result>', tool_name: 'track__create' },
    ],
    tools: [{ type: 'function', function: { name: 'track__create', description: 'Crea una pista', parameters: TOOLS[0]!.parameters } }],
  })
})

test('parsing de respuestas con tool calls por proveedor', () => {
  assert.deepEqual(
    parseOpenAiMessage({ content: null, tool_calls: [{ id: 'x', function: { name: 'project__setBpm', arguments: '{"bpm":90}' } }] }),
    { content: '', toolCalls: [{ id: 'x', name: 'project.setBpm', arguments: { bpm: 90 } }] },
  )
  assert.deepEqual(
    parseAnthropicContent([
      { type: 'text', text: 'ok' },
      { type: 'tool_use', id: 'tu', name: 'track__list', input: {} },
    ]),
    { content: 'ok', toolCalls: [{ id: 'tu', name: 'track.list', arguments: {} }] },
  )
  assert.deepEqual(parseGeminiParts([{ functionCall: { name: 'track__list', args: { a: 1 } } }]), {
    content: '',
    toolCalls: [{ id: 'gemini_0', name: 'track.list', arguments: { a: 1 } }],
  })
  assert.deepEqual(parseOllamaMessage({ content: '', tool_calls: [{ function: { name: 'track__list', arguments: { x: 1 } } }] }), {
    content: '',
    toolCalls: [{ id: 'ollama_0', name: 'track.list', arguments: { x: 1 } }],
  })
  // Argumentos rotos no tiran el parser.
  assert.deepEqual(parseOpenAiMessage({ tool_calls: [{ id: 'y', function: { name: 'a__b', arguments: '{rot' } }] }).toolCalls[0]!.arguments, {
    __raw: '{rot',
  })
})

test('capacidades: tools nativas por proveedor/modelo y detección de rechazo', () => {
  assert.equal(providerSupportsTools({ kind: 'openai', model: 'gpt-4o-mini' }), true)
  assert.equal(providerSupportsTools({ kind: 'anthropic', model: 'claude' }), true)
  assert.equal(providerSupportsTools({ kind: 'gemini', model: 'gemini-2.0-flash' }), true)
  assert.equal(providerSupportsTools({ kind: 'openrouter', model: 'x' }), true)
  assert.equal(providerSupportsTools({ kind: 'ollama', model: 'llama3.2' }), true)
  assert.equal(providerSupportsTools({ kind: 'ollama', model: 'gemma2' }), false)
  assert.equal(providerSupportsTools({ kind: 'openai-compatible', model: 'local' }), false)
  assert.equal(providerSupportsTools({ kind: 'openai-compatible', model: 'local', supportsTools: true }), true)
  assert.equal(isToolsUnsupportedError(400, '{"error":"registry.ollama.ai/library/gemma2 does not support tools"}'), true)
  assert.equal(isToolsUnsupportedError(400, 'tool_choice is not supported for this model'), true)
  assert.equal(isToolsUnsupportedError(401, 'does not support tools'), false)
  assert.equal(isToolsUnsupportedError(400, 'max_tokens too large'), false)
})

test('gateway: request por proveedor sin tools para modelos sin soporte', () => {
  const base: AiChatRequest = {
    kind: 'openai-compatible',
    model: 'local',
    baseUrl: 'http://127.0.0.1:1234/v1',
    messages: THREAD.messages,
    tools: TOOLS,
  }
  assert.equal(shouldSendTools(base), false)
  const t = buildProviderRequest(base)
  assert.equal(t.url, 'http://127.0.0.1:1234/v1/chat/completions')
  assert.equal('tools' in t.body, false)
  const anth = buildProviderRequest({ ...base, kind: 'anthropic', model: 'c', baseUrl: 'https://api.anthropic.com', apiKey: 'k' })
  assert.equal(anth.url, 'https://api.anthropic.com/v1/messages')
  assert.ok(Array.isArray(anth.body.tools))
  const gem = buildProviderRequest({ ...base, kind: 'gemini', model: 'g', baseUrl: 'https://x/v1beta', apiKey: 'k' }, { stream: true })
  assert.equal(gem.url, 'https://x/v1beta/models/g:streamGenerateContent?alt=sse')
  assert.equal(gem.headers['x-goog-api-key'], 'k')
})

test('gateway: parseProviderResponse acepta respuesta solo con tool calls', () => {
  const r = parseProviderResponse(
    'openai',
    'openai',
    JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'q', function: { name: 'track__list', arguments: '{}' } }] } }] }),
    'gpt',
  )
  assert.equal(r.success, true)
  assert.deepEqual(r.toolCalls, [{ id: 'q', name: 'track.list', arguments: {} }])
  const empty = parseProviderResponse('anthropic', 'anthropic', JSON.stringify({ content: [] }), 'c')
  assert.equal(empty.success, false)
  assert.equal(empty.errorCode, 'empty_response')
})
