/**
 * Preguntas de aclaración que el asistente (o el DAW, p. ej. al elegir pista) plantea al usuario.
 */

export type ClarificationQuestion = {
  id: string
  question: string
  /** Opciones que inventó el modelo para esta pregunta (≥2) */
  options: string[]
  allowCustom?: boolean
  /** true = checkboxes (varias); false = una sola (botones) */
  multi?: boolean
}

export type ClarificationAnswer = {
  id: string
  optionIndexes: number[]
  value: string
}
