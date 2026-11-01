/**
 * Los paneles del asistente, la banda, el transporte de la IA, las zonas MIDI y los espectros del mixer los
 * aportan los módulos (plugins/com.jaswave.modulo.*). El build empaquetado de CI no los instala, así que los
 * escenarios que los necesitan se saltan con un motivo claro en vez de fallar por «elemento no encontrado».
 */
import { test } from '@playwright/test'
import type { Page } from '@playwright/test'

export const MODULO_ASISTENTE = 'com.jaswave.modulo.asistente-ia'

export async function moduloInstalado(page: Page, id: string): Promise<boolean> {
  try {
    const lista = (await page.evaluate(() => (window as any).electron.pluginsListar?.())) as Array<{ manifiesto: { id?: string } | null }> | undefined
    return !!lista?.some((p) => p.manifiesto?.id === id)
  } catch {
    return false
  }
}

/** Salta cada prueba del archivo si el módulo del asistente no está instalado en este build. */
export function requiereModulos(app: () => { page: Page; target?: string }): void {
  test.beforeEach(async () => {
    const { page, target } = app()
    test.skip(!(await moduloInstalado(page, MODULO_ASISTENTE)), target === 'dev' ? 'compila los módulos (npm run build:modulos)' : 'módulos no instalados en este build')
  })
}
