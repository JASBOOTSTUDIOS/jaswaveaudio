#!/usr/bin/env python3
"""Convierte kits de batería libres (CC0 / CC BY) en bancos `.jws` de JasWave Worship Drums, uno por kit:
`%APPDATA%/JasWave/samples/drum-kits/<slug>/<slug>.jws` + `kit.json` (contrato de kits).

Kits: virtuosity (jazz, CC0), naked (rock/pop, CC BY 4.0), swirly (indie/escobillas, CC0), bigrusty (rock/metal vintage, CC0),
unruly (experimental, CC0), drskit (jazz-rock, CC BY 4.0, port SFZ), muldjord (se registra con `registrar_muldjord`).

Uso:  python -I kit_sfz2jws.py KIT CARPETA_FUENTES [CARPETA_SALIDA_BASE]
  KIT = virtuosity | naked | swirly | bigrusty | unruly | drskit | muldjord
  CARPETA_FUENTES = carpeta donde se descomprimieron los zips, en x/<kit>/ (virtuosity -> x/virtuosity; los de GitHub traen
  una carpeta interior, p. ej. x/naked/WilkinsonAudio.NakedDrums-master).  CARPETA_SALIDA_BASE por defecto
  %APPDATA%/JasWave/samples/drum-kits (se crea <slug>/ dentro).
  `muldjord` no necesita fuentes: copia worship-drums.jws (sin borrarlo) a drum-kits/muldjord/muldjord.jws y escribe kit.json.

Cómo funciona: cada kit tiene un catálogo (funciones `cat_*`) que, a partir de los nombres de fichero (y de los SFZ de
asignación cuando traen los rangos de velocidad), devuelve por pieza las CAPAS de velocidad y sus round-robin; las piezas se
mapean a notas GM (bombo 35/36, caja 38, rimshot 40, cross-stick 37, toms 41 43 45 47 48 50, hi-hat 42/44/46 y semiabierto 100,
platos 49 57 55 52 51 59, campana de ride 53, campana de crash 58...). El procesado del audio es el de MuldjordKit
(jws_kit_lib.py): 44,1 kHz, recorte, fundidos, normalización por pieza con los mismos niveles, PCM 16 bits con dither.
"""
import argparse
import json
import os
import re
import shutil
import sys

_aqui = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _aqui)
import jws_kit_lib as L  # noqa: E402

APPDATA = os.environ.get("APPDATA", "")
SALIDA = os.path.join(APPDATA, "JasWave", "samples", "drum-kits")
CC0 = ("CC0", "https://creativecommons.org/publicdomain/zero/1.0/")
CCBY4 = ("CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/")


def _orden(nombre):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", nombre)]


def pieza(nombre, notas, capas, clase, max_seg, capas_n, rr, rel=0.25, norm_db=0.0, **kw):
    """Pieza lista para jws_kit_lib. `notas` = [nota | (nota, cents, dB, pan)]; los niveles salen de la clase (MuldjordKit)."""
    dest = [(n, 0, 0.0, 0.0) if isinstance(n, int) else n for n in notas]
    norm, dyn = L.NIVELES[clase]
    p = dict(nombre=nombre, dest=dest, capas_lista=capas, norm=norm + norm_db, dyn=dyn, max_seg=max_seg, rel=rel,
             capas=capas_n, rr=rr, mono=False)
    p.update(kw)
    return p


# ---------------------------------------------------------------------------------------------------------------
# Virtuosity Drums v0.925 (Versilian Studios, CC0). Muestras FLAC 24 bits a 48 kHz; micros: mid (estéreo, todo el kit), oh,
# room, kickmic/snaremic (cercanos mono). Rango de velocidad de cada vlN desde Programs/mappings/mid/<pieza>_<art>_map.sfz.
# ---------------------------------------------------------------------------------------------------------------
def _rangos_virt(base, pieza_dir, art):
    ruta = os.path.join(base, "Programs", "mappings", "mid", f"{pieza_dir}_{art}_map.sfz")
    r = {}
    if not os.path.exists(ruta):
        return r
    txt = open(ruta, encoding="utf-8", errors="replace").read()
    for bloque in txt.split("<region>")[1:]:
        m = re.search(r"_vl(\d+)", bloque)
        if not m:
            continue
        lo = re.search(r"\blovel=(\d+)", bloque)
        hi = re.search(r"\bhivel=(\d+)", bloque)
        r.setdefault(int(m.group(1)), (int(lo.group(1)) if lo else 1, int(hi.group(1)) if hi else 127))
    return r


