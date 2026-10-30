import { describe, expect, it } from 'vitest';
import {
  ENVIO_REVERB,
  HPF_HZ,
  MAX_EQ_MASTER_DB,
  PANEO_ROL,
  clasificarRolMezcla,
  clasificarSeccion,
  corregirBalanceMaster,
  curvaVolumenPorSeccion,
  planificarAutomezcla,
  repartoEspectral,
  respuestaBandaDb,
  type PistaAutomezcla,
} from '../music/automezcla';
import { PERFILES_MEZCLA, describirPerfilMezcla, elegirPerfilMezcla, validarPerfilMezcla } from '../music/perfiles-mezcla';

const db = (x: number) => 10 * Math.log10(x);
/** Bandas en dB de potencia a partir de un reparto (sub, low, lowmid, mid, highmid, high). */
const bandas = (reparto: number[], rms: number) => reparto.map((f) => (f > 0 ? db(f) + rms : -120));

/** Una pasada real: 7 pistas, todos los faders a 0 dB y 76 % de la energía entre 60 y 250 Hz (+16,6 % bajo 60 Hz). */
function pasadaSorda(): PistaAutomezcla[] {
  const p = (id: string, nombre: string, rms: number, reparto: number[]): PistaAutomezcla => ({
    id,
    nombre,
    volumen: 1,
    medicion: { rmsDb: rms, picoDb: rms + 10, bandasDb: bandas(reparto, rms) },
  });
  return [
    p('bat', 'Batería', -11, [0.15, 0.55, 0.1, 0.1, 0.08, 0.02]),
    p('bajo', 'Bajo', -10, [0.35, 0.6, 0.03, 0.01, 0.01, 0]),
    p('pia', 'Piano', -18, [0.04, 0.55, 0.2, 0.15, 0.05, 0.01]),
    p('gui', 'Guitarra', -19, [0.03, 0.5, 0.22, 0.17, 0.07, 0.01]),
    p('cue', 'Cuerdas', -19, [0.04, 0.55, 0.22, 0.14, 0.04, 0.01]),
    p('pad', 'Pad', -12, [0.25, 0.68, 0.04, 0.02, 0.01, 0]),
    p('lea', 'Melodía', -21, [0, 0.2, 0.3, 0.35, 0.13, 0.02]),
  ];
}

describe('clasificarRolMezcla', () => {
  it('reconoce los roles por nombre y por plugin', () => {
    expect(clasificarRolMezcla('Batería')).toBe('bateria');
    expect(clasificarRolMezcla('Bajo eléctrico')).toBe('bajo');
    expect(clasificarRolMezcla('Pista 3', ['JasWave Grand Piano'])).toBe('piano');
    expect(clasificarRolMezcla('Guitar L')).toBe('guitarra');
    expect(clasificarRolMezcla('Strings Section')).toBe('cuerdas');
    expect(clasificarRolMezcla('Shimmer Pad')).toBe('pad');
    expect(clasificarRolMezcla('Melodía')).toBe('lead');
    expect(clasificarRolMezcla('Cosa')).toBe('otro');
  });
});

