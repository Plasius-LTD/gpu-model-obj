# ADR0013: Canonical loss ledger for unsupported OBJ projections

Status: Accepted for Task29. Extends ADR0008's fidelity reporting; its rejection,
resource, target and output policies remain in force.

## Problem and decision

A generic unsupported diagnostic rejects dynamic canonical semantics safely but
does not identify which rig/skin/animation families cannot survive an OBJ target.
Reuse published core `GpuModelConversionIssue` / `ModelExportResult` ledgers;
retain `OBJ_EXPORT_UNSUPPORTED_DATA` and rejection in every mode/consent state.
After an unsupported projection rejects, append fixed aggregate dropped-loss
entries for skeletons/joints, skins, animation, blend shapes, analytic geometry
and canonical texture payloads. Paths are structural and contain no authored ID,
name or source value. Bound the ledger by semantic families, not entity counts.
Core's verified immutable document boundary and work ceilings remain authoritative.

Reuse the existing material-profile predicate for advanced semantics. A rejected
projection replaces any prospective per-material approximation entries with an
aggregate proposed dropped-material entry, including when geometry rejects after
material bytes were staged. Paired successful MTL retains its existing
per-material approximated entries and requires explicit loss consent in all modes.
Do not duplicate an existing material ledger or implement a private loss schema.
Forensic evidence stays numeric node/resource counts. No payload reads, external
I/O, logging, repair, new dependency or public export is needed to classify losses.

## Alternatives and fidelity

Silently dropping animation/skin or generating a static snapshot is rejected: a
snapshot needs a separately specified pose/time/baking contract. Generic rejection
alone cannot satisfy the explicit loss-report requirement. Broadening `allowLoss`
to disable unsupported guards would fabricate fidelity. The ledger is a proposed
projection, even when accepted=false; it never claims an actual write completed.

Repeated canonical exports are byte deterministic. Supported geometry/references
round-trip semantically; source spelling, instance hierarchy and provenance are
not exact round trips. Dynamic families reject without partial output/manifest.
Existing material approximation and reference-only omission remain explicit losses.

## Rollout, tests and release

Feature1151's remotely controlled `gpu.model.conversion.enabled` gates consumer
adoption, with unavailable/disabled skipping adoption and rollback disabling the
consumer path and pinning a validated public version. Fidelity safety is always
on; no package-local control service or capability is appropriate. This package
Task does not deploy the site or change backend env mappings (secretref N/A).

Requirements-derived tests fail first for missing rig/skin/animation/combined
entries. Use verified canonical skin buffers, all three modes, default/false/true
consent, combined semantics, safe messages, input immutability, no partial output,
existing material consent/positive geometry controls, and supplemental families.
Run full unit/coverage/strict-source-and-test/lint/build/pack/audit checks, require
all changed source in LCOV, verify pushed CI and exact-main CI, then use approved
main cd.yml/production OIDC publication. Verify actual npm bytes/provenance,
ESM/CJS/declarations and compatible public consumers before closing Task29.
