/**
 * Paridad IA ↔ usuario en los plugins: todo lo que la IA puede hacer con un plugin tiene un control en la UI,
 * y la UI lo ejecuta por la MISMA acción (`executeDawActions`, origen `user_confirm`): mismo resultado,
 * misma política, misma auditoría y el mismo deshacer.
 *
 * `ACCIONES_PLUGIN_EN_UI` documenta dónde está cada una; un test exige que ninguna acción de plugins del
 * catálogo de la IA quede sin entrada aquí.
 */

import type { TiendaDAW } from '../../../../shared/src/state/tienda'
import type { ActionResult } from '../ai-daw-agent'

/** Acción de la IA → dónde la encuentra el usuario. */
export const ACCIONES_PLUGIN_EN_UI: Readonly<Record<string, string>> = {
  'plugin.insert': 'FX Chain › Insert (o Instrumentos › añadir a la pista)',
  'plugin.remove': 'FX Chain › Eliminar',
  'plugin.move': 'FX Chain › Subir / Bajar',
  'plugin.bypass': 'FX Chain › casilla de activación (bypass)',
  'plugin.duplicate': 'FX Chain › Duplicar',
  'plugin.replace': 'FX Chain › Reemplazar con el seleccionado',
  'plugin.setParameter': 'FX Chain › Controles › Parámetros (deslizador)',
  'plugin.getParameter': 'FX Chain › Controles › Parámetros (valor de cada parámetro)',
  'plugin.listParameters': 'FX Chain › Controles › Parámetros',
  'plugin.searchParameters': 'FX Chain › Controles › Parámetros › Buscar',
  'plugin.resetDefaults': 'FX Chain › Restablecer, y Controles › Restablecer todo / ↺ por parámetro',
  'plugin.snapshotState': 'FX Chain › Controles › Herramientas › Guardar estado en el proyecto',
  'plugin.probe': 'FX Chain › Controles › Herramientas › Probar carga en el motor',
  'plugin.lookup': 'FX Chain › Controles › Herramientas › Guía de uso',
  'track.getFxChain': 'FX Chain (la lista de la cadena)',
  'fxChain.copy': 'FX Chain › Copiar cadena',
  'fxChain.paste': 'FX Chain › Pegar cadena',
  'fxChain.loadPreset': 'FX Chain › Cargar preset de cadena',
  'fxChain.savePreset': 'FX Chain › Guardar global (cadena)',
  'library.preset.list': 'FX Chain › Controles › Presets',
  'library.preset.listGlobal': 'FX Chain › Controles › Presets (ámbito global)',
  'library.preset.search': 'FX Chain › Controles › Presets › Buscar',
  'library.preset.searchGlobal': 'FX Chain › Controles › Presets › Buscar (ámbito global)',
  'library.preset.save': 'FX Chain › Controles › Presets › Guardar en el proyecto',
  'library.preset.saveGlobal': 'FX Chain › Controles › Presets › Guardar global',
  'library.preset.promote': 'FX Chain › Controles › Presets › Hacer global',
  'library.preset.apply': 'FX Chain › Controles › Presets › Cargar en la pista',
  'library.preset.audition': 'FX Chain › Controles › Presets › Escuchar',
  'library.preset.saveFxChainGlobal': 'FX Chain › Guardar global (cadena)',
  'analysis.fxBlame': 'FX Chain › ¿Qué FX degrada el audio?',
}

/** Acciones del catálogo de la IA que son «de plugins» (las que deben estar en la UI). */
export function esAccionDePlugin(type: string): boolean {
  return (
    type.startsWith('plugin.') ||
    type.startsWith('fxChain.') ||
    type.startsWith('library.preset.') ||
    type === 'track.getFxChain' ||
    type === 'analysis.fxBlame'
  )
}

/** Ejecuta una acción de plugins como el usuario, por el mismo camino que la IA. */
export async function accionPluginUsuario(
  tienda: TiendaDAW,
  type: string,
  payload: Record<string, unknown>,
): Promise<ActionResult> {
  const { executeDawActions } = await import('../ai-daw-agent')
  const [r] = await executeDawActions(tienda, [{ type, payload }], {
    source: 'user_confirm',
    agentMode: 'create',
    forceApply: true,
  })
  return r ?? { type, success: false, message: 'La acción no devolvió resultado' }
}