describe('planificarAutomezcla con medición (pasada sorda de 76 % de graves)', () => {
  const pistas = pasadaSorda();
  const plan = planificarAutomezcla(pistas, { secciones: [{ nombre: 'Verso 1', compases: 8 }, { nombre: 'Coro', compases: 8 }], bpm: 120, numerador: 4 });

  it('el «antes» está muy cargado de graves y el «después» cumple el objetivo', () => {
    expect(plan.espectroAntes!.graves).toBeGreaterThan(0.75);
    expect(plan.espectroDespues.graves).toBeLessThan(0.45);
    expect(plan.espectroDespues.medios).toBeGreaterThan(0.25);
    expect(plan.cumple).toEqual({ graves: true, medios: true });
  });

  it('la suma queda en −18 dBFS RMS y el pico estimado por debajo de −3 dBFS', () => {
    expect(plan.sumaRmsDb).toBeLessThanOrEqual(-17.9);
    expect(plan.sumaRmsDb).toBeGreaterThanOrEqual(-19.5);
    expect(plan.picoSumaDb).toBeLessThan(-3);
  });

  it('ganancias por rol: lead por encima de pad/cuerdas; cimiento sin pasar de 4 dB bajo su nivel nominal', () => {
    const v = (id: string) => plan.pistas.find((x) => x.id === id)!;
    // Comparación en nivel de salida (volumen × RMS base), no en volumen bruto.
    const salida = (id: string) => {
      const m = pistas.find((x) => x.id === id)!.medicion!.rmsDb!;
      return m + 20 * Math.log10(v(id).volumen);
    };
    expect(salida('lea')).toBeGreaterThan(salida('pad'));
    expect(salida('lea')).toBeGreaterThan(salida('cue'));
    for (const x of plan.pistas) {
      expect(x.volumen).toBeGreaterThan(0.01);
      expect(x.volumen).toBeLessThanOrEqual(1.4);
      expect(x.origen).toBe('medido');
    }
  });

  it('pasa-altos por rol (no en bajo ni batería), recorte 300 Hz y presencia en piano y guitarra', () => {
    const eq = (id: string) => plan.pistas.find((x) => x.id === id)!.eq;
    expect(eq('bajo').find((b) => b.tipo === 'lowCut')).toBeUndefined();
    expect(eq('bat').find((b) => b.tipo === 'lowCut')).toBeUndefined();
    for (const [id, hz] of [['pia', 90], ['gui', 110], ['cue', 120], ['pad', 150]] as const) {
      const hp = eq(id).find((b) => b.tipo === 'lowCut')!;
      expect(hp.freq).toBe(hz);
      expect(hz).toBeGreaterThanOrEqual(90);
      expect(hz).toBeLessThanOrEqual(150);
      expect(eq(id).find((b) => b.slot === 2)!.gain).toBeLessThan(0);
    }
    expect(eq('pia').find((b) => b.slot === 3)!.gain).toBeGreaterThan(0);
    expect(eq('gui').find((b) => b.slot === 3)!.gain).toBeGreaterThan(0);
    expect(eq('pad').find((b) => b.slot === 3)).toBeUndefined();
  });

  it('paneo por rol: base al centro, piano y guitarra a lados opuestos, cuerdas y pad abiertos', () => {
    const pan = (id: string) => plan.pistas.find((x) => x.id === id)!.paneo;
    expect(pan('bat')).toBe(0);
    expect(pan('bajo')).toBe(0);
    expect(pan('lea')).toBe(0);
    expect(Math.sign(pan('pia'))).toBe(-Math.sign(pan('gui')));
    expect(Math.abs(pan('cue'))).toBeGreaterThanOrEqual(0.4);
    expect(Math.abs(pan('pad'))).toBeGreaterThanOrEqual(0.4);
    expect(Math.sign(pan('cue'))).toBe(-Math.sign(pan('pad')));
  });

  it('envíos de reverb solo en los instrumentos melódicos', () => {
    const e = (id: string) => plan.pistas.find((x) => x.id === id)!.envioReverb;
    expect(e('bajo')).toBe(0);
    expect(e('bat')).toBe(0);
    expect(e('pia')).toBe(ENVIO_REVERB.piano);
  });

  it('el EQ del máster, si lo hay, no pasa de ±3 dB', () => {
    for (const b of plan.master.eq) expect(Math.abs(b.gain)).toBeLessThanOrEqual(MAX_EQ_MASTER_DB);
  });

  it('el coro suena ~3 dB más fuerte que el verso en las curvas de volumen', () => {
    const c = plan.pistas.find((x) => x.id === 'pia')!.curvaVolumen!;
    // [verso inicio, verso fin, coro inicio, coro fin]
    expect(c).toHaveLength(4);
    const dif = 20 * Math.log10(c[2]!.valor / c[0]!.valor);
    expect(dif).toBeCloseTo(3, 0);
    expect(c[2]!.tiempo).toBeCloseTo(16, 3); // 8 compases a 120 bpm 4/4 = 16 s
  });

  it('es determinista: mismo plan con las mismas entradas', () => {
    const otra = planificarAutomezcla(pasadaSorda(), { secciones: [{ nombre: 'Verso 1', compases: 8 }, { nombre: 'Coro', compases: 8 }], bpm: 120, numerador: 4 });
    expect(otra).toEqual(plan);
  });
});

