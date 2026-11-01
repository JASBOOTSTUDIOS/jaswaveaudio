#!/usr/bin/env python3
"""Convierte MuldjordKit (SFZ + FLAC, CC BY 4.0, Lars Muldjord / FreePats) en el banco `worship-drums.jws` de
JasWave Worship Drums, remapeando el kit al mapa GM que usa el plugin y el compositor del repo.

Es un conversor aditivo y específico (no toca sfz2jws.py): reutiliza sus funciones de limpieza de audio
(procesar_audio, normalizar_capa, a_pcm16) y escribe el mismo formato .jws v1.

Qué hace de más respecto a sfz2jws.py:
  - Herencia correcta de opcodes <group>/<region> (el SFZ trae un <group> por capa de velocidad y por tecla).
  - Round-robin por lorand/hirand (4 variaciones por capa).
  - Remapeo a notas GM: una pieza del SFZ puede alimentar varias notas (toms 41..50, bombo 35/36...) con afinación
    por nota (cents) y ganancia/pan propios. Los PCM se comparten entre notas (un solo juego de datos).
  - Mezcla de micrófonos (caja = parte superior + inferior con polaridad y retardo alineados; bombo = L + R).
  - v2: kick/caja/toms en ESTÉREO (el kit FreePats ya trae cada pieza como mezcla de cercanos + overheads + ambiente:
    no hay canales de micrófono sueltos), sin transposiciones grandes, colas más largas, hi-hat semiabierto (nota interna 100).
  - Nivel por pieza (norm_rms_db), nº de capas de velocidad y de round-robin, mono/estéreo y duración por pieza,
    para entrar en el presupuesto de tamaño.
  - Grupos de choke del hi-hat (cerrado/pedal cortan al abierto).

Uso:  python -I muldjord_kit2jws.py [CARPETA_KIT] [SALIDA.jws]
Por defecto: %APPDATA%/JasWave/samples-src/muldjord/MuldjordKit SFZ+FLAC-20201018 -> %APPDATA%/JasWave/samples/worship-drums.jws
"""
import importlib.util
import math
import os
import re
import struct
import sys

import numpy as np
import soundfile as sf

_aqui = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("sfz2jws_base", os.path.join(_aqui, "sfz2jws.py"))
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)

RATE = 44100
APPDATA = os.environ.get("APPDATA", "")
KIT = os.path.join(APPDATA, "JasWave", "samples-src", "muldjord", "MuldjordKit SFZ+FLAC-20201018")
SALIDA = os.path.join(APPDATA, "JasWave", "samples", "worship-drums.jws")   # (v2: se recomienda generar en una carpeta de prueba y copiar después)

