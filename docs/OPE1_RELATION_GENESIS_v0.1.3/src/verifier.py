"""
OPE-1 / RELATION-GENESIS v0.1.3
Fail-closed Independent Verifier — MANDATORY BLOCKS + CHAIN INTEGRITY.

Closed in v0.1.3 (defect registry of the independent audit):
- INT-001: header is REQUIRED (object with package_version, schema_version,
  canonicalization_version, all strings). Unknown package_version => REFUTED
  (fail-closed: this verifier only implements its own version).
- INT-002: provenance is REQUIRED (object with observation_ids: non-empty
  list of strings, history_head_sha256: string).
- INT-003: integrity.previous_package_sha256 is REQUIRED: either "genesis"
  (chain root marker) or 64-hex. Optional integrity.chain list is verified
  link by link (each entry: package_sha256 + previous_package_sha256;
  links must connect; first link's previous must equal the package's
  previous; last link's package_sha256 must equal the package's own hash).
- CAN-001/002/003 closed in canonical.py (see src/canonical.py).
- Duplicate JSON keys are REJECTED at load time (ambiguous JSON is refused).
- Adversarial semantics made explicit: a package whose hashes were recomputed
  by an attacker PASSES integrity (SHA is not a signature) — verdict stays
  UNKNOWN and the reason codes carry
  INTEGRITY_VERIFIED_NO_SIGNATURE_TRUST_LAYER (TRUST-001 stays a separate,
  not-implemented layer).

Breaking change vs v0.1.2 (intentional, fail-closed):
- v0.1.2-era packages without header/provenance/previous_package_sha256
  are now REFUTED with structure reason codes.

Standing rules:
- Invalid structure never raises; always returns controlled REFUTED.
- Generator G_R remains BLOCKED.
- Never returns MECHANICAL_NOVELTY_CONFIRMED.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

try:
    from .canonical import canonicalize, content_hash, bare_hash, CanonicalizationError
except ImportError:
    from canonical import canonicalize, content_hash, bare_hash, CanonicalizationError


VERSION = "0.1.3"
CHAIN_ROOT = "genesis"
HEX64 = set("0123456789abcdef")


def _is_hex64(s: str) -> bool:
    return isinstance(s, str) and len(s) == 64 and all(c in HEX64 for c in s.lower())


def _strip_sha(s: str) -> str:
    if isinstance(s, str) and s.startswith("sha256:"):
        return s[7:]
    return s


def _no_duplicate_keys(pairs):
    seen = set()
    obj = {}
    for k, v in pairs:
        if k in seen:
            raise ValueError(f"duplicate JSON key: {k}")
        seen.add(k)
        obj[k] = v
    return obj


def check_structure(package: Any) -> list[str]:
    errors = []
    if not isinstance(package, dict):
        return ["structure: package must be an object"]

    required_top = ["header", "relation", "transformation", "evidence", "provenance", "integrity"]
    for k in required_top:
        if k not in package:
            errors.append(f"structure: missing mandatory block: {k}")

    for block in required_top:
        if block in package and package[block] is not None and not isinstance(package[block], dict):
            errors.append(f"structure: '{block}' must be an object, got {type(package[block]).__name__}")

    header = package.get("header")
    if isinstance(header, dict):
        for f in ("package_version", "schema_version", "canonicalization_version"):
            if not isinstance(header.get(f), str) or not header.get(f):
                errors.append(f"structure: header.{f} must be a non-empty string")

    rel = package.get("relation")
    if isinstance(rel, dict):
        if "structure" in rel and not isinstance(rel["structure"], dict):
            errors.append("structure: relation.structure must be an object")
        if "semantics" in rel and not isinstance(rel["semantics"], dict):
            errors.append("structure: relation.semantics must be an object")

    trans = package.get("transformation")
    if isinstance(trans, dict):
        runtime = trans.get("runtime")
        if runtime is not None and not isinstance(runtime, dict):
            errors.append("structure: transformation.runtime must be an object")

    prov = package.get("provenance")
    if isinstance(prov, dict):
        obs = prov.get("observation_ids")
        if not isinstance(obs, list) or not obs or not all(isinstance(o, str) and o for o in obs):
            errors.append("structure: provenance.observation_ids must be a non-empty list of strings")
        if not isinstance(prov.get("history_head_sha256"), str):
            errors.append("structure: provenance.history_head_sha256 must be a string")

    return errors


def compute_package_body_hash(package: dict) -> str:
    """
    Hash everything except the integrity block itself.
    This is the root integrity value.
    """
    body = {k: v for k, v in package.items() if k != "integrity"}
    return bare_hash(body)


def check_hashes(package: dict) -> list[str]:
    errors = []
    try:
        integrity = package.get("integrity")
        if not isinstance(integrity, dict):
            errors.append("integrity: missing or not an object")
            return errors

        claimed = integrity.get("package_sha256")
        if not claimed or not isinstance(claimed, str):
            errors.append("integrity: package_sha256 missing or not a string")
            return errors

        claimed_hex = _strip_sha(claimed)
        if not _is_hex64(claimed_hex):
            errors.append("integrity: package_sha256 is not valid 64-hex")
            return errors

        recomputed = compute_package_body_hash(package)
        if claimed_hex.lower() != recomputed.lower():
            errors.append(
                f"integrity: package_sha256 mismatch "
                f"(claimed={claimed_hex[:16]}… recomputed={recomputed[:16]}…)"
            )

        # INT-003: previous_package_sha256 mandatory
        prev = integrity.get("previous_package_sha256")
        if not isinstance(prev, str) or not prev:
            errors.append("integrity: previous_package_sha256 missing")
        elif prev != CHAIN_ROOT and not _is_hex64(_strip_sha(prev)):
            errors.append("integrity: previous_package_sha256 is neither 'genesis' nor 64-hex")

        # Optional explicit chain
        chain = integrity.get("chain")
        if chain is not None:
            if not isinstance(chain, list) or not all(isinstance(e, dict) for e in chain):
                errors.append("integrity: chain must be a list of objects")
            else:
                prev_expected = _strip_sha(prev)
                for i, link in enumerate(chain):
                    lp = _strip_sha(link.get("previous_package_sha256"))
                    if not isinstance(lp, str) or lp.lower() != str(prev_expected).lower():
                        errors.append(
                            f"integrity: chain link {i} broken "
                            f"(expected previous={str(prev_expected)[:16]}…, got {str(lp)[:16]}…)"
                        )
                        break
                    lk = _strip_sha(link.get("package_sha256", ""))
                    if not _is_hex64(lk):
                        errors.append(f"integrity: chain link {i} package_sha256 not valid 64-hex")
                        break
                    prev_expected = lk
                else:
                    if chain and str(prev_expected).lower() != claimed_hex.lower():
                        errors.append(
                            "integrity: chain last link does not connect to this package"
                        )
    except CanonicalizationError as e:
        errors.append(f"integrity: canonicalization failed: {e}")
    except Exception as e:
        errors.append(f"integrity: unexpected error: {type(e).__name__}: {e}")
    return errors


def check_version(package: dict) -> list[str]:
    header = package.get("header")
    if isinstance(header, dict):
        pv = header.get("package_version")
        if isinstance(pv, str) and pv != VERSION:
            errors = [f"header: package_version {pv} not implemented by verifier {VERSION} (fail-closed)"]
            return errors
    return []


def check_leakage(package: dict) -> list[str]:
    errors = []
    try:
        text_blob = json.dumps(package, ensure_ascii=False).lower()
    except Exception:
        return ["leakage: cannot serialize package for inspection"]

    leakage_markers = [
        "expected_relation",
        "correct_mapping",
        "hidden_answer",
        "the_relation_is",
        "target_structure",
        "planted_solution",
    ]
    for marker in leakage_markers:
        if marker in text_blob:
            errors.append(f"leakage marker found: {marker}")

    rel = package.get("relation") if isinstance(package.get("relation"), dict) else {}
    semantics = rel.get("semantics") if isinstance(rel.get("semantics"), dict) else {}
    desc = str(semantics.get("description", "")).lower()
    if "mapping:" in desc or "relation =" in desc:
        errors.append("possible pre-written mapping in semantics.description")

    return errors


def check_composition_signals(package: dict) -> list[str]:
    errors = []
    known_ops = {
        "copy", "identity", "passthrough", "rename", "compose",
        "sequence", "map", "filter", "reduce", "noop"
    }
    trans = package.get("transformation") if isinstance(package.get("transformation"), dict) else {}
    runtime = trans.get("runtime") if isinstance(trans.get("runtime"), dict) else {}
    entry = str(runtime.get("entrypoint", "")).lower()
    for op in known_ops:
        if op in entry:
            errors.append(f"transformation entrypoint suggests known operation: {op}")
    return errors


def verify_package(package: Any) -> dict:
    """
    Fail-closed. Never raises. Always returns a verdict dict.
    """
    try:
        reasons = []
        reasons.extend(check_structure(package))

        # Only run deeper checks if top-level structure is an object
        if isinstance(package, dict):
            reasons.extend(check_hashes(package))
            reasons.extend(check_version(package))
            reasons.extend(check_leakage(package))
            reasons.extend(check_composition_signals(package))

        if reasons:
            return {
                "verdict": "REFUTED",
                "reason_codes": reasons,
                "version": VERSION,
                "note": "Generator is blocked. Mandatory-blocks + chain-integrity negative-test verifier."
            }

        return {
            "verdict": "UNKNOWN",
            "reason_codes": [
                "NOVELTY_CONFIRMATION_DISABLED_IN_V0_1",
                "INTEGRITY_VERIFIED_NO_SIGNATURE_TRUST_LAYER",
            ],
            "version": VERSION,
            "note": "Integrity, chain format and mandatory blocks verified. "
                    "SHA is not a signature: trust layer (TRUST-001) is separate and not implemented. "
                    "Novelty confirmation remains forbidden."
        }
    except Exception as e:
        return {
            "verdict": "REFUTED",
            "reason_codes": [f"verifier_internal_error: {type(e).__name__}: {e}"],
            "version": VERSION,
            "note": "Unexpected exception caught and converted to REFUTED (fail-closed)."
        }


def load_json_strict(text: str) -> Any:
    return json.loads(text, object_pairs_hook=_no_duplicate_keys)


def verify_file(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as f:
            package = load_json_strict(f.read())
    except json.JSONDecodeError as e:
        return {
            "verdict": "REFUTED",
            "reason_codes": [f"invalid_json: {e}"],
            "version": VERSION,
            "note": "JSON parse failure."
        }
    except ValueError as e:
        # includes duplicate-key rejection
        return {
            "verdict": "REFUTED",
            "reason_codes": [f"ambiguous_json: {e}"],
            "version": VERSION,
            "note": "Ambiguous or duplicate-keyed JSON is rejected."
        }
    except Exception as e:
        return {
            "verdict": "REFUTED",
            "reason_codes": [f"load_error: {type(e).__name__}: {e}"],
            "version": VERSION,
            "note": "File load failure."
        }
    return verify_package(package)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m src.verifier <package.json>")
        print("   or: python src/verifier.py <package.json>")
        sys.exit(1)
    result = verify_file(Path(sys.argv[1]))
    print(json.dumps(result, indent=2, ensure_ascii=False))
