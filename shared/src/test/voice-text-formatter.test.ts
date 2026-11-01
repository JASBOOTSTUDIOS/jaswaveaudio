import { describe, it, expect } from 'vitest';
import {
  aplicarPuntuacionHablada,
  capitalizarFrases,
  componerTextoDictado,
  formatearTextoDictado,
  limpiarEspaciado,
  normalizarTerminosDaw,
  terminaFrase,
  textoDictado,
} from '../voice/voice-text-formatter';
import * as shared from '../index';

describe('formatearTextoDictado: puntuación hablada', () => {
  it('ejemplo del plan: coma, punto y términos del DAW', () => {
    expect(formatearTextoDictado('por favor agrega una pista de piano midi coma con tempo a 120 bpm punto')).toBe(
      'Por favor agrega una pista de piano MIDI, con tempo a 120 BPM.',
    );
  });

  it('coma, punto y coma y dos puntos', () => {
    expect(formatearTextoDictado('bajo coma batería punto y coma guitarra dos puntos limpia')).toBe(
      'Bajo, batería; guitarra: limpia',
    );
  });

  it('signos de interrogación y exclamación (con y sin apertura)', () => {
    expect(formatearTextoDictado('está afinado signo de interrogación')).toBe('Está afinado?');
    expect(formatearTextoDictado('está afinado signo de pregunta')).toBe('Está afinado?');
    expect(formatearTextoDictado('abre interrogación está afinado cierra interrogación')).toBe('¿Está afinado?');
    expect(formatearTextoDictado('suena genial signo de exclamación')).toBe('Suena genial!');
    expect(formatearTextoDictado('suena genial signo de admiración')).toBe('Suena genial!');
    expect(formatearTextoDictado('abre exclamación qué bien suena signo de exclamación')).toBe('¡Qué bien suena!');
  });

  it('punto y seguido pone mayúscula a la frase siguiente', () => {
    expect(formatearTextoDictado('sube la reverb punto y seguido baja el master')).toBe('Sube la Reverb. Baja el Master');
    expect(formatearTextoDictado('sube la reverb punto seguido baja el master')).toBe('Sube la Reverb. Baja el Master');
  });

  it('nueva línea / salto de línea / punto y aparte', () => {
    expect(formatearTextoDictado('verso uno nueva línea estribillo')).toBe('Verso uno\nEstribillo');
    expect(formatearTextoDictado('verso uno salto de linea estribillo')).toBe('Verso uno\nEstribillo');
    expect(formatearTextoDictado('fin del verso punto y aparte puente')).toBe('Fin del verso.\nPuente');
  });

  it('no confunde «punto» como sustantivo ni palabras que contienen «coma»', () => {
    expect(formatearTextoDictado('mueve el punto de inicio')).toBe('Mueve el punto de inicio');
    expect(formatearTextoDictado('el comando de la paleta')).toBe('El comando de la paleta');
    expect(formatearTextoDictado('puntos de corte')).toBe('Puntos de corte');
  });

  it('no duplica signos que el reconocedor ya puso', () => {
    expect(formatearTextoDictado('Hola. punto')).toBe('Hola.');
    expect(formatearTextoDictado('uno coma punto')).toBe('Uno.');
  });

  it('respeta mayúsculas de la frase hablada en cualquier caja', () => {
    expect(formatearTextoDictado('Hola Coma qué tal Punto')).toBe('Hola, qué tal.');
  });
});

describe('normalizarTerminosDaw', () => {
  it('MIDI, VST, BPM, dB, EQ, Pan', () => {
    expect(normalizarTerminosDaw('midi vst vst3 bpm db eq pan')).toBe('MIDI VST VST3 BPM dB EQ Pan');
    expect(normalizarTerminosDaw('Baja 3 DB el EQ del Midi')).toBe('Baja 3 dB el EQ del MIDI');
  });

  it('solo palabras completas', () => {
    expect(normalizarTerminosDaw('panorama midiendo dbx vstx')).toBe('panorama midiendo dbx vstx');
    expect(normalizarTerminosDaw('añade sidechain al bajo y reverb al máster')).toBe('añade Sidechain al bajo y Reverb al máster');
  });
});

