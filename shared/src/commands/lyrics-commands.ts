/**
 * Comandos de letra y acordes del arreglo (`lyrics.*`, `chords.*`).
 *
 * Todos escriben `project.letra` y dejan undo por instantánea parcial del proyecto. Los de lectura
 * (`chords.get`, `lyrics.get`) devuelven el estado sin tocarlo. `chords.set` y `lyrics.set` son las
 * herramientas de la IA (texto libre); `lyrics.setPhrases`, `lyrics.setChords`, `chords.upsert`…
 * son las operaciones finas que usa la UI.
 */

import type { CommandDefinition, StateTransition } from '../types/command';
import type { DAWState } from '../types/state';
import type { ProjectState } from '../types/proyecto';
import type { AcordeCarril, FraseLetra, LetraProyecto, SilabaLetra } from '../types/lyrics';
import type { Marcador } from '../types/entidades';
import { EventosProyecto } from '../constants/nombres-eventos';
import { entorno } from '../state/entorno-determinista';
import { intentarParsearAcorde } from '../music/acordes';
import { acordesComoTexto, acordesDesdeTexto, repartirLetra, silabasDeLinea, temporizarFrase } from '../music/letra';

const FUENTE = 'lyrics-commands';
const redondear = (x: number) => Math.round(x * 1000) / 1000;

function letraDe(estado: DAWState): LetraProyecto {
  return estado.project.letra ?? { frases: [], acordes: [] };
}

function conLetra(estado: DAWState, letra: LetraProyecto, detalle: Record<string, unknown>, marcadores?: Marcador[]): StateTransition<Record<string, unknown>> {
  const proyecto: ProjectState = {
    ...estado.project,
    letra,
    ...(marcadores ? { marcadores } : {}),
    modificado: true,
    fechaModificacion: entorno.ahora(),
  };
  return {
    state: { ...estado, project: proyecto },
    events: [{ nombre: EventosProyecto.modificado, version: 1, marcaTiempo: entorno.ahora(), fuente: FUENTE, payload: detalle as never }],
    result: detalle,
  };
}

function lectura<T extends Record<string, unknown>>(estado: DAWState, result: T): StateTransition<T> {
  return { state: estado, events: [], result };
}

const ordenarAcordes = (acordes: AcordeCarril[]): AcordeCarril[] => [...acordes].sort((a, b) => a.beat - b.beat);

/** Normaliza un acorde de entrada (nombre parseable, beat ≥ 0, duración > 0). Lanza con mensaje claro. */
function acordeEntrada(a: AcordeEntrada, numerador: number, idPrevio?: string): AcordeCarril {
  const parsed = intentarParsearAcorde(String(a.nombre ?? ''));
  if (!parsed) throw new Error(`Acorde no reconocido: «${String(a.nombre)}»`);
  const beat = a.beat ?? (a.compas !== undefined ? (a.compas - 1) * numerador : undefined);
  if (beat === undefined || !Number.isFinite(beat) || beat < 0) throw new Error(`El acorde «${parsed.nombre}» necesita beat ≥ 0 o compás ≥ 1`);
  const duracion = a.duracion ?? numerador;
  if (!Number.isFinite(duracion) || duracion <= 0) throw new Error(`La duración del acorde «${parsed.nombre}» debe ser mayor que 0`);
  const pitches = Array.isArray(a.pitches) ? a.pitches.filter((p) => Number.isInteger(p) && p >= 0 && p <= 127) : undefined;
  return {
    id: a.id ?? idPrevio ?? entorno.uuid(),
    nombre: parsed.nombre,
    beat: redondear(beat),
    duracion: redondear(duracion),
    ...(pitches && pitches.length ? { pitches } : {}),
  };
}

const numeradorDe = (estado: DAWState) => Math.max(1, Number(estado.project.timeSignature?.numerador ?? 4) || 4);

const esquemaAcorde = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    nombre: { type: 'string', description: 'Cifrado americano: D, Bm7, G/B, A7sus4, F#m7b5, Cmaj9…' },
    beat: { type: 'number', description: 'Beat absoluto (0 = inicio). Alternativa: compas.' },
    compas: { type: 'number', description: 'Número de compás (1 = primero); el acorde empieza al inicio del compás.' },
    duracion: { type: 'number', description: 'Beats; por defecto un compás.' },
    pitches: { type: 'array', items: { type: 'number' } },
  },
  required: ['nombre'],
};

