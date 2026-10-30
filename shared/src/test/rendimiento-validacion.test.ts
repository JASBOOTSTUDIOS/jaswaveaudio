/**
 * U3 · Coste de validar el estado resultante con el esquema en cada comando.
 *
 * El executor valida solo lo que el comando tocó (`validarCambiosProyecto`):
 * 1000 `track.update` sobre un proyecto grande deben seguir siendo rápidos,
 * y el esquema completo se reserva para guardar/cargar.
 */
import { describe, it, expect } from 'vitest';
import { crearTiendaDAW } from '../state/tienda';
import { crearEstadoInicial } from '../state/estado-inicial';
import { validarProyecto } from '../schemas/proyecto';

const PISTAS = 32;
const CLIPS_POR_PISTA = 8;
const NOTAS_POR_CLIP = 64;
const COMANDOS = 1000;
/** Límite holgado para CI lento; en local tarda bastante menos. */
const LIMITE_MS = 4000;

async function proyectoGrande() {
  const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() });
  const ids: string[] = [];
  for (let p = 0; p < PISTAS; p++) {
    const r = await tienda.executor.execute('track.create', { nombre: `Pista ${p + 1}`, tipo: 'midi' });
    const trackId = (r.result as { trackId: string }).trackId;
    ids.push(trackId);
    for (let c = 0; c < CLIPS_POR_PISTA; c++) {
      const notas = Array.from({ length: NOTAS_POR_CLIP }, (_, i) => ({
        pitch: 48 + (i % 24),
        inicio: (i % 16) * 0.25,
        duracion: 0.25,
        velocidad: 90,
      }));
      const rc = await tienda.executor.execute('midi.clip.create', { pistaId: trackId, inicio: c * 4, duracion: 4, notas });
      expect(rc.success).toBe(true);
    }
  }
  return { tienda, ids };
}

describe('U3 · rendimiento de la validación con esquema', () => {
  it(`${COMANDOS} track.update con validación del estado resultante < ${LIMITE_MS} ms`, async () => {
    const { tienda, ids } = await proyectoGrande();
    const t0 = performance.now();
    for (let i = 0; i < COMANDOS; i++) {
      const r = await tienda.executor.execute('track.update', {
        trackId: ids[i % ids.length]!,
        datos: { volumen: ((i % 100) + 1) / 100 },
      });
      if (!r.success) throw new Error(r.error?.message);
    }
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(LIMITE_MS);

    // El esquema completo (lo que hace el guardado) sigue aceptando el resultado.
    expect(validarProyecto(tienda.obtenerEstado().project).ok).toBe(true);
  }, 60_000);

  it('la validación incremental sigue rechazando valores fuera del esquema', async () => {
    const { tienda, ids } = await proyectoGrande();
    const r = await tienda.executor.execute('track.update', { trackId: ids[0]!, datos: { volumen: Number.NaN } });
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('VALIDATION_FAILED');
  }, 60_000);
});
