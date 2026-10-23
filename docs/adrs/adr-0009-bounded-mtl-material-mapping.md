# ADR 0009: Bounded, explicit MTL material mapping

- Status: Accepted for Task25 implementation; completion still requires approved release evidence.
- Date: 2026-10-23
- Project: https://github.com/Plasius-LTD/gpu-model-obj/issues/25
- Parent Feature: https://github.com/Plasius-LTD/plasius-ltd-site/issues/1151
- Rollout flag: `gpu.model.conversion.enabled`; capability: none for package-only work.

## Context

The released triangle parser/exporter preserves inert names but has no material
definitions. The authored multi-material fixture must round-trip through actual
OBJ and MTL bytes with canonical diffuse values, names and face bindings. Core
0.7.0 already owns materials, byte verification, diagnostics and the registered
malformed-material-reference repair; runtime0.3.2 owns hashing. Reimplementing
those contracts or acquiring arbitrary paths in this adapter would cross the
approved package boundary.

The original Alias/Wavefront File Formats 4.2 (October1995) documents `newmtl`,
RGB shorthand, diffuse `Kd`, scalar dissolve `d` and richer lighting/resource
semantics: [archived primary specification](https://www.fileformat.info/format/material/).
This implementation uses a deliberately bounded diffuse profile. `Ke`/`Tr` are
explicit common extensions, not claimed as full original-spec conformance.

## Decision

Add an explicit caller-supplied in-memory library table to `parseObj`; omit the
table for backwards-compatible reference-only operation. Snapshot table bytes
before the first await, with aggregate size ceilings and a whole-operation clock
that starts before snapshotting. Interpret only referenced safe basenames.
Project Kd/Ke/opacity into published canonical materials with generated IDs and
real primitive materialId bindings. Preserve library hashes separately from the
OBJ source hash. Never perform implicit external I/O.

Reject duplicate/ambiguous/malformed data in every mode. Unsupported advanced
properties require explicit dropped-loss consent. Missing used definitions may
receive the core registered default-material repair only in tolerant/forensic
mode with consent; preserve unresolved references as asset metadata. Do not
invent a new evaluator or repair rule. Missing unused files have no appearance
repair. Texture-reference preservation remains separately tracked Task26.

Extend the return type of `exportObj` compatibly with optional actual MTL bytes
when `includeMaterials` is true. Keep the existing core target/output contract
and reference-only default. Stage both files before returning; manifests describe
the exact returned files. Preserve safe unique names; use deterministic unique
identifiers with explicit name-loss consent when MTL cannot preserve a display
name. Report canonical advanced semantics as approximation losses.

## Alternatives

- Implicit runtime/network resolver: rejected because it adds I/O and trust policy
  to the format parser and requires separate resource qualification.
- Replace core contracts or invent a repair rule: rejected; published core already
  covers material identity/default repair and diagnostic acceptance.
- Always load/export MTL: rejected because existing reference-only consumers have
  no supplied library bytes and would silently change behaviour.
- Full Phong/PBR/spectral/texture interpretation now: deferred to tracked fidelity
  and resource tasks; this profile reports losses rather than claiming fidelity.
- Manifest-only export: rejected because a descriptor is not evidence of bytes.

## Consequences and verification

No dependency/public package/site/configuration change is required. New options
and result fields are additive. Limits cover 128 materials,32 table entries,
4096-byte physical lines,64 aggregate diagnostics and8MiB aggregate input/output.
Cooperative checkpoints and deadlines bound operation duration; consumer workers
provide additional isolation. Reports never echo source names, paths or text.
Asset bytes/metadata intentionally retain names and require ordinary data hygiene.
Tests cover authored semantic round trip, deterministic bytes, every policy mode,
invalid numerics, duplicate/missing definitions, snapshot/privacy/abort/budgets,
paired targets and compatibility. Every changed source must appear in LCOV at
>=80%, and packed/public ESM/CJS/strict types/browser qualify the shipped artifact.

Release only via the existing two-phase `.github/workflows/cd.yml` on main with
the production environment, exact-main pushCI and OIDC guards. Pipeline owns
versioned changelog promotion. Rollback is consumer remote flag disable and pin
the prior qualified public0.3.0; no local env switch replaces the evaluator.
Backend secretRef checks/UI accessibility/SEO are N/A: this package-only change
adds no application, deployment, backend environment or visible UI.
