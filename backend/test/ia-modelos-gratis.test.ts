import { describe, expect, it } from 'vitest';
import type { AiChatRequest, AiChatResult } from '../src/ia/gateway/ai-gateway.js';
import {
  afinidad,
  aplicarSonda,
  clasificarFallo,
  construirCadena,
  crearGestorModelosGratis,
  esGratuitoUtil,
  evaluarSonda,
  nivelSugerido,
  puntuar,
  tamanoB,
  type FilaGratis,
  type ModeloCatalogo,
  type ResultadoSonda,
} from '../src/ia/jaswave/modelos-gratis.js';

const ahora = new Date('2026-10-29T12:00:00Z');

const catalogo = (id: string, extra: Partial<ModeloCatalogo> = {}): ModeloCatalogo => ({
  id,
  name: id,
  context_length: 262_144,
  pricing: { prompt: '0', completion: '0' },
  architecture: { output_modalities: ['text'] },
  supported_parameters: ['tools', 'reasoning'],
  ...extra,
});

const fila = (modelo: string, extra: Partial<FilaGratis> = {}): FilaGratis => ({
  modelo,
  nombre: modelo,
  contexto: 262_144,
  razonamiento: 'apagable',
  nivel: nivelSugerido(modelo),
  estado: 'sano',
  puntuacion: 80,
  latenciaMs: 1500,
  fallosSeguidos: 0,
  limitesSeguidos: 0,
  motivo: '',
  nivelFijado: false,
  excluidoManual: false,
  detectadoEn: ahora,
  vistoEn: ahora,
  ultimaPrueba: ahora,
  ultimoOk: ahora,
  proximaPrueba: null,
  ...extra,
});

const notas = (n: number, variadas: boolean) =>
  Array.from({ length: n }, (_, i) => ({ pitch: 60 + (i % 12), inicio: i, duracion: variadas ? 0.5 + (i % 5) * 0.5 : 1, velocidad: variadas ? 60 + (i % 8) * 6 : 90 }));
const conNotas = (lista: unknown[]): AiChatResult => ({ success: true, content: '', toolCalls: [{ id: 'c1', name: 'crear_clip', arguments: { pistaId: 'p1', inicio: 0, duracion: 16, notas: lista } }] });

describe('modelos gratuitos: catálogo', () => {
  it('acepta solo modelos gratuitos de texto con herramientas y contexto suficiente', () => {
    expect(esGratuitoUtil(catalogo('google/gemma-4-26b-a4b-it:free'))).toBe(true);
    expect(esGratuitoUtil(catalogo('google/gemma-4-26b-a4b-it', { pricing: { prompt: '0.00000009', completion: '0.0000003' } }))).toBe(false);
    expect(esGratuitoUtil(catalogo('nvidia/nemotron-3.5-content-safety:free'))).toBe(false);
    expect(esGratuitoUtil(catalogo('google/lyria-3-pro-preview:free', { architecture: { output_modalities: ['text', 'audio'] } }))).toBe(false);
    expect(esGratuitoUtil(catalogo('x/sin-herramientas:free', { supported_parameters: ['reasoning'] }))).toBe(false);
    expect(esGratuitoUtil(catalogo('x/chico:free', { context_length: 8000 }))).toBe(false);
    expect(esGratuitoUtil(catalogo('openrouter/free'))).toBe(false);
  });

  it('tamaño y nivel por id', () => {
    expect(tamanoB('google/gemma-4-26b-a4b-it:free')).toBe(26);
    expect(tamanoB('nvidia/nemotron-3-ultra-550b-a55b:free')).toBe(550);
    expect(tamanoB('liquid/lfm-2.5-2.6b:free')).toBe(2.6);
    expect(tamanoB('dots-studio/dots-3-note-preview:free')).toBeNull();
    const nivel = (id: string) => nivelSugerido(id);
    expect(nivel('nvidia/nemotron-3-ultra-550b-a55b:free')).toBe('profundo');
    expect(nivel('nvidia/nemotron-3.5-lightning:free')).toBe('rapido');
    expect(nivel('poolside/laguna-xs-2.1:free')).toBe('rapido');
    expect(nivel('cohere/north-mini-code:free')).toBe('rapido');
    expect(nivel('thinkingmachines/inkling-small:free')).toBe('rapido');
    expect(nivel('google/gemma-4-26b-a4b-it:free')).toBe('creativo');
    expect(nivel('nvidia/nemotron-3.5-super-vl:free')).toBe('creativo');
    expect(nivel('poolside/laguna-s-2.1:free')).toBe('creativo');
  });
});