const esquemaFrase = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    texto: { type: 'string' },
    seccion: { type: 'string' },
    inicioBeat: { type: 'number' },
    duracionBeats: { type: 'number' },
    silabas: {
      type: 'array',
      items: {
        type: 'object',
        properties: { texto: { type: 'string' }, beat: { type: 'number' }, duracion: { type: 'number' }, nota: { type: 'number' }, finPalabra: { type: 'boolean' } },
        required: ['texto', 'beat', 'duracion'],
      },
    },
  },
  required: ['texto'],
};

// ── Tipos de payload ───────────────────────────────────────────

export type AcordeEntrada = { id?: string; nombre: string; beat?: number; compas?: number; duracion?: number; pitches?: number[] };
export type FraseEntrada = { id?: string; texto: string; seccion?: string; inicioBeat?: number; duracionBeats?: number; silabas?: SilabaLetra[] };
export type SeccionEntrada = { nombre: string; compases: number; acordes: string[] };

export type LyricsSetPhrasesPayload = { frases?: FraseEntrada[]; texto?: string; inicioBeat?: number; compasesPorFrase?: number };
export type LyricsAlignTimingPayload = {
  /** Sílabas sueltas: nuevo beat (y duración) de la sílaba `indice` de la frase. */
  cambios?: Array<{ fraseId: string; indice: number; beat: number; duracion?: number }>;
  /** Frases enteras: se reparten sus sílabas por igual entre inicioBeat y inicioBeat+duracionBeats. */
  frases?: Array<{ id: string; inicioBeat: number; duracionBeats: number }>;
};
export type LyricsSetChordsPayload = { acordes: AcordeEntrada[] };
export type ChordsUpsertPayload = AcordeEntrada;
export type ChordsRemovePayload = { id: string };
export type ChordsMovePayload = { id: string; beat: number; duracion?: number };
export type LyricsClearPayload = { que?: 'todo' | 'letra' | 'acordes' };
export type ChordsSetPayload = {
  acordes?: AcordeEntrada[];
  /** «| D | Bm | G A |» o «D Bm G A» (un compás por barra). */
  texto?: string;
  /** Hoja de ruta por secciones: crea además un marcador por sección si no existe. */
  secciones?: SeccionEntrada[];
  /** Compás (1 = primero) donde empieza el texto o las secciones. */
  compasInicio?: number;
};
export type LyricsSetPayload = { texto: string; inicioBeat?: number; compasesPorFrase?: number; frases?: FraseEntrada[] };

// ── Helpers de frases ──────────────────────────────────────────

function fraseEntrada(f: FraseEntrada, numerador: number, porDefecto: { beat: number; compases: number }): FraseLetra {
  const texto = String(f.texto ?? '').trim();
  if (!texto) throw new Error('Una frase de la letra no puede estar vacía');
  let silabas: SilabaLetra[];
  if (Array.isArray(f.silabas) && f.silabas.length > 0) {
    silabas = f.silabas.map((s) => {
      if (!Number.isFinite(s.beat) || s.beat < 0 || !Number.isFinite(s.duracion) || s.duracion <= 0) throw new Error(`Sílaba «${s.texto}» con tiempos no válidos`);
      return { texto: String(s.texto), beat: redondear(s.beat), duracion: redondear(s.duracion), ...(s.nota !== undefined ? { nota: s.nota } : {}), ...(s.finPalabra !== undefined ? { finPalabra: s.finPalabra } : {}) };
    });
  } else {
    const inicio = f.inicioBeat ?? porDefecto.beat;
    const dur = f.duracionBeats ?? porDefecto.compases * numerador;
    if (!Number.isFinite(inicio) || inicio < 0 || !Number.isFinite(dur) || dur <= 0) throw new Error(`La frase «${texto}» tiene tiempos no válidos`);
    silabas = temporizarFrase(texto, inicio, dur);
  }
  return { id: f.id ?? entorno.uuid(), texto, silabas, ...(f.seccion ? { seccion: f.seccion } : {}) };
}

