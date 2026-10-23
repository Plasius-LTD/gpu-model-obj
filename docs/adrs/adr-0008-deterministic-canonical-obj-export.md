# ADR-0008: Deterministic canonical OBJ triangle export

Status: Accepted for [Task #24](https://github.com/Plasius-LTD/gpu-model-obj/issues/24)

## Context

Feature site#1151 requires deterministic OBJ output from canonical geometry. Task23
released the triangle parser. Format ownership belongs here; canonical documents,
resource attestation, target descriptors and diagnostic policy already belong to
published `@plasius/gpu-model-core@0.7.0`. Runtime acquisition/orchestration remains
in `@plasius/gpu-model-runtime@0.3.2`. No new dependency is needed.

## Decision

Add `exportObj(document, target, options)` with core's adapter export signature and
`ModelExportResult`. Accept only documents branded by this installed core instance;
shape copies and structured clones must first re-enter core verification. Targets
are `uint8-array`, `array-buffer`, or `blob`. Return a core inline manifest describing
one `model.obj` mesh entry (`text/plain`); a safe basename on a Blob target changes
only the manifest path. No filesystem/network/stream writes, archive construction,
resource resolution or automatic promotion takes place. Expose supported target
kinds explicitly. A full core adapter can compose this export function; it does
not replace the existing runtime acquisition bridge.

Traverse canonical roots, children and primitive arrays in semantic order. Expand
mesh instances into world-space triangle corners. Bake affine transforms into
positions and inverse-transpose transforms into normals; reverse the last two
corners for a reflected basis. Keep normal magnitude after inverse transpose;
consumers may normalize directions. Reject singular or nonfinite transforms,
nonfinite f32 results and nonzero component underflow. Export f32 POSITION/NORMAL
and TEXCOORD_0, including interleaved accessors and optional u8/u16/u32 indices.
Other component profiles, attributes and topologies fail explicitly.

Use LF, a fixed header, and JavaScript's locale-independent shortest round-trip
number spelling for the resulting f32 values; canonicalize negative zero. Maintain
independent positive one-based position/UV/normal tables, deduplicating identical
numeric tuples in first-use order. There is no locale, wall-clock time, random ID,
provider path, dependency iteration-order sort or configurable lossy precision.
The result is a world-space triangle representation, not preservation of source
vertex numbering, mesh instancing, provenance or arbitrary extension metadata.

Preserve primitive `objectName`, `groups`, `materialName`, `smoothing` metadata and
document `materialLibraries` as inert references. Object fallback is node name,
mesh name, then canonical node ID. Emit explicit group/smoothing state for every
primitive, and `usemtl off` when clearing a previous material reference. On import,
this parser retains `off` as inert metadata; it does not bind a material named off.
Canonical material binding IDs take precedence over inert source hints; display
names are not used as IDs because they need not be unique. No MTL or
texture file is included. Any canonical material definitions cause one explicit
`dropped` loss, requiring `allowLoss: true` even in strict mode. Task25 owns actual
MTL mapping; Task26 owns related-resource resolution. Rigs, skins, blend shapes,
animations, textures and analytic geometry are rejected in every mode, including
when loss is allowed. Task29 owns the broader fidelity conversion policy.

Reference validation rejects empty/oversized names, unsupported controls/bidi
controls, comments, backslashes and boundary whitespace. Group/library tokens
cannot contain whitespace; group records remain within the parser's combined
256-character profile. Names are deliberately preserved in returned asset bytes,
never in diagnostics. Output is an asset, not safe telemetry or HTML content.

## Bounds and failures

Hard tighten-only limits: 16 MiB aggregate input resource payload, 32 resources,
512 accessors, 4096 nodes, 128 emitted primitive instances, 300,000 output corners,
100,000 combined unique v/vt/vn records and 8 MiB UTF-8 output. Ceilings align with
the parser's admitted triangle profile. AbortSignal and 1–30,000 ms whole-operation
deadlines apply; resource reads race cancellation/deadline and clean up listeners
and timers. Processing yields per primitive and every 128 triangles. Final bounded
encoding is synchronous; caller workers/concurrency policy provide isolation.
No retry, global cache, background queue or detached write survives completion.

Malformed options/targets/unverified inputs and resource/abort/deadline failures
throw fixed `ObjExportError` codes without causes or authored values. Unsupported
data/budget exhaustion returns core's rejected report with no output/manifest.
Forensic evidence contains only numeric node/resource counts. Output is staged
until all geometry and references pass; failures never expose partial bytes.

## Alternatives and impact

- Reject a private export target/result or resource schema: reuse core contracts.
- Defer an implicit file/stream writer: it would introduce authorization, partial
  write and commit semantics outside this pure package's ownership.
- Reject a fixed decimal rounding knob: it would silently lose f32 information.
- Bake transforms rather than silently dropping them; OBJ cannot encode the
  canonical scene graph. Reject unrepresentable dynamic data instead of exporting
  an apparently complete static snapshot.
- Preserve first-use array order rather than sorting semantic scene arrays.

The API is additive; all parser/bootstrap exports stay compatible. Dependency
versions and lockfile are unchanged. No runtime feature service is introduced.
The consuming evaluator owns `gpu.model.conversion.enabled`: disabled or rollback
consumers skip conversion and pin the last validated public package. No local
runtime environment override replaces the remote evaluator. No capability is
needed for this package-only layer.

## Verification and release

Tests cover byte equality, parse/export/reimport geometry and reference semantics,
independent attribute indices, indexed/interleaved resources, hierarchy/reflection,
core registry/manifest integration, target validation, consent and all failure
boundaries. Every changed source must appear in combined LCOV at >=80%. Run clean
install, complete tests, strict source and test typecheck, lint/build/pack/artifact
policy, dependency audit/signatures, actual ESM/CJS installed consumers and a real
browser bundle. Keep initial fail-first evidence with delivery records.

Use reviewed PR and successful CI, permitted merge, exact-main push CI, then
existing main `cd.yml` / `production` / npm trusted publishing for an additive
minor release. The pipeline alone prepares versions and promotes Unreleased.
Verify actual registry bytes, SLSA/production provenance, release tag and installed
consumers before Task24 is Done. Site adoption/release, backend secretrefs,
accessibility/SEO/entitlements are N/A: no site/UI/backend changes occur here.
