#!/usr/bin/env python3
"""Biblioteca común de los conversores de kits de batería y percusión de JasWave (Worship Drums).

No se ejecuta sola: la importan `kit_sfz2jws.py` (baterías) y `percusion2jws.py` (kit `percusion`).
Reutiliza las funciones de limpieza de audio de `sfz2jws.py` (procesar_audio, normalizar_capa, a_pcm16), las MISMAS que
usa `muldjord_kit2jws.py`, para que todos los kits tengan el mismo tratamiento:
  remuestreo a 44,1 kHz, DC fuera, recorte del silencio inicial (conserva el ataque), fundido de entrada (1,5 ms) y de
  cola (coseno), normalización por pieza (RMS del ataque, curva de dinámica entre capas) y PCM 16 bits con dither TPDF.
Añade: recorte automático del silencio final, mezcla de micrófonos con alineación, reparto de capas de velocidad sin huecos,
round-robin, escritura del `.jws` v1 (zonas de 64 B, igual que muldjord_kit2jws.py) y del `kit.json` del contrato.

Una PIEZA es un dict:
  nombre, dest=[(nota GM, cents, dB extra, pan)], mono (bool), max_seg, norm (dBFS RMS de la capa más fuerte), dyn (dB entre
  la capa más suave y la más fuerte), rel (release s), capas (nº máx.), rr (nº máx.), capas_desde/capas_hasta (fracción),
  grupo/off_by (choke), damp (el note-off corta la muestra; toms y bombo con sordina), capas_lista = lista de CAPAS.
Una CAPA es (lo, hi, rrs) con lo/hi la velocidad de la fuente (o None) y rrs = lista de "golpes"; cada golpe es una lista
de fuentes (ruta, peso, polaridad, alinear) que se mezclan.
"""
import importlib.util
import json
import os
import struct

import numpy as np
import soundfile as sf

_aqui = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("sfz2jws_base", os.path.join(_aqui, "sfz2jws.py"))
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)

RATE = 44100
TAM_ZONA = base.TAM_ZONA

# Niveles por clase de pieza: los MISMOS valores (RMS dBFS de la capa más fuerte, dB de dinámica) que usa MuldjordKit,
# para que todos los kits suenen a un nivel parecido.
NIVELES = {
    "bombo": (-15.9, 26.0), "caja": (-19.5, 28.0), "rimshot": (-17.1, 7.0), "sidestick": (-22.0, 14.0),
    "tom": (-20.4, 24.0), "hat-cerrado": (-30.5, 24.0), "hat-pedal": (-35.0, 8.0), "hat-abierto": (-25.7, 22.0),
    "hat-semi": (-30.0, 20.0), "crash": (-24.0, 24.0), "splash": (-27.8, 14.0), "china": (-25.9, 22.0),
    "ride": (-26.0, 22.0), "campana": (-29.5, 20.0), "escobilla": (-24.0, 22.0),
}

_cache = {}


def leer(ruta):
    """Devuelve (y float32 (n, canales), sr). Caché pequeña (los micrófonos se reutilizan entre piezas)."""
    if ruta not in _cache:
        if len(_cache) > 64:
            _cache.pop(next(iter(_cache)))
        y, sr = sf.read(ruta, dtype="float32", always_2d=True)
        _cache[ruta] = (y, sr)
    return _cache[ruta]


def recortar_cola(y, sr, rel_db=-62.0, suelo_db=-84.0):
    """Quita el silencio final: RMS de ventanas de 20 ms por debajo de max(pico - 62 dB, -84 dBFS), con 80 ms de margen."""
    v = int(0.02 * sr)
    m = y.mean(axis=1) if y.ndim > 1 else y
    n = len(m) // v
    if n < 2:
        return y
    rms = np.sqrt((m[: n * v].reshape(n, v) ** 2).mean(axis=1))
    umbral = max(20 * np.log10(float(np.abs(m).max()) + 1e-9) + rel_db, suelo_db)
    idx = np.nonzero(rms > 10 ** (umbral / 20))[0]
    fin = (idx[-1] + 1) * v + int(0.08 * sr) if len(idx) else len(m)
    return y[: min(len(y), fin)]


