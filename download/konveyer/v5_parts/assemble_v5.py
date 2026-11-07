#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Собирает RUVSON_QUANTUM_v5.html из пяти частей, лежащих рядом, и сверяет SHA256.

Запуск из этой папки (после git clone репозитория):
    python3 assemble_v5.py

Итог: RUVSON_QUANTUM_v5.html (446 710 179 байт).
Пломбы: SHA256SUMS (части + итог). Без Python:
    cat RUVSON_QUANTUM_v5.part{1,2,3,4,5}of5 > RUVSON_QUANTUM_v5.html
"""
import hashlib
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "RUVSON_QUANTUM_v5.html"
N_PARTS = 5
TOTAL = 446_710_179

PART_SHA256 = {
    1: "ffce387bafbb61dee08562ca1adae182fe59e5828586327f0f819783ad1f13c9",
    2: "704a3e2c7d4d530031780f8b3acd3eb2009fb89ad129205ad89b2a67bc4551df",
    3: "d976e4cc1705db98c3d06bdd8ddbf2b3eafd343a01e2fbb5ad76d8b1761964a9",
    4: "52b54849e8275732b6f85d27f19133258ba8eb97f8e6758595b3b1ffcb3a6883",
    5: "0b4b76632d7cbb5dc8442e9f6b17f6468787a62dd1075af62a43f8d296ae10fa",
}
TOTAL_SHA256 = "7cddb666c7d9dcd63d92eb76e6010f9e26757ed665ec54cfde97075c15b46a4d"


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for buf in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(buf)
    return h.hexdigest()


def main():
    parts = []
    for i in range(1, N_PARTS + 1):
        p = HERE / f"RUVSON_QUANTUM_v5.part{i}of{N_PARTS}"
        if not p.is_file():
            sys.exit(f"НЕТ ЧАСТИ: {p.name} — клонируйте репозиторий целиком (git lfs не нужен)")
        real = sha256_of(p)
        if real != PART_SHA256[i]:
            sys.exit(f"ПЛОМБА ЧАСТИ {i} НЕ СОШЛАСЬ:\n  ждали {PART_SHA256[i]}\n  факт  {real}")
        print(f"часть {i}: пломба OK ({p.stat().st_size:,} байт)")
        parts.append(p)

    if OUT.exists() and OUT.stat().st_size == TOTAL and sha256_of(OUT) == TOTAL_SHA256:
        print("итог уже собран и цел — пропуск")
        return

    h = hashlib.sha256()
    written = 0
    with open(OUT, "wb") as out:
        for p in parts:
            with open(p, "rb") as src:
                for buf in iter(lambda: src.read(8 * 1024 * 1024), b""):
                    out.write(buf)
                    h.update(buf)
                    written += len(buf)
    if written != TOTAL or h.hexdigest() != TOTAL_SHA256:
        sys.exit(f"ИТОГ НЕ СОШЁЛСЯ: {written:,} байт, sha256 {h.hexdigest()}")
    print(f"ИТОГ: {OUT.name} {written:,} байт")
    print(f"  sha256 {TOTAL_SHA256}")
    print("сборка целая — открывайте файл в браузере (плеер QUANTUM, 107 треков)")


if __name__ == "__main__":
    main()
