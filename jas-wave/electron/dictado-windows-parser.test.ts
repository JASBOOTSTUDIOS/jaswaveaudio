import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { describe, it } from 'node:test'
import {
  argumentosPowerShell,
  codificarComandoPowerShell,
  crearLectorEventos,
  culturaValida,
  parsearEventoDictado,
  scriptReconocedorWindows,
  type EventoDictado,
} from './dictado-windows-parser'
import { SesionDictadoWindows } from './dictado-windows'

describe('dictado-windows-parser', () => {
  it('parsea los eventos del reconocedor', () => {
    assert.deepEqual(parsearEventoDictado('{"motor":"MS-3082-80-DESK","cultura":"es-ES","tipo":"listo"}'), {
      tipo: 'listo',
      cultura: 'es-ES',
      motor: 'MS-3082-80-DESK',
    })
    assert.deepEqual(parsearEventoDictado('{"tipo":"parcial","texto":"agrega una pista"}'), { tipo: 'parcial', texto: 'agrega una pista' })
    assert.deepEqual(parsearEventoDictado('{"confianza":0.507,"tipo":"final","texto":"Agrega una pista de piano"}'), {
      tipo: 'final',
      texto: 'Agrega una pista de piano',
      confianza: 0.507,
    })
    assert.deepEqual(parsearEventoDictado('{"tipo":"fin"}'), { tipo: 'fin' })
    assert.deepEqual(parsearEventoDictado('﻿{"tipo":"fin"}\r'), { tipo: 'fin' })
  })

  it('conserva acentos y eñes (stdout en UTF-8)', () => {
    assert.deepEqual(parsearEventoDictado('{"tipo":"final","texto":"la canción está en mi menor, año"}'), {
      tipo: 'final',
      texto: 'la canción está en mi menor, año',
    })
    // ConvertTo-Json de PowerShell 5.1 puede escapar caracteres como \u00f3
    assert.deepEqual(parsearEventoDictado('{"tipo":"parcial","texto":"canci\\u00f3n"}'), { tipo: 'parcial', texto: 'canción' })
  })

  it('normaliza errores y descarta líneas que no son eventos', () => {
    assert.deepEqual(parsearEventoDictado('{"tipo":"error","codigo":"sin-microfono","mensaje":"No hay dispositivo de audio"}'), {
      tipo: 'error',
      codigo: 'sin-microfono',
      mensaje: 'No hay dispositivo de audio',
    })
    assert.deepEqual(parsearEventoDictado('{"tipo":"error"}'), { tipo: 'error', codigo: 'motor', mensaje: 'Error del reconocedor de voz' })
    assert.equal(parsearEventoDictado('#< CLIXML'), null)
    assert.equal(parsearEventoDictado(''), null)
    assert.equal(parsearEventoDictado('{roto'), null)
    assert.equal(parsearEventoDictado('{"tipo":"parcial","texto":""}'), null)
    assert.equal(parsearEventoDictado('{"tipo":"otro"}'), null)
    assert.equal(parsearEventoDictado('[1,2]'), null)
  })

  it('reconstruye líneas partidas entre trozos de stdout', () => {
    const eventos: EventoDictado[] = []
    const lector = crearLectorEventos((e) => eventos.push(e))
    lector.empujar('{"tipo":"listo"}\r\n{"tipo":"par')
    lector.empujar('cial","texto":"hola"}\r\n')
    lector.empujar('{"tipo":"fin"}')
    assert.equal(eventos.length, 2)
    lector.cerrar()
    assert.deepEqual(eventos, [{ tipo: 'listo' }, { tipo: 'parcial', texto: 'hola' }, { tipo: 'fin' }])
  })

  it('el script usa UTF-8, la cultura pedida y vigila al proceso padre', () => {
    const s = scriptReconocedorWindows({ cultura: 'es-MX', pidPadre: 4321 })
    assert.match(s, /\[Console\]::OutputEncoding = \[Text\.Encoding\]::UTF8/)
    assert.match(s, /DictationGrammar/)
    assert.match(s, /SetInputToDefaultAudioDevice/)
    assert.match(s, /RecognizeMode\]::Multiple/)
    assert.match(s, /Culture\.Name -eq 'es-MX'/)
    assert.match(s, /TwoLetterISOLanguageName -eq 'es'/)
    assert.match(s, /\$padre = 4321/)
  })

  it('no deja inyectar código por la cultura', () => {
    assert.equal(culturaValida("es-ES'; Remove-Item C:\\ -Recurse; '"), 'es-ES')
    assert.equal(culturaValida(42), 'es-ES')
    assert.equal(culturaValida('en-US'), 'en-US')
    assert.doesNotMatch(scriptReconocedorWindows({ cultura: "x'; calc; '", pidPadre: 1 }), /calc/)
  })

  it('codifica el comando en UTF-16LE base64 para -EncodedCommand', () => {
    const b64 = codificarComandoPowerShell("Write-Output 'canción'")
    assert.equal(Buffer.from(b64, 'base64').toString('utf16le'), "Write-Output 'canción'")
    const args = argumentosPowerShell('x')
    assert.deepEqual(args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'])
  })
})

