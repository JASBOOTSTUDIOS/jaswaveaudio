import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { ServicioGrooves, nombreSeguro } from './grooves-service'
import { resumirMidi } from './grooves-midi'

const SEMILLA = path.resolve(__dirname, '../../plugins/grooves/estilos')

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jaswave-grooves-'))
}

/** MIDI mínimo: 120 bpm, 3/4, una nota de 1 beat a los 2 beats. */
function midiMinimo(): Uint8Array {
  const pista = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, 0, 0xff, 0x58, 4, 3, 2, 24, 8, 0x83, 0x60, 0x99, 36, 100, 0x83, 0x60, 0x89, 36, 0, 0, 0xff, 0x2f, 0]
  return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, pista.length, ...pista])
}

describe('resumirMidi', () => {
  it('lee tempo, compás, notas y duración', () => {
    const r = resumirMidi(midiMinimo())
    assert.equal(Math.round(r.bpm), 120)
    assert.deepEqual(r.compas, { numerador: 3, denominador: 4 })
    assert.equal(r.notas, 1)
    assert.equal(r.duracionBeats, 2)
  })
  it('rechaza lo que no es MIDI', () => {
    assert.throws(() => resumirMidi(new Uint8Array(40)))
  })
})

describe('ServicioGrooves', () => {
  it('siembra sin pisar ni borrar lo del usuario y respeta lo que el usuario borró', () => {
    const raiz = tmp()
    const propio = path.join(raiz, 'Mis ritmos')
    fs.mkdirSync(propio, { recursive: true })
    fs.writeFileSync(path.join(propio, 'mio.mid'), midiMinimo())
    // El usuario ya tiene un archivo con la ruta de uno de serie: no se pisa.
    fs.mkdirSync(path.join(raiz, 'Pop'), { recursive: true })
    const mio = Buffer.from(midiMinimo())
    fs.writeFileSync(path.join(raiz, 'Pop', 'pop-clasico.mid'), mio)

    const s = new ServicioGrooves({ raiz, semilla: SEMILLA })
    const r1 = s.sembrar()
    assert.ok(r1.copiados > 100, `copiados ${r1.copiados}`)
    assert.deepEqual(fs.readFileSync(path.join(raiz, 'Pop', 'pop-clasico.mid')), mio)
    assert.ok(fs.existsSync(path.join(propio, 'mio.mid')))
    const sync = s.leerSync()
    assert.ok(sync.grooves.length > 100)
    assert.ok(!sync.grooves.some((g) => g.ruta === 'Pop/pop-clasico.mid'))

    // Segunda vez: no vuelve a copiar nada (ni lo que el usuario borre).
    fs.rmSync(path.join(raiz, 'Rock', 'punk-veloz.mid'))
    assert.equal(s.sembrar().copiados, 0)
    assert.ok(!fs.existsSync(path.join(raiz, 'Rock', 'punk-veloz.mid')))
    fs.rmSync(raiz, { recursive: true, force: true })
  })

  it('indexa con caché, lee metadatos y detecta cambios', () => {
    const raiz = tmp()
    const s = new ServicioGrooves({ raiz, semilla: SEMILLA })
    s.sembrar()
    const idx = s.indexar()
    assert.ok(idx.length > 100)
    const g = idx.find((x) => x.ruta === 'Worship/6-8/coro-6-8.mid')
    assert.ok(g)
    assert.equal(g.sha256.length, 64)
    assert.deepEqual(g.resumen.compas, { numerador: 6, denominador: 8 })
    assert.ok(g.carpeta && typeof g.carpeta === 'object')
    const otra = s.indexar()
    assert.equal(otra.length, idx.length)
    assert.equal(otra.find((x) => x.ruta === g.ruta)!.sha256, g.sha256)
    fs.rmSync(raiz, { recursive: true, force: true })
  })

  it('importa bytes al estilo, evita colisiones y valida el MIDI', () => {
    const raiz = tmp()
    const s = new ServicioGrooves({ raiz })
    const a = s.importarBytes('Mi ritmo.mid', midiMinimo(), 'Mi Estilo')
    const b = s.importarBytes('Mi ritmo.mid', midiMinimo(), 'Mi Estilo', 'Sub')
    const c = s.importarBytes('Mi ritmo.mid', midiMinimo(), 'Mi Estilo')
    assert.equal(a.ruta, 'Mi Estilo/Mi ritmo.mid')
    assert.equal(b.ruta, 'Mi Estilo/Sub/Mi ritmo.mid')
    assert.equal(c.ruta, 'Mi Estilo/Mi ritmo-2.mid')
    assert.throws(() => s.importarBytes('x.mid', new Uint8Array(40), 'E'), /no es un MIDI válido/)
    assert.equal(s.importarBytes('x.mid', midiMinimo(), '../fuera').ruta, 'fuera/x.mid')
    assert.equal(s.indexar().length, 4)
    fs.rmSync(raiz, { recursive: true, force: true })
  })

  it('importa rutas solo si path-grants lo permite', () => {
    const raiz = tmp()
    const origen = tmp()
    fs.writeFileSync(path.join(origen, 'a.mid'), midiMinimo())
    fs.writeFileSync(path.join(origen, 'b.txt'), 'hola')
    const s = new ServicioGrooves({ raiz })
    const r = s.importarRutas([path.join(origen, 'a.mid'), path.join(origen, 'b.txt')], 'Rock', undefined, (p) => p.endsWith('.mid'))
    assert.deepEqual(r.importados, ['Rock/a.mid'])
    assert.equal(r.errores.length, 1)
    const denegado = s.importarRutas([path.join(origen, 'a.mid')], 'Rock', undefined, () => false)
    assert.equal(denegado.importados.length, 0)
    fs.rmSync(raiz, { recursive: true, force: true })
    fs.rmSync(origen, { recursive: true, force: true })
  })

  it('no deja salir de la raíz', () => {
    const s = new ServicioGrooves({ raiz: tmp() })
    for (const mala of ['../x.mid', '..\\x.mid', 'a/../../x.mid', 'C:\\Windows\\x.mid', '/etc/x.mid', '']) {
      assert.throws(() => s.leerBytes(mala), /Ruta/)
    }
    assert.throws(() => nombreSeguro('..'), /no válido/)
    assert.throws(() => nombreSeguro('CON'), /no válido/)
  })

  it('borra a la papelera (nunca definitivamente) y renombra estilos', async () => {
    const raiz = tmp()
    const enPapelera: string[] = []
    const s = new ServicioGrooves({ raiz, papelera: async (p) => void enPapelera.push(p) })
    const { ruta } = s.importarBytes('z.mid', midiMinimo(), 'A')
    await s.borrar(ruta)
    assert.equal(enPapelera.length, 1)
    assert.ok(enPapelera[0]!.endsWith('z.mid'))
    const sinPapelera = new ServicioGrooves({ raiz })
    await assert.rejects(() => sinPapelera.borrar(ruta), /papelera/)
    const nuevo = s.renombrarEstilo('A', 'B')
    assert.equal(nuevo.ruta, 'B')
    assert.throws(() => s.renombrarEstilo('B', 'B'), /Ya existe/)
    fs.rmSync(raiz, { recursive: true, force: true })
  })

  it('favoritos persisten por id', () => {
    const raiz = tmp()
    const s = new ServicioGrooves({ raiz })
    s.alternarFavorito('g1')
    s.alternarFavorito('g2')
    s.alternarFavorito('g1')
    assert.deepEqual(s.favoritosIds(), ['g2'])
    fs.rmSync(raiz, { recursive: true, force: true })
  })
})