describe('modelos gratuitos: sonda', () => {
  it('puntúa más una respuesta completa, variada y rápida', () => {
    const buena = puntuar({ notasOk: 16, notasTotal: 16, duraciones: 6, velocidades: 10, ms: 1500 });
    const cuadrada = puntuar({ notasOk: 16, notasTotal: 16, duraciones: 1, velocidades: 1, ms: 1500 });
    const lenta = puntuar({ notasOk: 16, notasTotal: 16, duraciones: 6, velocidades: 10, ms: 40_000 });
    const corta = puntuar({ notasOk: 6, notasTotal: 16, duraciones: 6, velocidades: 10, ms: 1500 });
    expect(buena).toBeGreaterThan(90);
    expect(buena).toBeGreaterThan(cuadrada);
    expect(buena).toBeGreaterThan(lenta);
    expect(buena).toBeGreaterThan(corta);
  });

  it('evalúa la llamada de herramienta y clasifica los fallos', () => {
    const ok = evaluarSonda(conNotas(notas(16, true)), 1200);
    expect(ok).toMatchObject({ ok: true, notasOk: 16, fallo: '' });
    expect(ok.puntuacion).toBeGreaterThan(80);
    expect(evaluarSonda(conNotas([{ pitch: 'C4' }, { nada: 1 }]), 500).ok).toBe(false);
    expect(evaluarSonda({ success: true, content: 'Voy a crear el verso' }, 500)).toMatchObject({ ok: false, fallo: 'sin-herramienta' });
    expect(evaluarSonda({ success: true, toolCalls: [{ id: 'c', name: 'crear_clip', arguments: { notas: 'texto' } }] }, 500)).toMatchObject({ fallo: 'respuesta-invalida' });

    expect(clasificarFallo({ success: false, error: 'x:free is only available on agentic harnesses', errorCode: 'forbidden' })).toBe('excluir');
    expect(clasificarFallo({ success: false, error: 'Reasoning is mandatory for this endpoint and cannot be disabled.', errorCode: 'bad_request' })).toBe('razonamiento-obligatorio');
    expect(clasificarFallo({ success: false, error: 'rate-limited', errorCode: 'rate_limit' })).toBe('limite');
    expect(clasificarFallo({ success: false, error: 'No endpoints found for x', errorCode: 'model_not_found' })).toBe('retirado');
    expect(clasificarFallo({ success: false, error: 'boom', errorCode: 'service_unavailable' })).toBe('fallo');
  });
});

