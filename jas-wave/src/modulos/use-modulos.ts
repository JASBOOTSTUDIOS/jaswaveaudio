import { useSyncExternalStore } from 'react'
import { suscribirModulos, versionModulos } from './registro-modulos'

/** Re-renderiza cuando cambia el registro, la activación o el estado de descarga de los módulos. */
export function useVersionModulos(): number {
  return useSyncExternalStore(suscribirModulos, versionModulos, versionModulos)
}