def virt_capas(base, pieza_dir, arts, mics=(("mid", 1.0, False),)):
    """Capas de Virtuosity para una pieza. `arts` = lista de articulaciones cuyos golpes se suman como round-robin
    (p. ej. centro + descentrado); `mics` = [(micro, peso, alinear)] que se mezclan en cada golpe."""
    S = os.path.join(base, "Samples")
    capas = {}
    rangos = _rangos_virt(base, pieza_dir, arts[0])
    for art in arts:
        d0 = os.path.join(S, mics[0][0], pieza_dir)
        rx = re.compile(rf"{mics[0][0]}_{pieza_dir}_{art}(?:_vl(\d+))?(?:_rr(\d+))?\.flac")
        for f in sorted(os.listdir(d0), key=_orden):
            m = rx.fullmatch(f)
            if not m:
                continue
            vl = int(m.group(1)) if m.group(1) else 0
            golpe = []
            for (mic, peso, alin) in mics:
                nombre = f.replace(mics[0][0] + "_", mic + "_", 1)
                ruta = os.path.join(S, mic, pieza_dir, nombre)
                if os.path.exists(ruta):
                    golpe.append((ruta, peso, 1, alin))
            if golpe and golpe[0][0].startswith(os.path.join(S, mics[0][0])):
                capas.setdefault(vl, []).append(golpe)
    res = []
    for vl in sorted(capas):
        lo, hi = rangos.get(vl, (None, None))
        res.append((lo, hi, capas[vl]))
    return res


def cat_virtuosity(src):
    b = src
    v = lambda p, arts, mics=(("mid", 1.0, False),): virt_capas(b, p, arts, mics)
    kick = (("mid", 1.0, False), ("kickmic", 0.7, True))
    snare = (("mid", 1.0, False), ("snaremic", 0.6, True))
    pz = []
    pz.append(pieza("bombo", [36], v("kick", ["snon"], kick), "bombo", 1.8, 4, 4, rel=0.12))
    pz.append(pieza("bombo-35", [(35, 0, -1.0, 0.0)], v("kick", ["snoff"], kick), "bombo", 1.8, 4, 4, rel=0.12, norm_db=-0.5))
    pz.append(pieza("caja", [38], v("snare", ["center", "offcenter"], snare), "caja", 2.8, 14, 2, rel=0.14))
    pz.append(pieza("rimshot", [40], v("snare", ["rimshot"], snare), "rimshot", 2.2, 4, 2, rel=0.14, capas_desde=0.5))
    pz.append(pieza("cross-stick", [37], v("snare", ["crossstick"], snare), "sidestick", 1.4, 4, 2, rel=0.1))
    pz.append(pieza("tom-grave", [(41, -200, 0.5, 0.0), (43, 0, 0.0, 0.0), (45, 200, -0.5, 0.0)],
                    v("ltom", ["center", "offcenter"]), "tom", 5.0, 8, 2, rel=0.3, damp=True))
    pz.append(pieza("tom-agudo", [(47, -150, 0.0, 0.0), (48, 0, 0.0, 0.0), (50, 200, -0.5, 0.0)],
                    v("htom", ["center", "offcenter"]), "tom", 4.4, 8, 2, rel=0.3, damp=True))
    pz.append(pieza("hat-cerrado", [42], v("hh", ["closed"]), "hat-cerrado", 0.9, 4, 4, rel=0.05, grupo=1, off_by=0))
    pz.append(pieza("hat-pedal", [(44, -100, 0.0, 0.0)], v("hh", ["pedal"]), "hat-pedal", 0.3, 3, 3, rel=0.04, grupo=1, off_by=0))
    pz.append(pieza("hat-abierto", [46], v("hh", ["open"]), "hat-abierto", 2.4, 4, 3, rel=0.06, grupo=2, off_by=1))
    pz.append(pieza("hat-semi", [100], v("hh", ["half"]), "hat-semi", 1.3, 4, 3, rel=0.07, grupo=2, off_by=1))
    pz.append(pieza("crash-1", [49], v("crash", ["crash"]), "crash", 9.0, 3, 3, rel=0.6))
    pz.append(pieza("crash-sizzle", [57], v("crash", ["sizzle"]), "crash", 9.0, 3, 3, rel=0.6, norm_db=-0.5))
    pz.append(pieza("splash", [55], v("flatride", ["crash"]), "splash", 3.0, 4, 1, rel=0.3, norm_db=0.0))
    pz.append(pieza("ride", [51], v("ride", ["ride"]), "ride", 8.0, 3, 4, rel=0.5))
    pz.append(pieza("ride-plano", [59], v("flatride", ["ride"]), "ride", 8.0, 3, 4, rel=0.5, norm_db=-0.5))
    pz.append(pieza("campana-ride", [53], v("ride", ["bell"]), "campana", 4.0, 3, 3, rel=0.4))
    return pz


# ---------------------------------------------------------------------------------------------------------------
# Catálogos por plantilla de ruta (Swirly, Big Rusty, Unruly): "{vl}" y "{rr}" se sustituyen; la primera plantilla enumera
# las capas y los round-robin, las demás son otros micrófonos del mismo golpe. Sin rangos de velocidad en los ficheros: las
# capas se reparten por igual (como hace el kit original, que usa vl1..vlN uniformes).
# ---------------------------------------------------------------------------------------------------------------
def capas_tpl(plantillas):
    import glob
    p0, w0, a0 = plantillas[0]
    patron = re.compile(re.escape(p0.replace("\\", "/")).replace(re.escape("{vl}"), r"(?P<vl>\d+)").replace(re.escape("{rr}"), r"(?P<rr>\d+)"))
    cap = {}
    ficheros = glob.glob(re.sub(r"\{(vl|rr)\}", "*", p0))
    for f in sorted(ficheros, key=_orden):
        m = patron.fullmatch(f.replace("\\", "/"))
        if not m:
            continue
        vl, rr = m.group("vl"), m.group("rr")
        golpe = [(f, w0, 1, a0)]
        for (pt, w, al) in plantillas[1:]:
            g = pt.replace("{vl}", vl).replace("{rr}", rr)
            if os.path.exists(g):
                golpe.append((g, w, 1, al))
        cap.setdefault(int(vl), []).append((int(rr), golpe))
    return [(None, None, [g for _, g in sorted(cap[v], key=lambda t: t[0])]) for v in sorted(cap)]


