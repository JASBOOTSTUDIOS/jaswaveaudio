/**
 * Política de envío de comandos RPC al plugin-host (sin dependencias de Electron, para tests).
 *
 * El host atiende `load`, `unload` y `get/setPluginState` en su hilo UI y responde más tarde con el
 * mismo `rid`; mientras tanto su hilo de stdin sigue contestando reloj, medidores y subidas de clip.
 * Esta política decide qué comando de la cola puede salir ya sin romper el orden que importa.
 */

/** Comandos que el host resuelve en su hilo de stdin esperando al hilo UI: bloquean todo lo demás. */
const BLOQUEAN_STDIN = new Set([
  'pinEditor',
  'listAudioDevices',
  'setAudioDevice',
  'getAudioDevice',
  'testTone',
  'ensureAudio',
  'asioControlPanel',
])

/** Comandos que cambian el estado global del motor: salen solos y nada sale mientras están en vuelo. */
const BARRERAS = new Set([
  ...BLOQUEAN_STDIN,
  'renderOfflineStart',
  'renderOfflineStep',
  'renderOfflineFinish',
  'renderOfflineCancel',
  'shutdown',
])

export function esBarreraRpc(type: string): boolean {
  return BARRERAS.has(type)
}

/** Clave de serialización: comandos del mismo slot o del mismo clip salen en orden, de uno en uno. */
export function claveSerieRpc(cmd: Record<string, unknown>): string {
  const type = typeof cmd.type === 'string' ? cmd.type : ''
  if (type.startsWith('clip.')) {
    const clipId = cmd.clipId ?? cmd.id
    return clipId != null && clipId !== '' ? `clip:${String(clipId)}` : ''
  }
  const slot = cmd.slotId ?? cmd.pluginId ?? cmd.path
  return slot != null && slot !== '' ? `slot:${String(slot)}` : ''
}

export type EnVueloRpc = { slotKey: string; barrier: boolean }

/**
 * Índice en `cola` del siguiente comando que puede enviarse ya, o -1 si hay que esperar.
 * - `paralelo=false` (host sin `rid`): en serie estricto, como antes.
 * - Una barrera espera a que no haya nada en vuelo, y mientras vuela no sale nada más.
 * - No se adelanta a una barrera que espera en cola (conserva el orden respecto a ella).
 */
export function siguienteRpcEnviable(
  cola: ReadonlyArray<{ cmd: Record<string, unknown> }>,
  enVuelo: ReadonlyArray<EnVueloRpc>,
  opts: { paralelo: boolean; maxEnVuelo: number },
): number {
  if (!cola.length) return -1
  if (!opts.paralelo) return enVuelo.length === 0 ? 0 : -1
  if (enVuelo.some((p) => p.barrier)) return -1
  if (enVuelo.length >= opts.maxEnVuelo) return -1
  const ocupadas = new Set(enVuelo.map((p) => p.slotKey).filter(Boolean))
  const tomadas = new Set<string>()
  for (let i = 0; i < cola.length; i++) {
    const cmd = cola[i]!.cmd
    const type = typeof cmd.type === 'string' ? cmd.type : ''
    if (esBarreraRpc(type)) return i === 0 && enVuelo.length === 0 ? 0 : -1
    const key = claveSerieRpc(cmd)
    if (key && (ocupadas.has(key) || tomadas.has(key))) {
      // El mismo slot/clip tiene algo antes: este espera, pero los de otros slots pueden salir.
      tomadas.add(key)
      continue
    }
    return i
  }
  return -1
}