describe('modelos gratuitos: estado', () => {
  const ok = (puntuacion: number, ms = 1500): ResultadoSonda => ({ ok: true, ms, notasOk: 16, notasTotal: 16, duraciones: 5, velocidades: 8, puntuacion, fallo: '', motivo: '' });
  const mal = (fallo: ResultadoSonda['fallo'], motivo = 'x'): ResultadoSonda => ({ ok: false, ms: 100, notasOk: 0, notasTotal: 0, duraciones: 0, velocidades: 0, puntuacion: 0, fallo, motivo });

  it('una sonda buena deja el modelo sano; una pobre, inestable', () => {
    expect(aplicarSonda(fila('a/x:free', { estado: 'nuevo' }), ok(85), ahora)).toMatchObject({ estado: 'sano', puntuacion: 85, fallosSeguidos: 0 });
    expect(aplicarSonda(fila('a/x:free', { estado: 'nuevo' }), ok(30), ahora)).toMatchObject({ estado: 'inestable' });
  });

  it('un 429 no tira a un modelo sano hasta que se repite mucho', () => {
    let f = fila('a/x:free');
    expect(aplicarSonda(f, mal('limite'), ahora)).toMatchObject({ limitesSeguidos: 1 });
    expect(aplicarSonda(f, mal('limite'), ahora).estado).toBeUndefined();
    f = fila('a/x:free', { limitesSeguidos: 5 });
    expect(aplicarSonda(f, mal('limite'), ahora)).toMatchObject({ estado: 'inestable' });
    // uno nuevo saturado queda inestable y se reintenta pronto
    const c = aplicarSonda(fila('a/y:free', { estado: 'nuevo' }), mal('limite'), ahora);
    expect(c.estado).toBe('inestable');
    expect(c.proximaPrueba!.getTime() - ahora.getTime()).toBe(20 * 60_000);
  });

  it('tres fallos seguidos lo dejan caído; el reintento se espacia', () => {
    let f = fila('a/x:free');
    for (let i = 0; i < 3; i++) f = { ...f, ...aplicarSonda(f, mal('fallo'), ahora) } as FilaGratis;
    expect(f.estado).toBe('caido');
    expect(f.fallosSeguidos).toBe(3);
    expect(f.proximaPrueba!.getTime()).toBeGreaterThan(ahora.getTime() + 3 * 3_600_000);
  });

  it('excluye lo que solo sirve para agentes y lo retirado', () => {
    expect(aplicarSonda(fila('a/x:free'), mal('excluir', 'solo agentes'), ahora)).toMatchObject({ estado: 'excluido', motivo: 'solo agentes' });
    expect(aplicarSonda(fila('a/x:free'), mal('retirado', 'No endpoints'), ahora).estado).toBe('excluido');
    expect(aplicarSonda(fila('a/x:free'), mal('razonamiento-obligatorio'), ahora)).toMatchObject({ razonamiento: 'obligatorio' });
  });
});

describe('modelos gratuitos: cadenas por nivel', () => {
  const todos = [
    fila('nvidia/nemotron-3.5-lightning:free', { puntuacion: 70, latenciaMs: 400 }),
    fila('google/gemma-4-26b-a4b-it:free', { puntuacion: 85, latenciaMs: 1200 }),
    fila('nvidia/nemotron-3.5-super-vl:free', { puntuacion: 95, latenciaMs: 900 }),
    fila('nvidia/nemotron-3-ultra-550b-a55b:free', { puntuacion: 90, latenciaMs: 9000 }),
    fila('cohere/north-mini-code:free', { puntuacion: 55, latenciaMs: 700 }),
    fila('x/caido:free', { estado: 'caido', puntuacion: 99 }),
    fila('x/nuevo:free', { estado: 'nuevo', puntuacion: 0 }),
    fila('x/excluido:free', { estado: 'excluido', puntuacion: 99 }),
    fila('x/manual:free', { excluidoManual: true, puntuacion: 99 }),
  ];

  it('solo entran los sanos o inestables y no excluidos', () => {
    const modelos = construirCadena(todos, 'creativo').map((e) => e.modelo);
    for (const m of ['x/caido:free', 'x/nuevo:free', 'x/excluido:free', 'x/manual:free']) expect(modelos).not.toContain(m);
  });

  it('cada nivel prefiere los modelos de su nivel', () => {
    const rapido = construirCadena(todos, 'rapido').map((e) => e.modelo);
    const profundo = construirCadena(todos, 'profundo');
    expect(rapido[0]).toBe('nvidia/nemotron-3.5-lightning:free');
    expect(profundo[0]!.modelo).toBe('nvidia/nemotron-3-ultra-550b-a55b:free');
    // el profundo razona poco; el resto no razona
    expect(profundo[0]!.razonamiento).toBe('bajo');
    expect(profundo.slice(1).every((e) => e.razonamiento === 'off')).toBe(true);
  });

  it('un modelo que exige razonamiento lo lleva activado', () => {
    const c = construirCadena([fila('a/r1:free', { razonamiento: 'obligatorio' }), fila('a/r2:free')], 'creativo');
    expect(c.find((e) => e.modelo === 'a/r1:free')!.razonamiento).toBe('normal');
  });

  it('los inestables van detrás y sin al menos dos sanos no se toca la cadena', () => {
    const c = construirCadena([fila('a/s1:free'), fila('a/s2:free', { puntuacion: 60 }), fila('a/i:free', { estado: 'inestable', puntuacion: 99 })], 'creativo');
    expect(c.map((e) => e.modelo)).toEqual(['a/s1:free', 'a/s2:free', 'a/i:free']);
    expect(construirCadena([fila('a/s1:free'), fila('a/i:free', { estado: 'inestable' })], 'creativo')).toEqual([]);
  });

  it('afinidad de niveles', () => {
    expect(afinidad('rapido', 'rapido')).toBe(100);
    expect(afinidad('rapido', 'creativo')).toBe(55);
    expect(afinidad('rapido', 'profundo')).toBe(20);
  });
});

