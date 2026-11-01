/**
 * Grooves cuyo id o nombre comparte palabras con el id pedido. El modelo a veces inventa un id casi correcto
 * («jw-worship-4-4-puente-crescendo-por-capas»): `mejor` solo existe si uno comparte al menos 2 palabras y la mitad de
 * las pedidas y le saca ventaja al segundo; `candidatos` son los 5 más parecidos para proponérselos en el error.
 */
export function groovesParecidos<T extends { id: string; nombre: string }>(lista: readonly T[], pedido: string): { mejor?: T; candidatos: T[] } {
  const palabras = (t: string) =>
    t
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 2 && w !== 'jw')
  const buscadas = [...new Set(palabras(pedido))]
  if (!buscadas.length) return { candidatos: [] }
  const puntuadas = lista
    .map((g) => {
      const propias = new Set([...palabras(g.id), ...palabras(g.nombre)])
      return { g, puntos: buscadas.filter((w) => propias.has(w)).length }
    })
    .filter((x) => x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos)
  const primero = puntuadas[0]
  const segundo = puntuadas[1]
  // Al menos 2 palabras en común y la mitad de las pedidas (el modelo añade relleno: «por», «capas»…), y gana con ventaja.
  const mejor = primero && primero.puntos >= 2 && primero.puntos / buscadas.length >= 0.5 && (!segundo || primero.puntos > segundo.puntos) ? primero.g : undefined
  return { ...(mejor ? { mejor } : {}), candidatos: puntuadas.slice(0, 5).map((x) => x.g) }
}
