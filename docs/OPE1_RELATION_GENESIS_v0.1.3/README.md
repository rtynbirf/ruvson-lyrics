# OPE-1 / RELATION-GENESIS v0.1.3

**Status: PROTOTYPE — Verifier only. Generator G_R is BLOCKED.**
**Max verdict: UNKNOWN. `MECHANICAL_NOVELTY_CONFIRMED` is unreachable in this version.**

## Closed in v0.1.3 (defect registry INT/CAN of the independent audit)

| ID | Defect | Fix |
|----|--------|-----|
| INT-001 | header not required | `header` mandatory: `package_version` (must equal `0.1.3`, fail-closed), `schema_version`, `canonicalization_version` |
| INT-002 | provenance not required | `provenance` mandatory: `observation_ids` (non-empty string list), `history_head_sha256` |
| INT-003 | chain not checked | `previous_package_sha256` mandatory (`genesis` or 64-hex); optional `integrity.chain` verified link-by-link, lineage includes the package itself as the last link |
| CAN-001 | control chars not fully escaped | full U+0000–U+001F escaping (`\u00xx` lowercase, short forms preserved); lone surrogates REJECTED |
| CAN-002 | no I-JSON integer bound | `|n| <= 2^53-1` enforced, overflow REJECTED |
| CAN-003 | no UTF-16 key sort | keys sorted by UTF-16 code units (RFC 8785); test proves supplementary-vs-high-BMP order switch |
| (new) | ambiguous JSON accepted | duplicate JSON keys REJECTED at load time |
| (new) | attacker-rehash semantics implicit | explicit: integrity passes → verdict stays UNKNOWN with `INTEGRITY_VERIFIED_NO_SIGNATURE_TRUST_LAYER` (SHA is not a signature; TRUST-001 stays a separate, unimplemented layer) |

**Breaking change (intentional, fail-closed):** v0.1.2-era packages without
`header` / `provenance` / `previous_package_sha256` are now REFUTED
(`tests/cases/integrity/legacy_v012_package.json`).

## Quick start

```bash
cd ope1-relation-genesis
python3 run_tests.py            # 36 векторных/атакующих проверок, exit 0
python -m src.canonical
python -m src.verifier tests/cases/integrity/clean_v013.json        # → UNKNOWN
python -m src.verifier tests/cases/integrity/removed_header.json    # → REFUTED (INT-001)
python -m src.verifier tests/cases/integrity/attacker_rehashed.json # → UNKNOWN (SHA ≠ подпись)
python -m src.verifier tests/cases/integrity/chain_broken.json      # → REFUTED (INT-003)
python -m src.verifier tests/cases/canon/unescaped_control.json     # → REFUTED (CAN-001 legacy hash)
```

## Expected results (36 checks)

| Group | Cases | Expected |
|-------|-------|----------|
| canon vectors (15) | RFC 8785 subset anchor `01256f0f…` (совместимость с протоколом аудита v0.1.0), escapes, I-JSON bounds, UTF-16 order, surrogates, floats | PASS |
| integrity (16) | clean → UNKNOWN; removed header/provenance/previous; bad previous format; chain ok/broken/last-mismatch; attacker-rehashed → UNKNOWN (trust explicit); duplicate keys; legacy v0.1.2 → REFUTED; unknown version → REFUTED | PASS |
| canon-in-package (4) | control char escaped → UNKNOWN; legacy raw-byte hash → REFUTED; big int / float → REFUTED (canonicalization failed) | PASS |
| old negative cases | leakage / noise | REFUTED |

## Design principle

Integrity, Provenance and Trust are distinct mechanisms.
v0.1.3 closes the Integrity gap and makes the Trust gap explicit instead of hiding it.
Novelty confirmation remains forbidden. Generator G_R remains blocked.

## Roadmap (unchanged priority by the independent auditor)

| Version | Result |
|---------|--------|
| v0.1.0–v0.1.2 | prototype, partial integrity, root hash |
| **v0.1.3** | **mandatory blocks, chain, canon hardening (this release)** |
| v0.2.0 | Adversarial Noise / Leakage (statistical, not name-heuristics) |
| v0.3.0 | Independent replication |
| v0.4.0 | Composition control with explicit bound |
| v0.5.0 | Generator G_R admission |
