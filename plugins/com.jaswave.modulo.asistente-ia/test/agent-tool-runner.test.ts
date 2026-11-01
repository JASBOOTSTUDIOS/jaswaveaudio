/**
 * npx tsx --test src/lib/agent-tool-runner.test.ts
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearEstadoInicial, crearTiendaDAW, getStateRevision, toolRegistry } from '../../../shared/src/index'
import { registerAgentCatalogOnRegistry } from '@/src/lib/agent-action-catalog'
import { _olvidarRechazosNotesSet, comoListaDeNotas, esResumenDeHistorial, explicarErrorHerramienta, instrumentoAproximado, normalizarParche, notasRelativasAlClip, runRegisteredTool, runRegisteredTools, sinComillasEnIds } from '../src/motor/agent-tool-runner'

describe('agent-tool-runner (ADR-0017)', () => {
  it('project.setBpm vía Registry/Command actualiza revision', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['project.setBpm'], tienda.registroComandos)

    const before = getStateRevision(tienda.obtenerEstado())
    const r = await runRegisteredTool(
      tienda,
      { id: 'c1', tool: 'project.setBpm', arguments: { bpm: 96 } },
      { forceApply: true, agentMode: 'create' },
    )
    assert.equal(r.status, 'success')
    assert.equal(tienda.obtenerEstado().project.bpm.valor, 96)
    assert.notEqual(getStateRevision(tienda.obtenerEstado()), before)
  })

  it('pistaId ↔ trackId se traduce según el esquema de cada comando', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['track.update', 'midi.clip.create'], tienda.registroComandos)
    await tienda.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi' }, 'user')
    const id = tienda.obtenerEstado().project.tracks[0]!.id
    const opts = { forceApply: true, agentMode: 'create' as const }
    // track.update solo admite trackId; el modelo suele mandar pistaId (como en los comandos MIDI).
    const a = await runRegisteredTool(tienda, { id: 'p1', tool: 'track.update', arguments: { pistaId: id, datos: { nombre: 'Piano 2' } } }, opts)
    assert.equal(a.status, 'success', a.error?.message)
    // midi.clip.create solo admite pistaId.
    const b = await runRegisteredTool(
      tienda,
      { id: 'p2', tool: 'midi.clip.create', arguments: { trackId: id, nombre: 'Intro', inicio: 0, duracion: 4, notas: [{ pitch: 62, inicio: 0, duracion: 1, velocidad: 90 }] } },
      opts,
    )
    assert.equal(b.status, 'success', b.error?.message)
    assert.equal(tienda.obtenerEstado().project.tracks[0]!.clips.length, 1)
  })

  it('acción del agente registrada sin handler cae al ejecutor heredado (no «Comando no registrado»)', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    if (!toolRegistry.get('mix.eq')) {
      toolRegistry.register({ name: 'mix.eq', type: 'mix.eq', description: 'EQ', category: 'mix', risk: 'write', version: '1.0.0', tags: [] } as never)
    }
    await tienda.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi' }, 'user')
    const id = tienda.obtenerEstado().project.tracks[0]!.id
    const r = await runRegisteredTool(tienda, { id: 'm1', tool: 'mix.eq', arguments: { trackId: id, banda: 1, gain: -2 } }, { forceApply: true, agentMode: 'create' })
    assert.doesNotMatch(r.error?.message ?? '', /Comando no registrado/)
  })

  it('los errores explican parámetros válidos e ids reales para que el modelo se corrija', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['track.update', 'midi.notes.patch'], tienda.registroComandos)
    await tienda.executor.execute('track.create', { nombre: 'Bajo', tipo: 'midi' }, 'user')
    const id = tienda.obtenerEstado().project.tracks[0]!.id
    const opts = { forceApply: true, agentMode: 'create' as const }
    const esquema = (tienda.registroComandos.get('track.update') as { schema?: Record<string, unknown> }).schema
    const msg = explicarErrorHerramienta('track.update', 'Propiedad no permitida: volumen', { trackId: id, volumen: 0.5 }, esquema, tienda.obtenerEstado())
    assert.match(msg, /Parámetros válidos de track\.update: trackId, datos \(obligatorios: trackId, datos\)/)
    assert.match(explicarErrorHerramienta('midi.notes.patch', 'Clip no encontrado: x', { pistaId: id }, undefined, tienda.obtenerEstado()), /créalo antes con midi\.clip\.create/)
    const b = await runRegisteredTool(tienda, { id: 'e2', tool: 'track.update', arguments: { trackId: 'inventado', datos: { volumen: 0.5 } } }, opts)
    assert.match(b.error!.message, new RegExp(`«Bajo» = "${id}"`))
  })

  it('guardia IA: pista duplicada, MIDI en pista de audio, tonos como texto y notas inválidas', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['track.create', 'midi.clip.create'], tienda.registroComandos)
    const opts = { forceApply: true, agentMode: 'create' as const }
    const a = await runRegisteredTool(tienda, { id: 'g1', tool: 'track.create', arguments: { nombre: 'Bajo' } }, opts)
    assert.equal(a.status, 'success', a.error?.message)
    const bajo = tienda.obtenerEstado().project.tracks[0]!
    assert.equal(bajo.tipo, 'midi', 'sin tipo, la IA crea pistas MIDI')
    const dup = await runRegisteredTool(tienda, { id: 'g2', tool: 'track.create', arguments: { nombre: 'bajo ' } }, opts)
    assert.match(dup.error?.message ?? '', new RegExp(`Ya existe la pista «Bajo» = "${bajo.id}"`))
    assert.equal(tienda.obtenerEstado().project.tracks.length, 1)
    await tienda.executor.execute('track.create', { nombre: 'Voz', tipo: 'audio' }, 'user')
    const voz = tienda.obtenerEstado().project.tracks[1]!
    const enAudio = await runRegisteredTool(tienda, { id: 'g3', tool: 'midi.clip.create', arguments: { pistaId: voz.id, inicio: 0, duracion: 4, notas: [{ pitch: 60, inicio: 0, duracion: 1 }] } }, opts)
    assert.match(enAudio.error?.message ?? '', /es de tipo audio/)
    const malas = await runRegisteredTool(tienda, { id: 'g4', tool: 'midi.clip.create', arguments: { pistaId: bajo.id, inicio: 0, duracion: 4, notas: [{ pitch: 140, inicio: 0, duracion: 1 }] } }, opts)
    assert.match(malas.error?.message ?? '', /pitch MIDI 0–127/)
    const texto = await runRegisteredTool(tienda, { id: 'g5', tool: 'midi.clip.create', arguments: { pistaId: bajo.id, nombre: 'A', inicio: 0, duracion: 4, notas: [{ pitch: 'E2', inicio: 0, duracion: 1 }, { pitch: '45', inicio: 1, duracion: 1 }] } }, opts)
    assert.equal(texto.status, 'success', texto.error?.message)
    const clip = tienda.obtenerEstado().project.tracks[0]!.clips[0] as { notas: Array<{ pitch: number }> }
    assert.deepEqual(clip.notas.map((n) => n.pitch), [40, 45])
    const encima = await runRegisteredTool(tienda, { id: 'g6', tool: 'midi.clip.create', arguments: { pistaId: bajo.id, nombre: 'B', inicio: 2, duracion: 4, notas: [{ pitch: 40, inicio: 0, duracion: 1 }] } }, opts)
    assert.match(encima.error?.message ?? '', /Ya hay un clip en ese lugar/)
    const despues = await runRegisteredTool(tienda, { id: 'g7', tool: 'midi.clip.create', arguments: { pistaId: bajo.id, nombre: 'B', inicio: 4, duracion: 4, notas: [{ pitch: 40, inicio: 0, duracion: 1 }] } }, opts)
    assert.equal(despues.status, 'success', despues.error?.message)
  })

  it('midi.clip.create sobre un tramo ya grabado sustituye las notas del clip existente en vez de fallar en bucle', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['midi.clip.create', 'midi.notes.patch', 'midi.notes.get'], tienda.registroComandos)
    const opts = { forceApply: true, agentMode: 'create' as const }
    await tienda.executor.execute('track.create', { nombre: 'Pad', tipo: 'midi' }, 'user')
    await tienda.executor.execute('track.create', { nombre: 'Cuerdas', tipo: 'midi' }, 'user')
    const [pad, cuerdas] = tienda.obtenerEstado().project.tracks
    const a = await runRegisteredTool(tienda, { id: 'r1', tool: 'midi.clip.create', arguments: { pistaId: pad!.id, nombre: 'Coro', inicio: 32, duracion: 16, notas: [{ pitch: 60, inicio: 0, duracion: 4 }, { pitch: 64, inicio: 4, duracion: 4 }, { pitch: 67, inicio: 12, duracion: 4 }] } }, opts)
    assert.equal(a.status, 'success', a.error?.message)
    const clipId = tienda.obtenerEstado().project.tracks[0]!.clips[0]!.id
    // El mismo tramo otra vez (el músico reescribe el coro): mismo clip, notas nuevas, aviso para el modelo.
    const b = await runRegisteredTool(tienda, { id: 'r2', tool: 'midi.clip.create', arguments: { pistaId: pad!.id, nombre: 'Coro', inicio: 32, duracion: 16, notas: [{ pitch: 62, inicio: 0, duracion: 8 }, { pitch: 65, inicio: 8, duracion: 8 }] } }, opts)
    assert.equal(b.status, 'success', b.error?.message)
    assert.equal(b.tool, 'midi.clip.create')
    assert.match(String((b.data as { aviso?: string })?.aviso ?? ''), /no se creó otro; se sustituyeron sus notas entre los beats 32 y 48/)
    const clips = tienda.obtenerEstado().project.tracks[0]!.clips as Array<{ id: string; notas: Array<{ pitch: number; inicio: number }> }>
    assert.equal(clips.length, 1)
    assert.equal(clips[0]!.id, clipId)
    assert.deepEqual(clips[0]!.notas.map((n) => [n.pitch, n.inicio]).sort((x, y) => x[1]! - y[1]!), [[62, 0], [65, 8]])
    // Solo la mitad del tramo: se conservan las notas de la otra mitad.
    const c = await runRegisteredTool(tienda, { id: 'r3', tool: 'midi.clip.create', arguments: { pistaId: pad!.id, nombre: 'Coro b', inicio: 40, duracion: 8, notas: [{ pitch: 69, inicio: 0, duracion: 8 }] } }, opts)
    assert.equal(c.status, 'success', c.error?.message)
    const notas = (tienda.obtenerEstado().project.tracks[0]!.clips[0] as { notas: Array<{ pitch: number; inicio: number }> }).notas
    assert.deepEqual(notas.map((n) => [n.pitch, n.inicio]).sort((x, y) => x[1]! - y[1]!), [[62, 0], [69, 8]])
    // Misma sección con otra duración (32–48 frente a 32–50): se reescribe el clip existente.
    const f = await runRegisteredTool(tienda, { id: 'r6', tool: 'midi.clip.create', arguments: { pistaId: pad!.id, nombre: 'Coro v2', inicio: 32, duracion: 18, notas: [{ pitch: 71, inicio: 0, duracion: 4 }] } }, opts)
    assert.equal(f.status, 'success', f.error?.message)
    assert.equal(tienda.obtenerEstado().project.tracks[0]!.clips.length, 1)
    assert.deepEqual((tienda.obtenerEstado().project.tracks[0]!.clips[0] as { notas: Array<{ pitch: number }> }).notas.map((n) => n.pitch), [71])
    // Un tramo que desborda el clip sigue siendo un error (sería otro clip).
    const d = await runRegisteredTool(tienda, { id: 'r4', tool: 'midi.clip.create', arguments: { pistaId: pad!.id, nombre: 'Puente', inicio: 44, duracion: 16, notas: [{ pitch: 60, inicio: 0, duracion: 1 }] } }, opts)
    assert.match(d.error?.message ?? '', /Ya hay un clip en ese lugar/)
    // El clip existe pero el modelo manda otra pista: se corrige la pista en vez de «Clip no encontrado».
    const e = await runRegisteredTool(tienda, { id: 'r5', tool: 'midi.notes.patch', arguments: { pistaId: cuerdas!.id, clipId, upsert: [{ pitch: 72, inicio: 2, duracion: 1 }] } }, opts)
    assert.equal(e.status, 'success', e.error?.message)
    assert.equal((tienda.obtenerEstado().project.tracks[0]!.clips[0] as { notas: unknown[] }).notas.length, 2)
    assert.equal(tienda.obtenerEstado().project.tracks[1]!.clips.length, 0)
  })

  it('un clipId que en realidad es el NOMBRE del clip se resuelve a su id (si es único)', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['midi.notes.patch'], tienda.registroComandos)
    const opts = { forceApply: true, agentMode: 'create' as const }
    await tienda.executor.execute('track.create', { nombre: 'Lead', tipo: 'midi' }, 'user')
    const lead = tienda.obtenerEstado().project.tracks[0]!
    await tienda.executor.execute('midi.clip.create', { pistaId: lead.id, nombre: 'Lead - Puente', inicio: 0, duracion: 8, notas: [{ pitch: 62, inicio: 0, duracion: 2 }] }, 'user')
    const clip = tienda.obtenerEstado().project.tracks[0]!.clips[0]!
    const r = await runRegisteredTool(tienda, { id: 'n1', tool: 'midi.notes.patch', arguments: { pistaId: lead.id, clipId: 'lead - puente', upsert: [{ pitch: 64, inicio: 2, duracion: 2 }] } }, opts)
    assert.equal(r.status, 'success', r.error?.message)
    assert.equal((tienda.obtenerEstado().project.tracks[0]!.clips[0] as { notas: unknown[] }).notas.length, 2)
    assert.equal(tienda.obtenerEstado().project.tracks[0]!.clips[0]!.id, clip.id)
  })

  it('normalizarParche: el tartamudeo `{"{"id"` del modelo y el resumen del historial', () => {
    const pista = { nombre: 'Pad', clips: [{ id: 'c1', inicio: 0, duracion: 8, notas: [] }] }
    const roto = normalizarParche({ clipId: 'c1', upsert: '[{"id": "a", "pitch": 67, "inicio": 0, "duracion": 4, "velocidad": 88}, {"{"id": "b", "pitch": 71, "inicio": 2, "duracion": 2}]' }, pista)
    assert.ok('args' in roto, 'error' in roto ? roto.error : '')
    if ('args' in roto) assert.deepEqual((roto.args.upsert as Array<{ nota: { pitch: number } }>).map((u) => u.nota.pitch), [67, 71])
    const resumen = normalizarParche({ clipId: 'c1', upsert: '[lista de 14 elementos, abreviada en el historial]' }, pista)
    assert.match('error' in resumen ? resumen.error : '', /resumen del historial/)
  })

  it('notas con claves en inglés y parches parciales por id ({id, velocidad}) se completan con la nota existente', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['midi.clip.create', 'midi.notes.patch'], tienda.registroComandos)
    const opts = { forceApply: true, agentMode: 'create' as const }
    await tienda.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi' }, 'user')
    const piano = tienda.obtenerEstado().project.tracks[0]!
    const a = await runRegisteredTool(tienda, { id: 'i1', tool: 'midi.clip.create', arguments: { pistaId: piano.id, nombre: 'Verso', inicio: 0, duracion: 8, notas: [{ note: 'D4', start: 0, duration: 2, velocity: 70 }, { note: 66, start: 2, duration: 2, velocity: 72 }] } }, opts)
    assert.equal(a.status, 'success', a.error?.message)
    const clip = tienda.obtenerEstado().project.tracks[0]!.clips[0] as { id: string; notas: Array<{ id: string; pitch: number; inicio: number; duracion: number; velocidad: number }> }
    assert.deepEqual(clip.notas.map((n) => [n.pitch, n.inicio, n.duracion, n.velocidad]), [[62, 0, 2, 70], [66, 2, 2, 72]])
    // El ingeniero de mezcla baja la dinámica mandando solo id y velocidad.
    const b = await runRegisteredTool(tienda, { id: 'i2', tool: 'midi.notes.patch', arguments: { pistaId: piano.id, clipId: clip.id, upsert: clip.notas.map((n) => ({ id: n.id, velocidad: 50 })) } }, opts)
    assert.equal(b.status, 'success', b.error?.message)
    const despues = (tienda.obtenerEstado().project.tracks[0]!.clips[0] as typeof clip).notas
    assert.deepEqual(despues.map((n) => [n.pitch, n.inicio, n.duracion, n.velocidad]), [[62, 0, 2, 50], [66, 2, 2, 50]])
    // Una nota nueva sin tono sigue siendo un error claro.
    const c = normalizarParche({ clipId: clip.id, upsert: [{ id: 'nueva', velocidad: 90 }] }, tienda.obtenerEstado().project.tracks[0] as never)
    assert.match('error' in c ? c.error : '', /#1 pitch undefined/)
  })

  it('instrumentoAproximado: «piano de cola» es el Grand Piano, no el Piano Synth', () => {
    const l = ['JasWave Grand Piano', 'JasWave Piano Synth', 'JasWave Shimmer Pad']
    assert.equal(instrumentoAproximado('piano de cola', l), 'JasWave Grand Piano')
    assert.equal(instrumentoAproximado('Piano acústico', l), 'JasWave Grand Piano')
    assert.equal(instrumentoAproximado('lead de sinte', l), 'JasWave Piano Synth')
  })

  it('guardia IA: volumen 0 o en dB en el máster o una pista se rechaza (dejaría la canción muda)', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['master.update', 'track.update'], tienda.registroComandos)
    const opts = { forceApply: true, agentMode: 'create' as const }
    const m = await runRegisteredTool(tienda, { id: 'v1', tool: 'master.update', arguments: { datos: { volumen: 0 } } }, opts)
    assert.match(m.error?.message ?? '', /1 = 0 dB/)
    await tienda.executor.execute('track.create', { nombre: 'Bajo', tipo: 'midi' }, 'user')
    const id = tienda.obtenerEstado().project.tracks[0]!.id
    const t = await runRegisteredTool(tienda, { id: 'v2', tool: 'track.update', arguments: { trackId: id, datos: { volumen: -6 } } }, opts)
    assert.match(t.error?.message ?? '', /lineal de 0 a 4/)
    const ok = await runRegisteredTool(tienda, { id: 'v3', tool: 'master.update', arguments: { datos: { volumen: 0.9 } } }, opts)
    assert.equal(ok.status, 'success', ok.error?.message)
  })

  it('notasRelativasAlClip: pasa a relativas solo las notas en tiempo de la canción', () => {
    const abs = [{ inicio: 64 }, { inicio: 80 }, { inicio: 95 }]
    assert.deepEqual(notasRelativasAlClip(abs, 64, 32)?.map((n) => n.inicio), [0, 16, 31])
    assert.deepEqual(notasRelativasAlClip(abs, 64)?.map((n) => n.inicio), [0, 16, 31], 'sin duración también')
    assert.equal(notasRelativasAlClip([{ inicio: 0 }, { inicio: 8 }], 64, 32), undefined, 'ya relativas')
    assert.equal(notasRelativasAlClip([{ inicio: 4 }, { inicio: 8 }], 4, 16), undefined, 'caben como relativas: no se tocan')
    assert.equal(notasRelativasAlClip([{ inicio: 64 }, { inicio: 200 }], 64, 32), undefined, 'tampoco caben como absolutas')
    assert.equal(notasRelativasAlClip(abs, 0, 32), undefined, 'clip al principio')
  })

  it('guardia IA: notas en tiempo de la canción y clips lejos de todo', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['midi.clip.create'], tienda.registroComandos)
    await tienda.executor.execute('track.create', { nombre: 'Bajo', tipo: 'midi' }, 'user')
    const id = tienda.obtenerEstado().project.tracks[0]!.id
    const opts = { forceApply: true, agentMode: 'create' as const }
    const notas = [0, 8, 16, 24].map((b) => ({ pitch: 38, inicio: 64 + b, duracion: 4, velocidad: 90 }))
    const r = await runRegisteredTool(tienda, { id: 'a1', tool: 'midi.clip.create', arguments: { pistaId: id, nombre: 'Coro', inicio: 64, duracion: 32, notas } }, opts)
    assert.equal(r.status, 'success', r.error?.message)
    const clip = tienda.obtenerEstado().project.tracks[0]!.clips[0] as { notas: Array<{ inicio: number }> }
    assert.deepEqual(clip.notas.map((n) => n.inicio), [0, 8, 16, 24])
    const lejos = await runRegisteredTool(tienda, { id: 'a2', tool: 'midi.clip.create', arguments: { pistaId: id, nombre: 'Verso 2', inicio: 385, duracion: 32, notas: [{ pitch: 38, inicio: 0, duracion: 4 }] } }, opts)
    assert.match(lejos.error?.message ?? '', /todo lo grabado termina en el beat 96/)
  })

  it('guardia IA: midi.notes.set que borraría la mayoría de notas pide midi.notes.patch', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['midi.notes.set'], tienda.registroComandos)
    await tienda.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi' }, 'user')
    const id = tienda.obtenerEstado().project.tracks[0]!.id
    const notas = Array.from({ length: 8 }, (_, i) => ({ pitch: 60 + i, inicio: i * 0.5, duracion: 0.5, velocidad: 90 }))
    await tienda.executor.execute('midi.clip.create', { pistaId: id, nombre: 'A', inicio: 0, duracion: 4, notas }, 'user')
    const clipId = tienda.obtenerEstado().project.tracks[0]!.clips[0]!.id
    const opts = { forceApply: true, agentMode: 'create' as const }
    const pocas = [{ pitch: 72, inicio: 0, duracion: 1, velocidad: 90 }]
    const r = await runRegisteredTool(tienda, { id: 's1', tool: 'midi.notes.set', arguments: { pistaId: id, clipId, notas: pocas } }, opts)
    assert.match(r.error?.message ?? '', /midi\.notes\.patch/)
    const ok = await runRegisteredTool(tienda, { id: 's2', tool: 'midi.notes.set', arguments: { pistaId: id, clipId, notas: pocas, reemplazarTodas: true } }, opts)
    assert.equal(ok.status, 'success', ok.error?.message)
  })

  it('la lista de notas con otro nombre de campo (notes, eventos…) se acepta como notas', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['midi.clip.create'], tienda.registroComandos)
    const opts = { forceApply: true, agentMode: 'create' as const }
    await tienda.executor.execute('track.create', { nombre: 'Pad', tipo: 'midi' }, 'user')
    const id = tienda.obtenerEstado().project.tracks[0]!.id
    const r = await runRegisteredTool(tienda, { id: 'a1', tool: 'midi.clip.create', arguments: { pistaId: id, nombre: 'Intro', inicio: 0, duracion: 16, notes: [{ pitch: 62, inicio: 0, duracion: 4, velocidad: 70 }] } }, opts)
    assert.equal(r.status, 'success', r.error?.message)
    assert.equal((tienda.obtenerEstado().project.tracks[0]!.clips[0] as { notas: unknown[] }).notas.length, 1)
    const e = await runRegisteredTool(tienda, { id: 'a2', tool: 'midi.clip.create', arguments: { pistaId: id, nombre: 'Intro', inicio: 0, duracion: 16, eventos: [{ pitch: 64, inicio: 0, duracion: 4, velocidad: 70 }] } }, opts)
    assert.equal(e.status, 'success', e.error?.message)
    assert.equal(tienda.obtenerEstado().project.tracks[0]!.clips.length, 1)
  })

  it('un clip que se pasa hasta 1 beat de su sección no bloquea al siguiente; un solape mayor sigue rechazándose', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['midi.clip.create'], tienda.registroComandos)
    const opts = { forceApply: true, agentMode: 'create' as const }
    await tienda.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi' }, 'user')
    const id = tienda.obtenerEstado().project.tracks[0]!.id
    // «Intro» de 16 beats con una nota que llega al beat 16,6 (el clip se alarga solo).
    await tienda.executor.execute('midi.clip.create', { pistaId: id, nombre: 'Intro', inicio: 0, duracion: 16, notas: [{ pitch: 60, inicio: 15.5, duracion: 1.1, velocidad: 80 }] }, 'user')
    const sig = await runRegisteredTool(tienda, { id: 'c1', tool: 'midi.clip.create', arguments: { pistaId: id, nombre: 'Verso 1', inicio: 16, duracion: 32, notas: [{ pitch: 62, inicio: 0, duracion: 2, velocidad: 80 }] } }, opts)
    assert.equal(sig.status, 'success', sig.error?.message)
    const mucho = await runRegisteredTool(tienda, { id: 'c2', tool: 'midi.clip.create', arguments: { pistaId: id, nombre: 'Otro', inicio: 14, duracion: 8, notas: [{ pitch: 62, inicio: 0, duracion: 2, velocidad: 80 }] } }, opts)
    assert.match(mucho.error?.message ?? '', /Ya hay un clip en ese lugar/)
  })

  it('midi.notes.set: si el modelo insiste con lo mismo tras el aviso, se acepta (no hay bucle de rechazos)', async () => {
    _olvidarRechazosNotesSet()
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['midi.notes.set'], tienda.registroComandos)
    await tienda.executor.execute('track.create', { nombre: 'Bateria', tipo: 'midi' }, 'user')
    const id = tienda.obtenerEstado().project.tracks[0]!.id
    const notas = Array.from({ length: 16 }, (_, i) => ({ pitch: 36 + (i % 4), inicio: i * 0.25, duracion: 0.25, velocidad: 90 }))
    await tienda.executor.execute('midi.clip.create', { pistaId: id, nombre: 'A', inicio: 0, duracion: 4, notas }, 'user')
    const clipId = tienda.obtenerEstado().project.tracks[0]!.clips[0]!.id
    const opts = { forceApply: true, agentMode: 'create' as const }
    const menos = Array.from({ length: 6 }, (_, i) => ({ pitch: 38, inicio: i * 0.5, duracion: 0.25, velocidad: 80 }))
    const primero = await runRegisteredTool(tienda, { id: 'i1', tool: 'midi.notes.set', arguments: { pistaId: id, clipId, notas: menos } }, opts)
    assert.match(primero.error?.message ?? '', /midi\.notes\.patch/)
    const segundo = await runRegisteredTool(tienda, { id: 'i2', tool: 'midi.notes.set', arguments: { pistaId: id, clipId, notas: menos } }, opts)
    assert.equal(segundo.status, 'success', segundo.error?.message)
    assert.equal((tienda.obtenerEstado().project.tracks[0]!.clips[0] as { notas: unknown[] }).notas.length, 6)
    // Una escritura distinta que vuelve a borrar casi todo avisa otra vez (la insistencia ya se consumió).
    const una = [{ pitch: 38, inicio: 0, duracion: 0.25, velocidad: 80 }]
    const tercero = await runRegisteredTool(tienda, { id: 'i3', tool: 'midi.notes.set', arguments: { pistaId: id, clipId, notas: una } }, opts)
    assert.match(tercero.error?.message ?? '', /midi\.notes\.patch/)
  })

  it('track.addVstLayer registrado como comando inexistente cae al ejecutor heredado (caso real de la app)', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    // En la app quedó registrado con handler de comando aunque la tienda no tiene ese comando.
    const falso = { get: (t: string) => (t === 'track.addVstLayer' ? {} : tienda.registroComandos.get(t)) }
    if (toolRegistry.get('track.addVstLayer')) toolRegistry.unregister?.('track.addVstLayer')
    registerAgentCatalogOnRegistry(toolRegistry, ['track.addVstLayer'], falso)
    await tienda.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi' }, 'user')
    const id = tienda.obtenerEstado().project.tracks[0]!.id
    const r = await runRegisteredTool(tienda, { id: 'v1', tool: 'track.addVstLayer', arguments: { trackId: id, nombre: 'Inexistente XYZ' } }, { forceApply: true, agentMode: 'create' })
    assert.doesNotMatch(r.error?.message ?? '', /Comando no registrado/)
  })

  it('plugin.insert con un plugin inventado (sin ruta) se resuelve por nombre, no inserta un fantasma', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['plugin.insert'], tienda.registroComandos)
    await tienda.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi' }, 'user')
    const id = tienda.obtenerEstado().project.tracks[0]!.id
    const r = await runRegisteredTool(tienda, { id: 'i1', tool: 'plugin.insert', arguments: { trackId: id, plugin: { nombre: 'Inexistente XYZ' } } }, { forceApply: true, agentMode: 'create' })
    assert.equal(r.status, 'error')
    assert.equal(tienda.obtenerEstado().project.tracks[0]!.plugins.length, 0)
  })

  it('nombre aproximado de instrumento → el instalado («Bajo», «JasWave Bass», «piano de cola»)', () => {
    const inst = ['JasWave Ambient Atmos', 'JasWave Electric Bass', 'JasWave Electric Guitar', 'JasWave Grand Piano', 'JasWave Strings Section']
    assert.equal(instrumentoAproximado('JasWave Grand Piano', inst), 'JasWave Grand Piano')
    assert.equal(instrumentoAproximado('grand piano', inst), 'JasWave Grand Piano')
    assert.equal(instrumentoAproximado('Bajo', inst), 'JasWave Electric Bass')
    assert.equal(instrumentoAproximado('JasWave Bass', inst), 'JasWave Electric Bass')
    assert.equal(instrumentoAproximado('Piano de cola', inst), 'JasWave Grand Piano')
    assert.equal(instrumentoAproximado('Pad atmosférico', inst), 'JasWave Ambient Atmos')
    assert.equal(instrumentoAproximado('Violines', inst), 'JasWave Strings Section')
    // Ambiguo («Electric» = bajo y guitarra) o desconocido: no adivina.
    assert.equal(instrumentoAproximado('JasWave Electric', inst), undefined)
    assert.equal(instrumentoAproximado('JasWave EQ', inst), undefined)
  })

  it('guardia IA: notas como texto JSON, como objeto o como mapa se aceptan; otra cosa, error claro', async () => {
    assert.deepEqual(comoListaDeNotas('[{"pitch":60,"inicio":0,"duracion":1}]'), [{ pitch: 60, inicio: 0, duracion: 1 }])
    assert.deepEqual(comoListaDeNotas({ pitch: 60, inicio: 0, duracion: 1 }), [{ pitch: 60, inicio: 0, duracion: 1 }])
    assert.deepEqual(comoListaDeNotas({ 1: { pitch: 62 }, 0: { pitch: 60 } }), [{ pitch: 60 }, { pitch: 62 }])
    assert.deepEqual(comoListaDeNotas({ notas: [{ pitch: 60 }] }), [{ pitch: 60 }])
    assert.equal(comoListaDeNotas('hola'), null)
    assert.equal(comoListaDeNotas(5), null)
    // Formas que mandaba la banda en el e2e 29 (60+ rechazos «no un texto»): fences, JSON laxo, cortado, filas.
    assert.deepEqual(comoListaDeNotas('```json\n[{"pitch":60,"inicio":0,"duracion":1}]\n```'), [{ pitch: 60, inicio: 0, duracion: 1 }])
    assert.deepEqual(comoListaDeNotas("[{pitch: 60, inicio: 0, duracion: 1, velocidad: 90,}, {pitch: 'C4', inicio: 1, duracion: 1}]"), [
      { pitch: 60, inicio: 0, duracion: 1, velocidad: 90 },
      { pitch: 'C4', inicio: 1, duracion: 1 },
    ])
    assert.deepEqual(comoListaDeNotas('[{"pitch":60,"inicio":0,"duracion":1},{"pitch":62,"inicio":1,"duracion":1},{"pitch":64,"ini'), [
      { pitch: 60, inicio: 0, duracion: 1 },
      { pitch: 62, inicio: 1, duracion: 1 },
    ])
    assert.deepEqual(comoListaDeNotas('60 0 1 100\nC4, 1, 0.5\nE4 1.5 0,5 80'), [
      { pitch: 60, inicio: 0, duracion: 1, velocidad: 100 },
      { pitch: 60, inicio: 1, duracion: 0.5 },
      { pitch: 64, inicio: 1.5, duracion: 0.5, velocidad: 80 },
    ])
    assert.deepEqual(comoListaDeNotas('pitch=60 inicio=0 duracion=1 velocidad=90; pitch: C4, inicio: 2, duracion: 1'), [
      { pitch: 60, inicio: 0, duracion: 1, velocidad: 90 },
      { pitch: 60, inicio: 2, duracion: 1 },
    ])
    assert.equal(comoListaDeNotas('Bombo en 1 y 3, caja en 2 y 4'), null)
    // Más formas vistas en la 9.ª pasada: viñetas, columnas con «:», claves sin signo, varias notas por línea con
    // comas, cabeceras o comentarios entre las filas.
    assert.deepEqual(comoListaDeNotas('- 36 0 0.5 100\n- 38 1 0.5 90'), [
      { pitch: 36, inicio: 0, duracion: 0.5, velocidad: 100 },
      { pitch: 38, inicio: 1, duracion: 0.5, velocidad: 90 },
    ])
    assert.deepEqual(comoListaDeNotas('1. 36:0:0.5:100\n2. C2/1/0.5/90'), [
      { pitch: 36, inicio: 0, duracion: 0.5, velocidad: 100 },
      { pitch: 36, inicio: 1, duracion: 0.5, velocidad: 90 },
    ])
    assert.deepEqual(comoListaDeNotas('pitch 36, inicio 0, duracion 0.5, velocidad 100\nnote 38 start 1 duration 0.5 velocity 90'), [
      { pitch: 36, inicio: 0, duracion: 0.5, velocidad: 100 },
      { pitch: 38, inicio: 1, duracion: 0.5, velocidad: 90 },
    ])
    assert.deepEqual(comoListaDeNotas('C4 0 1 100, E4 1 1 100, G4 2 1 90'), [
      { pitch: 60, inicio: 0, duracion: 1, velocidad: 100 },
      { pitch: 64, inicio: 1, duracion: 1, velocidad: 100 },
      { pitch: 67, inicio: 2, duracion: 1, velocidad: 90 },
    ])
    assert.deepEqual(comoListaDeNotas('pitch inicio duracion velocidad\n60 0 1 100\n62 1 1 100'), [
      { pitch: 60, inicio: 0, duracion: 1, velocidad: 100 },
      { pitch: 62, inicio: 1, duracion: 1, velocidad: 100 },
    ])
    // Prosa con algún número suelto sigue sin ser una lista.
    assert.equal(comoListaDeNotas('Intro de 4 compases\nsuave y en Re mayor\ncon el bombo en 1 y 3'), null)
    // El resumen que el historial hace de las listas largas (la causa real de los rechazos en el e2e 29: el
    // modelo lo copiaba como si fueran notas) se reconoce para explicarlo.
    assert.equal(comoListaDeNotas('[80 elementos]'), null)
    assert.equal(esResumenDeHistorial('[80 elementos]'), true)
    assert.equal(esResumenDeHistorial('[lista de 40 elementos, abreviada en el historial]'), true)
    assert.equal(esResumenDeHistorial('[{"pitch":60}]'), false)
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['midi.clip.create'], tienda.registroComandos)
    await tienda.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi' }, 'user')
    const id = tienda.obtenerEstado().project.tracks[0]!.id
    const opts = { forceApply: true, agentMode: 'create' as const }
    // Caso real de la 7.ª pasada: notas en texto → «(t.notas ?? []).filter is not a function».
    const texto = await runRegisteredTool(tienda, { id: 'n1', tool: 'midi.clip.create', arguments: { pistaId: id, nombre: 'A', inicio: 0, duracion: 4, notas: JSON.stringify([{ pitch: 60, inicio: 0, duracion: 1 }]) } }, opts)
    assert.equal(texto.status, 'success', texto.error?.message)
    assert.equal((tienda.obtenerEstado().project.tracks[0]!.clips[0] as { notas: unknown[] }).notas.length, 1)
    const mal = await runRegisteredTool(tienda, { id: 'n2', tool: 'midi.clip.create', arguments: { pistaId: id, nombre: 'B', inicio: 8, duracion: 4, notas: 'do re mi' } }, opts)
    assert.match(mal.error?.message ?? '', /notas debe ser una lista/)
    assert.doesNotMatch(mal.error?.message ?? '', /is not a function/)
  })

  it('guardia IA: ids copiados con comillas («"1793-x"») se limpian', () => {
    const limpio = sinComillasEnIds({ pistaId: '"1793-x"', clipId: ' «c1» ', nombre: '"no se toca"', trackId: 7 })
    assert.equal(limpio.pistaId, '1793-x')
    assert.equal(limpio.clipId, 'c1')
    assert.equal(limpio.nombre, '"no se toca"')
    assert.equal(limpio.trackId, 7)
  })

  it('guardia IA: midi.notes.patch acepta notas sueltas en upsert (o en notas) y crea ids; antes reventaba con «reading id»', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['midi.notes.patch'], tienda.registroComandos)
    await tienda.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi' }, 'user')
    const id = tienda.obtenerEstado().project.tracks[0]!.id
    const notas = Array.from({ length: 4 }, (_, i) => ({ pitch: 60 + i, inicio: i, duracion: 1, velocidad: 90 }))
    await tienda.executor.execute('midi.clip.create', { pistaId: id, nombre: 'A', inicio: 0, duracion: 4, notas }, 'user')
    const clip = tienda.obtenerEstado().project.tracks[0]!.clips[0] as { id: string; notas: Array<{ id: string; pitch: number }> }
    const opts = { forceApply: true, agentMode: 'create' as const }
    // Notas sueltas: una existente (con id, cambia el pitch) y una nueva (sin id).
    const r = await runRegisteredTool(
      tienda,
      { id: 'p1', tool: 'midi.notes.patch', arguments: { pistaId: id, clipId: clip.id, upsert: [{ id: clip.notas[0]!.id, pitch: 72, inicio: 0, duracion: 1 }, { pitch: 'E4', inicio: 3.5, duracion: 0.5 }] } },
      opts,
    )
    assert.equal(r.status, 'success', r.error?.message)
    const despues = (tienda.obtenerEstado().project.tracks[0]!.clips[0] as { notas: Array<{ id: string; pitch: number }> }).notas
    assert.equal(despues.length, 5)
    assert.equal(despues.find((n) => n.id === clip.notas[0]!.id)?.pitch, 72)
    assert.ok(despues.some((n) => n.pitch === 64))
    // `notas` en vez de `upsert` y `removeIds` ausente también vale; quitar por id funciona.
    const r2 = await runRegisteredTool(tienda, { id: 'p2', tool: 'midi.notes.patch', arguments: { pistaId: id, clipId: clip.id, notas: [], removeIds: [clip.notas[1]!.id] } }, opts)
    assert.equal(r2.status, 'success', r2.error?.message)
    assert.equal((tienda.obtenerEstado().project.tracks[0]!.clips[0] as { notas: unknown[] }).notas.length, 4)
    // Nota inválida: error accionable, nada cambia.
    const r3 = await runRegisteredTool(tienda, { id: 'p3', tool: 'midi.notes.patch', arguments: { pistaId: id, clipId: clip.id, upsert: [{ pitch: 300, inicio: 0, duracion: 1 }] } }, opts)
    assert.match(r3.error?.message ?? '', /pitch MIDI 0–127/)
    // Sin nada que cambiar.
    const vacio = normalizarParche({ pistaId: id, clipId: clip.id }, undefined)
    assert.ok('error' in vacio && /no cambia nada/.test(vacio.error))
  })

  it('guardia IA: midi.notes.patch por tramo (rangeStart/rangeEnd/notas en beats de la canción) sustituye solo ese tramo del clip', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['midi.notes.patch'], tienda.registroComandos)
    await tienda.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi' }, 'user')
    const id = tienda.obtenerEstado().project.tracks[0]!.id
    // Clip del coro en el beat 16 (4 compases), una nota por beat.
    const notas = Array.from({ length: 16 }, (_, i) => ({ pitch: 60, inicio: i, duracion: 1, velocidad: 90 }))
    await tienda.executor.execute('midi.clip.create', { pistaId: id, nombre: 'Coro', inicio: 16, duracion: 16, notas }, 'user')
    const opts = { forceApply: true, agentMode: 'create' as const }
    // Compás 7 de la canción (beats 24–28): dos notas nuevas en tiempo de la canción.
    const r = await runRegisteredTool(
      tienda,
      { id: 'r1', tool: 'midi.notes.patch', arguments: { pistaId: id, rangeStart: 24, rangeEnd: 28, notas: [{ pitch: 67, inicio: 24, duracion: 2 }, { pitch: 69, inicio: 26, duracion: 2 }] } },
      opts,
    )
    assert.equal(r.status, 'success', r.error?.message)
    const despues = (tienda.obtenerEstado().project.tracks[0]!.clips[0] as { notas: Array<{ pitch: number; inicio: number }> }).notas
    assert.equal(despues.length, 14, 'quita las 4 del tramo y pone 2')
    assert.deepEqual(despues.filter((n) => n.pitch !== 60).map((n) => n.inicio).sort((a, b) => a - b), [8, 10], 'relativas al clip (24−16, 26−16)')
    // Tramo sin clip: error accionable (no se crea nada a ciegas).
    const fuera = await runRegisteredTool(tienda, { id: 'r2', tool: 'midi.notes.patch', arguments: { pistaId: id, rangeStart: 64, rangeEnd: 68, notas: [{ pitch: 60, inicio: 64, duracion: 1 }] } }, opts)
    assert.match(fuera.error?.message ?? '', /Ningún clip de «Piano» cubre los beats 64–68/)
  })

  it('STATE_CONFLICT si expectedRevision no coincide', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    toolRegistry.setContext(tienda.executor, tienda.permisos)
    registerAgentCatalogOnRegistry(toolRegistry, ['project.setBpm'], tienda.registroComandos)

    const r = await runRegisteredTool(
      tienda,
      { id: 'c2', tool: 'project.setBpm', arguments: { bpm: 100, __expectedRevision: 'deadbeef' } },
      { forceApply: true, agentMode: 'create' },
    )
    assert.equal(r.status, 'error')
    assert.equal(r.error?.code, 'STATE_CONFLICT')
  })

  it('idempotencia: callId ya ejecutado se omite', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    const done = new Set(['c3'])
    const r = await runRegisteredTools(
      tienda,
      [{ id: 'c3', tool: 'project.setBpm', arguments: { bpm: 140 } }],
      { forceApply: true, agentMode: 'create', executedCallIds: done },
    )
    assert.equal(r[0]?.status, 'success')
    assert.equal((r[0]?.data as { skipped?: boolean })?.skipped, true)
    assert.notEqual(tienda.obtenerEstado().project.bpm.valor, 140)
  })
})
