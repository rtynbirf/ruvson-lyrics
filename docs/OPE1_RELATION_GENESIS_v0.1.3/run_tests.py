#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""OPE-1 v0.1.3 — независимый набор векторных тестов канонизации (RFC 8785 подмножество)
+ регрессия совместимости с протоколом аудита v0.1.0.
Запуск: python3 run_tests.py"""
import json, os, subprocess, sys
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE))
from src.canonical import canonicalize, content_hash, CanonicalizationError  # noqa: E402
from src import verifier as V  # noqa: E402

FAILED = []


def check(name, cond):
    print(("PASS" if cond else "FAIL"), name)
    if not cond:
        FAILED.append(name)


# ---------- канонизация ----------
check("canon: empty object", canonicalize({}) == "{}")
check("canon: nested int sample sorted", canonicalize({"b": 2, "a": 1, "c": {"y": 0, "x": 9}}) == '{"a":1,"b":2,"c":{"x":9,"y":0}}')
check("canon: RFC8785 anchor hash (v0.1.0 audit protocol)",
      content_hash({"a": 1, "b": 2, "c": {"x": 9, "y": 0}}) ==
      "sha256:01256f0fc91efe03bd146965e2be1d4c9eebb2916886f364e25a5462d3912651")
check("canon: escaping quotes/backslash", canonicalize('a"b\\c') == '"a\\"b\\\\c"')
check("canon: short escapes", canonicalize("\b\t\n\f\r") == '"\\b\\t\\n\\f\\r"')
check("canon: control U+0001 escaped lowercase", canonicalize("a\x01b") == '"a\\u0001b"')
check("canon: U+001F escaped", canonicalize("\x1f") == '"\\u001f"')
check("canon: bool/null", canonicalize([True, False, None]) == "[true,false,null]")
check("canon: I-JSON max int ok", canonicalize(9007199254740991) == "9007199254740991")
try:
    canonicalize(9007199254740992); ok = False
except CanonicalizationError:
    ok = True
check("canon: I-JSON overflow rejected", ok)
try:
    canonicalize(-9007199254740992); ok = False
except CanonicalizationError:
    ok = True
check("canon: I-JSON underflow rejected", ok)
try:
    canonicalize(1.5); ok = False
except CanonicalizationError:
    ok = True
check("canon: float rejected (as before)", ok)
try:
    canonicalize("\ud800"); ok = False
except CanonicalizationError:
    ok = True
check("canon: lone surrogate rejected", ok)
# UTF-16 порядок: supplementary-plane ключ раньше BMP-ключа в диапазоне E000–FFFF
u16 = canonicalize({"𐍈": 2, "\ufffd": 1})
check("canon: UTF-16 key order (RFC 8785)", u16 == '{"𐍈":2,"\ufffd":1}')
check("canon: utf16 order differs from codepoint order (regression guard)",
      '{"𐍈":2,"\ufffd":1}' != json.dumps({"\ufffd": 1, "𐍈": 2}, sort_keys=True, ensure_ascii=False, separators=(",", ":")))

# ---------- верификатор ----------
def run_case(rel):
    r = V.verify_file(Path(os.path.join(HERE, rel)))
    return r["verdict"], r["reason_codes"]

EXPECT = [
    ("tests/cases/integrity/clean_v013.json", "UNKNOWN", ["NOVELTY_CONFIRMATION_DISABLED_IN_V0_1", "INTEGRITY_VERIFIED_NO_SIGNATURE_TRUST_LAYER"]),
    ("tests/cases/integrity/removed_header.json", "REFUTED", "structure: missing mandatory block: header"),
    ("tests/cases/integrity/removed_provenance.json", "REFUTED", "structure: missing mandatory block: provenance"),
    ("tests/cases/integrity/removed_previous.json", "REFUTED", "integrity: previous_package_sha256 missing"),
    ("tests/cases/integrity/bad_previous_format.json", "REFUTED", "integrity: previous_package_sha256 is neither 'genesis' nor 64-hex"),
    ("tests/cases/integrity/chain_ok.json", "UNKNOWN", "NOVELTY_CONFIRMATION_DISABLED_IN_V0_1"),
    ("tests/cases/integrity/chain_broken.json", "REFUTED", "integrity: chain link 1 broken"),
    ("tests/cases/integrity/chain_last_mismatch.json", "REFUTED", "integrity: chain last link does not connect to this package"),
    ("tests/cases/integrity/attacker_rehashed.json", "UNKNOWN", "INTEGRITY_VERIFIED_NO_SIGNATURE_TRUST_LAYER"),
    ("tests/cases/integrity/duplicate_keys.json", "REFUTED", "duplicate JSON key"),
    ("tests/cases/integrity/legacy_v012_package.json", "REFUTED", "structure: missing mandatory block: header"),
    ("tests/cases/integrity/unknown_package_version.json", "REFUTED", "header: package_version 9.9.9 not implemented by verifier 0.1.3 (fail-closed)"),
    ("tests/cases/canon/control_char.json", "UNKNOWN", "NOVELTY_CONFIRMATION_DISABLED_IN_V0_1"),
    ("tests/cases/canon/unescaped_control.json", "REFUTED", "integrity: package_sha256 mismatch"),
    ("tests/cases/canon/big_int.json", "REFUTED", "integrity: canonicalization failed"),
    ("tests/cases/canon/float_rejected.json", "REFUTED", "integrity: canonicalization failed"),
    ("tests/cases/leakage/example_leak.json", "REFUTED", "leakage marker"),
    ("tests/cases/noise/example_noise.json", "REFUTED", "suggests known operation"),
]
for rel, verdict, reason in EXPECT:
    v, reasons = run_case(rel)
    dump = json.dumps(reasons, ensure_ascii=False)
    ok_reason = all(r in dump for r in reason) if isinstance(reason, list) else (reason in dump)
    ok = (v == verdict) and ok_reason
    check(f"verifier: {os.path.basename(rel)} -> {verdict}", ok)

# тип-атака: пакет не объект
v = V.verify_package("not-an-object")
check("verifier: non-object package -> REFUTED, no crash", v["verdict"] == "REFUTED")
v = V.verify_package({"header": {"package_version": V.VERSION, "schema_version": "1.0.0", "canonicalization_version": "x"}, "relation": "str", "transformation": {"runtime": {"entrypoint": "sandbox_op_alpha"}}, "evidence": {"verdict": "UNVERIFIED"}, "provenance": {"observation_ids": ["obs:aaa1"], "history_head_sha256": "x"}, "integrity": {"package_sha256": "sha256:" + "0" * 64, "previous_package_sha256": "genesis"}})
check("verifier: relation as string -> REFUTED, no crash", v["verdict"] == "REFUTED")

# запрет новизны навсегда
check("verdict: MECHANICAL_NOVELTY_CONFIRMED never returned",
      all(V.verify_file(os.path.join(HERE, rel))["verdict"] != "MECHANICAL_NOVELTY_CONFIRMED"
          for rel, _, _ in EXPECT))

print()
if FAILED:
    print("FAILED:", len(FAILED));  sys.exit(1)
print("ALL TESTS PASSED")
