/** U-maestra F6: herramientas del agente consultar_ayuda / abrir_pantalla / resaltar / guiar_paso_a_paso. */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { agentActionClassOfType, crearIndiceAyuda, type FichaAyuda } from '@jaswave/ai-harness'
import { listarIdsAyuda, registrarIdsAyuda, reiniciarRegistroAyuda } from '../../../jas-wave/src/lib/guia-ui'
import {
  H_ABRIR_PANTALLA, H_GUIAR_PASO_A_PASO, H_RESALTAR, HERRAMIENTAS_AYUDA, MAX_TEXTO_AYUDA, NOMBRES_PREDICADOS, PREDICADOS_GUIA,
  ejecutarHerramientaAyuda, herramientasAyuda, idsParecidos, registrarAyudaEnHost, contarAperturas, type DepsAyuda, type EstadoLecturaGuia,
} from '../src/motor/turno/herramientas-ayuda'
import { pasoAvanzaSolo, textoProgresoGuia } from '../src/ui/tarjeta-guia'

const ficha = (p: Partial<FichaAyuda> & { id: string }): FichaAyuda => ({ tipo: p.id.split(':')[0] as FichaAyuda['tipo'], titulo: 'T', resumen: 'R', nivel: 'principiante', fuente: 'curada', ...p })
const ID_MALO = 'a b; <script>'
const FICHAS: FichaAyuda[] = [
  ficha({ id: 'panel:mixer', titulo: 'Mezclador', resumen: 'Volumen y panorama', comoAbrir: { herramienta: 'mixer' }, controles: [{ ayuda: 'mixer.fader', etiqueta: 'Fader' }, { ayuda: ID_MALO, etiqueta: 'malo' }] }),
  ficha({ id: 'pantalla:atajos', titulo: 'Atajos', resumen: 'Lista', comoAbrir: { menu: 'Ayuda > Atajos' } }),
]

type Registro = { abiertas: string[]; resaltados: unknown[]; guias: unknown[]; ids: Set<string>; predicados: Map<string, () => boolean> }
function deps(estado: EstadoLecturaGuia = {}, estilos = 0): { d: DepsAyuda; r: Registro } {
  const r: Registro = { abiertas: [], resaltados: [], guias: [], ids: new Set(['mixer', 'panel:mixer', 'piano-roll']), predicados: new Map() }
  const d: DepsAyuda = {
    fichas: () => ({ fichas: FICHAS, indice: crearIndiceAyuda(FICHAS) }),
    abrirPantalla: (id) => (r.abiertas.push(id), { abierto: true, motivo: 'ok' }),
    pantallasAbribles: () => ['mixer', 'piano-roll', 'library', 'dlg.atajos'],
    idsRegistrados: () => [...r.ids],
    resaltar: (p) => (r.resaltados.push(p), { ok: true }),
    iniciarGuia: (p) => (r.guias.push(p), { ok: true }),
    registrarIds: (ids) => {
      const ok = /^[a-z0-9][a-z0-9:._-]{0,63}$/
      const reg: string[] = []
      const rech: string[] = []
      for (const e of ids) {
        const id = typeof e === 'string' ? e : e.id
        if (ok.test(id)) { reg.push(id); r.ids.add(id) } else rech.push(id)
      }
      return { registrados: reg, rechazados: rech }
    },
    registrarPredicado: (n, f) => void r.predicados.set(n, f),
    predicados: { estado: () => estado, estilosGuardados: () => estilos },
  }
  return { d, r }
}
const L = (nombre: string, argumentos: Record<string, unknown>) => ({ id: 'x', nombre, argumentos })

