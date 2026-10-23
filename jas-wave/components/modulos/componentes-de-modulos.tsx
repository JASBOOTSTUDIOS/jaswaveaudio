/**
 * Monta los componentes globales que aportan los módulos activos (diálogos, escuchas de menús…). Cada
 * uno va aislado en su boundary: un fallo de un módulo no tumba el DAW.
 */

import { AppErrorBoundary } from '@/components/app-error-boundary'
import { useComponentesGlobales } from '@/src/modulos/contribuciones'

export function ComponentesDeModulos() {
  const componentes = useComponentesGlobales()
  return (
    <>
      {componentes.map((C, i) => (
        <AppErrorBoundary key={i} area={`modulo-global-${i}`} compact>
          <C />
        </AppErrorBoundary>
      ))}
    </>
  )
}