META_VIRT = dict(
    slug="virtuosity", nombre="Virtuosity Jazz", estilo="jazz de club (baquetas)",
    autor="Versilian Studios (batería: Austin McMahon, Virtuosity Musical Instruments, Boston)",
    licencia=CC0[0], enlaceLicencia=CC0[1],
    creditos="«Virtuosity Drums» v0.925 de Versilian Studios, CC0 1.0; recortada, normalizada y convertida a PCM 16 bits.",
    fuente="https://versilian-studios.com/virtuosity-drums/")


# ---------------------------------------------------------------------------------------------------------------
# Swirly Drums v1.1 (Karoryfer Samples, CC0): muestras mono WAV 44,1 kHz, solo los micros secos (sin las carpetas wet/wetter).
# ---------------------------------------------------------------------------------------------------------------
def cat_swirly(src):
    src = src.replace("\\", "/")
    S = src + "/Samples/"
    t = lambda carpeta, pat, w=1.0, al=False: (S + carpeta + "/" + pat, w, al)
    c = lambda *pl: capas_tpl(list(pl))
    pz = []
    pz.append(pieza("bombo", [36], c(t("cajon_kick", "cajon_kick_vl{vl}_rr{rr}_front.wav"),
                                     t("cajon_kick", "cajon_kick_vl{vl}_rr{rr}_rear.wav", 0.6, True)),
                    "bombo", 1.8, 6, 5, rel=0.12, mono=True, norm_db=-1.0))
    pz.append(pieza("bombo-marching", [(35, 0, -1.0, 0.0)], c(t("marching_kick", "marching_kick_vl{vl}_rr{rr}_beater.wav"),
                                                              t("marching_kick", "marching_kick_vl{vl}_rr{rr}_reso.wav", 0.7, True)),
                    "bombo", 2.0, 6, 4, rel=0.12, mono=True, norm_db=-1.0))
    pz.append(pieza("caja", [38], c(t("snare_main", "snare_hit_vl{vl}_rr{rr}_top.wav"),
                                    t("snare_main", "snare_hit_vl{vl}_rr{rr}_btm.wav", 0.5, True)),
                    "caja", 2.0, 8, 4, rel=0.14, mono=True))
    pz.append(pieza("caja-borde", [40], c(t("snare_edge", "snare_edge_vl{vl}_rr{rr}_top.wav"),
                                          t("snare_edge", "snare_edge_vl{vl}_rr{rr}_btm.wav", 0.5, True)),
                    "caja", 2.0, 6, 4, rel=0.14, mono=True))
    pz.append(pieza("caja-dig", [37], c(t("snare_dig", "snare_dig_vl{vl}_rr{rr}_top.wav"),
                                        t("snare_dig", "snare_dig_vl{vl}_rr{rr}_btm.wav", 0.5, True)),
                    "sidestick", 1.5, 5, 4, rel=0.1, mono=True))
    pz.append(pieza("tom-suelo", [(41, -200, 0.5, 0.0), (43, 0, 0.0, 0.0)], c(t("tom_floor", "tom_floor_vl{vl}_rr{rr}.wav")),
                    "tom", 4.4, 6, 3, rel=0.3, mono=True, damp=True))
    pz.append(pieza("tom-medio-grave", [45], c(t("tom_mlow", "tom_mlow_vl{vl}_rr{rr}.wav")), "tom", 4.0, 6, 3, rel=0.3, mono=True, damp=True))
    pz.append(pieza("tom-medio", [47], c(t("tom_xmed", "tom_xmed_vl{vl}_rr{rr}.wav")), "tom", 4.0, 6, 3, rel=0.3, mono=True, damp=True))
    pz.append(pieza("tom-medio-agudo", [48], c(t("tom_mhi", "tom_mhi_vl{vl}_rr{rr}.wav")), "tom", 3.6, 6, 3, rel=0.3, mono=True, damp=True))
    pz.append(pieza("tom-agudo", [50], c(t("tom_vhi", "tom_vhi_vl{vl}_rr{rr}.wav")), "tom", 3.2, 6, 3, rel=0.3, mono=True, damp=True))
    pz.append(pieza("hat-cerrado", [42], c(t("hat_closed", "hh_closed_vl{vl}_rr{rr}.wav")), "hat-cerrado", 0.9, 8, 4, rel=0.05, mono=True, grupo=1, off_by=0))
    pz.append(pieza("hat-pedal", [44], c(t("hat_foot", "hh_foot_vl{vl}_rr{rr}.wav")), "hat-pedal", 0.4, 3, 3, rel=0.04, mono=True, grupo=1, off_by=0))
    pz.append(pieza("hat-abierto", [46], c(t("hat_open", "hh_open_vl{vl}_rr{rr}.wav")), "hat-abierto", 2.4, 6, 3, rel=0.06, mono=True, grupo=2, off_by=1))
    pz.append(pieza("hat-semi", [100], c(t("hat_half", "hh_half_vl{vl}_rr{rr}.wav")), "hat-semi", 1.4, 5, 3, rel=0.07, mono=True, grupo=2, off_by=1))
    pz.append(pieza("crash", [49], c(t("crash", "crash_vl{vl}_rr{rr}.wav")), "crash", 7.0, 4, 3, rel=0.6, mono=True))
    pz.append(pieza("crash-roto", [57], c(t("crash_broken", "crash_vl{vl}_rr{rr}.wav")), "crash", 7.0, 4, 3, rel=0.6, mono=True, norm_db=-0.5))
    pz.append(pieza("splash", [55], c(t("splash", "splash_vl{vl}_rr{rr}.wav")), "splash", 2.5, 4, 3, rel=0.3, mono=True))
    pz.append(pieza("china", [52], c(t("china", "china_vl{vl}_rr{rr}.wav")), "china", 5.5, 4, 3, rel=0.5, mono=True))
    pz.append(pieza("ride", [51], c(t("ride", "ride_vl{vl}_rr{rr}.wav")), "ride", 6.5, 5, 3, rel=0.5, mono=True))
    return pz