// ───────────── Gestor con base de datos en memoria ─────────────

type Fila = Record<string, unknown> & { modelo: string };
function dbFalsa(proveedores: Array<{ id: string }> = [{ id: 'prov-1' }]) {
  const filas = new Map<string, Fila>();
  const ajustes = new Map<string, unknown>();
  const proveedorModelos: string[][] = [];
  const valores = (f: Fila) => ({ ...f });
  const db = {
    modeloGratisIA: {
      findMany: async () => [...filas.values()].sort((a, b) => a.modelo.localeCompare(b.modelo)).map(valores),
      findUnique: async ({ where }: { where: { modelo: string } }) => (filas.has(where.modelo) ? valores(filas.get(where.modelo)!) : null),
      create: async ({ data }: { data: Fila }) => {
        filas.set(data.modelo, {
          nombre: '', contexto: 0, razonamiento: 'apagable', nivel: 'creativo', estado: 'nuevo', puntuacion: 0, latenciaMs: null, fallosSeguidos: 0, limitesSeguidos: 0, motivo: '',
          nivelFijado: false, excluidoManual: false, detectadoEn: ahora, vistoEn: ahora, ultimaPrueba: null, ultimoOk: null, proximaPrueba: null, ...data,
        });
        return data;
      },
      update: async ({ where, data }: { where: { modelo: string }; data: Record<string, unknown> }) => {
        const f = filas.get(where.modelo);
        if (!f) throw new Error('no existe');
        Object.assign(f, data);
        return f;
      },
    },
    ajusteIA: {
      findUnique: async ({ where }: { where: { clave: string } }) => (ajustes.has(where.clave) ? { valor: ajustes.get(where.clave) } : null),
      upsert: async ({ where, create }: { where: { clave: string }; create: { valor: unknown } }) => {
        ajustes.set(where.clave, create.valor);
      },
    },
    proveedorIA: {
      update: async ({ data }: { where: { id: string }; data: { modelos: string[] } }) => {
        proveedorModelos.push(data.modelos);
        return proveedores[0];
      },
    },
  };
  return { db: db as never, filas, proveedorModelos };
}

