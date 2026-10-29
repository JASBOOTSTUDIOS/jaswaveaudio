/** Validación estructural y musical de un ArregloWorship. */

import { crearTonal } from './armonia';
import { esKeyswitch } from './guitarra-tecnicas';
import {
  RANGOS_WORSHIP,
  ROLES_WORSHIP,
  type ArregloWorship,
  type NotaWorship,
  type RolWorship,
} from './tipos';

const MIN_DUR = 1 / 64 - 1e-9;

/** Nota fuera de escala admisible sólo como nota de paso/aproximación (corta y a ≤ 1 semitono de una vecina en escala). */
function esNotaDePaso(notas: NotaWorship[], i: number, pcsEscala: Set<number>): boolean {
  const n = notas[i]!;
  if (n.duracion > 0.55) return false;
  const vecinas = [notas[i - 1], notas[i + 1]].filter((x): x is NotaWorship => !!x);
  return vecinas.some((v) => Math.abs(v.pitch - n.pitch) <= 1 && pcsEscala.has(v.pitch % 12));
}

export function validarArregloWorship(a: ArregloWorship): { ok: boolean; problemas: string[] } {
  const problemas: string[] = [];
  const bpc = a.beatsPorCompas;
  const push = (m: string) => {
    if (problemas.length < 200) problemas.push(m);
  };

  // Estructura
  let compas = 0;
  a.secciones.forEach((s, i) => {
    if (s.inicioCompas !== compas) push(`Sección ${s.nombre}: inicioCompas ${s.inicioCompas} ≠ ${compas}`);
    if (s.indice !== i) push(`Sección ${s.nombre}: índice incorrecto`);
    if (s.duracionBeats !== s.compases * bpc) push(`Sección ${s.nombre}: duracionBeats incoherente`);
    if (s.inicioBeat !== s.inicioCompas * bpc) push(`Sección ${s.nombre}: inicioBeat incoherente`);
    if (s.intensidadPorCompas.length !== s.compases) push(`Sección ${s.nombre}: intensidadPorCompas con longitud incorrecta`);
    if (s.intensidad < 0 || s.intensidad > 1) push(`Sección ${s.nombre}: intensidad fuera de 0..1`);
    compas += s.compases;
  });
  if (compas !== a.totalCompases) push(`totalCompases ${a.totalCompases} ≠ suma de secciones ${compas}`);
  if (a.duracionBeats !== a.totalCompases * bpc) push('duracionBeats ≠ totalCompases × beatsPorCompas');
  if (a.marcadores.length !== a.secciones.length) push('Los marcadores no coinciden con las secciones');

  // Acordes contiguos
  let t = 0;
  for (const c of a.acordes) {
    if (Math.abs(c.inicio - t) > 1e-6) push(`Acorde ${c.simbolo}: hueco o solape en la línea de acordes (beat ${c.inicio})`);
    t = c.inicio + c.duracion;
  }
  if (a.acordes.length > 0 && Math.abs(t - a.duracionBeats) > 1e-6) push('La línea de acordes no cubre toda la duración');

  const tonal = crearTonal(a.tonalidad.raiz, a.tonalidad.escala);
  const seccionEn = (beat: number) => a.secciones.find((s) => beat >= s.inicioBeat - 1e-9 && beat < s.inicioBeat + s.duracionBeats - 1e-9);

  for (const rol of ROLES_WORSHIP) {
    const notas = a.partes[rol] ?? [];
    const [lo, hi] = RANGOS_WORSHIP[rol];
    const mono = rol === 'bajo' || rol === 'melodia';
    notas.forEach((n, i) => {
      const id = `${rol}#${i}`;
      // Los keyswitches de la guitarra (notas 11-27) son órdenes al plugin, no música: no se juzgan por rango ni escala.
      if (rol === 'guitarra' && esKeyswitch(n)) return;
      if (![n.pitch, n.inicio, n.duracion, n.velocidad].every(Number.isFinite)) return push(`${id}: valores no finitos`);
      if (n.inicio < 0) push(`${id}: inicio negativo`);
      if (!Number.isInteger(n.velocidad) || n.velocidad < 1 || n.velocidad > 127) push(`${id}: velocidad ${n.velocidad} fuera de 1..127`);
      if (n.duracion < MIN_DUR) push(`${id}: duración ${n.duracion} < 1/64`);
      if (!Number.isInteger(n.pitch) || n.pitch < lo || n.pitch > hi) push(`${id}: pitch ${n.pitch} fuera del rango ${lo}-${hi}`);
      if (rol !== 'bateria' && !tonal.pcsEscala.has(n.pitch % 12) && !esNotaDePaso(notas, i, tonal.pcsEscala)) {
        push(`${id}: pitch ${n.pitch} fuera de la escala`);
      }
      // Rol presente en la sección (tolerancia por micro-timing)
      const activo = [-0.06, 0, 0.06].some((d) => {
        const s = seccionEn(Math.max(0, n.inicio + d));
        return s ? s.roles.includes(rol) : false;
      });
      if (!activo) push(`${id}: el rol ${rol} no toca en la sección de beat ${n.inicio.toFixed(2)}`);
    });
    // Solapes
    const ord = [...notas].sort((x, y) => x.inicio - y.inicio || x.pitch - y.pitch);
    if (mono) {
      for (let i = 0; i < ord.length - 1; i++) {
        if (ord[i]!.inicio + ord[i]!.duracion > ord[i + 1]!.inicio + 1e-6) push(`${rol}: solape en beat ${ord[i + 1]!.inicio.toFixed(3)}`);
      }
    } else {
      const ultimoFin = new Map<number, number>();
      for (const n of ord) {
        const fin = ultimoFin.get(n.pitch);
        if (fin !== undefined && fin > n.inicio + 1e-6) push(`${rol}: solape de pitch ${n.pitch} en beat ${n.inicio.toFixed(3)}`);
        ultimoFin.set(n.pitch, n.inicio + n.duracion);
      }
    }
  }
  return { ok: problemas.length === 0, problemas };
}

export function rolesConNotas(a: ArregloWorship): RolWorship[] {
  return ROLES_WORSHIP.filter((r) => a.partes[r].length > 0);
}