/** Proceso hijo falso: stdout escribible desde el test, `kill` emite `exit`. */
function hijoFalso(): ChildProcess & { stdoutFalso: PassThrough; matado: boolean } {
  const ee = new EventEmitter() as ChildProcess & { stdoutFalso: PassThrough; matado: boolean }
  const stdout = new PassThrough()
  Object.assign(ee, {
    stdout,
    stdoutFalso: stdout,
    matado: false,
    kill: () => {
      ee.matado = true
      setImmediate(() => ee.emit('exit', null, 'SIGTERM'))
      return true
    },
  })
  return ee
}

describe('SesionDictadoWindows', () => {
  it('fuera de Windows no lanza nada', async () => {
    let lanzado = false
    const s = new SesionDictadoWindows(() => {
      lanzado = true
      return hijoFalso()
    }, 'linux')
    const r = await s.iniciar('es-ES', () => undefined)
    assert.equal(r.ok, false)
    assert.equal(lanzado, false)
  })

  it('resuelve con «listo», reenvía parciales/finales y emite «fin» al detener', async () => {
    const hijo = hijoFalso()
    const s = new SesionDictadoWindows(() => hijo, 'win32')
    const eventos: EventoDictado[] = []
    const p = s.iniciar('es-ES', (e) => eventos.push(e))
    hijo.stdoutFalso.write('{"tipo":"listo","cultura":"es-ES"}\n')
    const r = await p
    assert.deepEqual(r, { ok: true, cultura: 'es-ES' })
    hijo.stdoutFalso.write('{"tipo":"parcial","texto":"hola"}\n{"tipo":"final","texto":"Hola mundo"}\n')
    await new Promise((res) => setImmediate(res))
    s.detener()
    assert.equal(hijo.matado, true)
    assert.equal(s.activa, false)
    assert.deepEqual(eventos, [{ tipo: 'parcial', texto: 'hola' }, { tipo: 'final', texto: 'Hola mundo' }, { tipo: 'fin' }])
  })

  it('un error antes de «listo» resuelve el inicio como fallido', async () => {
    const hijo = hijoFalso()
    const s = new SesionDictadoWindows(() => hijo, 'win32')
    const p = s.iniciar('es-ES', () => undefined)
    hijo.stdoutFalso.write('{"tipo":"error","codigo":"sin-microfono","mensaje":"sin micro"}\n')
    assert.deepEqual(await p, { ok: false, codigo: 'sin-microfono', error: 'sin micro' })
    s.detener()
  })

  it('si el proceso muere mientras escucha avisa con «fin»', async () => {
    const hijo = hijoFalso()
    const s = new SesionDictadoWindows(() => hijo, 'win32')
    const eventos: EventoDictado[] = []
    const p = s.iniciar('es-ES', (e) => eventos.push(e))
    hijo.stdoutFalso.write('{"tipo":"listo"}\n')
    await p
    hijo.emit('exit', 1, null)
    assert.deepEqual(eventos, [{ tipo: 'fin' }])
    assert.equal(s.activa, false)
  })
})
