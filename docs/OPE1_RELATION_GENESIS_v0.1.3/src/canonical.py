"""
OPE-1 / RELATION-GENESIS v0.1.3
Limited JCS-compatible canonicalizer (safe subset), hardened per defect registry
of the independent audit of v0.1.0–v0.1.2.

Closed in v0.1.3:
- CAN-001: control characters U+0000–U+001F are fully escaped
           (short forms \\b \\t \\n \\f \\r, otherwise \\u00xx lowercase hex).
           Lone surrogates (U+D800–U+DFFF) are REJECTED (not representable).
- CAN-002: I-JSON integer bound: |n| <= 2^53-1 (9007199254740991).
- CAN-003: object keys sorted by UTF-16 code units (RFC 8785 order),
           not by Unicode code points. Differs only for supplementary-plane
           keys; test proves the order switch.

Still true from v0.1.x:
- Supported types: int, str, bool, null, list, dict.
- Floats are REJECTED until full ES6/RFC 8785 number handling is implemented
  and verified against official test vectors.
- Object keys must be strings.
"""

from __future__ import annotations

import hashlib
from typing import Any


class CanonicalizationError(ValueError):
    """Raised when input contains unsupported or unsafe values."""


I_JSON_MAX_INT = 9007199254740991  # 2^53 - 1


def _canonicalize_string(s: str) -> str:
    out = ['"']
    for ch in s:
        o = ord(ch)
        if o in (0x08, 0x09, 0x0A, 0x0C, 0x0D):
            short = {0x08: "\\b", 0x09: "\\t", 0x0A: "\\n", 0x0C: "\\f", 0x0D: "\\r"}
            out.append(short[o])
        elif o == 0x22:
            out.append('\\"')
        elif o == 0x5C:
            out.append("\\\\")
        elif 0x20 <= o <= 0x10FFFF and not (0xD800 <= o <= 0xDFFF):
            out.append(ch)
        elif 0xD800 <= o <= 0xDFFF:
            raise CanonicalizationError(
                "Lone surrogate U+%04X is not representable in JSON/UTF-8" % o
            )
        else:
            # remaining control characters U+0000-U+001F
            out.append("\\u%04x" % o)
    out.append('"')
    return "".join(out)


def _canonicalize_value(obj: Any) -> str:
    if obj is None:
        return "null"
    if isinstance(obj, bool):
        return "true" if obj else "false"
    if isinstance(obj, int):
        if not (-(2**53 - 1) <= obj <= 2**53 - 1):
            raise CanonicalizationError(
                "Integer out of I-JSON safe range (2^53-1): %d" % obj
            )
        return str(obj)
    if isinstance(obj, float):
        raise CanonicalizationError(
            "Floats are not supported in v0.1.x. "
            "Full ES6/RFC 8785 number serialization is required before floats are allowed."
        )
    if isinstance(obj, str):
        return _canonicalize_string(obj)
    if isinstance(obj, list):
        items = ",".join(_canonicalize_value(v) for v in obj)
        return f"[{items}]"
    if isinstance(obj, dict):
        # RFC 8785 key order: UTF-16 code units (not code points)
        def utf16_key(k: str) -> bytes:
            if not isinstance(k, str):
                raise CanonicalizationError(
                    f"Object keys must be strings, got {type(k)}"
                )
            if any(0xD800 <= ord(c) <= 0xDFFF for c in k):
                raise CanonicalizationError("Key contains lone surrogate")
            return k.encode("utf-16-be")

        pairs = []
        for k in sorted(obj.keys(), key=utf16_key):
            pairs.append(f"{_canonicalize_value(k)}:{_canonicalize_value(obj[k])}")
        return "{" + ",".join(pairs) + "}"
    raise CanonicalizationError(f"Unsupported type: {type(obj)}")


def canonicalize(obj: Any) -> str:
    return _canonicalize_value(obj)


def content_hash(obj: Any) -> str:
    canonical = canonicalize(obj)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def bare_hash(obj: Any) -> str:
    """Return only the hex digest (64 chars)."""
    return content_hash(obj).split(":", 1)[1]


if __name__ == "__main__":
    sample = {"b": 2, "a": 1, "c": {"y": 0, "x": 9}}
    print(canonicalize(sample))
    print(content_hash(sample))
    # v0.1.3 regression anchors (must stay stable):
    # hash(sample) == sha256:01256f0fc91efe03bd146965e2be1d4c9eebb2916886f364e25a5462d3912651
