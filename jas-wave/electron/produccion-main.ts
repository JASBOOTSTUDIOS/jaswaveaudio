/**
 * Producciones de la banda en el proceso principal (plan Q): IPC del diario y los puntos de control, cierre de
 * emergencia, caída o bloqueo del renderer y vigilancia de memoria.
 *
 * Qué garantiza y qué no:
 *  - Cada línea del diario se escribe con fsync; un corte de luz pierde, como mucho, la línea en curso.
 *  - Al cerrar la sesión de Windows, apagar o cerrar la app de verdad, lo abierto se marca «interrumpida» de
 *    forma síncrona y se pide al renderer una copia extra del proyecto (best effort: si el sistema mata el proceso
 *    antes, queda la última copia de una etapa o músico terminados).
 */

import * as os from 'node:os'
import { AlmacenProducciones, carpetasProducciones, idValido, MAX_BYTES_PUNTO } from './produccion-diario'
import { avisoMemoria, evaluarMemoria, type NivelMemoria } from './vigilancia-memoria'

type Ventana = {
  isDestroyed: () => boolean
  webContents: {
    isDestroyed: () => boolean
    send: (canal: string, ...args: unknown[]) => void
    reload: () => void
    on: (ev: string, fn: (...a: any[]) => void) => void
  }
  on: (ev: string, fn: (...a: any[]) => void) => void
}

export type OpcionesProduccionMain = {
  ipcMain: { handle: (canal: string, fn: (e: any, ...args: any[]) => unknown) => void }
  app: { getPath: (n: string) => string; getAppMetrics: () => Array<{ memory: { workingSetSize: number } }> }
  powerMonitor?: { on: (ev: string, fn: () => void) => void }
  dialog?: { showMessageBox: (w: any, o: any) => Promise<{ response: number }> }
  getWindow: () => Ventana | null
  logLine: (nivel: 'info' | 'warn' | 'error', origen: string, msg: string, extra?: unknown) => void
  esRemitentePrincipal: (e: unknown) => boolean
  env?: NodeJS.ProcessEnv
}

