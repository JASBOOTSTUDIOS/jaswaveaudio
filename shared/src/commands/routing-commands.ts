/**
 * Comandos bus.* / send.* — routing de envíos (estado; DSP host en evolución).
 */

import type { CommandDefinition, StateTransition } from '../types/command'
import type { DAWState } from '../types/state'
import type { Bus, Envio, RoutingMatrix, Sidechain } from '../types/routing'
import type { EventoDominio } from '../events/evento-dominio'

function ev(nombre: string, payload: Record<string, unknown>): EventoDominio {
  return {
    nombre,
    version: 1,
    marcaTiempo: Date.now(),
    fuente: 'builtin',
    payload: payload as EventoDominio['payload'],
  }
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function ensureRouting(estado: DAWState): RoutingMatrix {
  if (estado.project.routing) return estado.project.routing
  return {
    buses: [],
    sends: [],
    rutas: [],
    sidechains: [],
    inserts: [],
    conexionesDirectas: [],
    puentes: [],
    grupos: [],
    validacion: { errores: [], validado: true, ultimaValidacion: Date.now() },
    estadisticas: {
      busesTotales: 0,
      enviosTotales: 0,
      rutasTotales: 0,
      sidechainsTotales: 0,
      insertsTotales: 0,
      conexionesDirectasTotales: 0,
      buclesDetectados: 0,
      latenciaPromedio: 0,
      gananciaPromedio: 0,
      usoCPU: 0,
      usoMemoriaMB: 0,
    },
    historial: { cambios: [], maximoCambios: 100 },
    ordenTracks: [],
    ordenBuses: [],
    etiquetas: [],
  }
}

export function crearComandoBusCreate(): CommandDefinition<any> {
  return {
    type: 'bus.create',
    description: 'Crea un bus/aux FX en la matriz de routing (+ pista tipo bus)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        tipo: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload): StateTransition<{ busId: string }> => {
      const routing = ensureRouting(estado)
      const busId = newId('bus')
      const nombre = String(payload.nombre ?? `Bus ${routing.buses.length + 1}`)
      const bus: Bus = {
        id: busId,
        nombre,
        tipo: (payload.tipo as Bus['tipo']) || 'fx',
        volumen: 0.8,
        paneo: 0,
        muted: false,
        solo: false,
        plugins: [],
        automatizaciones: [],
        envios: [],
        color: '#818cf8',
        armado: false,
        frozen: false,
        tags: [],
        orden: routing.buses.length,
        fase: 0,
        delay: 0,
        latencia: 0,
        soloSeguro: true,
        muteSeguro: true,
        nivelPico: 0,
        nivelRMS: 0,
        reduccionGanancia: 0,
      }
      const buses = [...routing.buses, bus]
      const now = Date.now()
      const busTrack = {
        id: busId,
        nombre,
        nombreOriginal: nombre,
        color: '#818cf8',
        tipo: 'bus' as const,
        rol: 'bus' as const,
        estado: 'activo' as const,
        volumen: 0.8,
        volumenOriginal: -12,
        paneo: 0,
        paneoOriginal: 0,
        silenciada: false,
        soloActiva: false,
        armada: false,
        frozen: false,
        soloSeguro: false,
        muteSeguro: false,
        orden: estado.project.tracks.length,
        profundidad: 0,
        hijos: [],
        clips: [],
        plugins: [],
        automatizaciones: [],
        envios: [],
        receives: [],
        fades: [],
        marcadores: [],
        medios: [],
        tags: [],
        notas: '',
        modificado: false,
        fechaCreacion: now,
        fechaModificacion: now,
        estadisticas: {
          clipsTotales: 0,
          clipsAudio: 0,
          clipsMidi: 0,
          duracionTotal: 0,
          duracionUtil: 0,
          pluginsTotales: 0,
          automatizacionesTotales: 0,
          puntosAutomatizacion: 0,
          enviosTotales: 0,
          receivesTotales: 0,
          fadesTotales: 0,
          marcadoresTotales: 0,
          mediosTotales: 0,
          eventosTotales: 0,
        },
        configuracion: {
          cuantizacion: 0,
          delayCompensacion: 0,
          retardoSincronizacion: 0,
          filtroEntrada: false,
          filtroSalida: false,
          monitorizarEntrada: false,
          grabacionAutomática: false,
          sobrescrituraAutomatica: false,
          cuantizarGrabacion: false,
          loop: false,
          punchIn: 0,
          punchOut: 0,
          metronomo: false,
          click: false,
          preRoll: false,
          postRoll: false,
        },
        colorDefecto: '#818cf8',
        visible: true,
        bloqueada: false,
        seleccionada: false,
        enRuta: true,
        enSidechain: false,
        enLoop: false,
        enEscena: false,
        controladoresVinculados: [],
        superficiesVinculadas: [],
        metadatos: {},
        tracksEnviando: [],
        formato: 'stereo' as const,
        canales: 2,
        gainStaging: 0,
        headroom: 0,
        phase: 0,
        stereoCorrelation: 0,
        lufs: 0,
        rangoDinamico: 0,
        clipping: false,
        xruns: 0,
        ultimoXrun: 0,
      }
      return {
        state: {
          ...estado,
          project: {
            ...estado.project,
            tracks: [...estado.project.tracks, busTrack as never],
            routing: {
              ...routing,
              buses,
              ordenBuses: [...routing.ordenBuses, busId],
              estadisticas: { ...routing.estadisticas, busesTotales: buses.length },
            },
            modificado: true,
            fechaModificacion: now,
          },
        },
        events: [ev('routing.busCreated', { busId, nombre })],
        result: { busId },
      }
    },
  }
}

