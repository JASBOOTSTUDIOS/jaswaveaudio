/**
 * Auditoría de proyecto (A9) - audit.project
 *
 * Unifica las comprobaciones de `production-audit.ts` (A5) y `inspectDawHealth` (A1)
 * con nuevas comprobaciones del plan A9: media faltante, valores inválidos,
 * plugins en cuarentena/bypass y ruteo roto.
 *
 * No muta nada: solo lee el estado y devuelve incidencias + evidencia.
 */

import type { DAWState } from '@jaswave/shared';
import type { Track, Clip, MidiClip } from '@jaswave/shared';
import type { AuditEvidence, AuditProjectInput, AuditProjectResultado, AuditSeverity } from './schemas';

export type ProjectIssue = {
  severidad: AuditSeverity;
  mensaje: string;
  codigo: string;
  pistaId?: string;
  pista?: string;
};

function isMidiLike(tipo: string): boolean {
  return tipo === 'midi' || tipo === 'instrumento' || tipo === 'audio';
}

function noteCount(clip: { notas?: unknown[] }): number {
  return Array.isArray(clip.notas) ? clip.notas.length : 0;
}

function duplicateNotes(clip: { notas?: Array<{ pitch: number; inicio: number }> }): number {
  const notas = clip.notas ?? [];
  const seen = new Set<string>();
  let dups = 0;
  for (const n of notas) {
    const key = `${n.pitch}@${n.inicio.toFixed(4)}`;
    if (seen.has(key)) dups += 1;
    else seen.add(key);
  }
  return dups;
}

