# Canonical OBJ parser — Task #23

The problem, alternatives, contracts, source assumptions, budgets, NFR checks and
release route are defined in [ADR-0007](../adrs/adr-0007-bounded-canonical-obj-parser.md).

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Canonical geometry and independent indices | `parser.ts`, `canonical.ts` | Authored baseline, UV/normal seam and negative-index tests; actual little-endian resource bytes and validated bounds |
| Object/group/material/library references | Primitive/document metadata; zero resolution | Metadata and no-fetch tests; material mapping/resources remain #25/#26 |
| Strict/tolerant/forensic policy | Core result factory, paired repair/loss records | Malformed-index fixture; mode matrix and explicit loss-consent tests |
| Bounded work and evidence | `policy.ts`; incremental parse/packing checkpoints | Every ceiling, diagnostic overflow, long Unicode lines, abort/deadline and numeric-only forensic tests |
| Public reuse and orchestration | Published core/runtime dependencies and runtime acquisition bridge | Runtime integration, packed/public ESM/CJS and browser consumer checks |
| Reproducibility and maintainability | Small parsing/projection/policy/bridge modules | Clean locked install, types/lint/build, tests/LCOV, artifact policy and dependency audit |

Triangle faces are the parser's initial supported profile; unimplemented polygon
and advanced features fail explicitly. Delivery of #23 does not complete #1 or
Feature #1151 and does not close any Task #24–29.

The final issue evidence comment records exact source/release revisions,
commands, timestamps, NFR results, PR/CI/CD and npm artifact verification.
