import { describe, it, expect } from 'vitest';
import { resolverAcciones } from '../src/license/permisos.js';

const ahora = new Date('2026-10-23T12:00:00Z');
const base = { estadoLicencia: 'activa' as const, accionesDeRoles: ['eq.banda', 'eq.exportar'], concesiones: [], ahora };

describe('licencias — resolución de permisos', () => {
  it('roles otorgan sus acciones con licencia activa', () => {
    expect(resolverAcciones(base)).toEqual(['eq.banda', 'eq.exportar']);
  });

  it('licencia suspendida, revocada o inexistente no otorga nada', () => {
    expect(resolverAcciones({ ...base, estadoLicencia: 'suspendida' })).toEqual([]);
    expect(resolverAcciones({ ...base, estadoLicencia: 'revocada' })).toEqual([]);
    expect(resolverAcciones({ ...base, estadoLicencia: null })).toEqual([]);
  });

  it('allow directo suma acciones sin rol', () => {
    const r = resolverAcciones({ ...base, accionesDeRoles: [], concesiones: [{ accionClave: 'eq.x', efecto: 'allow', expiraEn: null }] });
    expect(r).toEqual(['eq.x']);
  });

  it('deny directo quita una acción aunque venga de un rol', () => {
    const r = resolverAcciones({ ...base, concesiones: [{ accionClave: 'eq.exportar', efecto: 'deny', expiraEn: null }] });
    expect(r).toEqual(['eq.banda']);
  });

  it('una concesión expirada no cuenta', () => {
    const pasado = new Date('2026-10-01T00:00:00Z');
    const r = resolverAcciones({ ...base, accionesDeRoles: [], concesiones: [{ accionClave: 'eq.x', efecto: 'allow', expiraEn: pasado }] });
    expect(r).toEqual([]);
  });

  it('deny vigente gana sobre allow de la misma acción', () => {
    const r = resolverAcciones({
      ...base,
      accionesDeRoles: [],
      concesiones: [
        { accionClave: 'eq.x', efecto: 'allow', expiraEn: null },
        { accionClave: 'eq.x', efecto: 'deny', expiraEn: null },
      ],
    });
    expect(r).toEqual([]);
  });
});
