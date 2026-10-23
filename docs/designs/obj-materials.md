# OBJ/MTL material implementation and validation plan

Project Task25; parent Feature1151; flag `gpu.model.conversion.enabled`.

## Contract and ownership

Reuse published @plasius/gpu-model-core0.7.0 and runtime0.3.2. Parser policy admits
and snapshots safe in-memory libraries. The material module scans bounded UTF8
records, maps diffuse/emissive/opacity, and uses core diagnostics/default repair.
Canonical projection verifies generated materials and actual geometry bytes.
Exporter maps canonical bindings to unique MTL tokens, stages actual paired bytes,
and reports unsupported semantics. The existing runtime bridge stays reference-only.
The README defines exact supported fields, ranges, defaults and error behaviour;
ADR0009 records alternatives and package boundaries.

## Requirements-derived tests

1. Authored multi-material fixture -> canonical -> actual OBJ/MTL -> canonical:
   names, factors, face bindings and geometry bytes match; repeated exports match.
2. Strict/tolerant/forensic duplicate/invalid data always blocks; missing binding
   repair only in tolerant/forensic with explicit loss consent and core rule.
3. Unknown/Phong/PBR/texture properties produce explicit loss; malformed recognized
   advanced numerics block even with consent; opacity/RGB shorthand are precise.
4. Snapshot/accessor/table/UTF8/line/input/output/material/diagnostic/abort/deadline
   boundaries fail closed without source values in reports or implicit fetch.
5. Actual paired targets and manifests agree, unresolved reference-only export is
   rejected, reset transitions and display-name collisions preserve binding identity.
6. Omitted options preserve previous reference-only behaviour and dual-module API.

## NFR and release checks

Run clean frozen install, full tests, LCOV (every changed source,80%+), strict
source and complete test-corpus types, lint/build/public-pack/artifact checks,
full audit/tree/signatures and publication dry-run. Qualify actual packed and
public ESM/CJS, strict declarations and browser execution. Record bounded workload
timings and ensure no added runtime dependency/control/secret/implicit I/O.
Accessibility/SEO/UI device interaction and backend secretRef are N/A; browser
portability remains applicable. Inspect final diff manually and any PR findings.
Only claim completion after pushCI, merge, pipeline-generated release metadata,
exact-main CI, actual approved productionCD, npm bytes/provenance and stable
release/tag identity are verified. Parent Feature1151 and coordinatorobj1 remain
incomplete; Tasks26–29 keep their independent acceptance/release requirements.