export function crearComandoSendSet(): CommandDefinition<any> {
  return {
    type: 'send.set',
    description: 'Crea o actualiza un envío pista→bus',
    risk: 'write',
    schema: {
      type: 'object',
      required: ['trackId', 'busId'],
      properties: {
        trackId: { type: 'string' },
        busId: { type: 'string' },
        amount: { type: 'number' },
        preFader: { type: 'boolean' },
        activo: { type: 'boolean' },
        nombre: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload): StateTransition<{ sendId: string }> => {
      const routing = ensureRouting(estado)
      const trackId = String(payload.trackId)
      const busId = String(payload.busId)
      if (!routing.buses.some((b) => b.id === busId)) {
        throw new Error(`Bus no encontrado: ${busId}`)
      }
      if (!estado.project.tracks.some((t) => t.id === trackId)) {
        throw new Error(`Pista no encontrada: ${trackId}`)
      }
      const amount = Math.max(0, Math.min(1, Number(payload.amount ?? 0.35)))
      const sends = [...routing.sends]
      const idx = sends.findIndex((e) => e.origenTrackId === trackId && e.destinoBusId === busId)
      let send: Envio
      if (idx >= 0) {
        send = {
          ...sends[idx]!,
          cantidad: amount,
          preFader: payload.preFader === true,
          activo: payload.activo !== false,
          nombre: payload.nombre ? String(payload.nombre) : sends[idx]!.nombre,
        }
        sends[idx] = send
      } else {
        send = {
          id: newId('send'),
          origenTrackId: trackId,
          destinoBusId: busId,
          cantidad: amount,
          pan: 0,
          activo: payload.activo !== false,
          preFader: payload.preFader === true,
          solo: false,
          tipo: 'envio',
          nombre: payload.nombre ? String(payload.nombre) : undefined,
          tags: [],
          orden: sends.length,
        }
        sends.push(send)
      }
      return {
        state: {
          ...estado,
          project: {
            ...estado.project,
            routing: {
              ...routing,
              sends,
              estadisticas: { ...routing.estadisticas, enviosTotales: sends.length },
            },
          },
        },
        events: [ev('routing.sendSet', { sendId: send.id, trackId, busId, amount })],
        result: { sendId: send.id },
      }
    },
  }
}

export function crearComandoSidechainConnect(): CommandDefinition<any> {
  return {
    type: 'sidechain.connect',
    description: 'Conecta sidechain origen→destino (estado; host según plugin)',
    risk: 'write',
    schema: {
      type: 'object',
      required: ['origenTrackId', 'destinoTrackId'],
      properties: {
        origenTrackId: { type: 'string' },
        destinoTrackId: { type: 'string' },
        cantidad: { type: 'number' },
        activo: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload): StateTransition<{ sidechainId: string }> => {
      const routing = ensureRouting(estado)
      const sc: Sidechain = {
        id: newId('sc'),
        origenTrackId: String(payload.origenTrackId),
        destinoTrackId: String(payload.destinoTrackId),
        activo: payload.activo !== false,
        cantidad: Math.max(0, Math.min(1, Number(payload.cantidad ?? 1))),
        fuente: 'interna',
        tags: [],
        orden: routing.sidechains.length,
      }
      const sidechains = [
        ...routing.sidechains.filter(
          (s) => !(s.origenTrackId === sc.origenTrackId && s.destinoTrackId === sc.destinoTrackId),
        ),
        sc,
      ]
      return {
        state: {
          ...estado,
          project: {
            ...estado.project,
            routing: {
              ...routing,
              sidechains,
              estadisticas: { ...routing.estadisticas, sidechainsTotales: sidechains.length },
            },
          },
        },
        events: [ev('routing.sidechainConnected', { sidechainId: sc.id })],
        result: { sidechainId: sc.id },
      }
    },
  }
}
