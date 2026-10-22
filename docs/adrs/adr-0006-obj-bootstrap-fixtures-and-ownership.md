# ADR 0006: OBJ bootstrap fixture and adapter ownership

- Status: Accepted
- Date: 2026-10-22
- Parent decision: [site ADR 0094](https://github.com/Plasius-LTD/plasius-ltd-site/blob/main/docs/adrs/adr-0094-gpu-model-family-and-canonical-proxy-conversion.md)
- Delivery: [site #1166](https://github.com/Plasius-LTD/plasius-ltd-site/issues/1166), [local #22](https://github.com/Plasius-LTD/gpu-model-obj/issues/22)
- Parent Feature: [site #1151](https://github.com/Plasius-LTD/plasius-ltd-site/issues/1151)

## Context

The schema-derived package baseline and released bootstrap metadata do not
provide an OBJ parser. The bootstrap deliverable also needs concrete fixtures
and scoped implementation work before the adapter can be built and qualified.

## Decision

Keep the existing public bootstrap exports unchanged. Store small synthetic
OBJ/MTL inputs, source hashes, rights and expected future outcomes in
`tests/fixtures/`. These files use the repository's Apache-2.0 license. Tests
verify the corpus facts and deliberately absent resources without loading any
external files or URLs. `adapterConformance: pending` prevents the manifest from
being mistaken for evidence of a working adapter.

Future parsing, material mapping, triangulation, smoothing and fidelity reporting
belong in this adapter. Reuse published `@plasius/gpu-model-core` canonical
contracts and `@plasius/gpu-model-runtime` source/resource orchestration when
implementation begins. Inspect their current APIs first; update their own
tracked packages before consuming any missing shared behavior. Do not copy
canonical schemas, resource loaders or diagnostics into this package.

Conversion remains source adapter -> canonical model -> target adapter. Strict
mode is the default; tolerant repair must be explicit and recorded; forensic
retains bounded evidence. Unsupported rigs, skins, animations and advanced
materials need loss reports. The bootstrap fixture notes are test requirements
for future work, not a new public diagnostic schema or full repair policy.

## Alternatives

Implementing the parser during bootstrap would merge separate acceptance scopes.
Reusing downloaded model assets would introduce unnecessary rights and resource
provenance work. Both are avoided by an authored, bounded corpus and separate
Project Tasks.

## Impact, validation and rollout

The manifest and semantic corpus tests run under the existing Vitest/CI command.
All authored inputs are at most 4 KiB. Missing-library and missing-texture cases
must stay missing. The npm `files: [dist]` allowlist keeps tests and fixtures out
of runtime artifacts; repository users can inspect the tagged sources.

No runtime API, dependency, evaluator or capability is introduced. The inherited
remote feature flag is `gpu.model.conversion.enabled`; its consuming product
feature owns evaluation. This bootstrap metadata is not an evaluator. Future
integration tests must exercise enabled, disabled and rollback paths at that
boundary. Rollback disables the consuming feature and pins its last validated
public package. Build-time or local environment values are not the production
control plane.

The ordinary `main` / `.github/workflows/cd.yml` / `production` OIDC release path
publishes a patch release and preserves exact-SHA CI checks. Fixture tests prove
corpus integrity only; parser/exporter round trips, renderer integration,
physical GPU checks and cross-format conformance remain future tracked work.
