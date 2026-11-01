import assert from 'node:assert/strict'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { aplicarDiferencias } from '../../shared/src/grooves/indice'
import { ServicioGrooves } from './grooves-service'
import { diferenciasSync, enviarPropuesta, rutaRemotaValida, sincronizarGrooves, type EventoSync, type GrooveRemoto } from './grooves-sync'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jaswave-sync-'))

/** MIDI con una nota distinta por `semilla` (así cada groove tiene su propio hash). */
function midi(semilla: number): Uint8Array {
  const pista = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, 0, 0xff, 0x58, 4, 4, 2, 24, 8, 0x83, 0x60, 0x99, 36 + (semilla % 10), 100, 0x83, 0x60, 0x89, 36, 0, 0, 0xff, 0x2f, 0]
  return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, pista.length, ...pista, ...Array(semilla % 3).fill(0)].slice(0, 22 + pista.length))
}
const sha = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex')

type Servidor = { revision: number; grooves: Map<string, { meta: Omit<GrooveRemoto, 'sha256' | 'tamano'>; bytes: Uint8Array }>; log: string[]; caido: boolean; corrupto: Set<string> }

function crearServidor(): Servidor & { fetch: typeof fetch } {
  const srv: Servidor = { revision: 1, grooves: new Map(), log: [], caido: false, corrupto: new Set() }
  const fetchFalso = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url))
    srv.log.push(u.pathname + u.search)
    if (srv.caido) throw new TypeError('fetch failed')
    if ((init?.headers as Record<string, string>)?.Authorization !== 'Bearer token-ok') return new Response('{}', { status: 401 })
    if (u.pathname === '/grooves/indice') {
      const desde = u.searchParams.get('desde')
      if (desde !== null && Number(desde) === srv.revision) return new Response(null, { status: 304 })
      const grooves = [...srv.grooves.values()].map((g) => ({ ...g.meta, sha256: sha(g.bytes), tamano: g.bytes.byteLength }))
      return Response.json({ revision: srv.revision, total: grooves.length, grooves })
    }
    const m = /^\/grooves\/([^/]+)\/archivo$/.exec(u.pathname)
    if (m) {
      const g = srv.grooves.get(decodeURIComponent(m[1]!))
      if (!g) return new Response('{}', { status: 404 })
      const bytes = srv.corrupto.has(g.meta.id) ? Uint8Array.from(g.bytes, (x, i) => (i === g.bytes.length - 1 ? x ^ 1 : x)) : g.bytes
      return new Response(Buffer.from(bytes), { status: 200, headers: { 'content-length': String(bytes.byteLength) } })
    }
    if (u.pathname === '/grooves/propuestas' && init?.method === 'POST') {
      srv.log.push('POST ' + String(init.body).slice(0, 0))
      return Response.json({ repetida: false, mensaje: 'ok', propuesta: { estado: 'pendiente' } }, { status: 201 })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  return Object.assign(srv, { fetch: fetchFalso })
}

function poner(srv: Servidor, id: string, ruta: string, semilla: number, revision = 1) {
  const [estilo] = ruta.split('/')
  srv.grooves.set(id, {
    meta: { id, ruta, revision, estilo: estilo!, nombre: id.replace(/-/g, ' '), tipo: 'groove', compas: '4/4', tempo: 100, compases: 1, intensidad: 3, etiquetas: ['x'], autor: 'JasWave', licencia: 'CC0-1.0' },
    bytes: midi(semilla),
  })
  srv.revision++
}

function montar() {
  const raiz = tmp()
  const papelera: string[] = []
  const servicio = new ServicioGrooves({
    raiz,
    papelera: async (p) => {
      papelera.push(path.relative(raiz, p).split(path.sep).join('/'))
      fs.rmSync(p, { force: true })
    },
  })
  servicio.asegurarRaiz()
  const eventos: EventoSync[] = []
  const sincronizar = (srv: Servidor & { fetch: typeof fetch }, token = 'token-ok') =>
    sincronizarGrooves({ servicio, apiBase: 'http://servidor.test/', token, fetch: srv.fetch, emitir: (e) => eventos.push(e) })
  return { raiz, servicio, papelera, eventos, sincronizar }
}

