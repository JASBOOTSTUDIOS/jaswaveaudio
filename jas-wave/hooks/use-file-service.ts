import { useCallback, useRef } from 'react'
import { useDAW } from '../src/context/daw-context'
import {
  abrirProyectoIO,
  guardarProyectoComoIO,
  guardarProyectoIO,
  mensajeError,
  nuevoProyectoIO,
} from '../src/lib/project-io'
import type { AiChatRequest, AiChatResult, AiHealthResult } from '../src/lib/ai-settings'

declare global {
  interface Window {
    electron: {
      windowMinimize: () => Promise<void>
      localAppData?: () => Promise<string>
      userDataPath?: () => Promise<string>
      knownPaths?: () => Promise<{ resourcesPath: string; localAppData: string; bundledVst3Dir: string }>
      pluginsListar?: () => Promise<import('../src/lib/plugins/registro-plugins').PaqueteRecibido[]>
      onUpdateStatus?: (
        callback: (status: {
          state: 'checking' | 'available' | 'downloaded' | 'error' | 'none'
          version?: string
          message?: string
        }) => void,
      ) => () => void
      updateInstallNow?: () => Promise<boolean>
      updateCheck?: () => Promise<{ state: string; version?: string; message?: string }>
      localAppDataSync?: string
      windowMaximize: () => Promise<void>
      windowClose: () => Promise<void>
      windowIsMaximized: () => Promise<boolean>
      /** Cierre de la ventana principal pendiente de confirmar (cambios sin guardar). */
      onAppCloseRequested?: (callback: () => void) => () => void
      confirmAppClose?: () => Promise<boolean>
      cancelAppClose?: () => Promise<boolean>
      onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => () => void
      /** Main pide abrir un proyecto (segunda instancia o asociación de archivos, U7). */
      onOpenProjectRequested?: (callback: (ruta: string) => void) => () => void
      /** Proyecto que llegó antes de que el renderer estuviera listo (U7). */
      projectTakePending?: () => Promise<string | null>
      getAppVersion: () => Promise<string>
      logError?: (scope: string, message: string, stack?: string) => void
      openLogsFolder?: () => Promise<string>
      fileSave: (ruta: string, contenido: string) => Promise<{ success: boolean; error?: string }>
      fileSaveBinary: (ruta: string, data: Uint8Array) => Promise<{ success: boolean; error?: string }>
      fileRead: (ruta: string) => Promise<string>
      fileReadBinary: (ruta: string) => Promise<Uint8Array>
      fileExists: (ruta: string) => Promise<boolean>
      fileSize: (ruta: string) => Promise<number>
    /** Firma del archivo (mtime + tamaño) para detectar cambios externos (U7). */
    fileStat?: (ruta: string) => Promise<{ mtimeMs: number; size: number } | null>
      fileListDir?: (dir: string) => Promise<{
        success: boolean
        error?: string
        entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }>
      }>
      recordingsDir: (projectPath?: string) => Promise<string>
      /** Ruta real de un archivo arrastrado desde el explorador (Electron). */
      pathForFile?: (file: File) => string
      /** Copia un archivo de audio al media del proyecto (o a media/pending/). */
      mediaCopy?: (opts: { src: string; destDir: string; nombre?: string; mover?: boolean }) => Promise<{
        ok: boolean
        ruta?: string
        nombre?: string
        error?: string
      }>
      /** Busca archivos por nombre en una carpeta (reenlace de media faltante). */
      mediaBuscar?: (opts: { carpeta: string; nombres: string[] }) => Promise<{
        ok: boolean
        encontrados?: Record<string, string>
        error?: string
      }>
      dialogSave: (defaultPath?: string) => Promise<{ canceled: boolean; filePath?: string }>
      dialogOpenDirectory: () => Promise<{ canceled: boolean; filePaths?: string[] }>
      projectOpenDialog: () => Promise<{ success: boolean; data?: unknown; path?: string; canceled?: boolean; error?: string }>
      aiChat: (
        payload: AiChatRequest | unknown,
        model?: string,
        baseUrl?: string,
        temperature?: number,
      ) => Promise<AiChatResult>
      aiHealth: (payload?: unknown) => Promise<AiHealthResult | {
        status: string
        models: unknown[]
        error?: string
        errorCode?: string
        hint?: string
        provider?: string
        baseUrl?: string
      }>
      aiChatCancel?: (requestId: string) => Promise<boolean>
      /** Chat con streaming (deltas por evento); resuelve con el resultado final. */
      aiChatStream?: (
        payload: AiChatRequest,
        onEvent: (e: { type: 'delta' | 'done' | string; text?: string; success?: boolean }) => void,
      ) => Promise<AiChatResult>
      /** Runs del motor de agente persistidos en userData/agent-runs. */
      agentRunSave?: (runId: string, json: string) => Promise<{ ok: boolean; error?: string }>
      agentRunLoad?: (runId: string) => Promise<string | null>
      agentRunList?: (limit?: number) => Promise<
        Array<{ id: string; conversationId: string; messageId?: string; status: string; mode?: string; updatedAt: number; userText: string }>
      >
      agentRunDelete?: (runId: string) => Promise<boolean>
      aiCredSet?: (providerId: string, apiKey: string) => Promise<{ ok: boolean; error?: string }>
      aiCredStatus?: (providerIds: string[]) => Promise<Record<string, boolean>>
      agentBridgeGetEnabled?: () => Promise<boolean>
      agentBridgeSetEnabled?: (enabled: boolean) => Promise<{ enabled: boolean; running: boolean }>
      pluginLookup: (pluginName: string) => Promise<Array<{ title: string; snippet: string; url: string }>>
      webSearch: (query: string) => Promise<Array<{ title: string; snippet: string; url: string }>>
      dialogMessage: (type: string, title: string, message: string) => Promise<number>
      shellOpenExternal: (url: string) => Promise<boolean>
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
    /** U7: reinicia el motor de audio (limpia el contador de fallos). */
    pluginHostReset?: () => Promise<{ ok: boolean; message?: string }>
    /** U7: el motor entró en bucle de fallos. */
    onPluginHostCrashLoop?: (callback: (info?: { activo?: boolean; mensaje?: string }) => void) => () => void
      onPluginHostExited?: (
        callback: (info?: { code?: number | null; signal?: string | null }) => void,
      ) => () => void
      /** U6: aviso del dispositivo de audio (reset del driver o pérdida de la interfaz). */
      onAudioDeviceNotice?: (callback: (notice: 'reset' | 'lost') => void) => () => void
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

  // Guardar / Guardar como: el guard único de project-io une llamadas concurrentes
  // (barra, atajo, menú, IA): la segunda espera al mismo guardado.
  const save = useCallback(async () => {
    const result = await guardarProyectoIO(tienda)
    if (!result.success && !result.canceled) await notificarFallo(tienda, 'project.save', result.error)
    return result
  }, [tienda])

  const saveAs = useCallback(async () => {
    const result = await guardarProyectoComoIO(tienda)
    if (!result.success && !result.canceled) await notificarFallo(tienda, 'project.saveAs', result.error)
    return result
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

  const newProject = useCallback(async () => {
    if (loadingRef.current) return { success: false, error: 'Operation in progress' }
    loadingRef.current = true
    try {
      const result = await nuevoProyectoIO(tienda)
      // Cancelar en el diálogo de cambios sin guardar no es un error.
      if (!result.success && !result.canceled) await notificarFallo(tienda, 'project.new', result.error)
      return result
    } finally {
      loadingRef.current = false
    }
  }, [tienda])

  return { save, saveAs, openDialog, newProject }
}
