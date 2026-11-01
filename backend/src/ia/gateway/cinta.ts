import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AiChatRequest, AiChatResult } from './ai-gateway.js';

/**
 * Cinta de respuestas del modelo: grabar una producción real y repetirla sin llamar a ningún proveedor.
 * Sirve para probar el código (mediciones, cortes, mezcla) sin gastar créditos y de forma repetible.
 *
 * Clave de cada petición: el mensaje de sistema del agente (rol + encargo) más el número de orden dentro de ese
 * mismo sistema. Así las producciones en paralelo no dependen del orden global de las llamadas.
 */
export type ModoCinta = 'grabar' | 'reproducir';

export type ChatDirecto = (
  req: AiChatRequest,
  opts?: { signal?: AbortSignal; onDelta?: (text: string) => void; timeoutMs?: number },
) => Promise<AiChatResult>;

type Entrada = { clave: string; n: number; inicio?: string; resultado: AiChatResult };

const CLAVE_RE = /[^a-z0-9]/gi;

/** Texto de un mensaje, sea cadena o lista de bloques. */
function textoDe(contenido: unknown): string {
  if (typeof contenido === 'string') return contenido;
  if (Array.isArray(contenido)) return contenido.map((b) => (typeof b === 'string' ? b : typeof (b as { text?: unknown })?.text === 'string' ? (b as { text: string }).text : '')).join('');
  return '';
}

/** Largo del arranque del mensaje de sistema que identifica al agente (rol y nombre); lo que sigue (estado del proyecto, notas) cambia en cada ejecución. */
const LARGO_IDENTIDAD = 240;

export function inicioDeSistema(req: AiChatRequest): string {
  const sistema = req.messages.find((m) => (m as { role?: string }).role === 'system') ?? req.messages[0];
  return textoDe((sistema as { content?: unknown } | undefined)?.content).slice(0, LARGO_IDENTIDAD);
}

export function claveDePeticion(req: AiChatRequest): string {
  const huella = createHash('sha256').update(inicioDeSistema(req)).digest('hex').slice(0, 16);
  return `${(req.meta?.role ?? 'sin-rol').replace(CLAVE_RE, '')}:${huella}`;
}

/** Quita lo que no debe quedar en disco (credenciales) de un resultado antes de grabarlo. */
function limpio(r: AiChatResult): AiChatResult {
  const { provider: _provider, ...resto } = r;
  return resto;
}

export function envolverConCinta(chat: ChatDirecto, o: { modo: ModoCinta; archivo: string; esperaMs?: number }): ChatDirecto {
  const contadores = new Map<string, number>();
  const siguiente = (clave: string) => {
    const n = (contadores.get(clave) ?? 0) + 1;
    contadores.set(clave, n);
    return n;
  };

  if (o.modo === 'grabar') {
    mkdirSync(dirname(o.archivo), { recursive: true });
    return async (req, opts) => {
      const resultado = await chat(req, opts);
      if (resultado.success || resultado.toolCalls?.length) {
        const clave = claveDePeticion(req);
        const entrada: Entrada = { clave, n: siguiente(clave), inicio: inicioDeSistema(req).slice(0, 100), resultado: limpio(resultado) };
        appendFileSync(o.archivo, JSON.stringify(entrada) + '\n', 'utf8');
      }
      return resultado;
    };
  }

  if (!existsSync(o.archivo)) throw new Error(`La cinta ${o.archivo} no existe.`);
  const porClave = new Map<string, Map<number, AiChatResult>>();
  for (const linea of readFileSync(o.archivo, 'utf8').split('\n')) {
    if (!linea.trim()) continue;
    const e = JSON.parse(linea) as Entrada;
    if (!porClave.has(e.clave)) porClave.set(e.clave, new Map());
    porClave.get(e.clave)!.set(e.n, e.resultado);
  }
  return async (req, opts) => {
    if (opts?.signal?.aborted) return { success: false, error: 'Solicitud cancelada.', errorCode: 'cancelled' };
    const clave = claveDePeticion(req);
    const n = (contadores.get(clave) ?? 0) + 1;
    const resultado = porClave.get(clave)?.get(n);
    // Un fallo no consume el turno: el enrutador reintenta con otros modelos y la cinta debe seguir en el mismo punto.
    if (!resultado) return { success: false, error: `Cinta agotada para ${clave} (petición ${n}).`, errorCode: 'unknown' };
    contadores.set(clave, n);
    if (o.esperaMs) await new Promise((r) => setTimeout(r, o.esperaMs));
    if (resultado.content) opts?.onDelta?.(resultado.content);
    return { ...resultado, model: resultado.model ?? req.model };
  };
}

/** Lee JASWAVE_IA_CINTA_GRABAR / JASWAVE_IA_CINTA_REPRODUCIR (ruta del .jsonl). Sin ninguna, devuelve el chat tal cual. */
export function cintaDesdeEntorno(chat: ChatDirecto, env: NodeJS.ProcessEnv = process.env): ChatDirecto {
  const grabar = env.JASWAVE_IA_CINTA_GRABAR?.trim();
  const reproducir = env.JASWAVE_IA_CINTA_REPRODUCIR?.trim();
  if (reproducir) return envolverConCinta(chat, { modo: 'reproducir', archivo: reproducir, esperaMs: Number(env.JASWAVE_IA_CINTA_MS) || 0 });
  if (grabar) return envolverConCinta(chat, { modo: 'grabar', archivo: grabar });
  return chat;
}