describe('definiciones y esquemas', () => {
  const hs = herramientasAyuda()
  it('son las 4 herramientas, con esquema objeto estricto y descripción', () => {
    assert.deepEqual(hs.map((h) => h.nombre), [...HERRAMIENTAS_AYUDA])
    for (const h of hs) {
      assert.equal((h.parametros as { type: string }).type, 'object')
      assert.ok(h.descripcion.length > 40, h.nombre)
      assert.ok(h.titulo, h.nombre)
    }
    for (const n of [H_ABRIR_PANTALLA, H_RESALTAR, H_GUIAR_PASO_A_PASO]) {
      const e = hs.find((h) => h.nombre === n)!.parametros as { additionalProperties?: boolean; required: string[] }
      assert.equal(e.additionalProperties, false, n)
      assert.ok(e.required.length > 0)
    }
  })
  it('resaltar limita el texto y los ids no admiten selectores; guiar limita a 20 pasos y cierra hastaQue', () => {
    const res = hs.find((h) => h.nombre === H_RESALTAR)!.parametros as { properties: { texto: { maxLength: number }; id: { pattern: string } } }
    assert.equal(res.properties.texto.maxLength, MAX_TEXTO_AYUDA)
    const re = new RegExp(res.properties.id.pattern)
    for (const malo of ['#x', '.x', 'a b', 'div > p', '[data-x]', 'a;b', '']) assert.equal(re.test(malo), false, malo)
    assert.equal(re.test('mixer.fader'), true)
    const g = hs.find((h) => h.nombre === H_GUIAR_PASO_A_PASO)!.parametros as any
    assert.equal(g.properties.pasos.maxItems, 20)
    assert.deepEqual(g.properties.pasos.items.properties.hastaQue.properties.tipo.enum, ['manual', 'tool-abierta', 'clic', 'estado'])
    assert.equal(g.properties.pasos.items.additionalProperties, false)
    assert.ok(hs.find((h) => h.nombre === H_GUIAR_PASO_A_PASO)!.descripcion.includes('hay-pista-midi-armada'))
  })
})

describe('clasificación', () => {
  it('toda herramienta de ayuda está clasificada: consultar_ayuda read, el resto ui', () => {
    for (const h of herramientasAyuda()) {
      const c = agentActionClassOfType(h.nombre)
      assert.equal(c, h.nombre === 'consultar_ayuda' ? 'read' : 'ui', h.nombre)
    }
  })
})

describe('consultar_ayuda', () => {
  it('busca en las fichas y responde sin ficha sin inventar', async () => {
    const { d } = deps()
    const ok = (await ejecutarHerramientaAyuda(L('consultar_ayuda', { consulta: 'mezclador volumen' }), d))!
    assert.equal(ok.ok, true, ok.error)
    assert.equal((ok.datos as { fichas: Array<{ id: string }> }).fichas[0]?.id, 'panel:mixer')
    const no = (await ejecutarHerramientaAyuda(L('consultar_ayuda', { consulta: 'zzzxqw' }), d))!
    assert.equal((no.datos as { encontradas: number }).encontradas, 0)
    assert.equal((await ejecutarHerramientaAyuda(L('consultar_ayuda', {}), d))!.ok, false)
  })
})

describe('abrir_pantalla', () => {
  it('abre un id válido (con o sin prefijo panel:) y por la ficha', async () => {
    const { d, r } = deps()
    assert.equal((await ejecutarHerramientaAyuda(L('abrir_pantalla', { id: 'mixer' }), d))!.ok, true)
    assert.equal((await ejecutarHerramientaAyuda(L('abrir_pantalla', { id: 'panel:mixer' }), d))!.ok, true)
    assert.deepEqual(r.abiertas, ['mixer', 'mixer'])
  })
  it('rechaza ids inventados con ids parecidos y no abre nada', async () => {
    const { d, r } = deps()
    const res = (await ejecutarHerramientaAyuda(L('abrir_pantalla', { id: 'mixer-pro' }), d))!
    assert.equal(res.ok, false)
    assert.match(res.error!, /mixer/)
    assert.equal((res.datos as { abierto: boolean }).abierto, false)
    assert.equal(r.abiertas.length, 0)
  })
  it('rechaza selectores libres', async () => {
    const { d, r } = deps()
    for (const id of ['#app', 'div > button', '[data-x]', 'a b', 7, undefined]) {
      assert.equal((await ejecutarHerramientaAyuda(L('abrir_pantalla', { id }), d))!.ok, false, String(id))
    }
    assert.equal(r.abiertas.length, 0)
  })
  it('ficha sin vía programática: dice dónde está, no abre', async () => {
    const { d, r } = deps()
    const res = (await ejecutarHerramientaAyuda(L('abrir_pantalla', { id: 'pantalla:atajos' }), d))!
    assert.equal(res.ok, true)
    assert.equal((res.datos as { abierto: boolean }).abierto, false)
    assert.match((res.datos as { motivo: string }).motivo, /Ayuda > Atajos/)
    assert.equal(r.abiertas.length, 0)
  })
  it('contarAperturas limita a 3 por turno', async () => {
    const { d } = deps()
    const lim = contarAperturas()
    const l = L('abrir_pantalla', { id: 'mixer' })
    const rs = []
    for (let i = 0; i < 4; i++) rs.push(lim(l, (await ejecutarHerramientaAyuda(l, d))!))
    assert.deepEqual(rs.map((x) => x === null), [true, true, true, false])
  })
})

