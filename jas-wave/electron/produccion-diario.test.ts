import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, beforeEach, afterEach } from 'node:test'
import {
  debeRegistrarse,
  ejecutarProduccion,
  estadoEfectivo,
  H_ENCARGOS,
  H_HOJA,
  H_VEREDICTO,
  parsearDiario,
  reconstruirEstado,
  serializarRegistro,
  type ChatAgente,
  type EntradaDiario,
  type EstadoProduccionGuardado,
  type EventoProduccion,
  type ParticipanteProduccion,
} from '../../ai-harness/src/agente'
import { AlmacenProducciones, CANDADO_CADUCA_MS, carpetasProducciones, COPIAS_PUNTO, idValido, PRODUCCIONES_A_CONSERVAR } from './produccion-diario'
import { avisoMemoria, evaluarMemoria } from './vigilancia-memoria'

let tmp = ''
let a: AlmacenProducciones
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-prod-'))
  a = new AlmacenProducciones(path.join(tmp, 'producciones'), path.join(tmp, 'recuperacion'))
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

const inicio = (runId: string): EntradaDiario => ({ k: 'inicio', runId, proyectoId: 'p1', pedido: 'x', participantes: [] })

describe('almacén: rutas', () => {
  it('rechaza identificadores con separadores o `..` y respeta las variables de entorno', () => {
    for (const mal of ['..', '../x', 'a/b', 'a\\b', '', 'x'.repeat(81), 'a b']) assert.equal(idValido(mal), false, mal)
    assert.throws(() => a.anexar('..', 'r1', 'x'))
    assert.throws(() => a.leer('p1', '../../etc'))
    assert.throws(() => a.guardarPunto('a/b', '{}', 'x'))
    const c = carpetasProducciones({ JASWAVE_PRODUCCIONES_DIR: 'D:\\x', JASWAVE_RECUPERACION_DIR: 'D:\\y' } as NodeJS.ProcessEnv, 'C:\\AppData')
    assert.deepEqual(c, { producciones: 'D:\\x', recuperacion: 'D:\\y' })
    assert.match(carpetasProducciones({} as NodeJS.ProcessEnv, 'C:\\AppData').producciones, /JasWave[\\/]producciones$/)
  })
})

describe('almacén: diario', () => {
  it('anexa, lee y tolera una última línea cortada', () => {
    a.iniciar('p1', 'r1')
    a.anexar('p1', 'r1', serializarRegistro(inicio('r1'), 100))
    a.anexar('p1', 'r1', serializarRegistro({ k: 'vida', etapa: 'musicos' }, 200))
    // Corte de luz a mitad de la siguiente línea.
    fs.appendFileSync(path.join(a.raizProducciones, 'p1', 'r1.jsonl'), '{"v":1,"t":300,"k":"ev')
    const leido = parsearDiario(a.leer('p1', 'r1')!)
    assert.equal(leido.registros.length, 2)
    assert.equal(leido.truncada, true)
    const res = reconstruirEstado(leido)!
    assert.equal(res.etapaActual, 'musicos')
    assert.equal(estadoEfectivo(res, 200 + 120_000), 'interrumpida')
  })

  it('el cierre de emergencia marca como interrumpidas las producciones abiertas (y solo esas)', () => {
    a.iniciar('p1', 'r1')
    a.iniciar('p1', 'r2')
    a.anexar('p1', 'r1', serializarRegistro(inicio('r1'), 1))
    a.anexar('p1', 'r2', serializarRegistro(inicio('r2'), 1))
    a.anexar('p1', 'r2', serializarRegistro({ k: 'estado', estado: 'completada' }, 2))
    assert.equal(a.marcarInterrumpidas('apagado del sistema', 999), 1)
    assert.equal(reconstruirEstado(parsearDiario(a.leer('p1', 'r1')!))!.estado, 'interrumpida')
    assert.equal(reconstruirEstado(parsearDiario(a.leer('p1', 'r2')!))!.estado, 'completada')
    assert.equal(a.hayActivas(), false)
  })

  it('conserva solo las últimas 10 producciones por proyecto', () => {
    for (let i = 0; i < PRODUCCIONES_A_CONSERVAR + 4; i++) {
      a.iniciar('p1', `r${i}`)
      a.anexar('p1', `r${i}`, serializarRegistro({ k: 'estado', estado: 'completada' }, i))
      const f = path.join(a.raizProducciones, 'p1', `r${i}.jsonl`)
      fs.utimesSync(f, new Date(2020, 0, 1, 0, i), new Date(2020, 0, 1, 0, i))
    }
    a.podar('p1')
    const quedan = a.listar('p1').map((x) => x.runId)
    assert.equal(quedan.length, PRODUCCIONES_A_CONSERVAR)
    assert.ok(quedan.includes('r13') && !quedan.includes('r0'))
  })

  it('dos reanudaciones a la vez: solo una toma el candado; uno abandonado se recupera', () => {
    const t1 = a.tomarCandado('p1', 'r1', 1000)
    assert.ok(t1)
    assert.equal(a.tomarCandado('p1', 'r1', 2000), null)
    assert.equal(a.soltarCandado('p1', 'r1', 'otro-testigo'), false)
    assert.equal(a.soltarCandado('p1', 'r1', t1!), true)
    assert.ok(a.tomarCandado('p1', 'r1', 3000))
    // Caduca (quien lo tomó murió sin soltarlo).
    assert.ok(a.tomarCandado('p1', 'r1', 3000 + CANDADO_CADUCA_MS + 1))
  })
})

