#!/usr/bin/env python3
"""Une varios bancos .jws en uno solo (capas de timbre apiladas: ver JwSampler::Sampler::noteOnStack).

Uso:  python -I jws_merge.py salida.jws entrada1.jws [entrada2.jws ...]

Las zonas se concatenan tal cual (sus offsets de datos se reubican); no se toca el audio. Para que un
instrumento use TODAS las zonas que cubren una nota a la vez, el motor llama a noteOnStack().
"""
import struct
import sys

TAM = 64


def leer(ruta):
    with open(ruta, "rb") as f:
        b = f.read()
    if b[:4] != b"JWS1":
        sys.exit(f"{ruta}: no es un .jws")
    ver, n, tam, ini, flags = struct.unpack_from("<IIIII", b, 4)
    if ver != 1 or tam != TAM:
        sys.exit(f"{ruta}: version o tamaño de zona no soportados")
    zonas = [bytearray(b[32 + i * TAM : 32 + (i + 1) * TAM]) for i in range(n)]
    return zonas, b[ini:], flags


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    salida, entradas = sys.argv[1], sys.argv[2:]
    zonas, datos, flags = [], bytearray(), 0
    for e in entradas:
        zs, pcm, fl = leer(e)
        base = len(datos)
        for z in zs:
            off = struct.unpack_from("<Q", z, 40)[0] + base
            struct.pack_into("<Q", z, 40, off)
            zonas.append(z)
        datos += pcm
        flags |= fl
    inicio = 32 + TAM * len(zonas)
    cab = b"JWS1" + struct.pack("<IIIIIII", 1, len(zonas), TAM, inicio, flags, 0, 0)
    with open(salida, "wb") as f:
        f.write(cab)
        for z in zonas:
            f.write(z)
        f.write(datos)
    print(f"{salida}: {len(zonas)} zonas, {(inicio + len(datos)) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
