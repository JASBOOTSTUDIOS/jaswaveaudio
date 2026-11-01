/**
 * Conversión de un ArregloWorship a la lista de acciones de comando existentes del DAW
 * (project.setBpm, project.update, track.create, midi.clip.create, marker.create).
 * Ejecutar con `tienda.executor.batch(acciones)` (una sola entrada de undo) o una a una con `execute`.
 */

import { formatKeyLabel } from '../project-key';
import { RAIZ_PC } from './armonia';
import type { EventoCC } from './expresion';
import {
  COLOR_PISTA_ROL,
  NOMBRE_PISTA_ROL,
  ROLES_WORSHIP,
  type ArregloWorship,
  type RolWorship,
} from './tipos';

export interface OpcionesComandosWorship {
  /** Nombre del plugin/VST que la app asignará después a cada pista (no forma parte del payload del comando). */
  nombrePluginPorRol?: Partial<Record<RolWorship, string>>;
  /** Fija el BPM del proyecto (por defecto true). */
  ajustarBpm?: boolean;
  /** Fija compás y tonalidad del proyecto (por defecto true). */
  ajustarTonalidad?: boolean;
  /** Crea marcadores de sección (por defecto true). */
  crearMarcadores?: boolean;
  /** Tipo de pista (por defecto 'midi'). */
  tipoPista?: 'midi' | 'instrumento';
  /** Sólo estos roles (por defecto todos los que tienen notas). */
  roles?: RolWorship[];
  /** Un clip por sección en lugar de un clip por rol. */
  clipPorSeccion?: boolean;
  /** Desplaza todo (en beats) desde el inicio del proyecto. */
  inicioBeat?: number;
  /** Añade los controladores del arreglo (CC64 pedal, CC11 expresión) como expresión del clip (por defecto true si existen). */
  incluirCC?: boolean;
  /** Prefijo para el nombre de las pistas y el id estable. */
  prefijoId?: string;
}

export interface AccionWorship {
  type: string;
  payload: Record<string, unknown>;
  /** Rol de la pista afectada (metadatos para la app; el executor lo ignora). */
  rol?: RolWorship;
  /** Plugin sugerido para la pista (metadatos para la app). */
  plugin?: string;
}

export function idPistaWorship(a: ArregloWorship, rol: RolWorship, prefijo = 'worship'): string {
  return `${prefijo}-${a.semilla}-${rol}`;
}

const NOMBRE_CC: Record<number, string> = { 64: 'Sustain', 11: 'Expresión' };

/** Acciones `midi.setCC` (una por controlador) que fijan las lanes de CC de un clip; tiempos relativos al clip, valor 0..1. */
export function accionesExpresionClip(pistaId: string, clipId: string, eventos: EventoCC[], inicioClip: number, rol?: RolWorship): AccionWorship[] {
  const porCc = new Map<number, EventoCC[]>();
  for (const e of eventos) porCc.set(e.cc, [...(porCc.get(e.cc) ?? []), e]);
  return [...porCc.entries()].map(([num, evs]) => ({
    type: 'midi.setCC',
    payload: {
      pistaId,
      clipId,
      cc: num,
      nombre: NOMBRE_CC[num] ?? `CC${num}`,
      puntos: evs.map((e) => ({
        tiempo: Math.round(Math.max(0, e.tiempo - inicioClip) * 100000) / 100000,
        valor: Math.max(0, Math.min(1, e.valor)),
      })),
    },
    ...(rol ? { rol } : {}),
  }));
}

export function arregloAComandos(a: ArregloWorship, opciones: OpcionesComandosWorship = {}): AccionWorship[] {
  const acciones: AccionWorship[] = [];
  const offset = opciones.inicioBeat ?? 0;
  const prefijo = opciones.prefijoId ?? 'worship';
  const roles = (opciones.roles ?? ROLES_WORSHIP).filter((r) => a.partes[r].length > 0);

  if (opciones.ajustarBpm !== false) acciones.push({ type: 'project.setBpm', payload: { bpm: a.bpm } });
  if (opciones.ajustarTonalidad !== false) {
    const root = RAIZ_PC[a.tonalidad.raiz];
    const mode = a.tonalidad.escala === 'mayor' ? 'major' : 'minor';
    acciones.push({
      type: 'project.update',
      payload: {
        datos: {
          timeSignature: a.compas === '4/4' ? { numerador: 4, denominador: 4 } : { numerador: 6, denominador: 8 },
          tonalidad: { enabled: true, label: formatKeyLabel(root, mode), root, mode },
        },
      },
    });
  }

  for (const rol of roles) {
    acciones.push({
      type: 'track.create',
      payload: {
        nombre: NOMBRE_PISTA_ROL[rol],
        tipo: opciones.tipoPista ?? 'midi',
        color: COLOR_PISTA_ROL[rol],
        id: idPistaWorship(a, rol, prefijo),
      },
      rol,
      plugin: opciones.nombrePluginPorRol?.[rol],
    });
  }

  const conCC = opciones.incluirCC ?? true;
  const pushCC = (rol: RolWorship, pistaId: string, clipId: string, desde: number, hasta: number, inicioClip: number) => {
    const evs = (conCC ? a.cc?.[rol] : undefined)?.filter((e) => e.tiempo >= desde - 1e-9 && e.tiempo <= hasta + 1e-9);
    if (!evs || evs.length === 0) return;
    const accs = accionesExpresionClip(pistaId, clipId, evs.map((e) => ({ ...e, tiempo: e.tiempo - desde + inicioClip })), inicioClip, rol);
    acciones.push(...accs);
  };

  for (const rol of roles) {
    const pistaId = idPistaWorship(a, rol, prefijo);
    const notas = a.partes[rol];
    const nombre = NOMBRE_PISTA_ROL[rol];
    const mapear = (n: (typeof notas)[number], base: number) => ({
      pitch: n.pitch,
      inicio: Math.round((n.inicio - base) * 100000) / 100000,
      duracion: n.duracion,
      velocidad: n.velocidad,
    });
    if (opciones.clipPorSeccion) {
      a.secciones.forEach((s, i) => {
        const fin = s.inicioBeat + s.duracionBeats;
        const delClip = notas.filter((n) => n.inicio >= s.inicioBeat - 1e-9 && n.inicio < fin - 1e-9);
        if (delClip.length === 0) return;
        acciones.push({
          type: 'midi.clip.create',
          payload: {
            pistaId,
            nombre: `${nombre} · ${s.nombre}`,
            inicio: s.inicioBeat + offset,
            duracion: s.duracionBeats,
            color: COLOR_PISTA_ROL[rol],
            id: `${pistaId}-s${i}`,
            notas: delClip.map((n) => mapear(n, s.inicioBeat)),
          },
          rol,
        });
        pushCC(rol, pistaId, `${pistaId}-s${i}`, s.inicioBeat, fin, s.inicioBeat + offset);
      });
    } else {
      acciones.push({
        type: 'midi.clip.create',
        payload: {
          pistaId,
          nombre: `${nombre} · ${a.titulo}`,
          inicio: offset,
          duracion: a.duracionBeats,
          color: COLOR_PISTA_ROL[rol],
          id: `${pistaId}-clip`,
          notas: notas.map((n) => mapear(n, 0)),
        },
        rol,
      });
      pushCC(rol, pistaId, `${pistaId}-clip`, 0, a.duracionBeats, offset);
    }
  }

  if (opciones.crearMarcadores !== false) {
    for (const m of a.marcadores) {
      acciones.push({ type: 'marker.create', payload: { nombre: m.nombre, tiempo: m.inicio + offset } });
    }
  }
  return acciones;
}
