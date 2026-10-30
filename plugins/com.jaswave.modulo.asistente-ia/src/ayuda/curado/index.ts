import type { FichaAyuda } from '@jaswave/host-sdk'
import { fichasConceptos } from './conceptos'
import { fichasDialogos } from './dialogos'
import { fichasPaneles } from './paneles'
import { fichasPlugins } from './plugins'

/**
 * Fichas curadas (editables a mano), escritas para quien nunca ha usado un DAW. Ganan a las generadas con el mismo id.
 * Cada archivo es una zona: paneles, diálogos, plugins y conceptos.
 */
export const FICHAS_CURADAS: readonly FichaAyuda[] = [...fichasPaneles, ...fichasDialogos, ...fichasPlugins, ...fichasConceptos]
