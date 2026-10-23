# OBJ and MTL safe resource-reference delivery

Project Task: https://github.com/Plasius-LTD/gpu-model-obj/issues/26
Parent Feature: https://github.com/Plasius-LTD/plasius-ltd-site/issues/1151
Architecture: [ADR0010](../adrs/adr-0010-safe-relative-resource-identities.md)
Rollout: consumer remote `gpu.model.conversion.enabled`; package-only, no capability.

## Requirements and ownership

Preserve declared libraries and texture-map identities, including missing-file
fixtures, without ambient acquisition. Reuse core0.7.0 metadata/diagnostics and
manifests, runtime0.3.2 resource ports/SHA-256. Do not decode images, pretend
unresolved references are verified images, or move acquisition into the parser.

## Data flow and boundaries

1. Validate options and snapshot OBJ/MTL bytes plus an injected resolver method.
2. Parse geometry and validate all library paths before any external call.
3. Acquire each distinct library via the caller port or explicit in-memory table.
4. Parse diffuse materials and supported inert map references. Canonicalize safe
   relative map identities against the declaring library's directory; reject
   traversal/absolute/scheme/encoding/options ambiguity before texture reads.
5. Resolve each distinct texture identity once if authorized; validate actual
   returned path/bytes/hash and retain external status without image branding.
6. Project verified geometry/materials and inert source metadata into core.
7. Export actual per-library MTL files and map-relative references, with a directory
   manifest for external resources. Revalidate metadata and stage output atomically.
8. Reimport returned OBJ and MTL bytes to prove library/texture identity preservation.

All supplied/acquired bytes share the existing 8 MiB aggregate input budget;
related resources share 32 identities. Diagnostics cap at64; physical lines cap
at4096 UTF-8 bytes, materials128. Resolver calls are sequential, have remaining
byte ceilings and a combined abort/deadline signal, and never retry. Providers
must enforce limits during I/O and honor cancellation. Cooperative parsing and
caller workers provide execution isolation.

## Acceptance and NFR evidence strategy

Tests cover authored missing-file fixtures, quoted/escaped/unquoted space policy,
unsafe traversal/schemes, no resolver or ambient fetch, actual runtime resolver,
method/byte snapshots, duplicate/conflict/malformed results, privacy, tightened
budgets, stalled-port abort/deadline, output metadata forgery, empty/missing
libraries and deterministic multiple-library round trips. Run all compatibility
tests and require each changed runtime file in combined LCOV with >=80% lines.
Qualify packed/public ESM, CJS, strict declarations and a real browser, perform
clean install/build/lint/type checks, audit/signature/tree/pack validation and
review representative resource-operation latency. UI/accessibility/SEO and
backend secretRef are N/A: no application surface or deployment changes.

## Delivery and rollback

No dependencies, site source, workflows, secrets, publisher settings or control
plane change. Use a focused PR, configured CI, permitted merge, existing release
preparation PR, genuine exact-main pushCI and production cd.yml/OIDC publication.
Verify actual registry tarball/provenance/hosted artifact/consumer behavior before
TaskDone. Roll back via the consuming remote feature evaluator and pin qualified
public0.4.0. The parent Feature and adapter coordinator remain incomplete until
all separately tracked geometry/fidelity work is delivered.
