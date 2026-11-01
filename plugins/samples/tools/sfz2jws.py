#!/usr/bin/env python3
"""Convierte un instrumento SFZ (WAV/FLAC) en un banco .jws de JasWave (PCM16 + tabla de zonas).

Formato .jws v1 (little-endian), el mismo para el host nativo (C++) y la web (JS):
  cabecera 32 B : "JWS1", u32 version=1, u32 nZonas, u32 tamZona=64, u32 inicioDatos, u32 flags, u32[2] reservado
  zona    64 B  : u8 lokey,hikey,root,lovel,hivel,rrIndex,rrCount,canales | u32 sr,frames,loopIni,loopFin
                  f32 tuneCents,gainDb,releaseSec,pan | u64 offsetDatos | u8 grupo,offBy,oneShot,pad | u32 xfadeLoop | 8 B res.
  datos         : PCM16 entrelazado; offsetDatos es relativo a inicioDatos.

Pensado para limpiar las "marcas digitales": quita el DC, funde la entrada y la cola de cada muestra, cierra los
bucles con un fundido cruzado y reduce a 16 bits con dither TPDF.

Uso:
  python -I sfz2jws.py instrumento.sfz salida.jws [--rate 44100] [--mono] [--max-seg 8] [--capas-vel 5]
                       [--solo-teclas 36-96] [--ruta-base DIR] [--ganancia-db 0]
"""
import argparse
import math
import os
import re
import struct
import sys

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

MAGIC = b"JWS1"
TAM_ZONA = 64
NOTAS = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


def nota_a_midi(s):
    """'60', 'c4', 'f#3', 'db2' -> número MIDI (do central = c4 = 60)."""
    s = str(s).strip().lower()
    if re.fullmatch(r"-?\d+", s):
        return int(s)
    m = re.fullmatch(r"([a-g])(#|b)?(-?\d+)", s)
    if not m:
        raise ValueError(f"nota SFZ no válida: {s}")
    n = NOTAS[m.group(1)] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)
    return (int(m.group(3)) + 1) * 12 + n


def parsear_sfz(ruta, ruta_base=None):
    """Devuelve la lista de regiones con los opcodes heredados de global/master/group/control."""
    base = ruta_base or os.path.dirname(os.path.abspath(ruta))
    with open(ruta, encoding="utf-8", errors="replace") as f:
        txt = f.read()
    txt = re.sub(r"//[^\n]*", "", txt)
    ctl, glob, master, group = {}, {}, {}, {}
    regiones = []
    herencia = []
    default_path = ""
    nivel = None
    for tok in re.finditer(r"<(\w+)>|([A-Za-z_0-9]+)=([^\n<]*?)(?=\s+[A-Za-z_0-9]+=|\s*<|\s*$)", txt, re.M):
        if tok.group(1):
            nivel = tok.group(1).lower()
            if nivel == "global":
                glob, master, group = {}, {}, {}
            elif nivel == "master":
                master, group = {}, {}
            elif nivel == "group":
                group = {}
            elif nivel == "region":
                regiones.append({})
                herencia.append({**glob, **master, **group})  # lo heredado EN ESTE punto (cada <group> aporta lo suyo)
            continue
        k, v = tok.group(2).lower(), tok.group(3).strip()
        if nivel == "control":
            ctl[k] = v
            if k == "default_path":
                default_path = v
        elif nivel == "global":
            glob[k] = v
        elif nivel == "master":
            master[k] = v
        elif nivel == "group":
            group[k] = v
        elif nivel == "region" and regiones:
            regiones[-1][k] = v
    out = []
    for r, her in zip(regiones, herencia):
        d = {}
        d.update(her), d.update(r)
        if "sample" not in d:
            continue
        d["_ruta"] = os.path.normpath(os.path.join(base, default_path.replace("\\", "/"), d["sample"].replace("\\", "/")))
        out.append(d)
    return out


