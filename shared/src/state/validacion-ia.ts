/**
 * Validador específico para acciones generadas por IA.
 *
 * Propósito:
 *   Aplicar controles adicionales a payloads generados por IA para
 *   detectar complejidad excesiva, irrelevancia o manipulación del
 *   contexto (prompt injection / jailbreak).
 *
 * Importancia:
 *   - Los payloads de IA NUNCA se confían; pasan por la misma
 *     pipeline que las acciones de usuario, más checks adicionales.
 *   - Protege contra acciones destructivas encadenadas por IA.
 *
 * Función:
 *   Exporta AIChecks, crearValidadorIA y checks específicos:
 *   TransactionComplexity, ToolRelevance, ContextIntegrity.
 */

import type { AICheck, ValidationResult, ValidationError, ActionRequest } from '../types/command';

export type { AICheck };

export interface AIValidator {
  validate(request: ActionRequest, context: Record<string, unknown>): ValidationResult;
  addCheck(check: AICheck): void;
}

export function crearValidadorIA(): AIValidator {
  const checks: AICheck[] = [];

  const transactionComplexity: AICheck = {
    name: 'TransactionComplexity',
    code: 'TRANSACTION_TOO_COMPLEX',
    description: 'Detecta si la IA está encadenando demasiadas operaciones peligrosas.',
    check: (request: ActionRequest, _context: Record<string, unknown>): ValidationResult => {
      const maxDangerous = 3;
      const tools = (request.context?.tools as Array<{ risk?: string }> | undefined) ?? [];
      const dangerousCount = tools.filter(t => t.risk === 'dangerous').length;
      if (dangerousCount > maxDangerous) {
        return {
          valid: false,
          errors: [{ code: 'TRANSACTION_TOO_COMPLEX', message: `La transacción incluye ${dangerousCount} operaciones peligrosas (máximo ${maxDangerous}).` }],
          warnings: [],
        };
      }
      return { valid: true, errors: [], warnings: [] };
    },
  };

  const toolRelevance: AICheck = {
    name: 'ToolRelevance',
    code: 'TOOL_NOT_RELEVANT',
    description: 'Verifica que las herramientas seleccionadas coinciden con la intención del usuario.',
    check: (request: ActionRequest, context: Record<string, unknown>): ValidationResult => {
      const intencion = String(context.intencion ?? '').toLowerCase();
      const tipo = String(request.type).toLowerCase();
      if (!intencion || !tipo) return { valid: true, errors: [], warnings: [] };
      const relevante = intencion.split(' ').some(token => token.length > 3 && tipo.includes(token));
      if (!relevante) {
        return {
          valid: false,
          errors: [{ code: 'TOOL_NOT_RELEVANT', message: `La herramienta "${request.type}" no parece relevante para la intención del usuario.` }],
          warnings: [],
        };
      }
      return { valid: true, errors: [], warnings: [] };
    },
  };

  const contextIntegrity: AICheck = {
    name: 'ContextIntegrity',
    code: 'PROMPT_INJECTION_DETECTED',
    description: 'Detecta prompt injection o jailbreak en el contexto.',
    check: (_request: ActionRequest, context: Record<string, unknown>): ValidationResult => {
      const texto = JSON.stringify(context).toLowerCase();
      const patronesSospechosos = [
        'ignore previous instructions',
        'ignore all previous',
        'disregard previous',
        'you are now',
        'new instructions',
        'jailbreak',
        'override safety',
        'bypass filter',
      ];
      const detectado = patronesSospechosos.some(p => texto.includes(p));
      if (detectado) {
        return {
          valid: false,
          errors: [{ code: 'PROMPT_INJECTION_DETECTED', message: 'Se detectó posible manipulación del contexto (prompt injection).' }],
          warnings: [],
        };
      }
      return { valid: true, errors: [], warnings: [] };
    },
  };

  checks.push(transactionComplexity, toolRelevance, contextIntegrity);

  return {
    validate(request: ActionRequest, context: Record<string, unknown>): ValidationResult {
      const errores: ValidationError[] = [];
      const warnings: ValidationError[] = [];

      for (const check of checks) {
        const result = check.check(request, context);
        if (!result.valid) {
          errores.push(...result.errors);
        }
      }

      return {
        valid: errores.length === 0,
        errors: errores,
        warnings,
      };
    },

    addCheck(check: AICheck): void {
      checks.push(check);
    },
  };
}
