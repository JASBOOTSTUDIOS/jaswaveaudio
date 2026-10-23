/**
 * API pública del DAW para módulos (M3). Es lo único del host que un módulo puede usar: se publica en el
 * runtime (`__JASWAVE_SDK__.api`) y sus tipos se generan en @jaswave/host-sdk (`npm run sdk:generar`).
 * Añadir aquí = ampliar el contrato; quitar o cambiar una firma = romper módulos (subir VERSION_SDK).
 */

// Estado del proyecto y comandos (todo cambio pasa por tienda.executor.execute → deshacer y auditoría)
export { useDAW, useDAWState, getSharedStore } from '../context/daw-context'
export { getSelectedTrackId } from '../lib/selection-helpers'

// Documentos del proyecto (docs/*.md)
export { getAgentDoc, subscribeAgentDocs, writeAgentDoc } from '../lib/agent-docs'

// Clip MIDI ↔ Markdown
export { midiClipDocSlug, parseMidiClipMd, serializeMidiClipMd } from '../lib/midi-clip-markdown'

// Workspace
export { requestOpenTool } from '../workspace/types'

// Consultas puras sobre el estado (sin efectos)
export { findMidiClip } from '../../../shared/src/midi/query'

// Tipos del dominio
export type { DAWState } from '../../../shared/src/types/state'
export type { TiendaDAW } from '../../../shared/src/state/tienda'

// Añadido al extraer com.jaswave.modulo.partitura
export { getUndockUrlFocus } from '../../lib/undock-window'
export { useDAWOptional } from '../context/daw-context'
export { saveBinaryOrThrow } from '../lib/electron-fs'
export { listMidiClips, resolvePianoRollClip } from '../lib/selection-helpers'
export { shouldIgnoreGlobalShortcuts } from '../../../shared/src/index'
export type { MidiClip, MidiNote } from '../../../shared/src/index'
export { getProjectKey, getProjectKeyRegions } from '../../../shared/src/music/project-key'

// Archivos (diálogos y disco a través del DAW; en la web, descarga)
export { archivosDeEscritorio, descargarArchivo, elegirCarpeta, elegirRutaGuardar, guardarBinario, guardarTexto, leerTexto } from './api-archivos'
