#!/usr/bin/env python3
"""Banco de texturas generado offline para JasWave Ambient Atmos (VST3 + réplica web).

A partir de muestras CC0 (guitarra limpia FreePats, pads FreePats, cuerdas VSCO 2 CE) produce, con semilla fija
(reproducible), tres bancos .jws de sostenido infinito con bucle sin costura POR CONSTRUCCIÓN:

  ambient-atmos-guitar.jws    4 capas: dreamy / octava / quinta+octava / rasgada saturada     (PaulStretch)
  ambient-atmos-pads.jws      5 capas: coro vocal / new age / barrido / arco / cuerdas etéreas (PaulStretch + movimiento espectral)
  ambient-atmos-textures.jws  6 capas de textura (aire, viento, presión, dron de cuerdas, olas, nube armónica)
                              + 4 de sound design (riser, downlifter, shimmer, guitarra inversa)

Técnica (la de las librerías de texturas): PaulStretch = FFT por ventanas con fases aleatorias -> el sonido se
"congela" en un sostenido de decenas de segundos sin artefactos de bucle. Cada zona se genera como L+X segundos y la
cola de X segundos se funde (equipotencia, tramos decorrelados) sobre el inicio: el último fotograma enlaza con el
primero sin clic. Las texturas aditivas usan parciales con número entero de ciclos por bucle (periodicidad exacta).

Solo se toma la IDEA de estilo: no hay muestras, nombres ni material de ninguna librería comercial.

Uso (las fuentes son datos no confiables: ejecutar con python -I):
  python -I atmos_gen.py --fuentes "%APPDATA%/JasWave/samples-src" --salida "%APPDATA%/JasWave/samples" [--familia all]
                         [--bucle-seg 12] [--semilla 20260808] [--rapido]
"""
import argparse
import importlib.util
import math
import os
import re
import struct
import sys
import time
import zlib
from fractions import Fraction

import numpy as np
import soundfile as sf
from scipy.signal import butter, resample_poly, sosfilt

SR = 32000                 # el contenido es suave: 32 kHz basta (agudos útiles hasta ~14 kHz) y ahorra memoria
TAM_ZONA = 64
RAICES = [36, 42, 48, 54, 60, 66, 72, 78, 84]          # guitarra y pads (C2..C6, cada 6 semitonos)
RAICES_TEX = [36, 48, 60, 72, 84]                       # texturas (cada octava)
RAICES_DIS = [48, 60, 72]                               # sound design
RMS_OBJETIVO_DB = -22.0                                 # nivel homogéneo de todas las zonas
RELEASE_ZONA = 2.0                                      # s; el plugin lo escala (0,1..8x)
NOTAS = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


# --------------------------------------------------------------------------------------
#  Utilidades
# --------------------------------------------------------------------------------------
def nota_a_midi(s):
    m = re.fullmatch(r"([a-gA-G])(#|b)?(-?\d+)", s.strip())
    if not m:
        raise ValueError(s)
    n = NOTAS[m.group(1).lower()] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)
    return (int(m.group(3)) + 1) * 12 + n


def rng_de(semilla, *clave):
    return np.random.default_rng((semilla * 1000003 + zlib.crc32("|".join(map(str, clave)).encode())) & 0xFFFFFFFF)


def leer(ruta):
    y, sr = sf.read(ruta, dtype="float64", always_2d=True)
    return y, sr


def a_ratio(sr_origen, semis):
    """Frac up/down para remuestrear sr_origen -> SR transponiendo `semis` semitonos (más agudo = más rápido)."""
    r = Fraction(SR, int(sr_origen)) / Fraction(2.0 ** (semis / 12.0)).limit_denominator(4000)
    r = r.limit_denominator(2000)
    return r.numerator, r.denominator


def transponer(y, sr_origen, semis):
    """y (n, ch) a SR, transpuesto `semis` semitonos (cambia la duración, como una cinta)."""
    up, down = a_ratio(sr_origen, semis)
    return resample_poly(y, up, down, axis=0, window=("kaiser", 9.0))


def mono(y):
    return y.mean(axis=1)


def hp_lp(x, hp=None, lp=None, orden=2):
    if hp:
        x = sosfilt(butter(orden, hp, "highpass", fs=SR, output="sos"), x)
    if lp:
        x = sosfilt(butter(orden, min(lp, SR * 0.45), "lowpass", fs=SR, output="sos"), x)
    return x


def hp_lp_loop(x, hp=None, lp=None, orden=2):
    """Filtro circular para bucles: se filtra el bucle repetido 3 veces y se toma la copia central (estado estacionario
    en ambos extremos): la costura sigue siendo continua tras filtrar."""
    n = len(x)
    y = hp_lp(np.tile(x, 3), hp=hp, lp=lp, orden=orden)
    return y[n: 2 * n]


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)))) if len(x) else 0.0


def sat_suave(x, pre):
    """Saturación tipo válvula (tanh asimétrica leve) con 4x de sobremuestreo: sin aliasing."""
    xs = resample_poly(x, 4, 1)
    y = np.tanh(xs * pre + 0.12 * xs * xs * pre) - np.tanh(0.12 * pre)
    return resample_poly(y, 1, 4)[: len(x)] / max(1.0, math.tanh(pre))


