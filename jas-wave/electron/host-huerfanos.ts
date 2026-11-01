/**
 * Hosts de audio huérfanos.
 *
 * Antes cada arranque del motor hacía `taskkill /F /IM jaswave-plugin-host.exe`: mataba también el motor
 * de cualquier otra JasWave abierta (salida code=1), esa respondía rearrancando el suyo y matando el
 * de esta, y ambas acababan en crash-loop con plugins en cuarentena. Ahora solo se mata un host cuyo
 * proceso padre (la app que lo lanzó) ya no existe. Que dos instancias vivas no suenen a la vez lo
 * garantiza la reserva del motor de audio en el propio host (`acquireAudioEngine`).
 */
import { execFile } from 'node:child_process'

export const NOMBRE_HOST = 'jaswave-plugin-host.exe'

export type ProcesoHost = { pid: number; ppid: number }

/** Parsea líneas `pid ppid`. */
export function parsearProcesosHost(salida: string): ProcesoHost[] {
  const out: ProcesoHost[] = []
  for (const linea of salida.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(linea)
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]) })
  }
  return out
}

/** Hosts cuyo padre ya no vive (sin contar los `propios`, p. ej. el hijo actual). */
export function hostsHuerfanos(
  procesos: ProcesoHost[],
  vivo: (pid: number) => boolean,
  propios: number[] = [],
): number[] {
  return procesos.filter((p) => !propios.includes(p.pid) && (p.ppid <= 0 || !vivo(p.ppid))).map((p) => p.pid)
}

export function procesoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM: existe pero es de otro usuario/elevado.
    return (e as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

function ejecutar(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(bin, args, { windowsHide: true, timeout: timeoutMs }, (_err, stdout) => resolve(String(stdout ?? '')))
  })
}

/** Lista los `jaswave-plugin-host.exe` con su padre (Windows). */
export async function listarProcesosHost(): Promise<ProcesoHost[]> {
  if (process.platform !== 'win32') return []
  const ps = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  const cmd =
    `Get-CimInstance Win32_Process -Filter "Name='${NOMBRE_HOST}'" | ` +
    `ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }`
  return parsearProcesosHost(await ejecutar(ps, ['-NoProfile', '-NonInteractive', '-Command', cmd], 8000))
}

/** Mata solo los hosts huérfanos. Devuelve los PID terminados. */
export async function matarHostsHuerfanos(propios: number[] = []): Promise<number[]> {
  if (process.platform !== 'win32') return []
  const pids = hostsHuerfanos(await listarProcesosHost(), procesoVivo, propios)
  for (const pid of pids) await ejecutar('taskkill', ['/F', '/T', '/PID', String(pid)], 5000)
  return pids
}
