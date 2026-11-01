#!/usr/bin/env python3
"""Genera los SFZ de JasWave Strings Section a partir de VSCO 2 CE (CC0) y ensambla el banco strings-section.jws.

Ejecutar SIEMPRE con `python -I` (las muestras descargadas son datos no confiables; este script no importa nada de
su carpeta):

  python -I gen_strings_bank.py [--origen DIR_VSCO_STRINGS] [--trabajo DIR] [--salida ruta.jws] [--solo-sfz]
                                [--mono] [--rate 44100] [--secciones vln,vla,vcl,cb]

Las muestras de VSCO llevan la octava «de partitura» (C4 = 60 en nombre, pero suenan una octava más arriba): la raíz
real = nota del nombre + 12 (se comprueba midiendo f0 de cada archivo y se corrige la afinación del conjunto).
Cada sección usa dos capas de velocidad (suave / fuerte) y reparte las teclas entre muestras vecinas. El motor lanza
TODAS las zonas que cubren la nota (noteOnStack): en los traslapes entre secciones suenan juntas (chelo+contrabajo,
viola+violín...) con una ganancia por zona que da un reparto de potencia constante entre registros.
"""
import argparse
import math
import os
import re
import subprocess
import sys

import numpy as np
import soundfile as sf

AQUI = os.path.dirname(os.path.abspath(__file__))
HERR = os.path.normpath(os.path.join(AQUI, "..", "..", "samples", "tools"))
NOTAS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

# sección -> (carpeta relativa, regex del nombre, rango de teclas del repertorio, desplazamiento de octava del nombre)
SECCIONES = {
    "vln": ("Violin Section/susVib", r".*_([A-G]#?)(\d)_v(\d)\.wav", 55, 96),
    "vla": ("Viola Section/susvib", r".*_([A-G]#?)(\d)_v(\d)_1\.wav", 48, 90),
    "vcl": ("Cello Section/susvib", r".*_([A-G]#?)(\d)_v(\d)_1\.wav", 36, 79),
    "cb": ("Solo Contrabass/SusVib", r".*_([A-G]#?)(\d)_v(\d)_rr1\.wav", 28, 59),
}
# Peso (dB) de cada sección según la tecla (puntos de la curva lineal en dB; fuera de la lista = silencio)
CURVAS = {
    "cb": [(28, 0.0), (43, 0.0), (55, -14.0)],
    "vcl": [(36, 0.0), (57, 0.0), (72, -14.0)],
    "vla": [(48, -12.0), (55, 0.0), (74, 0.0), (86, -12.0)],
    "vln": [(55, -12.0), (66, 0.0), (84, 0.0), (96, 6.0)],   # arriba se sube: la muestra transpuesta pierde cuerpo
}
VEL_CORTE = 52   # capa suave 1..52, fuerte 53..127


def peso_db(sec, k):
    pts = CURVAS[sec]
    if k < pts[0][0] or k > pts[-1][0]:
        return None
    for (k0, d0), (k1, d1) in zip(pts, pts[1:]):
        if k0 <= k <= k1:
            return d0 + (d1 - d0) * (k - k0) / max(1, k1 - k0)
    return None


def midi_de(nombre, octava):
    m = re.fullmatch(r"([A-G])(#?)", nombre)
    return (int(octava) + 1) * 12 + NOTAS[m.group(1)] + (1 if m.group(2) else 0) + 12


def medir_cents(ruta, midi_esperado):
    """Desviación (cents) del tono medio frente a la nota esperada: autocorrelación acotada ±6 % en 3 ventanas."""
    y, sr = sf.read(ruta, always_2d=True)
    m = y.mean(axis=1)
    f_esp = 440.0 * 2 ** ((midi_esperado - 69) / 12.0)
    p0 = sr / f_esp
    lo, hi = int(p0 * 0.94), int(p0 * 1.06) + 2
    res = []
    for ini_s in (2.0, 3.0, 4.0):
        a = int(ini_s * sr)
        w = m[a:a + 32768]
        if len(w) < 16384:
            continue
        w = w - w.mean()
        f = np.fft.rfft(w, 2 * len(w))
        ac = np.fft.irfft(f * np.conj(f))
        # normaliza por energía solapada
        n = len(w)
        ac = ac[: hi + 2] / (ac[0] * (1 - np.arange(hi + 2) / n) + 1e-30)
        k = lo + int(np.argmax(ac[lo:hi + 1]))
        d = ac[k - 1] - 2 * ac[k] + ac[k + 1]
        k = k + (0.5 * (ac[k - 1] - ac[k + 1]) / d if d != 0 else 0.0)
        res.append(1200 * math.log2((sr / k) / f_esp))
    return float(np.median(res)) if res else 0.0


def listar(origen, sec):
    carpeta, rx, _, _ = SECCIONES[sec]
    base = os.path.join(origen, *carpeta.split("/"))
    out = {}
    for f in sorted(os.listdir(base)):
        mt = re.fullmatch(rx, f)
        if not mt:
            continue
        nota, octava, v = mt.group(1), mt.group(2), int(mt.group(3))
        out.setdefault(midi_de(nota, octava), {})[v] = os.path.join(base, f)
    return out