function seccionesDeMarcadores(estado: DAWState): Array<{ nombre: string; beat: number }> {
  return (estado.project.marcadores ?? [])
    .filter((m) => m.tipo === 'marcador' && Number.isFinite(m.tiempo))
    .map((m) => ({ nombre: m.nombre, beat: m.tiempo }))
    .sort((a, b) => a.beat - b.beat);
}

function frasesDesdePayload(estado: DAWState, p: { frases?: FraseEntrada[]; texto?: string; inicioBeat?: number; compasesPorFrase?: number }): FraseLetra[] {
  const numerador = numeradorDe(estado);
  if (Array.isArray(p.frases) && p.frases.length > 0) {
    let beat = p.inicioBeat ?? 0;
    const compases = Math.max(1, p.compasesPorFrase ?? 2);
    return p.frases.map((f) => {
      const frase = fraseEntrada(f, numerador, { beat, compases });
      const ultima = frase.silabas[frase.silabas.length - 1];
      beat = ultima ? redondear(ultima.beat + ultima.duracion) : beat + compases * numerador;
      return frase;
    });
  }
  const texto = String(p.texto ?? '');
  if (!texto.trim()) return [];
  const secciones = p.inicioBeat === undefined && p.compasesPorFrase === undefined ? seccionesDeMarcadores(estado) : [];
  return repartirLetra(texto, { numerador, inicioBeat: p.inicioBeat, compasesPorFrase: p.compasesPorFrase, secciones, id: () => entorno.uuid() });
}

// ── lyrics.setPhrases ──────────────────────────────────────────

export function crearComandoLyricsSetPhrases(): CommandDefinition<LyricsSetPhrasesPayload, Record<string, unknown>> {
  return {
    type: 'lyrics.setPhrases',
    historialUndo: 'instantanea',
    description: 'Reemplaza la letra del proyecto: frases con sílabas temporizadas, o texto pegado que se reparte por secciones (marcadores) o por compases',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        frases: { type: 'array', items: esquemaFrase },
        texto: { type: 'string', description: 'Letra en líneas; estrofas separadas por línea en blanco.' },
        inicioBeat: { type: 'number' },
        compasesPorFrase: { type: 'number' },
      },
      additionalProperties: false,
    },
    handler: (estado, payload) => {
      const frases = frasesDesdePayload(estado, payload);
      return conLetra(estado, { ...letraDe(estado), frases }, { frases: frases.length, silabas: frases.reduce((n, f) => n + f.silabas.length, 0) });
    },
  };
}

// ── lyrics.alignTiming ─────────────────────────────────────────

export function crearComandoLyricsAlignTiming(): CommandDefinition<LyricsAlignTimingPayload, Record<string, unknown>> {
  return {
    type: 'lyrics.alignTiming',
    historialUndo: 'instantanea',
    description: 'Mueve sílabas (beat/duración) o reparte una frase entera entre dos beats',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        cambios: {
          type: 'array',
          items: {
            type: 'object',
            properties: { fraseId: { type: 'string' }, indice: { type: 'number' }, beat: { type: 'number' }, duracion: { type: 'number' } },
            required: ['fraseId', 'indice', 'beat'],
          },
        },
        frases: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, inicioBeat: { type: 'number' }, duracionBeats: { type: 'number' } }, required: ['id', 'inicioBeat', 'duracionBeats'] },
        },
      },
      additionalProperties: false,
    },
    handler: (estado, payload) => {
      const letra = letraDe(estado);
      let frases = letra.frases;
      let tocadas = 0;
      for (const f of payload.frases ?? []) {
        if (!Number.isFinite(f.inicioBeat) || f.inicioBeat < 0 || !Number.isFinite(f.duracionBeats) || f.duracionBeats <= 0) throw new Error('Tiempos de frase no válidos');
        frases = frases.map((x) => {
          if (x.id !== f.id) return x;
          tocadas++;
          const sil = temporizarFrase(x.texto, f.inicioBeat, f.duracionBeats);
          // Conservar notas ya asignadas por índice.
          return { ...x, silabas: sil.map((s, i) => (x.silabas[i]?.nota !== undefined ? { ...s, nota: x.silabas[i]!.nota } : s)) };
        });
      }
      for (const c of payload.cambios ?? []) {
        if (!Number.isFinite(c.beat) || c.beat < 0 || (c.duracion !== undefined && !(c.duracion > 0))) throw new Error('Tiempos de sílaba no válidos');
        frases = frases.map((x) => {
          if (x.id !== c.fraseId || !x.silabas[c.indice]) return x;
          tocadas++;
          const silabas = x.silabas.map((s, i) => (i === c.indice ? { ...s, beat: redondear(c.beat), ...(c.duracion !== undefined ? { duracion: redondear(c.duracion) } : {}) } : s));
          return { ...x, silabas };
        });
      }
      if (tocadas === 0) throw new Error('No se encontró ninguna frase o sílaba que ajustar');
      return conLetra(estado, { ...letra, frases }, { ajustes: tocadas });
    },
  };
}