# ---------------------------------------------------------------------------------------------------------
# Definición del kit en notas GM. Niveles: RMS (dBFS, primeros 0,4 s, mezcla mono) de la capa más fuerte.
# dest: (nota GM, cents de afinación, dB extra, pan -1..1 [solo piezas mono])
# fuentes: (carpeta de muestras, peso, polaridad: 1 / -1 / 0 = automática por correlación, alinear)
# ---------------------------------------------------------------------------------------------------------
PIEZAS = [
    # --- v2: el kit FreePats trae cada pieza como mezcla ESTÉREO de los 16 micrófonos (cercanos + overheads + ambiente
    # + sangrado entre piezas). La v1 la colapsaba a mono y perdía justo el aire de sala que hace "acústica" a la batería:
    # ahora kick/caja/toms se conservan en estéreo, sin transposiciones grandes y con colas largas naturales.
    # Bombo: dos bombos reales (KdrumR ~76 Hz = pegada; KdrumL ~46 Hz = cuerpo grave). Sin transposición (0 cents).
    dict(nombre="bombo", fuentes=[("KdrumR", 1.00, 1, False), ("KdrumL", 0.25, 1, False)], mono=False,
         capas=9, rr=4, max_seg=2.0, norm=-15.9, dyn=26.0, rel=0.12,
         dest=[(36, 0, 0.0, 0.0)]),
    # nota 35 = el otro bombo (más grave), también sin transposición
    dict(nombre="bombo-35", fuentes=[("KdrumL", 0.90, 1, False), ("KdrumR", 0.22, 1, False)], mono=False,
         capas=9, rr=4, max_seg=2.0, norm=-16.4, dyn=26.0, rel=0.12,
         dest=[(35, 0, -1.0, 0.0)]),
    dict(nombre="caja", fuentes=[("Snare1", 0.85, 1, False), ("Snare2", 0.60, 0, True)], mono=False,
         capas=10, rr=4, max_seg=2.6, norm=-19.5, dyn=28.0, rel=0.14,
         dest=[(38, 0, 0.0, 0.0)]),
    # rimshot: solo las capas fuertes, con más peso de la mezcla brillante (crack del aro) y siempre con ataque
    dict(nombre="rimshot", fuentes=[("Snare1", 0.55, 1, False), ("Snare2", 0.95, 0, True)], mono=False,
         capas=4, rr=4, max_seg=2.2, norm=-17.1, dyn=7.0, rel=0.14, capas_desde=0.55,
         dest=[(40, 0, 0.0, 0.0)]),
    # toms: 4 toms reales para 6 notas; transposición máxima +-200 cents (la v1 llegaba a +300 / -350)
    dict(nombre="tom-alto", damp=True, fuentes=[("Tom1", 1.0, 1, False)], mono=False, capas=6, rr=4, max_seg=4.4, norm=-20.4, dyn=24.0, rel=0.30,
         dest=[(50, 200, -0.5, 0.0), (48, 0, 0.0, 0.0)]),
    dict(nombre="tom-medio", damp=True, fuentes=[("Tom2", 1.0, 1, False)], mono=False, capas=6, rr=4, max_seg=4.6, norm=-20.2, dyn=24.0, rel=0.30,
         dest=[(47, 100, 0.0, 0.0)]),
    dict(nombre="tom-grave", damp=True, fuentes=[("Tom3", 1.0, 1, False)], mono=False, capas=6, rr=4, max_seg=4.6, norm=-18.1, dyn=24.0, rel=0.30,
         dest=[(45, 0, 0.0, 0.0)]),
    dict(nombre="tom-suelo", damp=True, fuentes=[("Tom4", 1.0, 1, False)], mono=False, capas=6, rr=4, max_seg=4.7, norm=-21.0, dyn=24.0, rel=0.35,
         dest=[(43, 0, 0.0, 0.0), (41, -200, 0.5, 0.0)]),
    dict(nombre="hat-cerrado", fuentes=[("HihatClosed", 1.0, 1, False)], mono=False, capas=8, rr=4, max_seg=0.8, norm=-30.5, dyn=24.0,
         rel=0.05, grupo=1, off_by=0, dest=[(42, 0, 0.0, 0.0)]),
    # pedal (chick): las capas más suaves del cerrado, cortas y algo más graves, mismo grupo de choke
    dict(nombre="hat-pedal", fuentes=[("HihatClosed", 1.0, 1, False)], mono=False, capas=3, rr=3, max_seg=0.16, norm=-35.0, dyn=8.0,
         rel=0.04, grupo=1, off_by=0, capas_hasta=0.45, dest=[(44, -200, 0.0, 0.0)]),
    dict(nombre="hat-abierto", fuentes=[("HihatOpen", 1.0, 1, False)], mono=False, capas=6, rr=4, max_seg=1.9, norm=-25.7, dyn=22.0,
         rel=0.06, grupo=2, off_by=1, dest=[(46, 0, 0.0, 0.0)]),
    # hi-hat semiabierto (posición intermedia del pedal, CC4): ataque del abierto, cola corta; nota interna 100 (fuera del mapa GM:
    # la dispara el plugin junto al cerrado, con la velocidad escalada por la apertura). Mismo grupo de choke que el abierto.
    dict(nombre="hat-semi", fuentes=[("HihatOpen", 1.0, 1, False)], mono=False, capas=5, rr=3, max_seg=0.75, norm=-30.0, dyn=20.0,
         rel=0.07, grupo=2, off_by=1, dest=[(100, 0, 0.0, 0.0)]),
    dict(nombre="crash-1", fuentes=[("CrashL", 1.0, 1, False)], mono=False, capas=5, rr=2, max_seg=7.0, norm=-24.9, dyn=24.0, rel=0.6,
         dest=[(49, 0, 0.0, 0.0)]),
    dict(nombre="crash-2", fuentes=[("CrashR", 1.0, 1, False)], mono=False, capas=5, rr=2, max_seg=7.0, norm=-22.4, dyn=24.0, rel=0.6,
         dest=[(57, 0, 0.0, 0.0)]),
    dict(nombre="splash", fuentes=[("CrashL", 1.0, 1, False)], mono=False, capas=3, rr=2, max_seg=1.6, norm=-27.8, dyn=14.0, rel=0.3,
         capas_hasta=0.6, dest=[(55, 900, 0.0, 0.0)]),
    dict(nombre="china", fuentes=[("China", 1.0, 1, False)], mono=False, capas=5, rr=2, max_seg=5.5, norm=-25.9, dyn=22.0, rel=0.5,
         dest=[(52, 0, 0.0, 0.0)]),
    dict(nombre="ride", fuentes=[("RideL", 1.0, 1, False)], mono=False, capas=6, rr=3, max_seg=6.5, norm=-26.0, dyn=22.0, rel=0.5,
         dest=[(51, 0, 0.0, 0.0)]),
    dict(nombre="ride-2", fuentes=[("RideR", 1.0, 1, False)], mono=False, capas=6, rr=3, max_seg=6.5, norm=-25.7, dyn=22.0, rel=0.5,
         dest=[(59, 0, 0.0, 0.0)]),
    dict(nombre="campana", fuentes=[("RideRBell", 1.0, 1, False)], mono=False, capas=5, rr=2, max_seg=4.0, norm=-29.5, dyn=20.0, rel=0.4,
         dest=[(53, 0, 0.0, 0.0)]),
]


