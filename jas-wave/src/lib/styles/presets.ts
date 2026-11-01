/**
 * Presets de estilo de EJEMPLO (opcionales). No se instalan solos: el usuario decide
 * añadirlos con styleInstallPreset(id) o aportar su propio JSON con el mismo formato.
 */

import worshipChorusDrums from './presets/worship-chorus-drums.example.json'

export type StyleProfilePresetJson = {
  id: string
  nombre: string
  rol: string
  tags: string[]
  bpm: number
  [k: string]: unknown
}

export const EXAMPLE_STYLE_PRESETS: readonly StyleProfilePresetJson[] = [
  worshipChorusDrums as StyleProfilePresetJson,
]
