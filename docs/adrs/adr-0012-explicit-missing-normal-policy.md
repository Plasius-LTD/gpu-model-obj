# ADR0012: Explicit bounded OBJ missing-normal policy

Status: Accepted for Task28 under Feature1151; release evidence belongs to the issue.

## Problem and reuse

OBJ smoothing is defined by source vertex indices and face state. Canonical
triangle expansion and material/UV splits discard the adjacency needed for a
correct missing-normal policy. Published core0.7.0 owns verified f32 NORMAL
accessors; runtime0.3.2 owns acquisition. Neither provides OBJ smoothing semantics.
Keep this format policy in the existing adapter, with no new dependency/package.

## Decision

Add `missingNormals: preserve | reject | generate` to parse options and the runtime
adapter factory. Preserve is the default: wholly missing faces have no NORMAL;
within-face mixed normals still reject, matching the existing profile. Reject
requires every admitted corner to reference an authored normal. Generate is
explicit consent to fill only missing corners; retain authored finite f32 values
including their magnitude. Mixed UV presence remains unsupported. No mode or
allowLoss setting enables generation implicitly.

Accept one bounded smoothing token without whitespace or backslashes; canonicalize `0` to `off` and `on` to `1`.
Other numeric/named tokens are exact identities (for example `01` differs from
`1`). Invalid multi-token smoothing now rejects instead of retaining ambiguous
metadata. Export validates a single token and emits the same aliases consistently.

After admitted faces are triangulated but before canonical packing/material I/O,
sum each original face's signed triangle cross products in source order. For
`off`, use that original-face direction at each missing corner. Otherwise add the
area vector once per original source corner into a map keyed by object name,
exact smoothing token and source position index. Include faces with authored
normals as geometric neighbours. Group names, material changes, UV seams and
authored normal indices do not split this map. Distinct source indices never
weld merely because coordinates coincide; different object names isolate sums.
Repeated `o` declarations with the same name intentionally share identity.

Use double intermediate arithmetic on admitted canonical f32 positions. Cross
products remain finite across that range and the source/output ceilings. Normalize
only requested missing directions, round to f32 and canonicalize negative zero.
If a required smooth vector's length is at most 1e-12 times the sum of incident
area-vector lengths (or zero/nonfinite), reject atomically with
OBJ_AMBIGUOUS_NORMAL in every mode. Do not pick a neighbour, flip faces, invent a
fallback or overwrite authored normals. A cancelling sum unused by any missing
corner is harmless. Generation emits one fixed OBJ_NORMALS_GENERATED warning;
it is an explicit derived attribute, not a repair or fidelity-loss entry.

Internal face records retain only bounded corner indices, triangle indices,
canonical group references and offsets. Linear passes charge one work unit per
triangle vector, smooth source corner and expanded output corner against an
import-wide maxNormalWork=1000000; callers may only tighten it. Check/yield every
256 work units and check the operation clock before/after. Existing input,
source, face, expanded-vertex, primitive and diagnostic ceilings remain active.
No partial document or implicit external I/O is exposed on failure.

## Alternatives and consequences

Generating by default would change existing lighting unexpectedly. Per-primitive
generation creates material seams; per-triangle accumulation overweights ears
and adds flat polygon diagonals; welding by coordinates merges authored seams.
Angle weighting and orientation repair introduce different surface policies and
remain outside this task. The chosen deterministic area-weighted definition is
documented rather than claiming a unique author-intended shading reconstruction.

Canonical NORMAL values preserve authored data on import. The existing exporter
normalizes directions after inverse-transpose transforms; it does not preserve
non-unit magnitude or reconstruct original polygon/vertex index spelling.
Generated normals are explicit authored references on export/reimport and are
never regenerated unless actually missing. No new generated-normal metadata or
public helper is needed.

## Tests, NFR and release

See [normal design](../designs/obj-normals.md). Fixtures/regressions cover hard and
smooth edges, exact group/object identity, material/UV boundaries, original
polygon weighting, independent mixed corners, authored values, cancelling sums,
strict/tolerant/forensic reports, bounds, in-flight cancellation/deadline and
deterministic canonical/export/reimport results. Every changed source must appear
in LCOV; full frozen-install/type/lint/build/pack/audit/public consumer gates apply.
Only approved cd.yml main/production publishes; qualify the actual registry bytes,
provenance and ESM/CJS/browser consumers before Done. No UI, SEO, data storage,
backend deployment, new capability or site integration is introduced.

Inherited remote flag: gpu.model.conversion.enabled, evaluated by the consuming
feature. Rollback disables that evaluator flag and pins validated public0.6.0.
The package adds no local substitute evaluator or environment override.