def generar_sfz(origen, sec, destino, verbose=True):
    _, _, lo_k, hi_k = SECCIONES[sec]
    notas = listar(origen, sec)
    raices = sorted(notas)
    lineas = [f"// {sec}: generado por gen_strings_bank.py (VSCO 2 CE, CC0)", "<control>", "<global> ampeg_release=0.5", ""]
    pesos = {}
    for i, r in enumerate(raices):
        lo = lo_k if i == 0 else (raices[i - 1] + r) // 2 + 1
        hi = hi_k if i == len(raices) - 1 else (r + raices[i + 1]) // 2
        capas = sorted(notas[r])
        # peso por tecla; la zona se parte en tramos donde el peso varía <= 1,5 dB (mismo audio, otra ganancia)
        runs, cur = [], None
        for k in range(lo, hi + 1):
            w = peso_db(sec, k)
            if w is None or w < -13.5:
                cur = None
                continue
            if cur is None or abs(w - cur["w0"]) > 1.5 or (k - cur["lo"]) >= 6:
                cur = {"lo": k, "hi": k, "w0": w, "ws": [w]}
                runs.append(cur)
            else:
                cur["hi"] = k
                cur["ws"].append(w)
        if not runs:
            continue
        # afinación del conjunto (solo si la medición es creíble)
        cents = {}
        for v in capas:
            c = medir_cents(notas[r][v], r)
            cents[v] = c if abs(c) < 45 else 0.0
        for run in runs:
            w = sum(run["ws"]) / len(run["ws"])
            pesos[(r, run["lo"])] = w
            for j, v in enumerate(capas):
                lv, hv = (1, VEL_CORTE) if j == 0 else (VEL_CORTE + 1, 127)
                if len(capas) == 1:
                    lv, hv = 1, 127
                ruta = notas[r][v].replace("\\", "/")
                lineas.append(f"<region> sample={ruta} lokey={run['lo']} hikey={run['hi']} pitch_keycenter={r} lovel={lv} hivel={hv} "
                              f"volume={w:.2f} tune={-cents[v]:.1f}")
                if verbose:
                    print(f"  {sec} raiz {r:3d} teclas {run['lo']:3d}-{run['hi']:3d} capa v{v} vel {lv}-{hv} peso {w:+5.1f} dB correccion {-cents[v]:+5.1f} c")
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with open(destino, "w", encoding="utf-8") as f:
        f.write("\n".join(lineas) + "\n")
    return destino


def main():
    ap = argparse.ArgumentParser()
    appdata = os.environ.get("APPDATA", "")
    ap.add_argument("--origen", default=os.path.join(appdata, "JasWave", "samples-src", "vsco2ce", "Strings"))
    ap.add_argument("--trabajo", default=os.path.join(appdata, "JasWave", "samples-src", "_trabajo", "strings"))
    ap.add_argument("--salida", default=os.path.join(appdata, "JasWave", "samples", "strings-section.jws"))
    ap.add_argument("--solo-sfz", action="store_true")
    ap.add_argument("--mono", action="store_true")
    ap.add_argument("--rate", type=int, default=44100)
    ap.add_argument("--secciones", default="vln,vla,vcl,cb")
    ap.add_argument("--norm-rms-db", type=float, default=-20.0)
    ap.add_argument("--dyn-db", type=float, default=10.0)
    ap.add_argument("--min-bucle", type=float, default=2.4)
    ap.add_argument("--xfade-bucle", type=float, default=0.25)
    ap.add_argument("--extra", nargs="*", default=[], help="opciones adicionales para sfz2jws")
    a = ap.parse_args()

    bancos = []
    for sec in a.secciones.split(","):
        sfz = os.path.join(a.trabajo, f"{sec}.sfz")
        generar_sfz(a.origen, sec, sfz)
        if a.solo_sfz:
            continue
        jws = os.path.join(a.trabajo, f"{sec}.jws")
        cmd = [sys.executable, "-I", os.path.join(HERR, "sfz2jws.py"), sfz, jws, "--rate", str(a.rate), "--max-seg", "12",
               "--auto-loop", "--bucle-corr", "--min-bucle", str(a.min_bucle), "--xfade-bucle", str(a.xfade_bucle),
               "--norm-rms-db", str(a.norm_rms_db), "--dyn-db", str(a.dyn_db), "--norm-ini", "0.9", "--norm-dur", "1.0", "--norm-en-bucle", "--norm-con-volume"] + a.extra
        if a.mono:
            cmd.append("--mono")
        print(" ".join(cmd), flush=True)
        subprocess.run(cmd, check=True)
        bancos.append(jws)
    if a.solo_sfz:
        return
    subprocess.run([sys.executable, "-I", os.path.join(HERR, "jws_merge.py"), a.salida] + bancos, check=True)


if __name__ == "__main__":
    main()
