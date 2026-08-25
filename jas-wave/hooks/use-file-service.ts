import { useCallback, useRef } from 'react'
import { useDAW } from '../src/context/daw-context'
import {
  abrirProyectoIO,
  guardarProyectoComoIO,
  guardarProyectoIO,
  mensajeError,
  nuevoProyectoIO,
} from '../src/lib/project-io'

declare global {
  interface Window {
    electron: {
      windowMinimize: () => Promise<void>
      windowMaximize: () => Promise<void>
      windowClose: () => Promise<void>
      windowIsMaximized: () => Promise<boolean>
      onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => void
      getAppVersion: () => Promise<string>
      fileSave: (ruta: string, contenido: string) => Promise<{ success: boolean; error?: string }>
      fileSaveBinary: (ruta: string, data: Uint8Array) => Promise<{ success: boolean; error?: string }>
      fileRead: (ruta: string) => Promise<string>
      fileReadBinary: (ruta: string) => Promise<Uint8Array>
      fileExists: (ruta: string) => Promise<boolean>
      fileSize: (ruta: string) => Promise<number>
      recordingsDir: (projectPath?: string) => Promise<string>
      dialogSave: (defaultPath?: string) => Promise<{ canceled: boolean; filePath?: string }>
      dialogOpen: () => Promise<{ canceled: boolean; filePaths?: string[] }>
      dialogOpenDirectory: () => Promise<{ canceled: boolean; filePaths?: string[] }>
      projectSave: (projectId: string, data: unknown) => Promise<{ success: boolean; path?: string; size?: number; error?: string }>
      projectLoad: (projectId: string) => Promise<{ success: boolean; data?: unknown; error?: string }>
      projectOpenDialog: () => Promise<{ success: boolean; data?: unknown; path?: string; canceled?: boolean; error?: string }>
      projectSaveAs: (projectId: string, data: unknown) => Promise<{ success: boolean; path?: string; size?: number; canceled?: boolean; error?: string }>
      projectList: () => Promise<{ success: boolean; projects?: Array<{ id: string; name: string; modified: number; size: number }>; error?: string }>
      aiChat: (
        payload: unknown,
        model?: string,
        baseUrl?: string,
        temperature?: number,
      ) => Promise<{
        success: boolean
        content?: string
        model?: string
        provider?: string
        error?: string
        errorCode?: string
        hint?: string
      }>
      aiHealth: (payload?: unknown) => Promise<{
        status: string
        models: unknown[]
        error?: string
        errorCode?: string
        hint?: string
        provider?: string
        baseUrl?: string
      }>
      pluginLookup: (pluginName: string) => Promise<Array<{ title: string; snippet: string; url: string }>>
      dialogMessage: (type: string, title: string, message: string) => Promise<number>
      shellOpenExternal: (url: string) => Promise<void>
      nativeAudioAvailable: () => Promise<boolean>
      nativeAudioInitialize: (config: unknown) => Promise<void>
      nativeAudioShutdown: () => Promise<void>
      nativeAudioLoadBuffer: (
        id: string,
        samples: Float32Array,
        sampleRate: number,
        channels: number,
      ) => Promise<void>
      nativeAudioUnloadBuffer: (id: string) => Promise<void>
      nativeAudioSetGraph: (graph: unknown) => Promise<void>
      nativeAudioPlay: () => Promise<void>
      nativeAudioPause: () => Promise<void>
      nativeAudioStop: () => Promise<void>
      nativeAudioSeek: (seconds: number) => Promise<void>
      nativeAudioGetPlayhead: () => Promise<number>
      nativeAudioIsPlaying: () => Promise<boolean>
      nativeAudioGetMeterPeak: () => Promise<number>
      pluginHostStatus: () => Promise<{
        isolationPolicy: string
        builtinInProcess: boolean
        thirdPartyOutOfProcess: boolean
        vst3HostProcessAvailable: boolean
        backend?: string
        mixPipeConnected?: boolean
        nativePid?: number
        note: string
      }>
      pluginHostEnsure: () => Promise<{ ok: boolean } & Record<string, unknown>>
      pluginHostSend: (cmd: unknown) => Promise<unknown>
      pluginHostMidi: (cmd: unknown) => void
      onPluginHostRestarted?: (callback: () => void) => () => void
      onPluginHostExited?: (
        callback: (info?: { code?: number | null; signal?: string | null }) => void,
      ) => () => void
      pluginHostPushPcm: (samples: Float32Array | ArrayBuffer | Uint8Array) => void
      pluginHostStop: () => Promise<{ ok: boolean }>
      onAgentBridgeRequest?: (
        callback: (msg: { id: string; channel: string; payload: Record<string, unknown> }) => void,
      ) => () => void
      agentBridgeReply?: (id: string, result: unknown, error?: string) => void
      onNativeMidi?: (callback: (msg: { id: string; data: number[] }) => void) => () => void
    }
  }
}