const MAX_TEXTO = 1024 * 1024
const err = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function instalarProduccionMain(o: OpcionesProduccionMain) {
  const env = o.env ?? process.env
  const { producciones, recuperacion } = carpetasProducciones(env, o.app.getPath('appData'))
  const almacen = new AlmacenProducciones(producciones, recuperacion)
  const aviso = (payload: Record<string, unknown>) => {
    const w = o.getWindow()
    if (w && !w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('produccion-aviso', payload)
  }
  const solo = (e: unknown) => {
    if (!o.esRemitentePrincipal(e)) throw new Error('Solo la ventana principal puede usar las producciones')
  }
  const envolver = <T>(fn: () => T) => {
    try {
      return { ok: true as const, ...(fn() as object) }
    } catch (e) {
      return { ok: false as const, error: err(e) }
    }
  }

  const { ipcMain } = o
  ipcMain.handle('produccion-carpeta', (e) => envolver(() => (solo(e), { producciones, recuperacion })))
  ipcMain.handle('produccion-iniciar', (e, proyectoId: unknown, runId: unknown) =>
    envolver(() => {
      solo(e)
      if (!idValido(proyectoId) || !idValido(runId)) throw new Error('Identificador no válido')
      almacen.iniciar(proyectoId, runId)
      return {}
    }),
  )
  ipcMain.handle('produccion-anexar', (e, proyectoId: unknown, runId: unknown, texto: unknown) =>
    envolver(() => {
      solo(e)
      if (!idValido(proyectoId) || !idValido(runId) || typeof texto !== 'string' || texto.length > MAX_TEXTO) throw new Error('Datos no válidos')
      return { escrito: almacen.anexar(proyectoId, runId, texto) }
    }),
  )
  ipcMain.handle('produccion-listar', (e, proyectoId: unknown) =>
    envolver(() => {
      solo(e)
      if (!idValido(proyectoId)) throw new Error('Identificador no válido')
      return { producciones: almacen.listar(proyectoId) }
    }),
  )
  ipcMain.handle('produccion-leer', (e, proyectoId: unknown, runId: unknown) =>
    envolver(() => {
      solo(e)
      if (!idValido(proyectoId) || !idValido(runId)) throw new Error('Identificador no válido')
      return { texto: almacen.leer(proyectoId, runId) }
    }),
  )
  ipcMain.handle('produccion-punto-guardar', (e, proyectoId: unknown, json: unknown, que: unknown) =>
    envolver(() => {
      solo(e)
      if (!idValido(proyectoId) || typeof json !== 'string' || json.length > MAX_BYTES_PUNTO) throw new Error('Datos no válidos')
      return almacen.guardarPunto(proyectoId, json, String(que ?? ''))
    }),
  )
  ipcMain.handle('produccion-punto-cargar', (e, proyectoId: unknown) =>
    envolver(() => {
      solo(e)
      if (!idValido(proyectoId)) throw new Error('Identificador no válido')
      return { punto: almacen.cargarPunto(proyectoId) }
    }),
  )
  ipcMain.handle('produccion-punto-info', (e, proyectoId: unknown) =>
    envolver(() => {
      solo(e)
      if (!idValido(proyectoId)) throw new Error('Identificador no válido')
      return { cabecera: almacen.ultimoPunto(proyectoId) }
    }),
  )
  ipcMain.handle('produccion-candado-tomar', (e, proyectoId: unknown, runId: unknown) =>
    envolver(() => {
      solo(e)
      if (!idValido(proyectoId) || !idValido(runId)) throw new Error('Identificador no válido')
      return { testigo: almacen.tomarCandado(proyectoId, runId) }
    }),
  )
  ipcMain.handle('produccion-candado-soltar', (e, proyectoId: unknown, runId: unknown, testigo: unknown) =>
    envolver(() => {
      solo(e)
      if (!idValido(proyectoId) || !idValido(runId) || typeof testigo !== 'string') throw new Error('Datos no válidos')
      return { soltado: almacen.soltarCandado(proyectoId, runId, testigo) }
    }),
  )

  /** Cierre real (apagado, cierre de sesión, salir de la app): lo abierto queda interrumpido y se pide una copia extra. */
  const cierreDeEmergencia = (motivo: string) => {
    try {
      const w = o.getWindow()
      if (almacen.hayActivas()) aviso({ tipo: 'emergencia', motivo })
      const n = almacen.marcarInterrumpidas(motivo)
      if (n) o.logLine('warn', 'produccion', `cierre de emergencia (${motivo}): ${n} producción(es) marcadas como interrumpidas`)
      void w
    } catch (e) {
      o.logLine('error', 'produccion', 'cierre de emergencia', e)
    }
  }

  // Apagado o cierre de sesión de Windows; suspender solo pide una copia extra (al volver, la producción sigue).
  o.powerMonitor?.on('shutdown', () => cierreDeEmergencia('apagado del sistema'))
  o.powerMonitor?.on('suspend', () => {
    if (almacen.hayActivas()) aviso({ tipo: 'emergencia', motivo: 'suspensión' })
  })
  const w0 = () => o.getWindow()
  const enlazarVentana = (w: Ventana) => {
    w.on('session-end', () => cierreDeEmergencia('cierre de sesión de Windows'))
    // El renderer murió (memoria, fallo gráfico…): se marca, se recarga la ventana y se ofrece reanudar.
    let recargas: number[] = []
    w.webContents.on('render-process-gone', (_e: unknown, d: { reason: string }) => {
      if (d?.reason === 'clean-exit') return
      o.logLine('error', 'produccion', `render-process-gone (${d?.reason})`)
      almacen.marcarInterrumpidas(`la ventana se cerró sola (${d?.reason})`)
      const ahora = Date.now()
      recargas = recargas.filter((t) => ahora - t < 5 * 60_000)
      // Un bucle de caídas no se recarga eternamente.
      if (recargas.length >= 3) return
      recargas.push(ahora)
      setTimeout(() => {
        const w = w0()
        if (w && !w.isDestroyed()) w.webContents.reload()
      }, 800)
    })
    let preguntando = false
    let sinResponder = false
    w.webContents.on('unresponsive', () => {
      sinResponder = true
      o.logLine('warn', 'produccion', 'la ventana no responde')
      // Dar tiempo: un análisis largo también bloquea unos segundos.
      setTimeout(async () => {
        if (preguntando || !o.dialog) return
        const win = w0()
        if (!win || win.isDestroyed() || !sinResponder) return
        preguntando = true
        try {
          const r = await o.dialog.showMessageBox(win, {
            type: 'warning',
            title: 'JasWave no responde',
            message: 'JasWave ha dejado de responder.',
            detail: 'Puedes esperar un poco más o reiniciar la ventana. Tu proyecto y la producción en curso están guardados y podrás reanudarlos.',
            buttons: ['Esperar', 'Reiniciar la ventana'],
            defaultId: 0,
            cancelId: 0,
          })
          if (r.response === 1) {
            almacen.marcarInterrumpidas('la ventana dejó de responder')
            win.webContents.reload()
          }
        } finally {
          preguntando = false
        }
      }, 45_000)
    })
    w.webContents.on('responsive', () => {
      sinResponder = false
    })
  }

  // ── Memoria ──────────────────────────────────────────────────────────────
  let nivelPrevio: NivelMemoria = 'ok'
  let ultimoAviso = 0
  const revisarMemoria = () => {
    try {
      const appBytes = o.app.getAppMetrics().reduce((s, p) => s + (p.memory?.workingSetSize ?? 0) * 1024, 0)
      const nivel = evaluarMemoria({ appBytes, libresBytes: os.freemem(), totalBytes: os.totalmem() })
      const ahora = Date.now()
      if (nivel !== 'ok' && (nivel !== nivelPrevio || ahora - ultimoAviso > 5 * 60_000)) {
        ultimoAviso = ahora
        o.logLine('warn', 'memoria', `nivel ${nivel}`, { appMB: Math.round(appBytes / 1048576), libresMB: Math.round(os.freemem() / 1048576) })
        aviso({ tipo: 'memoria', nivel, texto: avisoMemoria(nivel) })
      }
      nivelPrevio = nivel
    } catch {
      /* sin métricas: no se vigila */
    }
  }
  const temporizador = setInterval(revisarMemoria, 20_000)
  ;(temporizador as unknown as { unref?: () => void }).unref?.()

  return { almacen, enlazarVentana, cierreDeEmergencia, revisarMemoria }
}
