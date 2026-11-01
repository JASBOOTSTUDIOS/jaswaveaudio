import { describe, it, expect } from 'vitest';
import { crearTiendaDAW, crearEstadoInicial } from '../state';
import type { TiendaDAW } from '../state/tienda';
import type { DAWState } from '../types/state';
import type { MidiNote } from '../types/clips';
import {
  ClienteColaborativo,
  ReplicaSync,
  crearAplicador,
  type CambioConfirmado,
  type MensajeClienteSync,
  type MensajeServidorSync,
  type TransporteSync,
} from '../sync';

// ---------------------------------------------------------------- utilidades

function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** JSON con claves ordenadas: compara estados sin depender del orden de inserción de propiedades. */
function estable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(estable).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${estable(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

const red = <T>(m: T): T => JSON.parse(JSON.stringify(m)) as T; // simula el paso por la red
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Servidor en memoria con el mismo comportamiento que backend/src/sync: seq total, difusión y replay. */
class ServidorMemoria {
  seq = 0;
  readonly log: CambioConfirmado[] = [];
  private readonly bajada = new Map<string, (m: MensajeServidorSync) => void>();
  enVuelo = 0;

  constructor(private readonly azar: () => number) {}

  /** Canal FIFO con latencia aleatoria (el orden se conserva, como en un WebSocket). */
  private canal<T>(entregar: (m: T) => void): (m: T) => void {
    let cola = Promise.resolve();
    return (m: T) => {
      this.enVuelo++;
      const retraso = Math.floor(this.azar() * 4);
      const copia = red(m);
      cola = cola
        .then(() => dormir(retraso))
        .then(() => {
          this.enVuelo--;
          entregar(copia);
        });
    };
  }

  conectar(clienteId: string): TransporteSync {
    const listeners = new Set<(m: MensajeServidorSync) => void>();
    const bajar = this.canal<MensajeServidorSync>((m) => listeners.forEach((l) => l(m)));
    this.bajada.set(clienteId, bajar);
    const subir = this.canal<MensajeClienteSync>((m) => this.recibir(clienteId, m));
    return {
      enviar: (m) => subir(m),
      alRecibir: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
  }

  private recibir(clienteId: string, m: MensajeClienteSync): void {
    const bajar = this.bajada.get(clienteId)!;
    if (m.tipo === 'sala.unirse') {
      bajar({ tipo: 'sala.unido', salaId: m.salaId, rol: 'editor', ultimoSeq: this.seq });
      for (const c of this.log.filter((x) => x.seq > m.desdeSeq)) bajar({ tipo: 'comando.aplicado', ...c });
      return;
    }
    if (m.tipo !== 'comando') return;
    const c: CambioConfirmado = {
      salaId: m.salaId,
      seq: ++this.seq,
      autorId: clienteId,
      clienteId: m.clienteId,
      comando: m.comando,
      payload: m.payload,
      vclock: m.vclock,
      baseSeq: m.baseSeq,
      creadoEn: new Date(0).toISOString(),
    };
    this.log.push(c);
    for (const b of this.bajada.values()) b({ tipo: 'comando.aplicado', ...c });
  }
}

type Participante = { id: string; tienda: TiendaDAW; cliente: ClienteColaborativo };

function participante(id: string, base: DAWState, servidor: ServidorMemoria): Participante {
  const tienda = crearTiendaDAW({ estadoInicial: structuredClone(base) });
  const dedicado = crearTiendaDAW({ estadoInicial: structuredClone(base) }).executor;
  const cliente = new ClienteColaborativo({
    ejecutor: tienda.executor,
    aplicar: crearAplicador(dedicado),
    transporte: servidor.conectar(id),
    salaId: 'sala',
    clienteId: id,
  });
  cliente.iniciar();
  return { id, tienda, cliente };
}

/** Proyecto base común: una pista MIDI con un clip vacío de 4 tiempos y una pista de audio. */
async function baseComun() {
  const t = crearTiendaDAW({ estadoInicial: crearEstadoInicial() });
  const r = await t.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi' });
  const pistaId = (r.result as { trackId: string }).trackId;
  await t.executor.execute('midi.clip.create', { pistaId, inicio: 0, duracion: 4, notas: [{ pitch: 60, inicio: 0, duracion: 1, velocidad: 90 }] });
  const pista = t.obtenerEstado().project.tracks.find((x) => x.id === pistaId)!;
  const clipId = (pista.clips[0] as { id: string }).id;
  return { base: t.obtenerEstado(), pistaId, clipId };
}

const notasDe = (estado: DAWState, pistaId: string, clipId: string): MidiNote[] =>
  ((estado.project.tracks.find((t) => t.id === pistaId)?.clips ?? []).find((c) => (c as { id: string }).id === clipId) as { notas?: MidiNote[] } | undefined)
    ?.notas ?? [];

async function esperarQuietud(servidor: ServidorMemoria, ps: Participante[]): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    const quieto =
      servidor.enVuelo === 0 && ps.every((p) => p.cliente.pendientes === 0 && p.cliente.seq === servidor.seq);
    if (quieto) {
      // Una vuelta más del bucle de eventos para que terminen las colas de los ejecutores.
      await dormir(5);
      if (servidor.enVuelo === 0 && ps.every((p) => p.cliente.pendientes === 0 && p.cliente.seq === servidor.seq)) return;
    }
    if (Date.now() - t0 > 15_000) throw new Error(`sin quietud: seq=${servidor.seq} ${ps.map((p) => `${p.id}:${p.cliente.seq}/${p.cliente.pendientes}`).join(' ')}`);
    await dormir(5);
  }
}

// ---------------------------------------------------------------- pruebas

describe('S2 — convergencia multi-cliente (criterio §8.2)', () => {
  for (const semilla of [1, 7, 42, 1234, 99991]) {
    it(`4 clientes con ediciones simultáneas en el mismo compás convergen al mismo estado (semilla ${semilla})`, async () => {
      const { base, pistaId, clipId } = await baseComun();
      const azar = mulberry32(semilla);
      const servidor = new ServidorMemoria(azar);
      const ps = ['A', 'B', 'C', 'D'].map((id) => participante(id, base, servidor));
      await esperarQuietud(servidor, ps);

      const pistaAudio = base.project.tracks.find((t) => t.id !== pistaId)?.id ?? pistaId;
      const acciones = ps.map(async (p) => {
        const ex = p.tienda.executor;
        for (let i = 0; i < 14; i++) {
          const r = azar();
          const notas = notasDe(ex.obtenerEstado(), pistaId, clipId);
          if (r < 0.3) {
            await ex.execute('midi.createNotes', { pistaId, clipId, notas: [{ pitch: 48 + Math.floor(azar() * 24), inicio: Math.floor(azar() * 16) / 4, duracion: 0.25, velocidad: 90 }] }, 'user', p.id);
          } else if (r < 0.45 && notas.length > 0) {
            await ex.execute('midi.deleteNotes', { pistaId, clipId, noteIds: [notas[Math.floor(azar() * notas.length)]!.id] }, 'user', p.id);
          } else if (r < 0.55) {
            await ex.execute('midi.transpose', { pistaId, clipId, semitonos: azar() < 0.5 ? 1 : -1 }, 'user', p.id);
          } else if (r < 0.7 && notas.length > 0) {
            // Edición tipo piano roll: mueve una nota y reenvía el clip completo.
            const k = Math.floor(azar() * notas.length);
            const movidas = notas.map((n, j) => (j === k ? { ...n, inicio: Math.floor(azar() * 16) / 4 } : n));
            await ex.execute('midi.notes.set', { pistaId, clipId, notas: movidas }, 'user', p.id);
          } else if (r < 0.85) {
            await ex.execute('track.update', { trackId: azar() < 0.5 ? pistaId : pistaAudio, datos: { volumen: Math.round(azar() * 100) / 100 } }, 'user', p.id);
          } else {
            await ex.undo(p.id);
          }
          await dormir(Math.floor(azar() * 3));
        }
      });
      await Promise.all(acciones);
      await esperarQuietud(servidor, ps);

      const proyectos = ps.map((p) => estable(p.tienda.obtenerEstado().project));
      for (const pr of proyectos) expect(pr).toBe(proyectos[0]);

      // La convergencia es al plegado de la secuencia del servidor sobre la base.
      const referencia = new ReplicaSync(crearAplicador(crearTiendaDAW({ estadoInicial: structuredClone(base) }).executor), structuredClone(base));
      for (const c of servidor.log) await referencia.recibir(red(c));
      expect(estable(referencia.estado.project)).toBe(proyectos[0]);
      expect(servidor.seq).toBeGreaterThan(20);

      ps.forEach((p) => p.cliente.detener());
    }, 30_000);
  }
});

describe('S2 — undo por usuario', () => {
  it('deshacer lo propio no borra la nota que otro colaborador añadió al mismo clip', async () => {
    const { base, pistaId, clipId } = await baseComun();
    const servidor = new ServidorMemoria(mulberry32(5));
    const [a, b] = ['A', 'B'].map((id) => participante(id, base, servidor)) as [Participante, Participante];
    await esperarQuietud(servidor, [a, b]);

    await a.tienda.executor.execute('midi.createNotes', { pistaId, clipId, notas: [{ pitch: 64, inicio: 1, duracion: 1, velocidad: 90 }] }, 'user', 'A');
    await b.tienda.executor.execute('midi.createNotes', { pistaId, clipId, notas: [{ pitch: 67, inicio: 2, duracion: 1, velocidad: 90 }] }, 'user', 'B');
    await esperarQuietud(servidor, [a, b]);
    expect(notasDe(a.tienda.obtenerEstado(), pistaId, clipId).map((n) => n.pitch).sort()).toEqual([60, 64, 67]);

    // B no tiene en su pila el cambio de A.
    expect(b.tienda.executor.getUndoDepth('B')).toBe(1);
    expect(a.tienda.executor.getUndoDepth('A')).toBe(1);

    const r = await a.tienda.executor.undo('A');
    expect(r.success).toBe(true);
    await esperarQuietud(servidor, [a, b]);
    for (const p of [a, b]) {
      expect(notasDe(p.tienda.obtenerEstado(), pistaId, clipId).map((n) => n.pitch).sort()).toEqual([60, 67]);
    }
    a.cliente.detener();
    b.cliente.detener();
  });

  it('el undo de un usuario no afecta a la pila de otro en el mismo ejecutor', async () => {
    const { base, pistaId, clipId } = await baseComun();
    const t = crearTiendaDAW({ estadoInicial: structuredClone(base) });
    await t.executor.execute('midi.createNotes', { pistaId, clipId, notas: [{ pitch: 70, inicio: 0, duracion: 1, velocidad: 90 }] }, 'user', 'ana');
    await t.executor.execute('midi.createNotes', { pistaId, clipId, notas: [{ pitch: 72, inicio: 1, duracion: 1, velocidad: 90 }] }, 'user', 'ia:productor');
    await t.executor.undo('ana');
    expect(notasDe(t.obtenerEstado(), pistaId, clipId).map((n) => n.pitch).sort()).toEqual([60, 72]);
    expect(t.executor.canUndo('ia:productor')).toBe(true);
  });
});
