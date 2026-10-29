// Preload en sandbox: solo 'electron' (contextBridge/ipcRenderer/webUtils) y process.env.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  logError: (scope: string, message: string, stack?: string) => ipcRenderer.send('log-error', scope, message, stack),
  openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),
  /** Carpeta de configuración del asistente (reglas, habilidades, prompts y planes). */
  asistenteCarpeta: {
    listar: () => ipcRenderer.invoke('asistente-carpeta-listar'),
    escribir: (ruta: string, contenido: string) => ipcRenderer.invoke('asistente-carpeta-escribir', ruta, contenido),
    eliminar: (ruta: string) => ipcRenderer.invoke('asistente-carpeta-eliminar', ruta),
    restaurar: (ruta: string) => ipcRenderer.invoke('asistente-carpeta-restaurar', ruta),
    abrir: () => ipcRenderer.invoke('asistente-carpeta-abrir'),
  },
  localAppData: () => ipcRenderer.invoke('env-local-appdata'),
  userDataPath: () => ipcRenderer.invoke('user-data-path'),
  /** { resourcesPath, localAppData, bundledVst3Dir } — bundled solo en la app empaquetada. */
  knownPaths: () => ipcRenderer.invoke('known-paths'),
  /** Paquetes de plugins JasWave encontrados (manifiesto sin validar + integridad). */
  pluginsListar: () => ipcRenderer.invoke('plugins-listar'),
  /** H1: enlace jaswave://abrir?token=… recibido desde la web. */
  onHandover: (callback: (token: string) => void) => {
    const handler = (_event: unknown, token: string) => callback(token)
    ipcRenderer.on('handover-recibido', handler)
    return () => ipcRenderer.removeListener('handover-recibido', handler)
  },
  handoverTakePending: () => ipcRenderer.invoke('handover-take-pending'),
  /** Catálogo firmado de plugins descargables (verificado en main). */
  pluginsCatalogo: (apiBase: string) => ipcRenderer.invoke('plugins-catalogo', apiBase),
  pluginsInstalar: (apiBase: string, id: string) => ipcRenderer.invoke('plugins-instalar', apiBase, id),
  /** X1: extensiones .jwx desde archivo (como los .vsix de VS Code). */
  pluginsElegirJwx: () => ipcRenderer.invoke('plugins-elegir-jwx'),
  pluginsInspeccionarArchivo: (ruta: string) => ipcRenderer.invoke('plugins-inspeccionar-archivo', ruta),
  pluginsInstalarArchivo: (ruta: string, opciones?: { aceptarSinFirma?: boolean }) => ipcRenderer.invoke('plugins-instalar-archivo', ruta, opciones ?? {}),
  pluginsDesinstalar: (id: string) => ipcRenderer.invoke('plugins-desinstalar', id),
  /** Ruta en disco de un archivo soltado en la ventana (arrastrar un .jwx). */
  rutaDeArchivo: (archivo: File) => webUtils.getPathForFile(archivo),
  /** .jwx abierto con doble clic: llega por evento o queda pendiente hasta que el DAW lo pida. */
  onExtensionSolicitada: (callback: (ruta: string) => void) => {
    const handler = (_event: unknown, ruta: string) => callback(ruta)
    ipcRenderer.on('extension-abrir-solicitada', handler)
    return () => ipcRenderer.removeListener('extension-abrir-solicitada', handler)
  },
  extensionPendiente: () => ipcRenderer.invoke('extension-pendiente'),
  modoDesarrollador: () => ipcRenderer.invoke('ajustes-modo-desarrollador'),
  fijarModoDesarrollador: (activo: boolean) => ipcRenderer.invoke('ajustes-fijar-modo-desarrollador', activo),
  onPluginsProgreso: (callback: (p: { id: string; fase: string; recibidos?: number; total?: number; mensaje?: string }) => void) => {
    const handler = (_event: unknown, p: { id: string; fase: string; recibidos?: number; total?: number; mensaje?: string }) => callback(p)
    ipcRenderer.on('plugins-progreso', handler)
    return () => ipcRenderer.removeListener('plugins-progreso', handler)
  },
  /** El watchdog apartó un plugin (bypass + cuarentena). */
  onPluginCuarentena: (callback: (aviso: { ruta: string; motivo: string; mensaje: string }) => void) => {
    const handler = (_event: unknown, aviso: { ruta: string; motivo: string; mensaje: string }) => callback(aviso)
    ipcRenderer.on('plugin-cuarentena', handler)
    return () => ipcRenderer.removeListener('plugin-cuarentena', handler)
  },
  /** Licencia local compartida con los VST (license.jwl + device.bin con DPAPI). */
  licenciaGuardar: (datos: { token: string; tokenDispositivo: string }) => ipcRenderer.invoke('licencia-guardar', datos),
  licenciaLeer: () => ipcRenderer.invoke('licencia-leer'),
  licenciaTokenDispositivo: () => ipcRenderer.invoke('licencia-token-dispositivo'),
  equipoNombre: () => ipcRenderer.invoke('equipo-nombre'),
  // Auto-update (electron/updater.ts)
  onUpdateStatus: (callback: (status: { state: string; version?: string; message?: string }) => void) => {
    const handler = (_event: unknown, status: { state: string; version?: string; message?: string }) => callback(status)
    ipcRenderer.on('update-status', handler)
    return () => ipcRenderer.removeListener('update-status', handler)
  },
  updateInstallNow: () => ipcRenderer.invoke('update-install-now'),
  updateCheck: () => ipcRenderer.invoke('update-check'),
  /** Sync — preload tiene process.env; el renderer a menudo no. */
  localAppDataSync: process.env.LOCALAPPDATA || '',
  clipboardWriteText: (text: string) => ipcRenderer.invoke('clipboard-write-text', text),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  /** Colores de los botones nativos de ventana (solo ventanas sin marco con overlay). */
  windowSetTitleBarOverlay: (opciones: { color?: string; symbolColor?: string; height?: number }) =>
    ipcRenderer.invoke('window-set-titlebar-overlay', opciones),
  /**
   * main pide permiso para cerrar la ventana (cambios sin guardar). Al recibirlo se acusa
   * recibo de inmediato; si nadie escucha, main cierra solo tras su timeout.
   */
  onAppCloseRequested: (callback: () => void) => {
    const handler = () => {
      ipcRenderer.send('app-close-ack')
      callback()
    }
    ipcRenderer.on('app-close-requested', handler)
    return () => ipcRenderer.removeListener('app-close-requested', handler)
  },
  confirmAppClose: () => ipcRenderer.invoke('app-close-confirmed'),
  cancelAppClose: () => ipcRenderer.invoke('app-close-canceled'),
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => {
    const handler = (_event: unknown, isMaximized: boolean) => callback(isMaximized)
    ipcRenderer.on('window-maximized-changed', handler)
    return () => ipcRenderer.removeListener('window-maximized-changed', handler)
  },
  /**
   * main pide abrir un proyecto (segunda instancia o asociación de archivos).
   * El renderer decide con la guarda de cambios sin guardar (U1).
   */
  onOpenProjectRequested: (callback: (ruta: string) => void) => {
    const handler = (_event: unknown, ruta: string) => callback(ruta)
    ipcRenderer.on('open-project-requested', handler)
    return () => ipcRenderer.removeListener('open-project-requested', handler)
  },
  /** Proyecto que llegó antes de que el renderer estuviera listo (U7). */
  projectTakePending: () => ipcRenderer.invoke('project-take-pending'),
  fileSave: (ruta: string, contenido: string) => ipcRenderer.invoke('file-save', ruta, contenido),
  fileSaveBinary: (ruta: string, data: Uint8Array) => ipcRenderer.invoke('file-save-binary', ruta, data),
  /** G7: dictado por voz con el reconocedor local de Windows (la Web Speech API no funciona en Electron). */
  dictado: {
    disponible: () => ipcRenderer.invoke('dictado-disponible'),
    iniciar: (cultura: string) => ipcRenderer.invoke('dictado-iniciar', cultura),
    detener: () => ipcRenderer.invoke('dictado-detener'),
    onEvento: (callback: (evento: { tipo: string; texto?: string; codigo?: string; mensaje?: string }) => void) => {
      const handler = (_event: unknown, evento: { tipo: string; texto?: string; codigo?: string; mensaje?: string }) => callback(evento)
      ipcRenderer.on('dictado-evento', handler)
      return () => ipcRenderer.removeListener('dictado-evento', handler)
    },
  },
  ffmpegAvailable: () => ipcRenderer.invoke('ffmpeg-available'),
  ffmpegInstall: (apiBase: string) => ipcRenderer.invoke('ffmpeg-install', apiBase),
  onFfmpegProgreso: (callback: (p: { recibidos: number; total: number }) => void) => {
    const listener = (_: unknown, p: { recibidos: number; total: number }) => callback(p)
    ipcRenderer.on('ffmpeg-progreso', listener)
    return () => ipcRenderer.removeListener('ffmpeg-progreso', listener)
  },
  audioEncode: (
    input: string,
    output: string,
    formato: string,
    opciones?: { bitrate?: number; bitDepth?: number; sampleRate?: number; borrarEntrada?: boolean },
  ) => ipcRenderer.invoke('audio-encode', input, output, formato, opciones ?? {}),
  exportEnsureDir: (dir: string) => ipcRenderer.invoke('export-ensure-dir', dir),
  projectExportBundle: (
    salida: string,
    json: string,
    nombreProyecto: string,
    archivos: Array<{ origen: string; destino: string }>,
  ) => ipcRenderer.invoke('project-export-bundle', salida, json, nombreProyecto, archivos),
  projectImportBundle: () => ipcRenderer.invoke('project-import-bundle'),
  fileRead: (ruta: string) => ipcRenderer.invoke('file-read', ruta),
  fileReadBinary: (ruta: string) => ipcRenderer.invoke('file-read-binary', ruta),
  fileExists: (ruta: string) => ipcRenderer.invoke('file-exists', ruta),
  fileListDir: (dir: string) => ipcRenderer.invoke('file-list-dir', dir),
  fileSize: (ruta: string) => ipcRenderer.invoke('file-size', ruta),
  /** Firma del archivo (mtime + tamaño) para detectar cambios externos (U7). */
  fileStat: (ruta: string) => ipcRenderer.invoke('file-stat', ruta),
  recordingsDir: (projectPath?: string) => ipcRenderer.invoke('recordings-dir', projectPath),
  analisisIaDir: () => ipcRenderer.invoke('analisis-ia-dir'),
  analisisIaLimpiar: () => ipcRenderer.invoke('analisis-ia-limpiar'),
  /** Ruta real de un archivo arrastrado desde el explorador. */
  pathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  /** Copia un archivo de audio al media del proyecto; devuelve ruta absoluta y nombre final. */
  mediaCopy: (opts: { src: string; destDir: string; nombre?: string; mover?: boolean }) =>
    ipcRenderer.invoke('media-copy', opts),
  /** Busca archivos por nombre en una carpeta (reenlace de media faltante). */
  mediaBuscar: (opts: { carpeta: string; nombres: string[] }) => ipcRenderer.invoke('media-buscar', opts),
  dialogSave: (defaultPath?: string) => ipcRenderer.invoke('dialog-save', defaultPath),
  dialogOpenDirectory: () => ipcRenderer.invoke('dialog-open-directory'),
  projectOpenDialog: () => ipcRenderer.invoke('project-open-dialog'),
  aiChat: (payload: unknown, model?: string, baseUrl?: string, temperature?: number) =>
    ipcRenderer.invoke('ai-chat', payload, model, baseUrl, temperature),
  aiHealth: (payload?: unknown) => ipcRenderer.invoke('ai-health', payload),
  aiChatCancel: (requestId: string) => ipcRenderer.invoke('ai-chat-cancel', requestId),
  /** true si main arrancó con JASWAVE_AI_MOCK (pruebas): proveedor simulado local. */
  aiMockActivo: () => ipcRenderer.invoke('ai-mock-activo'),
  /** Chat con streaming: onEvent recibe {type:'delta',text} / {type:'done'}; resuelve con el resultado. */
  aiChatStream: (payload: { requestId?: string }, onEvent: (e: { type: string; text?: string; success?: boolean }) => void) => {
    const requestId = String(payload?.requestId ?? '')
    const handler = (_event: unknown, e: { requestId?: string; type: string; text?: string; success?: boolean }) => {
      if (e && e.requestId === requestId) onEvent({ type: e.type, text: e.text, success: e.success })
    }
    ipcRenderer.on('ai-chat-stream-event', handler)
    return ipcRenderer.invoke('ai-chat-stream', payload).finally(() => ipcRenderer.removeListener('ai-chat-stream-event', handler))
  },
  agentRunSave: (runId: string, json: string) => ipcRenderer.invoke('agent-run-save', runId, json),
  agentRunLoad: (runId: string) => ipcRenderer.invoke('agent-run-load', runId),
  agentRunList: (limit?: number) => ipcRenderer.invoke('agent-run-list', limit),
  agentRunDelete: (runId: string) => ipcRenderer.invoke('agent-run-delete', runId),
  /** Guarda (o borra con '') la API key de un perfil; queda cifrada en main. */
  aiCredSet: (providerId: string, apiKey: string) => ipcRenderer.invoke('ai-cred-set', providerId, apiKey),
  aiCredStatus: (providerIds: string[]) => ipcRenderer.invoke('ai-cred-status', providerIds),
  agentBridgeGetEnabled: () => ipcRenderer.invoke('agent-bridge-get-enabled'),
  agentBridgeSetEnabled: (enabled: boolean) => ipcRenderer.invoke('agent-bridge-set-enabled', enabled),
  pluginLookup: (pluginName: string) => ipcRenderer.invoke('plugin-lookup', pluginName),
  webSearch: (query: string) => ipcRenderer.invoke('web-search', query),
  /** K6: internet para la IA (búsqueda, lectura legible, YouTube y referencias). Todo corre en main. */
  webTools: {
    buscar: (q: string, max?: number) => ipcRenderer.invoke('web-tools-buscar', q, max),
    leer: (url: string, maxChars?: number) => ipcRenderer.invoke('web-tools-leer', url, maxChars),
    youtubeBuscar: (q: string, max?: number) => ipcRenderer.invoke('web-tools-youtube-buscar', q, max),
    youtubeFicha: (urlOId: string) => ipcRenderer.invoke('web-tools-youtube-ficha', urlOId),
    youtubeMiniatura: (videoId: string) => ipcRenderer.invoke('web-tools-youtube-miniatura', videoId),
    referenciaAnalizar: (url: string) => ipcRenderer.invoke('web-tools-referencia-analizar', url),
    referenciaEscuchar: (url: string, titulo?: string) => ipcRenderer.invoke('web-tools-referencia-escuchar', url, titulo),
    internetPermitido: () => ipcRenderer.invoke('web-tools-internet-permitido'),
    fijarInternetPermitido: (activo: boolean) => ipcRenderer.invoke('web-tools-fijar-internet-permitido', activo),
    onProgreso: (callback: (p: { fase: string; detalle?: string }) => void) => {
      const listener = (_event: unknown, p: { fase: string; detalle?: string }) => callback(p)
      ipcRenderer.on('web-tools-progreso', listener)
      return () => ipcRenderer.removeListener('web-tools-progreso', listener)
    },
  },
  dialogMessage: (type: string, title: string, message: string) => ipcRenderer.invoke('dialog-message', type, title, message),
  shellOpenExternal: (url: string) => ipcRenderer.invoke('shell-open-external', url),
  /** Abre JasWave Admin (admin.html) en su propia ventana. */
  abrirAdmin: () => ipcRenderer.invoke('admin-window-open'),
  openToolWindow: (toolId: string, title: string, extra?: Record<string, string>) =>
    ipcRenderer.invoke('tool-window-open', toolId, title, extra),
  closeToolWindow: (toolId: string) => ipcRenderer.invoke('tool-window-close', toolId),
  onToolWindowClosed: (callback: (toolId: string) => void) => {
    const handler = (_event: unknown, toolId: string) => callback(toolId)
    ipcRenderer.on('tool-window-closed', handler)
    return () => ipcRenderer.removeListener('tool-window-closed', handler)
  },
  onMenuAction: (callback: (actionId: string) => void) => {
    const handler = (_event: unknown, actionId: string) => callback(actionId)
    ipcRenderer.on('menu-action', handler)
    return () => ipcRenderer.removeListener('menu-action', handler)
  },
  // Native C++ audio (ADR-0009)
  nativeAudioAvailable: () => ipcRenderer.invoke('native-audio-available'),
  nativeAudioInitialize: (config: unknown) => ipcRenderer.invoke('native-audio-initialize', config),
  nativeAudioShutdown: () => ipcRenderer.invoke('native-audio-shutdown'),
  nativeAudioLoadBuffer: (id: string, samples: Float32Array, sampleRate: number, channels: number) =>
    ipcRenderer.invoke('native-audio-load-buffer', id, samples, sampleRate, channels),
  nativeAudioUnloadBuffer: (id: string) => ipcRenderer.invoke('native-audio-unload-buffer', id),
  nativeAudioSetGraph: (graph: unknown) => ipcRenderer.invoke('native-audio-set-graph', graph),
  nativeAudioPlay: () => ipcRenderer.invoke('native-audio-play'),
  nativeAudioPause: () => ipcRenderer.invoke('native-audio-pause'),
  nativeAudioStop: () => ipcRenderer.invoke('native-audio-stop'),
  nativeAudioSeek: (seconds: number) => ipcRenderer.invoke('native-audio-seek', seconds),
  nativeAudioGetPlayhead: () => ipcRenderer.invoke('native-audio-playhead'),
  nativeAudioIsPlaying: () => ipcRenderer.invoke('native-audio-is-playing'),
  nativeAudioGetMeterPeak: () => ipcRenderer.invoke('native-audio-meter'),
  pluginHostStatus: () => ipcRenderer.invoke('plugin-host-status'),
  pluginHostEnsure: () => ipcRenderer.invoke('plugin-host-ensure'),
  /** U7: limpia el contador de fallos y reinicia el motor (sin cargar plugins). */
  pluginHostReset: () => ipcRenderer.invoke('plugin-host-reset'),
  pluginHostSend: (cmd: unknown) => ipcRenderer.invoke('plugin-host-send', cmd),
  pluginHostMidi: (cmd: unknown) => ipcRenderer.send('plugin-host-midi', cmd),
  /** Pin: elementos anclados (editores de plugin y paneles flotantes), jerarquía por índice (0 = más arriba). */
  pins: {
    estado: () => ipcRenderer.invoke('pins-estado'),
    /** Clave de proyecto activo (solo la ventana principal): cada proyecto guarda su jerarquía. */
    establecerProyecto: (clave: string) => ipcRenderer.invoke('pins-proyecto', clave),
    alternar: (tipo: 'editor' | 'panel', id: string, etiqueta?: string) => ipcRenderer.invoke('pins-alternar', tipo, id, etiqueta),
    mover: (clave: string, delta: number) => ipcRenderer.invoke('pins-mover', clave, delta),
    moverA: (clave: string, destino: number) => ipcRenderer.invoke('pins-mover-a', clave, destino),
    quitar: (clave: string) => ipcRenderer.invoke('pins-quitar', clave),
    onCambio: (callback: (estado: unknown) => void) => {
      const handler = (_event: unknown, estado: unknown) => callback(estado)
      ipcRenderer.on('pins-cambio', handler)
      return () => ipcRenderer.removeListener('pins-cambio', handler)
    },
  },
  onPluginHostRestarted: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('plugin-host-restarted', handler)
    return () => ipcRenderer.removeListener('plugin-host-restarted', handler)
  },
  /** U7: el motor entró en bucle de fallos (o se resolvió con "Reiniciar motor"). */
  onPluginHostCrashLoop: (callback: (info?: { activo?: boolean; mensaje?: string }) => void) => {
    const handler = (_: unknown, info: { activo?: boolean; mensaje?: string }) => callback(info)
    ipcRenderer.on('plugin-host-crash-loop', handler)
    return () => ipcRenderer.removeListener('plugin-host-crash-loop', handler)
  },
  /** Otra instancia de JasWave tiene el motor de audio (o lo acaba de liberar). */
  onAudioEngineBusy: (callback: (info?: { activo?: boolean; mensaje?: string }) => void) => {
    const handler = (_: unknown, info: { activo?: boolean; mensaje?: string }) => callback(info)
    ipcRenderer.on('audio-engine-busy', handler)
    return () => ipcRenderer.removeListener('audio-engine-busy', handler)
  },
  /** «Usar audio aquí»: trae el motor de audio de la otra instancia a esta. */
  audioEngineTake: (): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke('audio-engine-take'),
  /** Cede el motor (tras parar el transporte) cuando otra instancia lo pide. */
  audioEngineRelease: (): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke('audio-engine-release'),
  onAudioEngineReleaseRequested: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('audio-engine-release-requested', handler)
    return () => ipcRenderer.removeListener('audio-engine-release-requested', handler)
  },
  onPluginHostExited: (callback: (info?: { code?: number | null; signal?: string | null }) => void) => {
    const handler = (_: unknown, info: { code?: number | null; signal?: string | null }) => callback(info)
    ipcRenderer.on('plugin-host-exited', handler)
    return () => ipcRenderer.removeListener('plugin-host-exited', handler)
  },
  // U6: el host nativo avisa de reinicios y pérdidas del dispositivo de audio.
  onAudioDeviceNotice: (callback: (notice: 'reset' | 'lost') => void) => {
    const handler = (_: unknown, info: { notice?: 'reset' | 'lost' }) => {
      if (info?.notice) callback(info.notice)
    }
    ipcRenderer.on('jaswave-audio-device-notice', handler)
    return () => ipcRenderer.removeListener('jaswave-audio-device-notice', handler)
  },
  pluginHostPushPcm: (samples: Float32Array | ArrayBuffer | Uint8Array) => {
    // Siempre Uint8Array: ArrayBuffer puro a veces no sobrevive el clone IPC de Electron.
    let u8: Uint8Array
    if (samples instanceof Uint8Array && samples.byteOffset === 0 && samples.byteLength === samples.buffer.byteLength) {
      u8 = samples
    } else if (samples instanceof ArrayBuffer) {
      u8 = new Uint8Array(samples.slice(0))
    } else if (ArrayBuffer.isView(samples)) {
      u8 = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength).slice()
    } else {
      return
    }
    ipcRenderer.send('plugin-host-pcm', u8)
  },
  pluginHostStop: () => ipcRenderer.invoke('plugin-host-stop'),
  onAgentBridgeRequest: (
    callback: (msg: { id: string; channel: string; payload: Record<string, unknown> }) => void,
  ) => {
    const handler = (
      _event: unknown,
      msg: { id: string; channel: string; payload: Record<string, unknown> },
    ) => callback(msg)
    ipcRenderer.on('agent-bridge-request', handler)
    return () => ipcRenderer.removeListener('agent-bridge-request', handler)
  },
  agentBridgeReply: (id: string, result: unknown, error?: string) => {
    ipcRenderer.send('agent-bridge-reply', id, result, error)
  },
  onHostTransportToggle: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('host-transport-toggle', handler)
    return () => ipcRenderer.removeListener('host-transport-toggle', handler)
  },
  onNativeMidi: (callback: (msg: { id: string; data: number[]; tNs?: number }) => void) => {
    const handler = (_event: unknown, msg: { id: string; data: number[]; tNs?: number }) => callback(msg)
    ipcRenderer.on('native-midi', handler)
    return () => ipcRenderer.removeListener('native-midi', handler)
  },
})
