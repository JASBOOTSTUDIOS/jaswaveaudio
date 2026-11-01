#!/usr/bin/env python3
"""Convierte la percusión auxiliar CC0 (Virtuosity Drums /perc/mid, VCSL, FreePats World Percussion y body_percussion)
en el kit `percusion` de JasWave Worship Drums: `drum-kits/percusion/percusion.jws` + `kit.json`, con el mapa GM de percusión.

Uso:  python -I percusion2jws.py CARPETA_FUENTES [CARPETA_SALIDA]
  CARPETA_FUENTES contiene (descomprimidos):  x/virtuosity (Virtuosity_Drums_v0.925.zip), vcsl/files (carpetas de
  sgossner/VCSL bajadas por URL raw), worldperc/WorldPercussion SFZ+FLAC-20200905 y x/body/body_percussion-main.
  Salida por defecto: %APPDATA%/JasWave/samples/drum-kits/percusion

Mapa GM: 39 palmas, 54 pandereta, 56 cencerro, 58 vibraslap, 60/61 bongós, 62/63/64 congas, 67/68 agogó, 69 cabasa,
70 maracas, 71/72 silbato, 73/74 güiro, 75 claves, 76/77 woodblock (77 = el mismo bloque 5 semitonos más grave),
80/81 triángulo, 82 shaker, 83 cascabeles, 84 bell tree, 85 castañuelas. Sin timbales (65/66): no hay fuente CC0/CC BY con
micrófonos. La campana de crash (78) la añade `kit_sfz2jws.py` desde Naked Drums si se convierte ese kit en el kit `percusion`
(ver `--campana-crash`). Mismo tratamiento de audio que MuldjordKit (ver jws_kit_lib.py).
"""
import argparse
import os
import re
import sys

_aqui = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _aqui)
import jws_kit_lib as L  # noqa: E402

META = {
    "slug": "percusion",
    "nombre": "Percusión auxiliar",
    "estilo": "percusión latina, de mano y de orquesta (mapa GM 39-85)",
    "autor": "Versilian Studios (Virtuosity Drums, VCSL), FreePats (World Percussion: Xavimart, Gonzalo, Roberto), body_percussion (sfzinstruments); campana de crash: Wilkinson Audio (Naked Drums)",
    "licencia": "CC BY 4.0",   # CC0 salvo la nota 78 (campana de crash, Naked Drums, CC BY 4.0): el conjunto exige atribución
    "enlaceLicencia": "https://creativecommons.org/licenses/by/4.0/",
    "creditos": "Percusión: Virtuosity Drums y Versilian Community Sample Library (Versilian Studios), FreePats World Percussion y "
                "body_percussion, todos CC0 1.0; campana de crash (nota 78) de «Naked Drums» de Wilkinson Audio (SFZ de kinwie), "
                "CC BY 4.0, modificada. Recortadas, normalizadas y convertidas a PCM 16 bits.",
    "fuente": "https://versilian-studios.com/virtuosity-drums/ ; https://github.com/sfzinstruments/WilkinsonAudio.NakedDrums ; https://github.com/sgossner/VCSL ; "
              "https://freepats.zenvoid.org/Percussion/world-and-rare-percussion.html ; https://github.com/sfzinstruments/body_percussion",
}


def _orden(nombre):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", nombre)]


def capas_re(carpeta, patron, lohi=None):
    """Agrupa los ficheros de `carpeta` que cumplen `patron` (regex con grupo opcional 'c' = clave de capa) en capas.
    Dentro de cada capa, cada fichero es un round-robin. Devuelve [(lo, hi, [golpe, ...]), ...] ordenado por clave."""
    rx = re.compile(patron)
    grupos = {}
    rangos = {}
    for f in sorted(os.listdir(carpeta), key=_orden):
        m = rx.fullmatch(f)
        if not m:
            continue
        c = m.groupdict().get("c") or ""
        grupos.setdefault(c, []).append([(os.path.join(carpeta, f), 1.0, 1, False)])
        if lohi:
            rangos[c] = lohi(m)
    res = []
    for c in sorted(grupos, key=_orden):
        lo, hi = rangos.get(c, (None, None))
        res.append((lo, hi, grupos[c]))
    return res