describe('resaltar', () => {
  it('resalta un id registrado', async () => {
    const { d, r } = deps()
    const res = (await ejecutarHerramientaAyuda(L('resaltar', { id: 'mixer', texto: ' Aquí  ajustas el volumen ' }), d))!
    assert.equal(res.ok, true)
    assert.deepEqual(r.resaltados, [{ id: 'mixer', texto: 'Aquí ajustas el volumen' }])
  })
  it('rechaza ids no registrados, selectores, texto vacío o de más de 140 caracteres', async () => {
    const { d, r } = deps()
    const malos = [
      { id: 'boton-inventado', texto: 'x' },
      { id: '#mixer', texto: 'x' },
      { id: 'button[data-testid=x]', texto: 'x' },
      { id: 'mixer', texto: '' },
      { id: 'mixer', texto: 'x'.repeat(141) },
      { id: 'mixer' },
    ]
    for (const a of malos) assert.equal((await ejecutarHerramientaAyuda(L('resaltar', a), d))!.ok, false, JSON.stringify(a).slice(0, 50))
    assert.equal(r.resaltados.length, 0)
    assert.equal((await ejecutarHerramientaAyuda(L('resaltar', { id: 'mixer', texto: 'x'.repeat(140) }), d))!.ok, true)
  })
})

describe('guiar_paso_a_paso', () => {
  it('convierte hastaQue simple a las formas cerradas de F4', async () => {
    const { d, r } = deps()
    registrarAyudaEnHost(d)
    const res = (await ejecutarHerramientaAyuda(L('guiar_paso_a_paso', { pasos: [
      { texto: 'Abre el mezclador', abrir: 'mixer', hastaQue: { tipo: 'tool-abierta', id: 'mixer' } },
      { texto: 'Mueve el fader', resaltar: 'mixer.fader', hastaQue: { tipo: 'clic', id: 'mixer.fader' } },
      { texto: 'Arma una pista', hastaQue: { tipo: 'estado', id: 'hay-pista-midi-armada' } },
      { texto: 'Sigue', hastaQue: { tipo: 'manual' } },
      { texto: 'Fin' },
    ] }), d))!
    assert.equal(res.ok, true, res.error)
    assert.deepEqual((r.guias[0] as Array<{ hastaQue?: unknown }>).map((p) => p.hastaQue), [
      { evento: 'tool-abierta', id: 'mixer' }, { clic: 'mixer.fader' }, { estado: 'hay-pista-midi-armada' }, { manual: true }, undefined,
    ])
  })
  it('rechaza ids inventados, selectores, formas abiertas, 0 o más de 20 pasos y campos extra', async () => {
    const { d, r } = deps()
    registrarAyudaEnHost(d)
    const paso = (extra: Record<string, unknown>) => ({ pasos: [{ texto: 'ok', ...extra }] })
    const casos: Array<[string, unknown]> = [
      ['resaltar inventado', paso({ resaltar: 'inventado' })],
      ['resaltar selector', paso({ resaltar: '.btn > span' })],
      ['abrir inventado', paso({ abrir: 'pantalla-x' })],
      ['hastaQue sin id', paso({ hastaQue: { tipo: 'clic' } })],
      ['hastaQue tipo abierto', paso({ hastaQue: { tipo: 'js', id: 'x' } })],
      ['hastaQue extra', paso({ hastaQue: { tipo: 'manual', codigo: 'alert(1)' } })],
      ['campo extra', paso({ selector: '#x' })],
      ['sin texto', { pasos: [{ abrir: 'mixer' }] }],
      ['vacío', { pasos: [] }],
      ['no array', { pasos: 'hola' }],
      ['21 pasos', { pasos: Array.from({ length: 21 }, () => ({ texto: 'a' })) }],
    ]
    for (const [n, a] of casos) assert.equal((await ejecutarHerramientaAyuda(L('guiar_paso_a_paso', a as Record<string, unknown>), d))!.ok, false, n)
    assert.equal(r.guias.length, 0)
    assert.equal((await ejecutarHerramientaAyuda(L('guiar_paso_a_paso', { pasos: Array.from({ length: 20 }, () => ({ texto: 'a' })) }), d))!.ok, true)
  })
  it('con el registro real de ids del host: una guía sobre un control de ficha se acepta', async () => {
    reiniciarRegistroAyuda()
    const base = deps().d
    const real: DepsAyuda = { ...base, idsRegistrados: listarIdsAyuda, registrarIds: (i) => registrarIdsAyuda(i) }
    registrarAyudaEnHost(real)
    const ok = await ejecutarHerramientaAyuda(L('guiar_paso_a_paso', { pasos: [{ texto: 'Mira el fader', resaltar: 'mixer.fader', hastaQue: { tipo: 'manual' } }] }), {
      ...real,
      iniciarGuia: (p) => ({ ok: true as const, _p: p }) as { ok: true },
    })
    assert.equal(ok!.ok, true)
  })
})

