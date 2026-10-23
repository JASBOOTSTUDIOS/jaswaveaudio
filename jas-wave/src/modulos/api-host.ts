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