def parsear(ruta):
    """Parser SFZ con herencia real (snapshot de global/master/group al abrir cada <region>)."""
    with open(ruta, encoding="utf-8", errors="replace") as f:
        txt = re.sub(r"//[^\n]*", "", f.read())
    glob, master, group, regiones = {}, {}, {}, []
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
                d = {}
                d.update(glob), d.update(master), d.update(group)
                regiones.append(d)
            continue
        k, v = tok.group(2).lower(), tok.group(3).strip()
        {"global": glob, "master": master, "group": group}.get(nivel, regiones[-1] if nivel == "region" and regiones else {})[k] = v
    out = []
    for r in regiones:
        if "sample" in r:
            r["_ruta"] = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(ruta)), r["sample"].replace("\\", "/")))
            out.append(r)
    return out


_cache = {}


def leer(ruta):
    if ruta not in _cache:
        if len(_cache) > 48:
            _cache.pop(next(iter(_cache)))
        y, sr = sf.read(ruta, dtype="float32", always_2d=True)
        assert sr == RATE, (ruta, sr)
        _cache[ruta] = y
    return _cache[ruta]


def alinear(ref, y, max_ms=4.0):
    """Devuelve (y desplazado, polaridad, retardo) para que y refuerce a ref (micrófonos con retardo/polaridad distintos)."""
    n = int(0.06 * RATE)
    a = ref.mean(1)[:n].astype(np.float64)
    b = y.mean(1)[:n].astype(np.float64)
    m = int(max_ms * 1e-3 * RATE)
    f = np.fft.rfft(a, 2 * n) * np.conj(np.fft.rfft(b, 2 * n))
    c = np.fft.irfft(f)
    lags = np.concatenate([np.arange(0, m + 1), np.arange(-m, 0)])
    vals = np.concatenate([c[0 : m + 1], c[2 * n - m : 2 * n]])
    i = int(np.argmax(np.abs(vals)))
    lag, pol = int(lags[i]), (1 if vals[i] >= 0 else -1)
    z = np.zeros_like(y)
    if lag >= 0:
        z[lag:] = y[: len(y) - lag]
    else:
        z[: len(y) + lag] = y[-lag:]
    return z * pol, pol, lag


