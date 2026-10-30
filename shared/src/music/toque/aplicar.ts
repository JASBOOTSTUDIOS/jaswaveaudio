/**
 * Aplica un perfil de toque a notas nuevas: micro-timing por posición métrica, dispersión y orden de
 * entrada de acordes, microdinámica (posición, voces, frase, curva de arpegio) y articulación, muestreando
 * las distribuciones aprendidas con un PRNG con semilla. Pura y determinista.
 *
 * Garantías: ninguna nota antes de 0; los ataques conservan su orden (un acorde nunca adelanta al
 * anterior); dentro de un acorde el orden de entrada sale del perfil; velocidades 1..127.
 */

import { crearRng } from '../worship/prng';
import {
  agruparAtaques,
  ajustarARejilla,
  contraer,
  iniciosDeFrase,
  notasValidas,
  posicionMetrica,
  tramosDeArpegio,
  velocidadDe,
} from './analisis';
import type { NotaToque, OpcionesAplicarToque, PerfilToque } from './tipos';

const DUR_MIN = 1 / 128;
const SEP_MIN_MS = 1;
/** Retraso máximo (beats) que el rubato añade al final de un compás de cadencia. */
const RUBATO_MAX_BEATS = 0.25;
/** Umbral de uso del pedal a partir del cual se reproduce (solape o CC). */
const PEDAL_MIN_USO = 0.3;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const r5 = (x: number) => Math.round(x * 100000) / 100000;

/** ¿Es compás de cadencia según el rubato aprendido (índice de compás absoluto, desde 0)? */
function esCompasDeCadencia(perfil: PerfilToque, compas: number): boolean {
  const c = perfil.rubato?.cadencias;
  if (!c || !c.cadaCompases || c.caidaPorciento <= 0.5) return false;
  return (compas + 1) % c.cadaCompases === 0;
}

/**
 * Retraso (beats) que el rubato añade a un instante: en los compases de cadencia el tiempo se estira
 * progresivamente hasta `caida %` del compás (tope 0,25 beats) y el siguiente compás vuelve a entrar en su
 * sitio, así la parte respira sin desincronizarse del resto de la banda.
 */
function retrasoRubato(perfil: PerfilToque, abs: number, bpc: number): number {
  const compas = Math.floor(abs / bpc + 1e-9);
  if (!esCompasDeCadencia(perfil, compas)) return 0;
  const frac = clamp(abs / bpc - compas, 0, 1);
  const total = Math.min(RUBATO_MAX_BEATS, (perfil.rubato!.cadencias.caidaPorciento / 100) * bpc);
  return total * frac * frac;
}