describe('sincronización de grooves', () => {
  it('descarga lo nuevo, verifica y escribe con su metadato de catálogo', async () => {
    const srv = crearServidor()
    poner(srv, 'jw-pop-uno', 'Pop/uno.mid', 1)
    poner(srv, 'jw-pop-sub-dos', 'Pop/Suave/dos.mid', 2)
    const { raiz, servicio, sincronizar, eventos } = montar()
    const r = await sincronizar(srv)
    assert.equal(r.ok, true)
    assert.equal(r.descargados, 2)
    assert.deepEqual(fs.readFileSync(path.join(raiz, 'Pop', 'uno.mid')), Buffer.from(srv.grooves.get('jw-pop-uno')!.bytes))
    const side = JSON.parse(fs.readFileSync(path.join(raiz, 'Pop', 'uno.json'), 'utf8'))
    assert.equal(side.origen, 'catalogo')
    assert.equal(side.id, 'jw-pop-uno')
    assert.equal(side.revision, 1)
    const sync = servicio.leerSync()
    assert.equal(sync.catalogoRevision, srv.revision)
    assert.deepEqual(sync.grooves.map((g) => g.id).sort(), ['jw-pop-sub-dos', 'jw-pop-uno'])
    assert.equal(eventos[0]!.tipo, 'inicio')
    assert.equal(eventos.at(-1)!.tipo, 'fin')
    assert.ok(eventos.some((e) => e.tipo === 'progreso'))
    assert.equal(servicio.leerEstadoSync().novedades.length, 2)
    assert.ok(servicio.leerEstadoSync().ultima)
    // Sin cambios: el servidor responde 304 y no se baja nada.
    srv.log.length = 0
    const r2 = await sincronizar(srv)
    assert.equal(r2.sinCambios, true)
    assert.deepEqual(srv.log, [`/grooves/indice?desde=${srv.revision}`])
  })

  it('actualiza lo que cambió (contenido y ruta) y retira lo que el administrador quitó', async () => {
    const srv = crearServidor()
    poner(srv, 'jw-pop-uno', 'Pop/uno.mid', 1)
    poner(srv, 'jw-pop-dos', 'Pop/dos.mid', 2)
    poner(srv, 'jw-pop-tres', 'Pop/tres.mid', 3)
    const { raiz, servicio, sincronizar, papelera } = montar()
    await sincronizar(srv)
    poner(srv, 'jw-pop-uno', 'Pop/uno.mid', 7, 2) // contenido nuevo
    poner(srv, 'jw-pop-dos', 'Rock/dos.mid', 2, 2) // movido de estilo
    srv.grooves.delete('jw-pop-tres') // retirado
    srv.revision++
    const r = await sincronizar(srv)
    assert.equal(r.ok, true)
    assert.equal(r.actualizados, 2)
    assert.equal(r.retirados, 1)
    assert.deepEqual(fs.readFileSync(path.join(raiz, 'Pop', 'uno.mid')), Buffer.from(srv.grooves.get('jw-pop-uno')!.bytes))
    assert.ok(fs.existsSync(path.join(raiz, 'Rock', 'dos.mid')))
    assert.ok(!fs.existsSync(path.join(raiz, 'Pop', 'dos.mid')))
    assert.ok(!fs.existsSync(path.join(raiz, 'Pop', 'tres.mid')))
    assert.ok(papelera.includes('Pop/tres.mid'))
    assert.deepEqual(servicio.leerSync().grooves.map((g) => `${g.id}@${g.revision}`).sort(), ['jw-pop-dos@2', 'jw-pop-uno@2'])
  })

  it('rechaza un archivo con la huella incorrecta y no lo escribe; reintenta la próxima vez', async () => {
    const srv = crearServidor()
    poner(srv, 'jw-pop-uno', 'Pop/uno.mid', 1)
    poner(srv, 'jw-pop-dos', 'Pop/dos.mid', 2)
    srv.corrupto.add('jw-pop-dos')
    const { raiz, servicio, sincronizar } = montar()
    const r = await sincronizar(srv)
    assert.equal(r.ok, false)
    assert.equal(r.descargados, 1)
    assert.match(r.errores[0]!.error, /SHA-256/)
    assert.ok(!fs.existsSync(path.join(raiz, 'Pop', 'dos.mid')))
    assert.deepEqual(fs.readdirSync(path.join(raiz, 'Pop')).filter((f) => f.endsWith('.tmp')), [])
    assert.equal(servicio.leerSync().catalogoRevision, undefined, 'no se anota la revisión si algo falló')
    srv.corrupto.clear()
    const r2 = await sincronizar(srv)
    assert.equal(r2.ok, true)
    assert.ok(fs.existsSync(path.join(raiz, 'Pop', 'dos.mid')))
  })

  it('sin conexión o con sesión caducada devuelve un resultado y no toca nada', async () => {
    const srv = crearServidor()
    poner(srv, 'jw-pop-uno', 'Pop/uno.mid', 1)
    const { raiz, servicio, sincronizar } = montar()
    srv.caido = true
    const r = await sincronizar(srv)
    assert.equal(r.ok, false)
    assert.equal(r.sinConexion, true)
    assert.match(r.error!, /Sin conexión/)
    assert.deepEqual(fs.readdirSync(raiz).filter((f) => !f.startsWith('.')), [])
    assert.deepEqual(servicio.leerSync().grooves, [])
    srv.caido = false
    const r2 = await sincronizar(srv, 'token-caducado')
    assert.equal(r2.ok, false)
    assert.equal(r2.sinConexion, true)
    assert.match(r2.error!, /sesión/)
  })

  it('nunca toca los grooves del usuario, ni siquiera con la misma ruta', async () => {
    const srv = crearServidor()
    poner(srv, 'jw-pop-uno', 'Pop/uno.mid', 1)
    const { raiz, sincronizar } = montar()
    fs.mkdirSync(path.join(raiz, 'Pop'), { recursive: true })
    fs.mkdirSync(path.join(raiz, 'Mis ritmos'), { recursive: true })
    const mio = midi(9)
    fs.writeFileSync(path.join(raiz, 'Pop', 'uno.mid'), mio)
    fs.writeFileSync(path.join(raiz, 'Mis ritmos', 'suyo.mid'), midi(8))
    const r = await sincronizar(srv)
    assert.equal(r.ok, true)
    assert.deepEqual(fs.readFileSync(path.join(raiz, 'Pop', 'uno.mid')), Buffer.from(mio))
    assert.ok(fs.existsSync(path.join(raiz, 'Pop', 'uno-catalogo.mid')), 'lo del catálogo se desvía')
    // El catálogo retira todo: lo del usuario sigue.
    srv.grooves.clear()
    srv.revision++
    await sincronizar(srv)
    assert.ok(fs.existsSync(path.join(raiz, 'Pop', 'uno.mid')))
    assert.ok(fs.existsSync(path.join(raiz, 'Mis ritmos', 'suyo.mid')))
    assert.ok(!fs.existsSync(path.join(raiz, 'Pop', 'uno-catalogo.mid')))
  })

  it('si el usuario editó uno del catálogo y el catálogo lo cambia o lo retira, conserva su copia como suya y avisa', async () => {
    const srv = crearServidor()
    poner(srv, 'jw-pop-uno', 'Pop/uno.mid', 1)
    poner(srv, 'jw-pop-dos', 'Pop/dos.mid', 2)
    const { raiz, servicio, sincronizar } = montar()
    await sincronizar(srv)
    const editado = midi(5)
    fs.writeFileSync(path.join(raiz, 'Pop', 'uno.mid'), editado)
    fs.writeFileSync(path.join(raiz, 'Pop', 'dos.mid'), midi(6))
    poner(srv, 'jw-pop-uno', 'Pop/uno.mid', 7, 2) // el catálogo lo actualiza
    srv.grooves.delete('jw-pop-dos') // y retira el otro
    srv.revision++
    const r = await sincronizar(srv)
    assert.equal(r.conservados.length, 2)
    assert.ok(servicio.leerEstadoSync().novedades.some((n) => n.tipo === 'conservado'))
    // Su versión sigue donde estaba, ahora como suya.
    assert.deepEqual(fs.readFileSync(path.join(raiz, 'Pop', 'uno.mid')), Buffer.from(editado))
    const lado = JSON.parse(fs.readFileSync(path.join(raiz, 'Pop', 'uno.json'), 'utf8'))
    assert.equal(lado.origen, 'usuario')
    assert.match(lado.id, /^usr-[0-9a-f]{12}$/)
    assert.ok(fs.existsSync(path.join(raiz, 'Pop', 'dos.mid')))
    assert.equal(JSON.parse(fs.readFileSync(path.join(raiz, 'Pop', 'dos.json'), 'utf8')).origen, 'usuario')
    // La nueva versión del catálogo se baja aparte.
    assert.deepEqual(fs.readFileSync(path.join(raiz, 'Pop', 'uno-catalogo.mid')), Buffer.from(srv.grooves.get('jw-pop-uno')!.bytes))
    assert.deepEqual(servicio.leerSync().grooves.map((g) => g.id), ['jw-pop-uno'])
  })

  it('respeta lo que el usuario borró del catálogo aunque llegue una revisión nueva', async () => {
    const srv = crearServidor()
    poner(srv, 'jw-pop-uno', 'Pop/uno.mid', 1)
    const { raiz, sincronizar } = montar()
    await sincronizar(srv)
    fs.rmSync(path.join(raiz, 'Pop', 'uno.mid'))
    poner(srv, 'jw-pop-uno', 'Pop/uno.mid', 4, 2)
    const r = await sincronizar(srv)
    assert.equal(r.ok, true)
    assert.ok(!fs.existsSync(path.join(raiz, 'Pop', 'uno.mid')))
  })

  it('no se fía del servidor: rutas peligrosas, tamaños absurdos y huellas mal formadas se descartan', async () => {
    for (const malo of ['../fuera.mid', '/abs/x.mid', 'A/B/C/d.mid', 'Pop/.oculto.mid', 'Pop/x.exe', 'C:/x.mid', 'Pop\\x.mid', 'Pop/con.mid', 'solo.mid'])
      assert.equal(rutaRemotaValida(malo), false, malo)
    assert.equal(rutaRemotaValida('Worship/4-4/coro pleno.mid'), true)
    const srv = crearServidor()
    poner(srv, 'jw-pop-uno', '../fuera.mid', 1)
    poner(srv, 'jw-pop-dos', 'Pop/dos.mid', 2)
    const { raiz, sincronizar } = montar()
    const r = await sincronizar(srv)
    assert.equal(r.descargados, 1)
    assert.ok(r.errores.some((e) => /no válidos/.test(e.error)))
    assert.ok(!fs.existsSync(path.join(path.dirname(raiz), 'fuera.mid')))
  })

  it('una sola sincronización a la vez', async () => {
    const srv = crearServidor()
    poner(srv, 'jw-pop-uno', 'Pop/uno.mid', 1)
    const { sincronizar } = montar()
    const [a, b] = await Promise.all([sincronizar(srv), sincronizar(srv)])
    assert.equal(a, b)
  })

  it('diferenciasSync da lo mismo que aplicarDiferencias de shared', () => {
    let semilla = 7
    const azar = (n: number) => ((semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) % n)
    for (let vuelta = 0; vuelta < 200; vuelta++) {
      const gen = () => Array.from({ length: azar(8) }, () => azar(10)).filter((v, i, a) => a.indexOf(v) === i).map((n) => ({ id: `g-${n}`, ruta: `E/${azar(4) === 0 ? 'x' : n}.mid`, sha256: `h${azar(3)}`, revision: 1 + azar(3) }))
      const local = { grooves: gen() }
      const remoto = { grooves: gen() }
      const ocupadas = Array.from({ length: azar(4) }, () => `E/${azar(10)}.mid`)
      assert.deepEqual(diferenciasSync(local, remoto, { rutasOcupadas: ocupadas }), aplicarDiferencias(local, remoto, { rutasOcupadas: ocupadas }))
    }
  })
})

