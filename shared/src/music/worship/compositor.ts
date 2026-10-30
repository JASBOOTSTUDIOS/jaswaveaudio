/** Orquestador del motor: construye el contexto, genera cada rol, humaniza y ensambla el arreglo. */

import { construirContexto, type Ctx } from './estructura';
import { humanizarRol } from './humanizar';
import { humanizarInterpretacion } from './expresion';
import { aplicarTecnicasGuitarra } from './guitarra-tecnicas';
import { generarBajo } from './rol-bajo';
import { generarBateria } from './rol-bateria';
import { generarCuerdas } from './rol-cuerdas';
import { generarGuitarra } from './rol-guitarra';
import { generarMelodia } from './rol-melodia';
import { generarPad } from './rol-pad';
import { generarPiano } from './rol-piano';
import {
  ROLES_WORSHIP,
  type AcordeArreglo,
  type ArregloWorship,
  type EventoPitchBend,
  type MarcadorArreglo,
  type NotaWorship,
  type RolWorship,
  type SeccionArreglo,
  type SpecWorship,
} from './tipos';
import type { EventoCC } from './expresion';
import type { NotaBruta } from './util-gen';

const GENERADORES: Record<RolWorship, (ctx: Ctx) => NotaBruta[]> = {
  piano: generarPiano,
  pad: generarPad,
  cuerdas: generarCuerdas,
  bajo: generarBajo,
  bateria: generarBateria,
  guitarra: generarGuitarra,
  melodia: generarMelodia,
};

/**
 * Compone un arreglo completo de worship moderno. Puro y determinista: misma spec (misma semilla) → mismo JSON.
 * Lanza Error si la spec es inválida (compases, tipos de sección o acordes no diatónicos).
 */