# --------------------------------------------------------------------------------------
#  PaulStretch con modulación espectral
# --------------------------------------------------------------------------------------
def ventana_seno(n):
    return np.sin(np.pi * (np.arange(n) + 0.5) / n)


def paulstretch(x, n_out, win_s, rng, stretch=None, region=None, mod=None, ruido=0.0, nivel_frames=True):
    """Sostenido congelado de `x` (mono) de n_out muestras.

    win_s    : duración de la ventana FFT (s); mayor = más suave y más afinado
    region   : (i0, i1) muestras de x que se recorren "de ida y vuelta" lentamente (None = todo x)
    mod      : f(t, f_hz) -> ganancia por bin (t = fracción 0..1 del bucle). Movimiento espectral
    ruido    : 0..1 mezcla de variación de magnitud tipo Rayleigh (aire, viento) en vez de magnitud limpia
    nivel_frames: normaliza la energía de cada fotograma (nivel constante; el movimiento viene de `mod`)
    """
    N = 1 << int(round(math.log2(max(256, win_s * SR))))
    half = N // 2
    w = ventana_seno(N)
    frames = int(math.ceil(n_out / half)) + 2
    f_hz = np.fft.rfftfreq(N, 1.0 / SR)
    if region is None:
        region = (0, len(x))
    i0, i1 = int(region[0]), int(region[1])
    ancho = max(1, i1 - i0 - N)
    # paso de lectura por fotograma: recorre la región ida y vuelta unas 2 veces en todo el bucle
    paso = (2.0 * ancho) / max(1, frames) if stretch is None else half / stretch
    pos0 = rng.uniform(0, ancho)
    out = np.zeros(frames * half + N)
    e_obj = None
    for k in range(frames):
        p = pos0 + k * paso
        ciclo = p % (2.0 * ancho)
        p = ciclo if ciclo <= ancho else 2.0 * ancho - ciclo
        a = i0 + int(p)
        seg = x[a: a + N]
        if len(seg) < N:
            seg = np.pad(seg, (0, N - len(seg)))
        mag = np.abs(np.fft.rfft(seg * w))
        if ruido > 0:
            r = np.sqrt(rng.standard_normal(len(mag)) ** 2 + rng.standard_normal(len(mag)) ** 2) / 1.2533
            mag = mag * ((1 - ruido) + ruido * r)
        if mod is not None:
            mag = mag * mod((k * half) / max(1, n_out), f_hz)
        if nivel_frames:
            e = float(np.sqrt(np.sum(mag * mag))) + 1e-12
            if e_obj is None:
                e_obj = e
            mag = mag * (e_obj / e)
        fase = rng.uniform(0, 2 * np.pi, len(mag))
        fase[0] = 0.0
        fr = np.fft.irfft(mag * np.exp(1j * fase), N) * w
        out[k * half: k * half + N] += fr
    return out[half: half + n_out]            # descarta el arranque (solo medio solape)


def cerrar_bucle(y, X):
    """y tiene L+X muestras -> bucle de L sin costura (fundido equipotencia de la cola sobre el inicio)."""
    L = len(y) - X
    t = (np.arange(X) + 0.5) / X * (np.pi / 2)
    z = y[:L].copy()
    z[:X] = y[:X] * np.sin(t) + y[L: L + X] * np.cos(t)
    return z


def render_estereo(fuente_L, fuente_R, n_out, X, rng, win_s, region_L=None, region_R=None, corr=0.3, **kw):
    """Estéreo ancho: tres renders independientes (L, R y un común que da `corr` de correlación)."""
    tot = n_out + X
    a = paulstretch(fuente_L, tot, win_s, rng, region=region_L, **kw)
    b = paulstretch(fuente_R, tot, win_s, rng, region=region_R, **kw)
    if corr > 0:
        c = paulstretch(0.5 * (fuente_L + fuente_R), tot, win_s, rng, region=region_L, **kw)
        a = math.sqrt(1 - corr) * a + math.sqrt(corr) * c
        b = math.sqrt(1 - corr) * b + math.sqrt(corr) * c
    return cerrar_bucle(a, X), cerrar_bucle(b, X)