def unir_rr(*listas):
    """Une varias listas de capas capa a capa (los golpes de la capa i de cada lista pasan a ser round-robin de la capa i)."""
    n = max(len(c) for c in listas)
    res = []
    for i in range(n):
        golpes = []
        for capas in listas:
            if i < len(capas):
                golpes += capas[i][2]
        res.append((None, None, golpes))
    return res


def una_capa(*listas):
    """Todos los golpes de todas las listas, en una sola capa (round-robin)."""
    golpes = [g for capas in listas for c in capas for g in c[2]]
    return [(None, None, golpes)]


def intercalar(a, b):
    """Dos listas de golpes alternadas (adelante/atrás)."""
    res = []
    for i in range(max(len(a), len(b))):
        if i < len(a):
            res.append(a[i])
        if i < len(b):
            res.append(b[i])
    return res


def pieza(nombre, notas, capas, norm, max_seg=2.0, dyn=18.0, rel=0.25, nmax_capas=5, rr=6, mono=False, damp=False):
    dest = [(n, 0, 0.0, 0.0) if isinstance(n, int) else n for n in notas]
    return dict(nombre=nombre, dest=dest, capas_lista=capas, norm=norm, dyn=dyn, max_seg=max_seg, rel=rel,
                capas=nmax_capas, rr=rr, mono=mono, damp=damp)