# ---------------------------------------------------------------------------------------------------------------
# Big Rusty Drums (Karoryfer Samples, CC0): FLAC mono 44,1 kHz. Micros: cl/oh (platos y toms), kick/oh (bombo), top/btm/oh (caja).
# ---------------------------------------------------------------------------------------------------------------
def cat_bigrusty(src):
    src = src.replace("\\", "/")
    S = src + "/Samples/"
    t = lambda ruta, w=1.0, al=False: (S + ruta, w, al)
    c = lambda *pl: capas_tpl(list(pl))
    pz = []
    pz.append(pieza("bombo", [36, (35, -150, -1.0, 0.0)],
                    c(t("kick_24/kick/kick/k_vl{vl}_rr{rr}.flac"), t("kick_24/kick/oh/k_vl{vl}_rr{rr}.flac", 0.6, True)),
                    "bombo", 2.0, 8, 4, rel=0.12, mono=True, norm_db=-1.0))
    sn = lambda art, pre: c(t(f"snare_14/{art}/top/{pre}_vl{{vl}}_rr{{rr}}.flac"), t(f"snare_14/{art}/btm/{pre}_vl{{vl}}_rr{{rr}}.flac", 0.5, True),
                            t(f"snare_14/{art}/oh/{pre}_vl{{vl}}_rr{{rr}}.flac", 0.5, True))
    pz.append(pieza("caja", [38], sn("center", "sn_center"), "caja", 2.4, 8, 4, rel=0.14, mono=True))
    pz.append(pieza("rimshot", [40], sn("rimshot", "sn_rims"), "rimshot", 2.2, 5, 4, rel=0.14, mono=True))
    pz.append(pieza("cross-stick", [37], sn("sidestick", "sn_ss"), "sidestick", 1.5, 5, 4, rel=0.1, mono=True))
    tom = lambda d, pre: c(t(f"{d}/center/cl/{pre}_vl{{vl}}_rr{{rr}}.flac"), t(f"{d}/center/oh/{pre}_vl{{vl}}_rr{{rr}}.flac", 0.6, True))
    pz.append(pieza("tom-22", [41], tom("tom_22", "t22"), "tom", 4.6, 6, 3, rel=0.35, mono=True, damp=True))
    pz.append(pieza("tom-18", [43], tom("tom_18", "t18"), "tom", 4.4, 6, 3, rel=0.3, mono=True, damp=True))
    pz.append(pieza("tom-15", [45], tom("tom_15", "t15"), "tom", 4.0, 6, 3, rel=0.3, mono=True, damp=True))
    pz.append(pieza("tom-14", [47, (48, 200, 0.0, 0.0), (50, 400, -0.5, 0.0)], tom("tom_14", "t14"), "tom", 3.6, 6, 3, rel=0.3, mono=True, damp=True))
    ht = lambda art, pre: c(t(f"hihat_14/{art}/cl/{pre}_vl{{vl}}_rr{{rr}}.flac"), t(f"hihat_14/{art}/oh/{pre}_vl{{vl}}_rr{{rr}}.flac", 0.6, True))
    pz.append(pieza("hat-cerrado", [42], ht("cl", "ht_cl"), "hat-cerrado", 0.9, 8, 4, rel=0.05, mono=True, grupo=1, off_by=0))
    pz.append(pieza("hat-pedal", [44], ht("chik", "ht_chik"), "hat-pedal", 0.4, 3, 3, rel=0.04, mono=True, grupo=1, off_by=0))
    pz.append(pieza("hat-abierto", [46], ht("open", "ht_open"), "hat-abierto", 2.6, 6, 3, rel=0.06, mono=True, grupo=2, off_by=1))
    pz.append(pieza("hat-semi", [100], ht("ho", "ht_ho"), "hat-semi", 1.5, 5, 3, rel=0.07, mono=True, grupo=2, off_by=1))
    cy = lambda d, art, pre: c(t(f"{d}/{art}/cl/{pre}_vl{{vl}}_rr{{rr}}.flac"), t(f"{d}/{art}/oh/{pre}_vl{{vl}}_rr{{rr}}.flac", 0.8, True))
    pz.append(pieza("crash", [49], cy("crash_17", "cr", "cr"), "crash", 7.5, 4, 3, rel=0.6, mono=True))
    pz.append(pieza("crash-sizzle", [57], cy("crash_sizzle_17", "cr", "crs"), "crash", 7.5, 4, 3, rel=0.6, mono=True, norm_db=-0.5))
    pz.append(pieza("china", [52], cy("china_18", "cn", "cn"), "china", 6.0, 4, 3, rel=0.5, mono=True))
    pz.append(pieza("ride", [51], cy("ride_22", "rd", "rd"), "ride", 7.0, 5, 3, rel=0.5, mono=True))
    pz.append(pieza("ride-sizzle", [59], cy("ride_sizzle_19", "rd", "rds"), "ride", 7.0, 5, 3, rel=0.5, mono=True, norm_db=-0.5))
    pz.append(pieza("campana-ride", [53], cy("ride_22", "bl", "rd_bl"), "campana", 4.5, 4, 3, rel=0.4, mono=True))
    return pz


