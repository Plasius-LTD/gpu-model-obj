# ADR-0007: Bounded canonical OBJ triangle import

Status: Accepted for Task [#23](https://github.com/Plasius-LTD/gpu-model-obj/issues/23)

## Context

Feature site#1151 needs OBJ conversion without transferring format ownership to
the site or renderer. Bootstrap metadata and fixtures alone cannot load a model.
The original [Wavefront OBJ specification](https://paulbourke.net/dataformats/obj/obj_spec.pdf)
defines independent position, texture and normal indices, including negative
indices relative to the records available at the face. Canonical documents,
resource verification and diagnostic policy already exist in published packages.

## Decision

Add `parseObj(bytes, options)` returning core's `ModelLoadResult`, and
`createObjRuntimeAdapter(options)` implementing runtime's acquisition port.
Use exact registry dependencies `@plasius/gpu-model-core@0.7.0` and
`@plasius/gpu-model-runtime@0.3.2`; neither was previously a dependency. Both
support Node 24 and browser Web APIs. Runtime's transitive core 0.6.0 remains its
type-only contract dependency; runtime does not validate or rebrand documents.
Canonical construction and validation use our direct core 0.7.0 instance.
The package adds no replacement document, diagnostics, resolver or cache schema.

The first profile supports triangular faces with consistent corner attributes.
Expand corners into non-indexed little-endian f32 accessors to preserve independent
UV/normal indices. Partition contiguous faces by object/group/material/smoothing
identity and attribute presence; retain source face order across transitions.
Preserve authored normals; do not generate missing values.
Retain object/group/material/library/smoothing names as inert canonical metadata.
Do not resolve libraries, bind materials, fetch textures or claim export support.
Unsupported records and polygons fail with explicit diagnostics. Tasks #24–29
own the remaining exporter, MTL, resource, polygon, smoothing and loss work.

OBJ has no source unit/axis declaration. This profile assumes coordinates already
use metres, Y up and a right-handed basis, retaining the authored origin. Record
the unitless source and this assumption in metadata. This is not proof of the
separate floor-centred static-demo profile: consumers requiring it must apply
and validate their explicit normalization policy. Values use f32 rounding;
non-finite and nonzero-to-zero underflow values are rejected. Vertex colours,
non-unit homogeneous weights and non-two-component UV records are unsupported.

Copy admitted bytes before asynchronous work and bind provenance to their SHA256.
Use core verification to attest generated buffer bytes and validate the complete
document, including actual accessor and scene bounds. Parsing yields every 128
lines; output packing yields every 4096 values. Check cancellation and the whole
operation deadline before/after hashing, projection and canonical validation.
Core's synchronous validation is bounded by the parser's output ceilings; it
cannot be preempted mid-call. Applications requiring execution isolation must
run their own worker boundary. The runtime bridge advertises no supplied worker.

## Failure, budgets and privacy

Strict rejects invalid references. Tolerant/forensic stage the documented core
`invalid-indices` whole-face drop, record a matching `dropped` loss, and require
explicit `allowLoss: true` for acceptance. No index clamping, silent loss or
source-array compaction is allowed. Malformed source elements block the import.
All rejected results omit the document; core validation/environment failures
throw a fixed `ObjImportError`. No failed partial document is returned.

Hard tighten-only ceilings: 8 MiB input, 4096 UTF-8 bytes/line, 100,000 combined
source elements, 100,000 faces, 300,000 expanded output vertices, 128 primitive
groups, 32 library references and 64 diagnostic entries. Names are at most 256
characters and each group statement has at most 16 names. Deadlines are 1–30,000
ms. Budget exhaustion stops and returns a blocking diagnostic, never truncated
success. Invalid options and cancellation throw fixed safe codes.

Reports retain fixed messages, numeric line numbers and at most three numeric
components/corner, replacing malformed or unsafe integers with null. Forensic
mode additionally retains only byte/line/issue counts, within core's 64 KiB
complete report budget. Source comments, names, paths, abort reasons and exception
causes never enter reports. Canonical asset metadata intentionally retains names;
callers must not treat arbitrary asset documents as safe telemetry. No logging or
implicit I/O occurs. Direct parsing has no acquisition dependency; runtime owns
source I/O, hashing, cache and orchestration when used by consumers.

## Alternatives and consequences

- Reject a private replacement model/diagnostic schema: consumers need one
  canonical boundary, with real verified resource branding.
- Defer fan triangulation and normal generation to their tracked policies;
  guesses here would discard concavity, smoothing or fidelity semantics.
- Prefer expanded corners over premature deduplication: bounded extra memory
  preserves seams and keeps the initial parser deterministic and reviewable.
- Keep `packageBootstrap` exports unchanged for compatibility. They describe the
  historical bootstrap, not the available parser APIs.

Runtime acquisition can have a larger ceiling than the parser; consumers should
set `fetchPolicy.maxBytes` to `OBJ_PARSER_LIMITS.maxInputBytes` or tighter before
reading untrusted sources. Caller-supplied runtime workers/resolvers remain
trusted ports. Constructor options are fixed for a runtime adapter; per-call
`adapterOptions` are not interpreted by this bridge.

## Verification, rollout and release

Fail-first fixtures plus adversarial tests cover canonical bytes, index seams,
strict/tolerant/forensic policy, explicit loss consent, deterministic reports,
every budget, mutation ownership, abort/deadline and actual runtime acquisition.
All changed source files must appear in LCOV at >=80%. Validate clean install,
lint/types/build, public artifact admission, full dependency audit/signatures,
ESM/CJS installed consumers, strict declarations and a real browser bundle.

The consuming feature evaluator owns `gpu.model.conversion.enabled`; this pure
package has no feature service, local-env gate or new UI capability. Enabled
consumers may call the parser; disabled/rollback consumers skip conversion and
retain their established fallback, pinning the last validated public version.
Safety checks apply whenever parsing is invoked.

Release an additive minor version through reviewed PR, CI and existing main
`cd.yml` / `production` / npm Trusted Publisher. Let the pipeline allocate/promote
version metadata. Verify actual npm bytes/provenance and consumers after release.
Backend secretref, accessibility and SEO checks are N/A: no backend deployment,
user interface, data storage or HTTP surface changes in this delivery.