def reducir_capas(zonas, n):
    """Deja n capas de velocidad por (teclas, root) repartiendo sus rangos para no dejar huecos."""
    if n <= 0:
        return zonas
    grupos = {}
    for z in zonas:
        grupos.setdefault((z["lokey"], z["hikey"], z["root"], z["rr"]), []).append(z)
    res = []
    for _, zs in grupos.items():
        zs.sort(key=lambda z: z["lovel"])
        if len(zs) <= n:
            res.extend(zs)
            continue
        idx = sorted({round(i * (len(zs) - 1) / (n - 1)) for i in range(n)}) if n > 1 else [len(zs) // 2]
        elegidas = [zs[i] for i in idx]
        for i, z in enumerate(elegidas):
            z["lovel"] = 1 if i == 0 else (elegidas[i - 1]["hivel"] + 1)
            z["hivel"] = 127 if i == len(elegidas) - 1 else round((z["hivel"] + elegidas[i + 1]["lovel"]) / 2)
        for i in range(1, len(elegidas)):
            elegidas[i]["lovel"] = elegidas[i - 1]["hivel"] + 1
        res.extend(elegidas)
    return res


def procesar_audio(y, sr_origen, sr_destino, mono, max_seg, rng, bucle):
    """Limpieza antidigital: DC fuera, entrada/cola con fundido, remuestreo de calidad, dither TPDF."""
    if y.ndim == 1:
        y = y[:, None]
    if mono and y.shape[1] > 1:
        y = y.mean(axis=1, keepdims=True)
    y = y.astype(np.float64)
    y -= y.mean(axis=0, keepdims=True) * 0.999  # DC (sin tocar las frecuencias graves reales)
    if sr_destino != sr_origen:
        g = math.gcd(int(sr_origen), int(sr_destino))
        y = resample_poly(y, int(sr_destino) // g, int(sr_origen) // g, axis=0, window=("kaiser", 12.0))
    # recorta silencio digital inicial (conserva el ataque), con un margen de 2 ms
    umbral = 10 ** (-72 / 20)
    nivel = np.max(np.abs(y), axis=1)
    pos = np.nonzero(nivel > umbral)[0]
    ini = max(0, (pos[0] if len(pos) else 0) - int(0.002 * sr_destino))
    y = y[ini:]
    if max_seg and not bucle and y.shape[0] > int(max_seg * sr_destino):
        y = y[: int(max_seg * sr_destino)]
    n = y.shape[0]
    # entrada: 1,5 ms para no dejar un clic si la muestra no empieza en cero
    fin_in = min(n, max(8, int(0.0015 * sr_destino)))
    y[:fin_in] *= np.linspace(0.0, 1.0, fin_in)[:, None]
    # cola: fundido coseno en el último tramo (nunca corta en seco)
    if not bucle:
        cola = min(n, int(min(0.25, 0.15 * n / sr_destino + 0.05) * sr_destino))
        t = np.linspace(0, math.pi / 2, cola)
        y[n - cola :] *= (np.cos(t) ** 2)[:, None]
    # normaliza si pasa de 0 dBFS (sin subir las que van bajas: se conserva la dinámica entre capas)
    pico = float(np.max(np.abs(y))) if n else 0.0
    if pico > 0.98:
        y *= 0.98 / pico
    return y


def buscar_bucle(y, sr, min_seg):
    """Busca un bucle de sostenido: longitud = múltiplo entero del periodo (sin salto de fase), en cruces por
    cero ascendentes, dentro de la parte estable (30 %-90 % de la muestra). Devuelve (ini, fin) o None."""
    n = y.shape[0]
    m = y.mean(axis=1)
    if n < int((min_seg + 0.6) * sr):
        return None
    a0, a1 = int(0.30 * n), int(0.90 * n)
    # periodo por autocorrelación normalizada en una ventana estable
    w = m[int(0.45 * n) : int(0.45 * n) + int(0.4 * sr)]
    if len(w) < 4096:
        return None
    w = w - w.mean()
    lag_min, lag_max = int(sr / 1500), min(int(sr / 28), len(w) // 2)
    f = np.fft.rfft(w, 2 * len(w))
    ac = np.fft.irfft(f * np.conj(f))[: lag_max + 1]
    ac[:lag_min] = -np.inf
    lag = int(np.argmax(ac[: lag_max + 1]))
    if lag < lag_min or ac[lag] < 0.2 * ac[0]:
        periodo = None  # sin altura clara (ruido, pads): se usa una longitud libre
    else:
        # refina con interpolación parabólica
        y0, y1, y2 = ac[lag - 1], ac[lag], ac[lag + 1]
        den = (y0 - 2 * y1 + y2)
        periodo = lag + (0.5 * (y0 - y2) / den if den != 0 else 0.0)
    largo = int(min_seg * sr)
    if periodo:
        largo = int(round(max(1, round(largo / periodo)) * periodo))
    if a0 + largo > a1:
        largo = (a1 - a0) // 2
        if periodo:
            largo = int(round(max(1, int(largo / periodo)) * periodo))
    if largo < int(0.25 * sr):
        return None
    # cruces por cero ascendentes cerca del inicio
    cz = np.nonzero((m[a0 : a0 + int(0.2 * sr)][:-1] < 0) & (m[a0 : a0 + int(0.2 * sr)][1:] >= 0))[0]
    ini = a0 + (int(cz[0]) + 1 if len(cz) else 0)
    fin = ini + largo
    if fin > n - 8:
        return None
    return ini, fin


def buscar_bucle_corr(y, sr, min_seg, xfade, extra_seg=1.0):
    """Búsqueda de bucle por correlación (para sostenidos de conjunto: cuerdas, coros, pads con vibrato).

    No exige un periodo claro: dentro de la zona de energía estable elige (inicio, fin) maximizando la correlación
    entre el tramo previo al inicio y el previo al fin (el fundido cruzado queda coherente en fase), con energías
    parejas y con la menor fluctuación de nivel dentro del bucle (evita que «respire» al repetirse).
    Devuelve (ini, fin, rho) o None."""
    from scipy.signal import fftconvolve

    m = y.mean(axis=1)
    n = m.shape[0]
    hop = max(1, int(0.025 * sr))
    nf = n // hop - 1
    if nf < 20:
        return None
    marco = np.array([np.sqrt(np.mean(m[i * hop : (i + 2) * hop] ** 2)) for i in range(nf)])
    env = 20 * np.log10(marco + 1e-9)
    k_s = max(3, int(0.4 / 0.025))
    envs = np.convolve(np.pad(env, (k_s // 2, k_s - 1 - k_s // 2), mode="edge"), np.ones(k_s) / k_s, mode="valid")
    central = envs[int(0.2 * nf) : int(0.8 * nf)]
    med = float(np.median(central))
    # zona estable: desde que el nivel (suavizado 0,4 s) llega a 2,5 dB de la mediana hasta el último punto a menos de 3 dB (antes de la cola)
    idx_ok = np.nonzero(envs >= med - 2.5)[0]
    idx_ok = idx_ok[idx_ok >= int(0.6 / 0.025)]
    if len(idx_ok) == 0:
        return None
    i_ini = int(idx_ok[0])
    arriba = np.nonzero(envs[i_ini:] >= med - 3.0)[0]
    i_fin = i_ini + int(arriba[-1]) + 1
    a0, a1 = i_ini * hop, min(i_fin * hop + hop, n - 8)
    xf = int(xfade)
    lmin, lmax = int(min_seg * sr), int((min_seg + extra_seg) * sr)
    if a1 - a0 < lmin + xf + int(0.2 * sr):
        return None
    cs2 = np.concatenate([[0.0], np.cumsum(m * m)])
    cs_e = np.concatenate([[0.0], np.cumsum(env)])
    cs_e2 = np.concatenate([[0.0], np.cumsum(env * env)])
    mejor_sc, res = 1e9, None
    paso = max(1, int(0.04 * sr))
    for ini in range(a0 + xf, min(a1 - lmin, a0 + xf + int(2.5 * sr)), paso):
        s_lo = ini + lmin - xf
        s_hi = min(ini + lmax, a1) - xf          # fin máximo = s + xf <= a1
        if s_hi <= s_lo:
            break
        A = m[ini - xf : ini]
        ea = cs2[ini] - cs2[ini - xf]
        if ea < 1e-12:
            continue
        seg = m[s_lo : s_hi + xf]
        num = fftconvolve(seg, A[::-1], mode="valid")           # len = s_hi - s_lo + 1
        s = np.arange(s_lo, s_hi + 1)
        eb = cs2[s + xf] - cs2[s]
        rho = num / np.sqrt(ea * eb + 1e-30)
        lvl = np.abs(10 * np.log10((eb + 1e-30) / ea))
        fin = s + xf
        f0, f1 = ini // hop, np.minimum(fin // hop, nf)
        cnt = np.maximum(1, f1 - f0)
        mu = (cs_e[f1] - cs_e[f0]) / cnt
        var = np.maximum(0.0, (cs_e2[f1] - cs_e2[f0]) / cnt - mu * mu)
        sc = (1.0 - rho) + 0.15 * lvl + 0.25 * np.sqrt(var) + 0.02 * (ini - a0) / sr
        k = int(np.argmin(sc))
        if sc[k] < mejor_sc:
            mejor_sc, res = float(sc[k]), (ini, int(fin[k]), float(rho[k]))
    return res


def cerrar_bucle(y, ini, fin, xfade, rho=0.0):
    """Fundido cruzado: la cola del bucle se mezcla con lo que hay justo antes del inicio.
    Con rho = 0 es equipotencia (curvas cos/sen); con rho > 0 (tramos correlados) compensa para mantener la
    energía constante: g = 1/sqrt(1 + rho*sin(2θ))."""
    xfade = min(xfade, ini, fin - ini)
    if xfade < 8:
        return y, 0
    t = np.linspace(0, 1, xfade)[:, None]
    a = y[fin - xfade : fin].copy()
    b = y[ini - xfade : ini].copy()
    th = t * math.pi / 2
    g = 1.0 / np.sqrt(1.0 + float(np.clip(rho, 0.0, 1.0)) * np.sin(2 * th))
    y[fin - xfade : fin] = (a * np.cos(th) + b * np.sin(th)) * g
    return y, xfade


def normalizar_capa(y, sr, objetivo_db, dyn_db, vel_media, ini_s=0.0, dur_s=0.4):
    """Lleva el RMS del ataque al nivel que le toca a su velocidad (curva suave: pp = objetivo - dyn_db).
    La ventana de medida es [ini_s, ini_s+dur_s] (por defecto los primeros 0,4 s); si la muestra es más corta se
    mide su último tramo de dur_s (útil para sostenidos con ataque lento: medir el nivel ya estable)."""
    i0 = int(ini_s * sr)
    n1 = min(y.shape[0], i0 + int(dur_s * sr))
    if n1 - i0 < int(dur_s * sr) * 0.5:
        n1 = y.shape[0]
        i0 = max(0, n1 - int(dur_s * sr))
    n = n1 - i0
    if n < 32:
        return y
    rms = float(np.sqrt(np.mean(np.mean(y[i0:n1], axis=1) ** 2)))
    if rms < 1e-6:
        return y
    meta = objetivo_db - dyn_db * (1.0 - (vel_media / 127.0) ** 0.7)
    g = 10 ** ((meta - 20 * math.log10(rms)) / 20.0)
    g = min(g, 0.98 / max(float(np.max(np.abs(y))), 1e-9))
    return y * g


def a_pcm16(y, rng):
    dither = (rng.random(y.shape) - rng.random(y.shape)) / 32768.0  # TPDF de 1 LSB
    q = np.clip(np.round((y + dither) * 32767.0), -32768, 32767).astype("<i2")
    return q


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sfz")
    ap.add_argument("salida")
    ap.add_argument("--rate", type=int, default=44100)
    ap.add_argument("--mono", action="store_true")
    ap.add_argument("--max-seg", type=float, default=8.0)
    ap.add_argument("--capas-vel", type=int, default=0)
    ap.add_argument("--solo-teclas", default="")
    ap.add_argument("--ruta-base", default="")
    ap.add_argument("--comp-grave-db", type=float, default=0.0, help="dB extra en el registro grave (máx. en la nota 28; decae linealmente hasta --comp-grave-hasta): iguala el nivel entre cuerdas")
    ap.add_argument("--comp-grave-hasta", type=int, default=64, help="nota MIDI a partir de la cual deja de compensar los graves")
    ap.add_argument("--extender-teclas", default="", help="LO-HI: estira las zonas extremas hasta ese rango de notas MIDI")
    ap.add_argument("--ganancia-db", type=float, default=0.0)
    ap.add_argument("--norm-rms-db", type=float, default=None, help="RMS objetivo (dBFS, primeros 0,4 s) de la capa más fuerte; iguala notas y capas")
    ap.add_argument("--dyn-db", type=float, default=24.0, help="rango dinámico entre la capa más suave y la más fuerte al normalizar")
    ap.add_argument("--auto-loop", action="store_true", help="crea el bucle de sostenido en las muestras que no lo traen")
    ap.add_argument("--min-bucle", type=float, default=1.6, help="duración mínima (s) del bucle automático")
    ap.add_argument("--xfade-bucle", type=float, default=0.12, help="segundos de fundido en el cierre del bucle")
    ap.add_argument("--bucle-corr", action="store_true", help="con --auto-loop: búsqueda por correlación + fundido que conserva la energía (sostenidos de conjunto con vibrato: cuerdas, coros)")
    ap.add_argument("--norm-ini", type=float, default=0.0, help="inicio (s) de la ventana de medida de --norm-rms-db")
    ap.add_argument("--norm-en-bucle", action="store_true", help="--norm-rms-db mide el RMS del bucle (si la muestra lo tiene) en vez de la ventana --norm-ini/--norm-dur")
    ap.add_argument("--norm-con-volume", action="store_true", help="con --norm-rms-db, suma el `volume` de cada región al objetivo (queda horneado en el PCM); sin esto el volume se ignora al normalizar")
    ap.add_argument("--norm-dur", type=float, default=0.4, help="duración (s) de la ventana de medida de --norm-rms-db")
    a = ap.parse_args()

    rng = np.random.default_rng(1234)
    regs = parsear_sfz(a.sfz, a.ruta_base or None)
    lo_k, hi_k = (0, 127)
    if a.solo_teclas:
        lo_k, hi_k = (int(x) for x in a.solo_teclas.split("-"))

    zonas = []
    for r in regs:
        if r.get("trigger", "attack") in ("release", "release_key"):
            continue  # ruido de tecla al soltar: no es una nota
        if "key" in r:
            lo = hi = root = nota_a_midi(r["key"])
        else:
            lo = nota_a_midi(r.get("lokey", "0"))
            hi = nota_a_midi(r.get("hikey", "127"))
            root = nota_a_midi(r.get("pitch_keycenter", "60"))  # SFZ: por defecto 60 (no lokey)
        if hi < lo_k or lo > hi_k:
            continue
        lo, hi = max(lo, lo_k), min(hi, hi_k)
        rr_n = int(r.get("seq_length", 1))
        rr_i = int(r.get("seq_position", 1)) - 1
        if "seq_position" not in r and "lorand" in r:
            # round-robin aleatorio SFZ (lorand/hirand): cada región ocupa un tramo del rango [0,1)
            _lo, _hi = float(r["lorand"]), float(r.get("hirand", 1))
            if 0 < _hi - _lo < 1:
                rr_n = max(1, int(round(1.0 / (_hi - _lo))))
                rr_i = int(round(_lo / (_hi - _lo)))
        zonas.append(
            {
                "r": r, "lokey": lo, "hikey": hi, "root": root,
                "lovel": int(r.get("lovel", 0)), "hivel": int(r.get("hivel", 127)),
                "rr": rr_i, "rrN": rr_n,
            }
        )
    if a.extender_teclas:
        # estira la primera/última zona hasta el rango dado (p. ej. 28-96): las notas extremas suenan afinadas por transposición
        e_lo, e_hi = (int(x) for x in a.extender_teclas.split("-"))
        if zonas:
            mn, mx = min(z["lokey"] for z in zonas), max(z["hikey"] for z in zonas)
            for z in zonas:
                if z["lokey"] == mn and e_lo < mn:
                    z["lokey"] = e_lo
                if z["hikey"] == mx and e_hi > mx:
                    z["hikey"] = e_hi
    zonas = reducir_capas(zonas, a.capas_vel)
    if not zonas:
        sys.exit("el SFZ no produjo ninguna región utilizable")

    cache = {}
    pcm_total = bytearray()
    registros = []
    flags = 0
    for i, z in enumerate(zonas):
        r = z["r"]
        ruta = r["_ruta"]
        if ruta not in cache:
            if not os.path.exists(ruta):
                sys.exit(f"falta la muestra {ruta}")
            data, sr = sf.read(ruta, dtype="float64", always_2d=True)
            cache = {ruta: (data, sr)}  # solo la última: los SFZ repiten la misma muestra en regiones contiguas
        data, sr = cache[ruta]
        ini_off = int(float(r.get("offset", 0)))
        fin_off = int(float(r["end"])) + 1 if "end" in r else data.shape[0]
        seg = data[ini_off:fin_off]
        modo = r.get("loop_mode", "no_loop")
        bucle = modo in ("loop_continuous", "loop_sustain") and "loop_end" in r
        auto = a.auto_loop and not bucle and modo != "one_shot"
        y = procesar_audio(seg, sr, a.rate, a.mono, 0 if auto else a.max_seg, rng, bucle or auto)
        lini = lfin = xf = 0
        if auto:
            if a.max_seg and y.shape[0] > int(a.max_seg * a.rate):
                y = y[: int(a.max_seg * a.rate)]
            rho_b = 0.0
            if a.bucle_corr:
                pc = buscar_bucle_corr(y, a.rate, a.min_bucle, int(a.xfade_bucle * a.rate))
                par = (pc[0], pc[1]) if pc else None
                rho_b = pc[2] if pc else 0.0
            else:
                par = buscar_bucle(y, a.rate, a.min_bucle)
            if par:
                lini, lfin = par
                bucle = True
            else:  # demasiado corta para sostener: se queda como golpe, con su cola suavizada
                n = y.shape[0]
                cola = min(n, int(0.12 * a.rate))
                y[n - cola :] *= (np.cos(np.linspace(0, math.pi / 2, cola)) ** 2)[:, None]
        if bucle:
            if not auto:
                k = a.rate / sr
                lini = int((float(r.get("loop_start", 0)) - ini_off) * k)
                lfin = int((float(r["loop_end"]) - ini_off) * k) + 1
            lfin = min(lfin, y.shape[0])
            y, xf = cerrar_bucle(y, lini, lfin, int(a.xfade_bucle * a.rate), rho_b if auto else 0.0)
            y = y[:lfin]
            if xf == 0:
                lini = lfin = 0
            else:
                flags |= 1
        if a.norm_rms_db is not None:
            n_ini, n_dur = a.norm_ini, a.norm_dur
            if a.norm_en_bucle and lfin > lini:   # mide el nivel del propio bucle (lo que se oye en el sostenido)
                n_ini, n_dur = lini / a.rate, (lfin - lini) / a.rate
            extra_vol = float(r.get("volume", 0)) if a.norm_con_volume else 0.0   # peso por zona (p. ej. reparto entre registros)
            y = normalizar_capa(y, a.rate, a.norm_rms_db + extra_vol, a.dyn_db, (z["lovel"] + z["hivel"]) / 2.0, n_ini, n_dur)
        pcm = a_pcm16(y, rng)
        off = len(pcm_total)
        pcm_total += pcm.tobytes()
        tune = float(r.get("tune", 0)) + 100.0 * float(r.get("transpose", 0))
        # con normalización el nivel ya va horneado en el PCM: el `volume` del SFZ se aplicaría dos veces
        vol = (0.0 if a.norm_rms_db is not None else float(r.get("volume", 0))) + a.ganancia_db
        if a.comp_grave_db:
            vol += a.comp_grave_db * min(1.0, max(0.0, (a.comp_grave_hasta - z["root"]) / max(1.0, a.comp_grave_hasta - 36.0)))
        reg = struct.pack(
            "<8BIIIIffffQ4BI8x",
            z["lokey"], z["hikey"], z["root"], z["lovel"], z["hivel"], max(0, z["rr"]), z["rrN"], y.shape[1],
            a.rate, pcm.shape[0], lini, lfin,
            tune, vol, float(r.get("ampeg_release", 0.35)), float(r.get("pan", 0)) / 100.0,
            off,
            int(r.get("group", 0)) & 255, int(r.get("off_by", 0)) & 255, 1 if modo == "one_shot" else 0, 0, xf,
        )
        assert len(reg) == TAM_ZONA, len(reg)
        registros.append(reg)
        if (i + 1) % 25 == 0 or i == len(zonas) - 1:
            print(f"  {i + 1}/{len(zonas)} zonas · {len(pcm_total) / 1e6:.0f} MB", flush=True)

    inicio = 32 + TAM_ZONA * len(registros)
    cab = MAGIC + struct.pack("<IIIIIII", 1, len(registros), TAM_ZONA, inicio, flags, 0, 0)
    assert len(cab) == 32
    os.makedirs(os.path.dirname(os.path.abspath(a.salida)), exist_ok=True)
    with open(a.salida, "wb") as f:
        f.write(cab)
        for reg in registros:
            f.write(reg)
        f.write(pcm_total)
    print(f"{a.salida}: {len(registros)} zonas, {os.path.getsize(a.salida) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
