/**
 * Actualización automática vía GitHub Releases (electron-updater).
 *
 * - Desactivada fuera de la app empaquetada o con JASWAVE_DISABLE_UPDATES=1.
 * - Comprueba 30 s tras el arranque y luego cada 6 h; descarga en segundo plano
 *   e instala al salir (o al pulsar «Reiniciar» en el banner del renderer).
 * - El feed (owner/repo) lo fija electron-builder en resources/app-update.yml
 *   a partir de `publish` en electron-builder.cjs.
 */

import type { BrowserWindow, IpcMain } from 'electron'
import type { AppUpdater, UpdateInfo } from 'electron-updater'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { logLine } from './logger'

const { app } = require('electron')

export type UpdateState = 'checking' | 'available' | 'downloaded' | 'error' | 'none'
export type UpdateStatus = { state: UpdateState; version?: string; message?: string }

const STARTUP_DELAY_MS = 30_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

let updater: AppUpdater | null = null
let lastStatus: UpdateStatus | null = null
let disabledReason: string | null = null

export function updatesDisabledReason(): string | null {
  if (!app.isPackaged) return 'app no empaquetada'
  if (process.env.JASWAVE_DISABLE_UPDATES === '1') return 'JASWAVE_DISABLE_UPDATES=1'
  // `electron-builder --win dir` no genera el feed: sin él no hay nada que comprobar.
  if (!fs.existsSync(path.join(process.resourcesPath || '', 'app-update.yml'))) return 'sin app-update.yml'
  return null
}

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err ?? 'error')).slice(0, 500)
}

/**
 * Registra IPC (siempre, para que el renderer no falle en dev) y arranca el
 * comprobador si procede. Llamar una vez, tras crear la ventana principal.
 */
export function initAutoUpdater(opts: {
  ipc: Pick<IpcMain, 'handle'>
  getWindow: () => BrowserWindow | null
}): void {
  const emit = (status: UpdateStatus) => {
    // Con una actualización ya descargada, las comprobaciones periódicas no deben ocultar el aviso.
    if (lastStatus?.state === 'downloaded' && status.state !== 'downloaded') return
    lastStatus = status
    const win = opts.getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('update-status', status)
  }

  const check = async (): Promise<UpdateStatus | null> => {
    if (!updater) return null
    try {
      await updater.checkForUpdates()
    } catch {
      // El logger de electron-updater y el evento 'error' ya registran y notifican.
    }
    return lastStatus
  }

  opts.ipc.handle('update-check', async () => {
    if (!updater) return { state: 'none', message: `actualizaciones desactivadas (${disabledReason})` } satisfies UpdateStatus
    return (await check()) ?? { state: 'none' }
  })
  opts.ipc.handle('update-install-now', () => {
    if (!updater || lastStatus?.state !== 'downloaded') return false
    logLine('info', 'updater', `instalando ${lastStatus.version ?? ''} y reiniciando`)
    // before-quit detiene el plugin host y el agent bridge.
    setImmediate(() => updater?.quitAndInstall(false, true))
    return true
  })

  disabledReason = updatesDisabledReason()
  if (disabledReason) {
    logLine('info', 'updater', `desactivado: ${disabledReason}`)
    return
  }

  try {
    // Carga diferida: en dev no se toca electron-updater.
    updater = (require('electron-updater') as typeof import('electron-updater')).autoUpdater
  } catch (err) {
    logLine('error', 'updater', 'no se pudo cargar electron-updater', err)
    return
  }

  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.logger = {
    info: (m?: unknown) => logLine('info', 'updater', m),
    warn: (m?: unknown) => logLine('warn', 'updater', m),
    error: (m?: unknown) => logLine('error', 'updater', m),
    debug: () => {},
  }

  updater.on('checking-for-update', () => emit({ state: 'checking' }))
  updater.on('update-available', (info: UpdateInfo) => emit({ state: 'available', version: info.version }))
  updater.on('update-not-available', () => emit({ state: 'none' }))
  updater.on('update-downloaded', (info: UpdateInfo) => {
    logLine('info', 'updater', `descargada v${info.version}; se instalará al salir`)
    emit({ state: 'downloaded', version: info.version })
  })
  updater.on('error', (err: Error) => {
    // electron-updater ya lo registra vía updater.logger.error.
    emit({ state: 'error', message: errorMessage(err) })
  })

  setTimeout(() => void check(), STARTUP_DELAY_MS).unref?.()
  setInterval(() => void check(), CHECK_INTERVAL_MS).unref?.()
}
