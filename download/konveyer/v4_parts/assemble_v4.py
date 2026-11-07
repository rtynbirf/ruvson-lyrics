#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Собирает RUVSON_QUANTUM_v4.html из трёх частей, лежащих рядом, и сверяет SHA256.

Запуск из этой папки (после git clone репозитория):
    python3 assemble_v4.py

Итог: RUVSON_QUANTUM_v4.html (219 400 082 байт).
Контроль целостности: SHA256SUMS (части + итог).
Плашки-альтернатива без Python:
    cat RUVSON_QUANTUM_v4.part1of3 RUVSON_QUANTUM_v4.part2of3 \
        RUVSON_QUANTUM_v4.part3of3 > RUVSON_QUANTUM_v4.html
"""
import hashlib
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "RUVSON_QUANTUM_v4.html"
N_PARTS = 3
TOTAL = 219_400_082

PART_SHA256 = {
    1: "26dc828420cac0c1d7709de59b3397c5a190a261adcc283eac7a2a055a630396",
    2: "e4f9b0463019d32c8a736b57a4419a49044f0153ecaa908fa0043be302c82b09",
    3: "9eb9f7a56f0ae0dd2939c58eaec379b7d2354ed6f4ba83dd2e0c3dab7e658736",
}
TOTAL_SHA256 = "bd384d5b684216a67ffd9d1a26c64548f757fa68432328ca4251fe27b1b8391d"
TOTAL_MD5 = "706b80616d326557a3c811d061bcfe40"


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for buf in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(buf)
    return h.hexdigest()


def main():
    parts = []
    for i in range(1, N_PARTS + 1):
        p = HERE / f"RUVSON_QUANTUM_v4.part{i}of{N_PARTS}"
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
    print(f"  md5    {TOTAL_MD5}")
    print("сборка целая — открывайте файл в браузере (плеер QUANTUM, 107 треков)")


if __name__ == "__main__":
    main()
