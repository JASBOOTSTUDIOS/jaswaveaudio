// Generado por jas-wave/scripts/generar-sdk.mjs a partir de jas-wave/src/modulos/api-host.ts — no editar.
/* eslint-disable */
import type * as H from './../tipos-host/jas-wave/src/modulos/api-host'
import { api } from './runtime'

export const archivosDeEscritorio: typeof H.archivosDeEscritorio = api('archivosDeEscritorio')
export const descargarArchivo: typeof H.descargarArchivo = api('descargarArchivo')
export const elegirCarpeta: typeof H.elegirCarpeta = api('elegirCarpeta')
export const elegirRutaGuardar: typeof H.elegirRutaGuardar = api('elegirRutaGuardar')
export const findMidiClip: typeof H.findMidiClip = api('findMidiClip')
export const getAgentDoc: typeof H.getAgentDoc = api('getAgentDoc')
export const getProjectKey: typeof H.getProjectKey = api('getProjectKey')
export const getProjectKeyRegions: typeof H.getProjectKeyRegions = api('getProjectKeyRegions')
export const getSelectedTrackId: typeof H.getSelectedTrackId = api('getSelectedTrackId')
export const getSharedStore: typeof H.getSharedStore = api('getSharedStore')
export const getUndockUrlFocus: typeof H.getUndockUrlFocus = api('getUndockUrlFocus')
export const guardarBinario: typeof H.guardarBinario = api('guardarBinario')
export const guardarTexto: typeof H.guardarTexto = api('guardarTexto')
export const leerTexto: typeof H.leerTexto = api('leerTexto')
export const listMidiClips: typeof H.listMidiClips = api('listMidiClips')
export const midiClipDocSlug: typeof H.midiClipDocSlug = api('midiClipDocSlug')
export const parseMidiClipMd: typeof H.parseMidiClipMd = api('parseMidiClipMd')
export const requestOpenTool: typeof H.requestOpenTool = api('requestOpenTool')
export const resolvePianoRollClip: typeof H.resolvePianoRollClip = api('resolvePianoRollClip')
export const saveBinaryOrThrow: typeof H.saveBinaryOrThrow = api('saveBinaryOrThrow')
export const serializeMidiClipMd: typeof H.serializeMidiClipMd = api('serializeMidiClipMd')
export const shouldIgnoreGlobalShortcuts: typeof H.shouldIgnoreGlobalShortcuts = api('shouldIgnoreGlobalShortcuts')
export const subscribeAgentDocs: typeof H.subscribeAgentDocs = api('subscribeAgentDocs')
export const useDAW: typeof H.useDAW = api('useDAW')
export const useDAWOptional: typeof H.useDAWOptional = api('useDAWOptional')
export const useDAWState: typeof H.useDAWState = api('useDAWState')
export const writeAgentDoc: typeof H.writeAgentDoc = api('writeAgentDoc')

export type { DAWState, MidiClip, MidiNote, TiendaDAW } from './../tipos-host/jas-wave/src/modulos/api-host'