def alinear(ref, y, sr, max_ms=6.0):
    """Desplaza/invierte `y` para que refuerce a `ref` (micrófonos con retardo/polaridad distintos)."""
    n = int(0.06 * sr)
    a = ref.mean(1)[:n].astype(np.float64)
    b = y.mean(1)[:n].astype(np.float64)
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    m = int(max_ms * 1e-3 * sr)
    c = np.fft.irfft(np.fft.rfft(a, 2 * n) * np.conj(np.fft.rfft(b, 2 * n)))
    lags = np.concatenate([np.arange(0, m + 1), np.arange(-m, 0)])
    vals = np.concatenate([c[0 : m + 1], c[2 * n - m : 2 * n]])
    i = int(np.argmax(np.abs(vals)))
    lag, pol = int(lags[i]), (1 if vals[i] >= 0 else -1)
    z = np.zeros_like(y)
    if lag >= 0:
        z[lag:] = y[: len(y) - lag]
    else:
        z[: len(y) + lag] = y[-lag:]
    return z * pol


def mezclar(fuentes):
    """Mezcla un golpe: lista de (ruta, peso, polaridad, alinear). Devuelve (y float64 (n, canales), sr).
    Las fuentes mono se duplican a estéreo si alguna otra es estéreo."""
    sr0 = None
    ys = []
    for fu in fuentes:
        ruta, peso, pol, alin = fu[:4]
        pan = fu[4] if len(fu) > 4 else None     # opcional: -1 (izq.) .. 1 (der.) para colocar una fuente mono en el campo estéreo
        y, sr = leer(ruta)
        if sr0 is None:
            sr0 = sr
        assert sr == sr0, (ruta, sr, sr0)
        y = recortar_cola(y, sr).astype(np.float64)
        ys.append((y, peso, pol, alin, pan))
    canales = max(2 if pan is not None else y.shape[1] for y, _, _, _, pan in ys)
    mezcla = None
    for (y, peso, pol, alin, pan) in ys:
        if alin and mezcla is not None:
            y = alinear(mezcla, y, sr0)
        elif pol < 0:
            y = -y
        if pan is not None and y.shape[1] == 1:
            a = (pan + 1.0) * np.pi / 4.0
            y = np.concatenate([y * np.cos(a), y * np.sin(a)], axis=1) * 1.4142
        elif y.shape[1] == 1 and canales == 2:
            y = np.repeat(y, 2, axis=1)
        y = y * peso
        if mezcla is None:
            mezcla = y
        else:
            n = max(len(mezcla), len(y))
            z = np.zeros((n, canales))
            z[: len(mezcla)] += mezcla
            z[: len(y)] += y
            mezcla = z
    return mezcla, sr0


