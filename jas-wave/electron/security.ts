/**
 * Endurecimiento del proceso main: origen confiable del renderer, guardas de
 * navegación/ventanas, permisos por origen y validación de remitente en IPC.
 */

import type { BrowserWindow, IpcMain, IpcMainEvent, IpcMainInvokeEvent, Session, WebContents } from 'electron'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const { app } = require('electron')

/** Dev server de Vite solo fuera de la app empaquetada. */
export function devServerUrl(): string | null {
  if (app.isPackaged) return null
  const url = process.env.VITE_DEV_SERVER_URL
  return url && /^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(url) ? url.replace(/\/$/, '') : null
}

/** index.html de Vite: <appPath>/dist/index.html (dev: jas-wave/, prod: app.asar). */
export function rendererIndexPath(): string {
  return path.join(app.getAppPath(), 'dist', 'index.html')
}

/** admin.html de Vite: JasWave Admin, app aparte del DAW con su propio bundle (mismo origen). */
export function adminIndexPath(): string {
  return path.join(app.getAppPath(), 'dist', 'admin.html')
}

/** Carga JasWave Admin (dev server o dist/admin.html). */
export async function loadAdmin(win: BrowserWindow): Promise<void> {
  const dev = devServerUrl()
  if (dev) {
    await win.loadURL(`${dev}/admin.html`)
    return
  }
  await win.loadFile(adminIndexPath())
}

export async function loadRenderer(win: BrowserWindow, query?: Record<string, string>): Promise<void> {
  const dev = devServerUrl()
  if (dev) {
    const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query).toString()}` : ''
    await win.loadURL(`${dev}/${qs}`)
    return
  }
  await win.loadFile(rendererIndexPath(), query ? { query } : undefined)
}

function samePath(a: string, b: string): boolean {
  const na = path.normalize(a)
  const nb = path.normalize(b)
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

/** URL del renderer propio (index.html o admin.html empaquetados, o el dev server). */
export function isTrustedRendererUrl(raw: string | undefined | null): boolean {
  if (!raw) return false
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  const dev = devServerUrl()
  if (dev && url.origin === new URL(dev).origin) return true
  if (url.protocol !== 'file:') return false
  try {
    const ruta = fileURLToPath(`file://${url.host}${url.pathname}`)
    return samePath(ruta, rendererIndexPath()) || samePath(ruta, adminIndexPath())
  } catch {
    return false
  }
}

/** Origen (sin ruta) del renderer: file:// empaquetado o el dev server. */
function isTrustedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false
  if (origin === 'file://' || origin === 'file:///') return !devServerUrl()
  const dev = devServerUrl()
  if (dev) {
    try {
      return new URL(origin).origin === new URL(dev).origin
    } catch {
      return false
    }
  }
  return false
}

function senderUrl(event: IpcMainInvokeEvent | IpcMainEvent): string | undefined {
  try {
    return event.senderFrame?.url || event.sender.getURL()
  } catch {
    return undefined
  }
}

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown
type OnHandler = (event: IpcMainEvent, ...args: any[]) => void

/**
 * Envuelve ipcMain: todo handler rechaza mensajes que no vengan del renderer propio
 * (p. ej. un iframe o una navegación a contenido remoto).
 */
export function createGuardedIpc(ipcMain: IpcMain): Pick<IpcMain, 'handle' | 'on'> {
  return {
    handle(channel: string, listener: InvokeHandler) {
      ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
        if (!isTrustedRendererUrl(senderUrl(event))) {
          throw new Error(`IPC "${channel}" rechazado: remitente no confiable`)
        }
        return listener(event, ...args)
      })
    },
    on(channel: string, listener: OnHandler) {
      ipcMain.on(channel, (event: IpcMainEvent, ...args: unknown[]) => {
        if (!isTrustedRendererUrl(senderUrl(event))) return
        listener(event, ...args)
      })
      return ipcMain
    },
  } as Pick<IpcMain, 'handle' | 'on'>
}

/** Bloquea ventanas nuevas, navegación fuera del renderer y <webview>. */
export function installNavigationGuards(): void {
  app.on('web-contents-created', (_e: unknown, contents: WebContents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedRendererUrl(url)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!isTrustedRendererUrl(url)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

const ALLOWED_PERMISSIONS = new Set(['midi', 'midiSysex', 'media', 'audioCapture'])
const ALLOWED_DEVICE_TYPES = new Set(['midi', 'audio'])

/** MIDI y entrada de audio solo para el renderer propio; nada más. */
export function installPermissionHandlers(session: Session): void {
  session.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = (details as { requestingUrl?: string })?.requestingUrl || wc?.getURL()
    callback(ALLOWED_PERMISSIONS.has(permission) && isTrustedRendererUrl(origin))
  })
  session.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    if (!ALLOWED_PERMISSIONS.has(permission)) return false
    return wc ? isTrustedRendererUrl(wc.getURL()) : isTrustedOrigin(requestingOrigin)
  })
  try {
    session.setDevicePermissionHandler((details) => {
      const type = (details as { deviceType?: string }).deviceType ?? ''
      return ALLOWED_DEVICE_TYPES.has(type) && isTrustedOrigin(details.origin)
    })
  } catch {
    /* Electron sin device permission handler */
  }
}

/** Solo http(s)/mailto hacia el navegador del sistema. */
export function isSafeExternalUrl(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length > 2048) return false
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:'
  } catch {
    return false
  }
}
