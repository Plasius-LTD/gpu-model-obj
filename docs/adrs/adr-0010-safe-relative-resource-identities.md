# ADR0010: Explicit safe relative OBJ/MTL resource identities

- Status: Accepted; release completion requires Task26's CI/CD/public evidence.
- Date: 2026-10-23
- Project: https://github.com/Plasius-LTD/gpu-model-obj/issues/26
- Parent Feature: https://github.com/Plasius-LTD/plasius-ltd-site/issues/1151
- Rollout: `gpu.model.conversion.enabled`; no capability for package-only work.

## Problem and existing package ownership

The released diffuse MTL profile retains basename libraries but drops texture
map identities. Runtime0.3.2 already owns resource acquisition, hashing and
caller-approved resolver ports; core0.7.0 owns immutable metadata, diagnostics,
registered missing-texture repair and directory manifests. Core's image
resources and resource graph require actual verified image payloads; an absent
or undecoded external texture must never be mislabeled as a verified image.

## Decision

Add an explicit `resources` parse option. Presence preserves bounded inert
identities; only an injected runtime ResourceResolver grants related-resource
reads. The runtime adapter separately requires `resolveResources: true` before
forwarding its acquisition resolver. Keep the default0.4.0 parsing profile.
Validate a conservative ASCII relative-path grammar before any port call;
reject traversal/absolute/scheme/encoding ambiguity rather than normalize it.
Snapshot tables/methods, acquire sequentially once per identity, enforce total
bytes/counts/deadline/cancellation, and compare the actual SHA-256. Providers
must enforce byte limits during I/O and honor the supplied signal. No retries.

Preserve package-root path/role/status/hash as canonical document metadata,
and map slot/path/library ownership as material sourceMetadata. Missing paths
retain identities with core's existing repair/consent rules; observed image
bytes remain external. An available status attests bytes/hash only. Emit fixed
warnings for undecoded reference-only images. Never expose port exceptions or
authored paths in diagnostic reports. Asset metadata intentionally retains names.

Paired export preserves declared library paths and actual multiple MTL files.
Map paths are rebased only within their declaring directory, with no upward
traversal. Return a directory manifest for external texture identities, not a
pretend archive or texture payload. Validate all caller-created source metadata
and stage output atomically. Keep the single-file convenience and old generated
model.mtl behavior for the pre-resource material profile.

## Alternatives

- Ambient network/filesystem reads: rejected; bypasses caller acquisition policy.
- New resolver/hash/diagnostic framework: rejected; reuse published contracts.
- Fabricated image resources for missing/undecoded textures: rejected; core's
  verified resource brand requires actual image validation.
- Decode/embed/render images now: outside Task26's reference-preservation scope;
  requires separately tracked fidelity/decoder/budget qualification.
- Normalize `..`, URLs or arbitrary map options: rejected by this bounded profile;
  ambiguous path/options semantics need a separately qualified extension.
- Collapse every MTL to model.mtl: rejected for this profile because doing so
  loses library identities and changes texture lookup bases.

## Impact and verification

No dependency, site, workflow, secret, publisher setting or rollout evaluator
changes. API additions are opt-in and old exports remain compatible. Tests cover
missing fixtures, quoted/escaped spaces, zero implicit I/O, traversal/schemes,
port/result validation, abort/deadline, budgets, metadata forgery, multiple-file
identity round trip, deterministic output and public ESM/CJS/browser types.
All touched runtime files must appear in combined LCOV with >=80% line coverage.
UI/accessibility/SEO/backend secretRef controls are N/A for a package-only change.

Release only through the existing release-prepare PR and main/production cd.yml
OIDC flow with genuine exact-main pushCI. Verify registry bytes/provenance and
actual consumers. Roll back by disabling the consumer's existing remote
`gpu.model.conversion.enabled` evaluator and pinning qualified public0.4.0;
no local env override replaces the control plane.
