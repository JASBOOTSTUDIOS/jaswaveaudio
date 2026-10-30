import { describe, it, expect } from 'vitest';
import { crearTiendaDAW } from '../state/tienda';
import { crearEstadoInicial } from '../state/estado-inicial';
import { crearPermissionManager } from '../state/permissions';

describe('tienda: permisos en el pipeline de comandos', () => {
  const crear = (level: 'READ_ONLY' | 'SUGGEST' | 'CONFIRM' | 'FULL_AUTONOMY') => {
    const permisos = crearPermissionManager();
    permisos.setUserConfig({ level, overrides: [], allowUnsafeTools: false }, 'user');
    return crearTiendaDAW({ estadoInicial: crearEstadoInicial(), permisos });
  };

  it('READ_ONLY bloquea escrituras de la IA', async () => {
    const tienda = crear('READ_ONLY');
    const r = await tienda.executor.execute('track.create', { nombre: 'IA', tipo: 'midi' }, 'ai');
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('VALIDATION_FAILED');
    expect(tienda.obtenerEstado().project.tracks.some((t) => t.nombre === 'IA')).toBe(false);
  });

  it('READ_ONLY no bloquea al usuario', async () => {
    const tienda = crear('READ_ONLY');
    const r = await tienda.executor.execute('track.create', { nombre: 'Usuario', tipo: 'midi' }, 'user');
    expect(r.success).toBe(true);
  });

  it('SUGGEST bloquea comandos peligrosos de la IA', async () => {
    const tienda = crear('CONFIRM');
    await tienda.executor.execute('track.create', { nombre: 'A', tipo: 'midi' }, 'user');
    const pista = tienda.obtenerEstado().project.tracks.find((t) => t.nombre === 'A')!;
    tienda.permisos.requestLevelChange('SUGGEST', 'user');
    const r = await tienda.executor.execute('track.delete', { trackId: pista.id }, 'ai');
    expect(r.success).toBe(false);
  });

  it('CONFIRM permite a la IA (la confirmación previa es de la UI)', async () => {
    const tienda = crear('CONFIRM');
    const r = await tienda.executor.execute('track.create', { nombre: 'IA', tipo: 'midi' }, 'ai');
    expect(r.success).toBe(true);
  });
});