/** Comprobaciones puras sobre el estado del DAW. */
export function auditarProyecto(state: DAWState): {
  incidencias: ProjectIssue[];
  evidencia: AuditEvidence[];
  resumen: {
    pistas: number;
    clips: number;
    notas: number;
    plugins: number;
    envios: number;
    sidechains: number;
  };
} {
  const incidencias: ProjectIssue[] = [];
  const evidencia: AuditEvidence[] = [];
  const tracks: Track[] = (state.project?.tracks ?? []) as Track[];

  let clips = 0;
  let notas = 0;
  let plugins = 0;
  let envios = 0;
  let sidechains = 0;

  const haySolo = tracks.some((t) => Boolean((t as { soloActiva?: boolean }).soloActiva));

  for (const t of tracks) {
    const nombre = t.nombre || t.id;
    const chain = t.plugins ?? [];
    plugins += chain.length;

    if (!String(t.nombre ?? '').trim()) {
      incidencias.push({ severidad: 'warning', mensaje: 'Pista sin nombre', codigo: 'pista-sin-nombre', pistaId: t.id });
    }

    // Instrumentos sin cargar / plugins en error o cuarentena.
    const enError = chain.filter((p) => p.estado === 'error');
    if (enError.length) {
      incidencias.push({
        severidad: 'error',
        mensaje: `Plugins en error: ${enError.map((p) => p.nombre).join(', ')}`,
        codigo: 'plugin-error',
        pistaId: t.id,
        pista: nombre,
      });
    }
    const pendiente = chain.filter((p) => p.estado === 'pendiente');
    if (pendiente.length) {
      incidencias.push({
        severidad: 'warning',
        mensaje: `Plugins sin cargar: ${pendiente.map((p) => p.nombre).join(', ')}`,
        codigo: 'plugin-pendiente',
        pistaId: t.id,
        pista: nombre,
      });
    }
    const bypass = chain.filter((p) => p.bypass);
    if (bypass.length && chain.length > 0) {
      incidencias.push({
        severidad: 'warning',
        mensaje: `Plugins en bypass: ${bypass.map((p) => p.nombre).join(', ')}`,
        codigo: 'plugin-bypass',
        pistaId: t.id,
        pista: nombre,
      });
    }

    // Pista MIDI sin instrumento.
    if (isMidiLike(t.tipo) && chain.length === 0 && t.tipo !== 'audio') {
      incidencias.push({
        severidad: 'error',
        mensaje: 'Pista MIDI sin instrumento cargado',
        codigo: 'missing-instrument',
        pistaId: t.id,
        pista: nombre,
      });
    }

    // Clips y notas.
    const clipsPista = t.clips ?? [];
    clips += clipsPista.length;
    let notasPista = 0;
    for (const c of clipsPista) {
      if (c.tipo === 'midi') {
        const mc = c as MidiClip;
        const n = noteCount(mc);
        notasPista += n;
        if (isMidiLike(t.tipo) && n === 0) {
          incidencias.push({
            severidad: 'warning',
            mensaje: `Clip MIDI vacío: ${mc.nombre || mc.id}`,
            codigo: 'clip-vacio',
            pistaId: t.id,
            pista: nombre,
          });
        }
        const dups = duplicateNotes(mc);
        if (dups > 0) {
          incidencias.push({
            severidad: 'warning',
            mensaje: `${dups} nota(s) duplicada(s) en ${mc.nombre || mc.id}`,
            codigo: 'notas-duplicadas',
            pistaId: t.id,
            pista: nombre,
          });
        }
        for (const nota of mc.notas ?? []) {
          if (!Number.isInteger(nota.pitch) || nota.pitch < 0 || nota.pitch > 127) {
            incidencias.push({
              severidad: 'error',
              mensaje: `Nota fuera de rango (${nota.pitch}) en ${mc.nombre || mc.id}`,
              codigo: 'nota-fuera-de-rango',
              pistaId: t.id,
              pista: nombre,
            });
            break;
          }
        }
      } else if (c.tipo === 'audio') {
        const ac = c as Clip & { source?: { ruta?: string } };
        const src = ac.source;
        if (!src?.ruta) {
          incidencias.push({
            severidad: 'error',
            mensaje: `Clip de audio sin medio: ${ac.nombre || ac.id}`,
            codigo: 'media-faltante',
            pistaId: t.id,
            pista: nombre,
          });
        }
      } else {
        const n = noteCount(c as { notas?: unknown[] });
        notasPista += n;
      }
    }
    notas += notasPista;

    // Pista muda con contenido.
    if (Boolean(t.silenciada) && (clipsPista.length > 0 || notasPista > 0)) {
      incidencias.push({
        severidad: 'warning',
        mensaje: 'Pista silenciada con contenido',
        codigo: 'pista-muda-con-contenido',
        pistaId: t.id,
        pista: nombre,
      });
    }

    // Solo olvidado: más de una pista con contenido y ninguna en solo.
    if (!haySolo && tracks.length > 1) {
      const conContenido = tracks.filter((x) => (x.clips ?? []).length > 0);
      if (conContenido.length > 1) {
        incidencias.push({
          severidad: 'info',
          mensaje: 'Ninguna pista está en solo: revisa si se esperaba aislar una fuente',
          codigo: 'solo-olvidado',
        });
      }
    }

    // Valores inválidos de mezcla.
    if (typeof t.volumen === 'number' && (t.volumen < -80 || t.volumen > 12)) {
      incidencias.push({
        severidad: 'warning',
        mensaje: `Volumen fuera de rango (${t.volumen})`,
        codigo: 'volumen-invalido',
        pistaId: t.id,
        pista: nombre,
      });
    }
    if (typeof t.paneo === 'number' && (t.paneo < -1 || t.paneo > 1)) {
      incidencias.push({
        severidad: 'warning',
        mensaje: `Paneo fuera de rango (${t.paneo})`,
        codigo: 'paneo-invalido',
        pistaId: t.id,
        pista: nombre,
      });
    }
  }

  // Ruteo roto.
  const routing = state.project?.routing;
  const sends = routing?.sends ?? [];
  const scs = routing?.sidechains ?? [];
  envios = sends.length;
  sidechains = scs.length;
  const trackIds = new Set(tracks.map((t) => t.id));
  for (const s of sends) {
    if (!trackIds.has(s.origenTrackId)) {
      incidencias.push({
        severidad: 'error',
        mensaje: `Envío desde una pista inexistente (${s.origenTrackId})`,
        codigo: 'ruteo-roto',
      });
    }
  }
  for (const sc of scs) {
    if (!trackIds.has(sc.origenTrackId) || !trackIds.has(sc.destinoTrackId)) {
      incidencias.push({
        severidad: 'error',
        mensaje: `Sidechain con pista inexistente (${sc.origenTrackId} → ${sc.destinoTrackId})`,
        codigo: 'ruteo-roto',
      });
    }
  }
  for (const v of routing?.validacion?.errores ?? []) {
    incidencias.push({
      severidad: v.severidad === 'error' ? 'error' : 'warning',
      mensaje: v.mensaje,
      codigo: `ruteo-${v.tipo}`,
    });
  }

  if (tracks.length === 0) {
    incidencias.push({ severidad: 'error', mensaje: 'El proyecto no tiene pistas', codigo: 'sin-pistas' });
  }

  evidencia.push({
    tipo: 'snapshot',
    descripcion: `${tracks.length} pista(s), ${clips} clip(s), ${notas} nota(s), ${plugins} plugin(s), ${envios} envío(s), ${sidechains} sidechain(s)`,
  });

  return {
    incidencias,
    evidencia,
    resumen: { pistas: tracks.length, clips, notas, plugins, envios, sidechains },
  };
}