function montar(opciones: { catalogo: () => ModeloCatalogo[]; respuesta: (req: AiChatRequest) => AiChatResult }) {
  const { db, filas, proveedorModelos } = dbFalsa();
  const cadenas: Record<string, Array<{ proveedorId: string; modelo: string; razonamiento: 'off' | 'bajo' | 'normal' }>> = { rapido: [], creativo: [], profundo: [] };
  const guardados: string[] = [];
  const llamadas: string[] = [];
  const gestor = crearGestorModelosGratis({
    db,
    chat: async (req) => {
      llamadas.push(req.model);
      return opciones.respuesta(req);
    },
    destino: async () => ({ proveedorId: 'prov-1', kind: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' }),
    jaswave: {
      modelos: async () => Object.entries(cadenas).map(([id, cadena]) => ({ id, nombre: id, descripcion: '', cadena })),
      guardar: async (id, d) => {
        cadenas[id] = d.cadena;
        guardados.push(id);
      },
      invalidar: () => undefined,
    },
    obtenerCatalogo: async () => opciones.catalogo(),
    ahora: () => ahora,
    pausaEntrePruebasMs: 0,
  });
  return { gestor, filas, cadenas, guardados, llamadas, proveedorModelos };
}

describe('modelos gratuitos: gestor', () => {
  const lista = () => [
    catalogo('google/gemma-4-26b-a4b-it:free'),
    catalogo('nvidia/nemotron-3.5-super-vl:free'),
    catalogo('nvidia/nemotron-3.5-lightning:free'),
    catalogo('nvidia/nemotron-3-ultra-550b-a55b:free'),
    catalogo('x/solo-agentes:free'),
    catalogo('x/de-pago', { pricing: { prompt: '1', completion: '1' } }),
  ];
  const responder = (req: AiChatRequest): AiChatResult => {
    if (req.model === 'x/solo-agentes:free') return { success: false, error: 'only available on agentic harnesses', errorCode: 'forbidden' };
    return conNotas(notas(16, true));
  };

  it('descubre, prueba y construye las cadenas de los tres niveles', async () => {
    const { gestor, filas, cadenas, guardados, llamadas, proveedorModelos } = montar({ catalogo: lista, respuesta: responder });
    const r = await gestor.ciclo();
    expect(r.nuevos).toHaveLength(5);
    expect(llamadas).not.toContain('x/de-pago');
    expect(filas.get('x/solo-agentes:free')!.estado).toBe('excluido');
    expect(filas.get('google/gemma-4-26b-a4b-it:free')).toMatchObject({ estado: 'sano', nivel: 'creativo' });
    expect(guardados.sort()).toEqual(['creativo', 'profundo', 'rapido']);
    expect(cadenas.rapido![0]!.modelo).toBe('nvidia/nemotron-3.5-lightning:free');
    expect(cadenas.profundo![0]!.modelo).toBe('nvidia/nemotron-3-ultra-550b-a55b:free');
    expect(cadenas.creativo!.every((e) => e.proveedorId === 'prov-1')).toBe(true);
    // la conexión lista todos los modelos usables y ninguno excluido
    expect(proveedorModelos.at(-1)).not.toContain('x/solo-agentes:free');
    expect(proveedorModelos.at(-1)).toContain('google/gemma-4-26b-a4b-it:free');
  });

  it('detecta un modelo nuevo en el siguiente ciclo y retira el que desaparece', async () => {
    let actual = lista();
    const { gestor, filas, cadenas } = montar({ catalogo: () => actual, respuesta: responder });
    await gestor.ciclo();
    actual = [...lista().filter((m) => m.id !== 'nvidia/nemotron-3.5-lightning:free'), catalogo('poolside/laguna-xs-2.1:free')];
    const r = await gestor.ciclo();
    expect(r.nuevos).toEqual(['poolside/laguna-xs-2.1:free']);
    expect(r.retirados).toContain('nvidia/nemotron-3.5-lightning:free');
    expect(filas.get('nvidia/nemotron-3.5-lightning:free')!.estado).toBe('excluido');
    expect(cadenas.rapido!.map((e) => e.modelo)).not.toContain('nvidia/nemotron-3.5-lightning:free');
    expect(cadenas.rapido!.map((e) => e.modelo)).toContain('poolside/laguna-xs-2.1:free');
  });

  it('si un modelo empieza a fallar sale de las cadenas; si no quedan candidatos no se toca nada', async () => {
    let falla = false;
    const { gestor, cadenas } = montar({ catalogo: lista, respuesta: (req) => (falla && req.model === 'google/gemma-4-26b-a4b-it:free' ? { success: false, error: 'boom', errorCode: 'service_unavailable' } : responder(req)) });
    await gestor.ciclo();
    expect(cadenas.creativo!.map((e) => e.modelo)).toContain('google/gemma-4-26b-a4b-it:free');
    falla = true;
    for (let i = 0; i < 3; i++) await gestor.ciclo({ forzar: true });
    expect(cadenas.creativo!.map((e) => e.modelo)).not.toContain('google/gemma-4-26b-a4b-it:free');
  });

  it('respeta lo que el admin excluye y el nivel que fija', async () => {
    const { gestor, filas, cadenas } = montar({ catalogo: lista, respuesta: responder });
    await gestor.ciclo();
    await gestor.ajustar('google/gemma-4-26b-a4b-it:free', { excluido: true });
    await gestor.ajustar('nvidia/nemotron-3.5-super-vl:free', { nivel: 'rapido' });
    await gestor.ciclo({ forzar: true });
    expect(filas.get('google/gemma-4-26b-a4b-it:free')).toMatchObject({ estado: 'excluido', excluidoManual: true });
    expect(cadenas.creativo!.map((e) => e.modelo)).not.toContain('google/gemma-4-26b-a4b-it:free');
    expect(filas.get('nvidia/nemotron-3.5-super-vl:free')).toMatchObject({ nivel: 'rapido', nivelFijado: true });
    await gestor.ajustar('google/gemma-4-26b-a4b-it:free', { excluido: false });
    expect(filas.get('google/gemma-4-26b-a4b-it:free')!.estado).toBe('nuevo');
  });

  it('un modelo que exige razonamiento se corrige y se prueba con razonamiento activado', async () => {
    const vistos: unknown[] = [];
    const { gestor, filas } = montar({
      catalogo: () => [catalogo('recursive/flint-v1.0:free'), catalogo('google/gemma-4-26b-a4b-it:free'), catalogo('nvidia/nemotron-3.5-super-vl:free')],
      respuesta: (req) => {
        vistos.push([req.model, req.extra]);
        const efimero = (req.extra as { reasoning?: { enabled?: boolean } } | undefined)?.reasoning?.enabled === false;
        if (req.model === 'recursive/flint-v1.0:free' && efimero) return { success: false, error: 'Reasoning is mandatory for this endpoint and cannot be disabled.', errorCode: 'bad_request' };
        return conNotas(notas(16, true));
      },
    });
    await gestor.ciclo();
    expect(filas.get('recursive/flint-v1.0:free')).toMatchObject({ razonamiento: 'obligatorio', estado: 'sano' });
  });

  it('cuatro fallos seguidos en uso real marcan inestable sin esperar a la sonda', async () => {
    const { gestor, filas } = montar({ catalogo: lista, respuesta: responder });
    await gestor.ciclo();
    const m = 'nvidia/nemotron-3.5-lightning:free';
    gestor.alIntentos([{ conexionId: 'c', modelo: m, ok: false, codigo: 'rate_limit', ms: 1 }]);
    for (let i = 0; i < 4; i++) gestor.alIntentos([{ conexionId: 'c', modelo: m, ok: false, codigo: 'service_unavailable', ms: 1 }]);
    await new Promise((r) => setTimeout(r, 20));
    expect(filas.get(m)).toMatchObject({ estado: 'inestable' });
    expect(String(filas.get(m)!.motivo)).toContain('uso real');
  });

  it('guarda y valida la configuración', async () => {
    const { gestor } = montar({ catalogo: lista, respuesta: responder });
    expect(await gestor.config()).toMatchObject({ auto: true, intervaloMin: 180 });
    expect(await gestor.guardarConfig({ auto: false, intervaloMin: 5 })).toMatchObject({ auto: false, intervaloMin: 15 });
    expect((await gestor.config()).auto).toBe(false);
  });
});
