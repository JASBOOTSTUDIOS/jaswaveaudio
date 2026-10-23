// Generado por jas-wave/scripts/generar-sdk.mjs a partir de jas-wave/src/modulos/api-host.ts — no editar.
/* eslint-disable */
import type * as H from './../tipos-host/jas-wave/src/modulos/api-host'
import { api } from './runtime'

export const findMidiClip: typeof H.findMidiClip = api('findMidiClip')
export const getAgentDoc: typeof H.getAgentDoc = api('getAgentDoc')
export const getSelectedTrackId: typeof H.getSelectedTrackId = api('getSelectedTrackId')
export const getSharedStore: typeof H.getSharedStore = api('getSharedStore')
export const midiClipDocSlug: typeof H.midiClipDocSlug = api('midiClipDocSlug')
export const parseMidiClipMd: typeof H.parseMidiClipMd = api('parseMidiClipMd')
export const requestOpenTool: typeof H.requestOpenTool = api('requestOpenTool')
export const serializeMidiClipMd: typeof H.serializeMidiClipMd = api('serializeMidiClipMd')
export const subscribeAgentDocs: typeof H.subscribeAgentDocs = api('subscribeAgentDocs')
export const useDAW: typeof H.useDAW = api('useDAW')
export const useDAWState: typeof H.useDAWState = api('useDAWState')
export const writeAgentDoc: typeof H.writeAgentDoc = api('writeAgentDoc')

export type { DAWState, TiendaDAW } from './../tipos-host/jas-wave/src/modulos/api-host'
