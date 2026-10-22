# OBJ/MTL bootstrap conformance plan

Delivery: site #1166 and local #22, under Feature site #1151 / Epic site #1147.
Inherited rollout: `gpu.model.conversion.enabled`; no package-only capability.
See ADR 0006 for canonical ownership, release and rollback boundaries.

## Corpus

All inputs are synthetic, authored by Plasius LTD under Apache-2.0. The manifest
records exact SHA-256 hashes and expected future adapter outcomes. No external
models, personal data or texture pixels are included. Deliberately missing
resource names are not fetch instructions. Corpus tests inspect at most 4 KiB
per file from this directory; no network or resource resolver is used.

| Case | Authored fact | Future qualification |
| --- | --- | --- |
| triangle | One face, no normals | Geometry retained; explicit missing-normal policy |
| malformed-indices | Zero and out-of-range face indices | Strict rejects; diagnosed allowlisted repair only |
| missing-library | Referenced MTL is absent | No implicit I/O; caller reports missing resource |
| missing-texture | MTL exists; diffuse map is absent | Relative identity retained; diagnosed missing map |
| ngon | Five coplanar vertices, area 5, positive winding | Deterministic triangulation preserves topology |
| multi-material | Two faces, two declared diffuse materials | Material/face bindings semantically round-trip |
| smoothing-groups | Hard and smooth transitions, shared vertices | Explicit hard/smooth normal generation policy |

The fixture manifest says `adapterConformance: pending`. A passing corpus test
does not mean any import/export implementation exists. Additional malformed,
large, concave, cancellation and resource-security fixtures belong to the
implementation Tasks before their acceptance can pass.

## Preservation vocabulary

- Exact: source bytes or a deliberately retained identifier are unchanged.
- Semantic: exported/reimported geometry, topology and material bindings agree
  within documented numeric tolerance; source ordering need not be preserved.
- Documented loss: unsupported target semantics produce canonical fidelity
  reports. OBJ cannot silently claim rig, skin, animation or advanced-material
  preservation.

## Implementation sequence

The README links each repository-local Project Task. Start with bounded canonical
OBJ import. Material mapping and resource identity can then be implemented
against those contracts. Triangulation and smoothing policies precede final
export qualification. Fidelity reports must cover unsupported canonical input
before export is advertised. Existing local #1 coordinates the complete adapter;
bootstrap completion does not complete #1 or Feature #1151.

## Verification and NFR

Run clean install, tests/coverage, lint, typecheck, build, runtime audit, public
artifact checks and pack validation before the PR and again on released main.
Require changed source files in LCOV with at least 80% line coverage once runtime
implementation starts. This delivery changes fixtures, tests and docs only.

Privacy/security: synthetic text, bounded reads, deliberate absence, no external
I/O. Performance/scalability: small fixed corpus; no runtime allocations or
bundled assets added. Reliability/testability: digests plus semantic source
checks and deterministic release artifacts. Accessibility/browser/SEO: no UI or
runtime behavior change. Observability: test failures identify the case;
runtime telemetry is unchanged. Deployment: existing exact-main production/OIDC
workflow only; no Azure/backend environment is part of this package delivery.