// ── lyrics.setChords ───────────────────────────────────────────

export function crearComandoLyricsSetChords(): CommandDefinition<LyricsSetChordsPayload, Record<string, unknown>> {
  return {
    type: 'lyrics.setChords',
    historialUndo: 'instantanea',
    description: 'Reemplaza todos los acordes del carril',
    risk: 'write',
    schema: { type: 'object', properties: { acordes: { type: 'array', items: esquemaAcorde } }, required: ['acordes'], additionalProperties: false },
    handler: (estado, payload) => {
      const numerador = numeradorDe(estado);
      const acordes = ordenarAcordes(payload.acordes.map((a) => acordeEntrada(a, numerador)));
      return conLetra(estado, { ...letraDe(estado), acordes }, { acordes: acordes.length });
    },
  };
}

// ── chords.upsert / remove / move ──────────────────────────────

export function crearComandoChordsUpsert(): CommandDefinition<ChordsUpsertPayload, Record<string, unknown>> {
  return {
    type: 'chords.upsert',
    historialUndo: 'instantanea',
    description: 'Añade un acorde al carril o cambia uno existente (por id, o el que empieza en ese beat)',
    risk: 'write',
    schema: { ...esquemaAcorde, additionalProperties: false },
    handler: (estado, payload) => {
      const numerador = numeradorDe(estado);
      const letra = letraDe(estado);
      const beatPedido = payload.beat ?? (payload.compas !== undefined ? (payload.compas - 1) * numerador : undefined);
      const existente = letra.acordes.find((a) => (payload.id ? a.id === payload.id : beatPedido !== undefined && Math.abs(a.beat - beatPedido) < 1e-6));
      const nuevo = acordeEntrada({ ...payload, beat: beatPedido ?? existente?.beat, duracion: payload.duracion ?? existente?.duracion }, numerador, existente?.id);
      const acordes = ordenarAcordes([...letra.acordes.filter((a) => a.id !== nuevo.id), nuevo]);
      const t = conLetra(estado, { ...letra, acordes }, { id: nuevo.id, nombre: nuevo.nombre, beat: nuevo.beat });
      return { ...t, redoPayload: { ...payload, id: nuevo.id } };
    },
  };
}

export function crearComandoChordsRemove(): CommandDefinition<ChordsRemovePayload, Record<string, unknown>> {
  return {
    type: 'chords.remove',
    historialUndo: 'instantanea',
    description: 'Quita un acorde del carril',
    risk: 'write',
    schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    handler: (estado, payload) => {
      const letra = letraDe(estado);
      if (!letra.acordes.some((a) => a.id === payload.id)) throw new Error(`No existe el acorde ${payload.id}`);
      return conLetra(estado, { ...letra, acordes: letra.acordes.filter((a) => a.id !== payload.id) }, { id: payload.id });
    },
  };
}