# ---------------------------------------------------------------------------------------------------------------
# Naked Drums (Wilkinson Audio, SFZ de kinwie, CC BY 4.0): ARIA SFZ con macros; en vez de evaluarlas se leen los ficheros
# Data/group/<pieza>_<micro>.txt (qué fichero de muestras va a cada tecla) y Data/file/<CODIGO>.txt (micro, articulación,
# valores de velocidad y códigos). Los nombres de muestra son  <MIC>_<ART>_<VEL>_<RR>-<CODIGO_nn>.flac  con RR = one..ten y
# nn = (rr-1)*capas + capa. Teclas: mapa GM del propio kit (User/Naked Drums GM keymap.txt).
# ---------------------------------------------------------------------------------------------------------------
_NK_VEL = {5: [(1, 27), (28, 52), (53, 77), (78, 102), (103, 127)], 3: [(1, 43), (44, 85), (86, 127)], 2: [(1, 85), (86, 127)], 1: [(1, 127)]}
_NK_RR = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]


def _nk_file(datos, codigo):
    txt = open(os.path.join(datos, "file", codigo + ".txt"), encoding="utf-8").read()
    d = dict(re.findall(r"#define \$(\w+) (\S+)", txt))
    return d


def _nk_grupos(datos, nombre):
    """Devuelve {clave_GM: (código_fichero, tipo_region)} del fichero de grupos (sin los grupos de hi-hat variable por CC)."""
    txt = open(os.path.join(datos, "group", nombre + ".txt"), encoding="utf-8").read()
    res = {}
    for bloque in txt.split("<group>")[1:]:
        if "locc$" in bloque or "sw_var" in bloque:
            continue
        k = re.search(r"key=\$KEY_(\w+)", bloque)
        f = re.search(r"file/(\w+)\.txt", bloque)
        r = re.search(r"region/(v\d)\.txt", bloque)
        if k and f and r:
            res.setdefault(k.group(1), (f.group(1), int(r.group(1)[1:])))   # el primer bloque es el golpe; los siguientes (misma tecla) son choke
    return res


def nk_capas(base, mics):
    """Capas de Naked Drums para una pieza. `mics` = [(grupo, CLAVE, peso, alinear)]; el primero enumera capas y rr."""
    datos = os.path.join(base, "Data")
    muestras = os.path.join(base, "Samples")
    fuentes = []
    for (grupo, clave, peso, alin) in mics:
        g = _nk_grupos(datos, grupo)
        if clave not in g:
            continue
        codigo, nl = g[clave]
        d = _nk_file(datos, codigo)
        fuentes.append((d, nl, peso, alin))
    if not fuentes:
        return []
    capas = []
    nl0 = fuentes[0][1]
    for k in range(1, nl0 + 1):
        golpes = []
        for p in range(1, 11):
            golpe = []
            for (d, nl, peso, alin) in fuentes:
                kk = min(k, nl)
                nn = (p - 1) * nl + kk
                fn = f"{d['MIC']}_{d['ART']}_{d['VEL' + str(kk)]}_{_NK_RR[p - 1]}-{d['CODE_%02d' % nn]}.flac"
                ruta = os.path.join(muestras, fn)
                if os.path.exists(ruta):
                    golpe.append((ruta, peso, 1, alin))
            if golpe:
                golpes.append(golpe)
        lo, hi = _NK_VEL[nl0][k - 1]
        capas.append((lo, hi, golpes))
    return capas