# --------------------------------------------------------------------------------------
#  Fuentes
# --------------------------------------------------------------------------------------
class Fuentes:
    def __init__(self, base):
        self.base = base
        self._cache = {}
        self.tunes = {}                       # ruta de muestra -> corrección de afinación del SFZ (cents)
        self.guitarra = self._indexar_guitarra()
        self.pads = {}
        self._indexar_pads()
        self.cuerdas = self._indexar_cuerdas()

    def _dir(self, nombre):
        d = os.path.join(self.base, nombre)
        sub = [s for s in os.listdir(d) if os.path.isdir(os.path.join(d, s))]
        return os.path.join(d, sub[0]) if sub else d

    def _indexar_guitarra(self):
        d = os.path.join(self._dir("guitar-clean1"), "samples", "bridge")
        idx = {}
        for f in sorted(os.listdir(d)):
            m = re.fullmatch(r"([A-G]#?)(\d)_s(\d)_(\d\d)\.flac", f)     # solo golpes normales (sin _soft_)
            if m:
                idx.setdefault(nota_a_midi(m.group(1) + m.group(2)), []).append(os.path.join(d, f))
        sfz = [f for f in os.listdir(self._dir("guitar-clean1")) if f.endswith(".sfz")]
        if sfz:
            spec = importlib.util.spec_from_file_location("sfz2jws", os.path.join(os.path.dirname(os.path.abspath(__file__)), "sfz2jws.py"))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            for r in mod.parsear_sfz(os.path.join(self._dir("guitar-clean1"), sfz[0])):
                t = float(r.get("tune", 0)) + 100.0 * float(r.get("transpose", 0))
                if t:
                    self.tunes[os.path.normpath(r["_ruta"])] = t
        return idx

    def _indexar_pads(self):
        spec = importlib.util.spec_from_file_location("sfz2jws", os.path.join(os.path.dirname(os.path.abspath(__file__)), "sfz2jws.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        for nombre in ("pad-choir", "pad-newage", "pad-sweep", "pad-bowed"):
            d = self._dir(nombre)
            sfz = [f for f in os.listdir(d) if f.endswith(".sfz")][0]
            regs = mod.parsear_sfz(os.path.join(d, sfz))
            lst = {}
            for r in regs:
                raiz = mod.nota_a_midi(r.get("pitch_keycenter", r.get("key", "60")))
                lst[raiz] = {"ruta": r["_ruta"], "ls": int(r["loop_start"]) if "loop_start" in r else None,
                             "le": int(r["loop_end"]) if "loop_end" in r else None,
                             "tune": float(r.get("tune", 0)) + 100.0 * float(r.get("transpose", 0))}   # cents que corrige el SFZ
            self.pads[nombre] = lst

    def _indexar_cuerdas(self):
        base = os.path.join(self.base, "vsco2ce", "Strings")
        sec = {"cello": ("Cello Section", "susvib", r"susvib_([A-G]#?\d)_v1_1\.wav"),
               "viola": ("Viola Section", "susvib", r"ViolaEns_susvib_([A-G]#?\d)_v1_1\.wav"),
               "violin": ("Violin Section", "susVib", r"VlnEns_susVib_([A-G]#?\d)_v1\.wav")}
        idx = {}
        for k, (carpeta, sub, pat) in sec.items():
            d = os.path.join(base, carpeta, sub)
            idx[k] = {}
            for f in sorted(os.listdir(d)):
                m = re.fullmatch(pat, f)
                if m:
                    idx[k][nota_a_midi(m.group(1))] = os.path.join(d, f)
        return idx

    def cargar(self, ruta):
        if ruta not in self._cache:
            if len(self._cache) > 24:
                self._cache.clear()
            self._cache[ruta] = leer(ruta)
        return self._cache[ruta]

    @staticmethod
    def cercana(dic, nota):
        k = min(dic, key=lambda n: (abs(n - nota), n))
        return k, dic[k]


def medir_cents(x, f0, N=1 << 17):
    """Error de afinación (cents, -60..60) de una señal estacionaria respecto a f0: peine armónico de 8 parciales
    sobre el espectro de una ventana de Hann. Sirve para igualar a temperamento una fuente de afinación imperfecta."""
    x = np.asarray(x, dtype=np.float64)
    if len(x) < 8192:
        return 0.0
    n = min(N, 1 << int(math.log2(len(x))))
    a = len(x) // 2 - n // 2
    mag = np.abs(np.fft.rfft(x[a: a + n] * np.hanning(n)))
    mejor, cm = -1e18, 0.0
    for c in range(-60, 61):
        f = f0 * 2.0 ** (c / 1200.0)
        sc = 0.0
        for k in range(1, 9):
            b = int(round(f * k * n / SR))
            if b < 1 or b + 2 >= len(mag):
                break
            sc += math.log(float(mag[b - 1: b + 2].max()) + 1e-9) / k
        if sc > mejor:
            mejor, cm = sc, c
    return float(cm)


def fuente_a_raiz(F, familia, nota_objetivo, **kw):
    """Devuelve (y_estereo_a_SR_en_la_nota_objetivo, region) leyendo la muestra más cercana y transponiéndola."""
    if familia == "guitarra":
        n0, rutas = F.cercana(F.guitarra, nota_objetivo)
        outs = []
        for i, ruta in enumerate(rutas[:2]):
            y, sr = F.cargar(ruta)
            y = y[: int(9.0 * sr)]
            outs.append(transponer(y, sr, nota_objetivo - n0 + F.tunes.get(os.path.normpath(ruta), 0.0) / 100.0))
        if len(outs) == 1:
            outs.append(outs[0])
        n = min(len(outs[0]), len(outs[1]))
        # canal L de la toma 1 y canal R de la toma 2 (ataques distintos: más ancho)
        yl = outs[0][:n, 0]
        yr = outs[1][:n, 1 if outs[1].shape[1] > 1 else 0]
        err = medir_cents(0.5 * (yl + yr)[int(0.35 * SR): int(5.0 * SR)], f_de(nota_objetivo), 1 << 17)
        if abs(err) >= 4.0:                      # igualar a temperamento (la toma real puede ir algo desafinada)
            outs = [transponer(F.cargar(r)[0][: int(9.0 * F.cargar(r)[1])], F.cargar(r)[1],
                               nota_objetivo - n0 + F.tunes.get(os.path.normpath(r), 0.0) / 100.0 - err / 100.0) for r in rutas[:2]]
            if len(outs) == 1:
                outs.append(outs[0])
            n = min(len(outs[0]), len(outs[1]))
            yl = outs[0][:n, 0]
            yr = outs[1][:n, 1 if outs[1].shape[1] > 1 else 0]
        return np.stack([yl, yr], axis=1), (int(0.35 * SR), n)
    nombre = familia
    n0, e = F.cercana(F.pads[nombre], nota_objetivo)
    if nombre == "pad-bowed":                       # L y R son archivos separados
        base = e["ruta"][:-6]
        y, sr = F.cargar(base + "L.flac")
        yr, _ = F.cargar(base + "R.flac")
        n = min(len(y), len(yr))
        y = np.stack([y[:n, 0], yr[:n, 0]], axis=1)
    else:
        y, sr = F.cargar(e["ruta"])
    semis = nota_objetivo - n0 + e.get("tune", 0.0) / 100.0       # el SFZ corrige la afinación de cada muestra
    yy = transponer(y, sr, semis)
    k = SR / sr / (2.0 ** (semis / 12.0))
    ls0 = int(e["ls"] * k) if e["ls"] else int(0.2 * len(yy))
    le0 = min(int(e["le"] * k) if e["le"] else int(0.95 * len(yy)), len(yy))
    err = medir_cents(mono(yy[ls0:le0]), f_de(nota_objetivo)) if le0 - ls0 > 16384 else 0.0
    if abs(err) >= 4.0:                                          # iguala a temperamento las fuentes algo desafinadas
        semis -= err / 100.0
        yy = transponer(y, sr, semis)
        k = SR / sr / (2.0 ** (semis / 12.0))
    ls = int(e["ls"] * k) if e["ls"] else int(0.2 * len(yy))
    le = int(e["le"] * k) if e["le"] else int(0.95 * len(yy))
    le = min(le, len(yy))
    return yy, (ls, max(ls + 8192, le))


def fuente_cuerdas(F, seccion, nota_objetivo):
    n0, ruta = F.cercana(F.cuerdas[seccion], nota_objetivo)
    y, sr = F.cargar(ruta)
    y = y[: int(8.0 * sr)]
    yy = transponer(y, sr, nota_objetivo - n0)
    err = medir_cents(mono(yy[int(0.5 * SR): int(6.0 * SR)]), f_de(nota_objetivo))
    if abs(err) >= 4.0:
        yy = transponer(y, sr, nota_objetivo - n0 - err / 100.0)
    return yy, (int(0.5 * SR), len(yy))


# --------------------------------------------------------------------------------------
#  Familias
# --------------------------------------------------------------------------------------
def entre(a, b, t):
    return a + (b - a) * t


def gauss_log(f, fc, bw_oct):
    return np.exp(-0.5 * (np.log2(np.maximum(f, 1.0) / fc) / bw_oct) ** 2)


def capa_guitarra(F, capa, nota, n_out, X, semilla, rapido):
    rng = rng_de(semilla, "guitarra", capa, nota)
    win = 0.5 if rapido else 1.0

    def dream(nt, seed_off=0):
        r = rng_de(semilla, "guitarra", capa, nt, seed_off)
        y, region = fuente_a_raiz(F, "guitarra", nt)
        # un poco de "respiración" espectral lenta
        mod = lambda t, f: 0.75 + 0.25 * np.sin(2 * np.pi * (t * 1.0) + f * 0.0006) ** 2 + 0.2 * gauss_log(f, 2500, 1.2) * np.sin(2 * np.pi * t) ** 2
        l, rr = render_estereo(y[:, 0], y[:, 1], n_out, X, r, win, region, region, corr=0.25, mod=mod)
        return l, rr

    L, R = dream(nota)
    if capa == 1:      # octava sutil
        l2, r2 = dream(nota + 12, 1)
        L, R = L + 0.38 * l2, R + 0.38 * r2
    elif capa == 2:    # quinta + octava (acorde abierto)
        l5, r5 = dream(nota + 7, 2)
        l12, r12 = dream(nota + 12, 3)
        L, R = L + 0.26 * l5 + 0.24 * l12, R + 0.26 * r5 + 0.24 * r12
    elif capa == 3:    # rasgada saturada: acorde de potencia saturado antes del congelado
        notas = [nota, nota + 7, nota + 12]
        ys = []
        for i, nt in enumerate(notas):
            y, region = fuente_a_raiz(F, "guitarra", nt)
            ys.append((y, region))
        n = min(len(y) for y, _ in ys)
        yl = sum(y[:n, 0] * g for (y, _), g in zip(ys, (1.0, 0.7, 0.5)))
        yr = sum(y[:n, 1] * g for (y, _), g in zip(ys, (1.0, 0.7, 0.5)))
        pk = max(np.max(np.abs(yl)), np.max(np.abs(yr)), 1e-6)
        yl, yr = sat_suave(yl / pk, 5.0), sat_suave(yr / pk, 5.0)
        region = (int(0.35 * SR), n)
        mod = lambda t, f: 0.8 + 0.2 * np.sin(2 * np.pi * t + f * 0.0004) ** 2
        L, R = render_estereo(yl, yr, n_out, X, rng_de(semilla, "gsat", nota), win, region, region, corr=0.3, mod=mod)
        L, R = hp_lp_loop(L, lp=5500, orden=2), hp_lp_loop(R, lp=5500, orden=2)
    L, R = hp_lp_loop(L, hp=55, lp=8500), hp_lp_loop(R, hp=55, lp=8500)
    return L, R


def formantes(t, f, fase):
    """Vocal suave a-o-u que se mueve con t (periódico): suma de dos picos gaussianos en log-frecuencia."""
    m = 0.5 + 0.5 * np.sin(2 * np.pi * t + fase)                  # 0 = «o», 1 = «a»
    f1 = entre(420.0, 720.0, m)
    f2 = entre(800.0, 1250.0, m)
    f3 = 2600.0
    g = 0.25 + 1.0 * gauss_log(f, f1, 0.28) + 0.8 * gauss_log(f, f2, 0.3) + 0.35 * gauss_log(f, f3, 0.3)
    return g / 1.4


def capa_pad(F, capa, nota, n_out, X, semilla, rapido):
    win = 0.5 if rapido else 1.0
    r = rng_de(semilla, "pad", capa, nota)
    if capa == 0:        # coro vocal con formantes que viajan
        y, region = fuente_a_raiz(F, "pad-choir", nota)
        yl = y[:, 0]
        yr = y[:, 1] if y.shape[1] > 1 else y[:, 0]
        mod = lambda t, f: formantes(t, f, 0.0)
        L, R = render_estereo(yl, yr, n_out, X, r, win * 1.4, region, region, corr=0.3, mod=mod)
    elif capa == 1:      # new age cálido, brillo que respira
        y, region = fuente_a_raiz(F, "pad-newage", nota)
        mod = lambda t, f: (0.55 + 0.45 * np.sin(np.pi * t * 2 + 0.5) ** 2) ** (np.log2(np.maximum(f, 100.0) / 800.0).clip(0, 4))
        L, R = render_estereo(y[:, 0], y[:, 0], n_out, X, r, win * 1.4, region, region, corr=0.3, mod=mod)
    elif capa == 2:      # barrido resonante lento
        y, region = fuente_a_raiz(F, "pad-sweep", nota)
        def mod(t, f):
            fc = 2.0 ** (entre(math.log2(350.0), math.log2(3200.0), 0.5 + 0.5 * math.sin(2 * math.pi * t)))
            return 0.35 + 2.0 * gauss_log(f, fc, 0.45) + 0.4 * gauss_log(f, fc * 2.0, 0.5)
        L, R = render_estereo(y[:, 0], y[:, 0], n_out, X, r, win * 1.2, region, region, corr=0.3, mod=mod)
    elif capa == 3:      # arco (stereo real), menos estirado: conserva la textura
        y, region = fuente_a_raiz(F, "pad-bowed", nota)
        mod = lambda t, f: 0.8 + 0.2 * np.sin(2 * np.pi * (t * 2) + f * 0.0008)
        L, R = render_estereo(y[:, 0], y[:, 1], n_out, X, r, win, region, region, corr=0.2, mod=mod)
    else:                # cuerdas etéreas: secciones de orquesta congeladas
        if nota < 50:
            secs = [("cello", 1.0), ("viola", 0.6)]
        elif nota < 68:
            secs = [("viola", 1.0), ("cello", 0.5), ("violin", 0.5)]
        else:
            secs = [("violin", 1.0), ("viola", 0.6)]
        L = np.zeros(n_out)
        R = np.zeros(n_out)
        for i, (s, g) in enumerate(secs):
            y, region = fuente_cuerdas(F, s, nota)
            mod = lambda t, f, ph=i: 0.85 + 0.15 * np.sin(2 * np.pi * t + ph)
            l, rr = render_estereo(y[:, 0], y[:, 0] if y.shape[1] == 1 else y[:, 1], n_out, X, rng_de(semilla, "cuerda", nota, s), win * 1.4, region, region, corr=0.2, mod=mod)
            L += g * l
            R += g * rr
    L, R = hp_lp_loop(L, hp=40, lp=11000), hp_lp_loop(R, hp=40, lp=11000)
    return L, R


def f_de(nota):
    return 440.0 * 2.0 ** ((nota - 69) / 12.0)


def espectro_textura(capa, nota, n_out, X, semilla, rapido):
    """Texturas por magnitud analítica + fases aleatorias (aire, viento, presión, olas)."""
    f0 = f_de(nota)
    win = 0.25 if rapido else 0.5
    rng = rng_de(semilla, "tex", capa, nota)
    sil = np.zeros(1)                                           # fuente vacía: la magnitud la fija `mod`
    N = 1 << int(round(math.log2(win * SR)))

    def armonicos(f, k_max, ancho_rel, ganancia):
        g = np.zeros_like(f)
        for k in range(1, k_max + 1):
            g += (1.0 / k ** 0.6) * np.exp(-0.5 * ((f - k * f0) / (ancho_rel * k * f0 + 3.0)) ** 2)
        return ganancia * g

    if capa == 0:        # aire
        def mod(t, f):
            base = (np.maximum(f, 50.0) / 3000.0) ** 0.25 * np.exp(-((np.maximum(f - 9000.0, 0.0)) / 4500.0) ** 2) * (f > 500.0)
            resp = 0.65 + 0.35 * np.sin(2 * np.pi * (1.0 * t) + np.log2(np.maximum(f, 80.0)) * 1.1) ** 2
            return base * resp * (1.0 + armonicos(f, 14, 0.012, 2.2))
        ruido = 1.0
    elif capa == 1:      # viento
        def mod(t, f):
            fc = 2.0 ** (entre(math.log2(380.0), math.log2(1500.0), 0.5 + 0.5 * math.sin(2 * math.pi * 2 * t)))
            return (0.15 + 1.6 * gauss_log(f, fc, 0.55)) * (f > 90.0) * np.exp(-(np.maximum(f - 3500.0, 0.0) / 1800.0) ** 2) * (1.0 + armonicos(f, 10, 0.01, 1.6))
        ruido = 0.85
    elif capa == 2:      # presión grave
        def mod(t, f):
            sw = 0.6 + 0.4 * np.sin(2 * np.pi * 2 * t) ** 2
            return (1.0 / (1.0 + (np.maximum(f, 20.0) / 160.0) ** 2.2)) * (f > 25.0) * (0.5 + 1.8 * armonicos(f, 6, 0.01, 1.0)) * sw
        ruido = 0.35
    else:                # olas (la envolvente temporal se aplica tras cerrar el bucle)
        def mod(t, f):
            fc = 2.0 ** (entre(math.log2(500.0), math.log2(5000.0), (0.5 + 0.5 * math.sin(2 * math.pi * 2 * t - 1.0)) ** 1.5))
            return (f > 120.0) * (1.0 / (1.0 + (np.maximum(f, 1.0) / fc) ** 3)) * (1.0 + armonicos(f, 8, 0.02, 0.8))
        ruido = 1.0
    return rng, mod, ruido, win


def capa_textura(F, capa, nota, n_out, X, semilla, rapido):
    tot = n_out + X
    if capa in (0, 1, 2, 4):
        idx = {0: 0, 1: 1, 2: 2, 4: 3}[capa]
        rng, mod, ruido, win = espectro_textura(idx, nota, n_out, X, semilla, rapido)
        base = rng.standard_normal(int(SR * 6))              # fuente de ruido blanco; su espectro lo da `mod`
        L = cerrar_bucle(paulstretch(base, tot, win, rng, mod=lambda t, f: mod(t, f), ruido=ruido, nivel_frames=False), X)
        R = cerrar_bucle(paulstretch(base[::-1].copy(), tot, win, rng_de(semilla, "texR", capa, nota), mod=lambda t, f: mod(t, f), ruido=ruido, nivel_frames=False), X)
        if capa == 4:    # olas: envolvente periódica (2 ciclos por bucle) y ligero desfase entre canales
            t = np.arange(n_out) / n_out
            L = L * (0.25 + 0.75 * (0.5 - 0.5 * np.cos(2 * np.pi * 2 * t - 1.0)) ** 1.6)
            R = R * (0.25 + 0.75 * (0.5 - 0.5 * np.cos(2 * np.pi * 2 * t - 1.0 + 0.5)) ** 1.6)
    elif capa == 3:      # dron de cuerdas: secciones congeladas + sub-octava
        L = np.zeros(n_out)
        R = np.zeros(n_out)
        grave = nota if nota < 60 else nota - 12
        for i, (s, g, off) in enumerate((("cello", 1.0, 0), ("viola", 0.55, 0), ("cello", 0.5, -12))):
            y, region = fuente_cuerdas(F, s, grave + off + (12 if nota >= 60 else 0))
            l, rr = render_estereo(y[:, 0], y[:, 0] if y.shape[1] == 1 else y[:, 1], n_out, X, rng_de(semilla, "dron", nota, i), 1.0 if not rapido else 0.5, region, region, corr=0.25, mod=lambda t, f: 0.85 + 0.15 * np.sin(2 * np.pi * t))
            L += g * l
            R += g * rr
        L, R = hp_lp_loop(L, hp=30, lp=5200), hp_lp_loop(R, hp=30, lp=5200)
    else:                # nube armónica: parciales con ciclos enteros por bucle -> periodicidad exacta
        L, R = nube_armonica(nota, n_out, semilla, brillo=0.0)
    return L, R


def nube_armonica(nota, n_out, semilla, brillo=0.0, parciales=26):
    """Aditivo: parciales armónicos (f0 redondeada a 1/L Hz) con 2 desafinaciones por parcial, modulación de
    amplitud lenta con ciclos enteros y fase aleatoria: cierra exactamente en bucle. brillo 0 = suave, 1 = cristalino."""
    rng = rng_de(semilla, "nube", nota, int(brillo * 10))
    f0 = f_de(nota)
    t = np.arange(n_out) / SR
    Ls = n_out / SR
    outs = []
    for canal in range(2):
        y = np.zeros(n_out)
        for k in range(1, parciales + 1):
            fk = k * f0
            if fk > 13000.0:
                break
            amp = k ** (-(1.3 - 0.8 * brillo))
            for det in (0.0, 1.0):
                fr = round((fk * (1.0 + det * (0.0009 + 0.0004 * rng.random()))) * Ls) / Ls
                ph = rng.uniform(0, 2 * np.pi)
                ciclos = int(rng.integers(1, 4))
                am = 0.55 + 0.45 * np.sin(2 * np.pi * ciclos * t / Ls + rng.uniform(0, 2 * np.pi))
                y += amp * am * np.sin(2 * np.pi * fr * t + ph) * (0.7 if det else 1.0)
        outs.append(y)
    return outs[0], outs[1]


def capa_diseno(F, capa, nota, semilla, rapido):
    """Sound design. 0 riser, 1 downlifter, 2 shimmer (bucle), 3 guitarra inversa. Devuelve (L, R, bucle?)."""
    dur = 4.0 if rapido else 8.0
    n = int(dur * SR)
    rng = rng_de(semilla, "dis", capa, nota)
    f0 = f_de(nota)
    if capa in (0, 1):
        base = rng.standard_normal(int(SR * 6))
        tot = n

        def mod(t, f):
            tt = t if capa == 0 else 1.0 - t                       # downlifter = riser invertido en el tiempo
            fc = 2.0 ** (entre(math.log2(250.0), math.log2(9500.0), tt ** 1.7))
            return (1.0 / (1.0 + (np.maximum(f, 1.0) / fc) ** 2.5)) * (f > 60.0) * (1.0 + 4.0 * gauss_log(f, fc * 1.05, 0.25))
        outs = []
        for ch in range(2):
            y = paulstretch(base if ch == 0 else base[::-1].copy(), n, 0.25, rng_de(semilla, "dis", capa, nota, ch), mod=mod, ruido=1.0, nivel_frames=False)
            outs.append(y)
        t = np.arange(n) / n
        # tono: barrido ascendente de una octava con 3 parciales
        fase = 2 * np.pi * np.cumsum(f0 * 2.0 ** (t if capa == 0 else 1.0 - t)) / SR
        ton = sum(a * np.sin(k * fase) for k, a in ((1, 1.0), (2, 0.45), (3, 0.25)))
        env = (t ** 2.2) if capa == 0 else ((1.0 - t) ** 1.8)
        pan = 0.25
        L = (outs[0] * 1.0 + pan * ton * 0.12) * env
        R = (outs[1] * 1.0 + pan * ton * 0.12) * env
        # el riser termina en seco: fundido corto; el downlifter empieza en seco y acaba en silencio
        fi, fo = int(0.02 * SR), int(0.06 * SR)
        L[:fi] *= np.linspace(0, 1, fi); R[:fi] *= np.linspace(0, 1, fi)
        L[-fo:] *= np.linspace(1, 0, fo); R[-fo:] *= np.linspace(1, 0, fo)
        return hp_lp(L, hp=40, lp=14000), hp_lp(R, hp=40, lp=14000), False
    if capa == 2:
        L, R = nube_armonica(nota + 12, n, semilla, brillo=1.0, parciales=34)
        return hp_lp_loop(L, hp=120, lp=13500), hp_lp_loop(R, hp=120, lp=13500), True
    # guitarra inversa: construcción al revés de 4 s y la nota natural que decae 3 s
    y, region = fuente_a_raiz(F, "guitarra", nota)
    nrev = int(0.55 * dur * SR)
    nfw = n - nrev
    seg = y[: max(nrev, 1)][::-1]
    seg = seg * (np.linspace(0, 1, len(seg)) ** 0.5)[:, None]
    fw = y[: nfw] * np.exp(-np.arange(min(nfw, len(y))) / SR / 1.6)[:, None]
    L = np.concatenate([seg[:, 0], fw[:, 0]])[:n]
    R = np.concatenate([seg[:, 1], fw[:, 1]])[:n]
    L = np.pad(L, (0, n - len(L))); R = np.pad(R, (0, n - len(R)))
    fo = int(0.5 * SR)
    L[-fo:] *= np.linspace(1, 0, fo) ** 2; R[-fo:] *= np.linspace(1, 0, fo) ** 2
    return hp_lp(L, hp=50, lp=9000), hp_lp(R, hp=50, lp=9000), False


# --------------------------------------------------------------------------------------
#  Escritura .jws
# --------------------------------------------------------------------------------------
def normalizar(L, R):
    r = math.sqrt(0.5 * (rms(L) ** 2 + rms(R) ** 2))
    if r < 1e-9:
        return L, R
    g = 10 ** (RMS_OBJETIVO_DB / 20.0) / r
    L, R = L * g, R * g
    pk = max(np.max(np.abs(L)), np.max(np.abs(R)))
    if pk > 0.97:
        L, R = L * (0.97 / pk), R * (0.97 / pk)
    return L, R


def a_pcm16(L, R, rng):
    y = np.stack([L, R], axis=1)
    d = (rng.random(y.shape) - rng.random(y.shape)) / 32768.0
    return np.clip(np.round((y + d) * 32767.0), -32768, 32767).astype("<i2")


def rango_teclas(raices, i):
    """lokey/hikey de la zona i: se reparten por puntos medios; los extremos llegan a 0 y 127."""
    lo = 0 if i == 0 else (raices[i - 1] + raices[i]) // 2 + 1
    hi = 127 if i == len(raices) - 1 else (raices[i] + raices[i + 1]) // 2
    return lo, hi


def metrica_costura(L, R):
    """Salto en la costura del bucle relativo al percentil 99 de |diferencia| muestra a muestra (<= 1 = sin clic)."""
    m = 0.5 * (L + R)
    d = np.abs(np.diff(m))
    ref = float(np.percentile(d, 99.0)) + 1e-12
    salto = abs(float(m[0] - m[-1]))
    return salto / max(ref, 1e-12), salto


class Banco:
    def __init__(self, nombre):
        self.nombre = nombre
        self.zonas = []
        self.pcm = bytearray()
        self.bucles = False
        self.info = []

    def agregar(self, lokey, hikey, root, capa, L, R, bucle, rng, release=RELEASE_ZONA):
        L, R = normalizar(L, R)
        PRE = 8
        if bucle:
            pre = (L[-PRE:], R[-PRE:])
            LL = np.concatenate([pre[0], L])
            RR = np.concatenate([pre[1], R])
            ls, le = PRE, PRE + len(L)
            self.bucles = True
            costura, salto = metrica_costura(L, R)
        else:
            LL, RR, ls, le = L, R, 0, 0
            costura, salto = 0.0, 0.0
        pcm = a_pcm16(LL, RR, rng)
        off = len(self.pcm)
        self.pcm += pcm.tobytes()
        reg = struct.pack("<8BIIIIffffQ4BI8x", lokey, hikey, root, 0, 127, 0, 1, 2, SR, pcm.shape[0], ls, le,
                          0.0, 0.0, float(release), 0.0, off, capa & 255, 0, 0, 0, 0)
        assert len(reg) == TAM_ZONA
        self.zonas.append(reg)
        self.info.append((capa, root, len(LL) / SR, costura, 20 * math.log10(max(np.max(np.abs(np.stack([L, R]))), 1e-9))))

    def guardar(self, ruta):
        inicio = 32 + TAM_ZONA * len(self.zonas)
        cab = b"JWS1" + struct.pack("<IIIIIII", 1, len(self.zonas), TAM_ZONA, inicio, 1 if self.bucles else 0, 0, 0)
        assert len(cab) == 32
        os.makedirs(os.path.dirname(os.path.abspath(ruta)), exist_ok=True)
        with open(ruta, "wb") as f:
            f.write(cab)
            for z in self.zonas:
                f.write(z)
            f.write(self.pcm)
        return os.path.getsize(ruta)


def generar(args):
    F = Fuentes(args.fuentes)
    n_loop = int(args.bucle_seg * SR)
    X = int(min(2.5, args.bucle_seg * 0.3) * SR)
    familias = ["guitar", "pads", "textures"] if args.familia == "all" else [args.familia]
    total = 0
    for fam in familias:
        t0 = time.time()
        b = Banco(f"ambient-atmos-{fam}")
        rng = rng_de(args.semilla, "dither", fam)
        if fam == "guitar":
            for capa in range(4):
                for i, nota in enumerate(RAICES):
                    L, R = capa_guitarra(F, capa, nota, n_loop, X, args.semilla, args.rapido)
                    lo, hi = rango_teclas(RAICES, i)
                    b.agregar(lo, hi, nota, capa, L, R, True, rng)
                print(f"  guitar capa {capa} lista ({time.time() - t0:.0f}s)", flush=True)
        elif fam == "pads":
            for capa in range(5):
                for i, nota in enumerate(RAICES):
                    L, R = capa_pad(F, capa, nota, n_loop, X, args.semilla, args.rapido)
                    lo, hi = rango_teclas(RAICES, i)
                    b.agregar(lo, hi, nota, capa, L, R, True, rng)
                print(f"  pads capa {capa} lista ({time.time() - t0:.0f}s)", flush=True)
        else:
            for capa in range(6):
                for i, nota in enumerate(RAICES_TEX):
                    L, R = capa_textura(F, capa, nota, n_loop, X, args.semilla, args.rapido)
                    lo, hi = rango_teclas(RAICES_TEX, i)
                    b.agregar(lo, hi, nota, capa, L, R, True, rng)
                print(f"  textures capa {capa} lista ({time.time() - t0:.0f}s)", flush=True)
            for k in range(4):                                  # capas 6..9 = sound design
                for i, nota in enumerate(RAICES_DIS):
                    L, R, bucle = capa_diseno(F, k, nota, args.semilla, args.rapido)
                    lo, hi = rango_teclas(RAICES_DIS, i)
                    b.agregar(lo, hi, nota, 6 + k, L, R, bucle, rng, release=1.5)
                print(f"  design {k} listo ({time.time() - t0:.0f}s)", flush=True)
        ruta = os.path.join(args.salida, f"ambient-atmos-{fam}.jws")
        tam = b.guardar(ruta)
        total += tam
        print(f"{ruta}: {len(b.zonas)} zonas, {tam / 1e6:.1f} MB")
        peor = max((c for _, _, _, c, _ in b.info), default=0.0)
        print(f"  costura de bucle (salto / p99 de la variación; <= 1 = sin clic): peor {peor:.2f}")
    print(f"TOTAL {total / 1e6:.1f} MB")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    base = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "JasWave")
    ap.add_argument("--fuentes", default=os.path.join(base, "samples-src"))
    ap.add_argument("--salida", default=os.path.join(base, "samples"))
    ap.add_argument("--familia", default="all", choices=["all", "guitar", "pads", "textures"])
    ap.add_argument("--bucle-seg", type=float, default=12.0)
    ap.add_argument("--semilla", type=int, default=20260808)
    ap.add_argument("--rapido", action="store_true", help="ventanas y sound design más cortos (pruebas)")
    generar(ap.parse_args())


if __name__ == "__main__":
    main()
