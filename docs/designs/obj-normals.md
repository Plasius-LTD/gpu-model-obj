# OBJ normal policy and acceptance matrix

Task [OBJ28](https://github.com/Plasius-LTD/gpu-model-obj/issues/28) implements
[ADR0012](../adrs/adr-0012-explicit-missing-normal-policy.md) under Feature1151.

| Requirement | Evidence |
| --- | --- |
| No silent invented normals | Default preserve/no accessor; reject option fails all missing corners; generate is explicit and emits fixed warning |
| Hard/smooth boundaries | Authored smooth-wedge fixture plus off/0/on/named/numeric transitions, object names and distinct coincident indices |
| Material/group/UV seams | Shared geometric weights across canonical primitives; bindings and UV values retained |
| Original polygon area weighting | Quad/triangle unequal areas and concave reversed flat polygon; ear incidence never adds weights |
| Authored/missing normals | Authored mixed-normals fixture keeps non-unit authored f32 values; adjacent authored faces contribute geometry; omitted UVs are not invented |
| Fail closed | Cancelling/near-cancelling sums, malformed smoothing, getters/options, normal work and diagnostic capacity; strict/tolerant/forensic without repairs/loss bypass |
| Operation bounds | Source/output ceilings and linear maxNormalWork; direct normal-phase cooperative abort/deadline checks |
| Deterministic export | Repeated canonical and OBJ bytes, s transitions, inverse-transpose unit directions and reimport with reject policy |
| Runtime/rollout | Existing published runtime bridge forwards explicit policy; consumer enable/disable/rollback contract fixture, no new package evaluator |

Tests precede implementation; failure of the new cases against0.6.0 is recorded
in the issue evidence. Synthetic fixtures are repository-authored Apache-2.0 and
their SHA256 digests remain enforced by the corpus manifest. No third-party asset
or personal information is needed.

NFR checks: security/privacy use fixed diagnostics and no implicit I/O; reliability
uses atomic failure/cancellation/deadlines; performance/scalability use bounded
linear maps/passes with no mutable globals; reproducibility uses npm ci and exact
published core/runtime versions; maintainability/testability use the internal
normal module plus changed-source LCOV; observability is the fixed warning/error
report. UI accessibility, SEO, databases, external-server retries and ACA secretref
mapping are N/A for this package-only change. Browser portability is verified on
the actual build/public ESM artifact where available; unsupported browser execution
must be stated rather than inferred. No dependency/workflow/settings changes.
