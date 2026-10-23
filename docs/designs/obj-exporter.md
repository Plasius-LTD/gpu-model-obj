# OBJ exporter delivery plan

Authoritative work: [Task24](https://github.com/Plasius-LTD/gpu-model-obj/issues/24),
parent [Feature1151](https://github.com/Plasius-LTD/plasius-ltd-site/issues/1151).
Rollout: `gpu.model.conversion.enabled`; no package-only capability.
Decision: [ADR0008](../adrs/adr-0008-deterministic-canonical-obj-export.md).

## Problem and modules

Canonical geometry needs deterministic OBJ bytes that can be imported without a
private model or target schema. `export-policy.ts` owns descriptor validation,
tighten-only bounds, fixed errors, deadline/abort cleanup. `export-geometry.ts`
owns ordered scene projection and verified accessor decoding. `exporter.ts` stages
text, references, independent index tables and core reports/manifests. `index.ts`
exports additive APIs; existing parser/runtime ownership is unchanged.

## Acceptance-derived test strategy

1. Fail on missing exporter, then prove repeated byte equality, three real output
   types and a one-entry inline manifest through actual core registry export.
2. Reimport output and compare world-space positions, UV seams, normal directions,
   face order and representable authored references. Check nested transforms,
   reflection/winding, indexed and interleaved buffers, and mesh instances.
3. Reject malformed target/policy descriptors without invoking getters, invalid
   document brands, unsupported topology/attributes/dynamic content and reference
   injection. Verify explicit material-definition loss consent and no MTL claim.
4. Prove all declared budgets, cancellation/deadline during stalled resources,
   fixed private-data-free resource errors and absence of implicit external I/O.
5. Validate all touched sources in LCOV, strict complete test compilation, packed
   ESM/CJS/declarations and browser execution. Audit exact existing dependencies.

## NFR and release checks

Security/privacy: privately verified document boundary, inert target descriptors,
strict reference/numeric validation, bounded bytes/work, no logging or provider
causes. Caller-provided output names remain asset data. Reliability/performance:
no partial output, retries or background writes; bounded yielding and resource
read deadlines; observe large in-profile exports without claiming a universal SLO.
Maintainability/testability: small source modules, requirement-derived tests,
public core contracts and no opportunistic dependency churn. Portability: browser
Web APIs and dual Node modules. UI/a11y/SEO/backend deployment checks are N/A.

Release via source PR/CI/main CI, pipeline-generated metadata PR, approved
main/production CD, actual registry/provenance and installed-consumer checks.
Record immutable commits, commands, exit codes, timestamps and NFR evidence in
Task24 before Done. Feature1151 and coordinator1 remain open for Tasks25–29/FBX.