def elegir(lista, n):
    """n índices repartidos uniformemente en la lista."""
    if n >= len(lista):
        return list(range(len(lista)))
    if n == 1:
        return [len(lista) // 2]
    return sorted({round(i * (len(lista) - 1) / (n - 1)) for i in range(n)})


def repartir_velocidades(sel_centros):
    """Límites contiguos 1..127 a partir de los centros de las capas elegidas (sin huecos ni solapes)."""
    k = len(sel_centros)
    return [1] + [round((sel_centros[i] + sel_centros[i + 1]) / 2) + 1 for i in range(k - 1)] + [128]


def convertir_piezas(piezas, semilla, verbose=True):
    """Convierte una lista de piezas. Devuelve (registros, pcm bytearray, estadísticas por pieza)."""
    rng = np.random.default_rng(semilla)
    pcm_total = bytearray()
    registros = []
    stats = []
    for p in piezas:
        capas = list(p["capas_lista"])
        capas.sort(key=lambda c: (c[0] if c[0] is not None else 0))
        lo_i, hi_i = 0, len(capas)
        if "capas_desde" in p:
            lo_i = int(len(capas) * p["capas_desde"])
        if "capas_hasta" in p:
            hi_i = max(lo_i + 1, int(len(capas) * p["capas_hasta"]))
        cand = capas[lo_i:hi_i]
        sel = [cand[i] for i in elegir(cand, p.get("capas", 99))]
        k = len(sel)
        if k == 1:
            lim = [1, 128]
        elif lo_i > 0 or hi_i < len(capas) or any(c[0] is None for c in sel):
            lim = repartir_velocidades([1 + 126 * (i + 0.5) / k for i in range(k)])
        else:
            lim = repartir_velocidades([(c[0] + c[1]) / 2.0 for c in sel])
        nz = 0
        bytes_pieza = 0
        for li, capa in enumerate(sel):
            lov, hiv = lim[li], lim[li + 1] - 1
            rrs = capa[2]
            rr_sel = [rrs[i] for i in elegir(rrs, p.get("rr", 99))]
            nrr = len(rr_sel)
            for ri, golpe in enumerate(rr_sel):
                mezcla, sr = mezclar(golpe)
                y = base.procesar_audio(mezcla, sr, RATE, p.get("mono", False), p.get("max_seg", 3.0), rng, False)
                # una sola capa cubre toda la velocidad: se normaliza a una velocidad típica alta (si no, quedaría ~7 dB baja)
                vm = (lov + hiv) / 2.0 if k > 1 else 100.0
                y = base.normalizar_capa(y, RATE, p["norm"], p["dyn"], vm)
                pcm = base.a_pcm16(y, rng)
                off = len(pcm_total)
                pcm_total += pcm.tobytes()
                bytes_pieza += pcm.nbytes
                for (nota, cents, db, pan) in p["dest"]:
                    vol = db + (3.0 if y.shape[1] == 1 else 0.0)   # el pan del motor atenúa 3 dB el centro de las muestras mono
                    reg = struct.pack(
                        "<8BIIIIffffQ4BI8x",
                        nota, nota, nota, lov, hiv, ri, nrr, y.shape[1],
                        RATE, pcm.shape[0], 0, 0,
                        float(cents), float(vol), float(p.get("rel", 0.2)), float(pan),
                        off,
                        int(p.get("grupo", 0)) & 255, int(p.get("off_by", 0)) & 255, 0 if p.get("damp") else 1, 0, 0,
                    )
                    assert len(reg) == TAM_ZONA
                    registros.append(reg)
                    nz += 1
        notas = ",".join(str(d[0]) for d in p["dest"])
        s = f"  {p['nombre']:<16} nota {notas:<8} {k} capas x {min(p.get('rr', 99), max(len(c[2]) for c in sel))} rr  {bytes_pieza / 1e6:6.1f} MB  zonas {nz}"
        stats.append((p["nombre"], bytes_pieza, nz))
        if verbose:
            print(s, flush=True)
    return registros, pcm_total, stats


def escribir_jws(salida, registros, pcm_total):
    inicio = 32 + TAM_ZONA * len(registros)
    cab = base.MAGIC + struct.pack("<IIIIIII", 1, len(registros), TAM_ZONA, inicio, 0, 0, 0)
    os.makedirs(os.path.dirname(os.path.abspath(salida)), exist_ok=True)
    with open(salida, "wb") as f:
        f.write(cab)
        for reg in registros:
            f.write(reg)
        f.write(pcm_total)
    return os.path.getsize(salida)


def escribir_kit_json(carpeta, meta, notas, tamano_bytes):
    """kit.json del contrato: slug, nombre, estilo, autor, licencia, enlaceLicencia, creditos, fuente, notas, tamanoMB."""
    d = dict(meta)
    d["notas"] = sorted(set(notas))
    d["tamanoMB"] = round(tamano_bytes / 1e6, 1)
    with open(os.path.join(carpeta, "kit.json"), "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")


def aplicar_niveles(p, clase):
    p["norm"], p["dyn"] = NIVELES[clase]
    return p


def convertir_y_escribir(slug, meta, piezas, carpeta_salida, semilla):
    """Convierte, escribe `<slug>.jws` y `kit.json` en carpeta_salida (drum-kits/<slug>)."""
    os.makedirs(carpeta_salida, exist_ok=True)
    regs, pcm, _ = convertir_piezas(piezas, semilla)
    ruta = os.path.join(carpeta_salida, slug + ".jws")
    tam = escribir_jws(ruta, regs, pcm)
    notas = [d[0] for p in piezas for d in p["dest"]]
    escribir_kit_json(carpeta_salida, meta, notas, tam)
    print(f"{ruta}: {len(regs)} zonas, {tam / 1e6:.1f} MB; notas {sorted(set(notas))}")
    return ruta