export function aplicarPerfilToque<T extends NotaToque>(
  notas: readonly T[],
  perfil: PerfilToque,
  opts: OpcionesAplicarToque = {},
): T[] {
  const intensidad = clamp(Number.isFinite(opts.intensidad) ? Number(opts.intensidad) : 1, 0, 1);
  const salida = notas.map((n) => ({ ...n }));
  if (notas.length === 0 || intensidad === 0) return salida;

  const rng = crearRng((Number.isFinite(opts.semilla) ? Number(opts.semilla) : 1) >>> 0);
  const bpm = opts.bpm && opts.bpm > 0 ? opts.bpm : perfil.bpmReferencia > 0 ? perfil.bpmReferencia : 120;
  const msPorBeat = 60000 / bpm;
  const offset = opts.offsetBeats ?? 0;
  const bpc = opts.beatsPorCompas && opts.beatsPorCompas > 0 ? opts.beatsPorCompas : perfil.beatsPorCompas || 4;
  const rejilla = perfil.rejillaBeats > 0 ? perfil.rejillaBeats : 0.25;
  const pasoMs = rejilla * msPorBeat;
  const conservar = clamp(opts.conservarDinamica ?? 0.3, 0, 1);
  const partirDeRejilla = opts.partirDeRejilla !== false;
  const conRubato = opts.rubato !== false && !perfil.percusivo;
  const modoPedal = opts.pedal ?? 'solape';
  const voces = perfil.voces && perfil.voces.n >= 4 && !perfil.percusivo ? perfil.voces : null;
  const manos = perfil.manos && perfil.manos.split != null && !perfil.percusivo ? perfil.manos : null;
  // Desfase entre manos (ms): la izquierda respecto a la derecha, repartido a medias entre ambas.
  const desfaseManosMs = manos && manos.izquierda.timing.n >= 6 && manos.derecha.timing.n >= 6 ? (manos.izquierda.timing.media - manos.derecha.timing.media) / 2 : 0;
  const pedal = perfil.pedal?.medido && perfil.pedal.tiempoPisado >= PEDAL_MIN_USO && !perfil.percusivo ? perfil.pedal : null;

  const validas = notasValidas(notas);
  const ordenadas = validas.map((x) => x.nota);
  if (ordenadas.length === 0) return salida;
  const grupos = agruparAtaques(
    ordenadas.map((n) => n.inicio),
    msPorBeat,
  );
  const vIn = ordenadas.map(velocidadDe);
  const mediaEntrada = vIn.reduce((a, b) => a + b, 0) / vIn.length;
  const frases = iniciosDeFrase(grupos, ordenadas, msPorBeat);
  const { tramo } = tramosDeArpegio(grupos, ordenadas);

  const tGlobal = perfil.timing.global;
  const vGlobal = perfil.dinamica.global;
  const ac = perfil.acordes;
  const art = perfil.articulacion;
  const fraseDelta = contraer(perfil.ataque.inicioFraseDelta, { media: 0, sd: 0, n: 0 });

  const nuevoInicio: number[] = new Array(ordenadas.length).fill(0);
  const nuevaVel: number[] = new Array(ordenadas.length).fill(0);
  const nuevaDur: number[] = new Array(ordenadas.length).fill(0);

  let ultimoAncla = -Infinity;
  let ultimoInicio = -Infinity;

  grupos.forEach((g, k) => {
    const ns = g.idx.map((i) => ordenadas[i]!);
    const anclaOrig = g.ancla;
    const abs = anclaOrig + offset;
    const q = ajustarARejilla(abs, rejilla);
    const pos = posicionMetrica(q, bpc);
    const base = partirDeRejilla ? q - offset : anclaOrig;
    const siguiente = grupos[k + 1];
    const ioiMs = siguiente ? (siguiente.ancla - anclaOrig) * msPorBeat : Infinity;

    // ── micro-timing ──────────────────────────────────────────────────────────
    const tPos = contraer(perfil.timing.porPosicion[pos], tGlobal);
    const desvio = (est: { media: number; sd: number }) => clamp(est.media + est.sd * rng.gauss(2.2), -0.4 * pasoMs, 0.4 * pasoMs);
    const desvGrupoMs = desvio(tPos);
    const rubato = conRubato ? retrasoRubato(perfil, q, bpc) : 0;
    let ancla = lerp(anclaOrig, base + desvGrupoMs / msPorBeat + rubato, intensidad);
    // Orden de ataques: nunca antes del anterior (ni de la última nota de su arpegio).
    const minimo = Math.max(ultimoAncla, ultimoInicio) + SEP_MIN_MS / msPorBeat;
    if (ancla < minimo) ancla = minimo;
    ancla = Math.max(0, ancla);

    // ── dispersión del acorde ────────────────────────────────────────────────
    const relativos = new Map<number, number>(); // idx → beats desde el ancla
    if (ns.length >= 2 && !perfil.percusivo && rng.prob(ac.probArpegiado)) {
      const u = rng.next();
      const porPitch = [...g.idx].sort((a, b) => ordenadas[a]!.pitch - ordenadas[b]!.pitch);
      const tope = Math.min(200, 0.45 * ioiMs);
      if (voces && ns.length >= 3 && u < ac.ordenAscendente) {
        // Grave→agudo con el micro-tiempo por voz aprendido: bajo = 0, voces medias ordenadas por tono y la
        // superior siempre la última (cada voz al menos 0,5 ms después de la anterior).
        const medias = porPitch
          .slice(1, -1)
          .map(() => Math.max(0.5, voces.medias.media + voces.medias.sd * rng.gauss(2)))
          .sort((a, b) => a - b);
        let acum = 0;
        const offs: number[] = [0];
        for (const m of medias) {
          acum = Math.max(m, acum + 0.5);
          offs.push(acum);
        }
        offs.push(Math.max(acum + 0.5, voces.superior.media + voces.superior.sd * rng.gauss(2)));
        const span = offs[offs.length - 1]!;
        const escala = span > tope ? tope / span : 1;
        porPitch.forEach((i, j) => relativos.set(i, (offs[j]! * escala) / msPorBeat));
      } else {
        const orden =
          u < ac.ordenAscendente ? porPitch : u < ac.ordenAscendente + ac.ordenDescendente ? [...porPitch].reverse() : rng.barajar(porPitch);
        const gaps = orden.slice(1).map(() => Math.max(0.5, ac.msEntreNotas.media + ac.msEntreNotas.sd * rng.gauss(2)));
        const total = gaps.reduce((a, b) => a + b, 0);
        const escala = total > tope ? tope / total : 1;
        let acum = 0;
        orden.forEach((i, j) => {
          if (j > 0) acum += gaps[j - 1]! * escala;
          relativos.set(i, acum / msPorBeat);
        });
      }
    } else {
      for (const i of g.idx) relativos.set(i, 0);
    }
    // Desfase entre manos solo en los ataques de una sola mano (en los acordes a dos manos ya lo ponen las voces).
    const unaMano = manos != null && ns.every((n) => n.pitch < manos.split! === ns[0]!.pitch < manos.split!);

    // ── microdinámica ────────────────────────────────────────────────────────
    const mediaGrupoIn = g.idx.reduce((a, i) => a + vIn[i]!, 0) / g.idx.length;
    const vPos = contraer(perfil.dinamica.porPosicion[pos], vGlobal);
    let objetivoGrupo = vPos.media + vPos.sd * rng.gauss(2.2) + conservar * (mediaGrupoIn - mediaEntrada);
    if (frases.has(k)) objetivoGrupo += fraseDelta.media;
    const t = tramo.get(k);
    if (t !== undefined && perfil.arpegios.n > 0) objetivoGrupo += perfil.arpegios.curva[t];
    const porPitchGrupo = [...g.idx].sort((a, b) => ordenadas[a]!.pitch - ordenadas[b]!.pitch);

    for (const i of g.idx) {
      const n = ordenadas[i]!;
      // Batería: cada pieza con su propio timing y dinámica.
      const piezas = perfil.percusivo ? perfil.porPitch[String(n.pitch)] : undefined;
      let inicio: number;
      let objetivoVel: number;
      if (piezas) {
        const desvPieza = desvio(contraer(piezas.timing, tGlobal));
        const qn = ajustarARejilla(n.inicio + offset, rejilla) - offset;
        inicio = lerp(n.inicio, (partirDeRejilla ? qn : n.inicio) + desvPieza / msPorBeat, intensidad);
        inicio = Math.max(inicio, Number.isFinite(minimo) ? minimo : 0);
        const vp = contraer(piezas.velocidad, vGlobal);
        objetivoVel = vp.media + vp.sd * rng.gauss(2.2) + conservar * (vIn[i]! - mediaEntrada);
      } else {
        const relOrig = n.inicio - anclaOrig;
        inicio = ancla + lerp(relOrig, relativos.get(i) ?? 0, intensidad);
        objetivoVel = objetivoGrupo;
        const izquierda = manos != null && n.pitch < manos.split!;
        if (g.idx.length >= 2) {
          if (i === porPitchGrupo[porPitchGrupo.length - 1]) objetivoVel += ac.enfasisSuperior;
          else if (i === porPitchGrupo[0]) objetivoVel += ac.enfasisBajo;
          else objetivoVel += ac.enfasisMedio + ac.sdVelocidadInterna * rng.gauss(2);
        } else if (manos) {
          // Nota suelta: la mano a la que pertenece aporta la mitad de su diferencia con la media global.
          const mano = izquierda ? manos.izquierda : manos.derecha;
          if (mano.velocidad.n >= 6) objetivoVel += 0.5 * (mano.velocidad.media - vGlobal.media);
        }
        if (desfaseManosMs !== 0 && unaMano) {
          const extra = ((izquierda ? desfaseManosMs : -desfaseManosMs) / msPorBeat) * intensidad;
          inicio = Math.max(inicio + extra, Number.isFinite(minimo) ? minimo : 0);
        }
      }
      nuevoInicio[i] = Math.max(0, inicio);
      nuevaVel[i] = Math.round(clamp(lerp(vIn[i]!, objetivoVel, intensidad), 1, 127));

      // ── articulación ──────────────────────────────────────────────────────
      let dur = n.duracion;
      if (siguiente && !perfil.percusivo && art.ratio.n > 0) {
        const ioi = siguiente.ancla - anclaOrig;
        if (ioi > 0 && n.duracion / ioi <= 1.6) {
          const ratio = clamp(art.ratio.media + art.ratio.sd * rng.gauss(2), 0.05, 1.6);
          dur = lerp(n.duracion, ratio * ioi, intensidad);
        }
      }
      // ── pedal como solape: lo que el pedal sostenía hasta el ataque siguiente, lo sostiene la nota ──
      if (pedal && modoPedal === 'solape' && siguiente && n.inicio + dur < siguiente.ancla && rng.prob(pedal.solapePorPedal)) {
        const cola = Math.max(15, pedal.cambioEnAcorde.n ? pedal.cambioEnAcorde.media : 0) / msPorBeat;
        dur = lerp(dur, siguiente.ancla - n.inicio + cola, intensidad);
      }
      nuevaDur[i] = Math.max(DUR_MIN, dur);
    }

    ultimoAncla = ancla;
    for (const i of g.idx) ultimoInicio = Math.max(ultimoInicio, nuevoInicio[i]!);
  });

  validas.forEach(({ original }, i) => {
    const o = salida[original]!;
    o.inicio = r5(nuevoInicio[i]!);
    o.duracion = r5(nuevaDur[i]!);
    o.velocidad = nuevaVel[i]!;
  });
  return salida;
}