describe('almacén: puntos de control', () => {
  const proyecto = (n: number) => JSON.stringify({ id: 'p1', nombre: `versión ${n}`, tracks: [] })

  it('rota 3 copias y devuelve siempre la más reciente con su huella', () => {
    const huellas: string[] = []
    for (let i = 1; i <= 5; i++) huellas.push(a.guardarPunto('p1', proyecto(i), `etapa:${i}`, i * 1000).huella)
    const nombres = fs.readdirSync(path.join(a.raizRecuperacion, 'p1'))
    assert.equal(nombres.filter((n) => n.endsWith('.json')).length, COPIAS_PUNTO)
    assert.equal(nombres.filter((n) => n.endsWith('.tmp')).length, 0)
    const c = a.cargarPunto('p1')!
    assert.equal(JSON.parse(c.proyecto).nombre, 'versión 5')
    assert.equal(c.cabecera.huella, huellas[4])
    assert.equal(c.usoCopiaAnterior, false)
  })

  it('si la última copia está corrupta (JSON roto o huella distinta) cae a la anterior', () => {
    for (let i = 1; i <= 3; i++) a.guardarPunto('p1', proyecto(i), `e${i}`, i)
    const ultima = path.join(a.raizRecuperacion, 'p1', `punto-${3 % COPIAS_PUNTO}.json`)
    // Trunca la copia más reciente (apagado a mitad de escritura en un disco sin journaling).
    const txt = fs.readFileSync(ultima, 'utf-8')
    fs.writeFileSync(ultima, txt.slice(0, txt.length - 12))
    let c = a.cargarPunto('p1')!
    assert.equal(JSON.parse(c.proyecto).nombre, 'versión 2')
    assert.equal(c.usoCopiaAnterior, true)
    // Cambia un texto manteniendo el JSON válido: solo la huella lo delata.
    fs.writeFileSync(ultima, txt.replace('versión 3', 'versión 9'))
    c = a.cargarPunto('p1')!
    assert.equal(JSON.parse(c.proyecto).nombre, 'versión 2')
    // Si todas están dañadas no se inventa nada.
    for (let i = 0; i < COPIAS_PUNTO; i++) fs.writeFileSync(path.join(a.raizRecuperacion, 'p1', `punto-${i}.json`), 'basura')
    assert.equal(a.cargarPunto('p1'), null)
  })

  it('funciona para un proyecto sin ruta en disco (solo necesita su id)', () => {
    a.guardarPunto('sin-guardar-1', proyecto(1), 'autosave')
    assert.equal(JSON.parse(a.cargarPunto('sin-guardar-1')!.proyecto).nombre, 'versión 1')
    assert.equal(a.cargarPunto('otro'), null)
  })
})

describe('vigilancia de memoria', () => {
  const GB = 1024 ** 3
  it('avisa con poca RAM libre y calla en el caso normal', () => {
    assert.equal(evaluarMemoria({ appBytes: 2 * GB, libresBytes: 8 * GB, totalBytes: 16 * GB }), 'ok')
    assert.equal(evaluarMemoria({ appBytes: 2 * GB, libresBytes: 0.8 * GB, totalBytes: 16 * GB }), 'alta')
    assert.equal(evaluarMemoria({ appBytes: 5 * GB, libresBytes: 0.2 * GB, totalBytes: 16 * GB }), 'critica')
    assert.equal(avisoMemoria('ok'), null)
    assert.doesNotMatch(avisoMemoria('alta')!, /MB|GB|proceso|heap|renderer/i)
  })
})

