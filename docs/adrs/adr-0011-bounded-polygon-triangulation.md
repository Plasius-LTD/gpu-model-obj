# ADR0011: Bounded deterministic OBJ polygon triangulation

Status: Accepted for Task27 under Feature1151; release evidence belongs to the issue.

## Problem and reuse

OBJ faces may be concave. A triangle fan can leave the authored surface or reverse
parts of it. Published core0.7.0 owns canonical triangles/byte verification and
runtime0.3.2 owns acquisition/diagnostic integration; neither exposes general
polygon triangulation. Keep format-specific policy here and reuse those exact
public packages. No new dependency, package, renderer or site code is needed.

## Decision

Admit a single simple planar contour with 3–256 corners. Validate the canonical
f32 positions (after existing numeric conversion), not higher-precision source
spelling. Translate by the bounding-box minimum and divide by the largest extent
before predicates. Select the largest consecutive fan cross product from corner0
(first wins ties) to define a plane. Reject zero/near-zero area, any distance from
that plane exceeding 1e-7 of the largest 3D extent, repeated/projected-coincident
corners, collinear consecutive corners, and crossing/touching nonadjacent edges.
Project by dropping the normal's largest absolute component (X, Y, Z tie order).
Squared point-distance tolerance is 1e-24; orientation/area tolerance is 1e-12 in
normalized coordinates. These conservative admission tolerances intentionally
reject very thin or ambiguous geometry. They are not a repair or projection of
non-planar input; original admitted f32 coordinates remain unchanged.

For valid contours choose the first convex ear scanning the surviving original
corner order from its beginning each time. A surviving corner on an ear boundary
blocks that ear. Emit (previous, current, next), preserving authored winding, then
remove current. Emit the last three corners in their surviving order. Never add
vertices or combine different corner UV/normal references. Emit n-2 canonical
triangles with the source object's groups, material and smoothing metadata.
Existing triangle ordering remains identical. Polygon contour topology is not
reconstructed on export: deterministic triangle OBJ is the public output profile.

Hard parser ceilings add maxFaceVertices=256 and maxTriangulationWork=1000000;
callers may tighten either using the existing limits contract. Charge validation
and ear-search loop iterations against one import-wide work budget, including
triangles. Check/yield at most every256 work units. Check expanded vertex capacity
before triangulation. Together with the existing line/input/source/face/output
ceilings this bounds memory and the cubic worst-case ear search; exhaustion
rejects atomically with OBJ_LIMIT_EXCEEDED. Deadline and abort use the existing
whole-operation clock. There is no I/O, worker creation, retry or mutable global
state. The caller still owns worker/concurrency isolation.

Unsupported shapes reject all modes even with allowLoss. No silent cleanup,
welding, contour reordering, hole filling, face dropping or projection is added.
The existing invalid-indices repair remains the only index-recovery path and
continues to record paired repair/loss entries with explicit consent. A fixed
warning reports valid polygon conversion without raw authored text; exact
surface triangulation is not a fidelity loss or repair. Triangles now receive the
same degeneracy validation, an intentional admission tightening.

## Alternatives and impact

A fan is smaller but incorrect for concavity. A new triangulation dependency
adds review/licensing/runtime surface and still needs the same numerical and
resource admission policy. Unbounded generic holes/constraints/adaptive exact
predicates are outside this bounded single-contour profile. Rejecting ambiguity
is preferable to undocumented numerical repair. Supporting those cases later
requires a separately tracked policy decision.

## Tests, NFR and release

See ../designs/obj-triangulation.md. Unit/fixture/contract tests establish signed
area, n-2 topology, winding and corner attributes; reversal/axis/scale cases,
intersections/non-planarity/degeneracy, deterministic export/reimport, hard and
tightened work/output budgets and in-flight abort/deadline cover failure paths.
Every changed source must appear in LCOV and pass the 80% gate. README/Unreleased
CHANGELOG and this ADR accompany the focused PR. Only ordinary cd.yml on main in
production publishes the package; public npm bytes/provenance and ESM/CJS/browser
consumers must be verified before Done. Package-only UI/accessibility/SEO/data
storage are N/A. Fixed bounded numeric-only reports protect privacy; frozen
installs/audit preserve reproducibility/dependency health.

Feature flag gpu.model.conversion.enabled is inherited from Feature1151; the
consumer's remote evaluator gates entry, no local env control substitutes it.
No capability is needed for package-only work. Rollback disables that evaluator
flag and pins the last validated public 0.5.1 release.