export function crearComandoChordsMove(): CommandDefinition<ChordsMovePayload, Record<string, unknown>> {
  return {
    type: 'chords.move',
    historialUndo: 'instantanea',
    description: 'Mueve un acorde a otro beat (y opcionalmente cambia su duración)',
    risk: 'write',
    schema: { type: 'object', properties: { id: { type: 'string' }, beat: { type: 'number' }, duracion: { type: 'number' } }, required: ['id', 'beat'], additionalProperties: false },
    handler: (estado, payload) => {
      const letra = letraDe(estado);
      if (!letra.acordes.some((a) => a.id === payload.id)) throw new Error(`No existe el acorde ${payload.id}`);
      if (!Number.isFinite(payload.beat) || payload.beat < 0) throw new Error('El beat del acorde no puede ser negativo');
      if (payload.duracion !== undefined && !(payload.duracion > 0)) throw new Error('La duración del acorde debe ser mayor que 0');
      const acordes = ordenarAcordes(
        letra.acordes.map((a) => (a.id === payload.id ? { ...a, beat: redondear(payload.beat), ...(payload.duracion !== undefined ? { duracion: redondear(payload.duracion) } : {}) } : a)),
      );
      return conLetra(estado, { ...letra, acordes }, { id: payload.id, beat: payload.beat });
    },
  };
}

// ── lyrics.clear ───────────────────────────────────────────────

export function crearComandoLyricsClear(): CommandDefinition<LyricsClearPayload, Record<string, unknown>> {
  return {
    type: 'lyrics.clear',
    historialUndo: 'instantanea',
    description: 'Borra la letra, los acordes o ambos',
    risk: 'dangerous',
    schema: { type: 'object', properties: { que: { type: 'string', enum: ['todo', 'letra', 'acordes'] } }, additionalProperties: false },
    handler: (estado, payload) => {
      const letra = letraDe(estado);
      const que = payload.que ?? 'todo';
      const nueva: LetraProyecto = {
        frases: que === 'acordes' ? letra.frases : [],
        acordes: que === 'letra' ? letra.acordes : [],
      };
      return conLetra(estado, nueva, { que });
    },
  };
}

// ── chords.set / chords.get (herramientas IA) ──────────────────

export function crearComandoChordsSet(): CommandDefinition<ChordsSetPayload, Record<string, unknown>> {
  return {
    type: 'chords.set',
    historialUndo: 'instantanea',
    description:
      'Escribe la progresión de acordes en el carril del arreglo (reemplaza la anterior). Acepta texto por compases «| D | Bm | G A |», una lista {nombre, compas|beat, duracion} o la hoja de ruta por secciones [{nombre, compases, acordes}] (crea además un marcador por sección).',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        acordes: { type: 'array', items: esquemaAcorde },
        texto: { type: 'string', description: '«| D | Bm | G A |»: un compás por barra; «%» repite el anterior.' },
        secciones: {
          type: 'array',
          items: { type: 'object', properties: { nombre: { type: 'string' }, compases: { type: 'number' }, acordes: { type: 'array', items: { type: 'string' } } }, required: ['nombre', 'compases', 'acordes'] },
        },
        compasInicio: { type: 'number', description: '1 = primer compás.' },
      },
      additionalProperties: false,
    },
    handler: (estado, payload) => {
      const numerador = numeradorDe(estado);
      const inicioBeat = Math.max(0, ((payload.compasInicio ?? 1) - 1) * numerador);
      let acordes: AcordeCarril[] = [];
      let marcadores: Marcador[] | undefined;
      if (Array.isArray(payload.secciones) && payload.secciones.length > 0) {
        let beat = inicioBeat;
        const existentes = [...(estado.project.marcadores ?? [])];
        let nuevos = 0;
        for (const s of payload.secciones) {
          const compases = Math.max(1, Math.round(Number(s.compases) || 1));
          const lista = (s.acordes ?? []).map((x) => String(x).trim()).filter(Boolean);
          if (lista.length === 0) throw new Error(`La sección «${s.nombre}» no tiene acordes`);
          // Un acorde por compás; si hay menos, se repiten cíclicamente; si una celda trae «G A», se parte el compás.
          for (let c = 0; c < compases; c++) {
            const celda = lista[c % lista.length]!.split(/\s+/);
            const paso = numerador / celda.length;
            celda.forEach((tok, i) => {
              const parsed = intentarParsearAcorde(tok);
              if (!parsed) throw new Error(`Acorde no reconocido en «${s.nombre}»: «${tok}»`);
              acordes.push({ id: entorno.uuid(), nombre: parsed.nombre, beat: redondear(beat + c * numerador + i * paso), duracion: redondear(paso) });
            });
          }
          const nombre = String(s.nombre ?? '').trim() || `Sección ${existentes.length + 1}`;
          if (!existentes.some((m) => Math.abs(m.tiempo - beat) < 1e-6)) {
            existentes.push({ id: entorno.uuid(), nombre, tiempo: beat, color: '#f59e0b', seleccionado: false, tipo: 'marcador' });
            nuevos++;
          }
          beat += compases * numerador;
        }
        if (nuevos > 0) marcadores = existentes.sort((a, b) => a.tiempo - b.tiempo);
      } else if (typeof payload.texto === 'string' && payload.texto.trim()) {
        const r = acordesDesdeTexto(payload.texto, { numerador, inicioBeat, id: () => entorno.uuid() });
        if (!r) throw new Error('Hay símbolos que no son acordes en el texto');
        acordes = r;
      } else if (Array.isArray(payload.acordes)) {
        acordes = payload.acordes.map((a) => acordeEntrada(a, numerador));
      } else {
        throw new Error('chords.set necesita texto, acordes o secciones');
      }
      acordes = ordenarAcordes(acordes);
      return conLetra(estado, { ...letraDe(estado), acordes }, { acordes: acordes.length, texto: acordesComoTexto(acordes, numerador), marcadoresCreados: marcadores ? marcadores.length - (estado.project.marcadores?.length ?? 0) : 0 }, marcadores);
    },
  };
}