export function componerWorship(spec: SpecWorship): ArregloWorship {
  const ctx = construirContexto(spec);
  const partes = {} as Record<RolWorship, NotaWorship[]>;
  const pitchBend: Partial<Record<RolWorship, EventoPitchBend[]>> = {};
  const limite = ctx.totalBeats + 8;

  for (const rol of ROLES_WORSHIP) {
    if (!ctx.rolesPermitidos.has(rol)) {
      partes[rol] = [];
      continue;
    }
    const brutas = GENERADORES[rol](ctx).filter((n) => n.inicio >= 0 && n.inicio < ctx.totalBeats);
    const { notas, bends } = humanizarRol(rol, brutas, ctx);
    partes[rol] = notas.filter((n) => n.inicio < limite);
    if (bends.length > 0) pitchBend[rol] = bends;
  }

  // Capa de interpretación (pedal, legato, acentos, bajo pegado al bombo, crash...). El micro-timing ya lo aplicó humanizarRol.
  let cc: Partial<Record<RolWorship, EventoCC[]>> | undefined;
  if (ctx.humanizacion > 0 && spec.expresion !== false) {
    const res = humanizarInterpretacion(partes, {
      semilla: ctx.semilla,
      bpm: ctx.bpm,
      beatsPorCompas: ctx.bpc,
      clipPorSeccion: false,
      timing: false,
      solapeBajo: 0,
      cantidad: ctx.humanizacion,
      cambiosAcorde: ctx.eventos.map((e) => e.inicio),
      secciones: ctx.secciones.map((s) => ({
        inicioBeat: s.inicioBeat,
        duracionBeats: s.duracionBeats,
        intensidadInicial: s.intensidadInicial,
        intensidad: s.intensidad,
        tipo: s.tipo,
      })),
    });
    for (const rol of ROLES_WORSHIP) if (res.partes[rol]) partes[rol] = res.partes[rol]!;
    if (Object.keys(res.cc).length > 0) cc = res.cc;
  }

  // Técnicas de guitarra (slides, rasgueo con dirección, palm mute, swells): keyswitches y CC que lee el plugin de guitarra.
  // Van con la humanización: con `expresion:false` o humanización 0 el arreglo queda «plano».
  if (ctx.humanizacion > 0 && spec.expresion !== false && ctx.rolesPermitidos.has('guitarra') && spec.tecnicasGuitarra !== false && partes.guitarra.length > 0) {
    const originales = new Map<string, NotaWorship>();
    for (const n of partes.guitarra) originales.set(`${n.pitch}|${n.inicio}`, n);
    const r = aplicarTecnicasGuitarra(partes.guitarra, {
      semilla: ctx.semilla,
      secciones: ctx.secciones.map((s) => ({ inicioBeat: s.inicioBeat, duracionBeats: s.duracionBeats, tipo: s.tipo })),
    });
    partes.guitarra = r.notas.map((n) => {
      const o = originales.get(`${n.pitch}|${n.inicio}`);
      return {
        ...(o ?? {}),
        pitch: n.pitch,
        inicio: n.inicio,
        duracion: n.duracion,
        velocidad: n.velocidad,
        ...(n.bend !== undefined ? { bend: n.bend } : {}),
      };
    });
    if (r.cc.length > 0) {
      cc = cc ?? {};
      cc.guitarra = [...(cc.guitarra ?? []), ...r.cc];
    }
  }

  const secciones: SeccionArreglo[] = ctx.secciones.map((s) => {
    const { eventos: _eventos, ...resto } = s;
    void _eventos;
    return resto;
  });

  const acordes: AcordeArreglo[] = ctx.eventos.map((e) => ({
    simbolo: e.acorde.simbolo,
    romano: e.acorde.romano,
    inicio: e.inicio,
    duracion: e.fin - e.inicio,
    compas: e.compas,
    seccion: e.seccion,
    pcs: e.acorde.pcs,
    raizPc: e.acorde.raizPc,
    bajoPc: e.acorde.bajoPc,
  }));

  const marcadores: MarcadorArreglo[] = ctx.secciones.map((s) => ({ nombre: s.nombre, inicio: s.inicioBeat, tipo: s.tipo }));

  return {
    version: 1,
    titulo: ctx.titulo,
    semilla: ctx.semilla,
    bpm: ctx.bpm,
    compas: ctx.compasNombre,
    beatsPorCompas: ctx.bpc,
    tonalidad: { raiz: ctx.tonal.raiz, escala: ctx.tonal.escalaNombre },
    humanizacion: ctx.humanizacion,
    estilo: ctx.estilo,
    totalCompases: ctx.totalCompases,
    duracionBeats: ctx.totalBeats,
    duracionSegundos: Math.round(((ctx.totalBeats * 60) / ctx.bpm) * 100) / 100,
    secciones,
    acordes,
    marcadores,
    partes,
    pitchBend,
    ...(cc ? { cc } : {}),
  };
}

function formatoTiempo(seg: number): string {
  const m = Math.floor(seg / 60);
  const s = Math.round(seg % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Resumen breve para el chat / la IA. */
export function resumenArreglo(a: ArregloWorship): string {
  const forma = a.secciones.map((s) => `${s.nombre} (${s.compases})`).join(' → ');
  const prog = (tipo: string) => {
    const s = a.secciones.find((x) => x.tipo === tipo);
    if (!s) return null;
    const ac = a.acordes.filter((x) => x.seccion === s.indice && x.inicio < s.inicioBeat + 4 * a.beatsPorCompas).map((x) => x.simbolo);
    return `${s.nombre}: ${ac.join(' ')}`;
  };
  const progs = ['verso', 'precoro', 'coro', 'puente'].map(prog).filter(Boolean).join(' | ');
  const notas = ROLES_WORSHIP.filter((r) => a.partes[r].length > 0)
    .map((r) => `${r} ${a.partes[r].length}`)
    .join(', ');
  return [
    `«${a.titulo}» · ${a.tonalidad.raiz} ${a.tonalidad.escala} · ${a.bpm} BPM · ${a.compas} · ${a.totalCompases} compases (${formatoTiempo(a.duracionSegundos)}) · estilo ${a.estilo} · semilla ${a.semilla}`,
    `Forma: ${forma}`,
    `Armonía (primeros 4 compases): ${progs}`,
    `Notas por rol: ${notas}`,
  ].join('\n');
}
