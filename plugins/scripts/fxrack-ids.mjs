// FX Rack comun (plugins/shared-dsp/jw_fxrack.h): fuente unica, del lado JS, de los ids, nombres, rangos y
// valores por defecto ESTANDAR de los 58 parametros del rack. La usan fxrack-comprobar.mjs (verificacion de
// plugins), ui-layout.mjs (validacion de la pagina MIX / FX) y los tests de la replica web.
// Debe coincidir con crearDefs() de jw_fxrack.h: fxrack-comprobar.mjs --dump lo comprueba contra la tabla REAL
// de un plugin compilado (<Plugin>_snapshot --dump-params).

export const FXR_BASE = 100
export const FXR_RANGO = 144

const SLOPE = ['12 dB/oct', '24 dB/oct']
const SAT = ['Tape', 'Tube']
const SYNC = ['Free', '1/4', '1/8', '1/8.', '1/16']
const REVERB = ['Plate', 'Hall', 'Room']

const L = (off, bloque, id, nombre, unidad, escala, min, max, defecto, decimales, desc, extra = {}) => ({
  off, bloque, id, nombre: `FX · ${nombre}`, unidad, escala, min, max, defecto, decimales, desc, ...extra,
})
const T = (off, bloque, id, nombre, desc) => L(off, bloque, id, nombre, '', 'toggle', 0, 1, 0, 0, desc, { pasos: 1, opciones: ['Off', 'On'] })
const S = (off, bloque, id, nombre, opciones, defecto, desc) => L(off, bloque, id, nombre, '', 'stepped', 0, opciones.length - 1, defecto, 0, desc, { pasos: opciones.length - 1, opciones })

export const BLOQUES = ['filtros', 'eq', 'compresor', 'saturacion', 'chorus', 'delay', 'reverb', 'salida']

const eqDef = [80, 200, 800, 2500, 6000, 10000]
const eqMin = [20, 20, 20, 20, 20, 1000]
const eqMax = [1000, 20000, 20000, 20000, 20000, 20000]
const eqTipo = ['low shelf', 'campana', 'campana', 'campana', 'campana', 'high shelf']