export interface PuntoPedal {
  /** Beats, misma referencia que las notas. */
  tiempo: number;
  /** 0 (suelto) o 127 (pisado). */
  valor: number;
}

/**
 * Curva de pedal (CC64) que reproduce el uso aprendido sobre unas notas (ya con el toque aplicado): pisado
 * desde el primer ataque y, en cada cambio de acorde, suelta y vuelve a pisar con el desfase medido
 * (`pedal.cambioEnAcorde`). Vacío si el perfil no midió pedal o el intérprete apenas lo usa.
 */
export function pedalDesdePerfil(notas: readonly NotaToque[], perfil: PerfilToque, opts: { bpm?: number } = {}): PuntoPedal[] {
  const pd = perfil.pedal;
  if (!pd?.medido || pd.tiempoPisado < PEDAL_MIN_USO || perfil.percusivo) return [];
  const ordenadas = notasValidas(notas).map((x) => x.nota);
  if (!ordenadas.length) return [];
  const bpm = opts.bpm && opts.bpm > 0 ? opts.bpm : perfil.bpmReferencia > 0 ? perfil.bpmReferencia : 120;
  const msPorBeat = 60000 / bpm;
  const grupos = agruparAtaques(
    ordenadas.map((n) => n.inicio),
    msPorBeat,
  );
  const clase = (g: { idx: number[] }) => [...new Set(g.idx.map((i) => ((ordenadas[i]!.pitch % 12) + 12) % 12))].sort((a, b) => a - b).join(',');
  const desfase = (pd.cambioEnAcorde.n ? pd.cambioEnAcorde.media : 0) / msPorBeat;
  const puntos: PuntoPedal[] = [{ tiempo: r5(Math.max(0, grupos[0]!.ancla)), valor: 127 }];
  let previo = clase(grupos[0]!);
  for (let k = 1; k < grupos.length; k++) {
    const g = grupos[k]!;
    const actual = clase(g);
    if (g.idx.length >= 2 && actual !== previo) {
      const pisa = Math.max(0, g.ancla + desfase);
      const suelta = Math.max(0, pisa - 0.02);
      const ultimo = puntos[puntos.length - 1]!;
      if (suelta > ultimo.tiempo) {
        puntos.push({ tiempo: r5(suelta), valor: 0 });
        puntos.push({ tiempo: r5(Math.max(pisa, suelta + 1e-5)), valor: 127 });
      }
    }
    previo = actual;
  }
  const fin = ordenadas.reduce((m, n) => Math.max(m, n.inicio + n.duracion), 0);
  puntos.push({ tiempo: r5(fin), valor: 0 });
  return puntos;
}
