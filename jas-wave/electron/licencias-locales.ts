/**
 * Licencia local compartida con los VST JasWave (contrato: plugins/CONTRATO-V5.md §4).
 *
 *   %APPDATA%\JasWave\license\license.jwl  — licencia firmada (texto ASCII, sin salto final)
 *   %APPDATA%\JasWave\license\device.bin   — tokenDispositivo cifrado con DPAPI (blob crudo de
 *                                             CryptProtectData, sin entropía, ámbito usuario)
 *
 * Node no expone DPAPI y `safeStorage` de Electron no produce blobs compatibles con
 * `CryptUnprotectData`, así que se usa ProtectedData de Windows PowerShell (ruta absoluta en
 * System32; los datos viajan en base64 por stdin, sin interpolarse en el script).
 */

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { writeFileAtomic } from './atomic-write'

const FORMATO_LICENCIA = /^jwl1\.[A-Za-z0-9_-]{10,20000}\.[A-Za-z0-9_-]{40,200}$/
const FORMATO_TOKEN_DISPOSITIVO = /^[A-Za-z0-9_-]{20,200}$/

export function carpetaLicencias(appData = process.env.APPDATA ?? ''): string {
  if (!appData) throw new Error('APPDATA no disponible')
  return path.join(appData, 'JasWave', 'license')
}

function rutaPowerShell(): string {
  const raiz = process.env.SystemRoot || 'C:\\Windows'
  return path.join(raiz, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/** Protege o desprotege con DPAPI (usuario actual). */
export function dpapi(operacion: 'Protect' | 'Unprotect', datos: Buffer): Promise<Buffer> {
  const script =
    'Add-Type -AssemblyName System.Security; ' +
    '$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); ' +
    `$o=[System.Security.Cryptography.ProtectedData]::${operacion}($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
    '[Console]::Out.Write([Convert]::ToBase64String($o))'
  return new Promise((resolve, reject) => {
    const ps = spawn(rutaPowerShell(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let salida = ''
    let error = ''
    const limite = setTimeout(() => ps.kill(), 20_000)
    ps.stdout.on('data', (d) => (salida += d.toString()))
    ps.stderr.on('data', (d) => (error += d.toString()))
    ps.on('error', (e) => {
      clearTimeout(limite)
      reject(e)
    })
    ps.on('close', (codigo) => {
      clearTimeout(limite)
      if (codigo !== 0 || !/^[A-Za-z0-9+/=]+$/.test(salida.trim())) {
        reject(new Error(`DPAPI ${operacion} falló (código ${codigo}): ${error.trim().slice(0, 300)}`))
        return
      }
      resolve(Buffer.from(salida.trim(), 'base64'))
    })
    ps.stdin.end(datos.toString('base64'))
  })
}

/** Guarda licencia y token de dispositivo para que los VST del equipo los usen. */
export async function guardarLicenciaLocal(
  datos: { token: string; tokenDispositivo: string },
  carpeta = carpetaLicencias(),
): Promise<void> {
  if (!FORMATO_LICENCIA.test(datos.token)) throw new Error('licencia con formato inválido')
  if (!FORMATO_TOKEN_DISPOSITIVO.test(datos.tokenDispositivo)) throw new Error('token de dispositivo con formato inválido')
  const cifrado = await dpapi('Protect', Buffer.from(datos.tokenDispositivo, 'utf8'))
  // Primero el token (si fallara, la licencia anterior sigue siendo coherente con el token anterior).
  await writeFileAtomic(path.join(carpeta, 'device.bin'), cifrado)
  await writeFileAtomic(path.join(carpeta, 'license.jwl'), datos.token)
}

/** Token de dispositivo actual (o null si no hay o no se puede descifrar con este usuario). */
export async function leerTokenDispositivo(carpeta = carpetaLicencias()): Promise<string | null> {
  let blob: Buffer
  try {
    blob = await readFile(path.join(carpeta, 'device.bin'))
  } catch {
    return null
  }
  try {
    const token = (await dpapi('Unprotect', blob)).toString('utf8')
    return FORMATO_TOKEN_DISPOSITIVO.test(token) ? token : null
  } catch {
    return null
  }
}

export async function leerLicenciaLocal(carpeta = carpetaLicencias()): Promise<string | null> {
  try {
    const t = (await readFile(path.join(carpeta, 'license.jwl'), 'utf8')).trim()
    return FORMATO_LICENCIA.test(t) ? t : null
  } catch {
    return null
  }
}