def elegir(lista, n):
    if n >= len(lista):
        return list(range(len(lista)))
    if n == 1:
        return [len(lista) // 2]
    return sorted({round(i * (len(lista) - 1) / (n - 1)) for i in range(n)})


def main():
    kit = sys.argv[1] if len(sys.argv) > 1 else KIT
    salida = sys.argv[2] if len(sys.argv) > 2 else SALIDA
    regs = parsear(os.path.join(kit, "MuldjordKit 20201018.sfz"))
    # carpeta -> capa (lovel,hivel) -> [rutas ordenadas por lorand]
    carp = {}
    for r in regs:
        d = os.path.basename(os.path.dirname(r["_ruta"]))
        capa = (int(r.get("lovel", 0)), int(r.get("hivel", 127)))
        carp.setdefault(d, {}).setdefault(capa, []).append((float(r.get("lorand", 0)), r["_ruta"]))
    for d in carp:
        for c in carp[d]:
            carp[d][c].sort()

    rng = np.random.default_rng(20201018)
    pcm_total = bytearray()
    registros = []
    resumen = []
    for p in PIEZAS:
        prim = p["fuentes"][0][0]
        capas = sorted(carp[prim])
        lo_i, hi_i = 0, len(capas)
        if "capas_desde" in p:
            lo_i = int(len(capas) * p["capas_desde"])
        if "capas_hasta" in p:
            hi_i = max(1, int(len(capas) * p["capas_hasta"]))
        cand = capas[lo_i:hi_i]
        sel = [cand[i] for i in elegir(cand, p["capas"])]
        k = len(sel)
        # rangos de velocidad contiguos 1..127 repartidos uniformemente en índice (las capas elegidas cubren todo el rango)
        if lo_i > 0 or hi_i < len(capas):
            centros = [1 + (127 - 1) * (i + 0.5) / k for i in range(k)]
        else:
            centros = [(c[0] + c[1]) / 2.0 for c in sel]
        lim = [1] + [round((centros[i] + centros[i + 1]) / 2) + 1 for i in range(k - 1)] + [128]
        n_zonas_pieza = 0
        bytes_pieza = 0
        info_pol = []
        for li, capa in enumerate(sel):
            lov, hiv = lim[li], lim[li + 1] - 1
            rutas = [r for _, r in carp[prim][capa]]
            rr_sel = [rutas[i] for i in elegir(rutas, p["rr"])]
            nrr = len(rr_sel)
            for ri, ruta0 in enumerate(rr_sel):
                idx_rr = rutas.index(ruta0)
                mezcla = None
                for (carpeta, peso, pol, alin) in p["fuentes"]:
                    if carpeta == prim:
                        y = leer(ruta0).astype(np.float64)
                    else:
                        # misma capa (o la más cercana) y misma variación round-robin de la fuente secundaria
                        cs = sorted(carp[carpeta], key=lambda c: abs((c[0] + c[1]) / 2 - (capa[0] + capa[1]) / 2))
                        rs = [r for _, r in carp[carpeta][cs[0]]]
                        y = leer(rs[min(idx_rr, len(rs) - 1)]).astype(np.float64)
                        if alin:
                            y, pl, lag = alinear(mezcla if mezcla is not None else y, y)
                            info_pol.append((pl, lag))
                        elif pol < 0:
                            y = -y
                    y = y * peso
                    if mezcla is None:
                        mezcla = y
                    else:
                        n = max(len(mezcla), len(y))
                        z = np.zeros((n, mezcla.shape[1]))
                        z[: len(mezcla)] += mezcla
                        z[: len(y)] += y
                        mezcla = z
                y = base.procesar_audio(mezcla, RATE, RATE, p["mono"], p["max_seg"], rng, False)
                y = base.normalizar_capa(y, RATE, p["norm"], p["dyn"], (lov + hiv) / 2.0)
                pcm = base.a_pcm16(y, rng)
                off = len(pcm_total)
                pcm_total += pcm.tobytes()
                bytes_pieza += pcm.nbytes
                for (nota, cents, db, pan) in p["dest"]:
                    vol = db + (3.0 if p["mono"] else 0.0)   # el pan del motor atenúa 3 dB el centro de las muestras mono
                    reg = struct.pack(
                        "<8BIIIIffffQ4BI8x",
                        nota, nota, nota, lov, hiv, ri, nrr, y.shape[1],
                        RATE, pcm.shape[0], 0, 0,
                        float(cents), float(vol), float(p["rel"]), float(pan),
                        off,
                        int(p.get("grupo", 0)) & 255, int(p.get("off_by", 0)) & 255, 0 if p.get("damp") else 1, 0, 0,
                    )
                    assert len(reg) == base.TAM_ZONA
                    registros.append(reg)
                    n_zonas_pieza += 1
        extra = ""
        if info_pol:
            extra = " polaridad/retardo mics: " + ",".join(f"{a:+d}/{b}" for a, b in info_pol[:6])
        resumen.append(f"  {p['nombre']:<12} {k} capas x {p['rr']} rr  {bytes_pieza / 1e6:5.1f} MB  zonas {n_zonas_pieza}{extra}")
        print(resumen[-1], flush=True)

    inicio = 32 + base.TAM_ZONA * len(registros)
    cab = base.MAGIC + struct.pack("<IIIIIII", 1, len(registros), base.TAM_ZONA, inicio, 0, 0, 0)
    os.makedirs(os.path.dirname(os.path.abspath(salida)), exist_ok=True)
    with open(salida, "wb") as f:
        f.write(cab)
        for reg in registros:
            f.write(reg)
        f.write(pcm_total)
    print(f"{salida}: {len(registros)} zonas, {os.path.getsize(salida) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