describe('propuestas desde la app', () => {
  it('envía con consentimiento, no reenvía lo ya propuesto y no sale nada sin permiso', async () => {
    const srv = crearServidor()
    const { raiz, servicio } = montar()
    fs.mkdirSync(path.join(raiz, 'Mis ritmos'), { recursive: true })
    fs.writeFileSync(path.join(raiz, 'Mis ritmos', 'mio.mid'), midi(3))
    const base = { servicio, apiBase: 'http://servidor.test', token: 'token-ok', ruta: 'Mis ritmos/mio.mid', meta: { nombre: 'Mío', estilo: 'Mis ritmos' }, fetch: srv.fetch }
    const sin = await enviarPropuesta({ ...base, consentimiento: { aceptado: false, version: 'v' } })
    assert.equal(sin.ok, false)
    assert.ok(!srv.log.some((l) => l.includes('propuestas')), 'sin permiso no se envía nada')
    const a = await enviarPropuesta({ ...base, consentimiento: { aceptado: true, version: '2026-10-29' } })
    assert.equal(a.ok, true)
    assert.equal(servicio.leerEstadoSync().propuestos.length, 1)
    srv.log.length = 0
    const b = await enviarPropuesta({ ...base, consentimiento: { aceptado: true, version: '2026-10-29' } })
    assert.equal(b.repetida, true)
    assert.deepEqual(srv.log, [], 'lo ya propuesto no se vuelve a enviar')
    assert.equal(servicio.leerEstadoSync().compartir, false, 'compartir está apagado por defecto')
  })
})