// ── Pruebas de choque con persistencia real ────────────────────────────────────

const EQUIPO: ParticipanteProduccion[] = [
  { id: 'plan', nombre: 'Planificador', descripcion: 'plan', instrucciones: '', rol: 'planificador' },
  { id: 'dir', nombre: 'Director', descripcion: 'dirige', instrucciones: '', rol: 'director' },
  { id: 'bat', nombre: 'Batería', descripcion: 'batería', instrucciones: '', rol: 'musico' },
  { id: 'baj', nombre: 'Bajo', descripcion: 'bajo', instrucciones: '', rol: 'musico' },
  { id: 'qa', nombre: 'QA', descripcion: 'calidad', instrucciones: '', rol: 'qa' },
  { id: 'mix', nombre: 'Mezcla', descripcion: 'mezcla', instrucciones: '', rol: 'mezcla' },
  { id: 'mas', nombre: 'Máster', descripcion: 'máster', instrucciones: '', rol: 'master' },
]
const HOJA = { tonalidad: 'Re mayor', numerador: 4, secciones: [{ nombre: 'Verso', compases: 2, acordes: ['D', 'A'] }, { nombre: 'Coro', compases: 2, acordes: ['G', 'A'] }] }
const PISTA: Record<string, string> = { Batería: 'bat', Bajo: 'baj' }
type Proyecto = { clips: Record<string, string[]> }

/** Producción real contra el almacén en disco; `caerTrasPunto` congela el diario (como si el proceso muriera). */
async function producir(almacen: AlmacenProducciones, o: { runId: string; reanudar?: EstadoProduccionGuardado; proyecto?: Proyecto; caerTrasPunto?: string }) {
  const proyecto: Proyecto = o.proyecto ? structuredClone(o.proyecto) : { clips: {} }
  const control = new AbortController()
  let muerto = false
  let n = 0
  const peticiones: string[] = []
  const escribir = (r: EntradaDiario) => {
    if (!muerto) almacen.anexar('p1', o.runId, serializarRegistro(r))
  }
  almacen.iniciar('p1', o.runId)
  escribir(inicio(o.runId))
  const chat: ChatAgente = async (p) => {
    const rol = /^Eres (\S+)/.exec(p.sistema)?.[1] ?? '?'
    peticiones.push(rol)
    if (p.mensajes[p.mensajes.length - 1]?.role === 'tool') return { ok: true, texto: 'ok', llamadas: [] }
    const ll = (nombre: string, argumentos: Record<string, unknown>) => ({ id: `${nombre}-${++n}`, nombre, argumentos })
    if (rol === 'Planificador') return { ok: true, texto: '', llamadas: [ll(H_HOJA, HOJA)] }
    if (rol === 'Director') return { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'bat', pista: 'bat', encargo: 'batería' }, { musico: 'baj', pista: 'baj', encargo: 'bajo' }] })] }
    if (rol === 'QA') return { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'Bien.' })] }
    if (rol === 'Batería' || rol === 'Bajo') return { ok: true, texto: '', llamadas: HOJA.secciones.map((s) => ll('midi.addNotes', { pista: PISTA[rol], seccion: s.nombre })) }
    return { ok: true, texto: 'ok', llamadas: [] }
  }
  const r = await ejecutarProduccion({
    pedido: 'canción',
    catalogo: [{ nombre: 'midi.addNotes', descripcion: 'notas', parametros: { type: 'object' }, clase: 'escritura' }],
    participantes: EQUIPO,
    chat,
    ejecutar: async (l) => {
      if (l.nombre === 'midi.addNotes') {
        const lista = (proyecto.clips[String(l.argumentos.pista)] ??= [])
        if (!lista.includes(String(l.argumentos.seccion))) lista.push(String(l.argumentos.seccion))
      }
      return { ok: true }
    },
    completitud: (e, hoja) => {
      const hay = proyecto.clips[e.pista ?? ''] ?? []
      const falta = hoja.secciones.filter((s) => !hay.includes(s.nombre)).map((s) => s.nombre)
      return falta.length ? `faltan ${falta.join(', ')}` : null
    },
    coherencia: () => ({ ok: true, detalles: [] }),
    medir: async () => ({ ok: true, detalles: ['bien'] }),
    reanudar: o.reanudar,
    alPuntoDeControl: (que) => {
      if (muerto) return
      const g = almacen.guardarPunto('p1', JSON.stringify(proyecto), que)
      escribir({ k: 'control', que, huella: g.huella, archivo: path.basename(g.archivo) })
      if (que === o.caerTrasPunto) {
        muerto = true
        control.abort()
      }
    },
    onEvento: (e: EventoProduccion) => {
      if (!muerto && debeRegistrarse(e)) escribir({ k: 'evento', e })
    },
    signal: control.signal,
  })
  if (!muerto) escribir({ k: 'estado', estado: r.estado === 'cancelado' ? 'detenida' : 'completada' })
  return { r, proyecto, peticiones }
}