def cat_naked(src):
    b = os.path.join(src, "Wilkinson Audio", "Naked Drums")
    n = lambda *mics: nk_capas(b, list(mics))
    pz = []
    DI, OH, CR = 1.0, 0.8, 0.45
    pz.append(pieza("bombo", [36, (35, -150, -1.0, 0.0)],
                    n(("kick_in", "KICK", DI, False), ("kick_sub", "KICK", 0.5, True), ("kick_oh", "KICK", 0.7, True), ("kick_cr", "KICK", 0.4, True)),
                    "bombo", 1.8, 5, 5, rel=0.12, norm_db=-1.0))
    sn = lambda key: n(("snare_top1" if key == "SNR1" else "snare_top2", key, DI, False), ("snare_oh", key, OH, True), ("snare_cr", key, CR, True))
    pz.append(pieza("caja", [38], sn("SNR1"), "caja", 2.4, 5, 5, rel=0.14))
    pz.append(pieza("caja-2", [40], sn("SNR2"), "rimshot", 2.2, 5, 5, rel=0.14, norm_db=-0.5))
    pz.append(pieza("side-stick", [37], n(("snare_top1", "SIDE", DI, False), ("snare_oh", "SIDE", OH, True)), "sidestick", 1.4, 1, 6, rel=0.1))
    tom = lambda i, notas: pieza(f"tom-{i}", notas, n((f"tom{i}_di", f"TOM{i}", DI, False), (f"tom{i}_oh", f"TOM{i}", OH, True), (f"tom{i}_cr", f"TOM{i}", CR, True)),
                                 "tom", 4.4, 5, 4, rel=0.3, damp=True)
    pz.append(tom(5, [41]))
    pz.append(tom(4, [43]))
    pz.append(tom(3, [45]))
    pz.append(tom(2, [47]))
    pz.append(tom(1, [48, (50, 200, -0.5, 0.0)]))
    hat = lambda key: n(("hats_di", key, DI, False), ("hats_oh", key, OH, True), ("hats_cr", key, CR, True))
    pz.append(pieza("hat-cerrado", [42], hat("HH_TGH"), "hat-cerrado", 0.9, 3, 4, rel=0.05, grupo=1, off_by=0))
    pz.append(pieza("hat-pedal", [44], hat("HH_PDL"), "hat-pedal", 0.3, 1, 4, rel=0.04, grupo=1, off_by=0))
    pz.append(pieza("hat-abierto", [46], hat("HH_OPN"), "hat-abierto", 2.4, 3, 3, rel=0.06, grupo=2, off_by=1))
    pz.append(pieza("hat-semi", [100], hat("HH_HLF"), "hat-semi", 1.3, 3, 3, rel=0.07, grupo=2, off_by=1))
    cym = lambda g, key: n((g + "_oh", key, 1.0, False), (g + "_cr", key, CR, True))
    pz.append(pieza("crash-1", [49], cym("crash1", "CRS1_EDG"), "crash", 8.0, 5, 4, rel=0.6))
    pz.append(pieza("crash-2", [57], cym("crash2", "CRS2_EDG"), "crash", 8.0, 5, 4, rel=0.6))
    pz.append(pieza("campana-crash", [78], cym("crash1", "CRS1_BEL"), "campana", 4.0, 1, 4, rel=0.4, norm_db=1.0))
    pz.append(pieza("splash", [55], cym("splash1", "SPL1"), "splash", 2.0, 5, 3, rel=0.3))
    pz.append(pieza("china", [52], cym("china1", "CHN1"), "china", 5.5, 5, 3, rel=0.5))
    pz.append(pieza("ride", [51], n(("ride_di", "RD_BOW", DI, False), ("ride_oh", "RD_BOW", OH, True), ("ride_cr", "RD_BOW", CR, True)), "ride", 8.0, 3, 4, rel=0.5))
    pz.append(pieza("campana-ride", [53], n(("ride_di", "RD_BEL", DI, False), ("ride_oh", "RD_BEL", OH, True), ("ride_cr", "RD_BEL", CR, True)), "campana", 4.5, 1, 4, rel=0.4))
    return pz


