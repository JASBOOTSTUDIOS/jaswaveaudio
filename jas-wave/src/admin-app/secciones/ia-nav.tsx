/** Subnavegación de la sección IA (Modelos JasWave · Planes · Conexiones). */

import type { IdSeccion } from '../navegacion'
import { Segmentos } from '../ui'

export function NavIA({ actual, onIr }: { actual: IdSeccion; onIr: (s: IdSeccion) => void }) {
  return (
    <Segmentos
      etiqueta="Secciones de IA"
      valor={actual}
      onCambiar={onIr}
      opciones={[
        { id: 'ia-modelos', texto: 'Modelos' },
        { id: 'ia-planes', texto: 'Planes' },
        { id: 'ia-conexiones', texto: 'Conexiones' },
      ]}
    />
  )
}