describe('limpiarEspaciado y capitalizarFrases', () => {
  it('quita espacios dobles y alrededor de signos y saltos', () => {
    expect(limpiarEspaciado('hola  ,   mundo .  adiós \n  otra')).toBe('hola, mundo. adiós\notra');
    expect(limpiarEspaciado('¿ qué tal ?')).toBe('¿qué tal?');
  });

  it('no separa decimales', () => {
    expect(limpiarEspaciado('a 120.5 BPM')).toBe('a 120.5 BPM');
  });

  it('mayúscula tras punto y salto de línea', () => {
    expect(capitalizarFrases('uno. dos? tres! cuatro\ncinco')).toBe('Uno. Dos? Tres! Cuatro\nCinco');
    expect(capitalizarFrases('uno. dos', false)).toBe('uno. Dos');
    expect(capitalizarFrases('ñandú. éxito')).toBe('Ñandú. Éxito');
  });

  it('aplicarPuntuacionHablada deja los signos entre espacios para la limpieza', () => {
    expect(limpiarEspaciado(aplicarPuntuacionHablada('a coma b'))).toBe('a, b');
  });
});

describe('componerTextoDictado (ancla + finales + provisional, sin duplicar)', () => {
  it('la hipótesis provisional se sustituye, no se acumula', () => {
    const ancla = 'Hola';
    const pasos = [
      { finales: [], provisional: 'agrega' },
      { finales: [], provisional: 'agrega una' },
      { finales: [], provisional: 'agrega una pista' },
      { finales: ['agrega una pista'], provisional: '' },
      { finales: ['agrega una pista'], provisional: 'de piano' },
      { finales: ['agrega una pista', 'de piano'], provisional: '' },
    ];
    const valores = pasos.map((p) => componerTextoDictado({ ancla, ...p }));
    expect(valores).toEqual([
      'Hola agrega',
      'Hola agrega una',
      'Hola agrega una pista',
      'Hola agrega una pista',
      'Hola agrega una pista de piano',
      'Hola agrega una pista de piano',
    ]);
  });

  it('mayúscula al empezar vacío o tras un punto; minúscula a mitad de frase', () => {
    expect(componerTextoDictado({ ancla: '', finales: ['sube el volumen'] })).toBe('Sube el volumen');
    expect(componerTextoDictado({ ancla: 'Listo.', finales: ['sube el volumen'] })).toBe('Listo. Sube el volumen');
    // El reconocedor capitaliza cada frase: a mitad de frase se quita (salvo siglas).
    expect(componerTextoDictado({ ancla: 'Por favor', finales: ['Sube el volumen'] })).toBe('Por favor sube el volumen');
    expect(componerTextoDictado({ ancla: 'Carga el', finales: ['MIDI'] })).toBe('Carga el MIDI');
    expect(componerTextoDictado({ ancla: '', finales: ['Agrega una pista', 'La canción', 'Punto', 'Otra frase'] })).toBe(
      'Agrega una pista la canción. Otra frase',
    );
    expect(componerTextoDictado({ ancla: 'Línea\n', finales: ['otra'] })).toBe('Línea\nOtra');
  });

  it('no mete espacio si el ancla ya termina en espacio o el dictado empieza por signo', () => {
    expect(componerTextoDictado({ ancla: 'Bajo ', finales: ['y batería'] })).toBe('Bajo y batería');
    expect(componerTextoDictado({ ancla: 'Bajo', finales: ['coma batería'] })).toBe('Bajo, batería');
  });

  it('sin dictado devuelve el ancla intacta', () => {
    expect(componerTextoDictado({ ancla: 'texto  previo ', finales: [], provisional: '  ' })).toBe('texto  previo ');
  });

  it('formatear: false solo limpia espacios', () => {
    expect(textoDictado({ finales: ['midi  coma'], formatear: false })).toBe('midi coma');
  });

  it('terminaFrase', () => {
    expect(terminaFrase('')).toBe(true);
    expect(terminaFrase('Hola. ')).toBe(true);
    expect(terminaFrase('Hola')).toBe(false);
  });

  it('se exporta desde el índice de @jaswave/shared', () => {
    expect(typeof shared.formatearTextoDictado).toBe('function');
    expect(typeof shared.componerTextoDictado).toBe('function');
  });
});
