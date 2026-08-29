/** Contrato mínimo acción/resultado — desacoplado del executor del DAW. */
export type HarnessDawAction = {
  type: string
  payload?: Record<string, unknown>
}

export type HarnessActionResult = {
  type: string
  success: boolean
  message: string
  data?: unknown
}
