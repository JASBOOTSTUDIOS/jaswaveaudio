/**
 * Enrutador de JasWave IA: ejecuta una petición sobre una cadena ordenada de modelos reales.
 *
 * - Reparte la carga entre las claves de cada conexión (la menos ocupada que no esté enfriada).
 *   Un 429 enfría la clave unos segundos y reintenta con otra; un 401/403/402 la aparta un rato.
 * - Cubre la latencia: si el modelo activo no respondió (o no empezó a emitir) en `cubrirTrasMs`,
 *   lanza el siguiente en paralelo (como mucho `maxParalelo` a la vez). Gana la primera respuesta
 *   útil y el resto se cancela; si un intento falla, el siguiente arranca en el acto.
 * - En streaming, el primer intento que emite texto se queda la salida y cancela a los demás.
 * - Controla el razonamiento oculto de los modelos gratuitos (`reasoning`), que es lo que más tarda.
 *
 * Es puro respecto a la base de datos: recibe los intentos ya resueltos (con sus claves descifradas).
 */

import type { AiChatRequest, AiChatResult, AiErrorCode, AiProviderCustom, AiProviderKind, AiUsage } from '../gateway/ai-gateway.js';

export type Razonamiento = 'off' | 'bajo' | 'normal';

export type ClaveIntento = { id: string; apiKey?: string };

export type Intento = {
  conexionId: string;
  modelo: string;
  razonamiento: Razonamiento;
  kind: AiProviderKind;
  baseUrl: string;
  custom?: AiProviderCustom;
  claves: ClaveIntento[];
};

export type PeticionBase = Omit<AiChatRequest, 'kind' | 'model' | 'baseUrl' | 'apiKey' | 'custom' | 'extra' | 'providerId'>;

export type RegistroIntento = { conexionId: string; modelo: string; claveId?: string; ok: boolean; codigo?: AiErrorCode; ms: number };

export type ResultadoEnrutado = {
  resultado: AiChatResult;
  ganador?: Intento;
  usage?: AiUsage;
  ms: number;
  intentos: RegistroIntento[];
};

export type ChatDirecto = (req: AiChatRequest, opts: { signal?: AbortSignal; onDelta?: (t: string) => void; timeoutMs?: number }) => Promise<AiChatResult>;

type EstadoClave = { enVuelo: number; enfriadaHasta: number; usos: number; fallos: number; ultimoError?: string };

export type OpcionesEjecucion = {
  signal?: AbortSignal;
  onDelta?: (t: string) => void;
  cubrirTrasMs?: number;
  maxParalelo?: number;
  timeoutMs?: number;
};

/** Muestras mínimas de un modelo para fiarse de su percentil de latencia, y cuántas se recuerdan. */
const MUESTRAS_MIN_LATENCIA = 8;
const MUESTRAS_MAX_LATENCIA = 40;
/** La cobertura nunca salta antes de esto (un modelo muy rápido no justifica duplicar cada petición). */
const COBERTURA_MIN_MS = 3_000;
const PERCENTIL_COBERTURA = 0.9;
const ENFRIAR_429_MS = 20_000;
const ENFRIAR_AUTH_MS = 10 * 60_000;

/** Parámetro de razonamiento por tipo de conexión (solo las que lo entienden). */
export function extraRazonamiento(kind: AiProviderKind, r: Razonamiento): Record<string, unknown> | undefined {
  if (kind !== 'kilocode' && kind !== 'openrouter') return undefined;
  if (r === 'off') return { reasoning: { enabled: false } };
  if (r === 'bajo') return { reasoning: { effort: 'low' } };
  return undefined;
}

const util = (r: AiChatResult) => r.success && Boolean(r.content?.trim() || r.toolCalls?.length);

