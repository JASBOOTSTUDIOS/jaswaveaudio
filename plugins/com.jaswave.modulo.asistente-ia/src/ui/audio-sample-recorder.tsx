import { useState, useRef, useEffect } from 'react'
import {
  Mic,
  Square,
  Upload,
  Play,
  Pause,
  X,
  Drum,
  Search,
  PlusCircle,
  FileAudio,
  Loader2,
  Sparkles,
  Music,
  Trash2,
  Check,
  ChevronDown,
} from 'lucide-react'
import { useDAW } from '@jaswave/host-sdk'

export interface AttachedAudioSample {
  id: string
  name: string
  durationSec: number
  sampleRate: number
  pcmSamples: number[]
  waveform: number[]
  blobUrl: string
}

export interface AudioSampleRecorderProps {
  attachedSample: AttachedAudioSample | null
  onSampleAttached: (sample: AttachedAudioSample | null) => void
  onInsertPromptText?: (text: string) => void
  disabled?: boolean
}

export function AudioSampleRecorder({
  attachedSample,
  onSampleAttached,
  onInsertPromptText,
  disabled = false,
}: AudioSampleRecorderProps) {
  const dawStore = useDAW()
  const [isRecording, setIsRecording] = useState(false)
  const [recordDuration, setRecordDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  // Opciones de conversión a melodía
  const [isMelodyConfigOpen, setIsMelodyConfigOpen] = useState(false)
  const [melodyInstrument, setMelodyInstrument] = useState<'guitar' | 'piano' | 'bass' | 'lead' | 'strings'>('guitar')
  const [melodyQuantize, setMelodyQuantize] = useState<'1/16' | '1/8' | '1/4' | 'off'>('1/16')

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioPlaybackRef = useRef<HTMLAudioElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showNotice = (msg: string) => {
    setActionNotice(msg)
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = setTimeout(() => {
      setActionNotice(null)
      noticeTimerRef.current = null
    }, 4000)
  }

  // Detener audio al desmontar
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
      if (audioPlaybackRef.current) {
        audioPlaybackRef.current.pause()
        audioPlaybackRef.current = null
      }
    }
  }, [])

  // Decodificar un Blob de audio a AttachedAudioSample
  const processAudioBlob = async (blob: Blob, name: string) => {
    setIsProcessing(true)
    try {
      const arrayBuffer = await blob.arrayBuffer()
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const decoded = await audioCtx.decodeAudioData(arrayBuffer)
      
      const channelData = decoded.getChannelData(0)
      const durationSec = decoded.duration
      const sampleRate = decoded.sampleRate

      // Extraer waveform para dibujar (64 barras)
      const waveformBins = 64
      const blockSize = Math.max(1, Math.floor(channelData.length / waveformBins))
      const waveform: number[] = []
      for (let i = 0; i < waveformBins; i++) {
        let max = 0
        const start = i * blockSize
        const end = Math.min(start + blockSize, channelData.length)
        for (let j = start; j < end; j++) {
          const abs = Math.abs(channelData[j] ?? 0)
          if (abs > max) max = abs
        }
        waveform.push(Math.min(1, Math.max(0.05, max)))
      }

      // Representación downsampleada para análisis rápido
      const maxSamples = 88200
      let pcmSamples: number[] = []
      if (channelData.length <= maxSamples) {
        pcmSamples = Array.from(channelData)
      } else {
        const step = channelData.length / maxSamples
        pcmSamples = new Array(maxSamples)
        for (let i = 0; i < maxSamples; i++) {
          pcmSamples[i] = channelData[Math.floor(i * step)] ?? 0
        }
      }

      const blobUrl = URL.createObjectURL(blob)
      const sample: AttachedAudioSample = {
        id: `sample-${Date.now()}`,
        name,
        durationSec,
        sampleRate,
        pcmSamples,
        waveform,
        blobUrl,
      }

      onSampleAttached(sample)
      setIsMenuOpen(false)
      showNotice(`Nota de voz lista: ${name} (${durationSec.toFixed(1)}s)`)
      await audioCtx.close()
    } catch (err) {
      console.error('[audio-sample-recorder] error decodificando audio:', err)
      showNotice('Error al procesar el archivo de audio')
    } finally {
      setIsProcessing(false)
    }
  }

  // Grabar desde micrófono estilo WhatsApp
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunksRef.current = []
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg'
      const mediaRecorder = new MediaRecorder(stream, { mimeType })

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        const tracks = stream.getTracks()
        tracks.forEach((t) => t.stop())
        if (audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
          await processAudioBlob(audioBlob, `Nota_Voz_${new Date().toLocaleTimeString().replace(/:/g, '-')}`)
        }
      }

      mediaRecorderRef.current = mediaRecorder
      mediaRecorder.start(100)
      setIsRecording(true)
      setRecordDuration(0)

      recordTimerRef.current = setInterval(() => {
        setRecordDuration((prev) => prev + 1)
      }, 1000)
    } catch (err) {
      console.error('[audio-sample-recorder] no se pudo acceder al micrófono:', err)
      showNotice('No se pudo acceder al micrófono. Revisa los permisos.')
    }
  }

  const stopAndSaveRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current)
        recordTimerRef.current = null
      }
    }
  }

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      audioChunksRef.current = []
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current)
        recordTimerRef.current = null
      }
      showNotice('Grabación cancelada')
    }
  }

  // Drag and Drop de archivos de audio
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('audio/')) {
      await processAudioBlob(file, file.name)
    }
  }

  // Carga de archivo manual
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await processAudioBlob(file, file.name)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Preescucha Play / Pause
  const togglePlay = () => {
    if (!attachedSample) return

    if (isPlaying) {
      if (audioPlaybackRef.current) {
        audioPlaybackRef.current.pause()
      }
      setIsPlaying(false)
    } else {
      if (!audioPlaybackRef.current) {
        audioPlaybackRef.current = new Audio(attachedSample.blobUrl)
        audioPlaybackRef.current.onended = () => setIsPlaying(false)
      } else {
        audioPlaybackRef.current.src = attachedSample.blobUrl
      }
      void audioPlaybackRef.current.play().catch(() => setIsPlaying(false))
      setIsPlaying(true)
    }
  }

  // ACCIÓN 1: Convertir a Melodía MIDI (Pitch Tracking f0 con escala y enrutamiento inteligente)
  const handleConvertToMelody = async () => {
    if (!attachedSample || !dawStore) return
    setIsProcessing(true)
    try {
      const estado = dawStore.obtenerEstado()
      const bpm = estado.project.bpm?.valor || 120
      const selectedTrackId = estado.selection?.idsPistas?.[0]
      const selectedTrack = (estado.project.tracks ?? []).find((t: any) => t.id === selectedTrackId)
      const canUseSelected = selectedTrack && (selectedTrack.tipo === 'instrumento' || selectedTrack.tipo === 'midi')

      const nombresInst: Record<string, string> = {
        guitar: 'Guitarra Eléctrica (Melodía IA)',
        piano: 'JasWave Grand Piano (IA)',
        bass: 'JasWave Electric Bass (IA)',
        lead: 'Sintetizador Lead (IA)',
        strings: 'JasWave Strings Section (IA)',
      }

      const res = await dawStore.executor.execute(
        'analysis.voiceToMelody',
        {
          audioData: attachedSample.pcmSamples,
          sampleRate: attachedSample.sampleRate,
          bpm,
          cuantizar: melodyQuantize,
          instrumento: melodyInstrument,
          crearPista: !canUseSelected,
          trackId: canUseSelected ? selectedTrackId : undefined,
          nombrePista: `${nombresInst[melodyInstrument]} (${attachedSample.name})`,
        },
        'user'
      )

      if (res && res.result) {
        const { totalNotas, metricas } = res.result as {
          totalNotas: number
          metricas: { rangoPitches: { min: number; max: number }; afinacionPromedioCents: number }
        }
        showNotice(`🎸 Melodía creada: ${totalNotas} notas (pitch ${metricas.rangoPitches.min}..${metricas.rangoPitches.max}) en el DAW`)
        if (onInsertPromptText) {
          onInsertPromptText(
            `He convertido la melodía de "${attachedSample.name}" a ${nombresInst[melodyInstrument]} con ${totalNotas} notas afinadas y cuantizadas a ${melodyQuantize}.`
          )
        }
      }
    } catch (err) {
      console.error('[audio-sample-recorder] error en voiceToMelody:', err)
      showNotice('No se pudo convertir a melodía: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setIsProcessing(false)
      setIsMelodyConfigOpen(false)
    }
  }

  // ACCIÓN 2: Convertir a Batería MIDI en el DAW con un solo clic
  const handleConvertToDrums = async () => {
    if (!attachedSample || !dawStore) return
    setIsProcessing(true)
    try {
      const estado = dawStore.obtenerEstado()
      const bpm = estado.project.bpm?.valor || 120

      const res = await dawStore.executor.execute(
        'analysis.voiceToDrums',
        {
          audioData: attachedSample.pcmSamples,
          sampleRate: attachedSample.sampleRate,
          bpm,
          cuantizar: '1/16',
          sensibilidad: 1.0,
          crearPista: true,
          nombrePista: `Batería (${attachedSample.name})`,
        },
        'user'
      )

      if (res && res.result) {
        const { conteo } = res.result as { conteo: { kicks: number; snares: number; hihats: number } }
        showNotice(`🥁 Batería creada en el DAW: ${conteo.kicks} kicks, ${conteo.snares} snares, ${conteo.hihats} hihats`)
        if (onInsertPromptText) {
          onInsertPromptText(`He convertido el beatbox "${attachedSample.name}" a batería MIDI con ${conteo.kicks} kicks, ${conteo.snares} snares y ${conteo.hihats} charles adaptados a ${bpm} BPM.`)
        }
      }
    } catch (err) {
      console.error('[audio-sample-recorder] error en voiceToDrums:', err)
      showNotice('No se pudo convertir a batería: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setIsProcessing(false)
    }
  }

  // ACCIÓN 3: Analizar con AudioLens (tonalidad, acordes, BPM)
  const handleAnalyzeAudioLens = async () => {
    if (!attachedSample || !dawStore) return
    setIsProcessing(true)
    try {
      const estado = dawStore.obtenerEstado()
      const bpm = estado.project.bpm?.valor || 120

      const res = await dawStore.executor.execute(
        'analysis.audioLens',
        {
          audioData: attachedSample.pcmSamples,
          sampleRate: attachedSample.sampleRate,
          bpm,
          cuantizar: '1/16',
          sensibilidad: 1.0,
        },
        'user'
      )

      if (res && res.result) {
        const r = res.result as {
          tonalidad: { estimacion: string; confianza: number }
          tempoDetectado: { bpmEstimado: number; regularidad: number }
          descripcionMusical: string
          acordesSugeridos: string[]
        }
        showNotice(`🔍 AudioLens: Tono ${r.tonalidad.estimacion} | BPM ${r.tempoDetectado.bpmEstimado} | ${r.acordesSugeridos.join(' - ')}`)
        if (onInsertPromptText) {
          onInsertPromptText(
            `[AudioLens de "${attachedSample.name}"]: Tonalidad ${r.tonalidad.estimacion} (confianza ${(r.tonalidad.confianza * 100).toFixed(0)}%), Tempo estimado ${r.tempoDetectado.bpmEstimado} BPM. Acordes: ${r.acordesSugeridos.join(', ')}. ${r.descripcionMusical}`
          )
        }
      }
    } catch (err) {
      console.error('[audio-sample-recorder] error en audioLens:', err)
      showNotice('Error al analizar audio: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setIsProcessing(false)
    }
  }

  // ACCIÓN 4: Insertar como Clip de Audio en una pista del proyecto
  const handleInsertClipInDAW = async () => {
    if (!attachedSample || !dawStore) return
    setIsProcessing(true)
    try {
      const estado = dawStore.obtenerEstado()
      const bpm = estado.project.bpm?.valor || 120
      const duracionBeats = Math.max(1, Math.round((attachedSample.durationSec / (60 / bpm)) * 4) / 4)

      let pistaAudio = (estado.project.tracks ?? []).find((t: any) => t.tipo === 'audio')
      let pistaId = pistaAudio?.id

      if (!pistaId) {
        const nuevaPista: any = await dawStore.executor.execute(
          'track.create',
          { nombre: 'Audio Grabado', tipo: 'audio' },
          'user'
        )
        pistaId = nuevaPista?.result?.id ?? nuevaPista?.state?.project?.tracks?.slice(-1)[0]?.id
      }

      if (pistaId) {
        await dawStore.executor.execute(
          'clip.create',
          {
            pistaId,
            nombre: attachedSample.name,
            inicio: 0,
            duracion: duracionBeats,
            waveform: attachedSample.waveform,
          },
          'user'
        )
        showNotice(`🎵 Clip insertado en el DAW (${duracionBeats} beats)`)
      }
    } catch (err) {
      console.error('[audio-sample-recorder] error insertando clip:', err)
      showNotice('No se pudo insertar el clip: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setIsProcessing(false)
    }
  }

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex flex-col gap-1.5 transition-all ${
        isDragOver ? 'ring-2 ring-accent-amber rounded-lg bg-accent-amber/5' : ''
      }`}
    >
      {/* Notificación flotante de feedback */}
      {actionNotice && (
        <div className="text-[11px] font-medium text-accent-amber animate-fadeIn flex items-center gap-1.5 px-2 py-0.5 rounded bg-accent-amber/10 border border-accent-amber/30">
          <Sparkles className="size-3 shrink-0" />
          <span className="truncate">{actionNotice}</span>
        </div>
      )}

      {/* Si hay muestra cargada, mostramos la tarjeta interactiva con preescucha y acciones rápidas */}
      {attachedSample && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/80 bg-panel-raised/95 p-2 text-xs shadow-sm">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-amber text-panel-header hover:brightness-110"
              title={isPlaying ? 'Pausar preescucha' : 'Escuchar audio'}
            >
              {isPlaying ? <Pause className="size-3 fill-current" /> : <Play className="size-3 fill-current ml-0.5" />}
            </button>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-1.5">
                <FileAudio className="size-3.5 text-accent-amber shrink-0" />
                <span className="truncate font-semibold text-foreground text-[12px]" title={attachedSample.name}>
                  {attachedSample.name}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {attachedSample.durationSec.toFixed(1)}s
                </span>
              </div>

              {/* Dibujo de forma de onda */}
              <div className="flex h-3 items-end gap-px pt-0.5 opacity-75">
                {attachedSample.waveform.map((val, idx) => (
                  <div
                    key={idx}
                    className="w-0.5 rounded-t bg-accent-amber"
                    style={{ height: `${Math.max(15, Math.round(val * 100))}%` }}
                  />
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                if (audioPlaybackRef.current) audioPlaybackRef.current.pause()
                setIsPlaying(false)
                onSampleAttached(null)
              }}
              className="shrink-0 text-muted-foreground hover:text-foreground p-1"
              title="Quitar muestra"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Opciones configurables para conversión melódica */}
          {isMelodyConfigOpen && (
            <div className="p-2 rounded bg-panel-border/30 border border-border flex flex-col gap-2 animate-fadeIn text-[11px]">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-accent-amber">Ajustes Voice-to-Melody</span>
                <button
                  type="button"
                  onClick={() => setIsMelodyConfigOpen(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground">Instrumento:</span>
                  <select
                    value={melodyInstrument}
                    onChange={(e) => setMelodyInstrument(e.target.value as any)}
                    className="bg-panel-raised border border-border rounded px-1.5 py-0.5 text-foreground text-xs"
                  >
                    <option value="guitar">🎸 Guitarra Eléctrica</option>
                    <option value="piano">🎹 JasWave Grand Piano</option>
                    <option value="bass">🎸 JasWave Electric Bass</option>
                    <option value="lead">🎛️ Sintetizador Lead</option>
                    <option value="strings">🎻 Strings Section</option>
                  </select>
                </label>

                <label className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground">Cuantización:</span>
                  <select
                    value={melodyQuantize}
                    onChange={(e) => setMelodyQuantize(e.target.value as any)}
                    className="bg-panel-raised border border-border rounded px-1.5 py-0.5 text-foreground text-xs"
                  >
                    <option value="1/16">1/16 (Recomendado)</option>
                    <option value="1/8">1/8 (Corcheas)</option>
                    <option value="1/4">1/4 (Negras)</option>
                    <option value="off">Sin cuantizar (Libre)</option>
                  </select>
                </label>
              </div>

              <button
                type="button"
                disabled={isProcessing}
                onClick={handleConvertToMelody}
                className="mt-1 flex items-center justify-center gap-1 rounded bg-accent-amber px-2 py-1 text-panel-header font-semibold hover:brightness-110 transition-colors"
              >
                <Check className="size-3" />
                <span>Generar Clip Melódico en el Timeline</span>
              </button>
            </div>
          )}

          {/* Botones de acción rápida con el audio cargado */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/50">
            <div className="flex items-center">
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleConvertToMelody}
                title="Convertir tarareo o voz a notas MIDI de guitarra/piano/bajo"
                className="flex items-center gap-1 rounded-l bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 px-2 py-0.5 text-[11px] font-medium border border-r-0 border-emerald-500/30 transition-colors disabled:opacity-50"
              >
                <Music className="size-3" />
                <span>A Melodía</span>
              </button>
              <button
                type="button"
                onClick={() => setIsMelodyConfigOpen(!isMelodyConfigOpen)}
                title="Ajustar instrumento y cuantización de melodía"
                className="flex items-center rounded-r bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 px-1 py-0.5 text-[11px] border border-emerald-500/30"
              >
                <ChevronDown className="size-3" />
              </button>
            </div>

            <button
              type="button"
              disabled={isProcessing}
              onClick={handleConvertToDrums}
              title="Transformar este audio o beatbox en notas MIDI de batería alineadas al tempo"
              className="flex items-center gap-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 px-2 py-0.5 text-[11px] font-medium border border-amber-500/30 transition-colors disabled:opacity-50"
            >
              <Drum className="size-3" />
              <span>A Batería</span>
            </button>

            <button
              type="button"
              disabled={isProcessing}
              onClick={handleAnalyzeAudioLens}
              title="Extraer tonalidad, progresión de acordes y tempo con AudioLens"
              className="flex items-center gap-1 rounded bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 px-2 py-0.5 text-[11px] font-medium border border-blue-500/30 transition-colors disabled:opacity-50"
            >
              <Search className="size-3" />
              <span>AudioLens</span>
            </button>

            <button
              type="button"
              disabled={isProcessing}
              onClick={handleInsertClipInDAW}
              title="Insertar este audio directamente como un clip en una pista del DAW"
              className="flex items-center gap-1 rounded bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 px-2 py-0.5 text-[11px] font-medium border border-indigo-500/30 transition-colors disabled:opacity-50"
            >
              <PlusCircle className="size-3" />
              <span>Clip Audio</span>
            </button>

            {isProcessing && <Loader2 className="size-3.5 animate-spin text-accent-amber ml-auto" />}
          </div>
        </div>
      )}

      {/* Grabadora Activa Estilo WhatsApp en tiempo real */}
      {isRecording && (
        <div className="flex items-center gap-2.5 rounded-lg bg-panel-raised p-2 text-xs border border-rose-500/40 shadow-lg animate-fadeIn">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500" />
            </span>
            <span className="font-mono font-semibold text-rose-400">
              {formatTimer(recordDuration)}
            </span>
          </div>

          {/* Ondas sonoras visuales simuladas */}
          <div className="flex items-center gap-1 flex-1 px-2 h-4">
            {Array.from({ length: 16 }).map((_, i) => (
              <div
                key={i}
                className="w-1 rounded-full bg-rose-500/60 animate-pulse"
                style={{
                  height: `${Math.max(20, Math.sin((recordDuration * 4 + i) * 0.8) * 50 + 50)}%`,
                  animationDuration: `${400 + (i % 4) * 150}ms`,
                }}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={cancelRecording}
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-rose-500/20 hover:text-rose-400 transition-colors"
            title="Descartar nota de voz"
          >
            <Trash2 className="size-4" />
          </button>

          <button
            type="button"
            onClick={stopAndSaveRecording}
            className="flex items-center gap-1 rounded bg-rose-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-600 transition-colors shadow-sm"
            title="Listo / Adjuntar nota de voz"
          >
            <Square className="size-3 fill-current" />
            <span>Listo</span>
          </button>
        </div>
      )}

      {/* Menú de opciones de micrófono / subir archivo si no está grabando ni tiene muestra */}
      {isMenuOpen && !attachedSample && !isRecording && (
        <div className="flex items-center gap-2 rounded-md bg-panel-raised p-2 text-xs border border-border shadow-md animate-fadeIn">
          <button
            type="button"
            disabled={isProcessing}
            onClick={startRecording}
            className="flex items-center gap-1.5 rounded bg-panel-hover px-2.5 py-1.5 text-foreground hover:bg-panel-border transition-colors font-medium"
          >
            <Mic className="size-3.5 text-rose-400" />
            <span>Grabar nota de voz (WhatsApp)</span>
          </button>

          <button
            type="button"
            disabled={isProcessing}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded bg-panel-hover px-2.5 py-1.5 text-foreground hover:bg-panel-border transition-colors font-medium"
          >
            <Upload className="size-3.5 text-accent-amber" />
            <span>Subir audio</span>
          </button>

          <button
            type="button"
            onClick={() => setIsMenuOpen(false)}
            className="ml-auto text-muted-foreground hover:text-foreground p-1"
            title="Cerrar"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Input oculto para subida de archivo */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.wav,.mp3,.ogg,.m4a,.flac"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Botón flotante inline para activar nota de voz o subir audio si no está grabando */}
      {!attachedSample && !isRecording && !isMenuOpen && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={startRecording}
            disabled={disabled}
            title="Grabar nota de voz tipo WhatsApp para que la IA la analice o la pase a MIDI"
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-rose-500/15 hover:text-rose-400 transition-colors"
          >
            <Mic className="size-4" />
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            title="Subir o arrastrar archivo de audio"
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-panel-hover hover:text-foreground transition-colors"
          >
            <FileAudio className="size-4" />
          </button>
        </div>
      )}
    </div>
  )
}