export function crearComandoChordsGet(): CommandDefinition<Record<string, never>, Record<string, unknown>> {
  return {
    type: 'chords.get',
    replicacion: 'local',
    description: 'Devuelve los acordes del carril del arreglo (id, nombre, compás, beat, duración) y el cifrado por compases',
    risk: 'read',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (estado) => {
      const numerador = numeradorDe(estado);
      const acordes = ordenarAcordes(letraDe(estado).acordes).map((a) => ({ ...a, compas: Math.floor(a.beat / numerador) + 1 }));
      return lectura(estado, { acordes, texto: acordesComoTexto(acordes, numerador), numerador });
    },
  };
}

// ── lyrics.set / lyrics.get (herramientas IA) ──────────────────

export function crearComandoLyricsSet(): CommandDefinition<LyricsSetPayload, Record<string, unknown>> {
  return {
    type: 'lyrics.set',
    historialUndo: 'instantanea',
    description:
      'Escribe la letra de la canción en el carril del arreglo (reemplaza la anterior). texto: líneas de la letra, estrofas separadas por línea en blanco; cada estrofa cae en la sección (marcador) correspondiente, o cada línea ocupa compasesPorFrase compases desde inicioBeat. Las sílabas se reparten en el tiempo automáticamente.',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        texto: { type: 'string' },
        inicioBeat: { type: 'number' },
        compasesPorFrase: { type: 'number', description: 'Por defecto 2.' },
        frases: { type: 'array', items: esquemaFrase },
      },
      required: ['texto'],
      additionalProperties: false,
    },
    handler: (estado, payload) => {
      const frases = frasesDesdePayload(estado, payload);
      if (frases.length === 0) throw new Error('La letra está vacía');
      return conLetra(estado, { ...letraDe(estado), frases }, { frases: frases.length, silabas: frases.reduce((n, f) => n + f.silabas.length, 0) });
    },
  };
}

export function crearComandoLyricsGet(): CommandDefinition<Record<string, never>, Record<string, unknown>> {
  return {
    type: 'lyrics.get',
    replicacion: 'local',
    description: 'Devuelve la letra del carril: frases con sección, compás de inicio y sílabas temporizadas',
    risk: 'read',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (estado) => {
      const numerador = numeradorDe(estado);
      const frases = letraDe(estado).frases.map((f) => ({
        id: f.id,
        texto: f.texto,
        seccion: f.seccion,
        compas: f.silabas[0] ? Math.floor(f.silabas[0].beat / numerador) + 1 : null,
        inicioBeat: f.silabas[0]?.beat ?? null,
        silabas: f.silabas,
      }));
      return lectura(estado, { frases, texto: frases.map((f) => f.texto).join('\n') });
    },
  };
}

/** Sílabas de una frase (sin tiempos): útil para la UI al editar una sílaba. */
export function silabasDeTexto(texto: string): string[] {
  return silabasDeLinea(texto).map((s) => s.texto);
}
