/** Quita bloques de protocolo que el modelo a veces filtra al texto visible. */
export function sanitizeAssistantMarkdown(text: string): string {
  let t = text
  t = t.replace(/<<<INTENT\s*[\s\S]*?\s*INTENT>>>/gi, '')
  t = t.replace(/<<<READ\s*[\s\S]*?\s*(?:READ|WEB)>>>\s*/gi, '')
  t = t.replace(/<<<ACTIONS\s*[\s\S]*?\s*ACTIONS>>>/gi, '')
  t = t.replace(/<<<CLARIFY\s*[\s\S]*?\s*CLARIFY>>>/gi, '')
  t = t.replace(/<<<PLAN\s*[\s\S]*?\s*PLAN>>>/gi, '')
  t = t.replace(/<<<DOC\s*[\s\S]*?\s*DOC>>>/gi, '')
  // Marcadores sueltos / truncados
  t = t.replace(/<<<(?:INTENT|READ|ACTIONS|CLARIFY|PLAN|DOC)\b[\s\S]*?(?:>>>|$)/gi, '')
  t = t.replace(/Escribe solo el pensamiento de ESTA capa[^\n]*/gi, '')
  t = t.replace(/<<<READY_FOR_GAP_REPORT>>>/gi, '')
  t = t.replace(/^#{1,3}\s*Capa\s+\d+\s*\/\s*\d+[^\n]*/gim, '')
  t = t.replace(/^\s*Pedido canónico \(capa[^\n]*/gim, '')
  t = t.replace(/^\s*Consult[eé]:\s*[^\n]*$/gim, '')
  t = t.replace(/\n{3,}/g, '\n\n').trim()
  return t
}
