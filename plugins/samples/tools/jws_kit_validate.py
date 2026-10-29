#!/usr/bin/env python3
"""Valida un banco de kit `.jws` con la MISMA lógica de carga que `plugins/shared-dsp/jw_sampler.h` (Bank::load) y escribe
WAVs de prueba (golpes sueltos y un groove de 2 compases) para escucharlos.

Uso:  python -I jws_kit_validate.py CARPETA_KIT [CARPETA_WAV]
  CARPETA_KIT = drum-kits/<slug> con <slug>.jws y kit.json. CARPETA_WAV por defecto
  plugins/com.jaswave.plugin.worship-drums/out/kits (carpeta ignorada por git); escribe <slug>-golpes.wav y <slug>-groove.wav.

Comprueba: cabecera/tabla de zonas como el motor, zonas por nota, rangos de velocidad 1..127 sin huecos ni solapes, round-robin
completos (rrIndex 0..rrCount-1 por capa), notas de kit.json == notas con zonas, picos sin clipping (ninguna muestra a fondo de
escala), tamaño del archivo frente a kit.json. Termina con código 1 si algo falla.
"""
import json
import os
import struct
import sys
import wave

import numpy as np

RATE = 44100


def cargar(ruta):
    """Réplica de Bank::load (jw_sampler.h): devuelve (zonas, pcm int16, errores)."""
    err = []
    with open(ruta, "rb") as f:
        b = f.read()
    if len(b) < 32 or b[:4] != b"JWS1":
        raise SystemExit("cabecera .jws no válida")
    ver, n, tam, inicio, flags = struct.unpack_from("<IIIII", b, 4)
    if ver != 1 or tam != 64 or n == 0 or n > 20000:
        raise SystemExit("versión o tabla de zonas no válida")
    zonas = []
    for i in range(n):
        r = b[32 + i * 64 : 32 + (i + 1) * 64]
        z = dict(lokey=r[0], hikey=r[1], root=r[2], lovel=r[3], hivel=r[4], rr=r[5], rrn=max(1, r[6]), ch=2 if r[7] == 2 else 1)
        z["sr"], z["frames"], z["ls"], z["le"] = struct.unpack_from("<IIII", r, 8)
        z["cents"], z["gain"], z["rel"], z["pan"] = struct.unpack_from("<ffff", r, 24)
        z["off"] = struct.unpack_from("<Q", r, 40)[0]
        z["group"], z["offby"], z["oneshot"] = r[48], r[49], r[50]
        if z["sr"] < 8000 or z["sr"] > 192000 or z["frames"] < 16:
            raise SystemExit("zona con datos no válidos")
        zonas.append(z)
    datos = b[inicio:]
    pcm = np.frombuffer(datos[: len(datos) & ~1], dtype="<i2")
    for z in zonas:
        if z["off"] + z["frames"] * z["ch"] * 2 > len(datos):
            raise SystemExit("zona fuera del archivo")
    return zonas, pcm, err


def datos_zona(z, pcm):
    a = z["off"] // 2
    return pcm[a : a + z["frames"] * z["ch"]].reshape(-1, z["ch"]).astype(np.float32) / 32768.0