/** Los 58 parametros estandar, en el orden de jw_fxrack.h. */
export function paramsEstandar() {
  const p = []
  p.push(T(0, 'filtros', 'fx_hpf_on', 'HPF On', 'Activa el filtro paso-altos (corta graves)'))
  p.push(L(1, 'filtros', 'fx_hpf_freq', 'HPF Freq', 'Hz', 'log', 20, 1000, 80, 0, 'Frecuencia de corte del paso-altos'))
  p.push(S(2, 'filtros', 'fx_hpf_slope', 'HPF Slope', SLOPE, 0, 'Pendiente del paso-altos (0 = 12 dB/oct, 1 = 24 dB/oct)'))
  p.push(T(3, 'filtros', 'fx_lpf_on', 'LPF On', 'Activa el filtro paso-bajos (suaviza agudos)'))
  p.push(L(4, 'filtros', 'fx_lpf_freq', 'LPF Freq', 'Hz', 'log', 1000, 20000, 16000, 0, 'Frecuencia de corte del paso-bajos'))
  p.push(S(5, 'filtros', 'fx_lpf_slope', 'LPF Slope', SLOPE, 0, 'Pendiente del paso-bajos (0 = 12 dB/oct, 1 = 24 dB/oct)'))
  p.push(T(16, 'eq', 'fx_eq_on', 'EQ On', 'Activa el ecualizador parametrico de 6 bandas'))
  for (let b = 0; b < 6; b++) {
    const n = b + 1
    const shelf = b === 0 || b === 5
    p.push(L(17 + 3 * b, 'eq', `fx_eq_b${n}_freq`, `EQ Band ${n} Freq`, 'Hz', 'log', eqMin[b], eqMax[b], eqDef[b], 0, `Banda ${n} (${eqTipo[b]}): frecuencia central/esquina`))
    p.push(L(18 + 3 * b, 'eq', `fx_eq_b${n}_gain`, `EQ Band ${n} Gain`, 'dB', 'linear', -18, 18, 0, 1, `Banda ${n} (${eqTipo[b]}): ganancia en dB (0 = transparente)`, { bipolar: true }))
    p.push(L(19 + 3 * b, 'eq', `fx_eq_b${n}_q`, `EQ Band ${n} Q`, '', 'log', shelf ? 0.3 : 0.1, shelf ? 2 : 10, shelf ? 0.71 : 1, 2, `Banda ${n} (${eqTipo[b]}): factor de calidad Q (ancho de banda)`))
  }
  p.push(T(48, 'compresor', 'fx_comp_on', 'Comp On', 'Activa el compresor integrado'))
  p.push(L(49, 'compresor', 'fx_comp_threshold', 'Comp Threshold', 'dB', 'linear', -60, 0, -18, 1, 'Umbral del compresor en dBFS'))
  p.push(L(50, 'compresor', 'fx_comp_ratio', 'Comp Ratio', ':1', 'log', 1, 20, 3, 1, 'Relacion de compresion (n:1)'))
  p.push(L(51, 'compresor', 'fx_comp_attack', 'Comp Attack', 'ms', 'log', 0.1, 200, 10, 1, 'Tiempo de ataque'))
  p.push(L(52, 'compresor', 'fx_comp_release', 'Comp Release', 'ms', 'log', 10, 2000, 120, 0, 'Tiempo de liberacion'))
  p.push(L(53, 'compresor', 'fx_comp_knee', 'Comp Knee', 'dB', 'linear', 0, 24, 6, 1, 'Rodilla suave (0 = dura)'))
  p.push(L(54, 'compresor', 'fx_comp_makeup', 'Comp Makeup', 'dB', 'linear', 0, 24, 0, 1, 'Ganancia de compensacion'))
  p.push(L(55, 'compresor', 'fx_comp_mix', 'Comp Mix', '%', 'linear', 0, 100, 100, 0, 'Mezcla paralela (100 = solo comprimido)'))
  p.push(T(64, 'saturacion', 'fx_sat_on', 'Sat On', 'Activa la saturacion'))
  p.push(S(65, 'saturacion', 'fx_sat_type', 'Sat Type', SAT, 0, 'Tipo: 0 = cinta (simetrica, armonicos impares), 1 = valvula (asimetrica, armonicos pares)'))
  p.push(L(66, 'saturacion', 'fx_sat_drive', 'Sat Drive', '%', 'linear', 0, 100, 30, 0, 'Cantidad de saturacion'))
  p.push(L(67, 'saturacion', 'fx_sat_tone', 'Sat Tone', 'Hz', 'log', 1000, 20000, 12000, 0, 'Paso-bajos posterior (oscurece los armonicos)'))
  p.push(L(68, 'saturacion', 'fx_sat_mix', 'Sat Mix', '%', 'linear', 0, 100, 100, 0, 'Mezcla seco/saturado'))
  p.push(T(80, 'chorus', 'fx_chorus_on', 'Chorus On', 'Activa el chorus / ensemble'))
  p.push(L(81, 'chorus', 'fx_chorus_depth', 'Chorus Depth', '%', 'linear', 0, 100, 40, 0, 'Profundidad de la modulacion'))
  p.push(L(82, 'chorus', 'fx_chorus_rate', 'Chorus Rate', 'Hz', 'log', 0.05, 5, 0.6, 2, 'Velocidad del LFO'))
  p.push(L(83, 'chorus', 'fx_chorus_mix', 'Chorus Mix', '%', 'linear', 0, 100, 35, 0, 'Mezcla (100 = ensemble 50/50)'))
  p.push(T(96, 'delay', 'fx_delay_on', 'Delay On', 'Activa el delay estereo'))
  p.push(S(97, 'delay', 'fx_delay_sync', 'Delay Sync', SYNC, 0, 'Sincronia al tempo del host: 0 = libre (Time), 1 = 1/4, 2 = 1/8, 3 = 1/8 con puntillo, 4 = 1/16'))
  p.push(L(98, 'delay', 'fx_delay_time', 'Delay Time', 'ms', 'log', 20, 2000, 350, 0, 'Tiempo del delay en modo libre'))
  p.push(L(99, 'delay', 'fx_delay_feedback', 'Delay Feedback', '%', 'linear', 0, 90, 35, 0, 'Realimentacion (repeticiones)'))
  p.push(L(100, 'delay', 'fx_delay_tone', 'Delay Tone', 'Hz', 'log', 500, 16000, 5000, 0, 'Paso-bajos en el lazo de realimentacion'))
  p.push(L(101, 'delay', 'fx_delay_mix', 'Delay Mix', '%', 'linear', 0, 100, 25, 0, 'Nivel del delay sumado a la senal seca'))
  p.push(T(102, 'delay', 'fx_delay_pingpong', 'Delay Ping-Pong', 'Rebote izquierda-derecha de las repeticiones'))
  p.push(T(112, 'reverb', 'fx_reverb_on', 'Reverb On', 'Activa la reverb'))
  p.push(S(113, 'reverb', 'fx_reverb_type', 'Reverb Type', REVERB, 1, 'Tipo: 0 = plate, 1 = hall, 2 = room'))
  p.push(L(114, 'reverb', 'fx_reverb_size', 'Reverb Size', '%', 'linear', 0, 100, 50, 0, 'Tamano / duracion de la cola'))
  p.push(L(115, 'reverb', 'fx_reverb_damping', 'Reverb Damping', '%', 'linear', 0, 100, 50, 0, 'Amortiguacion de agudos de la cola'))
  p.push(L(116, 'reverb', 'fx_reverb_predelay', 'Reverb Pre-Delay', 'ms', 'linear', 0, 200, 20, 0, 'Retardo previo a la reverb'))
  p.push(L(117, 'reverb', 'fx_reverb_mix', 'Reverb Mix', '%', 'linear', 0, 100, 20, 0, 'Nivel de la reverb sumado a la senal seca'))
  p.push(T(128, 'salida', 'fx_out_on', 'Out On', 'Activa la anchura estereo y la ganancia de salida del rack'))
  p.push(L(129, 'salida', 'fx_out_width', 'Out Width', '%', 'linear', 0, 200, 100, 0, 'Anchura estereo (0 = mono, 100 = original, 200 = doble)'))
  p.push(L(130, 'salida', 'fx_out_gain', 'Out Gain', 'dB', 'linear', -24, 12, 0, 1, 'Ganancia de salida del rack', { bipolar: true }))
  return p
}

/** Entradas ai.parameters del manifiesto (esquema V5) para el rack, con la descripcion para la IA en el nombre. */
export function parametrosManifiesto(base = FXR_BASE) {
  return paramsEstandar().map((e) => {
    const r = {
      id: e.id,
      vstParamId: base + e.off,
      name: `${e.nombre} — ${e.desc}`.slice(0, 120),
      min: e.min,
      max: e.max,
      default: e.defecto,
      unit: e.unidad,
      scale: e.escala === 'stepped' ? 'enum' : e.escala,
      feature: null,
    }
    if (e.escala === 'stepped') r.values = e.opciones
    return r
  })
}

export const DESCRIPCION_RACK =
  'Rack de mezcla comun integrado (ids FX · 100..230): paso-altos/bajos, ecualizador parametrico de 6 bandas, compresor, saturacion cinta/valvula, chorus, delay sincronizable al tempo, reverb plate/hall/room y anchura. Todo apagado por defecto (On = 0): no cambia el sonido hasta activarlo.'
