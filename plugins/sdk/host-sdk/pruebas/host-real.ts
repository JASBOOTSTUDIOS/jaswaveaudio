/**
 * Solo pruebas de contrato de módulos: instala el runtime del SDK con el DAW real (jas-wave), como hace la
 * app al arrancar. Los módulos lo importan únicamente desde test/; su código de producción solo conoce
 * @jaswave/host-sdk (lo comprueba plugins/scripts/verificar-independencia.mjs).
 */
import { instalarSdkHost } from '../../../../jas-wave/src/modulos/sdk-host'

export function instalarHostReal(): void {
  instalarSdkHost()
}