describe('pruebas de choque con disco real', () => {
  it('muere tras cada punto de control; el proyecto se restaura del último punto y la reanudación termina igual', async () => {
    const ref = await producir(a, { runId: 'ref' })
    const puntos = parsearDiario(a.leer('p1', 'ref')!).registros.flatMap((x) => (x.k === 'control' ? [x.que] : []))
    assert.ok(puntos.includes('musico:bat') && puntos.includes('etapa:master'))
    for (const [i, punto] of puntos.entries()) {
      if (i % 3 !== 0 && !punto.startsWith('musico:')) continue
      const run1 = `c${i}`
      await producir(a, { runId: run1, caerTrasPunto: punto })
      // Tras la «muerte» el diario queda «en curso» sin señal de vida: es una producción interrumpida.
      const resumen = reconstruirEstado(parsearDiario(a.leer('p1', run1)!))!
      const restaurado = JSON.parse(a.cargarPunto('p1')!.proyecto) as Proyecto
      const res2 = await producir(a, { runId: `${run1}-r`, reanudar: resumen.guardado, proyecto: restaurado })
      assert.equal(res2.r.estado, ref.r.estado, punto)
      assert.deepEqual(res2.proyecto.clips, ref.proyecto.clips, punto)
      for (const lista of Object.values(res2.proyecto.clips)) assert.equal(new Set(lista).size, lista.length, punto)
      const hechas = resumen.guardado.etapasCompletas
      if (hechas.includes('plan')) assert.ok(!res2.peticiones.includes('Planificador'), `${punto}: no replanifica`)
      if (hechas.includes('direccion')) assert.ok(!res2.peticiones.includes('Director'), `${punto}: no vuelve a repartir`)
    }
  })

  it('con el último registro del diario truncado y el último punto corrupto, se reanuda con lo anterior', async () => {
    await producir(a, { runId: 'x', caerTrasPunto: 'musico:bat' })
    const f = path.join(a.raizProducciones, 'p1', 'x.jsonl')
    fs.appendFileSync(f, '{"v":1,"t":5,"k":"evento","e":{"tipo":"mus')
    const ultimo = a.cargarPunto('p1')!
    const archivo = path.join(a.raizRecuperacion, 'p1', `punto-${ultimo.cabecera.seq % COPIAS_PUNTO}.json`)
    fs.writeFileSync(archivo, fs.readFileSync(archivo, 'utf-8').slice(0, 40))
    const leido = parsearDiario(a.leer('p1', 'x')!)
    assert.equal(leido.truncada, true)
    const punto = a.cargarPunto('p1')!
    assert.equal(punto.usoCopiaAnterior, true)
    const res = await producir(a, { runId: 'x-r', reanudar: reconstruirEstado(leido)!.guardado, proyecto: JSON.parse(punto.proyecto) as Proyecto })
    assert.equal(res.r.estado, 'completado')
    assert.deepEqual(res.proyecto.clips, { bat: ['Verso', 'Coro'], baj: ['Verso', 'Coro'] })
  })

  it('un proyecto sin ruta se puede recuperar solo con su id', async () => {
    await producir(a, { runId: 'y', caerTrasPunto: 'etapa:direccion' })
    assert.ok(a.cargarPunto('p1'))
    assert.equal(a.listar('p1').length, 1)
  })
})