def validar(zonas, pcm, meta, tam_archivo):
    fallos, avisos = [], []
    por_nota = {}
    for z in zonas:
        for n in range(z["lokey"], z["hikey"] + 1):
            por_nota.setdefault(n, []).append(z)
    notas_json = set(meta.get("notas", []))
    if set(por_nota) != notas_json:
        fallos.append(f"kit.json.notas != notas con zonas: sobran {sorted(notas_json - set(por_nota))}, faltan {sorted(set(por_nota) - notas_json)}")
    info = {}
    for n, zs in sorted(por_nota.items()):
        # capas = pares (lovel, hivel) distintos; cada una con rrIndex 0..rrCount-1 completos
        capas = {}
        for z in zs:
            capas.setdefault((z["lovel"], z["hivel"]), []).append(z)
        rangos = sorted(capas)
        # los kits pueden apilar más de una pieza en la misma nota (p. ej. bombo + otro): agrupar por "pieza" = mismo conjunto
        cobertura = np.zeros(128, int)
        for (lo, hi), g in capas.items():
            cobertura[lo : hi + 1] += 1
            rrs = sorted(z["rr"] for z in g)
            if rrs != list(range(len(rrs))) or any(z["rrn"] != len(rrs) for z in g):
                fallos.append(f"nota {n} capa {lo}-{hi}: round-robin incompleto {rrs} (rrCount {sorted({z['rrn'] for z in g})})")
        if (cobertura[1:128] == 0).any():
            huecos = [i for i in range(1, 128) if cobertura[i] == 0]
            fallos.append(f"nota {n}: velocidades sin zona {huecos[:6]}...")
        if (cobertura[1:128] > 1).any():
            fallos.append(f"nota {n}: capas de velocidad solapadas")
        picos = [np.abs(datos_zona(z, pcm)).max() for z in zs]
        clip = sum(int(np.sum(np.abs(pcm[z['off'] // 2 : z['off'] // 2 + z['frames'] * z['ch']].astype(np.int32)) >= 32767)) for z in zs)
        if clip:
            fallos.append(f"nota {n}: {clip} muestras a fondo de escala (clipping)")
        if max(picos) < 0.01:
            fallos.append(f"nota {n}: silenciosa")
        top = max(zs, key=lambda z: (z["lovel"], -z["rr"]))
        yt = datos_zona(top, pcm)[: int(0.4 * top["sr"])].mean(axis=1) * (10 ** (top["gain"] / 20.0))
        rms_db = 20 * np.log10(float(np.sqrt(np.mean(yt ** 2))) + 1e-9)
        info[n] = dict(zonas=len(zs), capas=len(capas), rr=max(len(g) for g in capas.values()),
                       pico_db=20 * np.log10(max(picos) + 1e-9), seg=max(z["frames"] / z["sr"] for z in zs), rms_db=rms_db)
    tam_json = meta.get("tamanoMB")
    if tam_json is not None and abs(tam_json - tam_archivo / 1e6) > 0.2:
        avisos.append(f"tamanoMB del kit.json ({tam_json}) distinto del archivo ({tam_archivo / 1e6:.1f})")
    return fallos, avisos, info


class Motor:
    """Reproductor mínimo con la selección de zonas del motor (nota, velocidad, round-robin cíclico)."""

    def __init__(self, zonas, pcm):
        self.zonas, self.pcm = zonas, pcm
        self.rr = {}

    def disparo(self, nota, vel):
        c = [z for z in self.zonas if z["lokey"] <= nota <= z["hikey"] and z["lovel"] <= vel <= z["hivel"]]
        if not c:
            return None
        # varias piezas pueden compartir nota: se elige un round-robin por conjunto de capa
        n = max(z["rrn"] for z in c)
        i = self.rr.get(nota, 0) % n
        self.rr[nota] = i + 1
        z = next((z for z in c if z["rr"] == i % z["rrn"]), c[0])
        y = datos_zona(z, self.pcm)
        if z["cents"]:
            r = 2 ** (z["cents"] / 1200.0)
            xs = np.arange(0, len(y) - 1, r)
            y = np.stack([np.interp(xs, np.arange(len(y)), y[:, k]) for k in range(y.shape[1])], 1)
        g = 10 ** (z["gain"] / 20.0) * (0.82 + 0.18 * vel / 127.0)
        y = y * g
        if y.shape[1] == 1:
            y = np.repeat(y, 2, axis=1) * 0.7079   # el motor atenúa 3 dB el centro de las mono
        return y


def mezclar_en(buf, y, pos):
    fin = pos + len(y)
    if fin > len(buf):
        buf = np.concatenate([buf, np.zeros((fin - len(buf), 2), np.float32)])
    buf[pos:fin] += y
    return buf


def escribir_wav(ruta, y):
    pico = float(np.abs(y).max())
    if pico > 0.98:
        y = y * (0.98 / pico)
    q = np.clip(np.round(y * 32767), -32768, 32767).astype("<i2")
    os.makedirs(os.path.dirname(os.path.abspath(ruta)), exist_ok=True)
    with wave.open(ruta, "wb") as w:
        w.setnchannels(2), w.setsampwidth(2), w.setframerate(RATE)
        w.writeframes(q.tobytes())
    return pico


def golpes_sueltos(motor, notas, ruta):
    buf = np.zeros((RATE, 2), np.float32)
    pos = 0
    for n in sorted(notas):
        for vel in (40, 100):
            y = motor.disparo(n, vel)
            if y is None:
                continue
            buf = mezclar_en(buf, y, pos)
            pos += int(min(len(y) / RATE, 3.0) * RATE) + int(0.25 * RATE)
    return escribir_wav(ruta, buf)


def groove(motor, notas, ruta, bpm=100):
    """2 compases de 4/4 en corcheas. Batería: hi-hat (ride si no hay), bombo en 1, 'y' del 2 y 3, caja en 2 y 4, crash al
    inicio y un tom de remate. Percusión (sin bombo/caja): patrón de claves/cencerro/congas/shaker con lo que haya."""
    s = 60.0 / bpm / 2
    buf = np.zeros((int(RATE * s * 16 + RATE * 4), 2), np.float32)
    rng = np.random.default_rng(1)
    hay = set(notas)
    v = lambda base: int(np.clip(base + rng.integers(-8, 8), 1, 127))

    def golpe(n, vel, i):
        y = motor.disparo(n, v(vel))
        if y is not None:
            nonlocal buf
            buf = mezclar_en(buf, y, int(i * s * RATE))

    if 36 in hay or 38 in hay:
        hat = 42 if 42 in hay else (51 if 51 in hay else None)
        snare = 38 if 38 in hay else 37
        for i in range(16):
            if hat:
                golpe(46 if (i == 15 and 46 in hay) else hat, 95 if i % 2 == 0 else 62, i)
            if i in (0, 5, 8):
                golpe(36, 105, i)
            if i in (4, 12):
                golpe(snare, 108, i)
        for c in (49, 57):
            if c in hay:
                golpe(c, 105, 0)
                break
        if 43 in hay and 41 in hay:
            golpe(43, 100, 14)
            golpe(41, 105, 15)
        return escribir_wav(ruta, buf)
    patron = [(75, 0, 0), (56, 0, 1), (60, 2, 2), (61, 2, 3), (63, 3, 4), (64, 3, 5), (54, 4, 6), (70, 5, 7), (82, 1, 8), (39, 5, 9)]
    for compas in range(2):
        for i in range(8):
            gi = compas * 8 + i
            for n in ((70, 82, 69) if i % 2 == 0 else (82,)):
                if n in hay:
                    golpe(n, 70 if i % 2 else 90, gi)
                    break
            if i in (0, 3, 6) and 75 in hay:
                golpe(75, 100, gi)
            if i in (2, 5) and 56 in hay:
                golpe(56, 95, gi)
            if i in (1, 4, 7):
                golpe((63, 64, 62)[(gi // 2) % 3], 95, gi)
            if i in (3, 7) and 54 in hay:
                golpe(54, 90, gi)
            if i in (0, 4) and 39 in hay:
                golpe(39, 90, gi)
            if i == 6 and gi < 8 and 60 in hay:
                golpe(60, 100, gi)
                golpe(61, 85, gi + 0.5)
    return escribir_wav(ruta, buf)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    carpeta = sys.argv[1]
    slug = os.path.basename(os.path.normpath(carpeta))
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                                                           "com.jaswave.plugin.worship-drums", "out", "kits")
    ruta = os.path.join(carpeta, slug + ".jws")
    meta = json.load(open(os.path.join(carpeta, "kit.json"), encoding="utf-8"))
    zonas, pcm, _ = cargar(ruta)
    tam = os.path.getsize(ruta)
    fallos, avisos, info = validar(zonas, pcm, meta, tam)
    print(f"{slug}: {len(zonas)} zonas, {tam / 1e6:.1f} MB, {len(info)} notas")
    for n, d in info.items():
        print(f"  nota {n:3d}: {d['zonas']:3d} zonas, {d['capas']} capas, {d['rr']} rr, pico {d['pico_db']:6.1f} dBFS, RMS 0,4 s capa fuerte {d['rms_db']:6.1f} dB, dur máx {d['seg']:.1f} s")
    for a in avisos:
        print("  AVISO:", a)
    for f in fallos:
        print("  FALLO:", f)
    m = Motor(zonas, pcm)
    p1 = golpes_sueltos(m, info.keys(), os.path.join(out, f"{slug}-golpes.wav"))
    p2 = groove(Motor(zonas, pcm), info.keys(), os.path.join(out, f"{slug}-groove.wav"))
    print(f"  WAV: {os.path.normpath(out)}\\{slug}-golpes.wav (pico {p1:.2f}), {slug}-groove.wav (pico {p2:.2f})")
    print("  RESULTADO:", "FALLO" if fallos else "OK")
    sys.exit(1 if fallos else 0)


if __name__ == "__main__":
    main()
