// E2E de licencias en el VST: backend falso que implementa el contrato V5 §3 (start/poll/renovar)
// firmando con una clave de PRUEBA efímera, y ejecuta jw_license_e2e en tres escenarios.
//   node plugins/tests/license/run-e2e.mjs <ruta a jw_license_e2e.exe>
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const exe = process.argv[2]
if (!exe || !fs.existsSync(exe)) {
  console.error('uso: node run-e2e.mjs <jw_license_e2e.exe>')
  process.exit(2)
}

const keys = crypto.generateKeyPairSync('ed25519')
const pubHex = Buffer.from(keys.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex')
const b64u = (b) => Buffer.from(b).toString('base64url')
function firmar(carga) {
  const p = b64u(JSON.stringify(carga))
  return `jwl1.${p}.${b64u(crypto.sign(null, Buffer.from(`jwl1.${p}`), keys.privateKey))}`
}
const productos = { 'com.jaswave.plugin.param-eq': ['eq.bandas-avanzadas', 'eq.analizador'] }
const ahora = () => Math.floor(Date.now() / 1000)
// Licencias cortas (3 h < 6 h) para forzar la renovación inmediata en el VST
const emitir = (dispositivo, exp = ahora() + 3 * 3600) => ({
  token: firmar({ sub: 'usr_e2e', email: 'e2e@jaswave.test', dispositivo, productos, iat: ahora() - 10, exp }),
  expiraEn: new Date(exp * 1000).toISOString(),
  productos,
})

const estado = { modo: 'normal', polls: 0, tokenDispositivo: null, nDisp: 0, renovaciones: [], errores: [] }
const codigo = { dispositivo: crypto.randomBytes(24).toString('base64url'), usuario: 'ABCD-EF23' }

function leerJson(req) {
  return new Promise((res) => {
    let s = ''
    req.on('data', (c) => (s += c))
    req.on('end', () => {
      try { res(JSON.parse(s)) } catch { res(null) }
    })
  })
}
function enviar(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(obj))
}
const esTexto = (v, min = 1, max = 200) => typeof v === 'string' && v.length >= min && v.length <= max

const server = http.createServer(async (req, res) => {
  const body = await leerJson(req)
  if (req.method !== 'POST' || !body) return enviar(res, 400, { error: { codigo: 'datos_invalidos', mensaje: 'x' } })
  if (req.url === '/license/device/start') {
    if (!esTexto(body.productoId) || !esTexto(body.dispositivo, 1, 120)) estado.errores.push('start: cuerpo inválido')
    if (body.productoId !== 'com.jaswave.plugin.param-eq') estado.errores.push(`start: productoId ${body.productoId}`)
    return enviar(res, 201, {
      codigoDispositivo: codigo.dispositivo,
      codigoUsuario: codigo.usuario,
      caducaEn: new Date(Date.now() + 600000).toISOString(),
      intervaloSeg: 2,
      dispositivo: body.dispositivo,
    })
  }
  if (req.url === '/license/device/poll') {
    if (body.codigoDispositivo !== codigo.dispositivo || !esTexto(body.dispositivo, 1, 120)) estado.errores.push('poll: cuerpo inválido')
    if (++estado.polls < 2) return enviar(res, 200, { estado: 'pendiente' })
    estado.tokenDispositivo = `dev-${++estado.nDisp}-${crypto.randomBytes(8).toString('hex')}`
    return enviar(res, 200, { estado: 'aprobado', ...emitir(body.dispositivo), tokenDispositivo: estado.tokenDispositivo })
  }
  if (req.url === '/license/device/renovar') {
    estado.renovaciones.push(body.tokenDispositivo)
    if (!esTexto(body.dispositivo, 1, 120)) estado.errores.push('renovar: dispositivo inválido')
    if (estado.modo === 'revocar') return enviar(res, 401, { error: { codigo: 'dispositivo_revocado', mensaje: 'revocado' } })
    if (body.tokenDispositivo !== estado.tokenDispositivo) {
      estado.errores.push(`renovar con token no vigente: ${body.tokenDispositivo}`)
      return enviar(res, 401, { error: { codigo: 'dispositivo_revocado', mensaje: 'token no vigente' } })
    }
    estado.tokenDispositivo = `dev-${++estado.nDisp}-${crypto.randomBytes(8).toString('hex')}`
    return enviar(res, 200, { estado: 'aprobado', ...emitir(body.dispositivo), tokenDispositivo: estado.tokenDispositivo })
  }
  return enviar(res, 404, { error: { codigo: 'no_encontrado', mensaje: req.url } })
})

await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-lic-e2e-'))
const env = {
  ...process.env,
  JASWAVE_LICENSE_DIR: dir,
  JASWAVE_API_URL: base,
  JASWAVE_WEB_URL: base,
  JASWAVE_LICENSE_NO_BROWSER: '1',
  JW_LICENSE_TEST_PUBKEY_HEX: pubHex,
}

function ejecutar(modo) {
  return new Promise((resolve) => {
    const p = spawn(exe, [modo], { env })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('close', (code) => resolve({ code, out }))
  })
}

let fallos = 0
const comprobar = (ok, msg) => {
  console.log(`${ok ? '  ok ' : '  FALLO'} ${msg}`)
  if (!ok) fallos++
}

console.log(`backend falso en ${base}, carpeta ${dir}`)
// 1) Activación device-code + renovación inmediata con rotación del token de dispositivo
let r = await ejecutar('activate')
process.stdout.write(r.out)
comprobar(r.code === 0, 'activate: exit 0')
comprobar(estado.renovaciones.length >= 1 && String(estado.renovaciones[0]).startsWith('dev-1-'), 'renovar usa el tokenDispositivo emitido en poll')
const devTok = /DEVICE_TOKEN=(\S*)/.exec(r.out)?.[1]
comprobar(devTok === estado.tokenDispositivo, 'device.bin (DPAPI) guarda el token rotado más reciente')

// 2) Licencia caducada en disco + device.bin -> renovación automática al arrancar
fs.writeFileSync(path.join(dir, 'license.jwl'), emitir('Reaper-PC', ahora() - 60).token)
const antes = estado.renovaciones.length
r = await ejecutar('renew-expired')
process.stdout.write(r.out)
comprobar(r.code === 0, 'renew-expired: exit 0')
comprobar(estado.renovaciones.length > antes, 'renovó con tokenDispositivo al arrancar')
comprobar(/DEVICE_TOKEN=(\S*)/.exec(r.out)?.[1] === estado.tokenDispositivo, 'token rotado guardado')

// 3) Revocación: 401 dispositivo_revocado borra licencia y token
estado.modo = 'revocar'
r = await ejecutar('revoked')
process.stdout.write(r.out)
comprobar(r.code === 0, 'revoked: exit 0')
comprobar(!fs.existsSync(path.join(dir, 'license.jwl')) && !fs.existsSync(path.join(dir, 'device.bin')), 'archivos borrados')

comprobar(estado.errores.length === 0, `peticiones conformes al contrato (${estado.errores.join('; ') || 'sin errores'})`)
server.close()
fs.rmSync(dir, { recursive: true, force: true })
console.log(fallos === 0 ? 'LICENSE E2E: OK' : `LICENSE E2E: ${fallos} FALLO(S)`)
process.exit(fallos === 0 ? 0 : 1)