async function notificarFallo(tienda: ReturnType<typeof useDAW>, type: string, error: unknown) {
  const msg = mensajeError(error as string) ?? String(error ?? 'Error')
  tienda.busEventos.emit('comando.fallido', { type, error: msg })
  try {
    await window.electron?.dialogMessage?.('error', 'JasWave', msg)
  } catch {
    /* ignore */
  }
}

export function useFileService() {
  const tienda = useDAW()
  const loadingRef = useRef(false)

  const save = useCallback(async () => {
    if (loadingRef.current) return { success: false, error: 'Operation in progress' }
    loadingRef.current = true
    try {
      const result = await guardarProyectoIO(tienda)
      if (!result.success && !result.canceled) await notificarFallo(tienda, 'project.save', result.error)
      return result
    } finally {
      loadingRef.current = false
    }
  }, [tienda])

  const saveAs = useCallback(async () => {
    if (loadingRef.current) return { success: false, error: 'Operation in progress' }
    loadingRef.current = true
    try {
      const result = await guardarProyectoComoIO(tienda)
      if (!result.success && !result.canceled) await notificarFallo(tienda, 'project.saveAs', result.error)
      return result
    } finally {
      loadingRef.current = false
    }
  }, [tienda])

  const openDialog = useCallback(async () => {
    if (loadingRef.current) return { success: false, error: 'Operation in progress' }
    loadingRef.current = true
    try {
      const result = await abrirProyectoIO(tienda)
      if (!result.success && !result.canceled) await notificarFallo(tienda, 'project.open', result.error)
      return result
    } finally {
      loadingRef.current = false
    }
  }, [tienda])

  const load = useCallback(async (projectId: string) => {
    if (!window.electron) return { success: false, error: 'Not in Electron' }
    loadingRef.current = true
    try {
      const result = await window.electron.projectLoad(projectId)
      if (result.success && result.data) {
        const data = result.data as Record<string, unknown>
        const actual = tienda.obtenerEstado()
        tienda.reemplazarEstado({
          ...actual,
          ...(data.project ? { project: data.project as typeof actual.project } : {}),
          ...(data.transport ? { transport: data.transport as typeof actual.transport } : {}),
          ...(data.atajos ? { atajos: data.atajos as typeof actual.atajos } : {}),
          ...(typeof data.version === 'string' ? { version: data.version } : {}),
        })
      } else if (!result.success) {
        await notificarFallo(tienda, 'project.load', result.error)
      }
      return result
    } finally {
      loadingRef.current = false
    }
  }, [tienda])

  const listProjects = useCallback(async () => {
    if (!window.electron) return []
    const result = await window.electron.projectList()
    return result.projects || []
  }, [])

  const newProject = useCallback(async () => {
    if (loadingRef.current) return { success: false, error: 'Operation in progress' }
    loadingRef.current = true
    try {
      const result = await nuevoProyectoIO(tienda)
      if (!result.success) await notificarFallo(tienda, 'project.new', result.error)
      return result
    } finally {
      loadingRef.current = false
    }
  }, [tienda])

  return { save, saveAs, load, openDialog, listProjects, newProject }
}