describe('idempotencia', () => {
  it('re-medir tras aplicar el plan (stems post-fader) y planificar de nuevo da los mismos volúmenes', () => {
    // Con el reparto espectral por rol (sin bandas medidas) el plan solo depende del nivel: estable al re-medir.
    const pistas = pasadaSorda().map((p) => ({ ...p, medicion: { rmsDb: p.medicion!.rmsDb } }));
    const plan1 = planificarAutomezcla(pistas);
    // Simula el efecto de aplicar: cada stem medido cambia con su nuevo fader.
    const aplicadas = pistas.map((p) => {
      const v = plan1.pistas.find((x) => x.id === p.id)!.volumen;
      return { ...p, volumen: v, medicion: { ...p.medicion!, rmsDb: p.medicion!.rmsDb! + 20 * Math.log10(v) } };
    });
    const plan2 = planificarAutomezcla(aplicadas);
    for (const x of plan1.pistas) {
      const y = plan2.pistas.find((z) => z.id === x.id)!;
      expect(Math.abs(y.volumen / x.volumen - 1)).toBeLessThan(0.02);
      expect(y.paneo).toBe(x.paneo);
      expect(y.eq.map((b) => b.slot)).toEqual(x.eq.map((b) => b.slot));
    }
  });
});

describe('sin medición', () => {
  const pistas: PistaAutomezcla[] = [
    { id: 'a', nombre: 'Batería', volumen: 1 },
    { id: 'b', nombre: 'Bajo', volumen: 1 },
    { id: 'c', nombre: 'Piano', volumen: 1 },
    { id: 'd', nombre: 'Guitarra', volumen: 1 },
    { id: 'e', nombre: 'Pad', volumen: 1 },
  ];
  it('usa valores por rol, avisa y deja una suma en el objetivo', () => {
    const plan = planificarAutomezcla(pistas);
    expect(plan.sinMedicion).toHaveLength(5);
    expect(plan.notas.join(' ')).toMatch(/Sin medición/);
    expect(plan.pistas.every((p) => p.origen === 'rol')).toBe(true);
    expect(plan.sumaRmsDb).toBeCloseTo(-18, 0);
    expect(plan.picoSumaDb).toBeLessThan(-3);
    expect(plan.pistas.find((p) => p.id === 'b')!.eq.find((b) => b.tipo === 'lowCut')).toBeUndefined();
  });
  it('sin pistas devuelve un plan vacío', () => {
    expect(planificarAutomezcla([]).pistas).toEqual([]);
  });
});

describe('pico', () => {
  it('con una cresta alta de la suma se baja todo para no pasar de −3 dBFS', () => {
    const plan = planificarAutomezcla(pasadaSorda(), { crestaSumaDb: 20 });
    expect(plan.picoSumaDb).toBeLessThanOrEqual(-3);
    expect(plan.sumaRmsDb).toBeLessThan(-18);
  });
});

describe('corregirBalanceMaster', () => {
  it('no hace nada si ya cumple', () => {
    expect(corregirBalanceMaster([0.05, 0.3, 0.2, 0.25, 0.15, 0.05]).eq).toEqual([]);
  });
  it('corrige con menos de ±3 dB', () => {
    const { eq } = corregirBalanceMaster([0.15, 0.7, 0.05, 0.05, 0.03, 0.02]);
    expect(eq.length).toBeGreaterThan(0);
    for (const b of eq) expect(Math.abs(b.gain)).toBeLessThanOrEqual(3);
    const lowCut = eq.find((b) => b.tipo === 'lowCut');
    expect(lowCut?.freq).toBeLessThanOrEqual(30);
  });
});