export function crearEnrutador(deps: { chat: ChatDirecto; ahora?: () => number; coberturaMinMs?: number }) {
  const ahora = deps.ahora ?? Date.now;
  const claves = new Map<string, EstadoClave>();
  /** Latencias de respuestas útiles por modelo (las últimas): de ahí sale cuándo cubrir con el siguiente. */
  const latencias = new Map<string, number[]>();
  function anotarLatencia(modelo: string, ms: number) {
    const v = latencias.get(modelo) ?? [];
    v.push(ms);
    if (v.length > MUESTRAS_MAX_LATENCIA) v.shift();
    latencias.set(modelo, v);
  }
  /** Percentil observado de la latencia de un modelo, o null si aún hay pocas muestras. */
  function latenciaPercentil(modelo: string, p = PERCENTIL_COBERTURA): number | null {
    const v = latencias.get(modelo);
    if (!v || v.length < MUESTRAS_MIN_LATENCIA) return null;
    const orden = [...v].sort((a, b) => a - b);
    return orden[Math.min(orden.length - 1, Math.floor(p * orden.length))]!;
  }
  /**
   * Cuándo cubrir mientras responde `modelo`: el percentil 90 observado de SU latencia (si responde más tarde que
   * casi siempre, algo va mal y conviene lanzar ya el siguiente), acotado entre 3 s y el tope configurado.
   */
  function umbralCobertura(modelo: string | undefined, topeMs: number): number {
    const p = modelo ? latenciaPercentil(modelo) : null;
    if (p === null) return topeMs;
    return Math.max(Math.min(deps.coberturaMinMs ?? COBERTURA_MIN_MS, topeMs), Math.min(topeMs, p));
  }
  const estado = (id: string) => {
    let e = claves.get(id);
    if (!e) claves.set(id, (e = { enVuelo: 0, enfriadaHasta: 0, usos: 0, fallos: 0 }));
    return e;
  };

  /** Clave disponible menos ocupada (las enfriadas se saltan; `excluir` = ya probadas en este intento). */
  function elegirClave(i: Intento, excluir: Set<string>): ClaveIntento | null {
    const t = ahora();
    const libres = i.claves.filter((c) => !excluir.has(c.id) && estado(c.id).enfriadaHasta <= t);
    if (!libres.length) return null;
    return libres.reduce((a, b) => {
      const ea = estado(a.id);
      const eb = estado(b.id);
      return eb.enVuelo < ea.enVuelo || (eb.enVuelo === ea.enVuelo && eb.usos < ea.usos) ? b : a;
    });
  }

  async function ejecutar(intentos: Intento[], base: PeticionBase, o: OpcionesEjecucion = {}): Promise<ResultadoEnrutado> {
    const inicio = ahora();
    const cubrirTrasMs = o.cubrirTrasMs ?? 15_000;
    const maxParalelo = Math.max(1, o.maxParalelo ?? 2);
    const registro: RegistroIntento[] = [];
    const controladores = new Set<AbortController>();
    let siguiente = 0;
    let activos = 0;
    let terminado = false;
    let dueñoStream: AbortController | null = null;
    let ultimoFallo: AiChatResult = { success: false, error: 'Sin modelos disponibles.', errorCode: 'not_available' };

    return new Promise<ResultadoEnrutado>((resolve) => {
      let temporizador: ReturnType<typeof setTimeout> | undefined;

      const cerrar = (resultado: AiChatResult, ganador?: Intento) => {
        if (terminado) return;
        terminado = true;
        if (temporizador) clearTimeout(temporizador);
        for (const c of controladores) c.abort();
        o.signal?.removeEventListener('abort', alAbortar);
        resolve({ resultado, ...(ganador ? { ganador } : {}), ...(resultado.usage ? { usage: resultado.usage } : {}), ms: ahora() - inicio, intentos: registro });
      };
      const alAbortar = () => cerrar({ success: false, error: 'Solicitud cancelada.', errorCode: 'cancelled' });
      if (o.signal?.aborted) return alAbortar();
      o.signal?.addEventListener('abort', alAbortar, { once: true });

      const programarCobertura = () => {
        if (temporizador) clearTimeout(temporizador);
        // Se cubre según el modelo que se lanzó el último (el que ahora se espera).
        const espera = umbralCobertura(intentos[siguiente - 1]?.modelo, cubrirTrasMs);
        temporizador = setTimeout(() => {
          if (!terminado && !dueñoStream && activos < maxParalelo && siguiente < intentos.length) lanzar();
          if (!terminado && !dueñoStream && siguiente < intentos.length) programarCobertura();
        }, espera);
      };

      const quizaCerrarSinExito = () => {
        if (!terminado && activos === 0 && siguiente >= intentos.length) cerrar(ultimoFallo);
      };

      /** Ejecuta el intento `i`, rotando de clave ante 429/credenciales. */
      async function correr(i: Intento) {
        const probadas = new Set<string>();
        for (;;) {
          if (terminado) return;
          const clave = i.claves.length ? elegirClave(i, probadas) : { id: `${i.conexionId}:sin-clave` };
          if (!clave) {
            ultimoFallo = { success: false, error: 'Todas las claves de la conexión están en pausa.', errorCode: 'rate_limit' };
            registro.push({ conexionId: i.conexionId, modelo: i.modelo, ok: false, codigo: 'rate_limit', ms: 0 });
            return;
          }
          probadas.add(clave.id);
          const e = estado(clave.id);
          const ctl = new AbortController();
          controladores.add(ctl);
          e.enVuelo += 1;
          e.usos += 1;
          const t0 = ahora();
          const extra = extraRazonamiento(i.kind, i.razonamiento);
          const req: AiChatRequest = {
            ...base,
            kind: i.kind,
            model: i.modelo,
            baseUrl: i.baseUrl,
            ...(clave.apiKey ? { apiKey: clave.apiKey } : {}),
            ...(i.custom ? { custom: i.custom } : {}),
            ...(extra ? { extra } : {}),
          };
          const onDelta = o.onDelta
            ? (t: string) => {
                if (terminado) return;
                if (!dueñoStream) {
                  // El primero que habla se queda la salida: los demás se cancelan.
                  dueñoStream = ctl;
                  if (temporizador) clearTimeout(temporizador);
                  for (const c of controladores) if (c !== ctl) c.abort();
                }
                if (dueñoStream === ctl) o.onDelta!(t);
              }
            : undefined;
          let r: AiChatResult;
          try {
            r = await deps.chat(req, { signal: ctl.signal, ...(onDelta ? { onDelta } : {}), ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) });
          } catch (err) {
            r = { success: false, error: err instanceof Error ? err.message : String(err), errorCode: 'unknown' };
          } finally {
            e.enVuelo -= 1;
            controladores.delete(ctl);
          }
          registro.push({ conexionId: i.conexionId, modelo: i.modelo, claveId: clave.id, ok: util(r), ...(r.errorCode ? { codigo: r.errorCode } : {}), ms: ahora() - t0 });
          if (util(r) && !ctl.signal.aborted) anotarLatencia(i.modelo, ahora() - t0);
          if (terminado) return;
          if (util(r)) {
            cerrar(r, i);
            return;
          }
          if (ctl.signal.aborted && dueñoStream && dueñoStream !== ctl) return;
          e.fallos += 1;
          e.ultimoError = r.errorCode;
          ultimoFallo = r;
          if (dueñoStream === ctl) {
            // Ya emitió texto: no se puede repetir con otro modelo sin duplicar la salida.
            cerrar(r, i);
            return;
          }
          if (r.errorCode === 'rate_limit') {
            e.enfriadaHasta = ahora() + ENFRIAR_429_MS;
            continue;
          }
          if (r.errorCode === 'unauthorized' || r.errorCode === 'forbidden' || r.errorCode === 'payment_required') {
            e.enfriadaHasta = ahora() + ENFRIAR_AUTH_MS;
            continue;
          }
          return;
        }
      }

      function lanzar() {
        if (terminado || siguiente >= intentos.length) return;
        const i = intentos[siguiente++]!;
        activos += 1;
        void correr(i).finally(() => {
          activos -= 1;
          if (terminado) return;
          // Falló: el siguiente arranca ya (sin esperar a la cobertura).
          if (!dueñoStream && activos < maxParalelo && siguiente < intentos.length) lanzar();
          quizaCerrarSinExito();
        });
        programarCobertura();
      }

      if (!intentos.length) return cerrar(ultimoFallo);
      lanzar();
    });
  }

  /** Estado de las claves (panel admin): ocupación, pausas y fallos. Sin secretos. */
  function estadoClaves(): Record<string, { enVuelo: number; enPausaHasta: number | null; usos: number; fallos: number; ultimoError?: string }> {
    const t = ahora();
    return Object.fromEntries(
      [...claves.entries()].map(([id, e]) => [
        id,
        { enVuelo: e.enVuelo, enPausaHasta: e.enfriadaHasta > t ? e.enfriadaHasta : null, usos: e.usos, fallos: e.fallos, ...(e.ultimoError ? { ultimoError: e.ultimoError } : {}) },
      ]),
    );
  }

  return { ejecutar, estadoClaves, latenciaPercentil };
}

export type Enrutador = ReturnType<typeof crearEnrutador>;