def construir(src):
    V = os.path.join(src, "x", "virtuosity", "Samples", "perc", "mid")
    C = os.path.join(src, "vcsl", "files", "Idiophones", "Struck Idiophones")
    B = os.path.join(src, "x", "body", "body_percussion-main", "Samples", "body")
    W = os.path.join(src, "worldperc", "WorldPercussion SFZ+FLAC-20200905", "samples")
    v = lambda d, p, **k: capas_re(os.path.join(V, d), p, **k)
    pz = []
    # --- palmas (39): body_percussion (2 capas, 4-6 rr) + palmas de grupo VCSL + FreePats HandClap
    claps = capas_re(os.path.join(C, "Claps"), r"Clap_rr\d+\.wav")[0][2]
    pz.append(pieza("palmas", [39], [capas_re(B, r"handclap_vl1_rr\d+\.wav")[0],
                                     (None, None, capas_re(B, r"handclap_vl2_rr\d+\.wav")[0][2] + claps)],
                    norm=-20.0, max_seg=1.2, rr=6, nmax_capas=2))
    # --- pandereta (54): VCSL Tambourine 1 y 2 (golpes, 2 capas) + FreePats Tambourine
    tw = capas_re(os.path.join(W, "Tambourine"), r"(0[5-9]|10)\.flac")[0][2]
    tcap = unir_rr(capas_re(os.path.join(C, "Tambourine 1"), r"Tamb1_Hit_(?P<c>v\d)_rr\d_Mid\.wav"),
                   capas_re(os.path.join(C, "Tambourine 2"), r"Tamb2_Hit_(?P<c>v\d)_rr\d_Mid\.wav"))
    tcap[0][2].extend(tw[:3])
    tcap[1][2].extend(tw[3:])
    pz.append(pieza("pandereta", [54], tcap, norm=-24.0, max_seg=1.5, rr=6, nmax_capas=2))
    # --- cencerro (56): Virtuosity Cowbell1 Normal (3 capas x 7 rr)
    pz.append(pieza("cencerro", [56], v("cowbell", r"Cowbell1_Normal_(?P<c>v\d)_rr\d+_Mid\.wav"), norm=-22.0, max_seg=2.2, rr=5, nmax_capas=3))
    # --- vibraslap (58)
    pz.append(pieza("vibraslap", [58], v("vibraslap", r"Vibraslap1_1_Hit_(?P<c>\d+_\d+)_rr\d+_Mid\.wav",
                                         lohi=lambda m: tuple(int(x) for x in m["c"].split("_"))),
                    norm=-26.0, max_seg=3.2, rr=4, nmax_capas=2))
    # --- bongós (60 agudo / 61 grave)
    pz.append(pieza("bongo-agudo", [60], v("bongoh", r"BongoH_Hit1_(?P<c>v\d)_rr\d+_Mid\.wav"), norm=-21.0, max_seg=1.6, rr=5, nmax_capas=3))
    pz.append(pieza("bongo-grave", [61], v("bongol", r"BongoL_Hit1_(?P<c>v\d)_rr\d+_Mid\.wav"), norm=-21.0, max_seg=1.8, rr=5, nmax_capas=3))
    # --- congas: 62 conga aguda apagada, 63 aguda abierta, 64 grave (tumba)
    rngn = lambda m: tuple(int(x) for x in m["c"].split("_"))
    pz.append(pieza("conga-apagada", [62], v("conga", r"Conga_17_HitHM1_(?P<c>\d+_\d+)_rr\d+_Mid\.wav", lohi=rngn), norm=-20.0, max_seg=1.4, rr=5, nmax_capas=2))
    pz.append(pieza("conga-abierta", [63], v("conga", r"Conga_22_HitN_(?P<c>\d+_\d+)_rr\d+_Mid\.wav", lohi=rngn), norm=-20.0, max_seg=2.0, rr=5, nmax_capas=3))
    pz.append(pieza("conga-grave", [64], v("tumba", r"Tumba_24_HitN_(?P<c>\d+_\d+)_rr\d+_Mid\.wav", lohi=rngn), norm=-20.0, max_seg=2.2, rr=5, nmax_capas=4))
    # --- agogó (67 agudo / 68 grave)
    pz.append(pieza("agogo-agudo", [67], v("agogo", r"Agogo_High_(?P<c>v\d)_rr\d+_Mid\.wav"), norm=-24.0, max_seg=1.8, rr=5, nmax_capas=3))
    pz.append(pieza("agogo-grave", [68], v("agogo", r"Agogo_Low_(?P<c>v\d)_rr\d+_Mid\.wav"), norm=-24.0, max_seg=2.0, rr=5, nmax_capas=2))
    # --- cabasa (69), maracas (70)
    pz.append(pieza("cabasa", [69], v("cabasa", r"Cabasa1_Rub_(?P<c>v\d)_rr\d+_Mid\.wav"), norm=-30.0, max_seg=1.4, rr=6, nmax_capas=2))
    mar1 = capas_re(os.path.join(W, "Maracas"), r"01_\d+\.(flac|wav)")[0][2]
    mar2 = capas_re(os.path.join(W, "Maracas"), r"02_\d+\.(flac|wav)")[0][2]
    pz.append(pieza("maracas", [70], [(None, None, intercalar(mar1, mar2))], norm=-30.0, max_seg=0.8, rr=8, nmax_capas=1))
    # --- silbato corto (71) / largo (72), güiro corto (73) / largo (74)
    wh = os.path.join(V, "whistle")
    pz.append(pieza("silbato-corto", [71], [(None, None, [[(os.path.join(wh, f), 1.0, 1, False)] for f in sorted(os.listdir(wh), key=_orden) if "Short" in f])],
                    norm=-26.0, max_seg=1.2, rr=6, nmax_capas=1))
    pz.append(pieza("silbato-largo", [72], [(None, None, [[(os.path.join(wh, f), 1.0, 1, False)] for f in sorted(os.listdir(wh), key=_orden) if "Long" in f])],
                    norm=-26.0, max_seg=2.5, rr=2, nmax_capas=1))
    pz.append(pieza("guiro-corto", [73], una_capa(v("guiro", r"Guiro_Fast_rr\d+_Mid\.wav")), norm=-28.0, max_seg=1.2, rr=6, nmax_capas=1))
    pz.append(pieza("guiro-largo", [74], una_capa(v("guiro", r"Guiro_Med_rr\d+_Mid\.wav")), norm=-28.0, max_seg=1.8, rr=6, nmax_capas=1))
    # --- claves (75)
    pz.append(pieza("claves", [75], v("claves", r"Claves1_Hit_(?P<c>v\d)_rr\d+_Mid\.wav"), norm=-22.0, max_seg=1.0, rr=5, nmax_capas=3))
    # --- woodblock (76; 77 = mismo bloque 500 cents más grave) con VCSL Woodblock (4 niveles de intensidad)
    wb = os.path.join(C, "Woodblock")
    nivel = {"pp": 0, "mp": 1, "f": 2, "ff": 3}
    caps = {}
    for f in sorted(os.listdir(wb), key=_orden):
        m = re.fullmatch(r"wood_click_(pp|mp|f|ff)(_rr\d+)?\.wav", f)
        if m:
            caps.setdefault(nivel[m.group(1)], []).append([(os.path.join(wb, f), 1.0, 1, False)])
    wcap = [(None, None, caps[k]) for k in sorted(caps)]
    pz.append(pieza("woodblock", [76, (77, -500, 0.0, 0.0)], wcap, norm=-22.0, max_seg=0.9, rr=3, nmax_capas=4))
    # --- triángulo mute (80) / abierto (81)
    pz.append(pieza("triangulo-mute", [80], v("triangle", r"Triangle1_Hit(?P<c>M_v1)_rr\d+_Mid\.wav"), norm=-32.0, max_seg=1.2, rr=4, nmax_capas=1))
    pz.append(pieza("triangulo-abierto", [81], v("triangle", r"Triangle1_Hit_(?P<c>v\d)_rr\d+_Mid\.wav"), norm=-32.0, max_seg=3.5, rr=4, nmax_capas=2, rel=0.5))
    # --- shaker (82), cascabeles (83), bell tree (84), castañuelas (85)
    sh_d = capas_re(os.path.join(V, "shaker"), r"LShaker_Shake1D_rr\d+_Mid\.wav")[0][2]
    sh_u = capas_re(os.path.join(V, "shaker"), r"LShaker_Shake1U_rr\d+_Mid\.wav")[0][2]
    pz.append(pieza("shaker", [82], [(None, None, intercalar(sh_d, sh_u))], norm=-30.0, max_seg=1.0, rr=8, nmax_capas=1))
    pz.append(pieza("cascabeles", [83], una_capa(v("sleighbells", r"Sleighbells_Hit_rr\d+_Mid\.wav")), norm=-30.0, max_seg=1.8, rr=6, nmax_capas=1))
    pz.append(pieza("bell-tree", [84], una_capa(v("belltree", r"BellTree_Stroke_rr\d+_Mid\.wav")), norm=-30.0, max_seg=3.5, rr=6, nmax_capas=1, rel=0.5))
    pz.append(pieza("castanuelas", [85], una_capa(capas_re(os.path.join(W, "Castanets"), r"\d+\.flac")), norm=-26.0, max_seg=0.8, rr=8, nmax_capas=1))
    # --- campana de crash (78): Naked Drums (CC BY 4.0, Wilkinson Audio), si está descomprimido en x/naked
    nk = os.path.join(src, "x", "naked")
    if os.path.isdir(nk):
        import kit_sfz2jws as K
        sub = [d for d in os.listdir(nk) if os.path.isdir(os.path.join(nk, d))]
        for q in K.cat_naked(os.path.join(nk, sub[0])):
            if q["nombre"] == "campana-crash":
                q["capas"], q["rr"] = 1, 8
                pz.append(q)
    return pz


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("fuentes")
    ap.add_argument("salida", nargs="?", default=os.path.join(os.environ.get("APPDATA", ""), "JasWave", "samples", "drum-kits", "percusion"))
    a = ap.parse_args()
    piezas = construir(a.fuentes)
    L.convertir_y_escribir("percusion", META, piezas, a.salida, 20261029)


if __name__ == "__main__":
    main()