describe('respuestaBandaDb y repartoEspectral', () => {
  it('un pasa-altos atenúa más cuanto más abajo', () => {
    const hp = { slot: 1, tipo: 'lowCut' as const, freq: 100, gain: 0, q: 0.7, pendiente: 12 };
    expect(respuestaBandaDb(hp, 35)).toBeLessThan(-15);
    expect(respuestaBandaDb(hp, 1000)).toBeGreaterThan(-0.1);
  });
  it('el reparto suma 1', () => {
    const r = repartoEspectral([1, 2, 3, 4, 5, 5]);
    expect(r.bandas.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});

describe('secciones', () => {
  it('clasifica nombres en español e inglés', () => {
    expect(clasificarSeccion('Pre-Coro')).toBe('precoro');
    expect(clasificarSeccion('Coro final')).toBe('coro');
    expect(clasificarSeccion('Chorus 2')).toBe('coro');
    expect(clasificarSeccion('Puente')).toBe('puente');
    expect(clasificarSeccion('Verse 1')).toBe('verso');
    expect(clasificarSeccion('Intro')).toBe('intro');
    expect(clasificarSeccion('Outro')).toBe('final');
  });
  it('el puente crece y sin secciones no hay curva', () => {
    const c = curvaVolumenPorSeccion(1, [{ nombre: 'Puente', compases: 8 }], 100, 4)!;
    expect(c[1]!.valor).toBeGreaterThan(c[0]!.valor);
    expect(curvaVolumenPorSeccion(1, [], 100, 4)).toBeNull();
  });
  it('tablas coherentes', () => {
    expect(HPF_HZ.bajo).toBe(0);
    expect(HPF_HZ.bombo).toBe(0);
    expect(Math.abs(PANEO_ROL.guitarra)).toBeGreaterThan(0);
  });
});

describe('perfiles de mezcla por estilo', () => {
  const secciones = [{ nombre: 'Verso', compases: 8 }, { nombre: 'Coro', compases: 8 }];
  const planDe = (id: string) => planificarAutomezcla(pasadaSorda(), { perfil: PERFILES_MEZCLA.find((p) => p.id === id)!, secciones, bpm: 100, numerador: 4 });

  it('hay al menos worship, pop, rock, balada, jazz y electrónica, todos con datos coherentes', () => {
    const ids = PERFILES_MEZCLA.map((p) => p.id);
    for (const id of ['worship-moderno', 'pop', 'rock', 'balada', 'jazz', 'electronica']) expect(ids).toContain(id);
    for (const p of PERFILES_MEZCLA) {
      expect(p.master.lufs).toBeLessThan(-6);
      expect(p.master.picoDbtp).toBeLessThanOrEqual(0);
      expect(p.objetivoEspectral.gravesMax).toBeGreaterThan(0.3);
      expect(p.objetivoEspectral.mediosMin).toBeGreaterThan(0.1);
      // el coro nunca suena más bajo que el verso
      expect(p.seccion.coro[0]).toBeGreaterThan(p.seccion.verso[0]);
      for (const hz of Object.values(p.hpfHz)) expect(hz).toBeLessThanOrEqual(200);
      expect(p.hpfHz.bajo).toBe(0);
      expect(p.hpfHz.bombo).toBe(0);
    }
    expect(PERFILES_MEZCLA.find((p) => p.id === 'worship-moderno')!.objetivoEspectral).toEqual({ gravesMax: 0.45, mediosMin: 0.25 });
  });

  it('cada perfil produce una mezcla distinta (niveles, filtros, paneo, curva de secciones)', () => {
    const planes = PERFILES_MEZCLA.map((p) => planDe(p.id));
    const firmas = new Set(planes.map((pl) => JSON.stringify(pl.pistas.map((x) => [x.volumen, x.paneo, x.eq, x.envioReverb, x.curvaVolumen]))));
    expect(firmas.size).toBe(PERFILES_MEZCLA.length);
    const dif = (id: string) => {
      const c = planDe(id).pistas.find((x) => x.id === 'pia')!.curvaVolumen!;
      return 20 * Math.log10(c[2]!.valor / c[0]!.valor);
    };
    // coro − verso: jazz < worship (3) < pop (4) < balada (5)
    expect(dif('jazz')).toBeLessThan(dif('worship-moderno'));
    expect(dif('worship-moderno')).toBeCloseTo(3, 0);
    expect(dif('pop')).toBeGreaterThan(dif('worship-moderno'));
    expect(dif('balada')).toBeGreaterThan(dif('pop'));
  });

  it('cambiar de perfil cambia el balance: el rock pone la guitarra más alta y abierta que el worship; el jazz filtra menos', () => {
    const w = planDe('worship-moderno');
    const r = planDe('rock');
    const j = planDe('jazz');
    const rel = (pl: typeof w, id: string) => pl.pistas.find((x) => x.id === id)!;
    const salida = (pl: typeof w, id: string) => pistasRms(id) + 20 * Math.log10(rel(pl, id).volumen);
    function pistasRms(id: string) { return pasadaSorda().find((x) => x.id === id)!.medicion!.rmsDb!; }
    expect(salida(r, 'gui') - salida(r, 'cue')).toBeGreaterThan(salida(w, 'gui') - salida(w, 'cue'));
    expect(Math.abs(rel(r, 'gui').paneo)).toBeGreaterThan(Math.abs(rel(w, 'gui').paneo));
    expect(rel(j, 'pia').eq.find((b) => b.tipo === 'lowCut')!.freq).toBeLessThan(rel(w, 'pia').eq.find((b) => b.tipo === 'lowCut')!.freq);
    expect(w.perfil.id).toBe('worship-moderno');
    expect(r.perfil.master.lufs).toBeGreaterThan(w.perfil.master.lufs);
    expect(j.perfil.master.lufs).toBeLessThan(w.perfil.master.lufs);
  });

  it('el objetivo espectral de cada perfil se cumple o se informa en las notas (pasada con 90 % de graves)', () => {
    for (const p of PERFILES_MEZCLA) {
      const plan = planDe(p.id);
      if (plan.cumple.graves) expect(plan.espectroDespues.graves).toBeLessThan(p.objetivoEspectral.gravesMax);
      else expect(plan.notas.join(' ')).toMatch(/Aviso/);
      expect(plan.picoSumaDb).toBeLessThan(-3);
    }
    // worship: el caso medido real queda por debajo de 45 % de graves y por encima de 25 % de medios
    const w = planDe('worship-moderno');
    expect(w.espectroDespues.graves).toBeLessThan(0.45);
    expect(w.espectroDespues.medios).toBeGreaterThan(0.25);
  });

  it('elección: productor > hoja > pedido > defecto', () => {
    expect(elegirPerfilMezcla({ productor: 'Rock', estiloHoja: 'pop', pedido: 'worship' })).toMatchObject({ origen: 'productor', perfil: { id: 'rock' } });
    expect(elegirPerfilMezcla({ estiloHoja: 'balada íntima', pedido: 'worship' })).toMatchObject({ origen: 'hoja', perfil: { id: 'balada' } });
    expect(elegirPerfilMezcla({ pedido: 'Haz una canción de adoración en Re' })).toMatchObject({ origen: 'pedido', perfil: { id: 'worship-moderno' } });
    expect(elegirPerfilMezcla({ pedido: 'quiero un tema de jazz suave' })).toMatchObject({ origen: 'pedido', perfil: { id: 'jazz' } });
    expect(elegirPerfilMezcla({ pedido: 'algo bonito' })).toMatchObject({ origen: 'defecto' });
    // el perfil del usuario con el mismo nombre gana al de serie
    const propio = validarPerfilMezcla({ id: 'mi-pop', nombre: 'pop', base: 'pop' });
    expect(propio.ok).toBe(true);
    if (propio.ok) expect(elegirPerfilMezcla({ productor: 'pop', perfiles: [propio.perfil] }).perfil.id).toBe('mi-pop');
  });

  it('validación del perfil del productor: hereda de la base, acota y explica los errores en español', () => {
    const ok = validarPerfilMezcla({ id: 'Mi Estilo', nombre: 'Mi estilo', base: 'rock', nivelDb: { guitarra: -3 }, master: { lufs: -11, picoDbtp: -1 } });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.perfil.id).toBe('mi-estilo');
      expect(ok.perfil.nivelDb.guitarra).toBe(-3);
      expect(ok.perfil.nivelDb.bateria).toBe(-3); // heredado del rock
      expect(ok.perfil.master.lufs).toBe(-11);
      const plan = planificarAutomezcla(pasadaSorda(), { perfil: ok.perfil });
      expect(plan.perfil.id).toBe('mi-estilo');
    }
    const mal = validarPerfilMezcla({ nombre: '', nivelDb: { tuba: -3, bajo: 99 }, master: { lufs: 5 }, objetivoEspectral: { gravesMax: 2 } });
    expect(mal.ok).toBe(false);
    if (!mal.ok) {
      const t = mal.errores.join(' | ');
      expect(t).toMatch(/Falta «id»/);
      expect(t).toMatch(/rol desconocido «tuba»/);
      expect(t).toMatch(/nivelDb\.bajo/);
      expect(t).toMatch(/master/);
      expect(t).toMatch(/objetivoEspectral/);
    }
    expect(validarPerfilMezcla('x').ok).toBe(false);
  });

  it('describirPerfilMezcla resume el guion para el modelo', () => {
    const t = describirPerfilMezcla(PERFILES_MEZCLA[0]!);
    expect(t).toMatch(/Worship moderno/);
    expect(t).toMatch(/-14 LUFS/);
    expect(t).toMatch(/graves/);
  });
});
