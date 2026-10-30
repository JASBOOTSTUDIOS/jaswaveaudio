/**
 * @jaswave/host-sdk — lo único que un módulo importa de JasWave.
 *
 * - Contrato del módulo (`definirModulo`, tipos).
 * - API del DAW (`host-api.generated.ts`): funciones, hooks y tipos que el host publica. Se genera desde
 *   jas-wave (`npm run sdk:generar`); en ejecución cada nombre se resuelve contra el runtime del host.
 */

export * from './contrato'
export { VERSION_SDK, api, runtime, instalarRuntime, type RuntimeJasWave } from './runtime'
export * from './host-api.generated'
