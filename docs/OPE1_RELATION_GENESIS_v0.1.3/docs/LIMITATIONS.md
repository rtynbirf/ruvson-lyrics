# LIMITATIONS — OPE-1 / RELATION-GENESIS v0.1.3

Closed in v0.1.3:
- Mandatory blocks (header, provenance) — INT-001/INT-002.
- previous_package_sha256 + optional chain verification — INT-003.
- Control-char escaping, I-JSON integer bound, UTF-16 key order — CAN-001/002/003.
- Duplicate JSON keys rejected.
- Attacker-rehash semantics explicit (UNKNOWN + trust-layer reason code).

Still open (honest registry):
1. Not full JCS: floats rejected; full ES6/RFC 8785 number serialization pending.
2. No novelty confirmation. Max verdict = UNKNOWN.
3. Generator G_R blocked.
4. Composition check is still name-heuristic only (v0.4.0 scope).
5. Noise detection is not statistical yet (v0.2.0 scope).
6. TRUST-001: no signatures — SHA proves integrity against the recorded value,
   NOT authorship or truth of observations. INTEGRITY_VERIFIED_NO_SIGNATURE_TRUST_LAYER
   is carried in every UNKNOWN verdict.
7. Chain semantics = design (b): lineage includes the current package as last link.
8. Breaking change vs v0.1.2: legacy packages without mandatory blocks are REFUTED.