/** Auditoría de proyecto lista para `audit.project`. */
export function auditProject(input: AuditProjectInput): AuditProjectResultado {
  const ctx = (input as AuditProjectInput & { contexto?: { estado?: DAWState; incidenciasAceptadas?: AuditProjectResultado['incidenciasAceptadas'] } }).contexto;
  const state = ctx?.estado;
  const items: AuditProjectResultado['items'] = [];
  const evidencia: AuditEvidence[] = [];

  if (state) {
    const { incidencias, evidencia: ev, resumen } = auditarProyecto(state);
    evidencia.push(...ev);
    const errores = incidencias.filter((i) => i.severidad === 'error' || i.severidad === 'critical');
    const avisos = incidencias.filter((i) => i.severidad === 'warning');
    items.push({
      id: 'estructura',
      tipo: 'global',
      titulo: 'Estructura del proyecto',
      cumple: errores.length === 0,
      evidencia: ev,
      incidencias: errores.map((i) => ({ severidad: i.severidad, mensaje: i.mensaje, codigo: i.codigo })),
    });
    items.push({
      id: 'avisos',
      tipo: 'global',
      titulo: `Avisos (${avisos.length})`,
      cumple: avisos.length === 0,
      evidencia: [],
      incidencias: avisos.map((i) => ({ severidad: i.severidad, mensaje: i.mensaje, codigo: i.codigo })),
    });
    evidencia.push({
      tipo: 'medicion',
      descripcion: `Estructura: ${resumen.pistas} pistas · ${resumen.clips} clips · ${resumen.notas} notas`,
      valor: resumen,
    });
  } else {
    items.push({
      id: 'estructura',
      tipo: 'global',
      titulo: 'Estructura del proyecto',
      cumple: true,
      evidencia: [{ tipo: 'otro', descripcion: 'Sin estado del DAW disponible para auditar' }],
      incidencias: [],
    });
  }

  const cumplidos = items.filter((i) => i.cumple).length;
  const fallidos = items.filter((i) => !i.cumple).length;
  const aceptadas = ctx?.incidenciasAceptadas;

  return {
    limpio: fallidos === 0,
    cumplidos,
    fallidos,
    items,
    incidenciasAceptadas: aceptadas,
    evidencia,
    timestamp: Date.now(),
  };
}