describe('registro en el host', () => {
  it('registra solo ids válidos de los controles de las fichas y el catálogo cerrado de predicados', () => {
    const { d, r } = deps()
    const out = registrarAyudaEnHost(d)
    assert.deepEqual(out.ids, ['mixer.fader'])
    assert.deepEqual(out.rechazados, [ID_MALO])
    assert.deepEqual([...r.predicados.keys()].sort(), [...NOMBRES_PREDICADOS].sort())
    assert.deepEqual(registrarAyudaEnHost(d).ids, ['mixer.fader']) // idempotente
  })
  it('con el host real los ids de las fichas quedan registrados y el id malo no', () => {
    reiniciarRegistroAyuda()
    registrarAyudaEnHost({ ...deps().d, registrarIds: (i) => registrarIdsAyuda(i) })
    assert.ok(listarIdsAyuda().includes('mixer.fader'))
    assert.ok(!listarIdsAyuda().includes(ID_MALO))
  })
})

describe('predicados de estado (lectura del DAW)', () => {
  const run = (nombre: string, e: EstadoLecturaGuia, estilos = 0) => PREDICADOS_GUIA[nombre]!.evaluar({ estado: () => e, estilosGuardados: () => estilos })
  it('leen el estado real y toleran estados vacíos', () => {
    assert.equal(run('hay-pistas', {}), false)
    assert.equal(run('hay-pistas', { project: { tracks: [{ tipo: 'audio' }] } }), true)
    assert.equal(run('hay-pista-midi-armada', { project: { tracks: [{ tipo: 'audio', armada: true }] } }), false)
    assert.equal(run('hay-pista-midi-armada', { project: { tracks: [{ tipo: 'midi', armada: true }] } }), true)
    assert.equal(run('hay-pista-midi-armada', { project: { tracks: [{ tipo: 'instrumento', armada: false }] } }), false)
    assert.equal(run('hay-clip-en-pista', { project: { tracks: [{ tipo: 'midi', clips: [{ tipo: 'midi' }] }] } }), true)
    assert.equal(run('hay-clip-midi-con-notas', { project: { tracks: [{ tipo: 'midi', clips: [{ tipo: 'midi', notas: [] }] }] } }), false)
    assert.equal(run('hay-clip-midi-con-notas', { project: { tracks: [{ tipo: 'midi', clips: [{ tipo: 'midi', notas: [1] }] }] } }), true)
    assert.equal(run('grabando', { transport: { grabacion: 'grabando' } }), true)
    assert.equal(run('grabando', { transport: { grabacion: 'armada' } }), false)
    assert.equal(run('reproduciendo', { transport: { reproduciendo: true } }), true)
    assert.equal(run('hay-estilo-guardado', {}, 0), false)
    assert.equal(run('hay-estilo-guardado', {}, 2), true)
  })
  it('todos son nombres válidos para el host', () => {
    for (const n of NOMBRES_PREDICADOS) assert.match(n, /^[a-z0-9][a-z0-9:._-]{0,63}$/)
  })
})

describe('utilidades y tarjeta', () => {
  it('idsParecidos', () => assert.deepEqual(idsParecidos('mixer-pro', ['mixer', 'library']), ['mixer']))
  it('textoProgresoGuia y pasoAvanzaSolo', () => {
    const e = { pasos: [{ texto: 'a' }, { texto: 'Pulsa grabar', hastaQue: { estado: 'grabando' } }], paso: 1, terminada: false }
    assert.equal(textoProgresoGuia(e), 'Te estoy guiando: paso 2 de 2 — Pulsa grabar')
    assert.equal(pasoAvanzaSolo(e), true)
    assert.equal(textoProgresoGuia({ pasos: [], paso: -1, terminada: false }), null)
    assert.match(textoProgresoGuia({ ...e, terminada: true })!, /terminada/)
  })
})

describe('no tocan el proyecto', () => {
  it('el código no importa ni llama al ejecutor de comandos del proyecto', () => {
    for (const f of ['../src/motor/turno/herramientas-ayuda.ts', '../src/ui/tarjeta-guia.tsx']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      for (const prohibido of ['executeTools', 'executeDawActions', 'executor.execute', 'agent-tool-bridge']) {
        assert.ok(!src.includes(prohibido), `${f} contiene ${prohibido}`)
      }
    }
  })
  it('ejecutar no hace nada con llamadas ajenas', async () => {
    assert.equal(await ejecutarHerramientaAyuda(L('track.create', {}), deps().d), null)
  })
})