# ---------------------------------------------------------------------------------------------------------------
# DRSKit (port SFZ v1.0 de DrumGizmo.DRSKit, CC BY 4.0): un FLAC mono por micrófono y muestra:
#   Samples/<instr>/<N>-<instr>-<mic>.flac  (13 micros). Capas de velocidad y round-robin salen de Data/region/<instr>.txt
#   (lovel/hivel con macros de Data/macro.txt). Estéreo propio: OHL/OHR y AmbL/AmbR a izquierda/derecha, micrófono cercano al centro.
# ---------------------------------------------------------------------------------------------------------------
def drs_capas(base, instr, cercanos, oh=0.8, amb=0.35):
    datos = os.path.join(base, "Data")
    macros = {}
    for a, b in re.findall(r"#define \$(\w+)\s+(\d+)", open(os.path.join(datos, "macro.txt"), encoding="utf-8").read()):
        macros[a] = int(b)
    txt = open(os.path.join(datos, "region", instr + ".txt"), encoding="utf-8").read()
    capas = {}
    for m in re.finditer(r"lovel=\$(\w+)\s+hivel=\$(\w+).*?sample=\$instr/(\d+)-", txt):
        lo, hi, n = macros[m.group(1)], macros[m.group(2)], int(m.group(3))
        capas.setdefault((lo, hi), []).append(n)
    S = os.path.join(base, "Samples", instr)
    res = []
    for (lo, hi) in sorted(capas):
        golpes = []
        for n in sorted(capas[(lo, hi)]):
            f = lambda mic: os.path.join(S, f"{n}-{instr}-{mic}.flac")
            golpe = []
            for i, (mic, w) in enumerate(cercanos):
                golpe.append((f(mic), w, 1, i > 0))
            golpe += [(f("OHL"), oh, 1, True, -1.0), (f("OHR"), oh, 1, True, 1.0),
                      (f("AmbL"), amb, 1, True, -1.0), (f("AmbR"), amb, 1, True, 1.0)]
            golpes.append(golpe)
        res.append((lo, hi, golpes))
    return res


def cat_drskit(src):
    b = os.path.join(src, "DrumGizmo", "DRSKit")
    d = lambda instr, cerc, **kw: drs_capas(b, instr, cerc, **kw)
    pz = []
    pz.append(pieza("bombo", [36], d("Kdrum_with_contact", [("Kdrum_front", 1.0), ("Kdrum_back", 0.6)]), "bombo", 1.8, 6, 4, rel=0.12, norm_db=-1.0))
    pz.append(pieza("bombo-35", [(35, 0, -1.0, 0.0)], d("Kdrum_without_contact", [("Kdrum_front", 1.0), ("Kdrum_back", 0.6)]), "bombo", 1.8, 6, 4, rel=0.12, norm_db=-1.0))
    pz.append(pieza("caja", [38], d("Snare", [("Snare_top", 1.0), ("Snare_bottom", 0.4)]), "caja", 2.4, 8, 4, rel=0.14))
    pz.append(pieza("rimshot", [40], d("Snare_rim", [("Snare_top", 1.0), ("Snare_bottom", 0.4)]), "rimshot", 2.2, 4, 4, rel=0.14))
    pz.append(pieza("tom-1", [47, (48, 150, 0.0, 0.0), (50, 400, -0.5, 0.0)], d("Tom1", [("Tom1", 1.0)]), "tom", 4.4, 6, 3, rel=0.3, damp=True))
    pz.append(pieza("tom-2", [43, (45, 300, -0.5, 0.0)], d("Tom2", [("Tom2", 1.0)]), "tom", 4.6, 6, 3, rel=0.3, damp=True))
    pz.append(pieza("tom-3", [41], d("Tom3", [("Tom3", 1.0)]), "tom", 4.8, 6, 3, rel=0.35, damp=True))
    pz.append(pieza("hat-cerrado", [42], d("Hihat_closed", [("Hihat", 1.0)]), "hat-cerrado", 0.9, 6, 4, rel=0.05, grupo=1, off_by=0))
    pz.append(pieza("hat-pedal", [44], d("Hihat_foot", [("Hihat", 1.0)]), "hat-pedal", 0.4, 3, 3, rel=0.04, grupo=1, off_by=0))
    pz.append(pieza("hat-abierto", [46], d("Hihat_open", [("Hihat", 1.0)]), "hat-abierto", 2.4, 6, 3, rel=0.06, grupo=2, off_by=1))
    pz.append(pieza("hat-semi", [100], d("Hihat_semi_open", [("Hihat", 1.0)]), "hat-semi", 1.4, 5, 3, rel=0.07, grupo=2, off_by=1))
    pz.append(pieza("crash-1", [49], d("Crash_left_tip", [], oh=1.0, amb=0.5), "crash", 7.5, 4, 3, rel=0.6))
    pz.append(pieza("crash-2", [57], d("Crash_right_tip", [], oh=1.0, amb=0.5), "crash", 7.5, 4, 3, rel=0.6))
    pz.append(pieza("ride", [51], d("Ride_tip", [("Ride", 1.0)]), "ride", 7.5, 4, 3, rel=0.5))
    pz.append(pieza("ride-hombro", [59], d("Ride_shank", [("Ride", 1.0)]), "ride", 7.5, 4, 3, rel=0.5, norm_db=-0.5))
    pz.append(pieza("campana-ride", [53], d("Ride_tip_bell", [("Ride", 1.0)]), "campana", 4.5, 4, 3, rel=0.4))
    return pz


