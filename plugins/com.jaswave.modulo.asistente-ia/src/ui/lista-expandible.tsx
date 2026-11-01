/**
 * Listas largas sin scroll interno: se muestran las primeras N filas y un botón
 * «Ver todo (X más)» que las despliega en línea.
 */
import { useState } from 'react'

export function useVerTodo<T>(items: readonly T[], limite: number) {
  const [todo, setTodo] = useState(false)
  const visibles = todo ? items : items.slice(0, limite)
  return {
    visibles,
    ocultos: Math.max(0, items.length - limite),
    todo,
    alternar: () => setTodo((v) => !v),
  }
}

export function BotonVerTodo({
  ocultos,
  todo,
  onClick,
  className,
}: {
  ocultos: number
  todo: boolean
  onClick: () => void
  className?: string
}) {
  if (ocultos <= 0) return null
  return (
    <button
      type="button"
      onClick={onClick}
      className={className ?? 'mt-0.5 text-[0.8em] text-muted-foreground/70 hover:text-foreground'}
    >
      {todo ? 'Ver menos' : `Ver todo (${ocultos} más)`}
    </button>
  )
}
