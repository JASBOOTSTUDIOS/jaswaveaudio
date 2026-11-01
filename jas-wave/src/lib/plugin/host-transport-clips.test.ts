/**
 * npx tsx --test src/lib/plugin/host-transport-clips.test.ts
 *
 * Subida de clips al host por trozos: nunca un mensaje del tamaño del clip, orden correcto y caché.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { CLIP_UPLOAD_CHUNK_FRAMES, hostClipEnsureBuffer, hostClipLoadPcm } from './host-transport'

type Cmd = Record<string, unknown>

function fakeBuffer(frames: number, sampleRate = 48000, value = 0.5): AudioBuffer {
  const L = new Float32Array(frames).fill(value)
  const R = new Float32Array(frames).fill(-value)
  return {
    length: frames,
    sampleRate,
    numberOfChannels: 2,
    duration: frames / sampleRate,
    getChannelData: (c: number) => (c === 0 ? L : R),
  } as unknown as AudioBuffer
}

describe('host-transport: subida de clips por trozos', () => {
  let enviados: Cmd[] = []
  let hostTiene = false
  let rechazarChunk: number | null = null

  beforeEach(() => {
    enviados = []
    hostTiene = false
    rechazarChunk = null
    ;(globalThis as unknown as { window: unknown }).window = {
      electron: {
        pluginHostSend: async (cmd: Cmd) => {
          enviados.push(cmd)
          if (cmd.type === 'clip.has') return { ok: true, loaded: hostTiene }
          if (cmd.type === 'clip.loadChunk' && rechazarChunk === (cmd.offsetFrames as number)) {
            return { ok: false }
          }
          if (cmd.type === 'clip.loadEnd') hostTiene = true
          return { ok: true }
        },
      },
    }
  })
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window
  })

  it('un clip largo se parte en trozos ordenados y acotados', async () => {
    const frames = CLIP_UPLOAD_CHUNK_FRAMES * 2 + 1000
    const ok = await hostClipEnsureBuffer('c1', fakeBuffer(frames))
    assert.equal(ok, true)
    const tipos = enviados.map((c) => c.type)
    assert.deepEqual(tipos, ['clip.loadBegin', 'clip.loadChunk', 'clip.loadChunk', 'clip.loadChunk', 'clip.loadEnd'])
    const chunks = enviados.filter((c) => c.type === 'clip.loadChunk')
    assert.deepEqual(
      chunks.map((c) => c.offsetFrames),
      [0, CLIP_UPLOAD_CHUNK_FRAMES, CLIP_UPLOAD_CHUNK_FRAMES * 2],
    )
    assert.equal(chunks.reduce((n, c) => n + (c.frames as number), 0), frames)
    // ~1 MB de PCM por trozo → base64 acotado (muy por debajo del límite de string de V8).
    for (const c of chunks) assert.ok((c.pcmBase64 as string).length < 2_000_000)
  })

  it('interleavea L/R correctamente', async () => {
    await hostClipEnsureBuffer('c2', fakeBuffer(4, 48000, 0.25))
    const chunk = enviados.find((c) => c.type === 'clip.loadChunk')!
    const bytes = Buffer.from(chunk.pcmBase64 as string, 'base64')
    const f = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
    assert.deepEqual(Array.from(f), [0.25, -0.25, 0.25, -0.25, 0.25, -0.25, 0.25, -0.25])
  })

  it('no reenvía un clip que el host ya tiene; resube si el host lo perdió', async () => {
    const buf = fakeBuffer(1000)
    assert.equal(await hostClipEnsureBuffer('c3', buf), true)
    enviados = []
    assert.equal(await hostClipEnsureBuffer('c3', buf), true)
    assert.deepEqual(enviados.map((c) => c.type), ['clip.has'])

    hostTiene = false // el host se reinició
    enviados = []
    assert.equal(await hostClipEnsureBuffer('c3', buf), true)
    assert.ok(enviados.some((c) => c.type === 'clip.loadChunk'))
  })

  it('si un trozo falla, devuelve false y descarga lo parcial', async () => {
    rechazarChunk = CLIP_UPLOAD_CHUNK_FRAMES
    const ok = await hostClipEnsureBuffer('c4', fakeBuffer(CLIP_UPLOAD_CHUNK_FRAMES * 2))
    assert.equal(ok, false)
    assert.equal(enviados.at(-1)?.type, 'clip.unload')
    assert.ok(!enviados.some((c) => c.type === 'clip.loadEnd'))
  })

  it('subidas concurrentes del mismo clip comparten una sola carga', async () => {
    const buf = fakeBuffer(1000)
    const [a, b] = await Promise.all([hostClipEnsureBuffer('c5', buf), hostClipEnsureBuffer('c5', buf)])
    assert.equal(a && b, true)
    assert.equal(enviados.filter((c) => c.type === 'clip.loadBegin').length, 1)
  })

  it('hostClipLoadPcm sube PCM interleaved ya construido', async () => {
    const pcm = new Float32Array([0.1, 0.2, 0.3, 0.4])
    assert.equal(await hostClipLoadPcm('c6', pcm, 2, 2, 44100), true)
    const begin = enviados[0]
    assert.equal(begin.type, 'clip.loadBegin')
    assert.equal(begin.sampleRate, 44100)
  })
})