META_DRS = dict(
    slug="drskit", nombre="DRSKit Jazz-Rock", estilo="jazz a rock (Paiste Formula 602)",
    autor="DrumGizmo team (Lars Muldjord, Bent Bisballe Nyeng) y Jes Eiler (DRSDrums); port SFZ de kinwie",
    licencia=CCBY4[0], enlaceLicencia=CCBY4[1],
    creditos="«DRSKit» del equipo DrumGizmo y Jes Eiler (DRSDrums), port SFZ de kinwie, licencia CC BY 4.0, modificada (mezcla "
             "estéreo de micrófonos cercanos, overheads y ambiente, remuestreo, normalización, recorte y fundidos, PCM 16 bits).",
    fuente="https://github.com/sfzinstruments/DrumGizmo.DRSKit ; https://drumgizmo.org/wiki/doku.php?id=kits:drskit")

META_NAKED = dict(
    slug="naked", nombre="Naked Rock", estilo="rock / pop moderno limpio",
    autor="Wilkinson Audio (SFZ: kinwie)", licencia=CCBY4[0], enlaceLicencia=CCBY4[1],
    creditos="«Naked Drums» de Wilkinson Audio (adaptación SFZ de kinwie), licencia CC BY 4.0, modificada (mezcla de micrófonos "
             "directos, overheads y sala cercana, remuestreo, normalización, recorte y fundidos, PCM 16 bits).",
    fuente="https://github.com/sfzinstruments/WilkinsonAudio.NakedDrums")

META_SWIRLY = dict(
    slug="swirly", nombre="Swirly Indie", estilo="indie / punk lo-fi con escobillas",
    autor="Karoryfer Samples", licencia=CC0[0], enlaceLicencia=CC0[1],
    creditos="«Swirly Drums» v1.1 de Karoryfer Samples, CC0 1.0; solo micros secos, recortada, normalizada y convertida a PCM 16 bits.",
    fuente="https://github.com/sfzinstruments/karoryfer.swirly-drums")
META_BIGRUSTY = dict(
    slug="bigrusty", nombre="Big Rusty Rock", estilo="rock / metal vintage años 80",
    autor="Karoryfer Samples", licencia=CC0[0], enlaceLicencia=CC0[1],
    creditos="«Big Rusty Drums» de Karoryfer Samples, CC0 1.0; recortada, normalizada y convertida a PCM 16 bits.",
    fuente="https://github.com/sfzinstruments/karoryfer.big-rusty-drums")

KITS = {
    "virtuosity": dict(meta=META_VIRT, cat=cat_virtuosity, sub=["x", "virtuosity"], semilla=925),
    "naked": dict(meta=META_NAKED, cat=cat_naked, sub=["x", "naked"], semilla=2016),
    "drskit": dict(meta=META_DRS, cat=cat_drskit, sub=["x", "drs"], semilla=718),
    "swirly": dict(meta=META_SWIRLY, cat=cat_swirly, sub=["x", "swirly"], semilla=11),
    "bigrusty": dict(meta=META_BIGRUSTY, cat=cat_bigrusty, sub=["x", "bigrusty"], semilla=22),
}


def registrar_muldjord(salida_base, banco=None):
    """Registra MuldjordKit como kit `muldjord`: COPIA worship-drums.jws a drum-kits/muldjord/muldjord.jws (el original queda)."""
    banco = banco or os.path.join(APPDATA, "JasWave", "samples", "worship-drums.jws")
    carpeta = os.path.join(salida_base, "muldjord")
    os.makedirs(carpeta, exist_ok=True)
    destino = os.path.join(carpeta, "muldjord.jws")
    shutil.copy2(banco, destino)
    # las notas con zonas se leen del propio banco
    import jws_kit_validate as V
    zonas, _, _ = V.cargar(destino)
    notas = sorted({n for z in zonas for n in range(z["lokey"], z["hikey"] + 1)})
    meta = dict(
        slug="muldjord", nombre="MuldjordKit", estilo="worship moderno / rock",
        autor="Lars Muldjord (versión SFZ+FLAC de FreePats)", licencia=CCBY4[0], enlaceLicencia=CCBY4[1],
        creditos="«MuldjordKit» de Lars Muldjord, licencia CC BY 4.0, modificada (remuestreo, normalización, recorte y fundidos, PCM 16 bits).",
        fuente="https://drumgizmo.org/wiki/doku.php?id=kits:muldjordkit")
    L.escribir_kit_json(carpeta, meta, notas, os.path.getsize(destino))
    print(f"{destino}: copiado de {banco}, notas {notas}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kit")
    ap.add_argument("fuentes", nargs="?")
    ap.add_argument("salida", nargs="?", default=SALIDA)
    a = ap.parse_args()
    if a.kit == "muldjord":
        registrar_muldjord(a.salida)
        return
    k = KITS[a.kit]
    src = os.path.join(a.fuentes, *k["sub"])
    # los zips de GitHub traen una carpeta interior única
    if not os.path.isdir(os.path.join(src, "Samples")) and not os.path.isdir(os.path.join(src, "Wilkinson Audio")):
        sub = [d for d in os.listdir(src) if os.path.isdir(os.path.join(src, d))]
        if len(sub) == 1:
            src = os.path.join(src, sub[0])
    piezas = k["cat"](src)
    L.convertir_y_escribir(k["meta"]["slug"], k["meta"], piezas, os.path.join(a.salida, k["meta"]["slug"]), k["semilla"])


if __name__ == "__main__":
    main()
